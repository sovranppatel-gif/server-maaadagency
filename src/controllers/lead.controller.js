import { Lead } from "../models/Lead.js";
import { LeadFollowUp } from "../models/LeadFollowUp.js";
import { Client } from "../models/Client.js";
import { Employee } from "../models/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { normalisePhone, prettyPhone, avatarColorFor } from "../utils/format.js";
import { recalcClientStats } from "../services/stats.service.js";
import { notifyEmployee, notifyWork } from "../services/notification.service.js";
import { emitEvent } from "../config/socket.js";

/** Translates dashboard filters into a Mongo query without widening employee access. */
function buildFilter(query, user) {
  const filter = {};
  const { search, status, priority, source, service, employeeId } = query;

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { clientName: rx },
      { contactPersonName: rx },
      { company: rx },
      { requirement: rx },
      { phone: rx },
      { alternatePhone: rx },
      { email: rx },
      { code: rx },
      { service: rx },
    ];
  }
  if (status && status !== "All") filter.status = status;
  if (priority && priority !== "All") filter.priority = priority;
  if (source && source !== "All") filter.source = source;
  if (service && service !== "All") filter.service = service;
  if (user?.role === "EMPLOYEE") {
    const assignedTo = user.employee?._id ?? user.employee;
    filter.assignedEmployeeId = assignedTo ?? { $in: [] };
  } else if (employeeId && employeeId !== "All") {
    filter.assignedEmployeeId = employeeId === "unassigned" ? null : employeeId;
  }
  return filter;
}

function canEmployeeAccessLead(user, lead) {
  const employeeId = user?.employee?._id ?? user?.employee;
  return user?.role !== "EMPLOYEE" || Boolean(employeeId && String(lead.assignedEmployeeId) === String(employeeId));
}

function leadResponse(lead) {
  const data = lead.toJSON();
  delete data.submissionKey;
  return data;
}

function leadResponseForUser(lead, user) {
  const data = leadResponse(lead);
  if (user?.role === "EMPLOYEE") {
    delete data.budget;
    delete data.internalRemarks;
    delete data.activity;
    delete data.attachments;
  }
  return data;
}

/** GET /api/leads */
export const listLeads = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query, ["createdAt", "updatedAt", "priority", "status", "deadline"]);
  const filter = buildFilter(query, req.user);

  const [items, total] = await Promise.all([
    // Heavy sub-documents are excluded from list views: they are only needed
    // on the detail screen, and skipping them keeps payloads small.
    Lead.find(filter)
      .select(req.user.role === "EMPLOYEE" ? "-activity -attachments -budget -internalRemarks" : "-activity -attachments")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Lead.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: buildMeta({ page, limit, total }) }
  );
});

/** GET /api/leads/stats — counters for the Leads page header cards. */
export const leadStats = asyncHandler(async (req, res) => {
  const assignedTo = req.user?.employee?._id ?? req.user?.employee;
  const filter =
    req.user?.role === "EMPLOYEE"
      ? { assignedEmployeeId: assignedTo ?? { $in: [] } }
      : {};
  const [grouped, total] = await Promise.all([
    Lead.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Lead.countDocuments(filter),
  ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g._id, g.count]));
  return sendSuccess(res, {
    total,
    new: byStatus.New ?? 0,
    assigned: byStatus.Assigned ?? 0,
    inProgress: byStatus["In Progress"] ?? 0,
    converted: (byStatus.Approved ?? 0) + (byStatus.Completed ?? 0),
    byStatus,
  });
});

/** GET /api/leads/:id — accepts an ObjectId or a code such as LD-1042. */
export const getLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");
  if (!canEmployeeAccessLead(req.user, lead)) throw ApiError.notFound("Lead not found");
  return sendSuccess(res, leadResponseForUser(lead, req.user));
});

/** POST /api/leads — manual entry; creates the client on the fly when needed. */
export const createLead = asyncHandler(async (req, res) => {
  const body = req.body;
  const submissionKey = req.get("Idempotency-Key")?.trim();
  if (submissionKey && !/^[\w-]{8,100}$/.test(submissionKey)) {
    throw ApiError.badRequest("Invalid idempotency key");
  }
  if (submissionKey) {
    const previous = await Lead.findOne({ submissionKey }).select("+submissionKey");
    if (previous) return sendSuccess(res, leadResponse(previous));
  }

  const phone = normalisePhone(body.phone);
  const alternatePhone = body.alternatePhone ? normalisePhone(body.alternatePhone) : undefined;

  const employee = body.assignedEmployeeId
    ? await Employee.findById(body.assignedEmployeeId)
    : null;
  if (body.assignedEmployeeId && (!employee || !employee.isActive)) {
    throw ApiError.badRequest("Assigned employee was not found or is deactivated");
  }

  let client = body.clientId ? await Client.findById(body.clientId) : await Client.findOne({ phone });
  if (body.clientId && !client) throw ApiError.badRequest("Client not found");
  if (!client) {
    const name = body.contactPersonName || body.clientName || body.company || prettyPhone(phone);
    try {
      client = await Client.create({
        name,
        company: body.company || body.clientName || undefined,
        phone,
        phoneDisplay: prettyPhone(phone),
        email: body.email || undefined,
        avatarColor: avatarColorFor(phone),
      });
    } catch (err) {
      if (err?.code !== 11000 || !err.keyPattern?.phone) throw err;
      client = await Client.findOne({ phone });
      if (!client) throw err;
    }
  }

  let lead;
  try {
    lead = await Lead.create({
      ...body,
      phone,
      alternatePhone,
      clientId: client._id,
      clientName: body.clientName || client.company || client.name,
      company: body.company || body.clientName || client.company,
      email: body.email || client.email,
      assignedEmployeeId: employee?._id,
      assignedDate: employee ? new Date() : undefined,
      status: employee ? "Assigned" : "New",
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      enquiryDate: body.enquiryDate ? new Date(body.enquiryDate) : new Date(),
      submissionKey,
      activity: [
        { label: "Lead Created", actor: req.user?.name ?? "Admin", timestamp: new Date() },
        ...(employee
          ? [{ label: `Assigned to ${employee.name}`, actor: req.user?.name ?? "Admin", timestamp: new Date() }]
          : []),
      ],
    });
  } catch (err) {
    if (submissionKey && err?.code === 11000 && err.keyPattern?.submissionKey) {
      const previous = await Lead.findOne({ submissionKey }).select("+submissionKey");
      if (previous) return sendSuccess(res, leadResponse(previous));
    }
    throw err;
  }

  await recalcClientStats(client._id);
  emitEvent("lead:new", leadResponse(lead));
  if (employee) {
    await Promise.all([
      notifyWork("Lead assigned", `${lead.requirement} assigned to ${employee.name}`, `/master-admin/leads/${lead.code}`),
      notifyEmployee(employee._id, {
        title: "New lead assigned to you",
        description: `${lead.clientName}: ${lead.requirement}`,
        href: `/employee/leads/${lead.code}`,
      }),
    ]);
  }

  return sendCreated(res, leadResponse(lead));
});

/** PATCH /api/leads/:id */
export const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");
  if (!canEmployeeAccessLead(req.user, lead)) throw ApiError.notFound("Lead not found");

  const previousStatus = lead.status;
  const { deadline, enquiryDate, alternatePhone, ...fields } = req.body;
  Object.assign(lead, fields);
  if (deadline !== undefined) lead.deadline = deadline ? new Date(deadline) : undefined;
  if (enquiryDate !== undefined) lead.enquiryDate = enquiryDate ? new Date(enquiryDate) : undefined;
  if (alternatePhone !== undefined) lead.alternatePhone = alternatePhone ? normalisePhone(alternatePhone) : undefined;

  if (req.body.status && req.body.status !== previousStatus) {
    lead.log(`Status changed to ${req.body.status}`, req.user?.name ?? "Admin");
  } else {
    lead.log("Lead updated", req.user?.name ?? "Admin");
  }

  await lead.save();
  return sendSuccess(res, leadResponseForUser(lead, req.user));
});

/** POST /api/leads/:id/assign */
export const assignLead = asyncHandler(async (req, res) => {
  const [lead, employee] = await Promise.all([
    Lead.findOne(byIdOrCode(req.params.id)),
    Employee.findById(req.body.employeeId),
  ]);

  if (!lead) throw ApiError.notFound("Lead not found");
  if (!employee) throw ApiError.badRequest("Employee not found");
  if (!employee.isActive) throw ApiError.badRequest("This employee is deactivated");

  const previousEmployeeId = lead.assignedEmployeeId;
  const assignmentChanged = String(previousEmployeeId ?? "") !== String(employee._id);
  if (!assignmentChanged) return sendSuccess(res, lead.toJSON());

  lead.assignedEmployeeId = employee._id;
  lead.assignedDate = new Date();
  if (lead.status === "New") lead.status = "Assigned";
  lead.log(`Assigned to ${employee.name}`, req.user?.name ?? "Admin");
  await lead.save();

  await Promise.all([
    notifyWork(
      "Lead assigned",
      `${lead.requirement} assigned to ${employee.name}`,
      `/master-admin/leads/${lead.code}`
    ),
    notifyEmployee(employee._id, {
      title: previousEmployeeId ? "Lead reassigned to you" : "New lead assigned to you",
      description: `${lead.clientName}: ${lead.requirement}`,
      href: `/employee/leads/${lead.code}`,
    }),
    previousEmployeeId
      ? notifyEmployee(previousEmployeeId, {
          title: "Lead reassigned",
          description: `${lead.code} was reassigned to ${employee.name}.`,
        })
      : null,
  ]);
  emitEvent("lead:updated", lead.toJSON());

  return sendSuccess(res, lead.toJSON());
});

/** PATCH /api/leads/:id/status */
export const updateLeadStatus = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");
  if (!canEmployeeAccessLead(req.user, lead)) throw ApiError.notFound("Lead not found");
  if (req.user?.role === "EMPLOYEE" && !["In Progress", "Submitted"].includes(req.body.status)) {
    throw ApiError.forbidden("Employees may only move their assigned leads to In Progress or Submitted");
  }

  lead.status = req.body.status;
  lead.log(`Status changed to ${req.body.status}`, req.user?.name ?? "Admin");
  await lead.save();

  emitEvent("lead:updated", lead.toJSON());
  return sendSuccess(res, leadResponseForUser(lead, req.user));
});

/** DELETE /api/leads/:id */
export const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");
  if (await LeadFollowUp.exists({ leadId: lead._id })) {
    throw ApiError.conflict("This lead has permanent follow-up history and cannot be deleted");
  }
  await lead.deleteOne();

  await recalcClientStats(lead.clientId);
  return sendSuccess(res, { id: String(lead._id), deleted: true });
});

import { Lead } from "../models/Lead.js";
import { Client } from "../models/Client.js";
import { Employee } from "../models/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { normalisePhone, prettyPhone, avatarColorFor } from "../utils/format.js";
import { recalcClientStats } from "../services/stats.service.js";
import { notifyWork } from "../services/notification.service.js";
import { emitEvent } from "../config/socket.js";

/** Translates dashboard filters into a Mongo query. */
function buildFilter(query) {
  const filter = {};
  const { search, status, priority, source, service, employeeId } = query;

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ clientName: rx }, { requirement: rx }, { phone: rx }, { code: rx }, { service: rx }];
  }
  if (status && status !== "All") filter.status = status;
  if (priority && priority !== "All") filter.priority = priority;
  if (source && source !== "All") filter.source = source;
  if (service && service !== "All") filter.service = service;
  if (employeeId && employeeId !== "All") {
    filter.assignedEmployeeId = employeeId === "unassigned" ? null : employeeId;
  }
  return filter;
}

/** GET /api/leads */
export const listLeads = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query, ["createdAt", "updatedAt", "priority", "status", "deadline"]);
  const filter = buildFilter(query);

  const [items, total] = await Promise.all([
    // Heavy sub-documents are excluded from list views: they are only needed
    // on the detail screen, and skipping them keeps payloads small.
    Lead.find(filter).select("-activity -attachments").sort(sort).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: buildMeta({ page, limit, total }) }
  );
});

/** GET /api/leads/stats — counters for the Leads page header cards. */
export const leadStats = asyncHandler(async (_req, res) => {
  const [grouped, total] = await Promise.all([
    Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Lead.countDocuments(),
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
  return sendSuccess(res, lead.toJSON());
});

/** POST /api/leads — manual entry; creates the client on the fly when needed. */
export const createLead = asyncHandler(async (req, res) => {
  const body = req.body;
  const phone = normalisePhone(body.phone);

  let client = body.clientId ? await Client.findById(body.clientId) : await Client.findOne({ phone });
  if (!client) {
    const name = body.clientName || body.company || prettyPhone(phone);
    client = await Client.create({
      name,
      company: body.company,
      phone,
      phoneDisplay: prettyPhone(phone),
      email: body.email || undefined,
      avatarColor: avatarColorFor(phone),
    });
  }

  const lead = await Lead.create({
    ...body,
    phone,
    clientId: client._id,
    clientName: client.company || client.name,
    email: body.email || client.email,
    deadline: body.deadline ? new Date(body.deadline) : undefined,
    activity: [{ label: "Lead Created", actor: req.user?.name ?? "Admin", timestamp: new Date() }],
  });

  await recalcClientStats(client._id);
  emitEvent("lead:new", lead.toJSON());

  return sendCreated(res, lead.toJSON());
});

/** PATCH /api/leads/:id */
export const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");

  const previousStatus = lead.status;
  Object.assign(lead, req.body, req.body.deadline ? { deadline: new Date(req.body.deadline) } : {});

  if (req.body.status && req.body.status !== previousStatus) {
    lead.log(`Status changed to ${req.body.status}`, req.user?.name ?? "Admin");
  } else {
    lead.log("Lead updated", req.user?.name ?? "Admin");
  }

  await lead.save();
  return sendSuccess(res, lead.toJSON());
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

  lead.assignedEmployeeId = employee._id;
  lead.assignedDate = new Date();
  if (lead.status === "New") lead.status = "Assigned";
  lead.log(`Assigned to ${employee.name}`, req.user?.name ?? "Admin");
  await lead.save();

  await notifyWork(
    "Lead assigned",
    `${lead.requirement} assigned to ${employee.name}`,
    `/master-admin/leads/${lead.code}`
  );
  emitEvent("lead:updated", lead.toJSON());

  return sendSuccess(res, lead.toJSON());
});

/** PATCH /api/leads/:id/status */
export const updateLeadStatus = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");

  lead.status = req.body.status;
  lead.log(`Status changed to ${req.body.status}`, req.user?.name ?? "Admin");
  await lead.save();

  emitEvent("lead:updated", lead.toJSON());
  return sendSuccess(res, lead.toJSON());
});

/** DELETE /api/leads/:id */
export const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOneAndDelete(byIdOrCode(req.params.id));
  if (!lead) throw ApiError.notFound("Lead not found");

  await recalcClientStats(lead.clientId);
  return sendSuccess(res, { id: String(lead._id), deleted: true });
});

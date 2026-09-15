import { Work, WORK_TRANSITIONS } from "../models/Work.js";
import { Lead } from "../models/Lead.js";
import { Client } from "../models/Client.js";
import { Employee } from "../models/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { recalcEmployeeStats } from "../services/stats.service.js";
import { notifyWork } from "../services/notification.service.js";
import { emitEvent } from "../config/socket.js";

/** Guards the review workflow: only declared transitions are allowed. */
function assertTransition(work, next) {
  const allowed = WORK_TRANSITIONS[work.status] ?? [];
  if (!allowed.includes(next)) {
    throw ApiError.badRequest(`Cannot move work from ${work.status} to ${next}`);
  }
}

function buildFilter(query) {
  const filter = {};
  const { search, status, priority, employeeId, clientId } = query;

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: rx }, { clientName: rx }, { code: rx }, { service: rx }];
  }
  if (status && status !== "All") filter.status = status;
  if (priority && priority !== "All") filter.priority = priority;
  if (clientId) filter.clientId = clientId;
  if (employeeId && employeeId !== "All") {
    filter.employeeId = employeeId === "unassigned" ? null : employeeId;
  }
  return filter;
}

/** GET /api/works */
export const listWorks = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query, ["updatedAt", "createdAt", "deadline", "priority", "progress"], { updatedAt: -1 });
  const filter = buildFilter(query);

  const [items, total] = await Promise.all([
    Work.find(filter)
      .select("-activity -attachments -revisionHistory -employeeReport")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Work.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: buildMeta({ page, limit, total }) }
  );
});

/** GET /api/works/stats — counts behind the Work Management status tabs. */
export const workStats = asyncHandler(async (_req, res) => {
  const [grouped, total] = await Promise.all([
    Work.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Work.countDocuments(),
  ]);

  const byStatus = Object.fromEntries(grouped.map((g) => [g._id, g.count]));
  return sendSuccess(res, {
    total,
    UNASSIGNED: byStatus.UNASSIGNED ?? 0,
    ASSIGNED: byStatus.ASSIGNED ?? 0,
    IN_PROGRESS: byStatus.IN_PROGRESS ?? 0,
    SUBMITTED: byStatus.SUBMITTED ?? 0,
    CHANGES_REQUESTED: byStatus.CHANGES_REQUESTED ?? 0,
    APPROVED: byStatus.APPROVED ?? 0,
    COMPLETED: byStatus.COMPLETED ?? 0,
  });
});

/** GET /api/works/:id */
export const getWork = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  return sendSuccess(res, work.toJSON());
});

/** POST /api/works */
export const createWork = asyncHandler(async (req, res) => {
  const { clientId, employeeId, leadId, deadline, ...rest } = req.body;

  const client = await Client.findById(clientId);
  if (!client) throw ApiError.badRequest("Client not found");

  const employee = employeeId ? await Employee.findById(employeeId) : null;
  if (employeeId && !employee) throw ApiError.badRequest("Employee not found");

  const actor = req.user?.name ?? "Admin";
  const work = new Work({
    ...rest,
    clientId: client._id,
    clientName: client.company || client.name,
    leadId: leadId || undefined,
    employeeId: employee?._id,
    deadline: new Date(deadline),
    status: employee ? "ASSIGNED" : "UNASSIGNED",
  });

  work.log("Work Created", actor);
  if (employee) work.log(`Assigned to ${employee.name}`, actor);
  await work.save();

  // Keep the originating lead in step with the work it produced.
  if (leadId) {
    const lead = await Lead.findById(leadId);
    if (lead) {
      if (employee) {
        lead.assignedEmployeeId = employee._id;
        lead.assignedDate = new Date();
        lead.status = "Assigned";
      }
      lead.log("Work created from lead", actor);
      await lead.save();
    }
  }

  if (employee) await recalcEmployeeStats(employee._id);
  emitEvent("work:new", work.toJSON());

  return sendCreated(res, work.toJSON());
});

/** PATCH /api/works/:id */
export const updateWork = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");

  Object.assign(work, req.body, req.body.deadline ? { deadline: new Date(req.body.deadline) } : {});
  work.log("Work updated", req.user?.name ?? "Admin");
  await work.save();

  return sendSuccess(res, work.toJSON());
});

/** POST /api/works/:id/assign */
export const assignWork = asyncHandler(async (req, res) => {
  const [work, employee] = await Promise.all([
    Work.findOne(byIdOrCode(req.params.id)),
    Employee.findById(req.body.employeeId),
  ]);

  if (!work) throw ApiError.notFound("Work not found");
  if (!employee) throw ApiError.badRequest("Employee not found");
  if (!employee.isActive) throw ApiError.badRequest("This employee is deactivated");

  const previousEmployeeId = work.employeeId;
  work.employeeId = employee._id;
  if (work.status === "UNASSIGNED") work.status = "ASSIGNED";
  work.log(`Assigned to ${employee.name}`, req.user?.name ?? "Admin");
  await work.save();

  await Promise.all([
    recalcEmployeeStats(employee._id),
    previousEmployeeId && String(previousEmployeeId) !== String(employee._id)
      ? recalcEmployeeStats(previousEmployeeId)
      : null,
  ]);

  await notifyWork("Work assigned", `${work.title} assigned to ${employee.name}`, `/master-admin/work/${work.code}`);
  emitEvent("work:updated", work.toJSON(), `user:${employee._id}`);

  return sendSuccess(res, work.toJSON());
});

/** PATCH /api/works/:id/progress */
export const updateProgress = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");

  work.progress = req.body.progress;
  if (work.status === "ASSIGNED" && work.progress > 0) {
    work.status = "IN_PROGRESS";
    work.log("Work Started", req.user?.name ?? "Employee");
  }
  await work.save();

  if (work.employeeId) await recalcEmployeeStats(work.employeeId);
  return sendSuccess(res, work.toJSON());
});

/** POST /api/works/:id/submit — employee hands work back for review. */
export const submitWork = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  assertTransition(work, "SUBMITTED");

  const actor = req.user?.name ?? "Employee";
  work.employeeReport = {
    summary: req.body.summary,
    remarks: req.body.remarks ?? "",
    timeSpent: req.body.timeSpent ?? "",
    files: work.employeeReport?.files ?? [],
    screenshots: work.employeeReport?.screenshots ?? [],
    submittedAt: new Date(),
  };
  work.status = "SUBMITTED";
  work.progress = 100;
  work.log("Submitted for Review", actor);
  await work.save();

  if (work.employeeId) await recalcEmployeeStats(work.employeeId);
  await notifyWork(`${actor} submitted work`, `${work.title} is ready for review`, `/master-admin/work/${work.code}`);
  emitEvent("work:updated", work.toJSON());

  return sendSuccess(res, work.toJSON());
});

/** POST /api/works/:id/approve */
export const approveWork = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  assertTransition(work, "APPROVED");

  work.status = "APPROVED";
  work.log("Work Approved", req.user?.name ?? "Admin");
  await work.save();

  if (work.leadId) await Lead.findByIdAndUpdate(work.leadId, { status: "Approved" });
  if (work.employeeId) await recalcEmployeeStats(work.employeeId);

  await notifyWork("Work approved", `${work.title} was approved`, `/master-admin/work/${work.code}`);
  emitEvent("work:updated", work.toJSON(), work.employeeId ? `user:${work.employeeId}` : undefined);

  return sendSuccess(res, work.toJSON());
});

/** POST /api/works/:id/request-changes */
export const requestChanges = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  assertTransition(work, "CHANGES_REQUESTED");

  const { notes, priority, deadline } = req.body;
  work.revisionHistory.push({
    notes,
    priority,
    deadline: deadline ? new Date(deadline) : undefined,
    requestedBy: req.user?._id,
    requestedAt: new Date(),
  });
  work.status = "CHANGES_REQUESTED";
  work.priority = priority;
  if (deadline) work.deadline = new Date(deadline);
  work.log("Changes Requested", req.user?.name ?? "Admin", notes);
  await work.save();

  if (work.leadId) await Lead.findByIdAndUpdate(work.leadId, { status: "Changes Requested" });
  if (work.employeeId) await recalcEmployeeStats(work.employeeId);

  await notifyWork("Revision requested", `${work.title}: ${notes.slice(0, 90)}`, `/master-admin/work/${work.code}`);
  emitEvent("work:updated", work.toJSON(), work.employeeId ? `user:${work.employeeId}` : undefined);

  return sendSuccess(res, work.toJSON());
});

/** POST /api/works/:id/complete */
export const completeWork = asyncHandler(async (req, res) => {
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  assertTransition(work, "COMPLETED");

  work.status = "COMPLETED";
  work.progress = 100;
  work.log("Marked Completed", req.user?.name ?? "Admin");
  await work.save();

  if (work.leadId) await Lead.findByIdAndUpdate(work.leadId, { status: "Completed" });
  if (work.employeeId) await recalcEmployeeStats(work.employeeId);

  emitEvent("work:updated", work.toJSON());
  return sendSuccess(res, work.toJSON());
});

/** DELETE /api/works/:id */
export const deleteWork = asyncHandler(async (req, res) => {
  const work = await Work.findOneAndDelete(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  if (work.employeeId) await recalcEmployeeStats(work.employeeId);
  return sendSuccess(res, { id: String(work._id), deleted: true });
});

import { Work, WORK_TRANSITIONS } from "../models/Work.js";
import { Lead } from "../models/Lead.js";
import { Client } from "../models/Client.js";
import { Employee } from "../models/Employee.js";
import { Project } from "../models/Project.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { recalcEmployeeStats } from "../services/stats.service.js";
import { notifyEmployee, notifyWork } from "../services/notification.service.js";
import { reassignActiveLeadVisits } from "./visit.controller.js";
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
  const { search, status, priority, employeeId, clientId, upcomingOnly } = query;

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: rx }, { clientName: rx }, { code: rx }, { service: rx }];
  }
  if (status && status !== "All") filter.status = status;
  if (priority && priority !== "All") filter.priority = priority;
  if (clientId) filter.clientId = clientId;
  if (upcomingOnly === "true") {
    filter.deadline = { $gte: new Date() };
    filter.status = { $nin: ["APPROVED", "COMPLETED"] };
  }
  if (employeeId && employeeId !== "All") {
    filter.employeeId = employeeId === "unassigned" ? null : employeeId;
  }
  return filter;
}

function assertEmployeeOwnsWork(user, work) {
  if (user?.role !== "EMPLOYEE") return;
  const employeeId = user.employee?._id ?? user.employee;
  if (!employeeId || String(work.employeeId) !== String(employeeId)) {
    throw ApiError.notFound("Work not found");
  }
}

/** GET /api/works */
export const listWorks = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query, ["updatedAt", "createdAt", "deadline", "priority", "progress"], { updatedAt: -1 });
  const filter = buildFilter(query);
  if (req.user.role === "EMPLOYEE") {
    const employeeId = req.user.employee?._id ?? req.user.employee;
    filter.employeeId = employeeId ?? { $in: [] };
  }

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
export const workStats = asyncHandler(async (req, res) => {
  const employeeId = req.user.role === "EMPLOYEE" ? req.user.employee?._id ?? req.user.employee : null;
  const filter = req.user.role === "EMPLOYEE" ? { employeeId: employeeId ?? { $in: [] } } : {};
  const [grouped, total] = await Promise.all([
    Work.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Work.countDocuments(filter),
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
  assertEmployeeOwnsWork(req.user, work);
  const project = work.projectId
    ? await Project.findById(work.projectId).select("name code").lean()
    : null;
  const result = work.toJSON();
  if (project) {
    result.project = { id: String(project._id), name: project.name, code: project.code };
  }
  if (req.user?.role === "EMPLOYEE") {
    const hideAttachmentUrls = (attachments = []) => attachments.map((attachment) => {
      const metadata = { ...attachment };
      delete metadata.url;
      return metadata;
    });
    result.attachments = hideAttachmentUrls(result.attachments);
    if (result.employeeReport) {
      result.employeeReport.files = hideAttachmentUrls(result.employeeReport.files);
      result.employeeReport.screenshots = hideAttachmentUrls(result.employeeReport.screenshots);
    }
    result.revisionHistory = result.revisionHistory.map((revision) => {
      const history = { ...revision };
      delete history.requestedBy;
      return history;
    });
  }
  return sendSuccess(res, result);
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

  // Keep the originating lead assignment in sync without changing its sales status.
  let linkedLeadAssignment = null;
  if (leadId) {
    const lead = await Lead.findById(leadId);
    if (lead) {
      if (employee) {
        const previousEmployeeId = lead.assignedEmployeeId;
        if (String(previousEmployeeId ?? "") !== String(employee._id)) {
          lead.assignedEmployeeId = employee._id;
          lead.assignedDate = new Date();
          linkedLeadAssignment = { code: lead.code, previousEmployeeId, lead };
        }
      }
      lead.log("Work created from lead", actor);
      await lead.save();
    }
  }

  if (employee) {
    await recalcEmployeeStats(employee._id);
    await notifyEmployee(employee._id, {
      title: "New task assigned to you",
      description: work.title,
      href: `/employee/tasks/${work.code}`,
    });
    if (linkedLeadAssignment) {
      await reassignActiveLeadVisits(linkedLeadAssignment.lead, employee, req.user);
      await notifyEmployee(employee._id, {
        title: linkedLeadAssignment.previousEmployeeId ? "Lead reassigned to you" : "New lead assigned to you",
        description: `${work.title}: lead assignment updated.`,
        href: `/employee/leads/${linkedLeadAssignment.code}`,
      });
      if (linkedLeadAssignment.previousEmployeeId) {
        await notifyEmployee(linkedLeadAssignment.previousEmployeeId, {
          title: "Lead reassigned",
          description: `The lead linked to ${work.title} was reassigned.`,
        });
      }
    }
  }
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
  const assignmentChanged = String(previousEmployeeId ?? "") !== String(employee._id);
  if (!assignmentChanged) return sendSuccess(res, work.toJSON());

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

  await Promise.all([
    notifyWork("Work assigned", `${work.title} assigned to ${employee.name}`, `/master-admin/work/${work.code}`),
    notifyEmployee(employee._id, {
      title: previousEmployeeId ? "Task reassigned to you" : "New task assigned to you",
      description: work.title,
      href: `/employee/tasks/${work.code}`,
    }),
    previousEmployeeId
      ? notifyEmployee(previousEmployeeId, {
          title: "Task reassigned",
          description: `${work.code} was reassigned to ${employee.name}.`,
        })
      : null,
  ]);
  emitEvent("work:updated", work.toJSON(), `user:${employee._id}`);

  return sendSuccess(res, work.toJSON());
});

/** PATCH /api/works/:id/progress */
export const updateProgress = asyncHandler(async (req, res) => {
  if (req.user?.role !== "EMPLOYEE") throw ApiError.forbidden("Only employees can update work progress");
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  assertEmployeeOwnsWork(req.user, work);

  if (!["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(work.status)) {
    throw ApiError.conflict("Progress cannot be changed while work is under review or complete");
  }

  const previousBlockedReason = work.blockedReason;
  const isStarting = work.status !== "IN_PROGRESS" && (
    req.body.start || (
      ["ASSIGNED", "CHANGES_REQUESTED"].includes(work.status) &&
      req.body.progress !== undefined &&
      req.body.progress > 0
    )
  );
  if (isStarting) {
    if (work.status !== "IN_PROGRESS") assertTransition(work, "IN_PROGRESS");
    work.status = "IN_PROGRESS";
  }
  if (req.body.progress !== undefined) work.progress = req.body.progress;
  if (req.body.progressNote !== undefined) work.progressNote = req.body.progressNote;
  if (req.body.blockedReason !== undefined) work.blockedReason = req.body.blockedReason;

  const actor = req.user?.name ?? "Employee";
  const details = [
    req.body.progress !== undefined ? `Progress: ${req.body.progress}%` : "",
    req.body.progressNote || "",
    req.body.blockedReason ? `Blocked: ${req.body.blockedReason}` : "",
    previousBlockedReason && req.body.blockedReason === "" ? "Block cleared" : "",
  ].filter(Boolean);
  work.log(isStarting ? "Work Started" : "Progress Updated", actor, details.join(" · "));
  await work.save();

  if (work.employeeId) await recalcEmployeeStats(work.employeeId);
  return sendSuccess(res, work.toJSON());
});

/** POST /api/works/:id/submit — employee hands work back for review. */
export const submitWork = asyncHandler(async (req, res) => {
  if (req.user?.role !== "EMPLOYEE") throw ApiError.forbidden("Only employees can submit work for review");
  const work = await Work.findOne(byIdOrCode(req.params.id));
  if (!work) throw ApiError.notFound("Work not found");
  assertEmployeeOwnsWork(req.user, work);
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
  work.blockedReason = "";
  work.log("Submitted for Review", actor, req.body.summary);
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

  if (work.employeeId) await recalcEmployeeStats(work.employeeId);

  await Promise.all([
    notifyWork("Work approved", `${work.title} was approved`, `/master-admin/work/${work.code}`),
    work.employeeId
      ? notifyEmployee(work.employeeId, {
          title: "Work approved",
          description: `${work.title} was approved and is awaiting Admin completion.`,
          href: `/employee/tasks/${work.code}`,
        })
      : null,
  ]);
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

  if (work.employeeId) await recalcEmployeeStats(work.employeeId);

  await Promise.all([
    notifyWork("Revision requested", `${work.title}: ${notes.slice(0, 90)}`, `/master-admin/work/${work.code}`),
    work.employeeId
      ? notifyEmployee(work.employeeId, {
          title: "Changes requested",
          description: `${work.title}: ${notes.slice(0, 300)}`,
          href: `/employee/tasks/${work.code}`,
        })
      : null,
  ]);
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

  if (work.employeeId) await recalcEmployeeStats(work.employeeId);
  if (work.employeeId) {
    await notifyEmployee(work.employeeId, {
      title: "Work completed",
      description: `${work.title} has been marked complete by Admin.`,
      href: `/employee/tasks/${work.code}`,
    });
  }

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

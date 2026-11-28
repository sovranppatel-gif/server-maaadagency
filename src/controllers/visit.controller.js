import mongoose from "mongoose";
import { Lead } from "../models/Lead.js";
import { LeadVisit } from "../models/LeadVisit.js";
import { Employee } from "../models/Employee.js";
import { VISIT_TRANSITIONS } from "../models/common.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendCreated, sendSuccess } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { notifyEmployee, notifyEmployeeOnce, notifyOnce, notifyWork } from "../services/notification.service.js";
import { emitEvent } from "../config/socket.js";

const ACTIVE_VISIT_STATUSES = ["SCHEDULED", "RESCHEDULED"];
const APPROACHING_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAST_GRACE_MS = 5 * 60 * 1000;

const isAdmin = (user) => user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";
const employeeIdOf = (user) => user?.employee?._id ?? user?.employee;

function istDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  const todayStart = new Date(`${value.year}-${value.month}-${value.day}T00:00:00.000+05:30`);
  return { todayStart, tomorrowStart: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) };
}

function parseDateFilter(raw, endOfDay = false) {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`
    : trimmed;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiError.badRequest(`Invalid date parameter: ${raw}`);
  }
  return parsed;
}

function formatIstDateTime(date) {
  return new Date(date).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

function assertPastAllowance(scheduledStart) {
  if (Number.isNaN(scheduledStart.getTime()) || scheduledStart.getTime() < Date.now() - PAST_GRACE_MS) {
    throw ApiError.badRequest("Visit date and time cannot be in the past");
  }
}

function assertTransition(currentStatus, nextStatus) {
  const allowed = VISIT_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.conflict(`Cannot transition visit from ${currentStatus} to ${nextStatus}`);
  }
}

function serializeVisit(doc) {
  const data = typeof doc.toJSON === "function" ? doc.toJSON() : { ...doc, id: String(doc._id) };
  delete data._id;
  delete data.__v;
  delete data.createdBy;
  delete data.idempotencyKey;

  if (data.leadId && typeof data.leadId === "object" && data.leadId._id) {
    const lead = data.leadId;
    data.lead = {
      id: String(lead._id),
      code: lead.code,
      clientName: lead.clientName,
      contactPersonName: lead.contactPersonName,
      phone: lead.phone,
      service: lead.service,
      requirement: lead.requirement,
      status: lead.status,
      quality: lead.quality,
      assignedEmployeeId: lead.assignedEmployeeId ? String(lead.assignedEmployeeId) : undefined,
    };
    data.leadId = String(lead._id);
  } else if (data.leadId) {
    data.leadId = String(data.leadId);
  }

  if (data.assignedEmployeeId && typeof data.assignedEmployeeId === "object" && data.assignedEmployeeId._id) {
    const emp = data.assignedEmployeeId;
    data.assignedEmployee = {
      id: String(emp._id),
      code: emp.code,
      name: emp.name,
      avatarColor: emp.avatarColor,
    };
    data.assignedEmployeeId = String(emp._id);
  } else if (data.assignedEmployeeId) {
    data.assignedEmployeeId = String(data.assignedEmployeeId);
  }

  if (Array.isArray(data.history)) {
    data.history = data.history.map(({ actorId: _actorId, ...entry }) => entry);
  }
  return data;
}

async function resolveVisitAccess(visitIdOrCode, user) {
  const visit = await LeadVisit.findOne(byIdOrCode(visitIdOrCode));
  if (!visit) throw ApiError.notFound("Visit not found");

  const lead = await Lead.findById(visit.leadId).select("code clientName contactPersonName phone service requirement status quality assignedEmployeeId");
  if (!lead) throw ApiError.notFound("Lead not found");

  if (!isAdmin(user)) {
    const employeeId = employeeIdOf(user);
    if (!employeeId || !user.employee?.isActive) {
      throw ApiError.forbidden("An active employee account is required");
    }
    if (String(lead.assignedEmployeeId ?? "") !== String(employeeId)) {
      throw ApiError.notFound("Visit not found");
    }
  }
  return { visit, lead };
}

async function syncVisitReminders(visits, user) {
  const now = new Date();
  const approachingCutoff = new Date(now.getTime() + APPROACHING_WINDOW_MS);
  const employeeId = !isAdmin(user) ? employeeIdOf(user) : null;

  const jobs = [];
  for (const visit of visits) {
    if (!ACTIVE_VISIT_STATUSES.includes(visit.status)) continue;
    const start = new Date(visit.scheduledStart);
    const scheduleKey = start.toISOString();
    const visitCode = visit.code || visit.id;
    const clientLabel = visit.lead?.clientName ?? "Customer";
    const targetEmpId = employeeId ?? visit.assignedEmployeeId;

    if (start < now) {
      if (targetEmpId) {
        jobs.push(
          notifyEmployeeOnce(
            targetEmpId,
            `visit-overdue:${visit.id}:${scheduleKey}:${targetEmpId}`,
            {
              title: "Customer visit overdue",
              description: `${visitCode} (${clientLabel}) was scheduled for ${formatIstDateTime(start)}.`,
              href: `/employee/visits`,
            }
          )
        );
      }
      if (isAdmin(user)) {
        jobs.push(
          notifyOnce(`visit-overdue:${visit.id}:${scheduleKey}:admin`, {
            title: "Customer visit overdue",
            description: `${visitCode} (${clientLabel}) was scheduled for ${formatIstDateTime(start)}.`,
            category: "Work",
            href: `/master-admin/visits`,
          })
        );
      }
    } else if (start <= approachingCutoff && targetEmpId) {
      jobs.push(
        notifyEmployeeOnce(
          targetEmpId,
          `visit-approaching:${visit.id}:${scheduleKey}:${targetEmpId}`,
          {
            title: "Upcoming customer visit",
            description: `${visitCode} (${clientLabel}) is scheduled for ${formatIstDateTime(start)}.`,
            href: `/employee/visits`,
          }
        )
      );
    }
  }
  await Promise.all(jobs);
}

async function buildVisitFilter(query, user) {
  const filter = {};
  const now = new Date();
  const { todayStart, tomorrowStart } = istDayBounds(now);

  if (query.status && query.status !== "All") filter.status = query.status;
  if (query.visitType && query.visitType !== "All") filter.visitType = query.visitType;

  if (query.leadId) {
    const lead = await Lead.findOne(byIdOrCode(query.leadId)).select("_id").lean();
    if (!lead) return null;
    filter.leadId = lead._id;
  }

  if (query.bucket && query.bucket !== "All") {
    if (query.bucket === "upcoming") {
      filter.status = { $in: ACTIVE_VISIT_STATUSES };
      filter.scheduledStart = { $gte: now };
    } else if (query.bucket === "today") {
      filter.status = { $in: ACTIVE_VISIT_STATUSES };
      filter.scheduledStart = { $gte: todayStart, $lt: tomorrowStart };
    } else if (query.bucket === "overdue") {
      filter.status = { $in: ACTIVE_VISIT_STATUSES };
      filter.scheduledStart = { $lt: now };
    } else if (query.bucket === "completed") {
      filter.status = "COMPLETED";
    } else if (query.bucket === "cancelled") {
      filter.status = "CANCELLED";
    }
  }

  const from = parseDateFilter(query.from, false);
  const to = parseDateFilter(query.to, true);
  if (from || to) {
    filter.scheduledStart = {
      ...(typeof filter.scheduledStart === "object" ? filter.scheduledStart : {}),
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }

  if (!isAdmin(user)) {
    const employeeId = employeeIdOf(user);
    if (!employeeId) return null;
    const ownedLeadIds = await Lead.distinct("_id", { assignedEmployeeId: employeeId });
    filter.leadId = filter.leadId
      ? (ownedLeadIds.some((id) => String(id) === String(filter.leadId)) ? filter.leadId : { $in: [] })
      : { $in: ownedLeadIds };
  } else if (query.employeeId && query.employeeId !== "All") {
    filter.assignedEmployeeId = query.employeeId === "unassigned" ? null : query.employeeId;
  }

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    const matchingLeads = await Lead.distinct("_id", {
      $or: [{ clientName: rx }, { contactPersonName: rx }, { phone: rx }, { code: rx }],
    });
    filter.$or = [
      { code: rx },
      { title: rx },
      { locationAddress: rx },
      { customerContactPerson: rx },
      ...(matchingLeads.length ? [{ leadId: { $in: matchingLeads } }] : []),
    ];
  }

  return filter;
}

/** GET /api/visits */
export const listVisits = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const sort = getSort(query, ["scheduledStart", "createdAt", "updatedAt", "status"], { scheduledStart: 1 });

  const filter = await buildVisitFilter(query, req.user);
  if (filter === null) {
    return sendSuccess(res, [], { meta: buildMeta({ page, limit, total: 0 }) });
  }

  const [rows, total] = await Promise.all([
    LeadVisit.find(filter)
      .select("-createdBy -idempotencyKey")
      .populate("leadId", "code clientName contactPersonName phone service requirement status quality assignedEmployeeId")
      .populate("assignedEmployeeId", "code name avatarColor")
      .sort(sort)
      .skip(skip)
      .limit(limit),
    LeadVisit.countDocuments(filter),
  ]);

  const items = rows.map(serializeVisit);
  await syncVisitReminders(items, req.user);

  return sendSuccess(res, items, { meta: buildMeta({ page, limit, total }) });
});

/** GET /api/visits/stats */
export const visitStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const { todayStart, tomorrowStart } = istDayBounds(now);
  let match = {};

  if (!isAdmin(req.user)) {
    const employeeId = employeeIdOf(req.user);
    if (!employeeId) throw ApiError.forbidden("No employee profile is linked to this account");
    const ownedLeadIds = await Lead.distinct("_id", { assignedEmployeeId: employeeId });
    match = { leadId: { $in: ownedLeadIds } };
  }

  const [agg] = await LeadVisit.aggregate([
    { $match: match },
    {
      $facet: {
        total: [{ $count: "count" }],
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        upcoming: [
          { $match: { status: { $in: ACTIVE_VISIT_STATUSES }, scheduledStart: { $gte: now } } },
          { $count: "count" },
        ],
        today: [
          { $match: { status: { $in: ACTIVE_VISIT_STATUSES }, scheduledStart: { $gte: todayStart, $lt: tomorrowStart } } },
          { $count: "count" },
        ],
        overdue: [
          { $match: { status: { $in: ACTIVE_VISIT_STATUSES }, scheduledStart: { $lt: now } } },
          { $count: "count" },
        ],
      },
    },
  ]);

  const byStatus = Object.fromEntries((agg?.byStatus ?? []).map((row) => [row._id, row.count]));
  return sendSuccess(res, {
    total: agg?.total?.[0]?.count ?? 0,
    scheduled: byStatus.SCHEDULED ?? 0,
    rescheduled: byStatus.RESCHEDULED ?? 0,
    completed: byStatus.COMPLETED ?? 0,
    cancelled: byStatus.CANCELLED ?? 0,
    upcoming: agg?.upcoming?.[0]?.count ?? 0,
    today: agg?.today?.[0]?.count ?? 0,
    overdue: agg?.overdue?.[0]?.count ?? 0,
  });
});

/** GET /api/visits/report (Admin only) */
export const visitReport = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw ApiError.forbidden();
  const query = q(req);
  const now = new Date();
  const match = {};

  const from = parseDateFilter(query.from, false);
  const to = parseDateFilter(query.to, true);
  if (from || to) {
    match.scheduledStart = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }
  if (query.employeeId && query.employeeId !== "All") {
    match.assignedEmployeeId = new mongoose.Types.ObjectId(String(query.employeeId));
  }

  const [summaryAgg, byEmployee, byDate, byOutcome, byType] = await Promise.all([
    LeadVisit.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          scheduled: { $sum: { $cond: [{ $eq: ["$status", "SCHEDULED"] }, 1, 0] } },
          rescheduled: { $sum: { $cond: [{ $eq: ["$status", "RESCHEDULED"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$status", ACTIVE_VISIT_STATUSES] }, { $lt: ["$scheduledStart", now] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    LeadVisit.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$assignedEmployeeId",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          upcoming: {
            $sum: {
              $cond: [
                { $and: [{ $in: ["$status", ACTIVE_VISIT_STATUSES] }, { $gte: ["$scheduledStart", now] }] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $lookup: { from: Employee.collection.name, localField: "_id", foreignField: "_id", as: "employee" } },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          employeeId: "$_id",
          name: "$employee.name",
          code: "$employee.code",
          total: 1,
          completed: 1,
          cancelled: 1,
          upcoming: 1,
        },
      },
      { $sort: { total: -1, name: 1 } },
    ]),
    LeadVisit.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$scheduledStart", timezone: "Asia/Kolkata" } },
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 30 },
      { $project: { _id: 0, date: "$_id", total: 1, completed: 1, cancelled: 1 } },
    ]),
    LeadVisit.aggregate([
      { $match: { ...match, status: "COMPLETED", outcome: { $ne: null } } },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
    ]),
    LeadVisit.aggregate([
      { $match: match },
      { $group: { _id: "$visitType", count: { $sum: 1 } } },
    ]),
  ]);

  const summary = summaryAgg[0] ?? { total: 0, scheduled: 0, rescheduled: 0, completed: 0, cancelled: 0, overdue: 0 };
  const completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return sendSuccess(res, {
    totals: {
      ...summary,
      _id: undefined,
      completionRate,
    },
    byEmployee,
    byDate,
    byOutcome: Object.fromEntries(byOutcome.map((item) => [item._id, item.count])),
    byType: Object.fromEntries(byType.map((item) => [item._id, item.count])),
  });
});

/** GET /api/visits/:id */
export const getVisit = asyncHandler(async (req, res) => {
  const { visit } = await resolveVisitAccess(req.params.id, req.user);
  await visit.populate([
    { path: "leadId", select: "code clientName contactPersonName phone service requirement status quality assignedEmployeeId" },
    { path: "assignedEmployeeId", select: "code name avatarColor" },
  ]);
  return sendSuccess(res, serializeVisit(visit));
});

/** GET /api/leads/:leadId/visits */
export const listLeadVisits = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.leadId));
  if (!lead) throw ApiError.notFound("Lead not found");
  if (!isAdmin(req.user)) {
    const employeeId = employeeIdOf(req.user);
    if (!employeeId || !req.user.employee?.isActive || String(lead.assignedEmployeeId ?? "") !== String(employeeId)) {
      throw ApiError.notFound("Lead not found");
    }
  }

  const { page, limit, skip } = getPagination(q(req), { defaultLimit: 50, maxLimit: 100 });
  const [rows, total] = await Promise.all([
    LeadVisit.find({ leadId: lead._id })
      .select("-createdBy -idempotencyKey")
      .populate("assignedEmployeeId", "code name avatarColor")
      .sort({ scheduledStart: -1 })
      .skip(skip)
      .limit(limit),
    LeadVisit.countDocuments({ leadId: lead._id }),
  ]);

  return sendSuccess(res, rows.map(serializeVisit), { meta: buildMeta({ page, limit, total }) });
});

/** POST /api/leads/:leadId/visits */
export const createLeadVisit = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne(byIdOrCode(req.params.leadId));
  if (!lead) throw ApiError.notFound("Lead not found");

  let assignedEmployeeId = lead.assignedEmployeeId ?? undefined;
  if (!isAdmin(req.user)) {
    const employeeId = employeeIdOf(req.user);
    if (!employeeId || !req.user.employee?.isActive) {
      throw ApiError.forbidden("An active employee account is required");
    }
    if (String(lead.assignedEmployeeId ?? "") !== String(employeeId)) {
      throw ApiError.notFound("Lead not found");
    }
    assignedEmployeeId = employeeId;
  } else if (req.body.assignedEmployeeId) {
    const employee = await Employee.findById(req.body.assignedEmployeeId).select("isActive");
    if (!employee || !employee.isActive) {
      throw ApiError.badRequest("Assigned employee was not found or is deactivated");
    }
    assignedEmployeeId = employee._id;
  }

  const idempotencyKey = req.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw ApiError.badRequest("A valid Idempotency-Key header is required");
  }
  const existing = await LeadVisit.findOne({ leadId: lead._id, idempotencyKey }).select("+idempotencyKey");
  if (existing) {
    await existing.populate([
      { path: "leadId", select: "code clientName contactPersonName phone service requirement status quality assignedEmployeeId" },
      { path: "assignedEmployeeId", select: "code name avatarColor" },
    ]);
    return sendSuccess(res, serializeVisit(existing));
  }

  const scheduledStart = new Date(req.body.scheduledStart);
  assertPastAllowance(scheduledStart);
  const scheduledEnd = req.body.scheduledEnd ? new Date(req.body.scheduledEnd) : undefined;

  const actorName = req.user?.name ?? (isAdmin(req.user) ? "Admin" : "Employee");
  let visit;
  try {
    visit = await LeadVisit.create({
      leadId: lead._id,
      assignedEmployeeId,
      createdBy: req.user._id,
      visitType: req.body.visitType,
      title: req.body.title,
      scheduledStart,
      scheduledEnd,
      timezone: req.body.timezone ?? "Asia/Kolkata",
      locationType: req.body.locationType,
      locationAddress: req.body.locationAddress ?? "",
      meetingLink: req.body.meetingLink ?? "",
      customerContactPerson: req.body.customerContactPerson || lead.contactPersonName || undefined,
      notes: req.body.notes ?? "",
      status: "SCHEDULED",
      idempotencyKey,
      history: [
        {
          eventType: "SCHEDULED",
          previousStatus: null,
          newStatus: "SCHEDULED",
          newSchedule: { start: scheduledStart, end: scheduledEnd },
          actorId: req.user._id,
          actorName,
          actorRole: req.user.role,
          note: req.body.notes || undefined,
          timestamp: new Date(),
        },
      ],
    });
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.idempotencyKey) {
      const duplicate = await LeadVisit.findOne({ leadId: lead._id, idempotencyKey }).select("+idempotencyKey");
      if (duplicate) return sendSuccess(res, serializeVisit(duplicate));
    }
    throw err;
  }

  await visit.populate([
    { path: "leadId", select: "code clientName contactPersonName phone service requirement status quality assignedEmployeeId" },
    { path: "assignedEmployeeId", select: "code name avatarColor" },
  ]);

  const scheduleText = formatIstDateTime(scheduledStart);
  const notifications = [
    notifyWork("Customer visit scheduled", `${visit.code} · ${lead.clientName} on ${scheduleText}`, "/master-admin/visits"),
  ];
  if (assignedEmployeeId) {
    notifications.push(
      notifyEmployee(assignedEmployeeId, {
        title: "Customer visit scheduled",
        description: `${visit.code} · ${lead.clientName} on ${scheduleText}`,
        href: "/employee/visits",
      })
    );
  }
  await Promise.all(notifications);
  emitEvent("visit:new", serializeVisit(visit));

  return sendCreated(res, serializeVisit(visit));
});

/** PATCH /api/visits/:id/reschedule */
export const rescheduleVisit = asyncHandler(async (req, res) => {
  const { visit, lead } = await resolveVisitAccess(req.params.id, req.user);
  assertTransition(visit.status, "RESCHEDULED");

  const nextStart = new Date(req.body.scheduledStart);
  assertPastAllowance(nextStart);
  const nextEnd = req.body.scheduledEnd ? new Date(req.body.scheduledEnd) : undefined;

  const actorName = req.user?.name ?? (isAdmin(req.user) ? "Admin" : "Employee");
  const updateSet = {
    status: "RESCHEDULED",
    scheduledStart: nextStart,
    scheduledEnd: nextEnd ?? null,
  };
  if (req.body.locationType !== undefined) updateSet.locationType = req.body.locationType;
  if (req.body.locationAddress !== undefined) updateSet.locationAddress = req.body.locationAddress;
  if (req.body.meetingLink !== undefined) updateSet.meetingLink = req.body.meetingLink;

  const updated = await LeadVisit.findOneAndUpdate(
    { _id: visit._id, status: { $in: ACTIVE_VISIT_STATUSES } },
    {
      $set: updateSet,
      $push: {
        history: {
          eventType: "RESCHEDULED",
          previousStatus: visit.status,
          newStatus: "RESCHEDULED",
          previousSchedule: { start: visit.scheduledStart, end: visit.scheduledEnd },
          newSchedule: { start: nextStart, end: nextEnd },
          actorId: req.user._id,
          actorName,
          actorRole: req.user.role,
          note: req.body.reason,
          timestamp: new Date(),
        },
      },
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.conflict("Visit is no longer active and cannot be rescheduled");

  await updated.populate([
    { path: "leadId", select: "code clientName contactPersonName phone service requirement status quality assignedEmployeeId" },
    { path: "assignedEmployeeId", select: "code name avatarColor" },
  ]);

  const scheduleText = formatIstDateTime(nextStart);
  await Promise.all([
    notifyWork("Customer visit rescheduled", `${updated.code} · ${lead.clientName} moved to ${scheduleText}`, "/master-admin/visits"),
    updated.assignedEmployeeId
      ? notifyEmployee(updated.assignedEmployeeId._id ?? updated.assignedEmployeeId, {
          title: "Customer visit rescheduled",
          description: `${updated.code} · ${lead.clientName} moved to ${scheduleText}`,
          href: "/employee/visits",
        })
      : null,
  ]);
  emitEvent("visit:updated", serializeVisit(updated));

  return sendSuccess(res, serializeVisit(updated));
});

/** PATCH /api/visits/:id/complete */
export const completeVisit = asyncHandler(async (req, res) => {
  const { visit } = await resolveVisitAccess(req.params.id, req.user);
  assertTransition(visit.status, "COMPLETED");

  const now = new Date();
  const actorName = req.user?.name ?? (isAdmin(req.user) ? "Admin" : "Employee");
  const updated = await LeadVisit.findOneAndUpdate(
    { _id: visit._id, status: { $in: ACTIVE_VISIT_STATUSES } },
    {
      $set: {
        status: "COMPLETED",
        outcome: req.body.outcome,
        customerResponse: req.body.customerResponse ?? "",
        notes: req.body.notes ?? visit.notes,
        completedAt: now,
      },
      $push: {
        history: {
          eventType: "COMPLETED",
          previousStatus: visit.status,
          newStatus: "COMPLETED",
          actorId: req.user._id,
          actorName,
          actorRole: req.user.role,
          note: req.body.notes || req.body.customerResponse || req.body.outcome,
          timestamp: now,
        },
      },
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.conflict("Visit has already been completed or cancelled");

  await updated.populate([
    { path: "leadId", select: "code clientName contactPersonName phone service requirement status quality assignedEmployeeId" },
    { path: "assignedEmployeeId", select: "code name avatarColor" },
  ]);
  emitEvent("visit:updated", serializeVisit(updated));

  return sendSuccess(res, serializeVisit(updated));
});

/** PATCH /api/visits/:id/cancel */
export const cancelVisit = asyncHandler(async (req, res) => {
  const { visit, lead } = await resolveVisitAccess(req.params.id, req.user);
  assertTransition(visit.status, "CANCELLED");

  const now = new Date();
  const actorName = req.user?.name ?? (isAdmin(req.user) ? "Admin" : "Employee");
  const updated = await LeadVisit.findOneAndUpdate(
    { _id: visit._id, status: { $in: ACTIVE_VISIT_STATUSES } },
    {
      $set: {
        status: "CANCELLED",
        cancellationReason: req.body.cancellationReason,
        cancelledAt: now,
      },
      $push: {
        history: {
          eventType: "CANCELLED",
          previousStatus: visit.status,
          newStatus: "CANCELLED",
          actorId: req.user._id,
          actorName,
          actorRole: req.user.role,
          note: req.body.cancellationReason,
          timestamp: now,
        },
      },
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.conflict("Visit has already been completed or cancelled");

  await updated.populate([
    { path: "leadId", select: "code clientName contactPersonName phone service requirement status quality assignedEmployeeId" },
    { path: "assignedEmployeeId", select: "code name avatarColor" },
  ]);

  await Promise.all([
    notifyWork("Customer visit cancelled", `${updated.code} · ${lead.clientName}: ${req.body.cancellationReason}`, "/master-admin/visits"),
    updated.assignedEmployeeId
      ? notifyEmployee(updated.assignedEmployeeId._id ?? updated.assignedEmployeeId, {
          title: "Customer visit cancelled",
          description: `${updated.code} · ${lead.clientName}: ${req.body.cancellationReason}`,
          href: "/employee/visits",
        })
      : null,
  ]);
  emitEvent("visit:updated", serializeVisit(updated));

  return sendSuccess(res, serializeVisit(updated));
});

/**
 * Transfers pending active visits (SCHEDULED / RESCHEDULED) to the new Lead
 * assignee so visit ownership stays consistent with the parent Lead while
 * keeping historical actor attribution intact.
 */
export async function reassignActiveLeadVisits(lead, employee, actorUser) {
  const actorName = actorUser?.name ?? "Admin";
  const actorRole = actorUser?.role ?? "ADMIN";
  const now = new Date();
  const result = await LeadVisit.updateMany(
    {
      leadId: lead._id,
      status: { $in: ACTIVE_VISIT_STATUSES },
      assignedEmployeeId: { $ne: employee._id },
    },
    {
      $set: { assignedEmployeeId: employee._id },
      $push: {
        history: {
          eventType: "REASSIGNED",
          actorId: actorUser?._id,
          actorName,
          actorRole,
          note: `Reassigned to ${employee.name} with lead ownership`,
          timestamp: now,
        },
      },
    }
  );
  if ((result?.modifiedCount ?? 0) > 0) {
    await notifyEmployee(employee._id, {
      title: "Customer visits reassigned to you",
      description: `${result.modifiedCount} active visit(s) for ${lead.clientName} are now assigned to you.`,
      href: "/employee/visits",
    });
  }
  return result?.modifiedCount ?? 0;
}

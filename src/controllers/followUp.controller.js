import mongoose from "mongoose";
import { Lead } from "../models/Lead.js";
import { LeadFollowUp } from "../models/LeadFollowUp.js";
import { Employee } from "../models/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendCreated, sendSuccess } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, getPagination } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { notifyEmployee, notifyEmployeeOnce, notifyOnce } from "../services/notification.service.js";
import { normaliseCallResponse } from "../utils/crmMappings.js";

const isAdmin = (user) => user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";
const employeeIdOf = (user) => user?.employee?._id ?? user?.employee;

function serializeFollowUp(doc, includeEmployee) {
  const data = doc.toJSON();
  delete data.idempotencyKey;
  delete data.submittedBy;
  if (!includeEmployee) delete data.employeeId;
  return data;
}

function businessDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  const start = new Date(`${value.year}-${value.month}-${value.day}T00:00:00+05:30`);
  return { tomorrow: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function scheduleMatch(bucket, bounds, now) {
  if (bucket === "upcoming") return { nextFollowUpAt: { $gte: bounds.tomorrow } };
  if (bucket === "today") return { nextFollowUpAt: { $gte: now, $lt: bounds.tomorrow } };
  if (bucket === "overdue") return { nextFollowUpAt: { $lt: now } };
  return { nextFollowUpAt: { $type: "date" } };
}

function latestSchedulePipeline({ employeeId, bucket = "All", callResponse = "All", includeReviewRequired = false, skip, limit } = {}) {
  const now = new Date();
  const bounds = businessDayBounds();
  const leadMatch = { "lead.followUpsClosed": { $ne: true } };
  if (employeeId) {
    leadMatch["lead.assignedEmployeeId"] = new mongoose.Types.ObjectId(String(employeeId));
    if (!includeReviewRequired) leadMatch["lead.followUpReviewRequired"] = { $ne: true };
  }
  const followUpMatch = scheduleMatch(bucket, bounds, now);
  if (callResponse && callResponse !== "All") {
    followUpMatch.callResponse = callResponse;
  }

  const pipeline = [
    { $sort: { leadId: 1, attemptNumber: -1 } },
    { $group: { _id: "$leadId", followUp: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$followUp" } },
    { $match: followUpMatch },
    { $lookup: { from: Lead.collection.name, localField: "leadId", foreignField: "_id", as: "lead" } },
    { $unwind: "$lead" },
    { $match: leadMatch },
    { $sort: { nextFollowUpAt: 1, _id: 1 } },
  ];

  if (skip !== undefined && limit !== undefined) {
    pipeline.push({
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: Employee.collection.name,
              localField: "employeeId",
              foreignField: "_id",
              as: "employee",
            },
          },
          { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              leadId: 1,
              attemptNumber: 1,
              communicationType: 1,
              callResponse: 1,
              callResponseRaw: 1,
              contactedAt: 1,
              customerResponse: 1,
              discussionNotes: 1,
              nextFollowUpAt: 1,
              interestLevel: 1,
              quotationRequired: 1,
              employeeRemarks: 1,
              createdAt: 1,
              lead: {
                id: "$lead._id",
                code: "$lead.code",
                clientName: "$lead.clientName",
                requirement: "$lead.requirement",
                followUpReviewRequired: "$lead.followUpReviewRequired",
              },
              employee: {
                id: "$employee._id",
                name: "$employee.name",
                code: "$employee.code",
              },
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });
  }
  return pipeline;
}

function followUpListItem(doc, showEmployee) {
  const item = {
    id: String(doc._id),
    leadId: String(doc.leadId),
    attemptNumber: doc.attemptNumber,
    communicationType: doc.communicationType,
    callResponse: doc.callResponse,
    callResponseRaw: doc.callResponseRaw,
    contactedAt: doc.contactedAt,
    customerResponse: doc.customerResponse,
    discussionNotes: doc.discussionNotes,
    nextFollowUpAt: doc.nextFollowUpAt,
    interestLevel: doc.interestLevel,
    quotationRequired: doc.quotationRequired,
    employeeRemarks: doc.employeeRemarks,
    createdAt: doc.createdAt,
    lead: doc.lead
      ? {
          id: String(doc.lead.id),
          code: doc.lead.code,
          clientName: doc.lead.clientName,
          requirement: doc.lead.requirement,
          followUpReviewRequired: doc.lead.followUpReviewRequired,
        }
      : undefined,
  };
  if (showEmployee && doc.employee?.id) {
    item.employee = { id: String(doc.employee.id), name: doc.employee.name, code: doc.employee.code };
  }
  return item;
}

function employeeOwnsLead(user, lead) {
  const employeeId = employeeIdOf(user);
  return Boolean(employeeId && String(lead.assignedEmployeeId) === String(employeeId));
}

async function findLead(id) {
  const lead = await Lead.findOne(byIdOrCode(id));
  if (!lead) throw ApiError.notFound("Lead not found");
  return lead;
}

async function notifyDueItems(items, employeeId) {
  const dueItems = items.filter((item) => item.nextFollowUpAt && new Date(item.nextFollowUpAt) <= new Date());
  await Promise.all(dueItems.map((item) => notifyEmployeeOnce(
    employeeId,
    `follow-up-due:${item.leadId}:${item.attemptNumber}:${employeeId}`,
    {
      title: "Follow-up due",
      description: `${item.lead?.clientName ?? "Assigned lead"} · attempt ${item.attemptNumber} is scheduled.`,
      href: item.lead?.code ? `/employee/leads/${item.lead.code}` : undefined,
    }
  )));
}

async function ensureReviewNotification(lead, followUp) {
  if (lead.followUpsClosed || followUp.attemptNumber < (lead.followUpLimit ?? 4)) return;
  if (!lead.followUpReviewRequired) {
    lead.followUpReviewRequired = true;
    lead.log("Follow-up review required", "System");
    await lead.save();
  }
  await notifyOnce(`follow-up-review:${lead._id}:${followUp.attemptNumber}`, {
    title: "Lead requires follow-up review",
    description: `${lead.clientName} has reached the authorized follow-up limit.`,
    category: "Work",
    href: `/master-admin/leads/${lead.code}`,
  });
}

/** GET /api/leads/:id/follow-ups */
export const listLeadFollowUps = asyncHandler(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!isAdmin(req.user) && !employeeOwnsLead(req.user, lead)) throw ApiError.notFound("Lead not found");

  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 50, maxLimit: 100 });
  const filter = { leadId: lead._id };
  if (query.callResponse && query.callResponse !== "All") {
    filter.callResponse = query.callResponse;
  }

  const [records, filteredTotal, totalAttempts] = await Promise.all([
    LeadFollowUp.find(filter)
      .select("-idempotencyKey -submittedBy")
      .populate("employeeId", "name code department")
      .sort({ attemptNumber: 1 })
      .skip(skip)
      .limit(limit),
    LeadFollowUp.countDocuments(filter),
    LeadFollowUp.countDocuments({ leadId: lead._id }),
  ]);
  const includeEmployee = isAdmin(req.user);
  const items = records.map((record) => serializeFollowUp(record, includeEmployee));
  for (const item of items) {
    if (includeEmployee && item.employeeId) {
      item.employee = {
        id: String(item.employeeId.id ?? item.employeeId._id),
        name: item.employeeId.name,
        code: item.employeeId.code,
      };
    }
    delete item.employeeId;
  }

  return sendSuccess(res, items, {
    meta: {
      ...buildMeta({ page, limit, total: filteredTotal }),
      attempts: totalAttempts,
      maxAttempts: lead.followUpLimit ?? 4,
      reviewRequired: Boolean(lead.followUpReviewRequired),
      closed: Boolean(lead.followUpsClosed),
      historicalFollowUps: (lead.historicalFollowUps ?? []).map((item) => (typeof item.toJSON === "function" ? item.toJSON() : item)),
    },
  });
});

/** POST /api/leads/:id/follow-ups — attempt number is allocated by the server. */
export const createLeadFollowUp = asyncHandler(async (req, res) => {
  if (req.user?.role !== "EMPLOYEE") throw ApiError.forbidden("Only the assigned employee can submit a follow-up");
  const employeeId = employeeIdOf(req.user);
  if (!employeeId || !req.user.employee?.isActive) throw ApiError.forbidden("An active employee account is required");

  const lead = await findLead(req.params.id);
  if (!employeeOwnsLead(req.user, lead)) throw ApiError.notFound("Lead not found");

  const idempotencyKey = req.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw ApiError.badRequest("A valid Idempotency-Key header is required");
  }
  const existing = await LeadFollowUp.findOne({ leadId: lead._id, idempotencyKey }).select("+idempotencyKey");
  if (existing) {
    await ensureReviewNotification(lead, existing);
    return sendSuccess(res, serializeFollowUp(existing, false));
  }

  if (lead.followUpsClosed) throw ApiError.conflict("Follow-ups are closed for this lead");
  if (lead.followUpReviewRequired) throw ApiError.conflict("The lead is awaiting Admin review before more follow-ups");

  const contactedAt = new Date(req.body.contactedAt);
  if (Number.isNaN(contactedAt.getTime()) || contactedAt.getTime() > Date.now()) {
    throw ApiError.badRequest("Contact date and time cannot be in the future");
  }
  const nextFollowUpAt = req.body.nextFollowUpAt ? new Date(req.body.nextFollowUpAt) : undefined;
  if (nextFollowUpAt && (Number.isNaN(nextFollowUpAt.getTime()) || nextFollowUpAt <= contactedAt)) {
    throw ApiError.badRequest("The next follow-up must be scheduled after the contact date and time");
  }

  const rawCallResponse = req.body.callResponse?.trim();
  const callResponse = rawCallResponse ? normaliseCallResponse(rawCallResponse) : undefined;
  if (rawCallResponse && !callResponse) {
    throw ApiError.badRequest("Invalid call response category");
  }
  const callResponseRaw = rawCallResponse && rawCallResponse !== callResponse ? rawCallResponse : undefined;

  let followUp;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const attemptNumber = await LeadFollowUp.countDocuments({ leadId: lead._id }) + 1;
    if (attemptNumber > (lead.followUpLimit ?? 4)) {
      throw ApiError.conflict("The authorized follow-up attempt limit has been reached");
    }

    try {
      followUp = await LeadFollowUp.create({
        ...req.body,
        callResponse,
        callResponseRaw,
        leadId: lead._id,
        employeeId,
        submittedBy: req.user._id,
        contactedAt,
        nextFollowUpAt,
        attemptNumber,
        idempotencyKey,
      });
      break;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const duplicateRequest = await LeadFollowUp.findOne({ leadId: lead._id, idempotencyKey }).select("+idempotencyKey");
      if (duplicateRequest) {
        await ensureReviewNotification(lead, duplicateRequest);
        return sendSuccess(res, serializeFollowUp(duplicateRequest, false));
      }
      const duplicateAttempt = await LeadFollowUp.exists({ leadId: lead._id, attemptNumber });
      if (!duplicateAttempt || attempt === 4) throw ApiError.conflict("Could not allocate a follow-up attempt; please retry");
    }
  }
  if (!followUp) throw ApiError.conflict("Could not allocate a follow-up attempt; please retry");

  const activityDetail = callResponse ? `[${callResponse}] ${followUp.discussionNotes}` : followUp.discussionNotes;
  lead.log(`Follow-up ${followUp.attemptNumber} recorded`, req.user.name, activityDetail);
  await lead.save();
  await ensureReviewNotification(lead, followUp);

  return sendCreated(res, serializeFollowUp(followUp, false), {
    attempts: followUp.attemptNumber,
    limit: lead.followUpLimit ?? 4,
    reviewRequired: Boolean(lead.followUpReviewRequired),
  });
});

/** GET /api/follow-ups — latest scheduled follow-up for each currently assigned lead. */
export const listFollowUps = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20 });
  const employeeId = req.user?.role === "EMPLOYEE" ? employeeIdOf(req.user) : null;
  const [result] = await LeadFollowUp.aggregate(latestSchedulePipeline({
    employeeId,
    bucket: query.bucket ?? "All",
    callResponse: query.callResponse ?? "All",
    includeReviewRequired: isAdmin(req.user),
    skip,
    limit,
  }));
  const showEmployee = isAdmin(req.user);
  const items = (result?.items ?? []).map((doc) => followUpListItem(doc, showEmployee));
  const total = result?.total?.[0]?.count ?? 0;
  if (employeeId) await notifyDueItems(items, employeeId);

  return sendSuccess(res, items, { meta: buildMeta({ page, limit, total }) });
});

/** GET /api/follow-ups/summary — counters for the signed-in employee. */
export const followUpSummary = asyncHandler(async (req, res) => {
  if (req.user?.role !== "EMPLOYEE") throw ApiError.forbidden();
  const employeeId = employeeIdOf(req.user);
  if (!employeeId) throw ApiError.forbidden("No employee profile is linked to this account");

  const [scheduled, reviewRequired, assignedLeadIds] = await Promise.all([
    LeadFollowUp.aggregate(latestSchedulePipeline({ employeeId })),
    Lead.countDocuments({ assignedEmployeeId: employeeId, followUpReviewRequired: true, followUpsClosed: { $ne: true } }),
    Lead.distinct("_id", { assignedEmployeeId: employeeId }),
  ]);
  const contactedLeadIds = assignedLeadIds.length
    ? await LeadFollowUp.distinct("leadId", { leadId: { $in: assignedLeadIds } })
    : [];
  const counts = { upcoming: 0, dueToday: 0, overdue: 0 };
  const bounds = businessDayBounds();
  const now = new Date();
  for (const item of scheduled) {
    const date = new Date(item.nextFollowUpAt);
    if (date < now) counts.overdue += 1;
    else if (date < bounds.tomorrow) counts.dueToday += 1;
    else counts.upcoming += 1;
  }
  return sendSuccess(res, {
    ...counts,
    reviewRequired,
    withoutFollowUp: Math.max(0, assignedLeadIds.length - contactedLeadIds.length),
  });
});

/** GET /api/follow-ups/report — admin overview. */
export const followUpReport = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) throw ApiError.forbidden();

  const [employeeWise, contactedLeadIds, latestSchedules, interestGroups, callResponseGroups, fourAttemptLeadIds, reviewRequired] = await Promise.all([
    LeadFollowUp.aggregate([
      { $group: { _id: "$employeeId", followUps: { $sum: 1 } } },
      { $lookup: { from: Employee.collection.name, localField: "_id", foreignField: "_id", as: "employee" } },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, employeeId: "$_id", name: "$employee.name", code: "$employee.code", followUps: 1 } },
      { $sort: { followUps: -1, name: 1 } },
    ]),
    LeadFollowUp.distinct("leadId"),
    LeadFollowUp.aggregate(latestSchedulePipeline({ includeReviewRequired: true })),
    LeadFollowUp.aggregate([
      { $sort: { leadId: 1, attemptNumber: -1 } },
      { $group: { _id: "$leadId", interestLevel: { $first: "$interestLevel" } } },
      { $group: { _id: "$interestLevel", leads: { $sum: 1 } } },
    ]),
    LeadFollowUp.aggregate([
      { $group: { _id: { $ifNull: ["$callResponse", "LEGACY_UNSPECIFIED"] }, count: { $sum: 1 } } },
    ]),
    LeadFollowUp.distinct("leadId", { attemptNumber: { $gte: 4 } }),
    Lead.countDocuments({ followUpReviewRequired: true, followUpsClosed: { $ne: true } }),
  ]);
  const neverContacted = await Lead.countDocuments({ _id: { $nin: contactedLeadIds } });
  const bounds = businessDayBounds();
  const now = new Date();
  const due = { dueToday: 0, overdue: 0 };
  for (const item of latestSchedules) {
    const date = new Date(item.nextFollowUpAt);
    if (date < now) due.overdue += 1;
    else if (date < bounds.tomorrow) due.dueToday += 1;
  }

  return sendSuccess(res, {
    employeeWise,
    leadsNeverContacted: neverContacted,
    ...due,
    fourAttemptsCompleted: fourAttemptLeadIds.length,
    reviewRequired,
    interest: Object.fromEntries(interestGroups.map((item) => [item._id, item.leads])),
    callResponses: Object.fromEntries(callResponseGroups.map((item) => [item._id, item.count])),
  });
});

/** POST /api/leads/:id/follow-ups/authorize-more — admin explicitly extends the limit. */
export const authorizeMoreFollowUps = asyncHandler(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (lead.followUpsClosed) throw ApiError.conflict("Follow-ups are closed for this lead");
  if (!lead.followUpReviewRequired) throw ApiError.conflict("The lead is not awaiting follow-up review");

  const additionalAttempts = req.body.additionalAttempts;
  const updatedLead = await Lead.findOneAndUpdate(
    { _id: lead._id, followUpReviewRequired: true, followUpsClosed: { $ne: true } },
    {
      $set: {
        followUpLimit: (lead.followUpLimit ?? 4) + additionalAttempts,
        followUpReviewRequired: false,
      },
      $push: {
        activity: {
          label: "Additional follow-ups authorized",
          actor: req.user?.name ?? "Admin",
          description: `${additionalAttempts} additional attempt(s) authorized`,
          timestamp: new Date(),
        },
      },
    },
    { new: true, runValidators: true }
  );
  if (!updatedLead) throw ApiError.conflict("The lead is no longer awaiting follow-up review");

  if (updatedLead.assignedEmployeeId) {
    await notifyEmployee(updatedLead.assignedEmployeeId, {
      title: "Additional follow-ups authorized",
      description: `${additionalAttempts} more follow-up attempt(s) are available for ${updatedLead.clientName}.`,
      href: `/employee/leads/${updatedLead.code}`,
    });
  }
  return sendSuccess(res, {
    followUpLimit: updatedLead.followUpLimit,
    followUpReviewRequired: updatedLead.followUpReviewRequired,
  });
});

/** POST /api/leads/:id/follow-ups/close — closes only the follow-up sequence. */
export const closeLeadFollowUps = asyncHandler(async (req, res) => {
  const lead = await findLead(req.params.id);
  if (lead.followUpsClosed) {
    return sendSuccess(res, { closed: true, followUpReviewRequired: false });
  }

  const updatedLead = await Lead.findOneAndUpdate(
    { _id: lead._id, followUpsClosed: { $ne: true } },
    {
      $set: {
        followUpsClosed: true,
        followUpsClosedAt: new Date(),
        followUpsClosedBy: req.user?._id,
        followUpReviewRequired: false,
      },
      $push: {
        activity: {
          label: "Follow-up sequence closed",
          actor: req.user?.name ?? "Admin",
          timestamp: new Date(),
        },
      },
    },
    { new: true }
  );
  if (!updatedLead) return sendSuccess(res, { closed: true, followUpReviewRequired: false });

  if (updatedLead.assignedEmployeeId) {
    await notifyEmployee(updatedLead.assignedEmployeeId, {
      title: "Follow-ups closed",
      description: `Further follow-ups are closed for ${updatedLead.clientName}.`,
      href: `/employee/leads/${updatedLead.code}`,
    });
  }
  return sendSuccess(res, { closed: true, followUpReviewRequired: false });
});

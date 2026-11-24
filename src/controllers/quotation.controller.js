import path from "node:path";
import { Client } from "../models/Client.js";
import { Employee } from "../models/Employee.js";
import { Lead } from "../models/Lead.js";
import { Quotation } from "../models/Quotation.js";
import { Service } from "../models/Service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendCreated, sendSuccess } from "../utils/apiResponse.js";
import { buildMeta, escapeRegex, getPagination, isObjectId } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { loadGeneralSettings } from "../services/settings.service.js";
import { calculateQuotationTotals } from "../services/quotationMath.js";
import { generateQuotationPdf } from "../services/quotationPdf.js";
import { notifyEmployeeOnce, notifyOnce } from "../services/notification.service.js";

const isAdmin = (user) => user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";
const isMasterAdmin = (user) => user?.role === "MASTER_ADMIN";
const employeeIdOf = (user) => user?.employee?._id ?? user?.employee;
const quoteLookup = (id) => isObjectId(id)
  ? { _id: id }
  : { quotationNumber: String(id).trim().toUpperCase() };

function serializedQuote(quote, employeeView = false) {
  const data = quote.toJSON();
  delete data.creationIdempotencyKey;
  for (const entry of data.history ?? []) delete entry.idempotencyKey;
  if (employeeView) {
    delete data.internalNotes;
    for (const version of data.versions ?? []) delete version.internalNotes;
  }
  return data;
}

function requireIdempotencyKey(req) {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw ApiError.badRequest("A valid Idempotency-Key header is required");
  }
  return key;
}

async function findQuote(id) {
  const quote = await Quotation.findOne(quoteLookup(id));
  if (!quote) throw ApiError.notFound("Quotation not found");
  return quote;
}

async function requireSalesEmployee(req) {
  if (req.user?.role !== "EMPLOYEE") throw ApiError.forbidden();
  const employeeId = employeeIdOf(req.user);
  const employee = employeeId
    ? await Employee.findById(employeeId).select("name department isActive")
    : null;
  if (!employee?.isActive || employee.department !== "Sales") {
    throw ApiError.forbidden("Quotation access is limited to active Sales employees");
  }
  return employee;
}

async function assertQuoteAccess(req, quote) {
  if (isAdmin(req.user)) return null;
  const employee = await requireSalesEmployee(req);
  const employeeId = String(employee._id);
  if (String(quote.assignedSalesEmployeeId ?? "") !== employeeId) {
    throw ApiError.notFound("Quotation not found");
  }
  if (quote.leadId) {
    const lead = await Lead.findById(quote.leadId).select("assignedEmployeeId");
    if (!lead || String(lead.assignedEmployeeId ?? "") !== employeeId) {
      throw ApiError.notFound("Quotation not found");
    }
  }
  return employee;
}

async function assertCanEdit(req, quote) {
  const employee = await assertQuoteAccess(req, quote);
  if (!["DRAFT", "REVISION_REQUESTED"].includes(quote.status)) {
    throw ApiError.conflict("Only editable quotation drafts can be changed");
  }
  if (!employee) return;
  if (String(quote.createdByEmployeeId ?? "") !== String(employee._id)) {
    throw ApiError.notFound("Quotation not found");
  }
}

async function resolveLineItems(items) {
  const resolved = await Promise.all(items.map(async (item) => {
    if (!item.serviceId) return { ...item, serviceId: undefined };
    const service = await Service.findById(item.serviceId).select("name");
    if (!service) throw ApiError.badRequest("A selected service no longer exists");
    return { ...item, serviceId: service._id, serviceName: service.name };
  }));
  return calculateQuotationTotals(resolved);
}

function userHistory(req, action, version, values = {}) {
  return {
    action,
    version,
    actorId: req.user._id,
    actorName: req.user.name ?? "User",
    at: new Date(),
    ...values,
  };
}

function currentVersionSnapshot(quote) {
  return {
    version: quote.version,
    status: quote.status,
    approvalStatus: quote.approvalStatus,
    lineItems: quote.lineItems.map((item) => item.toObject()),
    totals: quote.totals.toObject(),
    clientDetails: quote.clientDetails.toObject(),
    leadCode: quote.leadCode,
    validFrom: quote.validFrom,
    validUntil: quote.validUntil,
    currency: quote.currency,
    paymentTerms: quote.paymentTerms,
    termsAndConditions: quote.termsAndConditions,
    internalNotes: quote.internalNotes,
    approvedAt: quote.approvedAt,
    approvedBy: quote.approvedBy,
    approvedByName: quote.approvedByName,
    sentAt: quote.sentAt,
    sentBy: quote.sentBy,
    sentByName: quote.sentByName,
    sentMethod: quote.sentMethod,
    rejectionType: quote.rejectionType,
    rejectionReason: quote.rejectionReason,
    revisionReason: quote.revisionReason,
    revisionRequestedAt: quote.revisionRequestedAt,
    revisionRequestedBy: quote.revisionRequestedBy,
    customerDecision: quote.customerDecision?.toObject(),
    capturedAt: new Date(),
  };
}

async function applyTransition(quote, req, {
  action,
  targetStatus,
  allowedStatuses,
  set = {},
  unset = {},
  note,
}) {
  const idempotencyKey = requireIdempotencyKey(req);
  if (quote.history.some((entry) => entry.idempotencyKey === idempotencyKey)) {
    return { quote, changed: false };
  }
  if (quote.status === targetStatus) return { quote, changed: false };
  if (!allowedStatuses.includes(quote.status)) {
    throw ApiError.conflict(`Cannot ${action.replaceAll("_", " ")} a quotation in ${quote.status}`);
  }

  const fromStatus = quote.status;
  const update = {
    $push: {
      history: userHistory(req, action, quote.version, {
        fromStatus,
        toStatus: targetStatus,
        note,
        idempotencyKey,
      }),
    },
  };
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  const updated = await Quotation.findOneAndUpdate(
    { _id: quote._id, version: quote.version, status: fromStatus },
    update,
    { new: true, runValidators: true }
  );
  if (updated) return { quote: updated, changed: true };

  const latest = await Quotation.findById(quote._id);
  if (latest?.history.some((entry) => entry.idempotencyKey === idempotencyKey)) {
    return { quote: latest, changed: false };
  }
  if (latest?.status === targetStatus) return { quote: latest, changed: false };
  throw ApiError.conflict("Quotation changed while this action was being processed; reload and retry");
}

function employeeNotificationId(quote) {
  return quote.assignedSalesEmployeeId ?? quote.createdByEmployeeId;
}

/** GET /api/quotations/catalog — only the active Sales catalog needed by quote editors. */
export const quotationCatalog = asyncHandler(async (req, res) => {
  if (req.user.role === "EMPLOYEE") await requireSalesEmployee(req);
  const services = await Service.find({ status: "Active" }).select("name").sort({ name: 1 }).lean();
  return sendSuccess(res, services.map((service) => ({ id: String(service._id), name: service.name })));
});

/** GET /api/quotations — employee results are limited to currently assigned Sales leads. */
export const listQuotations = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = {};

  if (req.user.role === "EMPLOYEE") {
    const employee = await requireSalesEmployee(req);
    const leadIds = await Lead.distinct("_id", { assignedEmployeeId: employee._id });
    filter.assignedSalesEmployeeId = employee._id;
    filter.$and = [{
      $or: [
        { leadId: { $in: leadIds } },
        { leadId: { $exists: false } },
        { leadId: null },
      ],
    }];
  }
  if (query.status && query.status !== "All") filter.status = query.status;
  if (query.leadId) {
    if (!isObjectId(query.leadId)) throw ApiError.badRequest("Invalid lead ID");
    filter.leadId = query.leadId;
  }
  if (query.expiringOnly === "true") {
    filter.status = "SENT";
    filter.validUntil = { $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
  }
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    const searchFilter = { $or: [
      { quotationNumber: pattern },
      { leadCode: pattern },
      { "clientDetails.name": pattern },
      { "clientDetails.company": pattern },
    ] };
    if (filter.$and) filter.$and.push(searchFilter);
    else filter.$or = searchFilter.$or;
  }

  const [quotes, total] = await Promise.all([
    Quotation.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Quotation.countDocuments(filter),
  ]);
  return sendSuccess(res, quotes.map((quote) => serializedQuote(quote, req.user.role === "EMPLOYEE")), {
    meta: buildMeta({ page, limit, total }),
  });
});

/** GET /api/quotations/summary — expiry reminders are derived from validUntil, not a scheduler. */
export const quotationSummary = asyncHandler(async (req, res) => {
  const filter = { status: "SENT" };
  if (req.user.role === "EMPLOYEE") {
    const employee = await requireSalesEmployee(req);
    const leadIds = await Lead.distinct("_id", { assignedEmployeeId: employee._id });
    filter.assignedSalesEmployeeId = employee._id;
    filter.$or = [
      { leadId: { $in: leadIds } },
      { leadId: { $exists: false } },
      { leadId: null },
    ];
  }
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [expiringSoon, expired] = await Promise.all([
    Quotation.countDocuments({ ...filter, validUntil: { $gte: now, $lte: sevenDays } }),
    Quotation.countDocuments({ ...filter, validUntil: { $lt: now } }),
  ]);
  return sendSuccess(res, { expiringSoon, expired });
});

/** POST /api/quotations — creates an idempotent draft from a lead or client. */
export const createQuotation = asyncHandler(async (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req);
  const employee = req.user.role === "EMPLOYEE" ? await requireSalesEmployee(req) : null;
  const prior = await Quotation.findOne({
    createdBy: req.user._id,
    creationIdempotencyKey: idempotencyKey,
  }).select("+creationIdempotencyKey");
  if (prior) return sendSuccess(res, serializedQuote(prior, Boolean(employee)));

  const lead = req.body.leadId ? await Lead.findById(req.body.leadId) : null;
  if (req.body.leadId && !lead) throw ApiError.notFound("Lead not found");
  if (employee && (!lead || String(lead.assignedEmployeeId ?? "") !== String(employee._id))) {
    throw ApiError.notFound("Lead not found");
  }
  if (lead && req.body.clientId && String(lead.clientId) !== String(req.body.clientId)) {
    throw ApiError.badRequest("The selected lead does not belong to the selected client");
  }

  const clientId = lead?.clientId ?? req.body.clientId;
  const client = clientId ? await Client.findById(clientId) : null;
  if (!client) throw ApiError.badRequest("A valid client is required");

  let assignedSalesEmployeeId = employee?._id ?? req.body.assignedSalesEmployeeId;
  if (!employee && !assignedSalesEmployeeId && lead?.assignedEmployeeId) {
    const currentLeadOwner = await Employee.findById(lead.assignedEmployeeId).select("department isActive");
    if (currentLeadOwner?.isActive && currentLeadOwner.department === "Sales") {
      assignedSalesEmployeeId = currentLeadOwner._id;
    }
  }
  if (!employee && assignedSalesEmployeeId) {
    const salesEmployee = await Employee.findById(assignedSalesEmployeeId).select("department isActive");
    if (!salesEmployee?.isActive || salesEmployee.department !== "Sales") {
      throw ApiError.badRequest("Assigned quotation owner must be an active Sales employee");
    }
    if (lead && String(lead.assignedEmployeeId ?? "") !== String(salesEmployee._id)) {
      throw ApiError.badRequest("The quotation owner must currently be assigned to this lead");
    }
    assignedSalesEmployeeId = salesEmployee._id;
  }

  const { lineItems, totals } = await resolveLineItems(req.body.lineItems);
  const quote = new Quotation({
    leadId: lead?._id,
    leadCode: lead?.code,
    clientId: client._id,
    clientDetails: {
      name: client.name,
      company: client.company,
      phone: client.phone,
      email: client.email,
    },
    createdBy: req.user._id,
    createdByEmployeeId: employee?._id,
    assignedSalesEmployeeId,
    creationIdempotencyKey: idempotencyKey,
    status: "DRAFT",
    approvalStatus: "NOT_SUBMITTED",
    lineItems,
    totals,
    validFrom: new Date(req.body.validFrom),
    validUntil: new Date(req.body.validUntil),
    currency: "INR",
    paymentTerms: req.body.paymentTerms,
    termsAndConditions: req.body.termsAndConditions,
    internalNotes: employee ? "" : req.body.internalNotes,
    history: [userHistory(req, "draft_created", 1, { toStatus: "DRAFT", idempotencyKey })],
  });

  try {
    await quote.save();
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await Quotation.findOne({
        createdBy: req.user._id,
        creationIdempotencyKey: idempotencyKey,
      }).select("+creationIdempotencyKey");
      if (duplicate) return sendSuccess(res, serializedQuote(duplicate, Boolean(employee)));
    }
    throw error;
  }
  return sendCreated(res, serializedQuote(quote, Boolean(employee)));
});

/** GET /api/quotations/:id */
export const getQuotation = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  const employee = await assertQuoteAccess(req, quote);
  return sendSuccess(res, serializedQuote(quote, Boolean(employee)));
});

/** PATCH /api/quotations/:id — draft content only; totals are recalculated. */
export const updateQuotationDraft = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  const employee = await assertCanEdit(req, quote);
  const { lineItems, totals } = await resolveLineItems(req.body.lineItems);

  const updated = await Quotation.findOneAndUpdate(
    { _id: quote._id, version: quote.version, status: quote.status },
    {
      $set: {
        lineItems,
        totals,
        validFrom: new Date(req.body.validFrom),
        validUntil: new Date(req.body.validUntil),
        currency: "INR",
        paymentTerms: req.body.paymentTerms,
        termsAndConditions: req.body.termsAndConditions,
        ...(employee ? {} : { internalNotes: req.body.internalNotes }),
      },
      $push: {
        history: userHistory(req, "draft_updated", quote.version, {
          fromStatus: quote.status,
          toStatus: quote.status,
        }),
      },
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.conflict("Quotation changed while it was being edited; reload and retry");
  return sendSuccess(res, serializedQuote(updated, Boolean(employee)));
});

/** POST /api/quotations/:id/submit */
export const submitQuotation = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  const employee = await assertQuoteAccess(req, quote);
  const result = await applyTransition(quote, req, {
    action: "submitted_for_approval",
    targetStatus: "PENDING_APPROVAL",
    allowedStatuses: ["DRAFT", "REVISION_REQUESTED"],
    set: {
      status: "PENDING_APPROVAL",
      approvalStatus: "PENDING",
    },
    unset: {
      revisionReason: 1,
      revisionRequestedAt: 1,
      revisionRequestedBy: 1,
    },
  });
  if (result.changed) {
    await notifyOnce(`quotation:${quote._id}:v${quote.version}:submitted`, {
      title: "Quotation submitted for approval",
      description: `${quote.quotationNumber} for ${quote.clientDetails.company || quote.clientDetails.name} is awaiting review.`,
      category: "Work",
      href: `/master-admin/quotations/${quote._id}`,
    });
  }
  return sendSuccess(res, serializedQuote(result.quote, Boolean(employee)));
});

/** POST /api/quotations/:id/approve — only MASTER_ADMIN can approve. */
export const approveQuotation = asyncHandler(async (req, res) => {
  if (!isMasterAdmin(req.user)) throw ApiError.forbidden("Only Master Admin can approve quotations");
  const quote = await findQuote(req.params.id);
  const now = new Date();
  const result = await applyTransition(quote, req, {
    action: "approved",
    targetStatus: "APPROVED",
    allowedStatuses: ["PENDING_APPROVAL"],
    set: {
      status: "APPROVED",
      approvalStatus: "APPROVED",
      approvedAt: now,
      approvedBy: req.user._id,
      approvedByName: req.user.name,
      rejectionType: undefined,
      rejectionReason: undefined,
    },
  });
  if (result.changed) {
    const employeeId = employeeNotificationId(quote);
    if (employeeId) {
      await notifyEmployeeOnce(employeeId, `quotation:${quote._id}:v${quote.version}:approved`, {
        title: "Quotation approved",
        description: `${quote.quotationNumber} has been approved.`,
        href: `/employee/quotations/${quote._id}`,
      });
    }
  }
  return sendSuccess(res, serializedQuote(result.quote));
});

/** POST /api/quotations/:id/reject — internal approval rejection. */
export const rejectQuotation = asyncHandler(async (req, res) => {
  if (!isMasterAdmin(req.user)) throw ApiError.forbidden("Only Master Admin can reject quotations");
  const quote = await findQuote(req.params.id);
  const result = await applyTransition(quote, req, {
    action: "approval_rejected",
    targetStatus: "REJECTED",
    allowedStatuses: ["PENDING_APPROVAL"],
    set: {
      status: "REJECTED",
      approvalStatus: "REJECTED",
      rejectionType: "APPROVAL",
      rejectionReason: req.body.reason,
    },
    note: req.body.reason,
  });
  if (result.changed) {
    const employeeId = employeeNotificationId(quote);
    if (employeeId) {
      await notifyEmployeeOnce(employeeId, `quotation:${quote._id}:v${quote.version}:approval-rejected`, {
        title: "Quotation rejected",
        description: `${quote.quotationNumber}: ${req.body.reason}`,
        href: `/employee/quotations/${quote._id}`,
      });
    }
  }
  return sendSuccess(res, serializedQuote(result.quote));
});

/** POST /api/quotations/:id/request-revision */
export const requestQuotationRevision = asyncHandler(async (req, res) => {
  if (!isMasterAdmin(req.user)) throw ApiError.forbidden("Only Master Admin can request quotation revisions");
  const quote = await findQuote(req.params.id);
  const result = await applyTransition(quote, req, {
    action: "revision_requested",
    targetStatus: "REVISION_REQUESTED",
    allowedStatuses: ["PENDING_APPROVAL"],
    set: {
      status: "REVISION_REQUESTED",
      approvalStatus: "REVISION_REQUESTED",
      revisionReason: req.body.reason,
      revisionRequestedAt: new Date(),
      revisionRequestedBy: req.user._id,
    },
    note: req.body.reason,
  });
  if (result.changed) {
    const employeeId = employeeNotificationId(quote);
    if (employeeId) {
      await notifyEmployeeOnce(employeeId, `quotation:${quote._id}:v${quote.version}:revision-requested`, {
        title: "Quotation revision requested",
        description: `${quote.quotationNumber}: ${req.body.reason}`,
        href: `/employee/quotations/${quote._id}`,
      });
    }
  }
  return sendSuccess(res, serializedQuote(result.quote));
});

/** POST /api/quotations/:id/sent — records the real sending action; does not send email/WhatsApp. */
export const recordQuotationSent = asyncHandler(async (req, res) => {
  if (!isMasterAdmin(req.user)) throw ApiError.forbidden("Only Master Admin can record a sent quotation");
  const quote = await findQuote(req.params.id);
  if (quote.validUntil < new Date()) throw ApiError.conflict("An expired quotation cannot be sent");
  const now = new Date();
  const result = await applyTransition(quote, req, {
    action: "sent_to_customer",
    targetStatus: "SENT",
    allowedStatuses: ["APPROVED"],
    set: {
      status: "SENT",
      sentAt: now,
      sentBy: req.user._id,
      sentByName: req.user.name,
      sentMethod: req.body.sentMethod,
    },
  });
  return sendSuccess(res, serializedQuote(result.quote));
});

/** POST /api/quotations/:id/customer-decision — customer outcome, separate from internal approval. */
export const recordCustomerDecision = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  const employee = await assertQuoteAccess(req, quote);
  const decision = req.body.decision;
  const now = new Date();
  const result = await applyTransition(quote, req, {
    action: `customer_${decision.toLowerCase()}`,
    targetStatus: decision,
    allowedStatuses: ["SENT"],
    set: {
      status: decision,
      customerDecision: {
        outcome: decision,
        note: req.body.note,
        decidedAt: now,
        recordedBy: req.user._id,
      },
      ...(decision === "REJECTED" ? {
        rejectionType: "CUSTOMER",
        rejectionReason: req.body.note,
      } : {}),
    },
    unset: decision === "REJECTED" ? {} : { rejectionType: 1, rejectionReason: 1 },
    note: req.body.note,
  });
  return sendSuccess(res, serializedQuote(result.quote, Boolean(employee)));
});

/** POST /api/quotations/:id/expire — explicit Admin action after the validity date. */
export const expireQuotation = asyncHandler(async (req, res) => {
  if (!isMasterAdmin(req.user)) throw ApiError.forbidden("Only Master Admin can mark quotations expired");
  const quote = await findQuote(req.params.id);
  if (quote.validUntil >= new Date()) throw ApiError.conflict("The quotation has not reached its expiry date");
  const result = await applyTransition(quote, req, {
    action: "marked_expired",
    targetStatus: "EXPIRED",
    allowedStatuses: ["SENT"],
    set: { status: "EXPIRED" },
  });
  return sendSuccess(res, serializedQuote(result.quote));
});

/** POST /api/quotations/:id/revise — preserves the prior version before opening a new draft. */
export const startQuotationRevision = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  const employee = await assertQuoteAccess(req, quote);
  if (!["APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(quote.status)) {
    throw ApiError.conflict("A new version can only start from an approved or customer-facing quotation");
  }
  const idempotencyKey = requireIdempotencyKey(req);
  if (quote.history.some((entry) => entry.idempotencyKey === idempotencyKey)) {
    return sendSuccess(res, serializedQuote(quote, Boolean(employee)));
  }
  const nextVersion = quote.version + 1;
  const previousStatus = quote.status;
  const updated = await Quotation.findOneAndUpdate(
    { _id: quote._id, version: quote.version, status: previousStatus },
    {
      $set: {
        version: nextVersion,
        status: "DRAFT",
        approvalStatus: "NOT_SUBMITTED",
      },
      $unset: {
        approvedAt: 1,
        approvedBy: 1,
        approvedByName: 1,
        sentAt: 1,
        sentBy: 1,
        sentByName: 1,
        sentMethod: 1,
        rejectionType: 1,
        rejectionReason: 1,
        revisionReason: 1,
        revisionRequestedAt: 1,
        revisionRequestedBy: 1,
        customerDecision: 1,
      },
      $push: {
        versions: currentVersionSnapshot(quote),
        history: userHistory(req, "revision_created", nextVersion, {
          fromStatus: previousStatus,
          toStatus: "DRAFT",
          idempotencyKey,
        }),
      },
    },
    { new: true, runValidators: true }
  );
  if (updated) return sendSuccess(res, serializedQuote(updated, Boolean(employee)));

  const latest = await Quotation.findById(quote._id);
  if (latest?.history.some((entry) => entry.idempotencyKey === idempotencyKey)) {
    return sendSuccess(res, serializedQuote(latest, Boolean(employee)));
  }
  throw ApiError.conflict("Quotation changed while its revision was being started");
});

/** GET /api/quotations/:id/pdf — authorized on-demand PDF; no temp/public file is created. */
export const getQuotationPdf = asyncHandler(async (req, res) => {
  const quote = await findQuote(req.params.id);
  await assertQuoteAccess(req, quote);
  const requestedVersion = q(req).version;
  const snapshot = requestedVersion && requestedVersion !== quote.version
    ? quote.versions.find((item) => item.version === requestedVersion)
    : currentVersionSnapshot(quote);
  if (!snapshot) throw ApiError.notFound("Quotation version not found");
  if (
    snapshot.approvalStatus !== "APPROVED" ||
    !["APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(snapshot.status)
  ) {
    throw ApiError.conflict("A quotation PDF is available only for an approved version");
  }

  const general = await loadGeneralSettings();
  const logoPath = path.resolve(process.cwd(), "..", "frontend", "public", "images", "logo.png");
  const output = await generateQuotationPdf({ quote, snapshot, general, logoPath });
  const safeNumber = quote.quotationNumber.replace(/[^A-Z0-9-]/gi, "");
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${safeNumber}-v${snapshot.version}.pdf"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return res.status(200).send(output);
});

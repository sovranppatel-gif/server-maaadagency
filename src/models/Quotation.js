import mongoose from "mongoose";
import { Counter } from "./Counter.js";
import { toJSONPlugin } from "./plugins.js";

export const QUOTATION_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "REVISION_REQUESTED",
];

export const QUOTATION_APPROVAL_STATUSES = [
  "NOT_SUBMITTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "REVISION_REQUESTED",
];

const lineItemSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
    serviceName: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    quantityMilli: { type: Number, required: true, min: 1, max: 1_000_000_000 },
    unit: { type: String, required: true, trim: true, maxlength: 40 },
    unitRatePaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    discountBps: { type: Number, required: true, min: 0, max: 10_000, default: 0 },
    taxRateBps: { type: Number, required: true, min: 0, max: 10_000, default: 0 },
    subtotalPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    discountPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    taxPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    totalPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  },
  { _id: true }
);
lineItemSchema.plugin(toJSONPlugin);

const totalsSchema = new mongoose.Schema(
  {
    subtotalPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    discountPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    taxPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
    grandTotalPaise: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  },
  { _id: false }
);

const clientSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    company: String,
    phone: String,
    email: String,
  },
  { _id: false }
);

const customerDecisionSchema = new mongoose.Schema(
  {
    outcome: { type: String, enum: ["ACCEPTED", "REJECTED"], required: true },
    note: { type: String, default: "" },
    decidedAt: { type: Date, required: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: false }
);

const versionSnapshotSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    status: { type: String, enum: QUOTATION_STATUSES, required: true },
    approvalStatus: { type: String, enum: QUOTATION_APPROVAL_STATUSES, required: true },
    lineItems: { type: [lineItemSchema], required: true },
    totals: { type: totalsSchema, required: true },
    clientDetails: { type: clientSnapshotSchema, required: true },
    leadCode: String,
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    currency: { type: String, enum: ["INR"], default: "INR" },
    paymentTerms: { type: String, default: "" },
    termsAndConditions: { type: String, default: "" },
    internalNotes: { type: String, default: "" },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedByName: String,
    sentAt: Date,
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sentByName: String,
    sentMethod: { type: String, enum: ["EMAIL", "WHATSAPP", "IN_PERSON", "OTHER"] },
    rejectionType: { type: String, enum: ["APPROVAL", "CUSTOMER"] },
    rejectionReason: String,
    revisionReason: String,
    revisionRequestedAt: Date,
    revisionRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    customerDecision: { type: customerDecisionSchema, default: undefined },
    capturedAt: { type: Date, required: true },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    fromStatus: { type: String, enum: QUOTATION_STATUSES },
    toStatus: { type: String, enum: QUOTATION_STATUSES },
    version: { type: Number, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    note: String,
    idempotencyKey: String,
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);
historySchema.plugin(toJSONPlugin);

const quotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, unique: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", index: true },
    leadCode: String,
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientDetails: { type: clientSnapshotSchema, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdByEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
    assignedSalesEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
    creationIdempotencyKey: { type: String, required: true, select: false },
    version: { type: Number, required: true, default: 1, min: 1 },
    status: { type: String, enum: QUOTATION_STATUSES, required: true, default: "DRAFT", index: true },
    approvalStatus: {
      type: String,
      enum: QUOTATION_APPROVAL_STATUSES,
      required: true,
      default: "NOT_SUBMITTED",
      index: true,
    },
    lineItems: { type: [lineItemSchema], required: true },
    totals: { type: totalsSchema, required: true },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true, index: true },
    currency: { type: String, enum: ["INR"], default: "INR" },
    paymentTerms: { type: String, default: "" },
    termsAndConditions: { type: String, default: "" },
    internalNotes: { type: String, default: "" },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedByName: String,
    sentAt: Date,
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sentByName: String,
    sentMethod: { type: String, enum: ["EMAIL", "WHATSAPP", "IN_PERSON", "OTHER"] },
    rejectionType: { type: String, enum: ["APPROVAL", "CUSTOMER"] },
    rejectionReason: String,
    revisionReason: String,
    revisionRequestedAt: Date,
    revisionRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    customerDecision: { type: customerDecisionSchema, default: undefined },
    versions: { type: [versionSnapshotSchema], default: [] },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

quotationSchema.pre("validate", async function assignQuotationNumber() {
  if (this.quotationNumber) return;
  const seq = await Counter.next("quotation");
  this.quotationNumber = `QT-${String(seq).padStart(5, "0")}`;
});

quotationSchema.plugin(toJSONPlugin);
quotationSchema.index({ createdBy: 1, creationIdempotencyKey: 1 }, { unique: true });
quotationSchema.index({ status: 1, createdAt: -1 });
quotationSchema.index({ leadId: 1, createdAt: -1 });

export const Quotation = mongoose.model("Quotation", quotationSchema);

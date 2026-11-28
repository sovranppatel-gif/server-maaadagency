import mongoose from "mongoose";
import { codePlugin, toJSONPlugin } from "./plugins.js";
import {
  ROLES,
  VISIT_EVENT_TYPES,
  VISIT_LOCATION_TYPES,
  VISIT_OUTCOMES,
  VISIT_STATUSES,
  VISIT_TYPES,
} from "./common.js";

const scheduleSnapshotSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: Date,
  },
  { _id: false }
);

const visitHistorySchema = new mongoose.Schema(
  {
    eventType: { type: String, enum: VISIT_EVENT_TYPES, required: true },
    previousStatus: { type: String, enum: [...VISIT_STATUSES, null], default: null },
    newStatus: { type: String, enum: [...VISIT_STATUSES, null], default: null },
    previousSchedule: scheduleSnapshotSchema,
    newSchedule: scheduleSnapshotSchema,
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", select: false },
    actorName: { type: String, required: true },
    actorRole: { type: String, enum: [...ROLES, "SYSTEM"] },
    note: { type: String, trim: true, maxlength: 1000 },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);
visitHistorySchema.plugin(toJSONPlugin);

const leadVisitSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, select: false },
    visitType: { type: String, enum: VISIT_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    scheduledStart: { type: Date, required: true, index: true },
    scheduledEnd: Date,
    timezone: { type: String, default: "Asia/Kolkata", trim: true, maxlength: 64 },
    locationType: { type: String, enum: VISIT_LOCATION_TYPES, required: true },
    locationAddress: { type: String, trim: true, maxlength: 500, default: "" },
    meetingLink: { type: String, trim: true, maxlength: 500, default: "" },
    status: { type: String, enum: VISIT_STATUSES, default: "SCHEDULED", index: true },
    customerContactPerson: { type: String, trim: true, maxlength: 120 },
    customerResponse: { type: String, trim: true, maxlength: 3000, default: "" },
    outcome: { type: String, enum: VISIT_OUTCOMES },
    notes: { type: String, trim: true, maxlength: 3000, default: "" },
    cancellationReason: { type: String, trim: true, maxlength: 1000, default: "" },
    completedAt: Date,
    cancelledAt: Date,
    idempotencyKey: { type: String, required: true, select: false },
    history: { type: [visitHistorySchema], default: [] },
  },
  { timestamps: true }
);

leadVisitSchema.plugin(toJSONPlugin);
leadVisitSchema.plugin(codePlugin, { prefix: "VST", counter: "visit", pad: 3 });

leadVisitSchema.index({ leadId: 1, scheduledStart: -1 });
leadVisitSchema.index({ assignedEmployeeId: 1, scheduledStart: 1 });
leadVisitSchema.index({ status: 1, scheduledStart: 1 });
leadVisitSchema.index({ leadId: 1, idempotencyKey: 1 }, { unique: true });

export const LeadVisit = mongoose.model("LeadVisit", leadVisitSchema);

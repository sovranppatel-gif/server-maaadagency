import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";

export const FOLLOW_UP_COMMUNICATION_TYPES = ["Call", "WhatsApp", "Meeting", "Email"];
export const FOLLOW_UP_INTEREST_LEVELS = ["Interested", "Not Interested", "Neutral", "Unsure"];

const leadFollowUpSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, select: false },
    attemptNumber: { type: Number, required: true, min: 1 },
    communicationType: { type: String, enum: FOLLOW_UP_COMMUNICATION_TYPES, required: true },
    contactedAt: { type: Date, required: true },
    customerResponse: { type: String, default: "", trim: true, maxlength: 3000 },
    discussionNotes: { type: String, required: true, trim: true, maxlength: 5000 },
    nextFollowUpAt: Date,
    interestLevel: { type: String, enum: FOLLOW_UP_INTEREST_LEVELS, required: true },
    quotationRequired: { type: Boolean, default: false },
    employeeRemarks: { type: String, default: "", trim: true, maxlength: 2000 },
    idempotencyKey: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

leadFollowUpSchema.plugin(toJSONPlugin);
leadFollowUpSchema.index({ leadId: 1, attemptNumber: 1 }, { unique: true });
leadFollowUpSchema.index({ leadId: 1, idempotencyKey: 1 }, { unique: true });
leadFollowUpSchema.index({ leadId: 1, attemptNumber: -1 });
leadFollowUpSchema.index({ employeeId: 1, nextFollowUpAt: 1 });

export const LeadFollowUp = mongoose.model("LeadFollowUp", leadFollowUpSchema);

import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";

const optionSchema = new mongoose.Schema({ label: { type: String, required: true } }, { _id: true });
optionSchema.plugin(toJSONPlugin);

/**
 * One step of the WhatsApp intake bot. Steps are ordered and replayed by
 * botFlow.service.js to collect a full requirement before creating a lead.
 */
const botStepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    options: { type: [optionSchema], default: undefined },
    // Lead field this step populates, e.g. requirement, budget, deadline.
    collectsField: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

botStepSchema.plugin(toJSONPlugin);

export const BotStep = mongoose.model("BotStep", botStepSchema);

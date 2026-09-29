import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";

/**
 * Answers the smart WhatsApp bot may send verbatim when a customer asks a
 * question mid-flow. This is the only company information the bot is
 * allowed to share, so the AI never has to invent it.
 */
const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
    category: { type: String, default: "General", trim: true },
    active: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

faqSchema.plugin(toJSONPlugin);

export const Faq = mongoose.model("Faq", faqSchema);

import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    // E.164 digits such as 919876543210 - the join key for WhatsApp webhooks.
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    // Human formatted variant the dashboard renders, e.g. +91 98765 43210.
    phoneDisplay: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    avatarColor: { type: String, default: "#C5161D" },
    lastContact: { type: Date, default: Date.now },

    totalLeads: { type: Number, default: 0, min: 0 },
    activeProjects: { type: Number, default: 0, min: 0 },
    completedProjects: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

clientSchema.plugin(toJSONPlugin);
clientSchema.plugin(codePlugin, { prefix: "CL", counter: "client", pad: 3 });

clientSchema.index({ name: "text", company: "text" });

export const Client = mongoose.model("Client", clientSchema);

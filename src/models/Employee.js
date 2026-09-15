import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";
import { AVAILABILITY } from "./common.js";

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Job title such as "UI/UX Designer" - distinct from the User system role.
    role: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    avatarColor: { type: String, default: "#C5161D" },
    availability: { type: String, enum: AVAILABILITY, default: "Available", index: true },
    skills: { type: [String], default: [] },
    joinedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true, index: true },

    // Denormalised workload counters, kept authoritative by stats.service.js.
    activeWorks: { type: Number, default: 0, min: 0 },
    completedWorks: { type: Number, default: 0, min: 0 },
    pendingReview: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

employeeSchema.plugin(toJSONPlugin);
employeeSchema.plugin(codePlugin, { prefix: "EMP", counter: "employee", pad: 3 });

employeeSchema.index({ name: "text", role: "text", email: "text" });

export const Employee = mongoose.model("Employee", employeeSchema);

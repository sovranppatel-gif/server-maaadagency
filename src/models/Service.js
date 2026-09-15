import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    // Lucide icon name resolved by the dashboard icon map.
    icon: { type: String, default: "Sparkles" },
    status: { type: String, enum: ["Active", "Disabled"], default: "Active", index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

serviceSchema.plugin(toJSONPlugin);
serviceSchema.plugin(codePlugin, { prefix: "SVC", counter: "service", pad: 3 });

export const Service = mongoose.model("Service", serviceSchema);

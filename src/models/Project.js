import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";
import { attachmentSchema, PROJECT_STATUSES } from "./common.js";

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    done: { type: Boolean, default: false },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { _id: true }
);
taskSchema.plugin(toJSONPlugin);

const commentSchema = new mongoose.Schema(
  {
    author: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);
commentSchema.plugin(toJSONPlugin);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    services: { type: [String], default: [] },
    teamIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
    progress: { type: Number, default: 0, min: 0, max: 100 },
    deadline: { type: Date, required: true },
    status: { type: String, enum: PROJECT_STATUSES, default: "Planning", index: true },
    tasks: { type: [taskSchema], default: [] },
    files: { type: [attachmentSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

projectSchema.plugin(toJSONPlugin);
projectSchema.plugin(codePlugin, { prefix: "PRJ", counter: "project" });
projectSchema.index({ name: "text", clientName: "text" });

export const Project = mongoose.model("Project", projectSchema);

import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";
import { CONVERSATION_STATUSES } from "./common.js";

const conversationSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    // E.164 digits, unique per client conversation thread.
    phone: { type: String, required: true, unique: true, index: true },
    avatarColor: { type: String, default: "#C5161D" },

    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    unreadCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: CONVERSATION_STATUSES, default: "New Leads", index: true },

    online: { type: Boolean, default: false },
    lastSeen: { type: String, default: "" },

    assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },

    // Bot conversation state machine: which step we are on and what has been
    // collected so far. Cleared once the flow produces a lead.
    bot: {
      active: { type: Boolean, default: true },
      stepIndex: { type: Number, default: 0 },
      collected: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
      startedAt: Date,
      completedAt: Date,
    },
  },
  { timestamps: true }
);

conversationSchema.plugin(toJSONPlugin);
conversationSchema.index({ clientName: "text", phone: "text" });

export const Conversation = mongoose.model("Conversation", conversationSchema);

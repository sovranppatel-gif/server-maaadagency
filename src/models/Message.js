import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    message: { type: String, default: "" },
    messageType: { type: String, enum: ["text", "image", "document", "audio", "template"], default: "text" },
    mediaUrl: String,
    mediaName: String,
    status: { type: String, enum: ["sent", "delivered", "read", "failed"], default: "sent", index: true },
    // Meta message id (wamid...) used to reconcile delivery status webhooks.
    waMessageId: { type: String, index: true, sparse: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    error: String,
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

messageSchema.plugin(toJSONPlugin);
messageSchema.index({ conversationId: 1, timestamp: 1 });

export const Message = mongoose.model("Message", messageSchema);

import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Client } from "../models/Client.js";
import { BotStep } from "../models/BotStep.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { avatarColorFor, normalisePhone, prettyPhone } from "../utils/format.js";
import { emitEvent } from "../config/socket.js";
import { logger } from "../config/logger.js";
import {
  getConnectionStatus,
  markMessageRead,
  sendTextMessage,
  verifySubscription,
  verifyWebhookSignature,
} from "../services/whatsapp.service.js";
import { advanceBotFlow, pauseBotFlow, startBotFlow } from "../services/botFlow.service.js";
import { withLock } from "../utils/mutex.js";

const presentConversation = (doc) => ({
  ...doc,
  id: String(doc._id),
  _id: undefined,
  phone: prettyPhone(doc.phone),
  bot: undefined, // internal state machine data stays server-side
});

/** GET /api/whatsapp/conversations */
export const listConversations = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 50 });

  const filter = {};
  if (query.filter === "Unread") filter.unreadCount = { $gt: 0 };
  else if (query.filter && query.filter !== "All") filter.status = query.filter;

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ clientName: rx }, { phone: rx }];
  }

  const [items, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean(),
    Conversation.countDocuments(filter),
  ]);

  return sendSuccess(res, items.map(presentConversation), { meta: buildMeta({ page, limit, total }) });
});

/** GET /api/whatsapp/conversations/:id */
export const getConversation = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return sendSuccess(res, presentConversation(conversation));
});

/** GET /api/whatsapp/conversations/:id/messages */
export const listMessages = asyncHandler(async (req, res) => {
  const query = q(req);
  const { limit, skip } = getPagination(query, { defaultLimit: 100, maxLimit: 200 });

  const messages = await Message.find({ conversationId: req.params.id })
    .sort({ timestamp: 1, _id: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return sendSuccess(res, messages.map((m) => ({ ...m, id: String(m._id), _id: undefined })));
});

/** POST /api/whatsapp/send — agent reply; pauses the bot for this thread. */
export const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, to, message } = req.body;

  let conversation = conversationId ? await Conversation.findById(conversationId) : null;

  if (!conversation && to) {
    const phone = normalisePhone(to);
    conversation = await Conversation.findOne({ phone });

    if (!conversation) {
      // Outbound-first contact: create the client and thread on the fly.
      const client =
        (await Client.findOne({ phone })) ??
        (await Client.create({
          name: prettyPhone(phone),
          phone,
          phoneDisplay: prettyPhone(phone),
          avatarColor: avatarColorFor(phone),
        }));

      conversation = await Conversation.create({
        clientId: client._id,
        clientName: client.company || client.name,
        phone,
        avatarColor: client.avatarColor,
        status: "Active",
        bot: { active: false, stepIndex: 0, collected: {} },
      });
    }
  }

  if (!conversation) throw ApiError.badRequest("Provide either a conversationId or a destination number");

  const result = await sendTextMessage(conversation.phone, message);

  const doc = await Message.create({
    conversationId: conversation._id,
    clientId: conversation.clientId,
    direction: "outbound",
    message,
    messageType: "text",
    status: "sent",
    waMessageId: result.messageId ?? undefined,
    sentBy: req.user?._id,
    timestamp: new Date(),
  });

  conversation.lastMessage = message;
  conversation.lastMessageAt = doc.timestamp;
  if (conversation.status === "New Leads") conversation.status = "Active";
  await conversation.save();
  // A human has joined the thread: stop the automated questionnaire.
  await pauseBotFlow(conversation);

  const payload = { ...doc.toJSON() };
  emitEvent("message:new", payload, `conversation:${conversation._id}`);

  return sendCreated(res, payload);
});

/** POST /api/whatsapp/conversations/:id/read */
export const markConversationRead = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findByIdAndUpdate(
    req.params.id,
    { unreadCount: 0 },
    { new: true }
  ).lean();
  if (!conversation) throw ApiError.notFound("Conversation not found");

  emitEvent("conversation:read", { id: String(conversation._id) });
  return sendSuccess(res, presentConversation(conversation));
});

/** GET /api/whatsapp/status */
export const connectionStatus = asyncHandler(async (_req, res) => sendSuccess(res, getConnectionStatus()));

/* ─ Webhook ─────────────────────────────────────────────────────────────── */

/** GET /api/whatsapp/webhook — Meta subscription handshake. */
export const verifyWebhook = (req, res) => {
  const challenge = verifySubscription({
    mode: req.query["hub.mode"],
    token: req.query["hub.verify_token"],
    challenge: req.query["hub.challenge"],
  });

  if (challenge) return res.status(200).send(challenge);
  return res.status(403).send("Verification failed");
};

/** Finds or creates the client + conversation behind an inbound message. */
async function resolveThread(phone, profileName) {
  let client = await Client.findOne({ phone });
  if (!client) {
    client = await Client.create({
      name: profileName || prettyPhone(phone),
      phone,
      phoneDisplay: prettyPhone(phone),
      avatarColor: avatarColorFor(phone),
    });
  }

  let conversation = await Conversation.findOne({ phone });
  let isNew = false;
  if (!conversation) {
    conversation = await Conversation.create({
      clientId: client._id,
      clientName: client.company || client.name,
      phone,
      avatarColor: client.avatarColor,
      status: "New Leads",
      bot: { active: true, stepIndex: 0, collected: {}, startedAt: new Date() },
    });
    isNew = true;
  }
  return { client, conversation, isNew };
}

function extractContent(waMessage) {
  switch (waMessage.type) {
    case "text":
      return { messageType: "text", message: waMessage.text?.body ?? "" };
    case "image":
      return { messageType: "image", message: waMessage.image?.caption ?? "", mediaName: waMessage.image?.id };
    case "document":
      return {
        messageType: "document",
        message: waMessage.document?.caption ?? "",
        mediaName: waMessage.document?.filename ?? waMessage.document?.id,
      };
    case "audio":
      return { messageType: "audio", message: "", mediaName: waMessage.audio?.id };
    case "interactive":
      return {
        messageType: "text",
        message:
          waMessage.interactive?.button_reply?.title ??
          waMessage.interactive?.list_reply?.title ??
          "",
      };
    case "button":
      return { messageType: "text", message: waMessage.button?.text ?? "" };
    default:
      return { messageType: "text", message: "" };
  }
}

/**
 * POST /api/whatsapp/webhook
 * Always answers 200 quickly: Meta retries aggressively on any other status,
 * so processing failures are logged rather than surfaced.
 */
export const receiveWebhook = asyncHandler(async (req, res) => {
  if (!verifyWebhookSignature(req.rawBody, req.get("x-hub-signature-256"))) {
    logger.warn("Rejected WhatsApp webhook with invalid signature");
    return res.status(401).send("Invalid signature");
  }

  res.status(200).send("EVENT_RECEIVED");

  try {
    for (const entry of req.body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};

        // 1. Delivery receipts for messages we sent.
        for (const status of value.statuses ?? []) {
          await Message.findOneAndUpdate(
            { waMessageId: status.id },
            { status: status.status, ...(status.errors?.[0] ? { error: status.errors[0].title } : {}) }
          );
          emitEvent("message:status", { waMessageId: status.id, status: status.status });
        }

        // 2. Inbound customer messages. Each conversation is processed
        // one turn at a time so concurrent deliveries cannot interleave.
        for (const waMessage of value.messages ?? []) {
          const phone = normalisePhone(waMessage.from);
          const profileName = value.contacts?.[0]?.profile?.name;
          await withLock(phone, async () => {
          const { client, conversation, isNew } = await resolveThread(phone, profileName);
          const content = extractContent(waMessage);

          // Meta timestamps have second precision, so several messages sent
          // within the same second would otherwise sort ahead of the replies
          // that came between them. Keep each thread strictly monotonic.
          const reported = waMessage.timestamp
            ? new Date(Number(waMessage.timestamp) * 1000)
            : new Date();
          const previous = conversation.lastMessageAt?.getTime() ?? 0;
          const timestamp = reported.getTime() > previous ? reported : new Date(previous + 1);

          const doc = await Message.create({
            conversationId: conversation._id,
            clientId: client._id,
            direction: "inbound",
            status: "delivered",
            waMessageId: waMessage.id,
            timestamp,
            ...content,
          });

          conversation.lastMessage = content.message || `[${content.messageType}]`;
          conversation.lastMessageAt = doc.timestamp;
          conversation.unreadCount += 1;
          conversation.online = true;
          conversation.lastSeen = "online";
          await conversation.save();

          client.lastContact = doc.timestamp;
          await client.save();

          emitEvent("message:new", doc.toJSON(), `conversation:${conversation._id}`);
          emitEvent("conversation:updated", presentConversation(conversation.toObject()));

          await markMessageRead(waMessage.id).catch(() => null);

          // 3. Drive the intake bot.
          if (isNew) {
            await startBotFlow(conversation);
          } else if (content.messageType === "text" && content.message) {
            await advanceBotFlow(conversation, content.message);
          }
          });
        }
      }
    }
  } catch (err) {
    logger.error("Failed to process WhatsApp webhook", { error: err.message, stack: err.stack });
  }

  return undefined;
});

/* ─ Bot flow management ─────────────────────────────────────────────────── */

/** GET /api/whatsapp/bot-flow */
export const listBotSteps = asyncHandler(async (_req, res) => {
  const steps = await BotStep.find().sort({ order: 1 }).lean();
  return sendSuccess(res, steps.map((s) => ({ ...s, id: String(s._id), _id: undefined })));
});

/** POST /api/whatsapp/bot-flow */
export const createBotStep = asyncHandler(async (req, res) => {
  const last = await BotStep.findOne().sort({ order: -1 }).lean();
  const step = await BotStep.create({ ...req.body, order: req.body.order ?? (last?.order ?? 0) + 1 });
  return sendCreated(res, step.toJSON());
});

/** PATCH /api/whatsapp/bot-flow/:id */
export const updateBotStep = asyncHandler(async (req, res) => {
  const step = await BotStep.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!step) throw ApiError.notFound("Bot step not found");
  return sendSuccess(res, step.toJSON());
});

/** DELETE /api/whatsapp/bot-flow/:id */
export const deleteBotStep = asyncHandler(async (req, res) => {
  const step = await BotStep.findByIdAndDelete(req.params.id);
  if (!step) throw ApiError.notFound("Bot step not found");

  // Close the gap so the sequence stays contiguous.
  await BotStep.updateMany({ order: { $gt: step.order } }, { $inc: { order: -1 } });
  return sendSuccess(res, { id: String(step._id), deleted: true });
});

/** PATCH /api/whatsapp/bot-flow/reorder */
export const reorderBotSteps = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  await BotStep.bulkWrite(
    ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { order: index + 1 } } }))
  );
  const steps = await BotStep.find().sort({ order: 1 }).lean();
  return sendSuccess(res, steps.map((s) => ({ ...s, id: String(s._id), _id: undefined })));
});

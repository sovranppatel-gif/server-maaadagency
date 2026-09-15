import { BotStep } from "../models/BotStep.js";
import { Lead } from "../models/Lead.js";
import { Client } from "../models/Client.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { sendTextMessage } from "./whatsapp.service.js";
import { notifyWhatsApp } from "./notification.service.js";
import { recalcClientStats } from "./stats.service.js";
import { emitEvent } from "../config/socket.js";
import { logger } from "../config/logger.js";

/** Renders a step message, appending numbered options when present. */
function renderStep(step) {
  if (!step.options?.length) return step.message;
  const list = step.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `${step.message}\n\n${list}`;
}

/** Maps "2" or "web application" onto the matching option label. */
function resolveAnswer(step, rawAnswer) {
  const answer = String(rawAnswer ?? "").trim();
  if (!step.options?.length) return answer;

  const index = Number.parseInt(answer, 10);
  if (Number.isInteger(index) && index >= 1 && index <= step.options.length) {
    return step.options[index - 1].label;
  }
  const match = step.options.find((o) => o.label.toLowerCase() === answer.toLowerCase());
  return match ? match.label : answer;
}

/** Persists an outbound bot message and ships it to WhatsApp. */
async function sendBotMessage(conversation, text) {
  const result = await sendTextMessage(conversation.phone, text).catch((err) => {
    logger.error("Bot message send failed", { error: err.message, phone: conversation.phone });
    return { messageId: null, failed: true };
  });

  const message = await Message.create({
    conversationId: conversation._id,
    clientId: conversation.clientId,
    direction: "outbound",
    message: text,
    messageType: "text",
    status: result.failed ? "failed" : "sent",
    waMessageId: result.messageId ?? undefined,
    timestamp: new Date(),
  });

  conversation.lastMessage = text;
  conversation.lastMessageAt = message.timestamp;

  emitEvent("message:new", message.toJSON(), `conversation:${conversation._id}`);
  return message;
}

/** Sends the opening question when a brand-new conversation starts. */
export async function startBotFlow(conversation) {
  const steps = await BotStep.find({ active: true }).sort({ order: 1 }).lean();
  if (!steps.length) return null;

  conversation.bot = { active: true, stepIndex: 0, collected: {}, startedAt: new Date() };
  await sendBotMessage(conversation, renderStep(steps[0]));
  await conversation.save();
  return steps[0];
}

/**
 * Advances the intake flow by one inbound answer.
 * Returns the created lead once the final step is answered.
 */
export async function advanceBotFlow(conversation, inboundText) {
  if (!conversation.bot?.active) return null;

  const steps = await BotStep.find({ active: true }).sort({ order: 1 }).lean();
  if (!steps.length) return null;

  const currentIndex = conversation.bot.stepIndex ?? 0;
  const currentStep = steps[currentIndex];
  if (!currentStep) return null;

  // Record the answer to the question we just asked.
  const collected = { ...(conversation.bot.collected ?? {}) };
  if (currentStep.collectsField) {
    collected[currentStep.collectsField] = resolveAnswer(currentStep, inboundText);
  }

  const nextIndex = currentIndex + 1;
  const nextStep = steps[nextIndex];

  conversation.bot = { ...conversation.bot, stepIndex: nextIndex, collected };

  if (nextStep) {
    await sendBotMessage(conversation, renderStep(nextStep));
    // A closing step collects nothing: the flow is finished once it is sent.
    if (!nextStep.collectsField && nextIndex === steps.length - 1) {
      return completeBotFlow(conversation, collected);
    }
    await conversation.save();
    return null;
  }

  return completeBotFlow(conversation, collected);
}

/** Converts the collected answers into a Lead and hands over to the team. */
async function completeBotFlow(conversation, collected) {
  conversation.bot = { ...conversation.bot, active: false, completedAt: new Date(), collected };

  const client = await Client.findById(conversation.clientId);
  if (client) {
    // The bot often learns the real name/company before the CRM does.
    if (collected.clientName && /^whatsapp user/i.test(client.name)) client.name = collected.clientName;
    if (collected.company && !client.company) client.company = collected.company;
    client.lastContact = new Date();
    await client.save();
    conversation.clientName = client.company || client.name;
  }

  const deadline = collected.deadline ? new Date(collected.deadline) : undefined;

  const lead = await Lead.create({
    clientId: conversation.clientId,
    clientName: conversation.clientName,
    phone: conversation.phone,
    company: collected.company || client?.company,
    email: client?.email,
    service: collected.service || "Other",
    requirement: collected.requirement || collected.service || "New WhatsApp enquiry",
    description: collected.description || "",
    referenceWebsite: collected.referenceWebsite,
    deadline: deadline && !Number.isNaN(deadline.valueOf()) ? deadline : undefined,
    budget: collected.budget,
    source: "WhatsApp",
    priority: "MEDIUM",
    status: "New",
    conversationId: conversation._id,
    activity: [
      { label: "Lead Created", actor: "WhatsApp Bot", timestamp: new Date() },
      { label: "Requirement Collected", actor: "WhatsApp Bot", timestamp: new Date() },
    ],
  });

  conversation.leadId = lead._id;
  conversation.status = "New Leads";
  await conversation.save();

  await recalcClientStats(conversation.clientId);

  emitEvent("lead:new", lead.toJSON());
  await notifyWhatsApp(
    "New WhatsApp lead received",
    `${conversation.clientName} asked about ${lead.service}: ${lead.requirement}`,
    `/master-admin/leads/${lead.code}`
  );

  logger.info("Lead captured from WhatsApp bot flow", { lead: lead.code, phone: conversation.phone });
  return lead;
}

/** Stops the bot so a human agent can take over the thread. */
export async function pauseBotFlow(conversation) {
  if (!conversation.bot?.active) return conversation;
  conversation.bot = { ...conversation.bot, active: false };
  return conversation.save();
}

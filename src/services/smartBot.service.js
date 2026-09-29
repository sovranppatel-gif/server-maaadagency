// smartBot.service.js
//
// Sits between the webhook and the rule-based bot flow:
//
//   exact option match ─────────────────────────────► advanceBotFlow (no AI)
//   otherwise ─► AI understanding ─► BOT_ANSWER     ► advanceBotFlow(answer)
//                                  ├► FAQ           ► FAQ answer + re-ask step
//                                  ├► HUMAN/STOP    ► pause + hand off
//                                  ├► low/unclear   ► clarify, do not advance
//                                  └► any failure   ► advanceBotFlow (rule-based)
//
// With AI disabled this is a straight pass-through to advanceBotFlow.

import { Message } from "../models/Message.js";
import { Faq } from "../models/Faq.js";
import { logger } from "../config/logger.js";
import {
  advanceBotFlow,
  getActiveSteps,
  matchOption,
  pauseBotFlow,
  renderStep,
  sendBotMessage,
} from "./botFlow.service.js";
import { analyzeMessage } from "./aiReply.service.js";
import { getAiConfig, loadGeneralSettings } from "./settings.service.js";
import { notifyWhatsApp } from "./notification.service.js";

export const REPLIES = {
  handoff: "Sure 👍 I'll connect you with our team. Someone will assist you shortly.",
  stop: "No problem 👍 I've paused the automated questions. Our team will get in touch with you shortly.",
  unknown: "I'll have our team help you with that.",
  clarifyOptions: "Sure 😊 Please pick the option that fits best:",
  clarifyFreeText: "Sorry, I didn't quite get that 🙏",
};

/**
 * Decides what to do with one inbound text. Pure apart from the injected
 * `analyze` call, so every branch is unit-testable without MongoDB or a
 * live AI provider.
 */
export async function planBotTurn({ text, step, aiEnabled, threshold, analyze }) {
  if (!step) return { action: "rule_based", reason: "no current step" };

  // Cheapest path first: "1", "Website", ... never reach the AI.
  const exact = matchOption(step, text);
  if (exact) return { action: "advance", answer: exact, source: "exact" };

  if (!aiEnabled) return { action: "rule_based", reason: "ai disabled" };

  let result;
  try {
    result = await analyze();
  } catch (err) {
    return { action: "rule_based", reason: "ai failure", error: err };
  }

  const confident = result.confidence >= threshold;
  if (!confident) return { action: "clarify", result, reason: "low confidence" };

  switch (result.intent) {
    case "BOT_ANSWER":
      return { action: "advance", answer: result.value, prefill: result.extractedFields, source: "ai", result };
    case "FAQ":
      return { action: "faq", faq: result.faq, result };
    case "GENERAL_QUERY":
      return { action: "unknown", result };
    case "HUMAN_HANDOFF":
      return { action: "handoff", result };
    case "STOP_BOT":
      return { action: "stop", result };
    default:
      return { action: "clarify", result, reason: "unclear" };
  }
}

function clarification(step) {
  const prefix = step.options?.length ? REPLIES.clarifyOptions : REPLIES.clarifyFreeText;
  return `${prefix}\n\n${renderStep(step)}`;
}

async function recentHistory(conversationId, limit) {
  const docs = await Message.find({ conversationId }).sort({ timestamp: -1, _id: -1 }).limit(limit).lean();
  return docs.reverse();
}

async function handOff(conversation, reason) {
  await pauseBotFlow(conversation);
  conversation.humanHandoff = true;
  conversation.handoffAt = new Date();
  await sendBotMessage(conversation, reason === "stop" ? REPLIES.stop : REPLIES.handoff);
  await conversation.save();

  await notifyWhatsApp(
    reason === "stop" ? "Customer paused the WhatsApp bot" : "Customer asked for a human",
    `${conversation.clientName} is waiting for a reply from the team.`,
    "/master-admin/whatsapp"
  );
}

/**
 * Entry point used by the webhook in place of advanceBotFlow. Never throws
 * because of the AI: any AI problem falls back to the rule-based flow.
 */
export async function handleInboundText(conversation, text) {
  if (!conversation.bot?.active) return null;

  const config = await getAiConfig();
  if (!config.enabled) return advanceBotFlow(conversation, text);

  const steps = await getActiveSteps();
  const step = steps[conversation.bot.stepIndex ?? 0];
  const conversationId = String(conversation._id);

  const plan = await planBotTurn({
    text,
    step,
    aiEnabled: true,
    threshold: config.confidenceThreshold,
    analyze: async () => {
      logger.info("[AI] Incoming message", { conversationId, step: step?.collectsField ?? null, length: text.length });
      const [faqs, history, businessInfo] = await Promise.all([
        Faq.find({ active: true }).sort({ order: 1 }).limit(50).lean(),
        recentHistory(conversation._id, config.contextMessages),
        loadGeneralSettings(),
      ]);
      return analyzeMessage({ text, step, steps, faqs, history, businessInfo });
    },
  });

  if (plan.result) {
    logger.info("[AI] Decision", {
      conversationId,
      intent: plan.result.intent,
      field: plan.result.field,
      confidence: plan.result.confidence,
      action: plan.action,
      extracted: Object.keys(plan.result.extractedFields ?? {}),
    });
  }

  switch (plan.action) {
    case "advance":
      return advanceBotFlow(conversation, text, { answer: plan.answer, prefill: plan.prefill });

    case "faq":
      await sendBotMessage(conversation, plan.faq.answer);
      await sendBotMessage(conversation, renderStep(step));
      await conversation.save();
      return null;

    case "unknown":
      await sendBotMessage(conversation, REPLIES.unknown);
      await sendBotMessage(conversation, renderStep(step));
      await conversation.save();
      return null;

    case "clarify":
      await sendBotMessage(conversation, clarification(step));
      await conversation.save();
      return null;

    case "handoff":
    case "stop":
      await handOff(conversation, plan.action);
      return null;

    default:
      if (plan.reason === "ai failure") {
        logger.warn("[AI] Provider error, falling back to rule-based flow", {
          conversationId,
          error: plan.error?.message,
          ...(plan.error?.meta ?? {}),
        });
      }
      return advanceBotFlow(conversation, text);
  }
}

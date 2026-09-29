import { Setting } from "../models/Setting.js";
import { env } from "../config/env.js";

export const GENERAL_KEY = "general.config";
export const AI_KEY = "ai.config";

/** Business details shown in settings and shared with the smart bot. */
export async function loadGeneralSettings() {
  const stored = (await Setting.get(GENERAL_KEY)) ?? {};
  return {
    agencyName: stored.agencyName ?? "Maa Ad Agency",
    supportEmail: stored.supportEmail ?? "info@maaadagency.com",
    supportPhone: stored.supportPhone ?? "+91 79743 51591",
    timezone: stored.timezone ?? "Asia/Kolkata",
  };
}

/**
 * Effective smart-bot configuration. AI_ENABLED is a hard kill switch: when
 * the environment disables AI, nothing stored in the database can turn it
 * on, and no database read happens on the webhook path.
 */
export async function getAiConfig() {
  const base = {
    envEnabled: env.aiEnabled,
    enabled: env.aiEnabled,
    confidenceThreshold: env.aiConfidenceThreshold,
    contextMessages: env.aiContextMessages,
  };
  if (!env.aiEnabled) return base;

  const stored = (await Setting.get(AI_KEY)) ?? {};
  return {
    ...base,
    enabled: stored.enabled ?? true,
    confidenceThreshold: stored.confidenceThreshold ?? base.confidenceThreshold,
    contextMessages: stored.contextMessages ?? base.contextMessages,
  };
}

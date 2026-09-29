import { Setting } from "../models/Setting.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { env } from "../config/env.js";
import { getConnectionStatus, maskSecret, sendTextMessage } from "../services/whatsapp.service.js";
import { AI_KEY, GENERAL_KEY, getAiConfig, loadGeneralSettings } from "../services/settings.service.js";
import { aiProviderStatus } from "../services/aiReply.service.js";

const WHATSAPP_KEY = "whatsapp.config";

/**
 * GET /api/settings/whatsapp
 * Secrets live in environment variables and are returned masked only, so the
 * settings screen can show configuration state without ever exposing a token.
 */
export const getWhatsAppSettings = asyncHandler(async (_req, res) => {
  const stored = (await Setting.get(WHATSAPP_KEY)) ?? {};
  const status = getConnectionStatus();

  return sendSuccess(res, {
    businessAccountId: stored.businessAccountId || maskSecret(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    phoneNumberId: stored.phoneNumberId || maskSecret(env.WHATSAPP_PHONE_NUMBER_ID),
    // Never returned in clear text, regardless of who is asking.
    accessToken: maskSecret(env.WHATSAPP_ACCESS_TOKEN),
    webhookVerifyToken: maskSecret(env.WHATSAPP_VERIFY_TOKEN),
    webhookUrl: stored.webhookUrl || `${env.CLIENT_ORIGIN.replace(/\/$/, "")}/api/whatsapp/webhook`,
    connected: status.connected,
    dryRun: status.dryRun,
    apiVersion: status.apiVersion,
    configuredFromEnv: {
      phoneNumberId: status.phoneNumberIdConfigured,
      accessToken: status.accessTokenConfigured,
      verifyToken: status.verifyTokenConfigured,
      appSecret: status.appSecretConfigured,
    },
  });
});

/**
 * PATCH /api/settings/whatsapp
 * Only non-secret fields are persisted. Credentials must be rotated through
 * the deployment environment, never through the API.
 */
export const updateWhatsAppSettings = asyncHandler(async (req, res) => {
  const { businessAccountId, phoneNumberId, webhookUrl } = req.body;

  const current = (await Setting.get(WHATSAPP_KEY)) ?? {};
  const next = {
    ...current,
    ...(businessAccountId !== undefined ? { businessAccountId } : {}),
    ...(phoneNumberId !== undefined ? { phoneNumberId } : {}),
    ...(webhookUrl !== undefined ? { webhookUrl } : {}),
  };

  await Setting.put(WHATSAPP_KEY, next, req.user?._id);
  return sendSuccess(res, { ...next, message: "Configuration saved. Credentials are managed via environment variables." });
});

/** POST /api/settings/whatsapp/test — verifies credentials against Meta. */
export const testWhatsAppConnection = asyncHandler(async (req, res) => {
  const status = getConnectionStatus();

  if (!status.connected) {
    return sendSuccess(res, {
      success: false,
      message: status.dryRun
        ? "Running in dry-run mode. Set WHATSAPP_DRY_RUN=false and provide credentials to go live."
        : "WhatsApp credentials are not configured on the server.",
    });
  }

  const to = req.body?.to;
  if (!to) {
    return sendSuccess(res, {
      success: true,
      message: "Credentials are present. Provide a test number to send a live message.",
    });
  }

  try {
    const result = await sendTextMessage(to, "Test message from Maa Ad Agency admin panel.");
    return sendSuccess(res, { success: true, message: "Test message sent successfully.", messageId: result.messageId });
  } catch (err) {
    return sendSuccess(res, { success: false, message: err.message });
  }
});

/** GET /api/settings/general */
export const getGeneralSettings = asyncHandler(async (_req, res) => sendSuccess(res, await loadGeneralSettings()));

/** PATCH /api/settings/general */
export const updateGeneralSettings = asyncHandler(async (req, res) => {
  const current = (await Setting.get(GENERAL_KEY)) ?? {};
  const next = { ...current, ...req.body };
  await Setting.put(GENERAL_KEY, next, req.user?._id);
  return sendSuccess(res, next);
});

/**
 * GET /api/settings/ai
 * Provider credentials stay in the environment; only their presence is shown.
 */
export const getAiSettings = asyncHandler(async (_req, res) => {
  const config = await getAiConfig();
  return sendSuccess(res, { ...config, ...aiProviderStatus() });
});

/** PATCH /api/settings/ai — runtime toggles; cannot override AI_ENABLED=false. */
export const updateAiSettings = asyncHandler(async (req, res) => {
  const current = (await Setting.get(AI_KEY)) ?? {};
  await Setting.put(AI_KEY, { ...current, ...req.body }, req.user?._id);
  const config = await getAiConfig();
  return sendSuccess(res, { ...config, ...aiProviderStatus() });
});

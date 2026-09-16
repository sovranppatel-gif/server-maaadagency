import crypto from "node:crypto";
import { env, isProd, whatsappConfigured } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/ApiError.js";

const GRAPH_BASE = "https://graph.facebook.com";

function endpoint(pathSuffix) {
  return `${GRAPH_BASE}/${env.WHATSAPP_API_VERSION}/${pathSuffix}`;
}

async function callGraph(pathSuffix, body) {
  const res = await fetch(endpoint(pathSuffix), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || `WhatsApp API responded ${res.status}`;
    logger.error("WhatsApp API error", { status: res.status, message });
    throw new ApiError(res.status === 401 ? 401 : 502, `WhatsApp: ${message}`);
  }
  return json;
}

/**
 * Sends a plain text message.
 * In dry-run mode (no credentials / WHATSAPP_DRY_RUN=true) the payload is
 * logged and a synthetic id returned, so the whole product works locally
 * without touching Meta.
 */
export async function sendTextMessage(to, text) {
  if (!whatsappConfigured) {
    logger.info("WhatsApp dry-run: message not sent", { to, text: text.slice(0, 80) });
    return { dryRun: true, messageId: `dryrun-${crypto.randomUUID()}` };
  }

  const json = await callGraph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: text },
  });

  return { dryRun: false, messageId: json?.messages?.[0]?.id ?? null };
}

/** Sends a pre-approved template (required to open a session after 24h). */
export async function sendTemplateMessage(to, templateName, languageCode = "en_US", components = []) {
  if (!whatsappConfigured) {
    logger.info("WhatsApp dry-run: template not sent", { to, templateName });
    return { dryRun: true, messageId: `dryrun-${crypto.randomUUID()}` };
  }

  const json = await callGraph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components },
  });

  return { dryRun: false, messageId: json?.messages?.[0]?.id ?? null };
}

/** Marks an inbound message as read so the customer sees blue ticks. */
export async function markMessageRead(waMessageId) {
  if (!whatsappConfigured || !waMessageId) return { dryRun: true };
  return callGraph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: waMessageId,
  });
}

/** Resolves a media id into a temporary download URL. */
export async function getMediaUrl(mediaId) {
  if (!whatsappConfigured) return null;
  const res = await fetch(endpoint(mediaId), {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.url ?? null;
}

/**
 * Verifies the X-Hub-Signature-256 header Meta sends with every webhook.
 * Requires the raw request body, captured in app.js.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!env.WHATSAPP_APP_SECRET) {
    // Production webhooks must never accept unsigned requests. Local dry-run
    // development remains usable without configuring a Meta app secret.
    if (isProd) {
      logger.error("Webhook signature rejected: WHATSAPP_APP_SECRET is not set");
      return false;
    }
    logger.warn("Webhook signature not verified: WHATSAPP_APP_SECRET is not set");
    return true;
  }
  if (!signatureHeader || !rawBody) return false;

  const expected = `sha256=${crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Answers Meta's GET verification handshake. */
export function verifySubscription({ mode, token, challenge }) {
  if (mode === "subscribe" && token && token === env.WHATSAPP_VERIFY_TOKEN) return challenge;
  return null;
}

/** Connection status surfaced in the dashboard header and settings screen. */
export function getConnectionStatus() {
  return {
    connected: whatsappConfigured,
    dryRun: env.WHATSAPP_DRY_RUN,
    apiVersion: env.WHATSAPP_API_VERSION,
    phoneNumberIdConfigured: Boolean(env.WHATSAPP_PHONE_NUMBER_ID),
    accessTokenConfigured: Boolean(env.WHATSAPP_ACCESS_TOKEN),
    verifyTokenConfigured: Boolean(env.WHATSAPP_VERIFY_TOKEN),
    appSecretConfigured: Boolean(env.WHATSAPP_APP_SECRET),
  };
}

/** Never return a raw secret: show only enough to recognise the value. */
export function maskSecret(value, visible = 4) {
  if (!value) return "";
  const tail = value.slice(-visible);
  return `${"•".repeat(Math.max(8, Math.min(24, value.length - visible)))}${tail}`;
}

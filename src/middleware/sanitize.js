/**
 * Strips Mongo operator keys ($gt, $where, dotted paths) from user input.
 * Written in-house because express-mongo-sanitize mutates req.query, which is
 * read-only in Express 5.
 */
function scrub(value, depth = 0, allowedDottedKeys = new Set()) {
  if (depth > 6 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = scrub(value[i], depth + 1, allowedDottedKeys);
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || (key.includes(".") && !allowedDottedKeys.has(key))) {
      delete value[key];
      continue;
    }
    value[key] = scrub(value[key], depth + 1, allowedDottedKeys);
  }
  return value;
}

export function sanitizeRequest(req, _res, next) {
  if (req.body) scrub(req.body);
  if (req.params) scrub(req.params);
  // Meta's subscription handshake uses these exact dotted query keys. Preserve
  // them only on its public verification endpoint; all other dotted input is
  // still removed before it can reach an application route.
  const webhookVerificationKeys =
    req.method === "GET" && req.path === "/api/whatsapp/webhook"
      ? new Set(["hub.mode", "hub.verify_token", "hub.challenge"])
      : undefined;
  if (req.query) scrub(req.query, 0, webhookVerificationKeys); // mutate in place, never reassign
  next();
}

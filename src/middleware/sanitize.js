/**
 * Strips Mongo operator keys ($gt, $where, dotted paths) from user input.
 * Written in-house because express-mongo-sanitize mutates req.query, which is
 * read-only in Express 5.
 */
function scrub(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = scrub(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete value[key];
      continue;
    }
    value[key] = scrub(value[key], depth + 1);
  }
  return value;
}

export function sanitizeRequest(req, _res, next) {
  if (req.body) scrub(req.body);
  if (req.params) scrub(req.params);
  if (req.query) scrub(req.query); // mutate in place, never reassign
  next();
}

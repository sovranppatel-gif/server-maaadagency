import mongoose from "mongoose";

/** Parse ?page & ?limit into safe skip/limit values. */
export function getPagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/** Parse ?sort=-createdAt,name into a Mongo sort object, restricted to an allowlist. */
export function getSort(query, allowed = [], fallback = { createdAt: -1 }) {
  if (!query.sort) return fallback;
  const sort = {};
  for (const raw of String(query.sort).split(",")) {
    const desc = raw.startsWith("-");
    const field = desc ? raw.slice(1) : raw;
    if (allowed.includes(field)) sort[field] = desc ? -1 : 1;
  }
  return Object.keys(sort).length ? sort : fallback;
}

export function buildMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasMore: page * limit < total,
  };
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Escape user input before embedding it in a RegExp (prevents ReDoS / injection). */
export function escapeRegex(value = "") {
  return String(value).replace(REGEX_SPECIALS, "\\$&");
}

export const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value));

/**
 * Lookup helper so both `/leads/665f…` (ObjectId) and `/leads/LD-1042`
 * (human-readable code) resolve to the same document.
 */
export function byIdOrCode(id) {
  return isObjectId(id) ? { _id: id } : { code: String(id).toUpperCase() };
}

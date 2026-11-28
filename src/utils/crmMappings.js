export const LEAD_QUALITIES = ["HOT", "WARM", "COLD", "TRY", "WASTE"];

export const VISIT_TYPES = [
  "SITE_VISIT",
  "OFFICE_MEETING",
  "CLIENT_MEETING",
  "FIELD_VISIT",
  "VIRTUAL_MEETING",
  "OTHER",
];

export const VISIT_STATUSES = ["SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED"];

export const VISIT_OUTCOMES = [
  "INTERESTED",
  "FOLLOW_UP_REQUIRED",
  "QUOTATION_REQUESTED",
  "NOT_INTERESTED",
  "OTHER",
];

export const VISIT_LOCATION_TYPES = [
  "CUSTOMER_LOCATION",
  "OFFICE",
  "PROJECT_SITE",
  "VIRTUAL",
  "OTHER",
];

export const VISIT_EVENT_TYPES = ["SCHEDULED", "RESCHEDULED", "COMPLETED", "CANCELLED", "REASSIGNED"];

export const VISIT_TRANSITIONS = {
  SCHEDULED: ["RESCHEDULED", "COMPLETED", "CANCELLED"],
  RESCHEDULED: ["RESCHEDULED", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const CALL_RESPONSES = [
  "NOT_PICKED",
  "BUSY",
  "NO_RESPONSE",
  "INTERESTED",
  "CALL_BACK",
  "NOT_CONNECTED",
  "CALL_CUT",
  "OUT_OF_SERVICE",
  "PRICING_CONCERN",
  "NOT_INTERESTED",
  "OTHER",
];

const LEGACY_CALL_RESPONSE_ALIASES = new Map([
  ["NOT PICK", "NOT_PICKED"],
  ["NOT PICKED", "NOT_PICKED"],
  ["BUZY", "BUSY"],
  ["BUSY", "BUSY"],
  ["NO RESPONSE", "NO_RESPONSE"],
  ["INTERESTED", "INTERESTED"],
  ["CALL BACK", "CALL_BACK"],
  ["CALLBACK", "CALL_BACK"],
  ["NOT CONNECTED", "NOT_CONNECTED"],
  ["CALL CUT", "CALL_CUT"],
  ["OUT OF SERVICE", "OUT_OF_SERVICE"],
  ["PRICING IS ON HIGHER SIDE", "PRICING_CONCERN"],
  ["PRICING CONCERN", "PRICING_CONCERN"],
  ["NOT INTERESTED", "NOT_INTERESTED"],
  ["OTHER", "OTHER"],
]);

/**
 * Maps a canonical call response or declared legacy Excel label to a canonical
 * CALL_RESPONSES value. Returns null for unknown values so callers can reject
 * or flag them rather than silently misclassifying.
 */
export function normaliseCallResponse(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase().replace(/\s+/g, " ");
  if (CALL_RESPONSES.includes(upper)) return upper;

  const underscoreKey = upper.replace(/ /g, "_");
  if (CALL_RESPONSES.includes(underscoreKey)) return underscoreKey;

  return LEGACY_CALL_RESPONSE_ALIASES.get(upper) ?? null;
}

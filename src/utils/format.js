/** Bytes → "1.2 MB", matching the shape the dashboard renders. */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

const EXT_TYPE = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
  pdf: "pdf",
  doc: "doc", docx: "doc", txt: "doc", xls: "doc", xlsx: "doc", ppt: "doc", pptx: "doc",
  zip: "zip", rar: "zip", "7z": "zip",
};

/** Map a filename to the union the frontend expects: image | pdf | doc | zip | other. */
export function fileTypeFromName(name = "") {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPE[ext] ?? "other";
}

/** Normalise Indian phone numbers to E.164 digits (WhatsApp wire format). */
export function normalisePhone(raw = "") {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `91${digits.slice(1)}`;
  return digits;
}

/** E.164 digits → "+91 98765 43210" for display. */
export function prettyPhone(digits = "") {
  const d = String(digits).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
}

const AVATAR_COLORS = ["#C5161D", "#2563eb", "#059669", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#4338ca"];

/** Deterministic avatar colour so the same client always renders identically. */
export function avatarColorFor(seed = "") {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Shared spreadsheet safety, CSV RFC-4180 parsing/serialization,
 * formula-injection escaping, and Asia/Kolkata date utilities.
 */

const FORMULA_TRIGGER_RE = /^[\s]*[=+\-@\t\r]/;

/**
 * Neutralizes spreadsheet formula injection (CWE-1236) by prefixing cells
 * beginning with =, +, -, @, tab, or CR with a leading apostrophe.
 */
export function escapeSpreadsheetCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (!str) return "";
  return FORMULA_TRIGGER_RE.test(str) ? `'${str}` : str;
}

/** Formats a Date or ISO value into readable IST ("28 Nov 2026, 01:30 PM"). */
export function formatIstDisplay(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

/** Formats a Date or ISO value into IST YYYY-MM-DD. */
export function formatIstDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Escapes a single CSV field using RFC 4180 quoting plus formula safety. */
export function toCsvCell(value, { isPhone = false } = {}) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = isPhone ? raw : escapeSpreadsheetCell(raw);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Parses an RFC 4180 CSV buffer into an array of string rows. */
export function parseCsvBuffer(buffer) {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Converts an Excel serial number (1900 date system) to a JS Date in UTC. */
function excelSerialToDate(serial) {
  if (typeof serial !== "number" || !Number.isFinite(serial) || serial < 1 || serial > 2958465) {
    return null;
  }
  const utcDays = Math.floor(serial - 25569);
  const frac = serial - Math.floor(serial);
  const totalSeconds = Math.round(frac * 86400);
  const d = new Date(utcDays * 86400 * 1000 + totalSeconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function buildIstDate(year, month, day, hour = 9, minute = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  const d = new Date(`${year}-${mm}-${dd}T${hh}:${min}:00.000+05:30`);
  if (Number.isNaN(d.getTime())) return null;
  // Verify calendar rollover didn't happen (e.g. Feb 31 -> Mar 3)
  const check = formatIstDateKey(d);
  if (check !== `${year}-${mm}-${dd}`) return null;
  return d;
}

function parseTimeParts(rawTime) {
  if (!rawTime) return null;
  if (rawTime instanceof Date && !Number.isNaN(rawTime.getTime())) {
    return { hour: rawTime.getUTCHours(), minute: rawTime.getUTCMinutes() };
  }
  if (typeof rawTime === "number" && rawTime >= 0 && rawTime < 1) {
    const mins = Math.round(rawTime * 24 * 60);
    return { hour: Math.floor(mins / 60) % 24, minute: mins % 60 };
  }
  const str = String(rawTime).trim();
  const m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  if (m[3]) {
    const mer = m[3].toUpperCase();
    if (hour < 1 || hour > 12) return null;
    if (mer === "PM" && hour !== 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
  }
  return { hour, minute };
}

/**
 * Parses Indian DD/MM/YYYY, DD-MM-YY, YYYY-MM-DD, "12 May 2026", Date objects,
 * or Excel serial numbers into an Asia/Kolkata Date. Returns null on invalid input.
 */
export function parseSpreadsheetDate(rawDate, rawTime = null, defaultYear = 2026) {
  if (rawDate === null || rawDate === undefined || rawDate === "") return null;
  const time = parseTimeParts(rawTime);
  const hour = time?.hour ?? 9;
  const minute = time?.minute ?? 0;

  if (rawDate instanceof Date) {
    if (Number.isNaN(rawDate.getTime())) return null;
    return buildIstDate(rawDate.getUTCFullYear(), rawDate.getUTCMonth() + 1, rawDate.getUTCDate(), hour, minute);
  }
  if (typeof rawDate === "number") {
    const d = excelSerialToDate(rawDate);
    if (!d) return null;
    if (time) {
      return buildIstDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute);
    }
    return buildIstDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours() || 9, d.getUTCMinutes());
  }

  const str = String(rawDate).trim();
  if (!str) return null;

  // ISO YYYY-MM-DD (optionally with time)
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  if (isoMatch) {
    return buildIstDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      isoMatch[4] !== undefined ? Number(isoMatch[4]) : hour,
      isoMatch[5] !== undefined ? Number(isoMatch[5]) : minute
    );
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YY
  const dmyMatch = str.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?:\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?))?$/i);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    let year = dmyMatch[3] ? Number(dmyMatch[3]) : defaultYear;
    if (year < 100) year += 2000;
    const inlineTime = dmyMatch[4] ? parseTimeParts(dmyMatch[4]) : null;
    return buildIstDate(year, month, day, inlineTime?.hour ?? hour, inlineTime?.minute ?? minute);
  }

  // "12 May 2026" or "12-May" or "May 12, 2026"
  const textDmy = str.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)(?:[\s,\-]+(\d{2,4}))?$/);
  if (textDmy) {
    const month = MONTH_MAP[textDmy[2].toLowerCase()];
    if (!month) return null;
    let year = textDmy[3] ? Number(textDmy[3]) : defaultYear;
    if (year < 100) year += 2000;
    return buildIstDate(year, month, Number(textDmy[1]), hour, minute);
  }

  const textMdy = str.match(/^([A-Za-z]+)[\s\-]+(\d{1,2})(?:[\s,\-]+(\d{2,4}))?$/);
  if (textMdy) {
    const month = MONTH_MAP[textMdy[1].toLowerCase()];
    if (!month) return null;
    let year = textMdy[3] ? Number(textMdy[3]) : defaultYear;
    if (year < 100) year += 2000;
    return buildIstDate(year, month, Number(textMdy[2]), hour, minute);
  }

  return null;
}

/** Extracts clean text from any ExcelJS cell value without evaluating macros. */
export function extractExcelCellValue(raw) {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw;
  if (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "object") {
    if (Array.isArray(raw.richText)) return raw.richText.map((part) => part.text ?? "").join("");
    if ("result" in raw && raw.result !== undefined) return raw.result;
    if ("text" in raw && typeof raw.text === "string") return raw.text;
    if ("hyperlink" in raw && typeof raw.hyperlink === "string") return raw.text ?? raw.hyperlink;
  }
  return String(raw);
}

/** Sanitizes an Excel worksheet name (<=31 chars, no []:*?/\, unique). */
export function safeSheetName(name, usedNames = new Set()) {
  const cleaned = String(name || "Sheet")
    .replace(/[\[\]:*?\/\\]/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";
  if (!usedNames.has(cleaned)) {
    usedNames.add(cleaned);
    return cleaned;
  }
  for (let i = 2; i < 100; i += 1) {
    const suffix = ` (${i})`;
    const candidate = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  return cleaned;
}

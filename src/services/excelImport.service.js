import crypto from "node:crypto";
import path from "node:path";
import ExcelJS from "exceljs";
import { ApiError } from "../utils/ApiError.js";
import { LEAD_QUALITIES, LEAD_SOURCES } from "../models/common.js";
import { normaliseCallResponse } from "../utils/crmMappings.js";
import { avatarColorFor, normalisePhone, prettyPhone } from "../utils/format.js";
import {
  extractExcelCellValue,
  formatIstDateKey,
  parseCsvBuffer,
  parseSpreadsheetDate,
} from "../utils/spreadsheetSafety.js";
import { Client } from "../models/Client.js";
import { Lead } from "../models/Lead.js";
import { LeadVisit } from "../models/LeadVisit.js";

export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const IMPORT_MAX_SHEETS = 10;
export const IMPORT_MAX_ROWS_PER_SHEET = 5000;
export const IMPORT_MAX_TOTAL_ROWS = 5000;
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".csv"]);

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normaliseHeaderText(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseSheetName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function isEmptyRow(cells) {
  return !cells.some((c) => String(extractExcelCellValue(c) ?? "").trim() !== "");
}

function mapQuality(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { quality: undefined, rawQuality: undefined, warning: null };
  const upper = text.toUpperCase().replace(/\s+/g, " ");
  if (LEAD_QUALITIES.includes(upper)) {
    return { quality: upper, rawQuality: text, warning: null };
  }
  return {
    quality: undefined,
    rawQuality: text,
    warning: `Unmapped quality value "${text}" left unclassified`,
  };
}

function mapSource(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { source: "Other", rawSource: "" };
  const upper = text.toUpperCase();
  if (LEAD_SOURCES.some((s) => s.toUpperCase() === upper)) {
    const match = LEAD_SOURCES.find((s) => s.toUpperCase() === upper);
    return { source: match, rawSource: text };
  }
  if (upper.includes("WHATSAPP") || upper === "WA") return { source: "WhatsApp", rawSource: text };
  if (upper.includes("WEB") || upper.includes("SITE") || upper.includes("GOOGLE")) return { source: "Website", rawSource: text };
  if (upper.includes("REF")) return { source: "Referral", rawSource: text };
  if (upper.includes("CALL") || upper.includes("PHONE")) return { source: "Phone Call", rawSource: text };
  if (upper.includes("WALK") || upper.includes("OFFICE")) return { source: "Office Walk-in", rawSource: text };
  return { source: "Other", rawSource: text };
}

function parseVisitCell(rawVisit, contextStatus, rowAddress, fallbackDate) {
  const rawText = [rawVisit, contextStatus].map((v) => String(v ?? "").trim()).filter(Boolean).join(" · ");
  if (!rawText) return { visitCandidate: null, rawVisitNote: "", warnings: [] };

  const upper = rawText.toUpperCase();
  let mappedStatus = null;
  if (upper.includes("VISIT DONE") || upper.includes("VISITED")) mappedStatus = "COMPLETED";
  else if (upper.includes("VISIT CANCEL")) mappedStatus = "CANCELLED";
  else if (upper.includes("VISIT PLAN") || upper.includes("VISIT SCHEDULE")) mappedStatus = "SCHEDULED";

  if (!mappedStatus) {
    if (upper.includes("VISIT")) {
      return {
        visitCandidate: null,
        rawVisitNote: rawText,
        warnings: [`Ambiguous visit note "${rawText}" preserved for manual review`],
      };
    }
    return { visitCandidate: null, rawVisitNote: "", warnings: [] };
  }

  // Try extracting explicit date from rawVisit text, otherwise check if a valid row date exists.
  const inlineDateMatch = rawText.match(/(\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\s\-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*(?:[\s,\-]+\d{2,4})?)/i);
  const visitDate = inlineDateMatch ? parseSpreadsheetDate(inlineDateMatch[1]) : fallbackDate;

  const warnings = [];
  if (!visitDate) {
    warnings.push(`Visit "${rawText}" missing a valid date; preserved in notes for manual scheduling`);
  }
  const address = String(rowAddress ?? "").trim();
  if (!address || address.length < 3) {
    warnings.push(`Visit "${rawText}" missing location address; preserved in notes for manual scheduling`);
  }

  if (warnings.length > 0) {
    return { visitCandidate: null, rawVisitNote: rawText, warnings };
  }

  if (mappedStatus === "COMPLETED") {
    return {
      visitCandidate: null,
      rawVisitNote: rawText,
      warnings: [`Historical "${rawText}" has no verified customer outcome; preserved for manual Admin review`],
    };
  }

  return {
    visitCandidate: {
      status: mappedStatus,
      visitType: "SITE_VISIT",
      title: `Imported Visit (${mappedStatus === "CANCELLED" ? "Cancelled" : "Planned"})`,
      scheduledStart: visitDate.toISOString(),
      locationType: "CUSTOMER_LOCATION",
      locationAddress: address.slice(0, 500),
      cancellationReason: mappedStatus === "CANCELLED" ? `Imported from Excel: ${rawText}` : "",
      notes: `Imported from Excel: ${rawText}`,
    },
    rawVisitNote: rawText,
    warnings: [],
  };
}

function classifyHeaders(headerCells) {
  const columns = [];
  const usedRoles = new Set();
  const statusColumnIndices = [];
  const unmappedHeaders = [];

  headerCells.forEach((cell, idx) => {
    const rawHeader = String(extractExcelCellValue(cell) ?? "").trim();
    if (!rawHeader) return;
    const norm = normaliseHeaderText(rawHeader);
    if (norm === "STATUS" || norm === "LEAD STATUS") statusColumnIndices.push(idx);
    columns.push({ index: idx, rawHeader, norm, role: null, followUpDate: null });
  });

  for (const col of columns) {
    const { norm, index } = col;
    if (/^(S NO|SR NO|SL NO|SERIAL|SERIAL NO)$/.test(norm) && !usedRoles.has("serial")) {
      col.role = "serial";
      usedRoles.add("serial");
    } else if (/^(ADD|AD|SOURCE|AD SOURCE|CAMPAIGN|PLATFORM)$/.test(norm) && !usedRoles.has("source")) {
      col.role = "source";
      usedRoles.add("source");
    } else if (/^(TIME|ENQUIRY TIME)$/.test(norm) && !usedRoles.has("time")) {
      col.role = "time";
      usedRoles.add("time");
    } else if (/^(DATE|ENQUIRY DATE|LEAD DATE)$/.test(norm) && !usedRoles.has("date")) {
      col.role = "date";
      usedRoles.add("date");
    } else if (/^(NAME|CLIENT NAME|CUSTOMER NAME|PARTY NAME)$/.test(norm) && !usedRoles.has("name")) {
      col.role = "name";
      usedRoles.add("name");
    } else if (/^(CONTACT|PHONE|MOBILE|CONTACT NO|PHONE NO|MOBILE NO|PRIMARY PHONE)$/.test(norm) && !usedRoles.has("phone")) {
      col.role = "phone";
      usedRoles.add("phone");
    } else if (/^(OTHER NO|ALTERNATE NO|ALTERNATE PHONE|ALT NO|ALT PHONE|OTHER CONTACT)$/.test(norm) && !usedRoles.has("alternatePhone")) {
      col.role = "alternatePhone";
      usedRoles.add("alternatePhone");
    } else if (/^(ADDRESS|LOCATION|CITY|SITE ADDRESS)$/.test(norm) && !usedRoles.has("address")) {
      col.role = "address";
      usedRoles.add("address");
    } else if (/^(DETAILS|REQUIREMENT|REQUIREMENTS|DETAILS\s*\/\s*REQUIREMENT|PROJECT DETAILS|DESCRIPTION|REMARKS|NOTE|NOTES)$/.test(norm) && !usedRoles.has("details")) {
      col.role = "details";
      usedRoles.add("details");
    } else if (/^(SERVICE|CATEGORY|PRODUCT)$/.test(norm) && !usedRoles.has("service")) {
      col.role = "service";
      usedRoles.add("service");
    } else if (/^(VISIT|VISIT PLAN|VISIT STATUS)$/.test(norm) && !usedRoles.has("visit")) {
      col.role = "visit";
      usedRoles.add("visit");
    } else if (/^(QUALITY|LEAD QUALITY)$/.test(norm) && !usedRoles.has("quality")) {
      col.role = "quality";
      usedRoles.add("quality");
    } else if (norm === "STATUS" || norm === "LEAD STATUS") {
      // Position-aware handling for duplicate STATUS headers: first is quality unless already taken, second is contextStatus.
      if (!usedRoles.has("quality") && index === statusColumnIndices[0]) {
        col.role = "quality";
        usedRoles.add("quality");
      } else if (!usedRoles.has("contextStatus")) {
        col.role = "contextStatus";
        usedRoles.add("contextStatus");
      } else {
        col.role = "followUpColumn";
      }
    } else {
      const headerDate = parseSpreadsheetDate(extractExcelCellValue(headerCells[index]));
      if (headerDate || /^(FOLLOW UP|FOLLOWUP|CALL|FU|RESPONSE)\b/.test(norm)) {
        col.role = "followUpColumn";
        col.followUpDate = headerDate ? headerDate.toISOString() : null;
      } else {
        unmappedHeaders.push(col.rawHeader);
      }
    }
  }

  return { columns, unmappedHeaders };
}

function detectHeaderRow(rows) {
  const limit = Math.min(rows.length, 15);
  let bestIdx = 0;
  let bestScore = -1;
  const headerKeywords = /^(S NO|SR NO|NAME|CLIENT NAME|CONTACT|PHONE|MOBILE|DATE|TIME|ADD|DETAILS|STATUS|VISIT|ADDRESS)$/;

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] ?? [];
    let score = 0;
    for (const cell of row) {
      const norm = normaliseHeaderText(extractExcelCellValue(cell));
      if (headerKeywords.test(norm)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= 2 ? bestIdx : 0;
}

/**
 * Parses an uploaded .xlsx or .csv buffer in memory with strict bounds.
 */
export async function parseWorkbookBuffer(buffer, originalName) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest("Uploaded spreadsheet file is empty");
  }
  if (buffer.length > IMPORT_MAX_FILE_BYTES) {
    throw new ApiError(413, `Spreadsheet exceeds maximum size of ${Math.round(IMPORT_MAX_FILE_BYTES / (1024 * 1024))} MB`);
  }

  const ext = path.extname(originalName || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw ApiError.badRequest("Only .xlsx and .csv files are supported for lead import");
  }

  const fileSha256 = sha256(buffer);
  const sheets = [];

  if (ext === ".csv") {
    const rawRows = parseCsvBuffer(buffer);
    if (rawRows.length > IMPORT_MAX_ROWS_PER_SHEET) {
      throw ApiError.badRequest(`CSV exceeds the maximum limit of ${IMPORT_MAX_ROWS_PER_SHEET} rows`);
    }
    sheets.push({
      name: "CSV",
      normalizedName: "CSV",
      rows: rawRows,
    });
    return { fileFormat: "csv", fileSha256, sheets };
  }

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest("Malformed or unreadable .xlsx workbook");
  }

  if (!workbook.worksheets.length) {
    throw ApiError.badRequest("Workbook contains no worksheets");
  }
  if (workbook.worksheets.length > IMPORT_MAX_SHEETS) {
    throw ApiError.badRequest(`Workbook exceeds maximum limit of ${IMPORT_MAX_SHEETS} worksheets`);
  }

  let totalRows = 0;
  for (const ws of workbook.worksheets) {
    if (ws.rowCount > IMPORT_MAX_ROWS_PER_SHEET) {
      throw ApiError.badRequest(`Worksheet "${ws.name}" exceeds maximum limit of ${IMPORT_MAX_ROWS_PER_SHEET} rows`);
    }
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push({ rowNumber, values });
    });
    totalRows += rows.length;
    if (totalRows > IMPORT_MAX_TOTAL_ROWS) {
      throw ApiError.badRequest(`Workbook exceeds maximum total limit of ${IMPORT_MAX_TOTAL_ROWS} rows`);
    }
    sheets.push({
      name: ws.name,
      normalizedName: normaliseSheetName(ws.name),
      rows: rows.map((r) => r.values),
      rowNumbers: rows.map((r) => r.rowNumber),
    });
  }

  return { fileFormat: "xlsx", fileSha256, sheets };
}

function makeFingerprint({ phone, rawSource, requirement, enquiryDateKey }) {
  const normSource = String(rawSource ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const normReq = String(requirement ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  return sha256(`${phone}|${normSource}|${normReq}|${enquiryDateKey || ""}`);
}

function validateNormalizedPhone(raw) {
  const digits = normalisePhone(String(raw ?? ""));
  if (!digits || digits.length < 10 || digits.length > 15) return null;
  if (/^(\d)\1{9,}$/.test(digits)) return null;
  return digits;
}

/**
 * Analyses parsed sheets into a complete preview + server-held import snapshot.
 */
export async function buildImportPreview({ parsedWorkbook, fileName, fileSizeBytes, selectedSheetsInput }) {
  const worksheetNames = parsedWorkbook.sheets.map((s) => s.name);
  const selectedSet = Array.isArray(selectedSheetsInput) && selectedSheetsInput.length
    ? new Set(selectedSheetsInput.map(normaliseSheetName))
    : new Set(parsedWorkbook.sheets.map((s) => s.normalizedName));

  const selectedSheets = parsedWorkbook.sheets.filter((s) => selectedSet.has(s.normalizedName));
  if (!selectedSheets.length) {
    throw ApiError.badRequest("Select at least one valid worksheet to preview");
  }

  const parsedCandidates = [];
  const sheetReports = [];
  const candidatePhones = new Set();
  const candidateFingerprints = new Set();

  for (const sheet of selectedSheets) {
    const rawRows = sheet.rows;
    const rowNumbers = sheet.rowNumbers ?? rawRows.map((_, idx) => idx + 1);
    if (!rawRows.length) {
      sheetReports.push({ sheetName: sheet.name, normalizedName: sheet.normalizedName, headers: [], columnMapping: [], unmappedHeaders: [], rowCount: 0 });
      continue;
    }

    const headerIdx = detectHeaderRow(rawRows);
    const headerRow = rawRows[headerIdx] ?? [];
    const { columns, unmappedHeaders } = classifyHeaders(headerRow);

    sheetReports.push({
      sheetName: sheet.name,
      normalizedName: sheet.normalizedName,
      headerRowNumber: rowNumbers[headerIdx] ?? headerIdx + 1,
      headers: columns.map((c) => c.rawHeader),
      columnMapping: columns.map((c) => ({ header: c.rawHeader, mappedTo: c.role ?? "unmapped", followUpDate: c.followUpDate })),
      unmappedHeaders,
      rowCount: Math.max(0, rawRows.length - headerIdx - 1),
    });

    const byRole = new Map();
    const followUpCols = [];
    for (const col of columns) {
      if (col.role === "followUpColumn") followUpCols.push(col);
      else if (col.role) byRole.set(col.role, col);
    }

    for (let i = headerIdx + 1; i < rawRows.length; i += 1) {
      const cells = rawRows[i] ?? [];
      if (isEmptyRow(cells)) continue;

      const sourceRow = rowNumbers[i] ?? i + 1;
      const getVal = (role) => {
        const col = byRole.get(role);
        return col ? extractExcelCellValue(cells[col.index]) : "";
      };

      const rawSerial = String(getVal("serial") ?? "").trim();
      const rawName = String(getVal("name") ?? "").trim();
      const rawPhone = getVal("phone");
      const rawAltPhone = getVal("alternatePhone");
      const rawDate = getVal("date");
      const rawTime = getVal("time");
      const rawAddress = String(getVal("address") ?? "").trim();
      const rawDetails = String(getVal("details") ?? "").trim();
      const rawService = String(getVal("service") ?? "").trim();
      const rawQualityCell = getVal("quality");
      const rawContextStatus = String(getVal("contextStatus") ?? "").trim();
      const rawVisit = String(getVal("visit") ?? "").trim();
      const rawSourceVal = getVal("source");

      const errors = [];
      const warnings = [];

      const phone = validateNormalizedPhone(rawPhone);
      if (!phone) {
        errors.push("Missing or invalid primary contact number (requires 10+ digits)");
      }
      const alternatePhone = rawAltPhone ? validateNormalizedPhone(rawAltPhone) : undefined;
      if (rawAltPhone && String(rawAltPhone).trim() && !alternatePhone) {
        warnings.push(`Ignored invalid alternate phone "${String(rawAltPhone).trim()}"`);
      }

      const clientName = rawName || (phone ? prettyPhone(phone) : "");
      if (!rawName) warnings.push("Customer name missing; defaulted to formatted contact number");

      let enquiryDate = null;
      if (rawDate !== "" && rawDate !== null && rawDate !== undefined) {
        enquiryDate = parseSpreadsheetDate(rawDate, rawTime);
        if (!enquiryDate) {
          warnings.push(`Invalid enquiry date "${String(rawDate)}" preserved in metadata`);
        }
      }
      const enquiryDateKey = enquiryDate ? formatIstDateKey(enquiryDate) : "";

      const { source, rawSource } = mapSource(rawSourceVal);
      const { quality, rawQuality, warning: qualityWarning } = mapQuality(rawQualityCell);
      if (qualityWarning) warnings.push(qualityWarning);

      const requirement = rawDetails || rawSource || "Imported enquiry";
      const service = rawService || "Other";

      const historicalFollowUps = [];
      for (const col of followUpCols) {
        const cellText = String(extractExcelCellValue(cells[col.index]) ?? "").trim();
        if (!cellText) continue;
        const mappedResponse = normaliseCallResponse(cellText);
        if (!mappedResponse) {
          warnings.push(`Preserved unmapped follow-up note "${cellText}" under "${col.rawHeader}"`);
        }
        historicalFollowUps.push({
          callDate: col.followUpDate,
          rawDateLabel: col.rawHeader,
          callResponse: mappedResponse,
          rawResponse: cellText,
          note: "",
          sourceSheet: sheet.name,
          sourceRow,
        });
      }

      if (rawContextStatus) {
        const contextMapped = normaliseCallResponse(rawContextStatus);
        if (contextMapped || (!rawVisit && rawContextStatus)) {
          historicalFollowUps.push({
            callDate: enquiryDate ? enquiryDate.toISOString() : null,
            rawDateLabel: "STATUS",
            callResponse: contextMapped,
            rawResponse: rawContextStatus,
            note: "",
            sourceSheet: sheet.name,
            sourceRow,
          });
        }
      }

      const { visitCandidate, rawVisitNote, warnings: visitWarnings } = parseVisitCell(
        rawVisit,
        rawContextStatus,
        rawAddress,
        enquiryDate
      );
      if (visitWarnings.length) warnings.push(...visitWarnings);

      const fingerprint = phone ? makeFingerprint({ phone, rawSource, requirement, enquiryDateKey }) : null;
      if (phone) candidatePhones.add(phone);
      if (fingerprint) candidateFingerprints.add(fingerprint);

      parsedCandidates.push({
        sheetName: sheet.name,
        normalizedSheetName: sheet.normalizedName,
        sourceRow,
        sourceSerial: rawSerial,
        clientName,
        contactPersonName: rawName || undefined,
        phone,
        alternatePhone,
        service,
        requirement: requirement.slice(0, 5000),
        description: [rawDetails, rawAddress ? `Address: ${rawAddress}` : ""].filter(Boolean).join("\n"),
        source,
        rawSource,
        quality,
        rawQuality,
        rawAddress,
        enquiryDate: enquiryDate ? enquiryDate.toISOString() : null,
        enquiryDateKey,
        historicalFollowUps,
        visitCandidate,
        rawVisitNote,
        visitWarnings,
        fingerprint,
        errors,
        warnings,
      });
    }
  }

  // Query existing database leads for duplicate detection (never mutates existing leads).
  const [existingByFingerprint, existingByPhone] = await Promise.all([
    candidateFingerprints.size
      ? Lead.find({ "importMetadata.fingerprint": { $in: [...candidateFingerprints] } })
          .select("code clientName phone requirement source enquiryDate importMetadata.fingerprint")
          .lean()
      : [],
    candidatePhones.size
      ? Lead.find({ phone: { $in: [...candidatePhones] } })
          .select("code clientName phone requirement source enquiryDate")
          .lean()
      : [],
  ]);

  const dbFingerprintMap = new Map(
    existingByFingerprint.map((l) => [l.importMetadata?.fingerprint, l])
  );
  const dbPhoneMap = new Map();
  for (const lead of existingByPhone) {
    const arr = dbPhoneMap.get(lead.phone) ?? [];
    arr.push(lead);
    dbPhoneMap.set(lead.phone, arr);
  }

  const seenFingerprints = new Map();
  const seenPhones = new Map();

  let validRows = 0;
  let invalidRows = 0;
  let duplicateCount = 0;
  let ambiguousCount = 0;
  let followUpHistoryCount = 0;
  let visitCandidateCount = 0;
  let visitWarningCount = 0;

  const previewRows = parsedCandidates.map((row) => {
    let status = "IMPORTABLE";
    let duplicateReason = null;

    if (row.errors.length > 0) {
      status = "INVALID";
      invalidRows += 1;
    } else if (row.fingerprint && dbFingerprintMap.has(row.fingerprint)) {
      const match = dbFingerprintMap.get(row.fingerprint);
      status = "DUPLICATE_EXISTING";
      duplicateReason = `Already exists in CRM as ${match.code ?? String(match._id)}`;
      duplicateCount += 1;
    } else if (row.fingerprint && seenFingerprints.has(row.fingerprint)) {
      const prior = seenFingerprints.get(row.fingerprint);
      status = "DUPLICATE_WORKBOOK";
      duplicateReason = `Overlaps with ${prior.sheetName} row ${prior.sourceRow}`;
      duplicateCount += 1;
    } else {
      // Check phone-only matches (same customer phone with different campaign/date/requirement) -> AMBIGUOUS warning, still importable.
      const dbPhoneMatches = dbPhoneMap.get(row.phone) ?? [];
      const exactDbSemanticMatch = dbPhoneMatches.find(
        (m) =>
          String(m.requirement ?? "").trim().toLowerCase() === row.requirement.trim().toLowerCase() &&
          formatIstDateKey(m.enquiryDate) === row.enquiryDateKey
      );
      if (exactDbSemanticMatch) {
        status = "DUPLICATE_EXISTING";
        duplicateReason = `Matches existing CRM lead ${exactDbSemanticMatch.code ?? String(exactDbSemanticMatch._id)} (same phone, requirement & date)`;
        duplicateCount += 1;
      } else {
        if (dbPhoneMatches.length > 0) {
          ambiguousCount += 1;
          row.warnings.push(`Phone matches existing CRM lead ${dbPhoneMatches[0].code ?? ""} with different enquiry/date (kept as separate enquiry)`);
        } else if (seenPhones.has(row.phone)) {
          const priorPhone = seenPhones.get(row.phone);
          ambiguousCount += 1;
          row.warnings.push(`Same phone appears in ${priorPhone.sheetName} row ${priorPhone.sourceRow} with different enquiry`);
        }
        validRows += 1;
        followUpHistoryCount += row.historicalFollowUps.length;
        if (row.visitCandidate) visitCandidateCount += 1;
        visitWarningCount += row.visitWarnings.length;
      }
      if (row.fingerprint) seenFingerprints.set(row.fingerprint, row);
      if (row.phone && !seenPhones.has(row.phone)) seenPhones.set(row.phone, row);
    }

    return { ...row, previewStatus: status, duplicateReason };
  });

  return {
    fileName,
    fileFormat: parsedWorkbook.fileFormat,
    fileSizeBytes,
    fileSha256: parsedWorkbook.fileSha256,
    worksheetNames,
    selectedSheets: selectedSheets.map((s) => s.name),
    sheets: sheetReports,
    summary: {
      totalRows: previewRows.length,
      validRows,
      invalidRows,
      duplicateCount,
      ambiguousCount,
      followUpHistoryCount,
      visitCandidateCount,
      visitWarningCount,
    },
    rows: previewRows,
  };
}

/**
 * Executes a confirmed server-held preview snapshot safely.
 */
export async function executeImportSnapshot({ snapshot, importJob, adminUser, selectedSheetsOverride, importMode }) {
  const selectedSet = Array.isArray(selectedSheetsOverride) && selectedSheetsOverride.length
    ? new Set(selectedSheetsOverride.map(normaliseSheetName))
    : new Set(snapshot.selectedSheets.map(normaliseSheetName));

  const targetRows = snapshot.rows.filter((r) => selectedSet.has(r.normalizedSheetName));
  const now = new Date();

  let createdCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let followUpHistoryCount = 0;
  let visitHistoryCount = 0;
  let visitWarningCount = 0;
  const errorSummaries = [];

  if (importMode === "DRY_RUN") {
    for (const row of targetRows) {
      if (row.previewStatus === "INVALID") {
        failedCount += 1;
        errorSummaries.push({ sheet: row.sheetName, rowNumber: row.sourceRow, code: "VALIDATION", message: row.errors.join("; ") });
      } else if (row.previewStatus === "DUPLICATE_EXISTING" || row.previewStatus === "DUPLICATE_WORKBOOK") {
        duplicateCount += 1;
        skippedCount += 1;
      } else {
        createdCount += 1;
        followUpHistoryCount += row.historicalFollowUps.length;
        if (row.visitCandidate) visitHistoryCount += 1;
        visitWarningCount += row.visitWarnings.length;
      }
    }
    return {
      status: "COMPLETED",
      selectedSheets: [...selectedSet],
      totalRows: targetRows.length,
      validRows: createdCount,
      createdCount,
      duplicateCount,
      skippedCount,
      failedCount,
      followUpHistoryCount,
      visitHistoryCount,
      visitWarningCount,
      errorSummaries: errorSummaries.slice(0, 200),
    };
  }

  for (const row of targetRows) {
    if (row.previewStatus === "INVALID") {
      failedCount += 1;
      errorSummaries.push({
        sheet: row.sheetName,
        rowNumber: row.sourceRow,
        code: "VALIDATION",
        message: row.errors.join("; "),
      });
      continue;
    }

    if (row.previewStatus === "DUPLICATE_EXISTING" || row.previewStatus === "DUPLICATE_WORKBOOK") {
      duplicateCount += 1;
      skippedCount += 1;
      continue;
    }

    try {
      // Re-check DB fingerprint at commit time for strict repeat-import idempotency.
      const existingDup = row.fingerprint
        ? await Lead.findOne({ "importMetadata.fingerprint": row.fingerprint }).select("_id code").lean()
        : null;
      if (existingDup) {
        duplicateCount += 1;
        skippedCount += 1;
        continue;
      }

      let client = await Client.findOne({ phone: row.phone });
      if (!client) {
        try {
          client = await Client.create({
            name: row.clientName,
            phone: row.phone,
            phoneDisplay: prettyPhone(row.phone),
            avatarColor: avatarColorFor(row.phone),
          });
        } catch (err) {
          if (err?.code === 11000 && err.keyPattern?.phone) {
            client = await Client.findOne({ phone: row.phone });
          } else {
            throw err;
          }
        }
      }

      const historicalFollowUps = row.historicalFollowUps.map((f) => ({
        callDate: f.callDate ? new Date(f.callDate) : undefined,
        rawDateLabel: f.rawDateLabel,
        callResponse: f.callResponse ?? null,
        rawResponse: f.rawResponse,
        note: f.note ?? "",
        sourceSheet: f.sourceSheet,
        sourceRow: f.sourceRow,
        importJobId: importJob._id,
        importedAt: now,
      }));

      const lead = await Lead.create({
        clientId: client._id,
        clientName: row.clientName,
        contactPersonName: row.contactPersonName,
        phone: row.phone,
        alternatePhone: row.alternatePhone,
        service: row.service,
        requirement: row.requirement,
        description: row.description,
        source: row.source,
        quality: row.quality,
        status: "New",
        enquiryDate: row.enquiryDate ? new Date(row.enquiryDate) : undefined,
        submissionKey: row.fingerprint ? `import:${row.fingerprint}` : undefined,
        historicalFollowUps,
        importMetadata: {
          importJobId: importJob._id,
          sourceFileName: snapshot.fileName,
          sourceSheet: row.sheetName,
          sourceRow: row.sourceRow,
          sourceSerial: row.sourceSerial,
          rawSource: row.rawSource,
          rawQuality: row.rawQuality,
          rawAddress: row.rawAddress,
          rawVisitNote: row.rawVisitNote,
          visitWarnings: row.visitWarnings,
          fingerprint: row.fingerprint,
          importedAt: now,
        },
        qualityHistory: row.quality
          ? [
              {
                fromQuality: null,
                toQuality: row.quality,
                actor: `Excel Import (${adminUser.name})`,
                actorId: adminUser._id,
                actorRole: adminUser.role,
                reason: `Imported from ${row.sheetName} row ${row.sourceRow}`,
                timestamp: now,
              },
            ]
          : [],
        activity: [
          {
            label: "Lead imported from Excel",
            actor: `Excel Import (${adminUser.name})`,
            description: `Sheet "${row.sheetName}" row ${row.sourceRow}`,
            timestamp: now,
          },
        ],
      });

      createdCount += 1;
      followUpHistoryCount += historicalFollowUps.length;
      visitWarningCount += row.visitWarnings.length;

      if (row.visitCandidate) {
        await LeadVisit.create({
          leadId: lead._id,
          createdBy: adminUser._id,
          visitType: row.visitCandidate.visitType,
          title: row.visitCandidate.title,
          scheduledStart: new Date(row.visitCandidate.scheduledStart),
          timezone: "Asia/Kolkata",
          locationType: row.visitCandidate.locationType,
          locationAddress: row.visitCandidate.locationAddress,
          status: row.visitCandidate.status,
          customerContactPerson: row.contactPersonName,
          notes: row.visitCandidate.notes,
          cancellationReason: row.visitCandidate.cancellationReason,
          cancelledAt: row.visitCandidate.status === "CANCELLED" ? now : undefined,
          idempotencyKey: `import:${row.fingerprint}:visit`,
          history: [
            {
              eventType: row.visitCandidate.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
              previousStatus: null,
              newStatus: row.visitCandidate.status,
              newSchedule: { start: new Date(row.visitCandidate.scheduledStart) },
              actorId: adminUser._id,
              actorName: `Excel Import (${adminUser.name})`,
              actorRole: adminUser.role,
              note: `Imported from ${row.sheetName} row ${row.sourceRow}`,
              timestamp: now,
            },
          ],
        });
        visitHistoryCount += 1;
      }
    } catch (err) {
      if (err?.code === 11000 && err.keyPattern?.submissionKey) {
        duplicateCount += 1;
        skippedCount += 1;
      } else {
        failedCount += 1;
        errorSummaries.push({
          sheet: row.sheetName,
          rowNumber: row.sourceRow,
          code: "PERSIST_ERROR",
          message: err?.message ? String(err.message).slice(0, 300) : "Failed to save row",
        });
      }
    }
  }

  const finalStatus = failedCount > 0 && createdCount === 0 ? "FAILED" : failedCount > 0 ? "PARTIAL" : "COMPLETED";
  return {
    status: finalStatus,
    selectedSheets: [...selectedSet],
    totalRows: targetRows.length,
    validRows: createdCount,
    createdCount,
    duplicateCount,
    skippedCount,
    failedCount,
    followUpHistoryCount,
    visitHistoryCount,
    visitWarningCount,
    errorSummaries: errorSummaries.slice(0, 200),
  };
}

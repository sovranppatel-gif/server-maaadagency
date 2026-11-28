import crypto from "node:crypto";
import { ImportJob } from "../models/ImportJob.js";
import { Lead } from "../models/Lead.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import {
  buildImportPreview,
  executeImportSnapshot,
  parseWorkbookBuffer,
  PREVIEW_TTL_MS,
} from "../services/excelImport.service.js";
import { generateLeadsExport } from "../services/excelExport.service.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseSelectedSheetsField(raw) {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch {
        throw ApiError.badRequest("Invalid selectedSheets JSON array");
      }
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function parseIstBoundary(raw, endOfDay = false) {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`
    : trimmed;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`Invalid date filter: ${raw}`);
  return d;
}

/** POST /api/leads/import/preview */
export const previewLeadImport = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("Please upload an .xlsx or .csv file");

  const selectedSheetsInput = parseSelectedSheetsField(req.body?.selectedSheets);
  const parsed = await parseWorkbookBuffer(req.file.buffer, req.file.originalname);
  const preview = await buildImportPreview({
    parsedWorkbook: parsed,
    fileName: req.file.originalname,
    fileSizeBytes: req.file.size,
    selectedSheetsInput,
  });

  const previewToken = crypto.randomBytes(32).toString("base64url");
  const previewTokenHash = hashToken(previewToken);
  const previewExpiresAt = new Date(Date.now() + PREVIEW_TTL_MS);

  const job = await ImportJob.create({
    fileName: preview.fileName,
    fileFormat: preview.fileFormat,
    fileSizeBytes: preview.fileSizeBytes,
    fileSha256: preview.fileSha256,
    worksheetNames: preview.worksheetNames,
    selectedSheets: preview.selectedSheets,
    importedBy: req.user._id,
    importedByName: req.user.name,
    status: "PREVIEW",
    previewTokenHash,
    previewExpiresAt,
    previewSnapshot: preview,
    totalRows: preview.summary.totalRows,
    validRows: preview.summary.validRows,
    duplicateCount: preview.summary.duplicateCount,
    followUpHistoryCount: preview.summary.followUpHistoryCount,
    visitHistoryCount: preview.summary.visitCandidateCount,
    visitWarningCount: preview.summary.visitWarningCount,
  });

  return sendSuccess(res, {
    jobId: String(job._id),
    jobCode: job.code,
    previewToken,
    previewExpiresAt,
    fileName: preview.fileName,
    fileFormat: preview.fileFormat,
    worksheetNames: preview.worksheetNames,
    selectedSheets: preview.selectedSheets,
    sheets: preview.sheets,
    summary: preview.summary,
    rows: preview.rows.map((r) => ({
      sheetName: r.sheetName,
      sourceRow: r.sourceRow,
      sourceSerial: r.sourceSerial,
      clientName: r.clientName,
      phone: r.phone,
      alternatePhone: r.alternatePhone,
      service: r.service,
      requirement: r.requirement,
      source: r.source,
      rawSource: r.rawSource,
      quality: r.quality,
      rawQuality: r.rawQuality,
      enquiryDate: r.enquiryDate,
      historicalFollowUps: r.historicalFollowUps,
      visitCandidate: r.visitCandidate,
      rawVisitNote: r.rawVisitNote,
      previewStatus: r.previewStatus,
      duplicateReason: r.duplicateReason,
      errors: r.errors,
      warnings: r.warnings,
    })),
  });
});

/** POST /api/leads/import/confirm */
export const confirmLeadImport = asyncHandler(async (req, res) => {
  const { previewToken, selectedSheets, importMode } = req.body;
  const confirmIdempotencyKey = req.get("Idempotency-Key")?.trim();
  if (confirmIdempotencyKey && !/^[A-Za-z0-9_-]{8,100}$/.test(confirmIdempotencyKey)) {
    throw ApiError.badRequest("Invalid Idempotency-Key header");
  }

  if (confirmIdempotencyKey) {
    const existingByKey = await ImportJob.findOne({
      confirmIdempotencyKey,
      importedBy: req.user._id,
    }).select("-previewSnapshot -previewTokenHash");
    if (existingByKey) {
      return sendSuccess(res, existingByKey.toJSON());
    }
  }

  const tokenHash = hashToken(previewToken);
  const now = new Date();

  const claimed = await ImportJob.findOneAndUpdate(
    {
      previewTokenHash: tokenHash,
      importedBy: req.user._id,
      status: "PREVIEW",
      previewExpiresAt: { $gt: now },
    },
    {
      $set: {
        status: "PROCESSING",
        startedAt: now,
        importMode,
        ...(confirmIdempotencyKey ? { confirmIdempotencyKey } : {}),
      },
    },
    { new: true }
  ).select("+previewSnapshot +previewExpiresAt");

  if (!claimed) {
    const existing = await ImportJob.findOne({ previewTokenHash: tokenHash }).select("status previewExpiresAt importedBy").lean();
    if (!existing || String(existing.importedBy) !== String(req.user._id)) {
      throw ApiError.badRequest("Invalid preview token");
    }
    if (existing.status !== "PREVIEW") {
      throw ApiError.conflict("This import preview has already been confirmed");
    }
    throw ApiError.badRequest("This import preview has expired. Upload the workbook again.");
  }

  const snapshot = claimed.previewSnapshot;
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    throw ApiError.badRequest("Import preview snapshot is unavailable");
  }

  if (Array.isArray(selectedSheets) && selectedSheets.length) {
    const allowed = new Set(snapshot.worksheetNames.map((s) => s.trim().replace(/\s+/g, " ")));
    for (const s of selectedSheets) {
      if (!allowed.has(s.trim().replace(/\s+/g, " "))) {
        await ImportJob.updateOne({ _id: claimed._id }, { $set: { status: "PREVIEW" } });
        throw ApiError.badRequest(`Worksheet "${s}" was not part of the verified preview`);
      }
    }
  }

  const outcome = await executeImportSnapshot({
    snapshot,
    importJob: claimed,
    adminUser: req.user,
    selectedSheetsOverride: selectedSheets,
    importMode,
  });

  const finished = await ImportJob.findByIdAndUpdate(
    claimed._id,
    {
      $set: {
        ...outcome,
        completedAt: new Date(),
      },
      $unset: {
        previewSnapshot: 1,
        previewTokenHash: 1,
      },
    },
    { new: true }
  );

  return sendSuccess(res, finished.toJSON());
});

/** GET /api/leads/import/jobs */
export const listImportJobs = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { status: { $ne: "PREVIEW" } };

  const [items, total] = await Promise.all([
    ImportJob.find(filter)
      .select("-previewSnapshot -previewTokenHash -confirmIdempotencyKey")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ImportJob.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: buildMeta({ page, limit, total }) }
  );
});

/** GET /api/leads/import/jobs/:id */
export const getImportJob = asyncHandler(async (req, res) => {
  const job = await ImportJob.findOne(byIdOrCode(req.params.id))
    .select("-previewSnapshot -previewTokenHash -confirmIdempotencyKey");
  if (!job || job.status === "PREVIEW") throw ApiError.notFound("Import job not found");
  return sendSuccess(res, job.toJSON());
});

/** GET /api/leads/export */
export const exportLeads = asyncHandler(async (req, res) => {
  const query = q(req);
  const isEmployee = req.user?.role === "EMPLOYEE";
  const ownEmployeeId = req.user?.employee?._id ?? req.user?.employee;

  if (isEmployee) {
    if (!ownEmployeeId || !req.user.employee?.isActive) {
      throw ApiError.forbidden("An active employee account is required");
    }
    if (query.employeeId && query.employeeId !== "All" && String(query.employeeId) !== String(ownEmployeeId)) {
      throw ApiError.forbidden("Employees cannot export another employee's leads");
    }
  }

  const filter = {};
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [
      { clientName: rx },
      { contactPersonName: rx },
      { company: rx },
      { requirement: rx },
      { phone: rx },
      { email: rx },
      { code: rx },
      { service: rx },
      { quality: rx },
    ];
  }
  if (query.status && query.status !== "All") filter.status = query.status;
  if (query.priority && query.priority !== "All") filter.priority = query.priority;
  if (query.quality === "UNCLASSIFIED") filter.quality = null;
  else if (query.quality && query.quality !== "All") filter.quality = query.quality;
  if (query.source && query.source !== "All") filter.source = query.source;
  if (query.service && query.service !== "All") filter.service = query.service;

  const from = parseIstBoundary(query.from, false);
  const to = parseIstBoundary(query.to, true);
  if (from || to) {
    filter.createdAt = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }

  if (isEmployee) {
    filter.assignedEmployeeId = ownEmployeeId;
  } else if (query.employeeId && query.employeeId !== "All") {
    filter.assignedEmployeeId = query.employeeId === "unassigned" ? null : query.employeeId;
  }

  const result = await generateLeadsExport({
    filter,
    user: req.user,
    format: query.format ?? "xlsx",
    includeFollowUps: query.includeFollowUps === "true",
    includeVisits: query.includeVisits === "true",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="maaad-leads-${stamp}.${result.extension}"`);
  return res.status(200).send(result.buffer);
});

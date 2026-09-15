import fs from "node:fs/promises";
import path from "node:path";
import { FileAsset } from "../models/FileAsset.js";
import { Client } from "../models/Client.js";
import { Project } from "../models/Project.js";
import { Work } from "../models/Work.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, escapeRegex, getPagination } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { fileTypeFromName, formatBytes } from "../utils/format.js";
import { UPLOAD_ROOT } from "../middleware/upload.js";

const present = (doc) => ({ ...doc, id: String(doc._id), _id: undefined });

/** GET /api/files */
export const listFiles = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 30 });

  const filter = {};
  if (query.category && query.category !== "All") filter.category = query.category;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { clientName: rx }, { projectName: rx }, { uploadedBy: rx }];
  }

  const [items, total] = await Promise.all([
    FileAsset.find(filter).sort({ uploadedAt: -1 }).skip(skip).limit(limit).lean(),
    FileAsset.countDocuments(filter),
  ]);

  return sendSuccess(res, items.map(present), { meta: buildMeta({ page, limit, total }) });
});

/** GET /api/files/stats — per-category counts for the filter chips. */
export const fileStats = asyncHandler(async (_req, res) => {
  const [grouped, total] = await Promise.all([
    FileAsset.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
    FileAsset.countDocuments(),
  ]);
  return sendSuccess(res, {
    total,
    byCategory: Object.fromEntries(grouped.map((g) => [g._id, g.count])),
  });
});

/** POST /api/files — multipart upload of one or more files. */
export const uploadFiles = asyncHandler(async (req, res) => {
  const uploaded = req.files ?? [];
  if (!uploaded.length) throw ApiError.badRequest("No files were uploaded");

  const { category = "Documents", clientId, projectId, workId } = req.body;

  const [client, project, work] = await Promise.all([
    clientId ? Client.findById(clientId).lean() : null,
    projectId ? Project.findById(projectId).lean() : null,
    workId ? Work.findById(workId) : null,
  ]);

  const docs = await FileAsset.insertMany(
    uploaded.map((file) => ({
      name: file.originalname,
      storedName: file.filename,
      url: `/uploads/${file.filename}`,
      type: fileTypeFromName(file.originalname),
      category,
      size: formatBytes(file.size),
      bytes: file.size,
      mimeType: file.mimetype,
      clientId: client?._id,
      clientName: client ? client.company || client.name : undefined,
      projectId: project?._id,
      projectName: project?.name,
      workId: work?._id,
      uploadedBy: req.user?.name ?? "Admin",
      uploadedById: req.user?._id,
      uploadedAt: new Date(),
    }))
  );

  // Attach uploads to the work item so they show up in the review screen.
  if (work) {
    work.attachments.push(
      ...docs.map((d) => ({
        name: d.name,
        url: d.url,
        type: d.type,
        size: d.size,
        uploadedBy: d.uploadedBy,
        uploadedAt: d.uploadedAt,
      }))
    );
    await work.save();
  }

  return sendCreated(res, docs.map((d) => d.toJSON()));
});

/** DELETE /api/files/:id — removes the record and the file on disk. */
export const deleteFile = asyncHandler(async (req, res) => {
  const file = await FileAsset.findByIdAndDelete(req.params.id);
  if (!file) throw ApiError.notFound("File not found");

  if (file.storedName) {
    // Resolve inside the upload root so a crafted name cannot escape it.
    const target = path.resolve(UPLOAD_ROOT, path.basename(file.storedName));
    if (target.startsWith(UPLOAD_ROOT)) await fs.unlink(target).catch(() => null);
  }

  return sendSuccess(res, { id: String(file._id), deleted: true });
});

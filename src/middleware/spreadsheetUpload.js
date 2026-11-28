import path from "node:path";
import multer from "multer";
import { ApiError } from "../utils/ApiError.js";
import { IMPORT_MAX_FILE_BYTES } from "../services/excelImport.service.js";

const ALLOWED_EXT = new Set([".xlsx", ".csv"]);
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/octet-stream",
]);

export const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMPORT_MAX_FILE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(ApiError.badRequest("Unsupported file extension. Upload an .xlsx or .csv file."));
    }
    if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) {
      return cb(ApiError.badRequest(`Unsupported spreadsheet MIME type: ${file.mimetype}`));
    }
    return cb(null, true);
  },
});

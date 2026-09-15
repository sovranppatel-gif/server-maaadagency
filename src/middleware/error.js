import { ApiError } from "../utils/ApiError.js";
import { logger } from "../config/logger.js";
import { isProd } from "../config/env.js";

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/** Translates driver/library errors into clean, predictable API responses. */
function normalise(err) {
  if (err instanceof ApiError) return err;

  if (err?.name === "ValidationError") {
    const details = Object.values(err.errors || {}).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.unprocessable("Validation failed", details);
  }
  if (err?.name === "CastError") {
    return ApiError.badRequest(`Invalid value for ${err.path}`);
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] ?? "field";
    return ApiError.conflict(`A record with this ${field} already exists`);
  }
  if (err?.type === "entity.too.large") {
    return new ApiError(413, "Payload too large");
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return new ApiError(413, "Uploaded file exceeds the size limit");
  }
  return new ApiError(err.statusCode || 500, err.message || "Something went wrong");
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, _next) {
  const apiError = normalise(err);

  if (apiError.statusCode >= 500) {
    logger.error(apiError.message, { path: req.originalUrl, method: req.method, stack: err.stack });
  } else {
    logger.warn(apiError.message, { path: req.originalUrl, method: req.method });
  }

  const body = { success: false, error: { message: apiError.message } };
  if (apiError.details) body.error.details = apiError.details;
  if (!isProd && apiError.statusCode >= 500) body.error.stack = err.stack;

  res.status(apiError.statusCode).json(body);
}

import { ApiError } from "../utils/ApiError.js";

/**
 * Validates and replaces req.body / req.params / req.query with parsed data.
 * Express 5 exposes req.query as a getter, so parsed query values are stored
 * on req.validatedQuery instead of reassigning req.query.
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
    if (schemas.query) req.validatedQuery = schemas.query.parse(req.query ?? {});
    return next();
  } catch (err) {
    if (err?.issues) {
      const details = err.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
      return next(ApiError.unprocessable("Validation failed", details));
    }
    return next(err);
  }
};

/** Convenience accessor: validated query if present, raw query otherwise. */
export const q = (req) => req.validatedQuery ?? req.query ?? {};

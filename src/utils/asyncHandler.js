/**
 * Express 5 forwards rejected promises automatically, but wrapping keeps the
 * intent explicit and makes controllers portable across Express versions.
 */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

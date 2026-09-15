import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { User } from "../models/User.js";

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return req.cookies?.accessToken || null;
}

/** Requires a valid access token and attaches the live user to the request. */
export const protect = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized("Authentication token missing");

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized(err.name === "TokenExpiredError" ? "Session expired" : "Invalid token");
  }

  const user = await User.findById(payload.sub).populate("employee", "name role avatarColor");
  if (!user || !user.isActive) throw ApiError.unauthorized("Account is no longer active");

  req.user = user;
  return next();
});

/**
 * Role gate. MASTER_ADMIN implicitly passes every check so the owner account
 * never gets locked out of a feature.
 */
export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === "MASTER_ADMIN" || roles.includes(req.user.role)) return next();
  return next(ApiError.forbidden());
};

/** Attaches the user when a token is present, but never rejects the request. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = await User.findById(payload.sub);
  } catch {
    // Ignore: this route works fine anonymously.
  }
  return next();
});

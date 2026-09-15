import rateLimit from "express-rate-limit";
import { isProd } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const handler = (_req, _res, next) => next(ApiError.tooMany());

/** Broad protection for the whole API surface. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 600 : 5000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
});

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 10 : 100,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
});

import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { hashCredentialToken } from "../utils/credentialToken.js";
import { isProd } from "../config/env.js";

const REFRESH_COOKIE = "refreshToken";

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "strict" : "lax",
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/** Shapes a user for the dashboard's AdminUser type. */
function presentUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    avatarColor: user.avatarColor,
    employeeId: user.employee ? String(user.employee._id ?? user.employee) : undefined,
  };
}

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() })
    .select("+passwordHash +tokenVersion")
    .populate("employee", "isActive");
  // Same message for unknown email and wrong password: no account enumeration.
  if (!user || !user.passwordHash || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  if (!user.isActive) throw ApiError.forbidden("This account has been deactivated");
  if (user.role === "EMPLOYEE" && (!user.employee || !user.employee.isActive)) {
    throw ApiError.forbidden("This employee account is inactive");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user, user.tokenVersion);

  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
  return sendSuccess(res, { user: presentUser(user), accessToken, refreshToken });
});

/** POST /api/auth/register (MASTER_ADMIN only) */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  if ((role ?? "ADMIN") !== "ADMIN") {
    throw ApiError.forbidden("Employee login accounts must be created through the employee invitation flow");
  }

  if (await User.exists({ email: email.toLowerCase() })) {
    throw ApiError.conflict("An account with this email already exists");
  }

  const user = await User.create({
    name,
    email,
    role: role ?? "ADMIN",
    passwordHash: await User.hashPassword(password),
  });

  return sendCreated(res, presentUser(user));
});

/** POST /api/auth/refresh */
export const refresh = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized("Refresh token missing");

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized("Refresh token is invalid or expired");
  }

  const user = await User.findById(payload.sub)
    .select("+tokenVersion")
    .populate("employee", "isActive");
  if (!user || !user.isActive) throw ApiError.unauthorized("Account is no longer active");
  if (user.role === "EMPLOYEE" && (!user.employee || !user.employee.isActive)) {
    throw ApiError.unauthorized("Employee account is no longer active");
  }
  // Bumping tokenVersion (logout-all / password change) invalidates old tokens.
  if ((payload.v ?? 0) !== user.tokenVersion) throw ApiError.unauthorized("Session has been revoked");

  const accessToken = signAccessToken(user);
  return sendSuccess(res, { accessToken, user: presentUser(user) });
});

/** GET /api/auth/me */
export const me = asyncHandler(async (req, res) => {
  const user = req.user;
  const employee = user.employee ? await Employee.findById(user.employee).lean() : null;
  return sendSuccess(res, { ...presentUser(user), employee });
});

/** POST /api/auth/logout */
export const logout = asyncHandler(async (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  return sendSuccess(res, { message: "Logged out" });
});

/** POST /api/auth/change-password — revokes every existing session. */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+passwordHash +tokenVersion");
  if (!(await user.verifyPassword(currentPassword))) {
    throw ApiError.badRequest("Current password is incorrect");
  }

  user.passwordHash = await User.hashPassword(newPassword);
  user.tokenVersion += 1;
  await user.save();

  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  return sendSuccess(res, { message: "Password updated. Please sign in again." });
});

/** POST /api/auth/employee-setup — consumes an invitation or reset link once. */
export const completeEmployeeCredentialSetup = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const tokenHash = hashCredentialToken(token);
  const now = new Date();
  const user = await User.findOne({
    credentialSetupTokenHash: tokenHash,
    credentialSetupExpiresAt: { $gt: now },
    credentialSetupPurpose: { $in: ["INVITATION", "PASSWORD_RESET"] },
    role: "EMPLOYEE",
  }).select("+credentialSetupTokenHash +credentialSetupExpiresAt +credentialSetupPurpose +tokenVersion");

  if (!user) throw ApiError.badRequest("This setup link is invalid or expired");
  const employee = await Employee.findById(user.employee).select("isActive");
  if (!employee?.isActive) throw ApiError.forbidden("This employee profile is inactive");

  const passwordHash = await User.hashPassword(password);
  const invitation = user.credentialSetupPurpose === "INVITATION";
  const update = {
    $set: {
      passwordHash,
      isActive: invitation ? employee.isActive : Boolean(user.isActive && employee.isActive),
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    },
    $unset: {
      credentialSetupTokenHash: 1,
      credentialSetupExpiresAt: 1,
      credentialSetupPurpose: 1,
    },
  };
  const consumed = await User.updateOne(
    {
      _id: user._id,
      credentialSetupTokenHash: tokenHash,
      credentialSetupExpiresAt: { $gt: now },
    },
    update
  );
  if (consumed.modifiedCount !== 1) throw ApiError.badRequest("This setup link is invalid or expired");

  return sendSuccess(res, { message: "Password set. You can now sign in." });
});

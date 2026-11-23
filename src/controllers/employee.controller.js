import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Work } from "../models/Work.js";
import { Lead } from "../models/Lead.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { avatarColorFor, normalisePhone } from "../utils/format.js";
import { recalcEmployeeStats } from "../services/stats.service.js";
import { createCredentialToken } from "../utils/credentialToken.js";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function accessSummary(employee, user) {
  if (!user) {
    return {
      status: "NO_LOGIN",
      loginEmail: employee.email,
      lastLoginAt: null,
    };
  }

  const pendingInvitation = !user.passwordHash && user.credentialSetupPurpose === "INVITATION";
  const status = !employee.isActive
    ? "DISABLED"
    : pendingInvitation
      ? "INVITATION_PENDING"
      : user.isActive && Boolean(user.passwordHash)
      ? "ACTIVE"
      : "DISABLED";

  return {
    status,
    loginEmail: user.email,
    lastLoginAt: user.lastLoginAt ?? null,
    invitationExpiresAt: pendingInvitation ? user.credentialSetupExpiresAt ?? null : null,
    invitationExpired: pendingInvitation && user.credentialSetupExpiresAt <= new Date(),
  };
}

async function findLinkedEmployeeUser(employee) {
  const users = await User.find({ employee: employee._id })
    .select("email role isActive lastLoginAt")
    .select("+passwordHash +credentialSetupTokenHash +credentialSetupExpiresAt +credentialSetupPurpose +tokenVersion")
    .limit(2);
  if (users.length > 1) throw ApiError.conflict("Multiple accounts are linked to this employee; resolve the duplicate records first");
  if (users[0] && users[0].role !== "EMPLOYEE") {
    throw ApiError.conflict("The linked account is not an employee login");
  }
  return users[0] ?? null;
}

async function issueCredentialLink(user, purpose, ttlMs) {
  const { token, hash } = createCredentialToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  const currentTokenCondition = user.credentialSetupTokenHash
    ? { credentialSetupTokenHash: user.credentialSetupTokenHash }
    : { credentialSetupTokenHash: { $in: [null] } };
  const result = await User.updateOne(
    { _id: user._id, ...currentTokenCondition },
    {
      $set: {
        credentialSetupTokenHash: hash,
        credentialSetupExpiresAt: expiresAt,
        credentialSetupPurpose: purpose,
      },
    }
  );
  if (result.modifiedCount !== 1) {
    throw ApiError.conflict("Another access link was generated. Reload the employee account status.");
  }
  user.credentialSetupTokenHash = hash;
  user.credentialSetupExpiresAt = expiresAt;
  user.credentialSetupPurpose = purpose;

  return {
    setupPath: `/employee/setup#token=${token}`,
    expiresAt,
    warning: "This link is shown only once. Copy it now and share it privately.",
  };
}

function oneTimeLinkResponse(employee, user, link) {
  return {
    access: accessSummary(employee, user),
    ...link,
  };
}

/** GET /api/employees */
export const listEmployees = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 50 });
  const sort = getSort(query, ["name", "createdAt", "activeWorks", "completedWorks"], { name: 1 });

  const filter = {};
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { role: rx }, { email: rx }, { phone: rx }, { code: rx }, { department: rx }];
  }
  if (query.availability && query.availability !== "All") filter.availability = query.availability;
  if (query.department && query.department !== "All") filter.department = query.department;
  if (req.user.role === "EMPLOYEE") {
    const employeeId = req.user.employee?._id ?? req.user.employee;
    filter._id = employeeId ?? { $in: [] };
  } else if (query.status === "Active") {
    filter.isActive = true;
  } else if (query.status === "Inactive") {
    filter.isActive = false;
  } else if (query.status !== "All" && query.includeInactive !== "true") {
    filter.isActive = true;
  }

  const [items, total] = await Promise.all([
    Employee.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Employee.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: buildMeta({ page, limit, total }) }
  );
});

/** GET /api/employees/stats */
export const employeeStats = asyncHandler(async (_req, res) => {
  const grouped = await Employee.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$availability", count: { $sum: 1 } } },
  ]);

  const byAvailability = Object.fromEntries(grouped.map((g) => [g._id, g.count]));
  return sendSuccess(res, {
    total: Object.values(byAvailability).reduce((a, b) => a + b, 0),
    available: byAvailability.Available ?? 0,
    busy: byAvailability.Busy ?? 0,
    onLeave: byAvailability["On Leave"] ?? 0,
  });
});

/** GET /api/employees/:id — profile plus its live workload breakdown. */
export const getEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id)).populate("reportingManager", "name code");
  if (!employee) throw ApiError.notFound("Employee not found");
  if (req.user.role === "EMPLOYEE") {
    const employeeId = req.user.employee?._id ?? req.user.employee;
    if (!employeeId || String(employeeId) !== String(employee._id)) throw ApiError.forbidden();
  }

  const [works, leads] = await Promise.all([
    Work.find({ employeeId: employee._id })
      .select("-activity -attachments -revisionHistory -employeeReport")
      .sort({ updatedAt: -1 })
      .lean(),
    Lead.find({ assignedEmployeeId: employee._id })
      .select("code clientName service requirement status priority updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  return sendSuccess(res, {
    ...employee.toJSON(),
    works: works.map((w) => ({ ...w, id: String(w._id), _id: undefined })),
    leads: leads.map((lead) => ({ ...lead, id: String(lead._id), _id: undefined })),
  });
});

/** POST /api/employees — creates an employee profile only. */
export const createEmployee = asyncHandler(async (req, res) => {
  const data = { ...req.body };
  data.email = data.email.trim().toLowerCase();
  data.phone = normalisePhone(data.phone);
  data.alternatePhone = data.alternatePhone ? normalisePhone(data.alternatePhone) : undefined;
  data.reportingManager = data.reportingManager || undefined;

  if (await Employee.exists({ email: data.email })) {
    throw ApiError.conflict("An employee with this email already exists");
  }
  if (data.reportingManager && !(await Employee.exists({ _id: data.reportingManager }))) {
    throw ApiError.badRequest("Reporting manager not found");
  }

  let employee;
  try {
    employee = await Employee.create({
      ...data,
      avatarColor: avatarColorFor(data.email),
      joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
    });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict("Employee email or identifier already exists");
    throw err;
  }

  return sendCreated(res, employee.toJSON());
});

/** PATCH /api/employees/:id */
export const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");

  const updates = { ...req.body };
  if (updates.email) updates.email = updates.email.trim().toLowerCase();
  if (updates.phone) updates.phone = normalisePhone(updates.phone);
  if (Object.prototype.hasOwnProperty.call(updates, "alternatePhone")) {
    updates.alternatePhone = updates.alternatePhone ? normalisePhone(updates.alternatePhone) : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "reportingManager")) {
    updates.reportingManager = updates.reportingManager || undefined;
    if (updates.reportingManager && String(updates.reportingManager) === String(employee._id)) {
      throw ApiError.badRequest("An employee cannot report to themselves");
    }
    if (updates.reportingManager && !(await Employee.exists({ _id: updates.reportingManager }))) {
      throw ApiError.badRequest("Reporting manager not found");
    }
  }
  if (updates.isActive === false && !updates.availability) updates.availability = "On Leave";
  if (updates.email && await Employee.exists({ email: updates.email, _id: { $ne: employee._id } })) {
    throw ApiError.conflict("An employee with this email already exists");
  }
  if (updates.email && await User.exists({ email: updates.email, employee: { $ne: employee._id } })) {
    throw ApiError.conflict("An account with this email already exists");
  }

  Object.assign(employee, updates);
  try {
    await employee.save();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict("Employee email or identifier already exists");
    throw err;
  }

  const userUpdates = {};
  if (updates.name) userUpdates.name = updates.name;
  if (updates.email) userUpdates.email = updates.email;
  if (updates.isActive === false) {
    await User.updateMany(
      { employee: employee._id },
      { $set: { ...userUpdates, isActive: false }, $inc: { tokenVersion: 1 } }
    );
  } else if (Object.keys(userUpdates).length) {
    await User.updateMany({ employee: employee._id }, { $set: userUpdates });
  }

  return sendSuccess(res, employee.toJSON());
});

/** POST /api/employees/:id/deactivate — soft delete; work history is preserved. */
export const deactivateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");

  employee.isActive = false;
  employee.availability = "On Leave";
  await employee.save();
  await User.updateMany({ employee: employee._id }, { $set: { isActive: false }, $inc: { tokenVersion: 1 } });

  return sendSuccess(res, employee.toJSON());
});

/** GET /api/employees/:id/access — safe login state, never credential tokens. */
export const getEmployeeAccess = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  const user = await findLinkedEmployeeUser(employee);
  return sendSuccess(res, accessSummary(employee, user));
});

/** POST /api/employees/:id/access — create one employee login and invitation. */
export const createEmployeeLogin = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  if (!employee.isActive) throw ApiError.badRequest("Reactivate the employee profile before creating login access");
  if (await findLinkedEmployeeUser(employee)) throw ApiError.conflict("An account is already linked to this employee");

  const proposedAccountId = new mongoose.Types.ObjectId();
  const claim = await Employee.findOneAndUpdate(
    {
      _id: employee._id,
      isActive: true,
      $or: [
        { loginAccountId: { $exists: false } },
        { loginAccountId: null },
      ],
    },
    { $set: { loginAccountId: proposedAccountId } },
    { new: true }
  ).select("+loginAccountId");
  const accountClaim = claim ?? await Employee.findById(employee._id).select("+loginAccountId");
  if (!accountClaim?.isActive || !accountClaim.loginAccountId) {
    throw ApiError.conflict("Employee login is already being created or the employee became inactive");
  }
  if (await User.exists({ employee: employee._id })) {
    throw ApiError.conflict("An account is already linked to this employee");
  }
  if (await User.exists({ _id: accountClaim.loginAccountId })) {
    throw ApiError.conflict("This employee already has a login account; reload its access status");
  }
  if (await User.exists({ email: employee.email.toLowerCase() })) {
    throw ApiError.conflict("An account already uses this employee email");
  }

  const { token, hash } = createCredentialToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  let user;
  try {
    user = await User.create({
      _id: accountClaim.loginAccountId,
      name: employee.name,
      email: employee.email.toLowerCase(),
      role: "EMPLOYEE",
      employee: employee._id,
      isActive: false,
      credentialSetupTokenHash: hash,
      credentialSetupExpiresAt: expiresAt,
      credentialSetupPurpose: "INVITATION",
    });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict("An account already exists for this employee or email");
    throw err;
  }

  return sendCreated(
    res,
    oneTimeLinkResponse(employee, user, {
      setupPath: `/employee/setup#token=${token}`,
      expiresAt,
      warning: "This link is shown only once. Copy it now and share it privately.",
    })
  );
});

/** POST /api/employees/:id/access/invitation — rotate an unused invitation. */
export const resendEmployeeInvitation = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  if (!employee.isActive) throw ApiError.badRequest("Reactivate the employee profile before sending an invitation");
  const user = await findLinkedEmployeeUser(employee);
  if (!user) throw ApiError.notFound("No login account is linked to this employee");
  if (user.passwordHash) throw ApiError.badRequest("This account already has a password; initiate a password reset instead");

  const link = await issueCredentialLink(user, "INVITATION", INVITATION_TTL_MS);
  return sendSuccess(res, oneTimeLinkResponse(employee, user, link));
});

/** POST /api/employees/:id/access/reset — issue a one-time reset link. */
export const initiateEmployeePasswordReset = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  if (!employee.isActive) throw ApiError.badRequest("Reactivate the employee profile before resetting login access");
  const user = await findLinkedEmployeeUser(employee);
  if (!user) throw ApiError.notFound("No login account is linked to this employee");
  if (!user.passwordHash) throw ApiError.badRequest("This account has not completed setup; resend its invitation");

  const link = await issueCredentialLink(user, "PASSWORD_RESET", PASSWORD_RESET_TTL_MS);
  return sendSuccess(res, oneTimeLinkResponse(employee, user, link));
});

/** PATCH /api/employees/:id/access — enable or disable login, revoking old sessions. */
export const updateEmployeeAccess = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  const user = await findLinkedEmployeeUser(employee);
  if (!user) throw ApiError.notFound("No login account is linked to this employee");
  if (req.body.enabled && !employee.isActive) {
    throw ApiError.badRequest("Reactivate the employee profile before enabling login");
  }
  if (req.body.enabled && !user.passwordHash) {
    throw ApiError.badRequest("The employee must complete password setup before login can be enabled");
  }

  user.isActive = req.body.enabled;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  return sendSuccess(res, accessSummary(employee, user));
});

/** POST /api/employees/:id/recalculate — force a counter refresh. */
export const recalculateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  const updated = await recalcEmployeeStats(employee._id);
  return sendSuccess(res, updated.toJSON());
});

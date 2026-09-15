import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Work } from "../models/Work.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { avatarColorFor } from "../utils/format.js";
import { recalcEmployeeStats } from "../services/stats.service.js";

/** GET /api/employees */
export const listEmployees = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 50 });
  const sort = getSort(query, ["name", "createdAt", "activeWorks", "completedWorks"], { name: 1 });

  const filter = {};
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { role: rx }, { email: rx }, { code: rx }];
  }
  if (query.availability && query.availability !== "All") filter.availability = query.availability;
  if (query.includeInactive !== "true") filter.isActive = true;

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
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");

  const works = await Work.find({ employeeId: employee._id })
    .select("-activity -attachments -revisionHistory -employeeReport")
    .sort({ updatedAt: -1 })
    .lean();

  return sendSuccess(res, {
    ...employee.toJSON(),
    works: works.map((w) => ({ ...w, id: String(w._id), _id: undefined })),
  });
});

/** POST /api/employees — optionally provisions a login at the same time. */
export const createEmployee = asyncHandler(async (req, res) => {
  const { createLogin, password, ...data } = req.body;

  if (await Employee.exists({ email: data.email.toLowerCase() })) {
    throw ApiError.conflict("An employee with this email already exists");
  }

  const employee = await Employee.create({
    ...data,
    avatarColor: avatarColorFor(data.email),
    joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
  });

  if (createLogin) {
    if (!password) throw ApiError.badRequest("A password is required to create a login");
    await User.create({
      name: employee.name,
      email: employee.email,
      role: "EMPLOYEE",
      employee: employee._id,
      passwordHash: await User.hashPassword(password),
    });
  }

  return sendCreated(res, employee.toJSON());
});

/** PATCH /api/employees/:id */
export const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOneAndUpdate(byIdOrCode(req.params.id), req.body, {
    new: true,
    runValidators: true,
  });
  if (!employee) throw ApiError.notFound("Employee not found");

  // Keep the linked login in sync with the HR record.
  if (typeof req.body.isActive === "boolean") {
    await User.updateMany({ employee: employee._id }, { isActive: req.body.isActive });
  }
  if (req.body.name) await User.updateMany({ employee: employee._id }, { name: req.body.name });

  return sendSuccess(res, employee.toJSON());
});

/** POST /api/employees/:id/deactivate — soft delete; work history is preserved. */
export const deactivateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");

  const openWork = await Work.countDocuments({
    employeeId: employee._id,
    status: { $in: ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED", "SUBMITTED"] },
  });
  if (openWork > 0) {
    throw ApiError.badRequest(`Reassign ${openWork} open work item(s) before deactivating this employee`);
  }

  employee.isActive = false;
  employee.availability = "On Leave";
  await employee.save();
  await User.updateMany({ employee: employee._id }, { isActive: false });

  return sendSuccess(res, employee.toJSON());
});

/** POST /api/employees/:id/recalculate — force a counter refresh. */
export const recalculateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne(byIdOrCode(req.params.id));
  if (!employee) throw ApiError.notFound("Employee not found");
  const updated = await recalcEmployeeStats(employee._id);
  return sendSuccess(res, updated.toJSON());
});

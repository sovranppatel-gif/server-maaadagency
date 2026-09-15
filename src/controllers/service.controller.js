import { Service } from "../models/Service.js";
import { Lead } from "../models/Lead.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { byIdOrCode } from "../utils/query.js";

/**
 * GET /api/services
 * leadsCount is computed live from the leads collection so the number on the
 * services screen can never go stale.
 */
export const listServices = asyncHandler(async (_req, res) => {
  const [services, counts] = await Promise.all([
    Service.find().sort({ order: 1, createdAt: 1 }).lean(),
    Lead.aggregate([{ $group: { _id: "$service", count: { $sum: 1 } } }]),
  ]);

  const countByService = Object.fromEntries(counts.map((c) => [c._id, c.count]));

  return sendSuccess(
    res,
    services.map((s) => ({
      ...s,
      id: String(s._id),
      _id: undefined,
      leadsCount: countByService[s.name] ?? 0,
    }))
  );
});

/** POST /api/services */
export const createService = asyncHandler(async (req, res) => {
  if (await Service.exists({ name: req.body.name })) {
    throw ApiError.conflict("A service with this name already exists");
  }
  const count = await Service.countDocuments();
  const service = await Service.create({ ...req.body, order: count });
  return sendCreated(res, { ...service.toJSON(), leadsCount: 0 });
});

/** PATCH /api/services/:id */
export const updateService = asyncHandler(async (req, res) => {
  const service = await Service.findOneAndUpdate(byIdOrCode(req.params.id), req.body, {
    new: true,
    runValidators: true,
  });
  if (!service) throw ApiError.notFound("Service not found");
  return sendSuccess(res, service.toJSON());
});

/** POST /api/services/:id/toggle */
export const toggleService = asyncHandler(async (req, res) => {
  const service = await Service.findOne(byIdOrCode(req.params.id));
  if (!service) throw ApiError.notFound("Service not found");

  service.status = service.status === "Active" ? "Disabled" : "Active";
  await service.save();

  return sendSuccess(res, service.toJSON());
});

/** DELETE /api/services/:id — refuses to orphan existing leads. */
export const deleteService = asyncHandler(async (req, res) => {
  const service = await Service.findOne(byIdOrCode(req.params.id));
  if (!service) throw ApiError.notFound("Service not found");

  const leadsUsing = await Lead.countDocuments({ service: service.name });
  if (leadsUsing > 0) {
    throw ApiError.badRequest(
      `${leadsUsing} lead(s) reference this service. Disable it instead of deleting.`
    );
  }

  await service.deleteOne();
  return sendSuccess(res, { id: String(service._id), deleted: true });
});

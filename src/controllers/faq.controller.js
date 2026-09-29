import { Faq } from "../models/Faq.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";

/** GET /api/whatsapp/faqs */
export const listFaqs = asyncHandler(async (_req, res) => {
  const faqs = await Faq.find().sort({ order: 1, createdAt: 1 });
  return sendSuccess(res, faqs.map((f) => f.toJSON()));
});

/** POST /api/whatsapp/faqs */
export const createFaq = asyncHandler(async (req, res) => {
  const last = await Faq.findOne().sort({ order: -1 }).lean();
  const faq = await Faq.create({ ...req.body, order: req.body.order ?? (last?.order ?? 0) + 1 });
  return sendCreated(res, faq.toJSON());
});

/** PUT /api/whatsapp/faqs/:id */
export const updateFaq = asyncHandler(async (req, res) => {
  const faq = await Faq.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!faq) throw ApiError.notFound("FAQ not found");
  return sendSuccess(res, faq.toJSON());
});

/** DELETE /api/whatsapp/faqs/:id */
export const deleteFaq = asyncHandler(async (req, res) => {
  const faq = await Faq.findByIdAndDelete(req.params.id);
  if (!faq) throw ApiError.notFound("FAQ not found");
  return sendSuccess(res, { id: String(faq._id), deleted: true });
});

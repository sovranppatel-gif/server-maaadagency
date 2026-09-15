import { Client } from "../models/Client.js";
import { Lead } from "../models/Lead.js";
import { Work } from "../models/Work.js";
import { Project } from "../models/Project.js";
import { Conversation } from "../models/Conversation.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { avatarColorFor, normalisePhone, prettyPhone } from "../utils/format.js";
import { recalcClientStats } from "../services/stats.service.js";

const present = (doc) => ({
  ...doc,
  id: String(doc._id),
  _id: undefined,
  // The dashboard displays the formatted number.
  phone: doc.phoneDisplay || prettyPhone(doc.phone),
});

/** GET /api/clients */
export const listClients = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 50 });
  const sort = getSort(query, ["name", "lastContact", "createdAt", "totalLeads"], { lastContact: -1 });

  const filter = {};
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { company: rx }, { phone: rx }, { email: rx }, { code: rx }];
  }

  const [items, total] = await Promise.all([
    Client.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Client.countDocuments(filter),
  ]);

  return sendSuccess(res, items.map(present), { meta: buildMeta({ page, limit, total }) });
});

/** GET /api/clients/:id — full 360 view used by the client detail screen. */
export const getClient = asyncHandler(async (req, res) => {
  const client = await Client.findOne(byIdOrCode(req.params.id)).lean();
  if (!client) throw ApiError.notFound("Client not found");

  const [leads, works, projects, conversation] = await Promise.all([
    Lead.find({ clientId: client._id }).select("-activity -attachments").sort({ createdAt: -1 }).lean(),
    Work.find({ clientId: client._id })
      .select("-activity -attachments -revisionHistory -employeeReport")
      .sort({ updatedAt: -1 })
      .lean(),
    Project.find({ clientId: client._id }).select("-comments -files").sort({ createdAt: -1 }).lean(),
    Conversation.findOne({ clientId: client._id }).select("_id unreadCount lastMessageAt").lean(),
  ]);

  const strip = (doc) => ({ ...doc, id: String(doc._id), _id: undefined });

  return sendSuccess(res, {
    ...present(client),
    leads: leads.map(strip),
    works: works.map(strip),
    projects: projects.map(strip),
    conversationId: conversation ? String(conversation._id) : null,
  });
});

/** POST /api/clients */
export const createClient = asyncHandler(async (req, res) => {
  const phone = normalisePhone(req.body.phone);
  if (await Client.exists({ phone })) throw ApiError.conflict("A client with this phone number already exists");

  const client = await Client.create({
    ...req.body,
    phone,
    phoneDisplay: prettyPhone(phone),
    email: req.body.email || undefined,
    avatarColor: avatarColorFor(phone),
  });

  return sendCreated(res, present(client.toObject()));
});

/** PATCH /api/clients/:id */
export const updateClient = asyncHandler(async (req, res) => {
  const update = { ...req.body };
  if (update.phone) {
    update.phone = normalisePhone(update.phone);
    update.phoneDisplay = prettyPhone(update.phone);
  }

  const client = await Client.findOneAndUpdate(byIdOrCode(req.params.id), update, {
    new: true,
    runValidators: true,
  }).lean();
  if (!client) throw ApiError.notFound("Client not found");

  return sendSuccess(res, present(client));
});

/** POST /api/clients/:id/recalculate */
export const recalculateClient = asyncHandler(async (req, res) => {
  const client = await Client.findOne(byIdOrCode(req.params.id));
  if (!client) throw ApiError.notFound("Client not found");
  const updated = await recalcClientStats(client._id);
  return sendSuccess(res, present(updated.toObject()));
});

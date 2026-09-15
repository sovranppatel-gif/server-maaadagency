import { Project } from "../models/Project.js";
import { Client } from "../models/Client.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess, sendCreated } from "../utils/apiResponse.js";
import { buildMeta, byIdOrCode, escapeRegex, getPagination, getSort } from "../utils/query.js";
import { q } from "../middleware/validate.js";
import { recalcClientStats } from "../services/stats.service.js";

/** Progress is derived from task completion so it can never drift. */
function syncProgress(project) {
  if (!project.tasks.length) return;
  const done = project.tasks.filter((t) => t.done).length;
  project.progress = Math.round((done / project.tasks.length) * 100);
}

/** GET /api/projects */
export const listProjects = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 50 });
  const sort = getSort(query, ["createdAt", "deadline", "progress", "name"], { createdAt: -1 });

  const filter = {};
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { clientName: rx }, { code: rx }];
  }
  if (query.status && query.status !== "All") filter.status = query.status;

  const [items, total] = await Promise.all([
    Project.find(filter).select("-comments -files").sort(sort).skip(skip).limit(limit).lean(),
    Project.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: buildMeta({ page, limit, total }) }
  );
});

/** GET /api/projects/:id */
export const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne(byIdOrCode(req.params.id));
  if (!project) throw ApiError.notFound("Project not found");
  return sendSuccess(res, project.toJSON());
});

/** POST /api/projects */
export const createProject = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.body.clientId);
  if (!client) throw ApiError.badRequest("Client not found");

  const project = await Project.create({
    ...req.body,
    clientName: client.company || client.name,
    deadline: new Date(req.body.deadline),
  });

  await recalcClientStats(client._id);
  return sendCreated(res, project.toJSON());
});

/** PATCH /api/projects/:id */
export const updateProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne(byIdOrCode(req.params.id));
  if (!project) throw ApiError.notFound("Project not found");

  Object.assign(project, req.body, req.body.deadline ? { deadline: new Date(req.body.deadline) } : {});
  await project.save();
  await recalcClientStats(project.clientId);

  return sendSuccess(res, project.toJSON());
});

/** POST /api/projects/:id/tasks */
export const addTask = asyncHandler(async (req, res) => {
  const project = await Project.findOne(byIdOrCode(req.params.id));
  if (!project) throw ApiError.notFound("Project not found");

  project.tasks.push({ title: req.body.title, assigneeId: req.body.assigneeId, done: false });
  syncProgress(project);
  await project.save();

  return sendCreated(res, project.toJSON());
});

/** PATCH /api/projects/:id/tasks/:taskId */
export const toggleTask = asyncHandler(async (req, res) => {
  const project = await Project.findOne(byIdOrCode(req.params.id));
  if (!project) throw ApiError.notFound("Project not found");

  const task = project.tasks.id(req.params.taskId);
  if (!task) throw ApiError.notFound("Task not found");

  task.done = req.body.done;
  syncProgress(project);
  await project.save();

  return sendSuccess(res, project.toJSON());
});

/** POST /api/projects/:id/comments */
export const addComment = asyncHandler(async (req, res) => {
  const project = await Project.findOne(byIdOrCode(req.params.id));
  if (!project) throw ApiError.notFound("Project not found");

  project.comments.push({
    author: req.user?.name ?? "Admin",
    message: req.body.message,
    timestamp: new Date(),
  });
  await project.save();

  return sendCreated(res, project.toJSON());
});

/** DELETE /api/projects/:id */
export const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findOneAndDelete(byIdOrCode(req.params.id));
  if (!project) throw ApiError.notFound("Project not found");
  await recalcClientStats(project.clientId);
  return sendSuccess(res, { id: String(project._id), deleted: true });
});

import mongoose from "mongoose";
import { Work } from "../models/Work.js";
import { Lead } from "../models/Lead.js";
import { Project } from "../models/Project.js";
import { Employee } from "../models/Employee.js";
import { Client } from "../models/Client.js";
import { logger } from "../config/logger.js";

const ACTIVE_STATUSES = ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"];
const REVIEW_STATUSES = ["SUBMITTED"];
const DONE_STATUSES = ["COMPLETED", "APPROVED"];

/**
 * Recomputes an employee's workload counters from the work collection.
 * Counters are denormalised for fast list rendering, so they are always
 * derived here rather than incremented ad hoc at call sites (no drift).
 */
export async function recalcEmployeeStats(employeeId) {
  if (!employeeId) return null;

  const objectId = new mongoose.Types.ObjectId(String(employeeId));

  const [result] = await Work.aggregate([
    { $match: { employeeId: objectId } },
    {
      $group: {
        _id: null,
        activeWorks: { $sum: { $cond: [{ $in: ["$status", ACTIVE_STATUSES] }, 1, 0] } },
        pendingReview: { $sum: { $cond: [{ $in: ["$status", REVIEW_STATUSES] }, 1, 0] } },
        completedWorks: { $sum: { $cond: [{ $in: ["$status", DONE_STATUSES] }, 1, 0] } },
      },
    },
  ]).catch(() => []);

  const counters = {
    activeWorks: result?.activeWorks ?? 0,
    pendingReview: result?.pendingReview ?? 0,
    completedWorks: result?.completedWorks ?? 0,
  };

  return Employee.findByIdAndUpdate(employeeId, counters, { new: true });
}

/** Bulk variant used after seeding or bulk imports. */
export async function recalcAllEmployeeStats() {
  const grouped = await Work.aggregate([
    { $match: { employeeId: { $ne: null } } },
    {
      $group: {
        _id: "$employeeId",
        activeWorks: { $sum: { $cond: [{ $in: ["$status", ACTIVE_STATUSES] }, 1, 0] } },
        pendingReview: { $sum: { $cond: [{ $in: ["$status", REVIEW_STATUSES] }, 1, 0] } },
        completedWorks: { $sum: { $cond: [{ $in: ["$status", DONE_STATUSES] }, 1, 0] } },
      },
    },
  ]);

  const ops = [
    // Reset everyone first so employees with zero work are corrected too.
    { updateMany: { filter: {}, update: { activeWorks: 0, pendingReview: 0, completedWorks: 0 } } },
    ...grouped.map((g) => ({
      updateOne: {
        filter: { _id: g._id },
        update: { activeWorks: g.activeWorks, pendingReview: g.pendingReview, completedWorks: g.completedWorks },
      },
    })),
  ];

  await Employee.bulkWrite(ops, { ordered: true });
  logger.debug("Employee stats recalculated", { employees: grouped.length });
}

/** Recomputes lead/project counters and last-contact timestamp for a client. */
export async function recalcClientStats(clientId) {
  if (!clientId) return null;

  const [leadCount, projects, latestLead] = await Promise.all([
    Lead.countDocuments({ clientId }),
    Project.aggregate([
      { $match: { clientId } },
      {
        $group: {
          _id: null,
          active: { $sum: { $cond: [{ $in: ["$status", ["Planning", "Active", "Review"]] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        },
      },
    ]),
    Lead.findOne({ clientId }).sort({ createdAt: -1 }).select("createdAt").lean(),
  ]);

  return Client.findByIdAndUpdate(
    clientId,
    {
      totalLeads: leadCount,
      activeProjects: projects[0]?.active ?? 0,
      completedProjects: projects[0]?.completed ?? 0,
      ...(latestLead ? { lastContact: latestLead.createdAt } : {}),
    },
    { new: true }
  );
}

export async function recalcAllClientStats() {
  const clients = await Client.find().select("_id").lean();
  await Promise.all(clients.map((c) => recalcClientStats(c._id)));
  logger.debug("Client stats recalculated", { clients: clients.length });
}

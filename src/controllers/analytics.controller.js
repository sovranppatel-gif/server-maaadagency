import { Lead } from "../models/Lead.js";
import { Work } from "../models/Work.js";
import { Employee } from "../models/Employee.js";
import { Client } from "../models/Client.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfMonthsAgo(months) {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - months);
  return d;
}

/** Fills gaps so a month with no activity still renders as a zero point. */
function toMonthlySeries(rows, months = 6) {
  const buckets = new Map();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = startOfMonthsAgo(i);
    buckets.set(`${d.getFullYear()}-${d.getMonth() + 1}`, { label: MONTH_LABELS[d.getMonth()], value: 0 });
  }
  for (const row of rows) {
    const key = `${row._id.year}-${row._id.month}`;
    if (buckets.has(key)) buckets.get(key).value = row.count;
  }
  return [...buckets.values()];
}

/**
 * GET /api/analytics/dashboard
 * One round trip for every headline number on the dashboard.
 */
export const dashboardSummary = asyncHandler(async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [leadAgg, workAgg, employees, conversations, messagesToday, unreadAgg] = await Promise.all([
    Lead.aggregate([
      {
        $facet: {
          total: [{ $count: "count" }],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        },
      },
    ]),
    Work.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Employee.countDocuments({ isActive: true }),
    Conversation.countDocuments(),
    Message.countDocuments({ timestamp: { $gte: todayStart } }),
    Conversation.aggregate([{ $group: { _id: null, unread: { $sum: "$unreadCount" } } }]),
  ]);

  const leadsByStatus = Object.fromEntries((leadAgg[0]?.byStatus ?? []).map((g) => [g._id, g.count]));
  const worksByStatus = Object.fromEntries(workAgg.map((g) => [g._id, g.count]));

  return sendSuccess(res, {
    totalLeads: leadAgg[0]?.total?.[0]?.count ?? 0,
    newLeads: leadsByStatus.New ?? 0,
    activeWork: (worksByStatus.ASSIGNED ?? 0) + (worksByStatus.IN_PROGRESS ?? 0),
    pendingReview: (worksByStatus.SUBMITTED ?? 0) + (worksByStatus.CHANGES_REQUESTED ?? 0),
    completed: worksByStatus.COMPLETED ?? 0,
    employees,
    whatsappChats: conversations,
    messagesToday,
    unreadMessages: unreadAgg[0]?.unread ?? 0,
    leadsByStatus,
    worksByStatus,
  });
});

/**
 * GET /api/analytics
 * Chart data for the analytics screen, computed entirely in MongoDB.
 */
export const analytics = asyncHandler(async (_req, res) => {
  const since = startOfMonthsAgo(5);

  const [byService, bySource, workStatus, performance, monthlyLeads, monthlyCompleted, conversionAgg, clients] =
    await Promise.all([
      Lead.aggregate([
        { $group: { _id: "$service", value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $limit: 8 },
        { $project: { _id: 0, label: "$_id", value: 1 } },
      ]),
      Lead.aggregate([
        { $group: { _id: "$source", value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $project: { _id: 0, label: "$_id", value: 1 } },
      ]),
      Work.aggregate([
        { $group: { _id: "$status", value: { $sum: 1 } } },
        { $project: { _id: 0, label: "$_id", value: 1 } },
      ]),
      Work.aggregate([
        { $match: { employeeId: { $ne: null }, status: { $in: ["COMPLETED", "APPROVED"] } } },
        { $group: { _id: "$employeeId", value: { $sum: 1 } } },
        { $sort: { value: -1 } },
        { $limit: 6 },
        { $lookup: { from: "employees", localField: "_id", foreignField: "_id", as: "employee" } },
        { $unwind: "$employee" },
        { $project: { _id: 0, label: { $arrayElemAt: [{ $split: ["$employee.name", " "] }, 0] }, value: 1 } },
      ]),
      Lead.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, count: { $sum: 1 } } },
      ]),
      Work.aggregate([
        { $match: { status: "COMPLETED", updatedAt: { $gte: since } } },
        { $group: { _id: { year: { $year: "$updatedAt" }, month: { $month: "$updatedAt" } }, count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            converted: { $sum: { $cond: [{ $in: ["$status", ["Approved", "Completed"]] }, 1, 0] } },
          },
        },
      ]),
      Client.countDocuments(),
    ]);

  const conversion = conversionAgg[0] ?? { total: 0, converted: 0 };

  // Average turnaround, in days, across completed work.
  const [turnaround] = await Work.aggregate([
    { $match: { status: { $in: ["COMPLETED", "APPROVED"] } } },
    { $project: { days: { $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 1000 * 60 * 60 * 24] } } },
    { $group: { _id: null, avgDays: { $avg: "$days" } } },
  ]);

  return sendSuccess(res, {
    leadsByService: byService,
    leadsBySource: bySource,
    workByStatus: workStatus,
    employeePerformance: performance,
    monthlyLeads: toMonthlySeries(monthlyLeads),
    monthlyCompleted: toMonthlySeries(monthlyCompleted),
    totals: {
      totalLeads: conversion.total,
      totalClients: clients,
      conversionRate: conversion.total ? Math.round((conversion.converted / conversion.total) * 100) : 0,
      avgCompletionDays: turnaround?.avgDays ? Number(turnaround.avgDays.toFixed(1)) : 0,
    },
  });
});

/** GET /api/analytics/whatsapp — message volume for the last 7 days. */
export const whatsappAnalytics = asyncHandler(async (_req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const rows = await Message.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
        value: { $sum: 1 },
        inbound: { $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] } },
        outbound: { $sum: { $cond: [{ $eq: ["$direction", "outbound"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const series = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = rows.find((r) => r._id === key);
    series.push({ label: dayLabels[d.getDay()], value: row?.value ?? 0, inbound: row?.inbound ?? 0, outbound: row?.outbound ?? 0 });
  }

  return sendSuccess(res, series);
});

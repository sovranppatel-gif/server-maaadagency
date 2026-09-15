/**
 * Database seeder.
 *
 *   npm run seed          fills empty collections, leaves existing data alone
 *   npm run seed:fresh    wipes the seeded collections first
 */
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

import { Counter } from "../models/Counter.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Client } from "../models/Client.js";
import { Lead } from "../models/Lead.js";
import { Work } from "../models/Work.js";
import { Project } from "../models/Project.js";
import { Service } from "../models/Service.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { BotStep } from "../models/BotStep.js";
import { Notification } from "../models/Notification.js";
import { FileAsset } from "../models/FileAsset.js";

import * as data from "./data.js";
import { prettyPhone } from "../utils/format.js";
import { recalcAllClientStats, recalcAllEmployeeStats } from "../services/stats.service.js";

const FRESH = process.argv.includes("--fresh");

const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);
const minutesAgo = (mins) => new Date(Date.now() - mins * 60_000);

/**
 * Mongoose always stamps createdAt/updatedAt on insert, which would make every
 * seeded record look like it was created today. Re-apply the intended history
 * afterwards with timestamps disabled so "received 3 days ago" and the monthly
 * trend charts show realistic data.
 */
async function stampHistory(Model, rows) {
  if (!rows.length) return;
  await Model.bulkWrite(
    rows.map(({ id, createdAt, updatedAt }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { createdAt, updatedAt: updatedAt ?? createdAt } },
      },
    })),
    { timestamps: false }
  );
}

const attachment = (file, uploadedBy, at) => ({
  name: file.name,
  url: `/uploads/samples/${file.name}`,
  type: file.type ?? "other",
  size: file.size ?? "0 KB",
  uploadedBy,
  uploadedAt: at,
});

async function wipe() {
  const models = [User, Employee, Client, Lead, Work, Project, Service, Conversation, Message, BotStep, Notification, FileAsset, Counter];
  await Promise.all(models.map((m) => m.deleteMany({})));
  logger.warn("Existing data cleared (--fresh)");
}

async function seed() {
  await connectDB();
  if (FRESH) await wipe();

  const existing = await Lead.estimatedDocumentCount();
  if (existing > 0 && !FRESH) {
    logger.info("Database already seeded. Use `npm run seed:fresh` to reset.");
    await disconnectDB();
    return;
  }

  /* 1. Services ---------------------------------------------------------- */
  const services = await Service.insertMany(
    data.services.map((s, i) => ({ ...s, order: i, code: `SVC-${String(i + 1).padStart(3, "0")}` }))
  );
  logger.info(`Seeded ${services.length} services`);

  /* 2. Employees --------------------------------------------------------- */
  const employeeMap = new Map();
  for (const e of data.employees) {
    const { key, joinedAt, ...rest } = e;
    const doc = await Employee.create({ ...rest, joinedAt: new Date(joinedAt) });
    employeeMap.set(key, doc);
  }
  logger.info(`Seeded ${employeeMap.size} employees`);

  /* 3. Users (master admin + one login per employee) ---------------------- */
  const adminPasswordHash = await User.hashPassword(env.SEED_ADMIN_PASSWORD);
  const employeePasswordHash = await User.hashPassword(env.SEED_EMPLOYEE_PASSWORD);

  await User.create({
    name: "Master Admin",
    email: env.SEED_ADMIN_EMAIL,
    role: "MASTER_ADMIN",
    passwordHash: adminPasswordHash,
    avatarColor: "#C5161D",
  });

  for (const [, emp] of employeeMap) {
    await User.create({
      name: emp.name,
      email: emp.email,
      role: "EMPLOYEE",
      employee: emp._id,
      passwordHash: employeePasswordHash,
      avatarColor: emp.avatarColor,
    });
  }
  logger.info(`Seeded ${employeeMap.size + 1} user accounts`);

  /* 4. Clients ----------------------------------------------------------- */
  const clientMap = new Map();
  for (const c of data.clients) {
    const { key, ...rest } = c;
    const doc = await Client.create({ ...rest, phoneDisplay: prettyPhone(rest.phone), lastContact: new Date() });
    clientMap.set(key, doc);
  }
  logger.info(`Seeded ${clientMap.size} clients`);

  /* 5. Leads ------------------------------------------------------------- */
  const leadMap = new Map();
  const leadHistory = [];
  for (const l of data.leads) {
    const client = clientMap.get(l.client);
    const employee = l.employee ? employeeMap.get(l.employee) : null;
    const createdAt = daysAgo(l.createdAgo);

    const activity = [{ label: "Lead Created", actor: l.source === "WhatsApp" ? "WhatsApp Bot" : "Admin", timestamp: createdAt }];
    if (l.source === "WhatsApp") {
      activity.push({ label: "Requirement Collected", actor: "WhatsApp Bot", timestamp: createdAt });
    }
    if (employee) {
      activity.push({ label: `Assigned to ${employee.name}`, actor: "Admin", timestamp: daysAgo(Math.max(0, l.createdAgo - 1)) });
    }
    if (["Submitted", "Changes Requested", "Approved", "Completed"].includes(l.status)) {
      activity.push({ label: "Submitted for Review", actor: employee?.name ?? "Employee", timestamp: daysAgo(1) });
    }
    if (l.status === "Changes Requested") activity.push({ label: "Changes Requested", actor: "Admin", timestamp: daysAgo(1) });
    if (["Approved", "Completed"].includes(l.status)) activity.push({ label: "Approved", actor: "Admin", timestamp: daysAgo(1) });

    const doc = await Lead.create({
      code: l.code,
      clientId: client._id,
      clientName: client.company || client.name,
      phone: client.phone,
      company: client.company,
      email: client.email,
      service: l.service,
      requirement: l.requirement,
      description: l.description,
      referenceWebsite: l.referenceWebsite,
      deadline: daysFromNow(l.deadlineIn),
      budget: l.budget,
      source: l.source,
      priority: l.priority,
      status: l.status,
      assignedEmployeeId: employee?._id,
      assignedDate: employee ? daysAgo(Math.max(0, l.createdAgo - 1)) : undefined,
      activity,
      createdAt,
      updatedAt: createdAt,
    });
    leadMap.set(l.code, doc);
    leadHistory.push({ id: doc._id, createdAt, updatedAt: l.employee ? daysAgo(1) : createdAt });
  }
  await stampHistory(Lead, leadHistory);
  logger.info(`Seeded ${leadMap.size} leads`);

  /* 6. Work -------------------------------------------------------------- */
  const workMap = new Map();
  const workHistory = [];
  for (const w of data.works) {
    const client = clientMap.get(w.client);
    const employee = w.employee ? employeeMap.get(w.employee) : null;
    const lead = w.lead ? leadMap.get(w.lead) : null;
    const createdAt = daysAgo(w.createdAgo);

    const activity = [{ label: "Work Created", actor: "Admin", timestamp: createdAt }];
    if (employee) activity.push({ label: `Assigned to ${employee.name}`, actor: "Admin", timestamp: createdAt });
    if (["IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "COMPLETED"].includes(w.status)) {
      activity.push({ label: "Work Started", actor: employee?.name ?? "Employee", timestamp: daysAgo(Math.max(0, w.createdAgo - 1)) });
    }
    if (["SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "COMPLETED"].includes(w.status)) {
      activity.push({ label: "Submitted for Review", actor: employee?.name ?? "Employee", timestamp: daysAgo(1) });
    }
    if (w.status === "CHANGES_REQUESTED") activity.push({ label: "Changes Requested", actor: "Admin", timestamp: daysAgo(1) });
    if (["APPROVED", "COMPLETED"].includes(w.status)) activity.push({ label: "Work Approved", actor: "Admin", timestamp: daysAgo(1) });
    if (w.status === "COMPLETED") activity.push({ label: "Marked Completed", actor: "Admin", timestamp: daysAgo(1) });

    const report = w.report
      ? {
          summary: w.report.summary,
          remarks: w.report.remarks ?? "",
          timeSpent: w.report.timeSpent ?? "",
          files: (w.report.files ?? []).map((f) => attachment(f, employee?.name ?? "Employee", daysAgo(1))),
          screenshots: (w.report.screenshots ?? []).map((f) => attachment(f, employee?.name ?? "Employee", daysAgo(1))),
          submittedAt: daysAgo(1),
        }
      : undefined;

    const doc = await Work.create({
      code: w.code,
      leadId: lead?._id,
      clientId: client._id,
      clientName: client.company || client.name,
      employeeId: employee?._id,
      title: w.title,
      description: w.description,
      service: w.service,
      priority: w.priority,
      deadline: daysFromNow(w.deadlineIn),
      status: w.status,
      progress: w.progress,
      employeeReport: report,
      revisionHistory: (w.revisions ?? []).map((r) => ({
        notes: r.notes,
        priority: r.priority,
        deadline: daysFromNow(r.deadlineIn),
        requestedAt: daysAgo(1),
      })),
      activity,
      createdAt,
      updatedAt: daysAgo(Math.min(w.createdAgo, 1)),
    });
    workMap.set(w.code, doc);
    workHistory.push({ id: doc._id, createdAt, updatedAt: daysAgo(Math.min(w.createdAgo, 1)) });
  }
  await stampHistory(Work, workHistory);
  logger.info(`Seeded ${workMap.size} work items`);

  /* 7. Projects ---------------------------------------------------------- */
  const projectMap = new Map();
  const projectHistory = [];
  for (const p of data.projects) {
    const client = clientMap.get(p.client);
    const doc = await Project.create({
      code: p.code,
      name: p.name,
      clientId: client._id,
      clientName: client.company || client.name,
      services: p.services,
      teamIds: p.team.map((k) => employeeMap.get(k)._id),
      progress: p.progress,
      deadline: daysFromNow(p.deadlineIn),
      status: p.status,
      tasks: (p.tasks ?? []).map((t) => ({ title: t.title, done: t.done, assigneeId: employeeMap.get(t.assignee)?._id })),
      comments: (p.comments ?? []).map((c) => ({ author: c.author, message: c.message, timestamp: daysAgo(2) })),
      createdAt: daysAgo(p.createdAgo),
    });
    projectMap.set(p.code, doc);
    projectHistory.push({ id: doc._id, createdAt: daysAgo(p.createdAgo) });
  }
  await stampHistory(Project, projectHistory);
  logger.info(`Seeded ${projectMap.size} projects`);

  /* 8. Bot flow ---------------------------------------------------------- */
  await BotStep.insertMany(data.botFlow);
  logger.info(`Seeded ${data.botFlow.length} bot steps`);

  /* 9. Conversations and messages ---------------------------------------- */
  let messageCount = 0;
  for (const c of data.conversations) {
    const client = clientMap.get(c.client);
    const lead = c.lead ? leadMap.get(c.lead) : null;
    const employee = c.employee ? employeeMap.get(c.employee) : null;
    const last = c.messages[c.messages.length - 1];

    const conversation = await Conversation.create({
      clientId: client._id,
      clientName: client.company || client.name,
      phone: client.phone,
      avatarColor: client.avatarColor,
      lastMessage: last.text,
      lastMessageAt: minutesAgo(c.minutesAgo),
      unreadCount: c.unreadCount,
      status: c.status,
      online: c.online,
      lastSeen: c.lastSeen,
      assignedEmployeeId: employee?._id,
      leadId: lead?._id,
      // These threads already produced a lead, so the bot has handed over.
      bot: { active: false, stepIndex: data.botFlow.length, collected: {}, completedAt: minutesAgo(c.minutesAgo) },
    });

    if (lead) {
      lead.conversationId = conversation._id;
      await lead.save();
    }

    await Message.insertMany(
      c.messages.map((m) => ({
        conversationId: conversation._id,
        clientId: client._id,
        direction: m.dir,
        message: m.type && m.type !== "text" ? "" : m.text,
        messageType: m.type ?? "text",
        mediaName: m.type && m.type !== "text" ? m.text : undefined,
        status: m.dir === "inbound" ? "delivered" : "read",
        timestamp: minutesAgo(m.minutesAgo),
      }))
    );
    messageCount += c.messages.length;
  }
  logger.info(`Seeded ${data.conversations.length} conversations, ${messageCount} messages`);

  /* 10. Files and notifications ------------------------------------------ */
  await FileAsset.insertMany(
    data.files.map((f) => {
      const client = f.client ? clientMap.get(f.client) : null;
      const project = f.project ? projectMap.get(f.project) : null;
      return {
        name: f.name,
        url: `/uploads/samples/${f.name}`,
        type: f.type,
        category: f.category,
        size: f.size,
        clientId: client?._id,
        clientName: client ? client.company || client.name : undefined,
        projectId: project?._id,
        projectName: project?.name,
        uploadedBy: f.uploadedBy,
        uploadedAt: daysAgo(f.daysAgo),
      };
    })
  );

  await Notification.insertMany(
    data.notifications.map((n) => ({
      title: n.title,
      description: n.description,
      category: n.category,
      read: n.read,
      href: n.href,
      timestamp: minutesAgo(n.minutesAgo),
    }))
  );
  logger.info(`Seeded ${data.files.length} files, ${data.notifications.length} notifications`);

  /* 11. Derived counters and sequence floors ------------------------------ */
  await Promise.all([recalcAllEmployeeStats(), recalcAllClientStats()]);
  await Promise.all([
    Counter.setFloor("lead", 1042),
    Counter.setFloor("work", 2201),
    Counter.setFloor("project", 501),
    Counter.setFloor("employee", data.employees.length),
    Counter.setFloor("client", data.clients.length),
    Counter.setFloor("service", data.services.length),
  ]);

  logger.info("Seed complete");
  logger.info(`Admin login: ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);
  logger.info(`Employee login example: rahul.sharma@maaadagency.com / ${env.SEED_EMPLOYEE_PASSWORD}`);

  await disconnectDB();
}

seed().catch(async (err) => {
  logger.error("Seed failed", { error: err.message, stack: err.stack });
  await mongoose.connection.close().catch(() => null);
  process.exit(1);
});

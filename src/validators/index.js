import { z } from "zod";
import {
  AVAILABILITY,
  CONVERSATION_STATUSES,
  FILE_CATEGORIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  NOTIFICATION_CATEGORIES,
  PRIORITIES,
  PROJECT_STATUSES,
  ROLES,
  WORK_STATUSES,
} from "../models/common.js";

const objectIdish = z.string().min(1);
const optionalDate = z.union([z.string(), z.date()]).optional();

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  search: z.string().trim().optional(),
});

export const idParam = z.object({ id: z.string().min(1) });

/* Auth ------------------------------------------------------------------- */
export const authSchemas = {
  login: z.object({
    email: z.string().email("A valid email is required"),
    password: z.string().min(1, "Password is required"),
  }),
  register: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.enum(ROLES).default("EMPLOYEE"),
    employeeId: objectIdish.optional(),
  }),
  changePassword: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  }),
};

/* Leads ------------------------------------------------------------------ */
export const leadSchemas = {
  list: paginationQuery.extend({
    status: z.enum([...LEAD_STATUSES, "All"]).optional(),
    priority: z.enum([...PRIORITIES, "All"]).optional(),
    source: z.enum([...LEAD_SOURCES, "All"]).optional(),
    service: z.string().optional(),
    employeeId: z.string().optional(),
  }),
  create: z.object({
    clientId: objectIdish.optional(),
    clientName: z.string().min(1).optional(),
    phone: z.string().min(6, "A contact number is required"),
    company: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    service: z.string().min(1, "Service is required"),
    requirement: z.string().min(1, "Requirement is required"),
    description: z.string().optional().default(""),
    referenceWebsite: z.string().optional(),
    deadline: optionalDate,
    budget: z.string().optional(),
    source: z.enum(LEAD_SOURCES).default("Manual"),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
  }),
  update: z.object({
    requirement: z.string().min(1).optional(),
    description: z.string().optional(),
    service: z.string().optional(),
    referenceWebsite: z.string().optional(),
    deadline: optionalDate,
    budget: z.string().optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    company: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
  }),
  assign: z.object({ employeeId: objectIdish }),
  status: z.object({ status: z.enum(LEAD_STATUSES) }),
};

/* Work ------------------------------------------------------------------- */
export const workSchemas = {
  list: paginationQuery.extend({
    status: z.enum([...WORK_STATUSES, "All"]).optional(),
    priority: z.enum([...PRIORITIES, "All"]).optional(),
    employeeId: z.string().optional(),
    clientId: z.string().optional(),
  }),
  create: z.object({
    leadId: objectIdish.optional(),
    clientId: objectIdish,
    title: z.string().min(1, "Title is required"),
    description: z.string().optional().default(""),
    service: z.string().min(1, "Service is required"),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    deadline: z.union([z.string(), z.date()]),
    employeeId: objectIdish.optional().or(z.literal("")),
    projectId: objectIdish.optional(),
  }),
  update: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: z.enum(PRIORITIES).optional(),
    deadline: optionalDate,
    progress: z.coerce.number().min(0).max(100).optional(),
  }),
  assign: z.object({ employeeId: objectIdish }),
  progress: z.object({ progress: z.coerce.number().min(0).max(100) }),
  revision: z.object({
    notes: z.string().min(1, "Describe the changes required"),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    deadline: optionalDate,
  }),
  submit: z.object({
    summary: z.string().min(1, "A summary is required"),
    remarks: z.string().optional().default(""),
    timeSpent: z.string().optional().default(""),
  }),
};

/* Employees and clients --------------------------------------------------- */
export const employeeSchemas = {
  list: paginationQuery.extend({ availability: z.enum([...AVAILABILITY, "All"]).optional() }),
  create: z.object({
    name: z.string().min(2),
    role: z.string().min(2, "Job title is required"),
    email: z.string().email(),
    phone: z.string().min(6),
    availability: z.enum(AVAILABILITY).default("Available"),
    skills: z.array(z.string()).default([]),
    joinedAt: optionalDate,
    createLogin: z.boolean().default(false),
    password: z.string().min(8).optional(),
  }),
  update: z.object({
    name: z.string().min(2).optional(),
    role: z.string().min(2).optional(),
    phone: z.string().min(6).optional(),
    availability: z.enum(AVAILABILITY).optional(),
    skills: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  }),
};

export const clientSchemas = {
  list: paginationQuery,
  create: z.object({
    name: z.string().min(2),
    company: z.string().optional(),
    phone: z.string().min(6),
    email: z.string().email().optional().or(z.literal("")),
  }),
  update: z.object({
    name: z.string().min(2).optional(),
    company: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().min(6).optional(),
  }),
};

/* Projects and services --------------------------------------------------- */
export const projectSchemas = {
  list: paginationQuery.extend({ status: z.enum([...PROJECT_STATUSES, "All"]).optional() }),
  create: z.object({
    name: z.string().min(2),
    clientId: objectIdish,
    services: z.array(z.string()).default([]),
    teamIds: z.array(objectIdish).default([]),
    deadline: z.union([z.string(), z.date()]),
    status: z.enum(PROJECT_STATUSES).default("Planning"),
  }),
  update: z.object({
    name: z.string().min(2).optional(),
    services: z.array(z.string()).optional(),
    teamIds: z.array(objectIdish).optional(),
    deadline: optionalDate,
    status: z.enum(PROJECT_STATUSES).optional(),
    progress: z.coerce.number().min(0).max(100).optional(),
  }),
  comment: z.object({ message: z.string().min(1) }),
  task: z.object({ title: z.string().min(1), assigneeId: objectIdish.optional() }),
  toggleTask: z.object({ done: z.boolean() }),
};

export const serviceSchemas = {
  create: z.object({
    name: z.string().min(2),
    description: z.string().optional().default(""),
    icon: z.string().optional().default("Sparkles"),
  }),
  update: z.object({
    name: z.string().min(2).optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    status: z.enum(["Active", "Disabled"]).optional(),
  }),
};

/* Notifications and files -------------------------------------------------- */
export const notificationSchemas = {
  list: paginationQuery.extend({
    category: z.enum([...NOTIFICATION_CATEGORIES, "All"]).optional(),
    unreadOnly: z.enum(["true", "false"]).optional(),
  }),
};

export const fileSchemas = {
  list: paginationQuery.extend({ category: z.enum([...FILE_CATEGORIES, "All"]).optional() }),
  upload: z.object({
    category: z.enum(FILE_CATEGORIES).default("Documents"),
    clientId: objectIdish.optional(),
    projectId: objectIdish.optional(),
    workId: objectIdish.optional(),
  }),
};

/* WhatsApp ----------------------------------------------------------------- */
export const whatsappSchemas = {
  conversations: paginationQuery.extend({
    filter: z.enum([...CONVERSATION_STATUSES, "All", "Unread"]).optional(),
  }),
  send: z.object({
    conversationId: objectIdish.optional(),
    to: z.string().min(6).optional(),
    message: z.string().min(1, "Message cannot be empty"),
  }),
  botStep: z.object({
    order: z.coerce.number().int().min(1).optional(),
    title: z.string().min(1),
    message: z.string().min(1),
    collectsField: z.string().optional(),
    options: z.array(z.object({ label: z.string().min(1) })).optional(),
    active: z.boolean().optional(),
  }),
  reorder: z.object({ ids: z.array(objectIdish).min(1) }),
};

/* Settings ----------------------------------------------------------------- */
export const settingsSchemas = {
  whatsapp: z.object({
    businessAccountId: z.string().optional(),
    phoneNumberId: z.string().optional(),
    webhookUrl: z.string().url().optional().or(z.literal("")),
  }),
  general: z.object({
    agencyName: z.string().min(2).optional(),
    supportEmail: z.string().email().optional(),
    supportPhone: z.string().optional(),
    timezone: z.string().optional(),
  }),
};

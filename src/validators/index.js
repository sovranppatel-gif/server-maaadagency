import { z } from "zod";
import {
  AVAILABILITY,
  CONVERSATION_STATUSES,
  EMPLOYEE_DEPARTMENTS,
  EMPLOYMENT_TYPES,
  FILE_CATEGORIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  NOTIFICATION_CATEGORIES,
  PRIORITIES,
  PROJECT_STATUSES,
  WORK_STATUSES,
} from "../models/common.js";
import { FOLLOW_UP_COMMUNICATION_TYPES, FOLLOW_UP_INTEREST_LEVELS } from "../models/LeadFollowUp.js";
import { QUOTATION_STATUSES } from "../models/Quotation.js";

const objectIdish = z.string().min(1);
const optionalDate = z.union([z.string(), z.date()]).optional();
const phoneInput = z
  .string()
  .trim()
  .min(6, "A valid phone number is required")
  .max(30, "Phone number is too long")
  .refine((value) => value.replace(/\D/g, "").length >= 6, "A valid phone number is required");
const optionalPhoneInput = z.union([phoneInput, z.literal("")]).optional();

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
    role: z.literal("ADMIN").default("ADMIN"),
  }),
  employeeSetup: z.object({
    token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
    password: z.string().min(12, "Password must be at least 12 characters").max(128),
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
    clientName: z.string().trim().min(1).max(160).optional(),
    contactPersonName: z.string().trim().max(120).optional(),
    phone: phoneInput,
    alternatePhone: optionalPhoneInput,
    company: z.string().trim().max(160).optional(),
    email: z.string().email().max(254).optional().or(z.literal("")),
    service: z.string().trim().min(1, "Service is required").max(120),
    requirement: z.string().trim().min(1, "Requirement is required").max(5000),
    description: z.string().max(5000).optional().default(""),
    quantitySizeDimensions: z.string().trim().max(300).optional(),
    internalRemarks: z.string().trim().max(2000).optional(),
    referenceWebsite: z.string().optional(),
    deadline: optionalDate,
    enquiryDate: optionalDate,
    budget: z.string().trim().max(50).optional(),
    source: z.enum(LEAD_SOURCES).default("Manual"),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    assignedEmployeeId: objectIdish.optional().or(z.literal("")),
  }),
  update: z.object({
    contactPersonName: z.string().trim().max(120).optional(),
    alternatePhone: optionalPhoneInput,
    requirement: z.string().trim().min(1).max(5000).optional(),
    description: z.string().max(5000).optional(),
    quantitySizeDimensions: z.string().trim().max(300).optional(),
    internalRemarks: z.string().trim().max(2000).optional(),
    service: z.string().trim().max(120).optional(),
    referenceWebsite: z.string().optional(),
    deadline: optionalDate,
    enquiryDate: optionalDate,
    budget: z.string().trim().max(50).optional(),
    source: z.enum(LEAD_SOURCES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    company: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
  }),
  assign: z.object({ employeeId: objectIdish }),
  status: z.object({ status: z.enum(LEAD_STATUSES) }),
  followUp: z.object({
    communicationType: z.enum(FOLLOW_UP_COMMUNICATION_TYPES),
    contactedAt: z.iso.datetime(),
    customerResponse: z.string().trim().max(3000).optional().default(""),
    discussionNotes: z.string().trim().min(1).max(5000),
    nextFollowUpAt: z.iso.datetime().optional(),
    interestLevel: z.enum(FOLLOW_UP_INTEREST_LEVELS),
    quotationRequired: z.boolean().default(false),
    employeeRemarks: z.string().trim().max(2000).optional().default(""),
  }),
  followUpAuthorization: z.object({
    additionalAttempts: z.coerce.number().int().min(1).max(4),
  }),
};

/* Work ------------------------------------------------------------------- */
export const workSchemas = {
  list: paginationQuery.extend({
    status: z.enum([...WORK_STATUSES, "All"]).optional(),
    priority: z.enum([...PRIORITIES, "All"]).optional(),
    employeeId: z.string().optional(),
    clientId: z.string().optional(),
    upcomingOnly: z.enum(["true", "false"]).optional(),
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
  progress: z.object({
    progress: z.coerce.number().min(0).max(100).optional(),
    start: z.boolean().optional(),
    progressNote: z.string().trim().max(2000).optional(),
    blockedReason: z.string().trim().max(1000).optional(),
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one progress update"),
  revision: z.object({
    notes: z.string().min(1, "Describe the changes required"),
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    deadline: optionalDate,
  }),
  submit: z.object({
    summary: z.string().trim().min(1, "A summary is required").max(5000),
    remarks: z.string().trim().max(3000).optional().default(""),
    timeSpent: z.string().trim().max(100).optional().default(""),
  }),
};

export const followUpSchemas = {
  list: paginationQuery.extend({
    bucket: z.enum(["All", "upcoming", "today", "overdue"]).optional(),
  }),
};

const quotationLineItem = z.object({
  serviceId: z.string().regex(/^[a-f\d]{24}$/i).optional().or(z.literal("")),
  serviceName: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(""),
  quantityMilli: z.number().int().min(1).max(1_000_000_000),
  unit: z.string().trim().min(1).max(40),
  unitRatePaise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  discountBps: z.number().int().min(0).max(10_000).default(0),
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
});

const quotationDraftFields = {
  lineItems: z.array(quotationLineItem).min(1).max(100),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  currency: z.literal("INR").default("INR"),
  paymentTerms: z.string().trim().max(3000).optional().default(""),
  termsAndConditions: z.string().trim().max(8000).optional().default(""),
  internalNotes: z.string().trim().max(3000).optional().default(""),
};

function validateQuotationDates(value, context) {
  if (new Date(value.validUntil) < new Date(value.validFrom)) {
    context.addIssue({ code: "custom", path: ["validUntil"], message: "Valid until must be on or after valid from" });
  }
}

export const quotationSchemas = {
  list: paginationQuery.extend({
    status: z.enum([...QUOTATION_STATUSES, "All"]).optional(),
    leadId: z.string().optional(),
    expiringOnly: z.enum(["true", "false"]).optional(),
  }),
  create: z.object({
    leadId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    clientId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    assignedSalesEmployeeId: z.string().regex(/^[a-f\d]{24}$/i).optional().or(z.literal("")),
    ...quotationDraftFields,
  }).superRefine((value, context) => {
    if (!value.leadId && !value.clientId) {
      context.addIssue({ code: "custom", path: ["leadId"], message: "Select a lead or a client" });
    }
    validateQuotationDates(value, context);
  }),
  draft: z.object(quotationDraftFields).superRefine(validateQuotationDates),
  submit: z.object({}),
  approve: z.object({}),
  reject: z.object({ reason: z.string().trim().min(1).max(2000) }),
  revisionRequest: z.object({ reason: z.string().trim().min(1).max(2000) }),
  send: z.object({ sentMethod: z.enum(["EMAIL", "WHATSAPP", "IN_PERSON", "OTHER"]) }),
  customerDecision: z.object({
    decision: z.enum(["ACCEPTED", "REJECTED"]),
    note: z.string().trim().max(2000).optional().default(""),
  }),
  expire: z.object({}),
  revision: z.object({}),
  pdf: z.object({ version: z.coerce.number().int().positive().optional() }),
};

/* Employees and clients --------------------------------------------------- */
export const employeeSchemas = {
  list: paginationQuery.extend({
    availability: z.enum([...AVAILABILITY, "All"]).optional(),
    status: z.enum(["Active", "Inactive", "All"]).optional(),
    department: z.enum([...EMPLOYEE_DEPARTMENTS, "All"]).optional(),
    includeInactive: z.enum(["true", "false"]).optional(),
  }),
  create: z.object({
    name: z.string().trim().min(2).max(160),
    role: z.string().trim().min(2, "Designation is required").max(120),
    email: z.string().trim().email().max(254),
    phone: phoneInput,
    alternatePhone: optionalPhoneInput,
    department: z.enum(EMPLOYEE_DEPARTMENTS).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(120).optional(),
    reportingManager: objectIdish.optional().or(z.literal("")),
    availability: z.enum(AVAILABILITY).default("Available"),
    skills: z.array(z.string()).default([]),
    joinedAt: optionalDate,
    isActive: z.boolean().default(true),
    createLogin: z.literal(false).optional(),
    password: z.never().optional(),
  }),
  update: z.object({
    name: z.string().trim().min(2).max(160).optional(),
    role: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: phoneInput.optional(),
    alternatePhone: optionalPhoneInput,
    department: z.enum(EMPLOYEE_DEPARTMENTS).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(120).optional(),
    reportingManager: objectIdish.optional().or(z.literal("")),
    availability: z.enum(AVAILABILITY).optional(),
    skills: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  }),
  access: z.object({ enabled: z.boolean() }),
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
  read: z.object({ read: z.boolean().optional() }),
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
  faq: z.object({
    question: z.string().trim().min(3).max(500),
    answer: z.string().trim().min(1).max(2000),
    keywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    category: z.string().trim().max(60).optional(),
    active: z.boolean().optional(),
    order: z.coerce.number().int().min(0).optional(),
  }),
};

/* Settings ----------------------------------------------------------------- */
export const settingsSchemas = {
  whatsapp: z.object({
    businessAccountId: z.string().optional(),
    phoneNumberId: z.string().optional(),
    webhookUrl: z.string().url().optional().or(z.literal("")),
    autoLeadCreationEnabled: z.boolean().optional(),
  }),
  general: z.object({
    agencyName: z.string().min(2).optional(),
    supportEmail: z.string().email().optional(),
    supportPhone: z.string().optional(),
    timezone: z.string().optional(),
  }),
  ai: z.object({
    enabled: z.boolean().optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    contextMessages: z.number().int().min(1).max(30).optional(),
  }),
};

import ExcelJS from "exceljs";
import { Lead } from "../models/Lead.js";
import { LeadFollowUp } from "../models/LeadFollowUp.js";
import { LeadVisit } from "../models/LeadVisit.js";
import { Employee } from "../models/Employee.js";
import {
  escapeSpreadsheetCell,
  formatIstDisplay,
  safeSheetName,
  toCsvCell,
} from "../utils/spreadsheetSafety.js";

export const EXPORT_MAX_ROWS = 10000;

function presentPhone(phone) {
  return phone ? String(phone) : "";
}

function buildLeadExportRows(leads, employeeNameMap, isEmployeeUser) {
  return leads.map((lead) => ({
    code: lead.code ?? String(lead._id),
    clientName: lead.clientName ?? "",
    contactPersonName: lead.contactPersonName ?? "",
    phone: presentPhone(lead.phone),
    alternatePhone: presentPhone(lead.alternatePhone),
    email: lead.email ?? "",
    service: lead.service ?? "",
    requirement: lead.requirement ?? "",
    source: lead.source ?? "",
    campaign: lead.importMetadata?.rawSource ?? "",
    quality: lead.quality ?? "Unclassified",
    status: lead.status ?? "",
    priority: lead.priority ?? "",
    assignedEmployee: lead.assignedEmployeeId ? (employeeNameMap.get(String(lead.assignedEmployeeId)) ?? "") : "Unassigned",
    enquiryDate: formatIstDisplay(lead.enquiryDate ?? lead.createdAt),
    createdAt: formatIstDisplay(lead.createdAt),
    ...(isEmployeeUser ? {} : { internalRemarks: lead.internalRemarks ?? "", budget: lead.budget ?? "" }),
  }));
}

function buildFollowUpExportRows(leads, liveFollowUps, employeeNameMap) {
  const leadCodeMap = new Map(leads.map((l) => [String(l._id), { code: l.code ?? String(l._id), clientName: l.clientName, phone: presentPhone(l.phone) }]));
  const rows = [];

  for (const fu of liveFollowUps) {
    const leadInfo = leadCodeMap.get(String(fu.leadId));
    rows.push({
      leadCode: leadInfo?.code ?? String(fu.leadId),
      clientName: leadInfo?.clientName ?? "",
      phone: leadInfo?.phone ?? "",
      recordType: "LIVE_CRM",
      attemptNumber: fu.attemptNumber,
      communicationType: fu.communicationType ?? "",
      callResponse: fu.callResponse ?? "",
      rawResponse: fu.customerResponse ?? "",
      notes: fu.discussionNotes ?? "",
      contactedAt: formatIstDisplay(fu.contactedAt),
      nextFollowUpAt: formatIstDisplay(fu.nextFollowUpAt),
      actor: employeeNameMap.get(String(fu.employeeId)) ?? "Employee",
    });
  }

  for (const lead of leads) {
    for (const hist of lead.historicalFollowUps ?? []) {
      rows.push({
        leadCode: lead.code ?? String(lead._id),
        clientName: lead.clientName ?? "",
        phone: presentPhone(lead.phone),
        recordType: "EXCEL_IMPORT",
        attemptNumber: "",
        communicationType: "Call",
        callResponse: hist.callResponse ?? "",
        rawResponse: hist.rawResponse ?? "",
        notes: hist.note ?? (hist.sourceSheet ? `Sheet: ${hist.sourceSheet} row ${hist.sourceRow}` : ""),
        contactedAt: formatIstDisplay(hist.callDate) || hist.rawDateLabel || "",
        nextFollowUpAt: "",
        actor: "Excel Import",
      });
    }
  }
  return rows;
}

function buildVisitExportRows(leads, visits, employeeNameMap) {
  const leadCodeMap = new Map(leads.map((l) => [String(l._id), { code: l.code ?? String(l._id), clientName: l.clientName, phone: presentPhone(l.phone) }]));
  return visits.map((v) => {
    const leadInfo = leadCodeMap.get(String(v.leadId));
    return {
      visitCode: v.code ?? String(v._id),
      leadCode: leadInfo?.code ?? String(v.leadId),
      clientName: leadInfo?.clientName ?? "",
      phone: leadInfo?.phone ?? "",
      visitType: v.visitType ?? "",
      title: v.title ?? "",
      status: v.status ?? "",
      scheduledStart: formatIstDisplay(v.scheduledStart),
      location: v.meetingLink || v.locationAddress || "",
      assignedEmployee: v.assignedEmployeeId ? (employeeNameMap.get(String(v.assignedEmployeeId)) ?? "") : "Unassigned",
      outcome: v.outcome ?? "",
      notes: v.notes ?? "",
      cancellationReason: v.cancellationReason ?? "",
    };
  });
}

function appendSheetWithSafeRows(workbook, sheetName, columns, rows, usedNames) {
  const ws = workbook.addWorksheet(safeSheetName(sheetName, usedNames));
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const safeObj = {};
    for (const col of columns) {
      const val = row[col.key];
      safeObj[col.key] = col.isPhone ? String(val ?? "") : escapeSpreadsheetCell(val);
    }
    const added = ws.addRow(safeObj);
    for (const col of columns) {
      if (col.isPhone) {
        added.getCell(col.key).numFmt = "@";
      }
    }
  }
}

/**
 * Queries matching authorized leads + optional follow-ups & visits, and builds
 * an .xlsx or .csv export buffer with formula-injection protection and IST dates.
 */
export async function generateLeadsExport({ filter, user, format = "xlsx", includeFollowUps = false, includeVisits = false }) {
  const isEmployeeUser = user?.role === "EMPLOYEE";
  const selectFields = isEmployeeUser
    ? "-activity -attachments -qualityHistory -budget -internalRemarks -submissionKey -importMetadata"
    : "-activity -attachments -qualityHistory -submissionKey";

  const leads = await Lead.find(filter)
    .select(selectFields)
    .sort({ createdAt: -1 })
    .limit(EXPORT_MAX_ROWS)
    .lean();

  const leadIds = leads.map((l) => l._id);

  const [employees, liveFollowUps, visits] = await Promise.all([
    Employee.find({}).select("name").lean(),
    includeFollowUps && leadIds.length
      ? LeadFollowUp.find({ leadId: { $in: leadIds } })
          .select("-idempotencyKey -submittedBy")
          .sort({ leadId: 1, attemptNumber: 1 })
          .lean()
      : [],
    includeVisits && leadIds.length
      ? LeadVisit.find({ leadId: { $in: leadIds } })
          .select("-createdBy -idempotencyKey -history.actorId")
          .sort({ scheduledStart: -1 })
          .lean()
      : [],
  ]);

  const employeeNameMap = new Map(employees.map((e) => [String(e._id), e.name]));
  const leadRows = buildLeadExportRows(leads, employeeNameMap, isEmployeeUser);

  const leadColumns = [
    { header: "Lead ID", key: "code", width: 14 },
    { header: "Client Name", key: "clientName", width: 24 },
    { header: "Contact Person", key: "contactPersonName", width: 20 },
    { header: "Phone", key: "phone", width: 18, isPhone: true },
    { header: "Alternate Phone", key: "alternatePhone", width: 18, isPhone: true },
    { header: "Email", key: "email", width: 24 },
    { header: "Service", key: "service", width: 20 },
    { header: "Requirement", key: "requirement", width: 32 },
    { header: "Source", key: "source", width: 16 },
    { header: "Campaign / Raw Source", key: "campaign", width: 20 },
    { header: "Lead Quality", key: "quality", width: 14 },
    { header: "Workflow Status", key: "status", width: 18 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Assigned Employee", key: "assignedEmployee", width: 20 },
    { header: "Enquiry Date (IST)", key: "enquiryDate", width: 22 },
    { header: "Created At (IST)", key: "createdAt", width: 22 },
    ...(isEmployeeUser
      ? []
      : [
          { header: "Estimated Budget", key: "budget", width: 16 },
          { header: "Internal Remarks", key: "internalRemarks", width: 28 },
        ]),
  ];

  if (format === "csv") {
    const lines = [leadColumns.map((c) => toCsvCell(c.header)).join(",")];
    for (const row of leadRows) {
      lines.push(leadColumns.map((c) => toCsvCell(row[c.key], { isPhone: c.isPhone })).join(","));
    }
    const bom = "\uFEFF";
    return {
      buffer: Buffer.from(bom + lines.join("\r\n"), "utf8"),
      contentType: "text/csv; charset=utf-8",
      extension: "csv",
      count: leadRows.length,
    };
  }

  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set();
  appendSheetWithSafeRows(workbook, "Leads", leadColumns, leadRows, usedNames);

  if (includeFollowUps) {
    const fuRows = buildFollowUpExportRows(leads, liveFollowUps, employeeNameMap);
    const fuColumns = [
      { header: "Lead ID", key: "leadCode", width: 14 },
      { header: "Client Name", key: "clientName", width: 24 },
      { header: "Phone", key: "phone", width: 18, isPhone: true },
      { header: "Record Type", key: "recordType", width: 14 },
      { header: "Attempt #", key: "attemptNumber", width: 10 },
      { header: "Type", key: "communicationType", width: 14 },
      { header: "Call Response", key: "callResponse", width: 18 },
      { header: "Raw Response", key: "rawResponse", width: 24 },
      { header: "Notes", key: "notes", width: 32 },
      { header: "Contacted At (IST)", key: "contactedAt", width: 22 },
      { header: "Next Follow-up (IST)", key: "nextFollowUpAt", width: 22 },
      { header: "Actor / Source", key: "actor", width: 20 },
    ];
    appendSheetWithSafeRows(workbook, "Follow-up History", fuColumns, fuRows, usedNames);
  }

  if (includeVisits) {
    const visitRows = buildVisitExportRows(leads, visits, employeeNameMap);
    const visitColumns = [
      { header: "Visit ID", key: "visitCode", width: 14 },
      { header: "Lead ID", key: "leadCode", width: 14 },
      { header: "Client Name", key: "clientName", width: 24 },
      { header: "Phone", key: "phone", width: 18, isPhone: true },
      { header: "Visit Type", key: "visitType", width: 18 },
      { header: "Title", key: "title", width: 26 },
      { header: "Visit Status", key: "status", width: 16 },
      { header: "Scheduled (IST)", key: "scheduledStart", width: 22 },
      { header: "Location / Link", key: "location", width: 28 },
      { header: "Assigned Employee", key: "assignedEmployee", width: 20 },
      { header: "Outcome", key: "outcome", width: 20 },
      { header: "Notes", key: "notes", width: 28 },
      { header: "Cancellation Reason", key: "cancellationReason", width: 26 },
    ];
    appendSheetWithSafeRows(workbook, "Customer Visits", visitColumns, visitRows, usedNames);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    count: leadRows.length,
  };
}

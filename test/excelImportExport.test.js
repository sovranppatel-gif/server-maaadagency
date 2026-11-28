import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Client } from "../src/models/Client.js";
import { Lead } from "../src/models/Lead.js";
import { LeadFollowUp } from "../src/models/LeadFollowUp.js";
import { LeadVisit } from "../src/models/LeadVisit.js";
import { Employee } from "../src/models/Employee.js";
import { ImportJob } from "../src/models/ImportJob.js";
import { Counter } from "../src/models/Counter.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { parseCsvBuffer, escapeSpreadsheetCell, formatIstDisplay, formatIstDateKey } from "../src/utils/spreadsheetSafety.js";
import { parseWorkbookBuffer } from "../src/services/excelImport.service.js";
import { generateLeadsExport } from "../src/services/excelExport.service.js";

function queryStub(result) {
  const chain = {
    select: () => chain,
    populate: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: async () => (typeof result === "function" ? result() : result),
    then: (resolve, reject) =>
      Promise.resolve(typeof result === "function" ? result() : result).then(resolve, reject),
  };
  return chain;
}

function makeAdminUser(id, name = "Aarav Admin") {
  return new User({
    _id: id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, "")}@test.local`,
    role: "MASTER_ADMIN",
    isActive: true,
    tokenVersion: 0,
  });
}

function makeEmployeeUser(userId, empId, name, active = true) {
  const user = new User({
    _id: userId,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, "")}@test.local`,
    role: "EMPLOYEE",
    employee: empId,
    isActive: true,
    tokenVersion: 0,
  });
  Object.defineProperty(user, "employee", {
    value: { _id: empId, name, role: "Sales", isActive: active },
    configurable: true,
    enumerable: true,
  });
  return user;
}

async function withServer(fn) {
  const origDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  Object.defineProperty(mongoose.connection, "readyState", { configurable: true, get: () => 1 });
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (origDescriptor) Object.defineProperty(mongoose.connection, "readyState", origDescriptor);
  }
}

async function buildClientStyleWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: "MAY 2026 ALL LEADS" with title banner, empty rows, duplicate STATUS headers, repeated date headers
  const s1 = wb.addWorksheet("MAY 2026 ALL LEADS");
  s1.addRow(["MAAAD AGENCY — MAY 2026 CLIENT LEAD TRACKING SHEET"]);
  s1.addRow([]);
  s1.addRow([
    "SR. NO.",
    "DATE",
    "TIME",
    "NAME",
    "CONTACT NO.",
    "ADDRESS",
    "DETAILS / REQUIREMENT",
    "STATUS", // Quality
    "SOURCE",
    "STATUS", // Context status
    "05-05-2026",
    "07/05/2026",
    "VISIT PLAN",
  ]);
  s1.addRow([]); // empty row inside body
  // Valid HOT row with complete visit plan + alias call responses
  s1.addRow([
    "1",
    "04/05/2026",
    "11:30 AM",
    "Rohan Verma",
    "9876543210",
    "Sector 62, Noida",
    "3BHK Acrylic Signage & Branding",
    "hot",
    "Meta Ads - Summer",
    "Site Visit 10/05/2026",
    "NOT PICK",
    "BUZY",
    "VISIT PLAN 10/05/2026 Sector 62 Noida",
  ]);
  // Valid WARM row with unknown quality + incomplete visit (warning only) + formula-like note
  s1.addRow([
    "2",
    "05/05/2026",
    "02:00 PM",
    "Meera Joshi",
    "+91 98111 22334",
    "",
    "Retail Led Board",
    "SUPER PRIORITY", // unknown -> null + rawQuality preserved
    "Instagram",
    "Pricing shared",
    "PRICING IS ON HIGHER SIDE",
    "Will decide Monday",
    "VISIT PLAN", // Missing reliable date and address -> warning only
  ]);
  // Duplicate row inside same sheet (same phone + source + requirement + date)
  s1.addRow([
    "3",
    "04/05/2026",
    "11:35 AM",
    "Rohan Verma",
    "9876543210",
    "Sector 62, Noida",
    "3BHK Acrylic Signage & Branding",
    "HOT",
    "Meta Ads - Summer",
    "No Response",
    "NO RESPONSE",
    "",
    "",
  ]);
  // Invalid row: missing primary phone
  s1.addRow([
    "4",
    "06/05/2026",
    "10:00 AM",
    "No Phone Lead",
    "abc-123",
    "Delhi",
    "Brochure Print",
    "COLD",
    "Website",
    "",
    "CALL CUT",
    "",
    "",
  ]);

  // Sheet 2: "FILTER LEADS " (trailing whitespace!) with overlapping duplicate + 1 new unique lead
  const s2 = wb.addWorksheet("FILTER LEADS ");
  s2.addRow(["SR", "DATE", "CLIENT NAME", "PHONE", "REQUIREMENT", "QUALITY", "SOURCE", "08/05/2026"]);
  // Overlaps with Sheet 1 Row 1
  s2.addRow(["1", "04/05/2026", "Rohan Verma", "9876543210", "3BHK Acrylic Signage & Branding", "HOT", "Meta Ads - Summer", "OUT OF SERVICE"]);
  // Same phone as Sheet 1 Row 1, but DIFFERENT requirement + DIFFERENT date -> ambiguous phone warning, still IMPORTABLE!
  s2.addRow(["2", "12/05/2026", "Rohan Verma", "9876543210", "Office Glass Vinyl Graphics", "TRY", "Referral", "Call back tomorrow"]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("Phase 3: Excel Import, Export & Historical Lead Migration", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("parses client-style multi-sheet XLSX, detects duplicate headers, skips empty rows, maps quality/call-responses, and flags duplicates/warnings", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const adminUser = makeAdminUser(adminId);
    const adminToken = signAccessToken(adminUser);
    const xlsxBuffer = await buildClientStyleWorkbookBuffer();

    const previewJobs = new Map();
    mock.method(User, "findById", () => queryStub(adminUser));
    mock.method(Lead, "find", () => queryStub([]));
    mock.method(ImportJob, "create", async (payload) => {
      const id = new mongoose.Types.ObjectId();
      const doc = {
        _id: id,
        code: "IMP-001",
        ...payload,
      };
      previewJobs.set(payload.previewTokenHash, doc);
      return doc;
    });

    await withServer(async (baseUrl) => {
      const form = new FormData();
      form.append("file", new Blob([xlsxBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "client-tracker.xlsx");

      const res = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form,
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.success, true);

      const data = json.data;
      assert.ok(data.previewToken);
      assert.deepEqual(data.worksheetNames, ["MAY 2026 ALL LEADS", "FILTER LEADS "]);
      assert.equal(data.sheets.length, 2);

      // Verify duplicate STATUS columns in Sheet 1 mapped to quality & contextStatus cleanly
      const sheet1 = data.sheets.find((s) => s.sheetName === "MAY 2026 ALL LEADS");
      const statusMappings = sheet1.columnMapping.filter((c) => c.header === "STATUS");
      assert.deepEqual(
        statusMappings.map((m) => m.mappedTo),
        ["quality", "contextStatus"]
      );

      // Total 6 non-empty body rows across both sheets:
      // Sheet 1: Rohan (IMPORTABLE), Meera (IMPORTABLE w/ unknown quality & incomplete visit warn), Rohan dup (DUPLICATE_WORKBOOK), Invalid phone (INVALID)
      // Sheet 2: Rohan cross-sheet overlap (DUPLICATE_WORKBOOK), Rohan new enquiry on 12/05 (IMPORTABLE w/ ambiguous phone warn)
      assert.equal(data.summary.totalRows, 6);
      assert.equal(data.summary.validRows, 3);
      assert.equal(data.summary.invalidRows, 1);
      assert.equal(data.summary.duplicateCount, 2);
      assert.equal(data.summary.ambiguousCount, 1);
      assert.equal(data.summary.visitCandidateCount, 1);
      assert.ok(data.summary.visitWarningCount >= 1);

      const rohanRow = data.rows.find((r) => r.clientName === "Rohan Verma" && r.previewStatus === "IMPORTABLE" && r.sheetName === "MAY 2026 ALL LEADS");
      assert.equal(rohanRow.quality, "HOT");
      assert.equal(rohanRow.phone, "919876543210");
      assert.ok(rohanRow.visitCandidate);
      assert.equal(rohanRow.visitCandidate.locationAddress, "Sector 62, Noida");
      assert.ok(rohanRow.historicalFollowUps.some((h) => h.callResponse === "NOT_PICKED" && h.rawResponse === "NOT PICK"));
      assert.ok(rohanRow.historicalFollowUps.some((h) => h.callResponse === "BUSY" && h.rawResponse === "BUZY"));

      const meeraRow = data.rows.find((r) => r.clientName === "Meera Joshi");
      assert.equal(meeraRow.quality ?? null, null);
      assert.equal(meeraRow.rawQuality, "SUPER PRIORITY");
      assert.equal(meeraRow.visitCandidate, null);
      assert.ok(meeraRow.warnings.some((w) => w.includes("SUPER PRIORITY")));
      assert.ok(meeraRow.historicalFollowUps.some((h) => h.callResponse === "PRICING_CONCERN"));
      assert.ok(meeraRow.historicalFollowUps.some((h) => h.callResponse === null && h.rawResponse === "Will decide Monday"));
    });
  });

  it("supports worksheet selection, UTF-8 CSV preview, and rejects malformed/oversized/unsupported files", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const adminUser = makeAdminUser(adminId);
    const adminToken = signAccessToken(adminUser);
    const xlsxBuffer = await buildClientStyleWorkbookBuffer();

    mock.method(User, "findById", () => queryStub(adminUser));
    mock.method(Lead, "find", () => queryStub([]));
    mock.method(ImportJob, "create", async (payload) => ({ _id: new mongoose.Types.ObjectId(), code: "IMP-002", ...payload }));

    await withServer(async (baseUrl) => {
      // 1. Worksheet subset selection (notice trimmed/extra-space normalized matching for "FILTER LEADS ")
      const formSheetSubset = new FormData();
      formSheetSubset.append("file", new Blob([xlsxBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "multi.xlsx");
      formSheetSubset.append("selectedSheets", JSON.stringify(["FILTER LEADS"]));

      const subsetRes = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formSheetSubset,
      });
      const subsetJson = await subsetRes.json();
      assert.equal(subsetRes.status, 200);
      assert.equal(subsetJson.data.summary.totalRows, 2);
      assert.deepEqual(subsetJson.data.selectedSheets, ["FILTER LEADS "]);

      // 2. CSV with UTF-8 BOM + quoted commas + date + call response
      const csvText = "\uFEFFSR,DATE,CLIENT NAME,PHONE,REQUIREMENT,QUALITY,SOURCE,05/05/2026\r\n1,05/05/2026,\"Karan, Mehta\",9988776655,3D Glow Sign,warm,Website,NOT PICK\r\n";
      const csvForm = new FormData();
      csvForm.append("file", new Blob([Buffer.from(csvText, "utf8")], { type: "text/csv" }), "leads.csv");
      const csvRes = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: csvForm,
      });
      const csvJson = await csvRes.json();
      assert.equal(csvRes.status, 200);
      assert.equal(csvJson.data.fileFormat, "csv");
      assert.equal(csvJson.data.summary.validRows, 1);
      assert.equal(csvJson.data.rows[0].clientName, "Karan, Mehta");
      assert.equal(csvJson.data.rows[0].quality, "WARM");

      // 3. Unsupported extension (.exe) -> rejected with 400
      const badExtForm = new FormData();
      badExtForm.append("file", new Blob([Buffer.from("MZ")], { type: "application/octet-stream" }), "malware.exe");
      const badExtRes = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: badExtForm,
      });
      assert.equal(badExtRes.status, 400);

      // 4. Corrupt XLSX buffer -> safely rejected (400), never crashes server
      const corruptForm = new FormData();
      corruptForm.append("file", new Blob([Buffer.from("not-a-valid-zip-xlsx")], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "broken.xlsx");
      const corruptRes = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: corruptForm,
      });
      assert.equal(corruptRes.status, 400);
    });
  });

  it("enforces two-step confirm tokens, DRY_RUN, idempotency replay, token expiration/reuse, and partial failures without altering live LeadFollowUp 1-4 limits", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const otherAdminId = new mongoose.Types.ObjectId();
    const adminUser = makeAdminUser(adminId, "Priya Admin");
    const adminToken = signAccessToken(adminUser);
    const otherAdminToken = signAccessToken(makeAdminUser(otherAdminId, "Other Admin"));
    const xlsxBuffer = await buildClientStyleWorkbookBuffer();

    const storedJobs = new Map(); // id -> job doc
    const createdLeads = [];
    const createdClients = new Map();
    const createdVisits = [];

    mock.method(User, "findById", (id) => {
      if (String(id) === String(otherAdminId)) return queryStub(makeAdminUser(otherAdminId, "Other Admin"));
      return queryStub(adminUser);
    });
    mock.method(Lead, "find", () => queryStub([]));
    mock.method(Lead, "findOne", (filter) => {
      if (filter["importMetadata.fingerprint"]) {
        const match = createdLeads.find((l) => l.importMetadata?.fingerprint === filter["importMetadata.fingerprint"]);
        return queryStub(match ?? null);
      }
      return queryStub(null);
    });
    mock.method(Client, "findOne", (filter) => queryStub(createdClients.get(filter.phone) ?? null));
    mock.method(Client, "create", async (payload) => {
      const c = { _id: new mongoose.Types.ObjectId(), ...payload };
      createdClients.set(payload.phone, c);
      return c;
    });
    mock.method(Lead, "create", async (payload) => {
      if (payload.clientName === "FAIL_ROW_TRIGGER") {
        throw new Error("Simulated validation failure on third row");
      }
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        code: `LD-${String(createdLeads.length + 1).padStart(3, "0")}`,
        followUpLimit: 4,
        ...payload,
      };
      createdLeads.push(doc);
      return doc;
    });
    mock.method(LeadVisit, "create", async (payload) => {
      const v = { _id: new mongoose.Types.ObjectId(), code: `VST-00${createdVisits.length + 1}`, ...payload };
      createdVisits.push(v);
      return v;
    });
    mock.method(LeadFollowUp, "find", () => queryStub([]));
    mock.method(LeadFollowUp, "countDocuments", async () => 0);

    mock.method(ImportJob, "create", async (payload) => {
      const id = new mongoose.Types.ObjectId();
      const doc = {
        _id: id,
        code: `IMP-00${storedJobs.size + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...payload,
        toJSON() {
          const clone = { ...this, id: String(this._id) };
          delete clone._id;
          delete clone.previewSnapshot;
          delete clone.previewTokenHash;
          return clone;
        },
      };
      storedJobs.set(String(id), doc);
      return doc;
    });

    mock.method(ImportJob, "findOne", (filter) => {
      if (filter.confirmIdempotencyKey) {
        const match = [...storedJobs.values()].find(
          (j) => j.confirmIdempotencyKey === filter.confirmIdempotencyKey && String(j.importedBy) === String(filter.importedBy)
        );
        return queryStub(match ?? null);
      }
      if (filter.previewTokenHash) {
        const match = [...storedJobs.values()].find((j) => j.previewTokenHash === filter.previewTokenHash);
        return queryStub(match ?? null);
      }
      return queryStub(null);
    });

    mock.method(ImportJob, "findOneAndUpdate", (filter, update) => {
      const match = [...storedJobs.values()].find(
        (j) =>
          j.previewTokenHash === filter.previewTokenHash &&
          String(j.importedBy) === String(filter.importedBy) &&
          j.status === filter.status &&
          j.previewExpiresAt > filter.previewExpiresAt.$gt
      );
      if (!match) return queryStub(null);
      Object.assign(match, update.$set);
      return queryStub(match);
    });

    mock.method(ImportJob, "findByIdAndUpdate", async (id, update) => {
      const match = storedJobs.get(String(id));
      if (!match) return null;
      Object.assign(match, update.$set);
      if (update.$unset) {
        delete match.previewSnapshot;
        delete match.previewTokenHash;
      }
      return match;
    });

    await withServer(async (baseUrl) => {
      // A. Upload & get preview token 1 for DRY_RUN
      const form1 = new FormData();
      form1.append("file", new Blob([xlsxBuffer]), "dryrun.xlsx");
      const p1Res = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form1,
      });
      const p1 = (await p1Res.json()).data;

      // Another admin cannot steal previewToken
      const stolenRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherAdminToken}` },
        body: JSON.stringify({ previewToken: p1.previewToken, importMode: "CREATE_SKIP_DUPLICATES" }),
      });
      assert.equal(stolenRes.status, 400);

      // Dry run creates 0 records in Lead / Client / LeadVisit
      const dryRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ previewToken: p1.previewToken, importMode: "DRY_RUN" }),
      });
      const dryJson = await dryRes.json();
      assert.equal(dryRes.status, 200);
      assert.equal(dryJson.data.importMode, "DRY_RUN");
      assert.equal(dryJson.data.createdCount, 3);
      assert.equal(dryJson.data.duplicateCount, 2);
      assert.equal(dryJson.data.failedCount, 1);
      assert.equal(createdLeads.length, 0);
      assert.equal(createdVisits.length, 0);

      // B. Preview token 2 -> Actual CREATE_SKIP_DUPLICATES commit with Idempotency-Key
      const form2 = new FormData();
      form2.append("file", new Blob([xlsxBuffer]), "commit.xlsx");
      const p2 = (await (await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form2,
      })).json()).data;

      const idemKey = "idem-confirm-key-001";
      const commitRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({ previewToken: p2.previewToken, importMode: "CREATE_SKIP_DUPLICATES" }),
      });
      const commitJson = await commitRes.json();
      assert.equal(commitRes.status, 200);
      assert.equal(commitJson.data.createdCount, 3);
      assert.equal(commitJson.data.duplicateCount, 2);
      assert.equal(commitJson.data.failedCount, 1);
      assert.equal(commitJson.data.visitHistoryCount, 1);
      assert.equal(createdLeads.length, 3);
      assert.equal(createdVisits.length, 1);
      // Verify no auto-assignment happened & historicalFollowUps populated
      for (const lead of createdLeads) {
        assert.equal(lead.assignedEmployeeId, undefined);
        assert.equal(lead.status, "New");
      }

      // Replay with same Idempotency-Key returns same job, still only 3 leads created
      const replayRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({ previewToken: p2.previewToken, importMode: "CREATE_SKIP_DUPLICATES" }),
      });
      const replayJson = await replayRes.json();
      assert.equal(replayRes.status, 200);
      assert.equal(replayJson.data.id, commitJson.data.id);
      assert.equal(createdLeads.length, 3);

      // Reusing same previewToken WITHOUT Idempotency-Key is rejected with 400/409 (already confirmed / consumed)
      const reuseRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ previewToken: p2.previewToken, importMode: "CREATE_SKIP_DUPLICATES" }),
      });
      assert.ok([400, 409].includes(reuseRes.status));

      // Live follow-up API for imported lead shows 0 used attempts of 4 maxAttempts + historicalFollowUps in meta!
      const importedLead = createdLeads[0];
      mock.method(Lead, "findOne", () => queryStub(importedLead));
      const fuRes = await fetch(`${baseUrl}/leads/${importedLead._id}/follow-ups`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const fuJson = await fuRes.json();
      assert.equal(fuRes.status, 200);
      assert.equal(fuJson.meta.attempts, 0);
      assert.equal(fuJson.meta.maxAttempts, 4);
      assert.ok(Array.isArray(fuJson.meta.historicalFollowUps) && fuJson.meta.historicalFollowUps.length >= 2);

      // Expired token rejection
      const expiredToken = "expired-test-token-123";
      const expiredHash = crypto.createHash("sha256").update(expiredToken).digest("hex");
      storedJobs.set("expired-id", {
        _id: new mongoose.Types.ObjectId(),
        importedBy: adminId,
        status: "PREVIEW",
        previewTokenHash: expiredHash,
        previewExpiresAt: new Date(Date.now() - 60_000),
      });
      const expRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ previewToken: expiredToken, importMode: "CREATE_SKIP_DUPLICATES" }),
      });
      assert.equal(expRes.status, 400);
    });
  });

  it("handles repeat-import existing-DB deduplication and partial row save failures gracefully", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const adminUser = makeAdminUser(adminId);
    const adminToken = signAccessToken(adminUser);

    // Build a workbook with 2 rows: 1 already in DB, 1 normal, 1 triggers persistence error
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leads");
    ws.addRow(["DATE", "NAME", "PHONE", "REQUIREMENT", "QUALITY"]);
    ws.addRow(["04/05/2026", "Existing Client", "9000011111", "Banner", "HOT"]);
    ws.addRow(["05/05/2026", "Fresh Client", "9000022222", "Standee", "WARM"]);
    ws.addRow(["06/05/2026", "FAIL_ROW_TRIGGER", "9000033333", "Signage", "COLD"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    // First run parseWorkbookBuffer + buildImportPreview? Do via HTTP preview so fingerprint matches DB record!
    const { buildImportPreview } = await import("../src/services/excelImport.service.js");
    mock.method(Lead, "find", () => queryStub([]));
    const parsed = await parseWorkbookBuffer(buf, "partial.xlsx");
    const initialPreview = await buildImportPreview({ parsedWorkbook: parsed, fileName: "partial.xlsx", fileSizeBytes: buf.length });
    const existingFingerprint = initialPreview.rows[0].fingerprint;
    mock.restoreAll();

    const storedJobs = new Map();
    mock.method(User, "findById", () => queryStub(adminUser));
    mock.method(Lead, "find", (filter) => {
      if (filter["importMetadata.fingerprint"]) {
        return queryStub([
          {
            _id: new mongoose.Types.ObjectId(),
            code: "LD-EXISTING",
            phone: "9000011111",
            clientName: "Existing Client",
            importMetadata: { fingerprint: existingFingerprint },
          },
        ]);
      }
      return queryStub([]);
    });
    mock.method(Lead, "findOne", () => queryStub(null));
    mock.method(Client, "findOne", () => queryStub(null));
    mock.method(Client, "create", async (p) => ({ _id: new mongoose.Types.ObjectId(), ...p }));
    mock.method(Lead, "create", async (payload) => {
      if (payload.clientName === "FAIL_ROW_TRIGGER") {
        throw new Error("Simulated write failure");
      }
      return { _id: new mongoose.Types.ObjectId(), code: "LD-FRESH", ...payload };
    });
    mock.method(ImportJob, "create", async (p) => {
      const id = new mongoose.Types.ObjectId();
      const doc = {
        _id: id,
        code: "IMP-PARTIAL",
        ...p,
        toJSON() {
          return { ...this, id: String(this._id) };
        },
      };
      storedJobs.set(String(id), doc);
      return doc;
    });
    mock.method(ImportJob, "findOneAndUpdate", (filter, update) => {
      const match = [...storedJobs.values()].find((j) => j.previewTokenHash === filter.previewTokenHash);
      if (!match) return queryStub(null);
      Object.assign(match, update.$set);
      return queryStub(match);
    });
    mock.method(ImportJob, "findByIdAndUpdate", async (id, update) => {
      const match = storedJobs.get(String(id));
      Object.assign(match, update.$set);
      return match;
    });

    await withServer(async (baseUrl) => {
      const form = new FormData();
      form.append("file", new Blob([buf]), "partial.xlsx");
      const prev = (await (await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form,
      })).json()).data;

      assert.equal(prev.summary.duplicateCount, 1);
      assert.equal(prev.summary.validRows, 2);

      const confRes = await fetch(`${baseUrl}/leads/import/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ previewToken: prev.previewToken, importMode: "CREATE_SKIP_DUPLICATES" }),
      });
      const confJson = await confRes.json();
      assert.equal(confRes.status, 200);
      assert.equal(confJson.data.status, "PARTIAL");
      assert.equal(confJson.data.createdCount, 1);
      assert.equal(confJson.data.duplicateCount, 1);
      assert.equal(confJson.data.failedCount, 1);
      assert.equal(confJson.data.errorSummaries.length, 1);
      assert.equal(confJson.data.errorSummaries[0].code, "PERSIST_ERROR");
    });
  });

  it("enforces strict RBAC for import & export routes (unauthenticated 401, employee import/cross-export 403, employee own-export allowed)", async () => {
    const empUserId = new mongoose.Types.ObjectId();
    const empId = new mongoose.Types.ObjectId();
    const otherEmpId = new mongoose.Types.ObjectId();
    const empUser = makeEmployeeUser(empUserId, empId, "Riya Employee");
    const empToken = signAccessToken(empUser);

    mock.method(User, "findById", () => queryStub(empUser));
    mock.method(Lead, "find", (filter) => {
      assert.equal(String(filter.assignedEmployeeId), String(empId));
      return queryStub([
        {
          _id: new mongoose.Types.ObjectId(),
          code: "LD-EMP-1",
          clientName: "Own Customer",
          phone: "9876500001",
          service: "Branding",
          requirement: "Neon Sign",
          source: "Instagram",
          quality: "HOT",
          status: "Assigned",
          priority: "HIGH",
          assignedEmployeeId: empId,
          internalRemarks: "SECRET ADMIN MARGIN NOTE",
          budget: "99999",
          historicalFollowUps: [],
          createdAt: new Date("2026-05-10T06:30:00.000Z"),
        },
      ]);
    });
    mock.method(Employee, "find", () => queryStub([{ _id: empId, name: "Riya Employee" }]));
    mock.method(LeadFollowUp, "find", () => queryStub([]));
    mock.method(LeadVisit, "find", () => queryStub([]));

    await withServer(async (baseUrl) => {
      // Unauthenticated -> 401
      const unauthExport = await fetch(`${baseUrl}/leads/export?format=csv`);
      assert.equal(unauthExport.status, 401);

      // Employee attempting admin preview -> 403
      const empForm = new FormData();
      empForm.append("file", new Blob([Buffer.from("a,b\n1,2")], { type: "text/csv" }), "x.csv");
      const empImportRes = await fetch(`${baseUrl}/leads/import/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${empToken}` },
        body: empForm,
      });
      assert.equal(empImportRes.status, 403);

      // Employee requesting another employee's export -> 403
      const crossExport = await fetch(`${baseUrl}/leads/export?format=csv&employeeId=${otherEmpId}`, {
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert.equal(crossExport.status, 403);

      // Employee exporting own assigned leads -> 200, and strips internalRemarks & budget
      const ownExport = await fetch(`${baseUrl}/leads/export?format=csv`, {
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert.equal(ownExport.status, 200);
      const csvBody = await ownExport.text();
      assert.ok(csvBody.includes("Own Customer"));
      assert.ok(!csvBody.includes("SECRET ADMIN MARGIN NOTE"));
      assert.ok(!csvBody.includes("Internal Remarks"));
      assert.ok(!csvBody.includes("Budget"));
    });
  });

  it("exports safe .xlsx and .csv workbooks with phone text formatting, formula-injection escaping, IST dates, follow-up & visit sheets", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const adminUser = makeAdminUser(adminId);
    const empId = new mongoose.Types.ObjectId();
    const leadId = new mongoose.Types.ObjectId();

    const leads = [
      {
        _id: leadId,
        code: "LD-500",
        clientName: "=CMD|'/C calc'!A0",
        contactPersonName: "+Ananya",
        phone: "9876543210",
        alternatePhone: "919988776655",
        email: "ananya@example.com",
        service: "Signage",
        requirement: "@SUM(A1:A5) Display Board",
        source: "Meta Ads",
        quality: "HOT",
        status: "Assigned",
        priority: "HIGH",
        assignedEmployeeId: empId,
        internalRemarks: "-Margin 25%",
        budget: "50000",
        enquiryDate: new Date("2026-05-10T08:00:00.000Z"), // 13:30 IST
        createdAt: new Date("2026-05-10T08:00:00.000Z"),
        importMetadata: { rawSource: "FB Campaign May" },
        historicalFollowUps: [
          {
            callDate: new Date("2026-05-11T05:30:00.000Z"),
            rawDateLabel: "11/05/2026",
            callResponse: "NOT_PICKED",
            rawResponse: "NOT PICK",
            note: "=HYPERLINK(\"http://evil\")",
            sourceSheet: "MAY 2026 ALL LEADS",
            sourceRow: 5,
          },
        ],
      },
    ];

    mock.method(Lead, "find", () => queryStub(leads));
    mock.method(Employee, "find", () => queryStub([{ _id: empId, name: "Vikram Sales" }]));
    mock.method(LeadFollowUp, "find", () =>
      queryStub([
        {
          leadId,
          attemptNumber: 1,
          employeeId: empId,
          communicationType: "Call",
          callResponse: "CALL_BACK",
          interestLevel: "Interested",
          discussionNotes: "Asked for revised quote",
          customerResponse: "Call after 5 PM",
          contactedAt: new Date("2026-05-12T10:00:00.000Z"),
        },
      ])
    );
    mock.method(LeadVisit, "find", () =>
      queryStub([
        {
          leadId,
          code: "VST-010",
          visitType: "SITE_VISIT",
          title: "Showroom Measurement",
          status: "SCHEDULED",
          scheduledStart: new Date("2026-05-15T06:00:00.000Z"),
          locationType: "SITE",
          locationAddress: "Connaught Place, Delhi",
          assignedEmployeeId: empId,
          outcome: "",
          notes: "Carry tape",
        },
      ])
    );

    // 1. Verify .xlsx generation
    const xlsxExport = await generateLeadsExport({
      filter: {},
      user: adminUser,
      format: "xlsx",
      includeFollowUps: true,
      includeVisits: true,
    });
    assert.equal(xlsxExport.extension, "xlsx");

    const parsedWb = new ExcelJS.Workbook();
    await parsedWb.xlsx.load(xlsxExport.buffer);
    assert.deepEqual(
      parsedWb.worksheets.map((w) => w.name),
      ["Leads", "Follow-up History", "Customer Visits"]
    );

    const leadsSheet = parsedWb.getWorksheet("Leads");
    const headerIndex = {};
    leadsSheet.getRow(1).eachCell((cell, colNumber) => {
      headerIndex[String(cell.value)] = colNumber;
    });
    const row2 = leadsSheet.getRow(2);
    // Formula escaping applied on Client Name, Contact Person, Requirement, Internal Remarks
    assert.equal(row2.getCell(headerIndex["Client Name"]).value, "'=CMD|'/C calc'!A0");
    assert.equal(row2.getCell(headerIndex["Contact Person"]).value, "'+Ananya");
    assert.equal(row2.getCell(headerIndex["Requirement"]).value, "'@SUM(A1:A5) Display Board");
    assert.equal(row2.getCell(headerIndex["Internal Remarks"]).value, "'-Margin 25%");
    // Phone preserved as text string ("@" number format)
    assert.equal(row2.getCell(headerIndex["Phone"]).value, "9876543210");
    assert.equal(row2.getCell(headerIndex["Phone"]).numFmt, "@");
    // IST formatted date
    assert.equal(row2.getCell(headerIndex["Enquiry Date (IST)"]).value, formatIstDisplay("2026-05-10T08:00:00.000Z"));

    const fuSheet = parsedWb.getWorksheet("Follow-up History");
    assert.equal(fuSheet.rowCount, 3); // header + 1 live + 1 Excel historical
    const visitSheet = parsedWb.getWorksheet("Customer Visits");
    assert.equal(visitSheet.rowCount, 2); // header + 1 visit

    // 2. Verify CSV export + BOM + formula safety + utility helpers
    const csvExport = await generateLeadsExport({
      filter: {},
      user: adminUser,
      format: "csv",
      includeFollowUps: false,
      includeVisits: false,
    });
    assert.equal(csvExport.extension, "csv");
    assert.equal(csvExport.buffer.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), true);
    const parsedCsvRows = parseCsvBuffer(csvExport.buffer);
    assert.equal(parsedCsvRows.length, 2);
    assert.equal(parsedCsvRows[1][1], "'=CMD|'/C calc'!A0");
    assert.equal(escapeSpreadsheetCell("=1+1"), "'=1+1");
    assert.equal(formatIstDateKey("2026-05-10T20:00:00.000Z"), "2026-05-11"); // 01:30 AM IST next day!
  });
});

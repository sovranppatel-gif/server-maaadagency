import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import ExcelJS from "exceljs";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Lead } from "../src/models/Lead.js";
import { LeadFollowUp } from "../src/models/LeadFollowUp.js";
import { LeadVisit } from "../src/models/LeadVisit.js";
import { ImportJob } from "../src/models/ImportJob.js";
import { Service } from "../src/models/Service.js";

const ISOLATED_URI = process.env.PHASE4_ISOLATED_MONGO_URI || "";
const isSafeLocalhostUri = /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/phase4_test/i.test(ISOLATED_URI);

describe("Phase 4: Real Isolated MongoDB End-to-End Integration", { skip: !isSafeLocalhostUri ? "Set PHASE4_ISOLATED_MONGO_URI=mongodb://127.0.0.1:27099/phase4_test to run isolated real MongoDB E2E tests" : false }, () => {
  let server;
  let baseUrl;
  let cookieJar = "";

  before(async () => {
    await mongoose.connect(ISOLATED_URI, { serverSelectionTimeoutMS: 10000 });
    await mongoose.connection.dropDatabase();
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it("executes complete CRM lifecycle on real MongoDB (Auth -> Employee Setup -> Lead/Quality/FollowUps -> Visits -> Excel Import/Export -> Work -> Quotation PDF -> WhatsApp/Settings)", async () => {
    // 1. Seed Master Admin + Service in isolated DB
    const masterUser = await User.create({
      name: "Master Owner",
      email: "master@phase4.local",
      role: "MASTER_ADMIN",
      passwordHash: await User.hashPassword("MasterPass!12345"),
    });
    assert.ok(masterUser._id);

    const svc = await Service.create({ name: "Acrylic Signage", status: "Active" });

    // Login Master Admin + capture HttpOnly refreshToken cookie
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "master@phase4.local", password: "MasterPass!12345" }),
    });
    assert.equal(loginRes.status, 200);
    const setCookieHeader = loginRes.headers.get("set-cookie") || "";
    cookieJar = setCookieHeader.split(";")[0];
    const masterToken = (await loginRes.json()).data.accessToken;

    // Verify refresh cookie rotation/replay works on real DB
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: cookieJar },
    });
    assert.equal(refreshRes.status, 200);

    // 2. Create Sales Employee + Invitation Token -> Setup Password -> Login Employee
    const empCreateRes = await fetch(`${baseUrl}/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({
        name: "Kiran Sales",
        role: "Senior Sales Exec",
        email: "kiran@phase4.local",
        phone: "9810011223",
        department: "Sales",
      }),
    });
    assert.equal(empCreateRes.status, 201);
    const employee = (await empCreateRes.json()).data;

    const inviteRes = await fetch(`${baseUrl}/employees/${employee.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterToken}` },
    });
    assert.equal(inviteRes.status, 201);
    const inviteToken = (await inviteRes.json()).data.setupPath.split("#token=")[1];

    const setupRes = await fetch(`${baseUrl}/auth/employee-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteToken, password: "KiranStrong!Pass123" }),
    });
    assert.equal(setupRes.status, 200);

    const adminBrowserLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Portal": "admin" },
      body: JSON.stringify({ email: "master@phase4.local", password: "MasterPass!12345" }),
    });
    assert.equal(adminBrowserLoginRes.status, 200);
    const adminCookie = (adminBrowserLoginRes.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("adminRefreshToken="))?.split(";")[0];
    assert.ok(adminCookie);

    const empLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Portal": "employee" },
      body: JSON.stringify({ email: "kiran@phase4.local", password: "KiranStrong!Pass123" }),
    });
    assert.equal(empLoginRes.status, 200);
    const empCookie = (empLoginRes.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("empRefreshToken="))?.split(";")[0];
    assert.ok(empCookie);
    const empToken = (await empLoginRes.json()).data.accessToken;

    // Dual-portal same-browser verification: both cookies coexist and resolve to their own portal users!
    const dualCookieHeader = `${adminCookie}; ${empCookie}`;
    const refreshAdminPortal = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: dualCookieHeader, "X-Portal": "admin" },
    });
    assert.equal(refreshAdminPortal.status, 200);
    assert.equal((await refreshAdminPortal.json()).data.user.role, "MASTER_ADMIN");

    const refreshEmpPortal = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: dualCookieHeader, "X-Portal": "employee" },
    });
    assert.equal(refreshEmpPortal.status, 200);
    assert.equal((await refreshEmpPortal.json()).data.user.role, "EMPLOYEE");

    // Logging out Employee portal must clear ONLY empRefreshToken and leave adminRefreshToken active
    const empLogoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { Cookie: dualCookieHeader, "X-Portal": "employee" },
    });
    assert.equal(empLogoutRes.status, 200);
    const clearedCookies = empLogoutRes.headers.getSetCookie?.() ?? [];
    assert.ok(clearedCookies.some((c) => c.startsWith("empRefreshToken=;")));
    assert.equal(clearedCookies.some((c) => c.startsWith("adminRefreshToken=;")), false);

    // 3. Create Lead -> Assign to Kiran -> Quality change -> 4 FollowUps + Authorize 5th
    const leadRes = await fetch(`${baseUrl}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({
        clientName: "Apex Mall",
        phone: "9820033445",
        service: svc.name,
        requirement: "Facade LED Signage",
        source: "Website",
        priority: "HIGH",
        internalRemarks: "Confidential margin 30%",
        budget: "₹50K-1L",
      }),
    });
    assert.equal(leadRes.status, 201);
    const lead = (await leadRes.json()).data;

    const assignRes = await fetch(`${baseUrl}/leads/${lead.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({ employeeId: employee.id }),
    });
    assert.equal(assignRes.status, 200);

    const qRes = await fetch(`${baseUrl}/leads/${lead.id}/quality`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${empToken}` },
      body: JSON.stringify({ quality: "HOT", reason: "Ready to finalize location" }),
    });
    assert.equal(qRes.status, 200);
    assert.equal((await qRes.json()).data.status, "Assigned"); // Workflow stays independent!

    // Regression: GET /api/leads (Admin & Employee) must not hit MongoDB projection path collision on qualityHistory.actorId
    const adminListRes = await fetch(`${baseUrl}/leads?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${masterToken}` },
    });
    assert.equal(adminListRes.status, 200);
    const adminListJson = await adminListRes.json();
    assert.equal(adminListJson.data.length, 1);

    const empListRes = await fetch(`${baseUrl}/leads?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.equal(empListRes.status, 200);
    const empListJson = await empListRes.json();
    assert.equal(empListJson.data.length, 1);
    assert.equal(empListJson.data[0].internalRemarks, undefined);

    for (let i = 1; i <= 4; i += 1) {
      const fuRes = await fetch(`${baseUrl}/leads/${lead.id}/follow-ups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${empToken}`,
          "Idempotency-Key": `phase4-realdb-fu-attempt-${i}`,
        },
        body: JSON.stringify({
          communicationType: "Call",
          callResponse: i === 4 ? "INTERESTED" : "NOT_PICKED",
          contactedAt: new Date(Date.now() - 1000).toISOString(),
          discussionNotes: `Attempt ${i} call log`,
          interestLevel: "Interested",
          quotationRequired: i === 4,
        }),
      });
      assert.equal(fuRes.status, 201);
    }

    // 5th attempt blocked until Admin authorizes
    const fifthBlocked = await fetch(`${baseUrl}/leads/${lead.id}/follow-ups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${empToken}`,
        "Idempotency-Key": "phase4-realdb-fu-attempt-5",
      },
      body: JSON.stringify({
        communicationType: "Call",
        callResponse: "CALL_BACK",
        contactedAt: new Date().toISOString(),
        discussionNotes: "Attempt 5 before auth",
        interestLevel: "Interested",
      }),
    });
    assert.equal(fifthBlocked.status, 409);

    const authMoreRes = await fetch(`${baseUrl}/leads/${lead.id}/follow-ups/authorize-more`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({ additionalAttempts: 2 }),
    });
    assert.equal(authMoreRes.status, 200);

    // 4. Customer Visits Lifecycle (Real DB persistence)
    const futureStart = new Date(Date.now() + 2 * 3600_000).toISOString();
    const visitRes = await fetch(`${baseUrl}/leads/${lead.id}/visits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${empToken}`,
        "Idempotency-Key": "phase4-visit-schedule-001",
      },
      body: JSON.stringify({
        visitType: "SITE_VISIT",
        title: "Apex Mall Measurement",
        scheduledStart: futureStart,
        locationType: "CUSTOMER_LOCATION",
        locationAddress: "Apex Mall, MG Road",
      }),
    });
    assert.equal(visitRes.status, 201);
    const visit = (await visitRes.json()).data;

    const completeVisitRes = await fetch(`${baseUrl}/visits/${visit.id}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${empToken}` },
      body: JSON.stringify({
        customerResponse: "Confirmed site dimensions",
        outcome: "QUOTATION_REQUESTED",
      }),
    });
    assert.equal(completeVisitRes.status, 200);
    assert.equal((await completeVisitRes.json()).data.status, "COMPLETED");

    // 5. Excel Import -> DryRun -> Confirm -> Repeat Idempotency -> Follow-up Limit Unchanged -> Export
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MAY 2026 ALL LEADS");
    ws.addRow(["SR. NO.", "DATE", "NAME", "CONTACT NO.", "ADDRESS", "DETAILS / REQUIREMENT", "STATUS", "SOURCE", "05-05-2026", "VISIT PLAN"]);
    ws.addRow(["1", "05/05/2026", "RealDB Client", "9899001122", "Connaught Place, Delhi", "3D Channel Letters", "warm", "Website", "NOT PICK", "VISIT PLAN 20/05/2026 Connaught Place Delhi"]);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const prevForm = new FormData();
    prevForm.append("file", new Blob([xlsxBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "realdb-test.xlsx");
    const prevRes = await fetch(`${baseUrl}/leads/import/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterToken}` },
      body: prevForm,
    });
    assert.equal(prevRes.status, 200);
    const prevData = (await prevRes.json()).data;
    assert.equal(prevData.summary.validRows, 1);

    const confirmRes = await fetch(`${baseUrl}/leads/import/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${masterToken}`,
        "Idempotency-Key": "phase4-import-confirm-realdb-1",
      },
      body: JSON.stringify({ previewToken: prevData.previewToken, importMode: "CREATE_SKIP_DUPLICATES" }),
    });
    assert.equal(confirmRes.status, 200);
    const job = (await confirmRes.json()).data;
    assert.equal(job.createdCount, 1);
    assert.equal(job.followUpHistoryCount, 1);
    assert.equal(job.visitHistoryCount, 1);
    assert.equal(await ImportJob.countDocuments(), 1);

    // Repeat upload of identical workbook is automatically flagged as DUPLICATE_EXISTING!
    const prev2Form = new FormData();
    prev2Form.append("file", new Blob([xlsxBuf]), "realdb-repeat.xlsx");
    const prev2Res = await fetch(`${baseUrl}/leads/import/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterToken}` },
      body: prev2Form,
    });
    assert.equal((await prev2Res.json()).data.summary.duplicateCount, 1);

    // Imported lead still has 0 live follow-up attempts (limit = 4) + 1 historical Excel call
    const importedLead = await Lead.findOne({ phone: "919899001122" });
    assert.ok(importedLead);
    const impFuRes = await fetch(`${baseUrl}/leads/${importedLead._id}/follow-ups`, {
      headers: { Authorization: `Bearer ${masterToken}` },
    });
    const impFuJson = await impFuRes.json();
    assert.equal(impFuJson.meta.attempts, 0);
    assert.equal(impFuJson.meta.maxAttempts, 4);
    assert.equal(impFuJson.meta.historicalFollowUps.length, 1);
    assert.equal(await LeadFollowUp.countDocuments({ leadId: importedLead._id }), 0);
    assert.equal(await LeadVisit.countDocuments({ leadId: importedLead._id }), 1);

    // Admin XLSX export + Employee scoped CSV export
    const adminXlsxRes = await fetch(`${baseUrl}/leads/export?format=xlsx&includeFollowUps=true&includeVisits=true`, {
      headers: { Authorization: `Bearer ${masterToken}` },
    });
    assert.equal(adminXlsxRes.status, 200);
    const adminOutWb = new ExcelJS.Workbook();
    await adminOutWb.xlsx.load(Buffer.from(await adminXlsxRes.arrayBuffer()));
    assert.equal(adminOutWb.getWorksheet("Leads").rowCount, 3); // Header + 2 leads (manual + imported)

    const empCsvRes = await fetch(`${baseUrl}/leads/export?format=csv`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.equal(empCsvRes.status, 200);
    const empCsvText = await empCsvRes.text();
    assert.ok(empCsvText.includes("Apex Mall"));
    assert.ok(!empCsvText.includes("RealDB Client")); // Unassigned imported lead NOT leaked!
    assert.ok(!empCsvText.includes("Confidential margin 30%"));

    // 6. Work & Quotation + PDF on Real DB
    const workRes = await fetch(`${baseUrl}/works`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({
        clientId: lead.clientId,
        leadId: lead.id,
        employeeId: employee.id,
        title: "Fabricate Signage",
        service: svc.name,
        priority: "HIGH",
        deadline: new Date(Date.now() + 7 * 86400_000).toISOString(),
      }),
    });
    assert.equal(workRes.status, 201);
    const work = (await workRes.json()).data;

    assert.equal(
      (
        await fetch(`${baseUrl}/works/${work.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${empToken}` },
          body: JSON.stringify({ summary: "Artwork finalized" }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/works/${work.id}/approve`, {
          method: "POST",
          headers: { Authorization: `Bearer ${masterToken}` },
        })
      ).status,
      200
    );

    const quoteRes = await fetch(`${baseUrl}/quotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${empToken}`,
        "Idempotency-Key": "phase4-realdb-quote-create-1",
      },
      body: JSON.stringify({
        leadId: lead.id,
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 14 * 86400_000).toISOString(),
        lineItems: [
          {
            serviceId: String(svc._id),
            serviceName: svc.name,
            description: "Facade LED Board",
            quantityMilli: 2000,
            unit: "SqFt",
            unitRatePaise: 1500000,
            discountBps: 0,
            taxRateBps: 1800,
          },
        ],
      }),
    });
    assert.equal(quoteRes.status, 201);
    const quote = (await quoteRes.json()).data;
    assert.equal(quote.totals.grandTotalPaise, 3540000);

    const quoteSubRes = await fetch(`${baseUrl}/quotations/${quote.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${empToken}`,
        "Idempotency-Key": "phase4-realdb-quote-sub-1",
      },
      body: "{}",
    });
    assert.equal(quoteSubRes.status, 200);

    const quoteAppRes = await fetch(`${baseUrl}/quotations/${quote.id}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${masterToken}`,
        "Idempotency-Key": "phase4-realdb-quote-app-1",
      },
      body: "{}",
    });
    assert.equal(quoteAppRes.status, 200);

    const pdfRes = await fetch(`${baseUrl}/quotations/${quote.id}/pdf`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.equal(pdfRes.status, 200);
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 4).toString("utf8"), "%PDF");

    // 7. WhatsApp Settings, Bot Step validation fix, FAQ, and Deactivation revocation check
    const botCreateRes = await fetch(`${baseUrl}/whatsapp/bot-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({ title: "Welcome", message: "Hi! How can we help?" }),
    });
    assert.equal(botCreateRes.status, 201);
    const botStep = (await botCreateRes.json()).data;
    const botPatchRes = await fetch(`${baseUrl}/whatsapp/bot-flow/${botStep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({ title: "Updated Welcome" }),
    });
    assert.equal(botPatchRes.status, 200);
    const waSettingsRes = await fetch(`${baseUrl}/settings/whatsapp`, {
      headers: { Authorization: `Bearer ${masterToken}` },
    });
    assert.equal(waSettingsRes.status, 200);

    const deactRes = await fetch(`${baseUrl}/employees/${employee.id}/deactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterToken}` },
    });
    assert.equal(deactRes.status, 200);
    assert.equal((await fetch(`${baseUrl}/leads`, { headers: { Authorization: `Bearer ${empToken}` } })).status, 401);
  });
});

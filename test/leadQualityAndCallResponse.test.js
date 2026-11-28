import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Employee } from "../src/models/Employee.js";
import { Lead } from "../src/models/Lead.js";
import { LeadFollowUp } from "../src/models/LeadFollowUp.js";
import { Work } from "../src/models/Work.js";
import { Notification } from "../src/models/Notification.js";
import { LEAD_QUALITIES, CALL_RESPONSES, normaliseCallResponse } from "../src/utils/crmMappings.js";
import { leadSchemas, followUpSchemas } from "../src/validators/index.js";
import { signAccessToken } from "../src/utils/jwt.js";

function makeEmployeeUser(userId, empId, name) {
  const user = new User({ _id: userId, name, email: `${name.toLowerCase().replace(/\s+/g, "")}@test.local`, role: "EMPLOYEE", employee: empId, isActive: true, tokenVersion: 0 });
  Object.defineProperty(user, "employee", {
    value: { _id: empId, name, role: "Sales", isActive: true },
    configurable: true,
    enumerable: true,
  });
  return user;
}

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

describe("Phase 1: Lead Quality & Structured Call Response", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("1-3. validates canonical lead qualities, rejects invalid values, and keeps legacy leads unclassified", () => {
    for (const quality of LEAD_QUALITIES) {
      assert.equal(leadSchemas.quality.parse({ quality }).quality, quality);
    }
    assert.equal(leadSchemas.quality.safeParse({ quality: "SUPER_HOT" }).success, false);
    assert.equal(leadSchemas.quality.safeParse({ quality: "" }).success, false);
    assert.equal(leadSchemas.list.parse({ quality: "UNCLASSIFIED" }).quality, "UNCLASSIFIED");

    const legacyLead = new Lead({
      clientId: new mongoose.Types.ObjectId(),
      clientName: "Legacy Client",
      phone: "919876543210",
      service: "Website",
      requirement: "Landing page",
      status: "In Progress",
    });
    assert.equal(legacyLead.validateSync(), undefined);
    assert.equal(legacyLead.quality, undefined);
    assert.equal(legacyLead.toJSON().quality, undefined);
  });

  it("8-10. validates canonical call responses, maps legacy Excel labels, and rejects unknown strings", () => {
    for (const code of CALL_RESPONSES) {
      assert.equal(normaliseCallResponse(code), code);
      const parsed = leadSchemas.followUp.parse({
        communicationType: "Call",
        callResponse: code,
        contactedAt: "2026-11-23T10:00:00.000Z",
        discussionNotes: "Attempt logged",
        interestLevel: "Neutral",
      });
      assert.equal(parsed.callResponse, code);
    }

    const legacyPairs = [
      ["NOT PICK", "NOT_PICKED"],
      ["BUZY", "BUSY"],
      ["NO RESPONSE", "NO_RESPONSE"],
      ["CALL CUT", "CALL_CUT"],
      ["OUT OF SERVICE", "OUT_OF_SERVICE"],
      ["PRICING IS ON HIGHER SIDE", "PRICING_CONCERN"],
    ];
    for (const [legacy, canonical] of legacyPairs) {
      assert.equal(normaliseCallResponse(legacy), canonical);
      assert.equal(
        leadSchemas.followUp.safeParse({
          communicationType: "Call",
          callResponse: legacy,
          contactedAt: "2026-11-23T10:00:00.000Z",
          discussionNotes: "Imported call log",
          interestLevel: "Neutral",
        }).success,
        true
      );
    }

    assert.equal(normaliseCallResponse("UNKNOWN_EXCEL_STATUS"), null);
    assert.equal(
      leadSchemas.followUp.safeParse({
        communicationType: "Call",
        callResponse: "UNKNOWN_EXCEL_STATUS",
        contactedAt: "2026-11-23T10:00:00.000Z",
        discussionNotes: "Should fail",
        interestLevel: "Neutral",
      }).success,
      false
    );
    assert.equal(followUpSchemas.list.parse({ callResponse: "NOT_PICKED" }).callResponse, "NOT_PICKED");

    const legacyFollowUp = new LeadFollowUp({
      leadId: new mongoose.Types.ObjectId(),
      employeeId: new mongoose.Types.ObjectId(),
      submittedBy: new mongoose.Types.ObjectId(),
      attemptNumber: 1,
      communicationType: "Call",
      contactedAt: new Date("2026-11-20T09:00:00.000Z"),
      discussionNotes: "Legacy note without callResponse",
      interestLevel: "Unsure",
      idempotencyKey: "legacy-key-1234567890",
    });
    assert.equal(legacyFollowUp.validateSync(), undefined);
    assert.equal(legacyFollowUp.callResponse, undefined);
  });

  it("4-7 & 15. enforces quality persistence, workflow independence, RBAC, and reassignment revocation", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const empAId = new mongoose.Types.ObjectId();
    const empBId = new mongoose.Types.ObjectId();
    const empAUserId = new mongoose.Types.ObjectId();
    const empBUserId = new mongoose.Types.ObjectId();
    const leadId = new mongoose.Types.ObjectId();

    const adminUser = new User({ _id: adminId, name: "Master Admin", email: "admin@test.local", role: "MASTER_ADMIN", isActive: true, tokenVersion: 0 });
    const empAUser = makeEmployeeUser(empAUserId, empAId, "Emp A");
    const empBUser = makeEmployeeUser(empBUserId, empBId, "Emp B");

    const leadDoc = new Lead({
      _id: leadId,
      code: "LD-9001",
      clientId: new mongoose.Types.ObjectId(),
      clientName: "Synthetic Corp",
      phone: "919876543210",
      service: "Website",
      requirement: "Corporate site",
      status: "In Progress",
      assignedEmployeeId: empAId,
    });

    mock.method(User, "findById", (id) => {
      const s = String(id);
      if (s === String(adminId)) return queryStub(adminUser);
      if (s === String(empAUserId)) return queryStub(empAUser);
      if (s === String(empBUserId)) return queryStub(empBUser);
      return queryStub(null);
    });
    mock.method(Lead, "findOne", () => queryStub(leadDoc));
    mock.method(Lead, "findOneAndUpdate", (filter, update) => {
      if (filter.assignedEmployeeId && String(filter.assignedEmployeeId) !== String(leadDoc.assignedEmployeeId)) {
        return queryStub(null);
      }
      if (update.$set?.quality) leadDoc.quality = update.$set.quality;
      if (update.$push?.qualityHistory) leadDoc.qualityHistory.push(update.$push.qualityHistory);
      if (update.$push?.activity) leadDoc.activity.push(update.$push.activity);
      return queryStub(leadDoc);
    });

    const adminToken = signAccessToken(adminUser);
    const empAToken = signAccessToken(empAUser);
    const empBToken = signAccessToken(empBUser);

    await withServer(async (baseUrl) => {
      // Unauthenticated -> 401
      const unauth = await fetch(`${baseUrl}/leads/LD-9001/quality`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "HOT" }),
      });
      assert.equal(unauth.status, 401);

      // Assigned Employee A sets quality = HOT; status remains "In Progress"
      const empAUpdate = await fetch(`${baseUrl}/leads/LD-9001/quality`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "HOT", reason: "High intent client" }),
      });
      assert.equal(empAUpdate.status, 200);
      const empAJson = await empAUpdate.json();
      assert.equal(empAJson.data.quality, "HOT");
      assert.equal(empAJson.data.status, "In Progress");
      assert.equal(empAJson.data.qualityHistory.length, 1);
      assert.equal(empAJson.data.qualityHistory[0].fromQuality, null);
      assert.equal(empAJson.data.qualityHistory[0].toQuality, "HOT");
      assert.equal(empAJson.data.qualityHistory[0].actor, "Emp A");
      assert.equal("actorId" in empAJson.data.qualityHistory[0], false);

      // Unauthorized Employee B denied (404)
      const empBDenied = await fetch(`${baseUrl}/leads/LD-9001/quality`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empBToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "COLD" }),
      });
      assert.equal(empBDenied.status, 404);

      // Invalid quality rejected (422)
      const invalidQuality = await fetch(`${baseUrl}/leads/LD-9001/quality`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "INVALID" }),
      });
      assert.equal(invalidQuality.status, 422);

      // Reassign to Employee B: Employee A loses access, Employee B can update quality
      leadDoc.assignedEmployeeId = empBId;
      const empAAfterReassign = await fetch(`${baseUrl}/leads/LD-9001/quality`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "WASTE" }),
      });
      assert.equal(empAAfterReassign.status, 404);

      const empBAfterReassign = await fetch(`${baseUrl}/leads/LD-9001/quality`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empBToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "WARM" }),
      });
      assert.equal(empBAfterReassign.status, 200);
      const empBJson = await empBAfterReassign.json();
      assert.equal(empBJson.data.quality, "WARM");
      assert.equal(empBJson.data.status, "In Progress");
      assert.equal(empBJson.data.qualityHistory.length, 2);
      assert.equal(empBJson.data.qualityHistory[1].fromQuality, "HOT");
      assert.equal(empBJson.data.qualityHistory[1].toQuality, "WARM");
    });
  });

  it("11-14. enforces follow-up numbering, 4-attempt limit, Admin approval, legacy mapping, and Idempotency-Key", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const empId = new mongoose.Types.ObjectId();
    const empUserId = new mongoose.Types.ObjectId();
    const leadId = new mongoose.Types.ObjectId();

    const adminUser = new User({ _id: adminId, name: "Master Admin", email: "admin@test.local", role: "MASTER_ADMIN", isActive: true, tokenVersion: 0 });
    const empUser = makeEmployeeUser(empUserId, empId, "Sales Rep");

    const leadDoc = new Lead({
      _id: leadId,
      code: "LD-9002",
      clientId: new mongoose.Types.ObjectId(),
      clientName: "FollowUp Client",
      phone: "919876543211",
      service: "SEO",
      requirement: "SEO campaign",
      status: "Assigned",
      assignedEmployeeId: empId,
      followUpLimit: 4,
      followUpReviewRequired: false,
      followUpsClosed: false,
    });
    leadDoc.save = async () => leadDoc;

    const storedFollowUps = [];

    mock.method(User, "findById", (id) => {
      if (String(id) === String(adminId)) return queryStub(adminUser);
      if (String(id) === String(empUserId)) return queryStub(empUser);
      return queryStub(null);
    });
    mock.method(User, "findOne", () => queryStub(empUser));
    mock.method(Lead, "findOne", () => queryStub(leadDoc));
    mock.method(Lead, "findOneAndUpdate", (_filter, update) => {
      if (update.$set?.followUpLimit !== undefined) leadDoc.followUpLimit = update.$set.followUpLimit;
      if (update.$set?.followUpReviewRequired !== undefined) leadDoc.followUpReviewRequired = update.$set.followUpReviewRequired;
      return queryStub(leadDoc);
    });
    mock.method(LeadFollowUp, "findOne", (query) => {
      const hit = storedFollowUps.find((f) => String(f.leadId) === String(query.leadId) && f.idempotencyKey === query.idempotencyKey);
      return queryStub(hit ?? null);
    });
    mock.method(LeadFollowUp, "countDocuments", (query) =>
      Promise.resolve(storedFollowUps.filter((f) => String(f.leadId) === String(query.leadId)).length)
    );
    mock.method(LeadFollowUp, "create", async (data) => {
      const doc = new LeadFollowUp(data);
      storedFollowUps.push(doc);
      return doc;
    });
    mock.method(Notification, "create", async (data) => new Notification(data));
    mock.method(Notification, "findOneAndUpdate", async (data) => new Notification(data));

    const adminToken = signAccessToken(adminUser);
    const empToken = signAccessToken(empUser);

    await withServer(async (baseUrl) => {
      const basePayload = {
        communicationType: "Call",
        callResponse: "NOT PICK",
        contactedAt: "2026-11-23T10:00:00.000Z",
        discussionNotes: "Called customer",
        nextFollowUpAt: "2026-11-24T10:00:00.000Z",
        interestLevel: "Neutral",
        attemptNumber: 99, // must be ignored by server
      };

      // Attempt 1 with legacy Excel alias "NOT PICK" -> stored as "NOT_PICKED"
      const res1 = await fetch(`${baseUrl}/leads/LD-9002/follow-ups`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${empToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-key-attempt-0001",
        },
        body: JSON.stringify(basePayload),
      });
      assert.equal(res1.status, 201);
      const j1 = await res1.json();
      assert.equal(j1.data.attemptNumber, 1);
      assert.equal(j1.data.callResponse, "NOT_PICKED");
      assert.equal(j1.data.callResponseRaw, "NOT PICK");

      // Idempotent replay -> returns same attempt 1, does not increment
      const replay = await fetch(`${baseUrl}/leads/LD-9002/follow-ups`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${empToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-key-attempt-0001",
        },
        body: JSON.stringify(basePayload),
      });
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).data.attemptNumber, 1);
      assert.equal(storedFollowUps.length, 1);

      // Attempts 2, 3, 4
      for (const n of [2, 3, 4]) {
        const res = await fetch(`${baseUrl}/leads/LD-9002/follow-ups`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${empToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `idem-key-attempt-000${n}`,
          },
          body: JSON.stringify({ ...basePayload, callResponse: n === 4 ? "INTERESTED" : "BUSY" }),
        });
        assert.equal(res.status, 201);
        assert.equal((await res.json()).data.attemptNumber, n);
      }
      assert.equal(leadDoc.followUpReviewRequired, true);

      // 5th attempt blocked until Admin approves
      const blocked5 = await fetch(`${baseUrl}/leads/LD-9002/follow-ups`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${empToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-key-attempt-0005",
        },
        body: JSON.stringify(basePayload),
      });
      assert.equal(blocked5.status, 409);

      // Admin authorizes 2 more attempts
      const approve = await fetch(`${baseUrl}/leads/LD-9002/follow-ups/authorize-more`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ additionalAttempts: 2 }),
      });
      assert.equal(approve.status, 200);
      assert.equal(leadDoc.followUpLimit, 6);
      assert.equal(leadDoc.followUpReviewRequired, false);

      // 5th attempt now succeeds
      const res5 = await fetch(`${baseUrl}/leads/LD-9002/follow-ups`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${empToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-key-attempt-0005",
        },
        body: JSON.stringify({ ...basePayload, callResponse: "CALL_BACK" }),
      });
      assert.equal(res5.status, 201);
      const j5 = await res5.json();
      assert.equal(j5.data.attemptNumber, 5);
      assert.equal(j5.data.callResponse, "CALL_BACK");
    });
  });

  it("16-17. returns accurate Admin lead quality & call response stats and keeps Work Management independent", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const empId = new mongoose.Types.ObjectId();
    const empUserId = new mongoose.Types.ObjectId();
    const leadId = new mongoose.Types.ObjectId();

    const adminUser = new User({ _id: adminId, name: "Master Admin", email: "admin@test.local", role: "MASTER_ADMIN", isActive: true, tokenVersion: 0 });
    const empUser = makeEmployeeUser(empUserId, empId, "Worker");

    const leadDoc = new Lead({
      _id: leadId,
      code: "LD-9003",
      clientId: new mongoose.Types.ObjectId(),
      clientName: "Work Client",
      phone: "919876543212",
      service: "Branding",
      requirement: "Logo",
      status: "Assigned",
      quality: "HOT",
      assignedEmployeeId: empId,
    });
    const workDoc = new Work({
      _id: new mongoose.Types.ObjectId(),
      code: "WK-9003",
      leadId,
      clientId: leadDoc.clientId,
      clientName: "Work Client",
      employeeId: empId,
      title: "Logo work",
      service: "Branding",
      deadline: new Date("2026-12-01T00:00:00.000Z"),
      status: "ASSIGNED",
      progress: 0,
    });
    workDoc.save = async () => workDoc;

    mock.method(User, "findById", (id) => {
      if (String(id) === String(adminId)) return queryStub(adminUser);
      if (String(id) === String(empUserId)) return queryStub(empUser);
      return queryStub(null);
    });
    mock.method(User, "findOne", () => queryStub(empUser));

    let leadAggCall = 0;
    mock.method(Lead, "aggregate", () => {
      leadAggCall += 1;
      if (leadAggCall === 1) return Promise.resolve([{ _id: "New", count: 2 }, { _id: "Assigned", count: 1 }]);
      return Promise.resolve([{ _id: "HOT", count: 2 }, { _id: "UNCLASSIFIED", count: 1 }]);
    });
    mock.method(Lead, "countDocuments", () => Promise.resolve(3));

    let fuAggCall = 0;
    mock.method(LeadFollowUp, "aggregate", () => {
      fuAggCall += 1;
      if (fuAggCall === 4) return Promise.resolve([{ _id: "NOT_PICKED", count: 3 }, { _id: "INTERESTED", count: 1 }]);
      return Promise.resolve([]);
    });
    mock.method(LeadFollowUp, "distinct", () => Promise.resolve([]));
    mock.method(Work, "findOne", () => queryStub(workDoc));
    mock.method(Work, "aggregate", () => Promise.resolve([]));
    mock.method(Employee, "findByIdAndUpdate", () => queryStub(null));

    const adminToken = signAccessToken(adminUser);
    const empToken = signAccessToken(empUser);

    await withServer(async (baseUrl) => {
      const statsRes = await fetch(`${baseUrl}/leads/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(statsRes.status, 200);
      const stats = (await statsRes.json()).data;
      assert.equal(stats.total, 3);
      assert.equal(stats.byQuality.HOT, 2);
      assert.equal(stats.byQuality.UNCLASSIFIED, 1);

      const reportRes = await fetch(`${baseUrl}/follow-ups/report`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(reportRes.status, 200);
      const report = (await reportRes.json()).data;
      assert.equal(report.callResponses.NOT_PICKED, 3);
      assert.equal(report.callResponses.INTERESTED, 1);

      // Work progress update does not mutate Lead quality or Lead status
      const workProgressRes = await fetch(`${baseUrl}/works/WK-9003/progress`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ start: true, progress: 40, progressNote: "Started concepts" }),
      });
      assert.equal(workProgressRes.status, 200);
      assert.equal(workDoc.status, "IN_PROGRESS");
      assert.equal(leadDoc.quality, "HOT");
      assert.equal(leadDoc.status, "Assigned");
    });
  });
});

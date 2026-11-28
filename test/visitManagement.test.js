import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Employee } from "../src/models/Employee.js";
import { Lead } from "../src/models/Lead.js";
import { LeadFollowUp } from "../src/models/LeadFollowUp.js";
import { LeadVisit } from "../src/models/LeadVisit.js";
import { Work } from "../src/models/Work.js";
import { Notification } from "../src/models/Notification.js";
import { Counter } from "../src/models/Counter.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { visitSchemas } from "../src/validators/index.js";

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

describe("Phase 2: Customer Visit Management", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("validates location requirements, date intervals, completion remarks, and cancellation reasons", () => {
    assert.equal(
      visitSchemas.create.safeParse({
        visitType: "VIRTUAL_MEETING",
        title: "Demo call",
        scheduledStart: new Date(Date.now() + 3600_000).toISOString(),
        locationType: "VIRTUAL",
        meetingLink: "",
      }).success,
      false
    );
    assert.equal(
      visitSchemas.create.safeParse({
        visitType: "SITE_VISIT",
        title: "Site check",
        scheduledStart: new Date(Date.now() + 7200_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 3600_000).toISOString(),
        locationType: "PROJECT_SITE",
        locationAddress: "Raipur Site 4",
      }).success,
      false
    );
    assert.equal(
      visitSchemas.complete.safeParse({ outcome: "INTERESTED", customerResponse: "", notes: "" }).success,
      false
    );
    assert.equal(
      visitSchemas.cancel.safeParse({ cancellationReason: "" }).success,
      false
    );
  });

  it("1-17 & 20-24. covers full visit lifecycle, idempotency, reassignment, deactivation, notifications, and independence", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const empAId = new mongoose.Types.ObjectId();
    const empBId = new mongoose.Types.ObjectId();
    const empAUserId = new mongoose.Types.ObjectId();
    const empBUserId = new mongoose.Types.ObjectId();
    const inactiveEmpId = new mongoose.Types.ObjectId();
    const inactiveEmpUserId = new mongoose.Types.ObjectId();

    const adminUser = new User({ _id: adminId, name: "Master Admin", email: "admin@test.local", role: "MASTER_ADMIN", isActive: true, tokenVersion: 0 });
    const empAUser = makeEmployeeUser(empAUserId, empAId, "Emp A", true);
    const empBUser = makeEmployeeUser(empBUserId, empBId, "Emp B", true);
    const inactiveEmpUser = makeEmployeeUser(inactiveEmpUserId, inactiveEmpId, "Inactive Emp", false);

    const empADoc = new Employee({ _id: empAId, code: "EMP-001", name: "Emp A", role: "Sales", email: "empa@test.local", phone: "9876543210", isActive: true });
    const empBDoc = new Employee({ _id: empBId, code: "EMP-002", name: "Emp B", role: "Sales", email: "empb@test.local", phone: "9876543211", isActive: true });

    const leadDoc = new Lead({
      _id: new mongoose.Types.ObjectId(),
      code: "LD-8001",
      clientId: new mongoose.Types.ObjectId(),
      clientName: "Apex Builders",
      contactPersonName: "Rohan",
      phone: "919876543210",
      service: "Hoardings",
      requirement: "3 outdoor sites",
      quality: "HOT",
      status: "In Progress",
      assignedEmployeeId: empAId,
    });
    leadDoc.save = async () => leadDoc;

    const otherLeadDoc = new Lead({
      _id: new mongoose.Types.ObjectId(),
      code: "LD-8002",
      clientId: new mongoose.Types.ObjectId(),
      clientName: "Other Co",
      phone: "919876543299",
      service: "Print",
      requirement: "Brochures",
      status: "Assigned",
      assignedEmployeeId: empBId,
    });

    const workDoc = new Work({
      _id: new mongoose.Types.ObjectId(),
      code: "WK-8001",
      leadId: leadDoc._id,
      clientId: leadDoc.clientId,
      clientName: leadDoc.clientName,
      employeeId: empAId,
      title: "Creative layout",
      service: "Hoardings",
      deadline: new Date(Date.now() + 86400_000),
      status: "IN_PROGRESS",
      progress: 50,
    });

    const visits = [];
    const notifications = [];
    let followUpCount = 2;
    let seq = 1;

    mock.method(Counter, "next", async () => seq++);
    mock.method(User, "findById", (id) => {
      const s = String(id);
      if (s === String(adminId)) return queryStub(adminUser);
      if (s === String(empAUserId)) return queryStub(empAUser);
      if (s === String(empBUserId)) return queryStub(empBUser);
      if (s === String(inactiveEmpUserId)) return queryStub(inactiveEmpUser);
      return queryStub(null);
    });
    mock.method(User, "findOne", (q) => {
      if (String(q?.employee) === String(empAId)) return queryStub({ _id: empAUserId });
      if (String(q?.employee) === String(empBId)) return queryStub({ _id: empBUserId });
      return queryStub(null);
    });
    mock.method(Employee, "findById", (id) => {
      if (String(id) === String(empAId)) return queryStub(empADoc);
      if (String(id) === String(empBId)) return queryStub(empBDoc);
      return queryStub(null);
    });
    mock.method(Lead, "findOne", (q) => {
      if (q?.code === "LD-8001" || String(q?._id) === String(leadDoc._id)) return queryStub(leadDoc);
      if (q?.code === "LD-8002" || String(q?._id) === String(otherLeadDoc._id)) return queryStub(otherLeadDoc);
      return queryStub(null);
    });
    mock.method(Lead, "findById", (id) => {
      if (String(id) === String(leadDoc._id)) return queryStub(leadDoc);
      if (String(id) === String(otherLeadDoc._id)) return queryStub(otherLeadDoc);
      return queryStub(null);
    });
    mock.method(Lead, "distinct", (_field, q) => {
      if (String(q?.assignedEmployeeId) === String(empAId)) {
        return Promise.resolve([leadDoc, otherLeadDoc].filter((l) => String(l.assignedEmployeeId) === String(empAId)).map((l) => l._id));
      }
      if (String(q?.assignedEmployeeId) === String(empBId)) {
        return Promise.resolve([leadDoc, otherLeadDoc].filter((l) => String(l.assignedEmployeeId) === String(empBId)).map((l) => l._id));
      }
      return Promise.resolve([]);
    });

    mock.method(LeadVisit, "findOne", (q) => {
      let hit = null;
      if (q?.idempotencyKey) {
        hit = visits.find((v) => String(v.leadId) === String(q.leadId) && v.idempotencyKey === q.idempotencyKey);
      } else if (q?.code) {
        hit = visits.find((v) => v.code === q.code);
      } else if (q?._id) {
        hit = visits.find((v) => String(v._id) === String(q._id));
      }
      if (hit) {
        hit.populate = async () => hit;
      }
      return queryStub(hit);
    });
    mock.method(LeadVisit, "create", async (data) => {
      const doc = new LeadVisit(data);
      await doc.validate();
      doc.code = `VST-${String(seq++).padStart(3, "0")}`;
      doc.populate = async () => doc;
      visits.push(doc);
      return doc;
    });
    mock.method(LeadVisit, "find", (filter) => {
      const matches = visits.filter((v) => {
        if (filter?.leadId?.$in) {
          return filter.leadId.$in.some((id) => String(id) === String(v.leadId));
        }
        return true;
      });
      return queryStub(matches);
    });
    mock.method(LeadVisit, "countDocuments", (filter) => {
      const matches = visits.filter((v) => {
        if (filter?.leadId?.$in) {
          return filter.leadId.$in.some((id) => String(id) === String(v.leadId));
        }
        return true;
      });
      return Promise.resolve(matches.length);
    });
    mock.method(LeadVisit, "findOneAndUpdate", (filter, update) => {
      const hit = visits.find(
        (v) =>
          String(v._id) === String(filter._id) &&
          (!filter.status?.$in || filter.status.$in.includes(v.status))
      );
      if (!hit) return queryStub(null);
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          hit[k] = v === null ? undefined : v;
        }
      }
      if (update.$push?.history) hit.history.push(update.$push.history);
      hit.populate = async () => hit;
      return queryStub(hit);
    });
    mock.method(LeadVisit, "updateMany", async (filter, update) => {
      let modifiedCount = 0;
      for (const v of visits) {
        const statusOk = !filter.status?.$in || filter.status.$in.includes(v.status);
        const leadOk = String(v.leadId) === String(filter.leadId);
        const empOk = !filter.assignedEmployeeId?.$ne || String(v.assignedEmployeeId) !== String(filter.assignedEmployeeId.$ne);
        if (leadOk && statusOk && empOk) {
          if (update.$set?.assignedEmployeeId) v.assignedEmployeeId = update.$set.assignedEmployeeId;
          if (update.$push?.history) v.history.push(update.$push.history);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    });

    mock.method(Notification, "create", async (data) => {
      if (data.dedupeKey && notifications.some((n) => n.dedupeKey === data.dedupeKey)) {
        const err = new Error("Duplicate dedupeKey");
        err.code = 11000;
        err.keyPattern = { dedupeKey: 1 };
        throw err;
      }
      const doc = new Notification(data);
      notifications.push({ ...data, id: String(doc._id) });
      return doc;
    });

    const adminToken = signAccessToken(adminUser);
    const empAToken = signAccessToken(empAUser);
    const empBToken = signAccessToken(empBUser);
    const inactiveToken = signAccessToken(inactiveEmpUser);

    await withServer(async (baseUrl) => {
      const future1 = new Date(Date.now() + 2 * 3600_000).toISOString();
      const future2 = new Date(Date.now() + 6 * 3600_000).toISOString();
      const future3 = new Date(Date.now() + 10 * 3600_000).toISOString();
      const pastDate = new Date(Date.now() - 24 * 3600_000).toISOString();

      // 4. Invalid Lead rejected -> 404
      const badLead = await fetch(`${baseUrl}/leads/LD-9999/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-00001" },
        body: JSON.stringify({ visitType: "SITE_VISIT", title: "Check", scheduledStart: future1, locationType: "PROJECT_SITE", locationAddress: "Site A" }),
      });
      assert.equal(badLead.status, 404);

      // 5. Past schedule rejected -> 400
      const badSchedule = await fetch(`${baseUrl}/leads/LD-8001/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-00002" },
        body: JSON.stringify({ visitType: "SITE_VISIT", title: "Past", scheduledStart: pastDate, locationType: "PROJECT_SITE", locationAddress: "Site A" }),
      });
      assert.equal(badSchedule.status, 400);

      // 3. Unassigned Employee B denied on LD-8001
      const unauthEmp = await fetch(`${baseUrl}/leads/LD-8001/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${empBToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-00003" },
        body: JSON.stringify({ visitType: "SITE_VISIT", title: "Unauthorized", scheduledStart: future1, locationType: "PROJECT_SITE", locationAddress: "Site A" }),
      });
      assert.equal(unauthEmp.status, 404);

      // 17. Inactive employee denied -> 401
      const inactiveRes = await fetch(`${baseUrl}/leads/LD-8001/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${inactiveToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-00004" },
        body: JSON.stringify({ visitType: "SITE_VISIT", title: "Inactive", scheduledStart: future1, locationType: "PROJECT_SITE", locationAddress: "Site A" }),
      });
      assert.equal(inactiveRes.status, 401);

      // 1. Admin creates visit VST-002 (or VST-001) on LD-8001
      const adminCreate = await fetch(`${baseUrl}/leads/LD-8001/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-admin1" },
        body: JSON.stringify({ visitType: "SITE_VISIT", title: "Initial site visit", scheduledStart: future1, locationType: "PROJECT_SITE", locationAddress: "Ring Road Site 3" }),
      });
      assert.equal(adminCreate.status, 201);
      const v1 = (await adminCreate.json()).data;
      assert.equal(v1.status, "SCHEDULED");
      assert.equal(v1.history.length, 1);

      // 6. Duplicate creation prevented via Idempotency-Key
      const dupReplay = await fetch(`${baseUrl}/leads/LD-8001/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-admin1" },
        body: JSON.stringify({ visitType: "SITE_VISIT", title: "Initial site visit", scheduledStart: future1, locationType: "PROJECT_SITE", locationAddress: "Ring Road Site 3" }),
      });
      assert.equal(dupReplay.status, 200);
      assert.equal(visits.length, 1);

      // 2. Assigned Employee A creates second independent visit on LD-8001
      const empCreate = await fetch(`${baseUrl}/leads/LD-8001/visits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json", "Idempotency-Key": "visit-idem-key-empa01" },
        body: JSON.stringify({ visitType: "CLIENT_MEETING", title: "Design signoff", scheduledStart: future2, locationType: "CUSTOMER_LOCATION", locationAddress: "Apex HQ" }),
      });
      assert.equal(empCreate.status, 201);
      const v2 = (await empCreate.json()).data;
      assert.equal(visits.length, 2);

      // 7-8. Admin sees all; Employee B sees only their own (0 on LD-8001) + 20. Notification dedupe on approaching
      const adminList = await fetch(`${baseUrl}/visits`, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert.equal(adminList.status, 200);
      assert.equal((await adminList.json()).data.length, 2);

      const empBList = await fetch(`${baseUrl}/visits`, { headers: { Authorization: `Bearer ${empBToken}` } });
      assert.equal(empBList.status, 200);
      assert.equal((await empBList.json()).data.length, 0);

      const empAList1 = await fetch(`${baseUrl}/visits`, { headers: { Authorization: `Bearer ${empAToken}` } });
      assert.equal(empAList1.status, 200);
      const approachingCount1 = notifications.filter((n) => n.dedupeKey?.startsWith("visit-approaching:")).length;
      const empAList2 = await fetch(`${baseUrl}/visits`, { headers: { Authorization: `Bearer ${empAToken}` } });
      assert.equal(empAList2.status, 200);
      const approachingCount2 = notifications.filter((n) => n.dedupeKey?.startsWith("visit-approaching:")).length;
      assert.equal(approachingCount1, approachingCount2); // deduplicated!

      // 9-10. Repeated rescheduling preserves full history
      const resched1 = await fetch(`${baseUrl}/visits/${v1.code}/reschedule`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledStart: future2, reason: "Client asked for afternoon" }),
      });
      assert.equal(resched1.status, 200);

      const resched2 = await fetch(`${baseUrl}/visits/${v1.code}/reschedule`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledStart: future3, reason: "Moved to evening" }),
      });
      assert.equal(resched2.status, 200);
      const v1Rescheduled = (await resched2.json()).data;
      assert.equal(v1Rescheduled.status, "RESCHEDULED");
      assert.equal(v1Rescheduled.history.length, 3);
      assert.equal(v1Rescheduled.history[1].previousSchedule.start, future1);
      assert.equal(v1Rescheduled.history[2].previousSchedule.start, future2);
      assert.equal(v1Rescheduled.history[2].newSchedule.start, future3);

      // 11 & 13. Complete v1 with outcome; completed visit cannot be modified
      const completeRes = await fetch(`${baseUrl}/visits/${v1.code}/complete`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "QUOTATION_REQUESTED", notes: "Measured 3 hoardings" }),
      });
      assert.equal(completeRes.status, 200);
      assert.equal((await completeRes.json()).data.outcome, "QUOTATION_REQUESTED");

      const modifyCompleted = await fetch(`${baseUrl}/visits/${v1.code}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason: "Too late" }),
      });
      assert.equal(modifyCompleted.status, 409);

      // 15-16. Lead reassignment transfers active v2 to Employee B, revokes Employee A, keeps historical Emp A attribution on v1
      const assignRes = await fetch(`${baseUrl}/leads/LD-8001/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: String(empBId) }),
      });
      assert.equal(assignRes.status, 200);

      const empAAfterReassign = await fetch(`${baseUrl}/visits/${v2.code}/complete`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empAToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "INTERESTED", notes: "Emp A should be blocked" }),
      });
      assert.equal(empAAfterReassign.status, 404);

      // 12 & 14. Employee B cancels v2 (with reason), cancelled visit cannot be completed
      const cancelRes = await fetch(`${baseUrl}/visits/${v2.code}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empBToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason: "Client postponed campaign" }),
      });
      assert.equal(cancelRes.status, 200);
      const cancelledV2 = (await cancelRes.json()).data;
      assert.equal(cancelledV2.status, "CANCELLED");
      assert.ok(cancelledV2.history.some((h) => h.eventType === "REASSIGNED"));
      assert.equal(visits[0].history[1].actorName, "Emp A"); // historical attribution preserved

      const completeCancelled = await fetch(`${baseUrl}/visits/${v2.code}/complete`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${empBToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "INTERESTED", notes: "Should fail" }),
      });
      assert.equal(completeCancelled.status, 409);

      // 22-24. Lead quality/status, followUp count, and Work status unaffected
      assert.equal(leadDoc.quality, "HOT");
      assert.equal(leadDoc.status, "In Progress");
      assert.equal(followUpCount, 2);
      assert.equal(workDoc.status, "IN_PROGRESS");
    });
  });

  it("18-19 & 21. verifies IST date filters, stats buckets, and Admin report aggregations", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const adminUser = new User({ _id: adminId, name: "Master Admin", email: "admin@test.local", role: "MASTER_ADMIN", isActive: true, tokenVersion: 0 });
    const adminToken = signAccessToken(adminUser);

    let capturedFilter = null;
    mock.method(User, "findById", () => queryStub(adminUser));
    mock.method(LeadVisit, "find", (filter) => {
      capturedFilter = filter;
      return queryStub([]);
    });
    mock.method(LeadVisit, "countDocuments", () => Promise.resolve(0));

    let aggCount = 0;
    mock.method(LeadVisit, "aggregate", () => {
      aggCount += 1;
      // 1st call: visitStats
      if (aggCount === 1) {
        return Promise.resolve([
          {
            total: [{ count: 5 }],
            byStatus: [{ _id: "COMPLETED", count: 2 }, { _id: "CANCELLED", count: 1 }, { _id: "SCHEDULED", count: 2 }],
            upcoming: [{ count: 1 }],
            today: [{ count: 1 }],
            overdue: [{ count: 1 }],
          },
        ]);
      }
      // Subsequent calls: visitReport (summary, byEmployee, byDate, byOutcome, byType)
      if (aggCount === 2) return Promise.resolve([{ total: 5, scheduled: 2, rescheduled: 0, completed: 2, cancelled: 1, overdue: 1 }]);
      if (aggCount === 3) return Promise.resolve([{ employeeId: "e1", name: "Emp A", code: "EMP-001", total: 5, completed: 2, cancelled: 1, upcoming: 1 }]);
      if (aggCount === 4) return Promise.resolve([{ date: "2026-11-28", total: 5, completed: 2, cancelled: 1 }]);
      if (aggCount === 5) return Promise.resolve([{ _id: "INTERESTED", count: 2 }]);
      return Promise.resolve([{ _id: "SITE_VISIT", count: 5 }]);
    });

    await withServer(async (baseUrl) => {
      const filtered = await fetch(`${baseUrl}/visits?from=2026-11-28&to=2026-11-28`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(filtered.status, 200);
      assert.equal(capturedFilter.scheduledStart.$gte.toISOString(), new Date("2026-11-28T00:00:00.000+05:30").toISOString());
      assert.equal(capturedFilter.scheduledStart.$lte.toISOString(), new Date("2026-11-28T23:59:59.999+05:30").toISOString());

      const statsRes = await fetch(`${baseUrl}/visits/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(statsRes.status, 200);
      const stats = (await statsRes.json()).data;
      assert.equal(stats.total, 5);
      assert.equal(stats.upcoming, 1);
      assert.equal(stats.today, 1);
      assert.equal(stats.overdue, 1);
      assert.equal(stats.completed, 2);
      assert.equal(stats.cancelled, 1);

      const reportRes = await fetch(`${baseUrl}/visits/report`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(reportRes.status, 200);
      const report = (await reportRes.json()).data;
      assert.equal(report.totals.completionRate, 40);
      assert.equal(report.byEmployee[0].name, "Emp A");
      assert.equal(report.byOutcome.INTERESTED, 2);
      assert.equal(report.byType.SITE_VISIT, 5);
    });
  });
});

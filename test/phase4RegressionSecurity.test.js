import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { BotStep } from "../src/models/BotStep.js";
import { Setting } from "../src/models/Setting.js";
import { Quotation } from "../src/models/Quotation.js";
import { Work } from "../src/models/Work.js";
import { Notification } from "../src/models/Notification.js";
import { Lead } from "../src/models/Lead.js";
import { Employee } from "../src/models/Employee.js";
import { env } from "../src/config/env.js";
import { signAccessToken, signRefreshToken } from "../src/utils/jwt.js";

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

function makeUser(id, role, name, extra = {}) {
  const user = new User({
    _id: id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@test.local`,
    role,
    isActive: true,
    tokenVersion: extra.tokenVersion ?? 0,
    ...(extra.employeeId ? { employee: extra.employeeId } : {}),
  });
  if (extra.employeeId) {
    Object.defineProperty(user, "employee", {
      value: { _id: extra.employeeId, name, role: "Sales", isActive: extra.employeeActive ?? true },
      configurable: true,
      enumerable: true,
    });
  }
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

describe("Phase 4: Integration Regression & Security Audit", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("fixes GET /api/settings/whatsapp env lookup crash and returns only masked credentials", async () => {
    const masterId = new mongoose.Types.ObjectId();
    const masterUser = makeUser(masterId, "MASTER_ADMIN", "Owner");
    const masterToken = signAccessToken(masterUser);

    mock.method(User, "findById", () => queryStub(masterUser));
    mock.method(Setting, "get", async () => null); // No stored URL triggers env.clientOrigin fallback!

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/settings/whatsapp`, {
        headers: { Authorization: `Bearer ${masterToken}` },
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.success, true);
      assert.ok(json.data.webhookUrl.endsWith("/api/whatsapp/webhook"));
      if (env.whatsappAccessToken) {
        assert.ok(!json.data.accessToken.includes(env.whatsappAccessToken));
        assert.ok(json.data.accessToken.startsWith("•"));
      }
      if (env.whatsappVerifyToken) {
        assert.ok(!json.data.webhookVerifyToken.includes(env.whatsappVerifyToken));
      }
    });
  });

  it("enforces body validation & strips unknown fields on PATCH /api/whatsapp/bot-flow/:id and preserves Meta GET webhook query keys", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const adminUser = makeUser(adminId, "ADMIN", "Admin Ops");
    const adminToken = signAccessToken(adminUser);
    const stepId = new mongoose.Types.ObjectId();

    mock.method(User, "findById", () => queryStub(adminUser));

    let receivedUpdateBody = null;
    mock.method(BotStep, "findByIdAndUpdate", async (_id, update) => {
      receivedUpdateBody = update;
      return {
        _id: stepId,
        order: 1,
        title: update.title ?? "Greeting",
        message: "Hi there",
        toJSON() {
          return { id: String(this._id), order: this.order, title: this.title, message: this.message };
        },
      };
    });

    await withServer(async (baseUrl) => {
      // Invalid order (< 1) and empty title rejected with 422
      const invalidRes = await fetch(`${baseUrl}/whatsapp/bot-flow/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ order: 0, title: "" }),
      });
      assert.equal(invalidRes.status, 422);

      // Valid partial update strips disallowed fields (like __proto__, injectedField, $set)
      const validRes = await fetch(`${baseUrl}/whatsapp/bot-flow/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ title: "Service Selection", injectedField: "evil", $gt: "scrubbed" }),
      });
      assert.equal(validRes.status, 200);
      assert.deepEqual(receivedUpdateBody, { title: "Service Selection" });

      // GET /api/whatsapp/webhook keeps hub.mode, hub.verify_token, hub.challenge despite sanitizeRequest dotted-key filter
      const origToken = env.whatsappVerifyToken;
      env.whatsappVerifyToken = "verify_secret_token_test";
      try {
        const okRes = await fetch(
          `${baseUrl}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify_secret_token_test&hub.challenge=CHALLENGE_999`
        );
        assert.equal(okRes.status, 200);
        assert.equal(await okRes.text(), "CHALLENGE_999");

        const badRes = await fetch(
          `${baseUrl}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE_999`
        );
        assert.equal(badRes.status, 403);
      } finally {
        env.whatsappVerifyToken = origToken;
      }
    });
  });

  it("rejects revoked refresh/access tokens, deactivated employees, non-admin settings/analytics access, and cross-employee actions", async () => {
    const masterId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();
    const emp1UserId = new mongoose.Types.ObjectId();
    const emp1Id = new mongoose.Types.ObjectId();
    const emp2Id = new mongoose.Types.ObjectId();

    const adminUser = makeUser(adminId, "ADMIN", "Sub Admin");
    const emp1User = makeUser(emp1UserId, "EMPLOYEE", "Emp One", { employeeId: emp1Id, tokenVersion: 2 });
    const inactiveEmpUser = makeUser(new mongoose.Types.ObjectId(), "EMPLOYEE", "Inactive Emp", {
      employeeId: emp2Id,
      employeeActive: false,
    });

    const staleEmpToken = signAccessToken(makeUser(emp1UserId, "EMPLOYEE", "Emp One", { employeeId: emp1Id, tokenVersion: 1 }));
    const staleRefresh = signRefreshToken(makeUser(emp1UserId, "EMPLOYEE", "Emp One", { employeeId: emp1Id, tokenVersion: 1 }), 1);
    const activeEmpToken = signAccessToken(emp1User);
    const inactiveToken = signAccessToken(inactiveEmpUser);
    const adminToken = signAccessToken(adminUser);

    mock.method(User, "findById", (id) => {
      if (String(id) === String(emp1UserId)) return queryStub(emp1User);
      if (String(id) === String(inactiveEmpUser._id)) return queryStub(inactiveEmpUser);
      if (String(id) === String(adminId)) return queryStub(adminUser);
      return queryStub(makeUser(masterId, "MASTER_ADMIN", "Master"));
    });

    mock.method(Employee, "findById", (id) => {
      if (String(id) === String(emp1Id)) {
        return queryStub({ _id: emp1Id, name: "Emp One", department: "Sales", isActive: true });
      }
      return queryStub(null);
    });

    const quoteOwnedByEmp2 = new Quotation({
      _id: new mongoose.Types.ObjectId(),
      quotationNumber: "QTN-900",
      clientId: new mongoose.Types.ObjectId(),
      clientDetails: { name: "Client B", phone: "919999988888" },
      createdBy: new mongoose.Types.ObjectId(),
      assignedSalesEmployeeId: emp2Id,
      status: "PENDING_APPROVAL",
      approvalStatus: "PENDING",
      lineItems: [{ description: "Signage", quantity: 1, rate: 1000, taxRate: 18, lineTotal: 1000 }],
      totals: { subtotal: 1000, taxTotal: 180, grandTotal: 1180 },
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 86400000),
    });
    mock.method(Quotation, "findOne", () => queryStub(quoteOwnedByEmp2));

    const workOwnedByEmp2 = new Work({
      _id: new mongoose.Types.ObjectId(),
      code: "WRK-900",
      clientId: new mongoose.Types.ObjectId(),
      clientName: "Client B",
      employeeId: emp2Id,
      title: "Logo Design",
      service: "Design",
      deadline: new Date(Date.now() + 86400000),
      status: "ASSIGNED",
    });
    mock.method(Work, "findOne", () => queryStub(workOwnedByEmp2));
    mock.method(Notification, "findOneAndUpdate", () => queryStub(null));
    mock.method(Lead, "findOne", () => queryStub(null));

    await withServer(async (baseUrl) => {
      // 1. Stale tokenVersion rejected on API and /auth/refresh
      assert.equal((await fetch(`${baseUrl}/leads`, { headers: { Authorization: `Bearer ${staleEmpToken}` } })).status, 401);
      assert.equal(
        (
          await fetch(`${baseUrl}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: staleRefresh }),
          })
        ).status,
        401
      );

      // 2. Deactivated employee rejected on protected API even with valid JWT signature
      assert.equal((await fetch(`${baseUrl}/leads`, { headers: { Authorization: `Bearer ${inactiveToken}` } })).status, 401);

      // 3. Employee forbidden from Admin analytics, settings, employees/stats, and WhatsApp routes
      assert.equal((await fetch(`${baseUrl}/analytics/dashboard`, { headers: { Authorization: `Bearer ${activeEmpToken}` } })).status, 403);
      assert.equal((await fetch(`${baseUrl}/settings/whatsapp`, { headers: { Authorization: `Bearer ${activeEmpToken}` } })).status, 403);
      assert.equal((await fetch(`${baseUrl}/whatsapp/conversations`, { headers: { Authorization: `Bearer ${activeEmpToken}` } })).status, 403);
      assert.equal((await fetch(`${baseUrl}/employees/stats`, { headers: { Authorization: `Bearer ${activeEmpToken}` } })).status, 403);

      // 4. Cross-employee isolation on Quotation, Work, and Notifications
      assert.equal((await fetch(`${baseUrl}/quotations/${quoteOwnedByEmp2._id}`, { headers: { Authorization: `Bearer ${activeEmpToken}` } })).status, 404);
      assert.equal(
        (
          await fetch(`${baseUrl}/quotations/${quoteOwnedByEmp2._id}/approve`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${adminToken}`,
              "Idempotency-Key": "idem-admin-approve-001",
            },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await fetch(`${baseUrl}/works/${workOwnedByEmp2._id}/progress`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeEmpToken}` },
            body: JSON.stringify({ progress: 50 }),
          })
        ).status,
        404
      );
      assert.equal(
        (
          await fetch(`${baseUrl}/works/${workOwnedByEmp2._id}/approve`, {
            method: "POST",
            headers: { Authorization: `Bearer ${activeEmpToken}` },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await fetch(`${baseUrl}/notifications/${new mongoose.Types.ObjectId()}/read`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeEmpToken}` },
            body: JSON.stringify({ read: true }),
          })
        ).status,
        404
      );
    });
  });
});

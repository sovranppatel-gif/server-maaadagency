import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeSchemas } from "../src/validators/index.js";
import { normalisePhone } from "../src/utils/format.js";

test("employee creation accepts the supported HR fields", () => {
  const result = employeeSchemas.create.parse({
    name: "  Asha Rao ",
    role: "Production Executive",
    email: "asha@example.com",
    phone: "+91 98765 43210",
    alternatePhone: "98765 00000",
    department: "Production",
    employmentType: "Full Time",
    address: "Office Road",
    city: "Delhi",
    joinedAt: "2026-01-15",
    reportingManager: "507f1f77bcf86cd799439011",
    isActive: true,
  });

  assert.equal(result.name, "Asha Rao");
  assert.equal(result.department, "Production");
  assert.equal(result.employmentType, "Full Time");
});

test("employee validation requires contact details and rejects invalid phone input", () => {
  const result = employeeSchemas.create.safeParse({
    name: "A",
    role: "Designer",
    email: "not-an-email",
    phone: "----------",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "name"));
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "email"));
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "phone"));
  }
});

test("employee contact normalization uses the existing phone formatter", () => {
  assert.equal(normalisePhone("(98765) 43210"), "919876543210");
  assert.equal(normalisePhone("+44 20 1234 5678"), "442012345678");
});

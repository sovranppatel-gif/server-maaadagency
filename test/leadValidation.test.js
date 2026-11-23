import { test } from "node:test";
import assert from "node:assert/strict";
import { leadSchemas } from "../src/validators/index.js";

test("manual lead input accepts the new sources and CRM fields", () => {
  const result = leadSchemas.create.parse({
    clientName: "Example Business",
    contactPersonName: "A Person",
    phone: "+91 98765 43210",
    alternatePhone: "98765 00000",
    service: "Printing",
    requirement: "Outdoor display",
    quantitySizeDimensions: "2 units, 10 x 4 ft",
    source: "Office Walk-in",
    priority: "HIGH",
    enquiryDate: "2026-11-22",
    internalRemarks: "Call before sending the estimate",
  });

  assert.equal(result.source, "Office Walk-in");
  assert.equal(result.quantitySizeDimensions, "2 units, 10 x 4 ft");
});

test("lead input rejects missing required contact and requirement details", () => {
  const result = leadSchemas.create.safeParse({
    clientName: "Example Business",
    phone: "----------",
    service: "Printing",
    requirement: "",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "phone"));
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "requirement"));
  }
});

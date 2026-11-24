import { test } from "node:test";
import assert from "node:assert/strict";
import { LeadFollowUp } from "../src/models/LeadFollowUp.js";
import { Notification } from "../src/models/Notification.js";
import { leadSchemas, workSchemas } from "../src/validators/index.js";

test("follow-up validation requires employee-reported details and ignores client attempt numbers", () => {
  const parsed = leadSchemas.followUp.parse({
    communicationType: "Call",
    contactedAt: "2026-11-23T12:00:00.000Z",
    discussionNotes: "Discussed the requirement",
    interestLevel: "Interested",
    quotationRequired: true,
    attemptNumber: 99,
  });

  assert.equal(parsed.communicationType, "Call");
  assert.equal("attemptNumber" in parsed, false);
  assert.equal(leadSchemas.followUp.safeParse({
    communicationType: "Carrier Pigeon",
    contactedAt: "not-a-date",
    discussionNotes: "",
    interestLevel: "Maybe",
  }).success, false);
});

test("follow-up model enforces unique lead attempt numbers and idempotency keys", () => {
  const indexes = LeadFollowUp.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.leadId === 1 && fields.attemptNumber === 1 && options.unique
  ));
  assert.ok(indexes.some(([fields, options]) =>
    fields.leadId === 1 && fields.idempotencyKey === 1 && options.unique
  ));
});

test("employee progress validation cannot accept status or completion mutations", () => {
  assert.equal(workSchemas.progress.safeParse({ start: true, progress: 0 }).success, true);
  assert.equal(workSchemas.progress.safeParse({ blockedReason: "Waiting for customer assets" }).success, true);
  assert.equal(workSchemas.progress.safeParse({ status: "COMPLETED" }).success, false);
  assert.equal(workSchemas.submit.safeParse({ summary: "Completed design" }).success, true);
  assert.equal(workSchemas.submit.safeParse({ summary: "" }).success, false);
});

test("notifications have a unique sparse dedupe key for reminder idempotency", () => {
  assert.ok(Notification.schema.indexes().some(([fields, options]) =>
    fields.dedupeKey === 1 && options.unique && options.sparse
  ));
});

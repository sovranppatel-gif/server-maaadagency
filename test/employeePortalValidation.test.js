import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationSchemas, workSchemas } from "../src/validators/index.js";

test("work list accepts the server-side upcoming deadline filter", () => {
  assert.equal(workSchemas.list.safeParse({ page: "1", limit: "5", upcomingOnly: "true" }).success, true);
  assert.equal(workSchemas.list.safeParse({ upcomingOnly: "later" }).success, false);
});

test("notification read state can be set explicitly to read or unread", () => {
  assert.deepEqual(notificationSchemas.read.parse({ read: true }), { read: true });
  assert.deepEqual(notificationSchemas.read.parse({ read: false }), { read: false });
  assert.equal(notificationSchemas.read.safeParse({ read: "false" }).success, false);
});

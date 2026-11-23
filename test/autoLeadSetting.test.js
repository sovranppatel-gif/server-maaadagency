import { test } from "node:test";
import assert from "node:assert/strict";
import { Setting } from "../src/models/Setting.js";
import { AUTO_LEAD_CREATION_KEY, getAutoLeadCreationEnabled } from "../src/services/settings.service.js";

test("legacy installs without a saved value default automatic lead creation to off", async (t) => {
  const get = t.mock.method(Setting, "get", async (_key, fallback) => fallback);

  assert.equal(await getAutoLeadCreationEnabled(), false);
  assert.deepEqual(get.mock.calls.map((call) => call.arguments), [
    [AUTO_LEAD_CREATION_KEY, null],
    ["whatsapp.config", null],
  ]);
});

test("automatic lead creation honors explicit saved on and off values", async (t) => {
  let storedValue = true;
  t.mock.method(Setting, "get", async (key) => key === AUTO_LEAD_CREATION_KEY ? storedValue : null);

  assert.equal(await getAutoLeadCreationEnabled(), true);
  storedValue = false;
  assert.equal(await getAutoLeadCreationEnabled(), false);
});

test("an explicit value in existing WhatsApp settings is preserved when the new key is absent", async (t) => {
  t.mock.method(Setting, "get", async (key) => (
    key === "whatsapp.config" ? { autoLeadCreationEnabled: true } : null
  ));

  assert.equal(await getAutoLeadCreationEnabled(), true);
});

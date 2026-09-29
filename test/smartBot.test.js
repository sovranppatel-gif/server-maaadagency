// Unit tests for the smart bot decision layer. No MongoDB and no AI provider
// needed: the AI call is replaced by canned model output that goes through
// the real validation (normalizeResult) and planning (planBotTurn) code.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { planBotTurn } from "../src/services/smartBot.service.js";
import { AiUnavailableError, buildUserContent, normalizeResult } from "../src/services/aiReply.service.js";
import { getAiConfig } from "../src/services/settings.service.js";
import { env } from "../src/config/env.js";

const serviceStep = {
  _id: "s1",
  collectsField: "service",
  message: "Aapko kis service ki requirement hai?",
  options: [{ label: "Website" }, { label: "Mobile App" }, { label: "Software" }],
};
const budgetStep = {
  _id: "s2",
  collectsField: "budget",
  message: "Aapka approximate budget kya hai?",
  options: [{ label: "₹10K-25K" }, { label: "₹25K-50K" }, { label: "₹50K-1L" }, { label: "₹1L+" }],
};
const deadlineStep = { _id: "s3", collectsField: "deadline", message: "Project kab tak chahiye?" };
const steps = [serviceStep, budgetStep, deadlineStep];
const faqs = [
  { _id: "f1", question: "Where is your company located?", answer: "Our company is based in Narsinghpur, Madhya Pradesh. 😊" },
];
const THRESHOLD = 0.75;

/** Canned model output with every required key, overridable per test. */
const modelOutput = (overrides) => ({
  intent: "UNCLEAR",
  confidence: 0.5,
  field: null,
  value: null,
  matchedOption: null,
  faqId: null,
  extractedFields: [],
  shouldAdvanceBot: false,
  shouldPauseBot: false,
  shouldCreateLead: false,
  reply: null,
  ...overrides,
});

/** Plans a turn where the "AI" returns `raw`; counts provider calls. */
async function plan(text, step, raw, { aiEnabled = true } = {}) {
  let calls = 0;
  const result = await planBotTurn({
    text,
    step,
    aiEnabled,
    threshold: THRESHOLD,
    analyze: async () => {
      calls += 1;
      if (raw instanceof Error) throw raw;
      return normalizeResult(raw, { text, step, steps, faqs });
    },
  });
  return { ...result, calls };
}

test("TEST 1: exact option number uses the existing matcher, no AI call", async () => {
  const p = await plan("1", serviceStep, modelOutput({}));
  assert.equal(p.action, "advance");
  assert.equal(p.answer, "Website");
  assert.equal(p.source, "exact");
  assert.equal(p.calls, 0);

  const byLabel = await plan("mobile app", serviceStep, modelOutput({}));
  assert.equal(byLabel.answer, "Mobile App");
  assert.equal(byLabel.calls, 0);
});

test("TEST 2: 'ecommerce website banwani hai' -> service = Website, advances", async () => {
  const p = await plan(
    "mujhe ek ecommerce website banwani hai",
    serviceStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.93, field: "service", value: "Website", matchedOption: "Website", shouldAdvanceBot: true })
  );
  assert.equal(p.action, "advance");
  assert.equal(p.answer, "Website");
  assert.equal(p.calls, 1);
});

test("TEST 3: 'android aur ios dono ke liye app' -> service = Mobile App", async () => {
  const p = await plan(
    "android aur ios dono ke liye app chahiye",
    serviceStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.95, field: "service", value: "Mobile App", matchedOption: "mobile app" })
  );
  assert.equal(p.action, "advance");
  assert.equal(p.answer, "Mobile App", "option label is canonicalised");
});

test("TEST 4: 'budget around 40-50 thousand' -> ₹25K-50K", async () => {
  const p = await plan(
    "budget around 40-50 thousand hai",
    budgetStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.9, field: "budget", value: "₹25K-50K", matchedOption: "₹25K-50K" })
  );
  assert.equal(p.action, "advance");
  assert.equal(p.answer, "₹25K-50K");
});

test("TEST 5: FAQ is answered from the database and the step does not advance", async () => {
  const p = await plan(
    "aapki company kaha hai?",
    budgetStep,
    modelOutput({ intent: "FAQ", confidence: 0.92, faqId: "f1", reply: "We are in Mumbai" })
  );
  assert.equal(p.action, "faq");
  assert.equal(p.faq.answer, faqs[0].answer, "stored answer, never the model's own text");
});

test("TEST 5b: FAQ id the model made up is treated as an unknown question", async () => {
  const p = await plan("office timing?", budgetStep, modelOutput({ intent: "FAQ", confidence: 0.9, faqId: "nope" }));
  assert.equal(p.action, "unknown");
});

test("TEST 6: human handoff request pauses the bot", async () => {
  const p = await plan(
    "mujhe kisi person se baat karni hai",
    budgetStep,
    modelOutput({ intent: "HUMAN_HANDOFF", confidence: 0.97, shouldPauseBot: true })
  );
  assert.equal(p.action, "handoff");
  assert.equal(p.result.shouldPauseBot, true);
});

test("TEST 7: gibberish is UNCLEAR -> clarify, no advance", async () => {
  const p = await plan("xyz abc", serviceStep, modelOutput({ intent: "UNCLEAR", confidence: 0.2 }));
  assert.equal(p.action, "clarify");
});

test("TEST 7b: a confident answer below the threshold is not saved", async () => {
  const p = await plan(
    "bahut zyada nahi",
    budgetStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.4, field: "budget", value: "₹10K-25K", matchedOption: "₹10K-25K" })
  );
  assert.equal(p.action, "clarify");
});

test("TEST 8: AI failure falls back to the rule-based flow", async () => {
  const p = await plan("website chahiye", serviceStep, new AiUnavailableError("timeout"));
  assert.equal(p.action, "rule_based");
  assert.equal(p.reason, "ai failure");
});

test("TEST 8b: invalid model JSON shape falls back to the rule-based flow", async () => {
  const p = await plan("website chahiye", serviceStep, { intent: "BOT_ANSWER" });
  assert.equal(p.action, "rule_based");
});

test("TEST 9: AI disabled -> rule-based flow, provider never called", async () => {
  const p = await plan("mujhe website chahiye", serviceStep, modelOutput({}), { aiEnabled: false });
  assert.equal(p.action, "rule_based");
  assert.equal(p.calls, 0);
});

test("TEST 9b: AI_ENABLED=false short-circuits config without touching MongoDB", async () => {
  if (env.aiEnabled) return; // only meaningful with the default env
  const config = await getAiConfig();
  assert.equal(config.enabled, false);
});

test("TEST 10: several answers in one message are kept for later, steps are not skipped", async () => {
  const p = await plan(
    "website chahiye, budget 50k hai aur next month tak complete chahiye",
    serviceStep,
    modelOutput({
      intent: "BOT_ANSWER",
      confidence: 0.9,
      field: "service",
      value: "Website",
      matchedOption: "Website",
      extractedFields: [
        { field: "budget", value: "₹25K-50K" },
        { field: "deadline", value: "1 month" },
      ],
    })
  );
  assert.equal(p.action, "advance");
  assert.equal(p.answer, "Website");
  assert.deepEqual(p.prefill, { budget: "₹25K-50K", deadline: "1 month" });
});

test("guard: an option that does not exist is never saved", async () => {
  const p = await plan(
    "kuch bhi",
    serviceStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.99, field: "service", value: "Blockchain", matchedOption: "Blockchain" })
  );
  assert.equal(p.action, "clarify");
});

test("guard: extracted fields are whitelisted to real step fields", () => {
  const r = normalizeResult(
    modelOutput({
      intent: "UNCLEAR",
      extractedFields: [
        { field: "$set", value: "x" },
        { field: "bot.active", value: "false" },
        { field: "isAdmin", value: "true" },
        { field: "budget", value: "not a real option" },
        { field: "deadline", value: "2 weeks" },
      ],
    }),
    { text: "", step: serviceStep, steps, faqs }
  );
  assert.deepEqual(r.extractedFields, { deadline: "2 weeks" });
});

test("guard: the model cannot create a lead or advance a non-answer", () => {
  const r = normalizeResult(
    modelOutput({ intent: "FAQ", confidence: 0.9, faqId: "f1", shouldCreateLead: true, shouldAdvanceBot: true }),
    { step: budgetStep, steps, faqs }
  );
  assert.equal(r.shouldCreateLead, false);
  assert.equal(r.shouldAdvanceBot, false);
});

test("guard: answering a different field does not advance the current step", async () => {
  const p = await plan(
    "50k",
    serviceStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.9, field: "budget", value: "₹25K-50K", matchedOption: "₹25K-50K" })
  );
  assert.equal(p.action, "clarify");
});

test("free-text step keeps the customer's answer", async () => {
  const p = await plan(
    "next month tak chahiye",
    deadlineStep,
    modelOutput({ intent: "BOT_ANSWER", confidence: 0.88, field: "deadline", value: "1 month" })
  );
  assert.equal(p.action, "advance");
  assert.equal(p.answer, "1 month");
});

test("prompt context carries the current step, later steps, FAQs and the message", () => {
  const content = buildUserContent({
    text: "aapki company kaha hai?",
    step: serviceStep,
    steps,
    faqs,
    history: [
      { direction: "outbound", message: serviceStep.message },
      { direction: "inbound", message: "hi" },
    ],
    businessInfo: { agencyName: "Maa Ad Agency" },
  });
  assert.match(content, /<customer_message>\naapki company kaha hai\?\n<\/customer_message>/);
  assert.match(content, /"field": "service"/);
  assert.match(content, /"field": "budget"/);
  assert.match(content, /"id": "f1"/);
  assert.match(content, /Customer: hi/);
});

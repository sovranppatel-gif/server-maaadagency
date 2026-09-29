// Live check of the real model against the Hinglish examples. Skipped unless
// an API key is configured; each run makes a handful of paid API calls.
//
//   AI_API_KEY=... npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMessage, isAiConfigured } from "../src/services/aiReply.service.js";

const skip = isAiConfigured() ? false : "set AI_API_KEY to run live AI checks";

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
const faqs = [{ _id: "f1", question: "Where is your company located?", answer: "Narsinghpur, Madhya Pradesh." }];

const ask = (text, step) => analyzeMessage({ text, step, steps, faqs, history: [], businessInfo: { agencyName: "Maa Ad Agency" } });

test("live: ecommerce website -> Website", { skip }, async () => {
  const r = await ask("mujhe ek ecommerce website banwani hai", serviceStep);
  assert.equal(r.intent, "BOT_ANSWER");
  assert.equal(r.value, "Website");
});

test("live: android + ios -> Mobile App", { skip }, async () => {
  const r = await ask("android aur ios dono ke liye app chahiye", serviceStep);
  assert.equal(r.value, "Mobile App");
});

test("live: 40-50 thousand -> ₹25K-50K", { skip }, async () => {
  const r = await ask("budget around 40-45 hazar hai", budgetStep);
  assert.equal(r.value, "₹25K-50K");
});

test("live: location question -> FAQ", { skip }, async () => {
  const r = await ask("aapki company kaha hai?", budgetStep);
  assert.equal(r.intent, "FAQ");
  assert.equal(r.faq?._id, "f1");
});

test("live: asks for a person -> HUMAN_HANDOFF", { skip }, async () => {
  const r = await ask("mujhe kisi person se baat karni hai", budgetStep);
  assert.equal(r.intent, "HUMAN_HANDOFF");
});

test("live: gibberish -> low confidence or UNCLEAR", { skip }, async () => {
  const r = await ask("xyz abc", serviceStep);
  assert.ok(r.intent === "UNCLEAR" || r.confidence < 0.75, `got ${r.intent} @ ${r.confidence}`);
});

test("live: several details -> extra fields extracted", { skip }, async () => {
  const r = await ask("website chahiye, budget 50k hai aur next month tak complete chahiye", serviceStep);
  assert.equal(r.value, "Website");
  assert.ok(r.extractedFields.deadline, "deadline extracted");
});

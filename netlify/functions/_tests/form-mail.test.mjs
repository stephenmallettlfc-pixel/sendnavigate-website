import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import oldEndpoint from "../form-submission.mjs";
import eventEndpoint from "../submission-created.mjs";
import {
  processSubmissionRequest, validateSubmission, validateEmail, buildMessages,
  escapeHtml, mailtoHref, idempotencyKey, FORM_IDS, CATEGORY_LABELS, OWNER, FROM, SITE_ID,
} from "../_lib/form-mail.mjs";

// Completely synthetic fixtures. No family/child data and no outbound requests.
const NOW = Date.parse("2026-11-03T16:00:00.000Z");
const EXPERT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SUBMISSION_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const NOW_FN = () => NOW;
const getEnv = (key) => ({
  RESEND_API_KEY: "synthetic-test-key-never-a-real-secret",
  ASK_EXPERT_FORM_ID: EXPERT_ID,
  FORM_OWNER_ALERT_ENABLED: "true", // Explicit direct owner alert for independent-delivery tests.
})[key];
const validData = {
  "sample-request": {
    "form-name": "sample-request", "first-name": "Synthetic", "last-name": "Tester",
    email: "school-test@example.invalid", "school-name": "Synthetic Organisation",
    role: "sendco", "bot-field": "",
  },
  "advisory-enquiry": {
    "form-name": "advisory-enquiry", name: "Synthetic Tester", email: "parent-test@example.invalid",
    phone: "", topic: "Not sure", "discovery-source": "Google search",
    message: "Synthetic general process enquiry for an offline test.", "bot-field": "",
  },
  "ask-expert": {
    "form-name": "ask-expert", name: "Synthetic Tester", email: "expert-test@example.invalid",
    "local-authority": "Synthetic Authority", "subject-category": "sen-support",
    question: "What is the general purpose of SEN support?",
    "privacy-acknowledgement": "yes", "general-question-confirmation": "confirmed", "bot-field": "",
  },
};
function fixture(formName = "ask-expert") {
  return { payload: {
    id: SUBMISSION_ID, form_id: FORM_IDS[formName] || EXPERT_ID,
    form_name: formName, created_at: "2026-11-03T15:59:00.000Z",
    site_url: "https://sendnavigate.org", name: "Not a form name",
    data: structuredClone(validData[formName]),
  } };
}
const req = (value, method = "POST") => new Request("https://unit.invalid/.netlify/functions/submission-created", {
  method, ...(method === "POST" ? { body: typeof value === "string" ? value : JSON.stringify(value) } : {}),
});
function harness({ responder, env = getEnv, now = NOW_FN } = {}) {
  const calls = []; const logs = []; const sleeps = [];
  const dependencies = {
    getEnv: env, now,
    logger: { info: (entry) => logs.push(entry) },
    sleep: async (delay) => { sleeps.push(delay); },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      const call = { body: JSON.parse(options.body), headers: options.headers, options };
      calls.push(call);
      return responder ? responder(call, calls) : new Response('{"id":"synthetic-provider-id"}', { status: 200 });
    },
  };
  return { calls, logs, sleeps, dependencies, run: (value) => processSubmissionRequest(req(value), dependencies) };
}
const verify = (envelope) => validateSubmission(envelope, { getEnv, now: NOW_FN });
const expectedSubjects = {
  "sample-request": {
    owner: "SEND Navigate | School sample-pack request",
    ack: "SEND Navigate | Your school training sample pack",
  },
  "advisory-enquiry": {
    owner: "SEND Navigate | Parent consultancy enquiry",
    ack: "SEND Navigate | Your parent consultancy enquiry",
  },
  "ask-expert": {
    owner: "SEND Navigate | Ask an Expert question",
    ack: "SEND Navigate | Your Ask an Expert question",
  },
};

// Self-contained copies of ONLY the labelled owner SYSTEM TEST records stored in
// routing-fix-2026-11-04/labelled-owner-test-fixtures.json. Preserve stored shape,
// submitted content and fixed dates; replace transport metadata with sentinels.
// The stored records omit ip; add a documentation IP to model the signed event.
// No original network IP, external fixture dependency or live delivery is used.
const STORED_NOW_FN = () => Date.parse("2026-11-04T14:46:00.000Z");
const STORED_EXPERT_ID = "6aea0e344898f5fc96632f07";
const storedEnv = (key) => key === "ASK_EXPERT_FORM_ID" ? STORED_EXPERT_ID : getEnv(key);
const METADATA_LIMITS = { ip: 64, user_agent: 1024, referrer: 2048 };
const storedFixtures = [
  {
    number: 3, title: null, email: OWNER, name: "SYSTEM TEST 20261104-ROUTING",
    first_name: "SYSTEM TEST", last_name: "20261104-ROUTING", company: null,
    summary: "SYSTEM TEST", body: null,
    data: {
      "first-name": "SYSTEM TEST", "last-name": "20261104-ROUTING", email: OWNER,
      "school-name": "SYSTEM TEST — no real school", role: "sendco",
      user_agent: "synthetic-netlify-metadata-agent/1.0",
      referrer: "https://example.invalid/netlify-metadata-fixture/sample-request", ip: "192.0.2.10",
    },
    created_at: "2026-11-04T14:44:38.304Z",
    human_fields: {
      "First Name": "SYSTEM TEST", "Last Name": "20261104-ROUTING", Email: OWNER,
      "School Name": "SYSTEM TEST — no real school", Role: "sendco",
    },
    ordered_human_fields: [
      { title: "First Name", name: "first-name", value: "SYSTEM TEST" },
      { title: "Last Name", name: "last-name", value: "20261104-ROUTING" },
      { title: "Email", name: "email", value: OWNER },
      { title: "School Name", name: "school-name", value: "SYSTEM TEST — no real school" },
      { title: "Role", name: "role", value: "sendco" },
    ],
    id: "6aeb44d60636baee762e537c", form_id: FORM_IDS["sample-request"],
    site_url: "https://sendnavigate.org", site_name: "sendnavigate", form_name: "sample-request",
  },
  {
    number: 21, title: null, email: OWNER,
    name: "SYSTEM TEST 20261104-ROUTING — not a customer enquiry",
    first_name: "SYSTEM", last_name: "enquiry", company: null,
    summary: "SYSTEM TEST 20261104-ROUTING-PARENT. No child or case information. Checking receipt and email routing only; no...",
    body: "SYSTEM TEST 20261104-ROUTING-PARENT. No child or case information. Checking receipt and email routing only; no consultation or advice requested. Do not count as a lead.",
    data: {
      name: "SYSTEM TEST 20261104-ROUTING — not a customer enquiry", email: OWNER,
      phone: "", topic: "Not sure", "discovery-source": "Other",
      message: "SYSTEM TEST 20261104-ROUTING-PARENT. No child or case information. Checking receipt and email routing only; no consultation or advice requested. Do not count as a lead.",
      user_agent: "synthetic-netlify-metadata-agent/1.0",
      referrer: "https://example.invalid/netlify-metadata-fixture/advisory-enquiry", ip: "192.0.2.10",
    },
    created_at: "2026-11-04T14:45:09.463Z",
    human_fields: {
      "Your name": "SYSTEM TEST 20261104-ROUTING — not a customer enquiry",
      "Email address": OWNER, "Phone (optional)": "", "What can I help with?": "Not sure",
      "How did you hear about SEND Navigate? (optional)": "Other",
      "Briefly — where are you in the process?": "SYSTEM TEST 20261104-ROUTING-PARENT. No child or case information. Checking receipt and email routing only; no consultation or advice requested. Do not count as a lead.",
    },
    ordered_human_fields: [
      { title: "Your name", name: "name", value: "SYSTEM TEST 20261104-ROUTING — not a customer enquiry" },
      { title: "Email address", name: "email", value: OWNER },
      { title: "Phone (optional)", name: "phone", value: "" },
      { title: "What can I help with?", name: "topic", value: "Not sure" },
      { title: "How did you hear about SEND Navigate? (optional)", name: "discovery-source", value: "Other" },
      { title: "Briefly — where are you in the process?", name: "message", value: "SYSTEM TEST 20261104-ROUTING-PARENT. No child or case information. Checking receipt and email routing only; no consultation or advice requested. Do not count as a lead." },
    ],
    id: "6aeb44f50abcc82e332f8663", form_id: FORM_IDS["advisory-enquiry"],
    site_url: "https://sendnavigate.org", site_name: "sendnavigate", form_name: "advisory-enquiry",
  },
  {
    number: 2, title: null, email: OWNER,
    name: "SYSTEM TEST 20261104-ROUTING — not a customer enquiry",
    first_name: "SYSTEM", last_name: "enquiry", company: null,
    summary: "SYSTEM TEST 20261104-ROUTING-EXPERT. No child or case information. Checking email routing only. No expert answer...",
    body: "SYSTEM TEST 20261104-ROUTING-EXPERT. No child or case information. Checking email routing only. No expert answer requested; do not count as a lead.",
    data: {
      name: "SYSTEM TEST 20261104-ROUTING — not a customer enquiry", email: OWNER,
      "local-authority": "", "subject-category": "other",
      question: "SYSTEM TEST 20261104-ROUTING-EXPERT. No child or case information. Checking email routing only. No expert answer requested; do not count as a lead.",
      "general-question-confirmation": "confirmed", "privacy-acknowledgement": "yes",
      user_agent: "synthetic-netlify-metadata-agent/1.0",
      referrer: "https://example.invalid/netlify-metadata-fixture/ask-expert", ip: "192.0.2.10",
    },
    created_at: "2026-11-04T14:45:10.285Z",
    human_fields: {
      "Your name (required)": "SYSTEM TEST 20261104-ROUTING — not a customer enquiry",
      "Email address (required)": OWNER, "Local authority (optional)": "", "Question category (optional)": "other",
      "One general question (required)": "SYSTEM TEST 20261104-ROUTING-EXPERT. No child or case information. Checking email routing only. No expert answer requested; do not count as a lead.",
      "I confirm that this is one general question, without child identifiers, health information, documents or links to case files. I understand the service’s scope and capacity limits. (Required)": "confirmed",
      "I have read the privacy information and understand how my enquiry will be used to assess and respond to my question. (Required)": "yes",
    },
    ordered_human_fields: [
      { title: "Your name (required)", name: "name", value: "SYSTEM TEST 20261104-ROUTING — not a customer enquiry" },
      { title: "Email address (required)", name: "email", value: OWNER },
      { title: "Local authority (optional)", name: "local-authority", value: "" },
      { title: "Question category (optional)", name: "subject-category", value: "other" },
      { title: "One general question (required)", name: "question", value: "SYSTEM TEST 20261104-ROUTING-EXPERT. No child or case information. Checking email routing only. No expert answer requested; do not count as a lead." },
      { title: "I confirm that this is one general question, without child identifiers, health information, documents or links to case files. I understand the service’s scope and capacity limits. (Required)", name: "general-question-confirmation", value: "confirmed" },
      { title: "I have read the privacy information and understand how my enquiry will be used to assess and respond to my question. (Required)", name: "privacy-acknowledgement", value: "yes" },
    ],
    id: "6aeb44f6df6d4b66c82004cd", form_id: STORED_EXPERT_ID,
    site_url: "https://sendnavigate.org", site_name: "sendnavigate", form_name: "ask-expert",
  },
];
const storedEnvelope = (record) => ({ payload: structuredClone(record) });
const verifyStored = (envelope) => validateSubmission(envelope, { getEnv: storedEnv, now: STORED_NOW_FN });
const storedHarness = () => harness({ env: storedEnv, now: STORED_NOW_FN });

for (const record of storedFixtures) {
  test(`${record.form_name}: stored owner SYSTEM TEST wrapped event accepts Netlify metadata without leaking it`, async () => {
    const envelope = storedEnvelope(record); const h = storedHarness();
    const response = await h.run(envelope);
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
    assert.equal(h.calls.length, 2);
    // Both synthetic recipients are the owner; identify messages by purpose.
    const owner = h.calls.find((call) => call.headers["Idempotency-Key"].includes("/owner/"));
    const ack = h.calls.find((call) => call.headers["Idempotency-Key"].includes("/ack/"));
    assert.deepEqual(owner.body.to, [OWNER]); assert.deepEqual(ack.body.to, [record.data.email]);
    assert.equal(owner.body.subject, expectedSubjects[record.form_name].owner);
    assert.equal(ack.body.subject, expectedSubjects[record.form_name].ack);
    const submission = verifyStored(envelope);
    const withoutMetadata = storedEnvelope(record);
    for (const key of Object.keys(METADATA_LIMITS)) delete withoutMetadata.payload.data[key];
    assert.deepEqual(submission, verifyStored(withoutMetadata));
    const baseline = buildMessages(verifyStored(withoutMetadata));
    assert.deepEqual(owner.body, baseline.owner); assert.deepEqual(ack.body, baseline.ack);
    for (const key of Object.keys(METADATA_LIMITS)) {
      assert.equal(Object.hasOwn(submission, key), false);
      const outputs = JSON.stringify({ submission, calls: h.calls, logs: h.logs });
      assert.equal(outputs.includes(record.data[key]), false);
      assert.equal(outputs.includes(escapeHtml(record.data[key])), false);
    }
    const privateText = record.data.question || record.data.message;
    if (privateText) {
      assert.ok(owner.body.text.includes(privateText));
      assert.ok(owner.body.html.includes(escapeHtml(privateText)));
      for (const output of [owner.body.subject, ack.body.subject, ack.body.text, ack.body.html, ...h.logs]) {
        assert.equal(output.includes(privateText), false);
        assert.equal(output.includes(escapeHtml(privateText)), false);
      }
    }
    assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_provider_accepted", "form_mail:ack_provider_accepted"]);
  });
}

test("all stored forms accept absent, empty and exactly bounded metadata strings, then discard them", async () => {
  for (const record of storedFixtures) {
    for (const mode of ["absent", "empty", "limit"]) {
      const envelope = storedEnvelope(record);
      for (const [key, max] of Object.entries(METADATA_LIMITS)) {
        if (mode === "absent") delete envelope.payload.data[key];
        else envelope.payload.data[key] = mode === "empty" ? "" : `${key}-sentinel-`.padEnd(max, "x");
      }
      const h = storedHarness(); const response = await h.run(envelope);
      assert.equal(response.status, 204); assert.equal(await response.text(), "");
      assert.equal(h.calls.length, 2);
      assert.deepEqual(verifyStored(envelope), verifyStored(storedEnvelope(record)));
      for (const value of Object.keys(METADATA_LIMITS).map((key) => envelope.payload.data[key]).filter(Boolean))
        assert.equal(JSON.stringify({ calls: h.calls, logs: h.logs }).includes(value), false);
      assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_provider_accepted", "form_mail:ack_provider_accepted"]);
    }
  }
});

for (const [key, max] of Object.entries(METADATA_LIMITS)) {
  test(`${key}: invalid metadata types, overlong raw strings and unsafe controls reject without body logging`, async () => {
    const marker = `private-${key}-metadata-marker`;
    const invalid = [null, false, 42, { value: marker }, [marker], marker.padEnd(max + 1, "x"),
      " ".repeat(max + 1), ...["\u0000", "\t", "\n", "\r", "\u001f", "\u007f", "\u0085", "\u009f", "\u2028", "\u2029"].map((control) => marker + control)];
    for (const record of storedFixtures) {
      for (const value of invalid) {
        const envelope = storedEnvelope(record); envelope.payload.data[key] = value;
        const h = storedHarness(); const response = await h.run(envelope);
        assert.equal(response.status, 204); assert.equal(await response.text(), "");
        assert.equal(h.calls.length, 0); assert.equal(h.sleeps.length, 0);
        assert.deepEqual(h.logs, ["form_mail:rejected_validation"]);
        assert.equal(h.logs.join("").includes(marker), false);
        assert.equal(h.logs.join("").includes(record.data.question || record.data.message || record.data["school-name"]), false);
      }
    }
  });
}

test("valid Netlify metadata does not admit arbitrary fields or hyphenated user-agent", async () => {
  for (const record of storedFixtures) {
    for (const key of ["malicious-field", "user-agent", "referrer_extra", "__proto__"]) {
      const envelope = storedEnvelope(record);
      Object.defineProperty(envelope.payload.data, key, {
        value: "private-malicious-field-marker", enumerable: true,
      });
      const h = storedHarness(); const response = await h.run(envelope);
      assert.equal(response.status, 204); assert.equal(await response.text(), "");
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.logs, ["form_mail:rejected_validation"]);
      assert.equal(h.logs.join("").includes("private-malicious-field-marker"), false);
    }
  }
});

for (const formName of Object.keys(validData)) {
  test(`${formName}: valid verified fixture sends private owner and its own acknowledgement`, async () => {
    const h = harness(); const result = await h.run(fixture(formName));
    assert.equal(result.status, 204); assert.equal(h.calls.length, 2);
    const owner = h.calls.find((call) => call.body.to[0] === OWNER);
    const ack = h.calls.find((call) => call.body.to[0] !== OWNER);
    assert.equal(OWNER, "stephen@sendnavigate.com");
    assert.deepEqual(owner.body.to, ["stephen@sendnavigate.com"]);
    assert.deepEqual(ack.body.to, [validData[formName].email]);
    assert.equal(owner.body.subject, expectedSubjects[formName].owner);
    assert.equal(ack.body.subject, expectedSubjects[formName].ack);
    assert.equal(owner.body.reply_to, validData[formName].email);
    assert.equal(ack.body.reply_to, "stephen@sendnavigate.com");
    assert.equal(owner.body.from, FROM); assert.equal(ack.body.from, FROM);
    assert.equal(typeof owner.body.text, "string"); assert.equal(typeof ack.body.text, "string");
    assert.ok(owner.headers["Idempotency-Key"]); assert.ok(ack.headers["Idempotency-Key"]);
    assert.notEqual(owner.headers["Idempotency-Key"], ack.headers["Idempotency-Key"]);
    for (const call of h.calls) {
      assert.equal(call.options.redirect, "error");
      assert.equal(call.body.subject.includes("Synthetic"), false);
      assert.equal(call.body.subject.includes(validData[formName].email), false);
      assert.doesNotMatch(JSON.stringify({ to: call.body.to, reply_to: call.body.reply_to }), /@gmail\.com\b/i);
      for (const value of Object.values(validData[formName]).filter(Boolean))
        assert.equal(call.body.subject.includes(value), false);
    }
    if (formName === "sample-request") {
      for (const filename of ["sample_module1_slides.pdf", "sample_facilitator_guide.pdf", "sample_eef_mapping.pdf"]) {
        const url = `https://sendnavigate.org/${filename}`;
        assert.ok(ack.body.text.includes(url));
        assert.ok(ack.body.html.includes(`href="${url}"`));
      }
      assert.match(ack.body.text, /links, not email attachments/);
      assert.equal(ack.body.attachments, undefined);
      assert.equal(ack.body.text.includes("Licence Pricing"), false);
    } else {
      assert.equal(ack.body.text.includes("sample_"), false);
      for (const value of [validData[formName].name, validData[formName].question,
        validData[formName].message, validData[formName]["local-authority"]].filter(Boolean)) {
        assert.equal(ack.body.text.includes(value), false);
        assert.equal(ack.body.html.includes(value), false);
      }
      assert.match(ack.body.text, /not/); assert.match(ack.body.text, /deadline/);
    }
    assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_provider_accepted", "form_mail:ack_provider_accepted"]);
  });
}

test("all form types keep three distinct fixed owner subjects and three distinct fixed acknowledgements", () => {
  const messages = Object.keys(validData).map((formName) => buildMessages(verify(fixture(formName))));
  for (const purpose of ["owner", "ack"]) {
    const subjects = messages.map((message) => message[purpose].subject);
    assert.deepEqual(subjects, Object.values(expectedSubjects).map((subject) => subject[purpose]));
    assert.equal(new Set(subjects).size, 3);
  }
});

test("all form types: subjects ignore submitter data; acknowledgements never echo free text", () => {
  const freeTextFields = {
    "sample-request": ["first-name", "last-name", "school-name"],
    "advisory-enquiry": ["name", "message"],
    "ask-expert": ["name", "local-authority", "question"],
  };
  for (const [formName, fields] of Object.entries(freeTextFields)) {
    const f = fixture(formName);
    const markers = fields.map((field, index) => {
      const marker = `Private-marker-${index} <b>do not echo</b> & 'synthetic'`;
      f.payload.data[field] = marker;
      return marker;
    });
    f.payload.data.email = "private-submitter+marker@example.invalid";
    markers.push(f.payload.data.email);
    if (formName === "advisory-enquiry") {
      f.payload.data.phone = "+44 1234 567890";
      markers.push(f.payload.data.phone);
    }
    const { owner, ack } = buildMessages(verify(f));
    assert.equal(owner.subject, expectedSubjects[formName].owner);
    assert.equal(ack.subject, expectedSubjects[formName].ack);
    assert.deepEqual(owner.to, ["stephen@sendnavigate.com"]);
    for (const marker of markers) {
      assert.ok(owner.text.includes(marker));
      assert.equal(owner.subject.includes(marker), false);
      assert.equal(ack.subject.includes(marker), false);
      assert.equal(ack.text.includes(marker), false);
      assert.equal(ack.html.includes(marker), false);
      assert.equal(ack.html.includes(escapeHtml(marker)), false);
    }
  }
});

test("expert optional authority and category can be omitted; all current category labels accepted", () => {
  const f = fixture(); delete f.payload.data["local-authority"]; delete f.payload.data["subject-category"];
  assert.equal(verify(f).formName, "ask-expert");
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const next = fixture(); next.payload.data["subject-category"] = category;
    assert.equal(verify(next).formName, "ask-expert");
  }
});

test("form ID is authoritative; browser form-name or top-level submitter name never authorise", async () => {
  for (const mutate of [
    (p) => { delete p.form_id; },
    (p) => { p.form_id = "cccccccccccccccccccccccc"; },
    (p) => { p.form_id = [EXPERT_ID]; },
    (p) => { p.form_id = ""; p.name = "ask-expert"; },
    (p) => { p.form_id = FORM_IDS["sample-request"]; },
    (p) => { p.form_name = "sample-request"; },
    (p) => { p.form_name = { name: "ask-expert" }; },
    (p) => { p.data["form-name"] = "sample-request"; },
    (p) => { p.site_id = "wrong-site"; },
  ]) {
    const f = fixture(); mutate(f.payload); const h = harness();
    assert.equal((await h.run(f)).status, 204); assert.equal(h.calls.length, 0);
    assert.equal(h.logs.length, 1); assert.match(h.logs[0], /^form_mail:rejected_/);
  }
  const f = fixture(); delete f.payload.form_name; delete f.payload.data["form-name"];
  f.payload.name = "sample-request"; f.payload.site_id = SITE_ID;
  assert.equal(verify(f).formName, "ask-expert");
});

test("new expert form disabled until authoritative ID configured; overlapping/invalid config rejected", async () => {
  for (const expertId of [undefined, "ask-expert", FORM_IDS["sample-request"]]) {
    const h = harness({ env: (key) => key === "ASK_EXPERT_FORM_ID" ? expertId : getEnv(key) });
    assert.equal((await h.run(fixture())).status, 204); assert.equal(h.calls.length, 0);
  }
  const h = harness({ env: (key) => key === "ASK_EXPERT_PAUSED" ? "true" : getEnv(key) });
  assert.equal((await h.run(fixture())).status, 204); assert.equal(h.calls.length, 0);
  assert.deepEqual(h.logs, ["form_mail:rejected_paused"]);
});

test("malformed, unwrapped, arbitrary and oversized request bodies fail closed", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify(fixture().payload),
    { data: validData["ask-expert"] }, { payload: null }, { payload: [] }, " ".repeat(65537)]) {
    const h = harness(); assert.equal((await h.run(body)).status, 204); assert.equal(h.calls.length, 0);
  }
});

test("missing submission ID, old/future timestamps and invalid creation types fail closed", async () => {
  for (const mutate of [
    (p) => { delete p.id; }, (p) => { p.id = 123; }, (p) => { p.id = "not-an-id"; },
    (p) => { delete p.created_at; }, (p) => { p.created_at = 0; },
    (p) => { p.created_at = "2026-11-02T15:00:00.000Z"; },
    (p) => { p.created_at = "2026-11-04T15:00:00.000Z"; },
    (p) => { p.created_at = "invalid"; },
  ]) {
    const f = fixture(); mutate(f.payload); const h = harness();
    assert.equal((await h.run(f)).status, 204); assert.equal(h.calls.length, 0);
  }
});

test("invalid email addresses, header injection, multi-recipient and display names are rejected", async () => {
  const addresses = ["", "no-at", "a@localhost", "a..b@example.invalid", ".a@example.invalid",
    "a@example.invalid\r\nBcc: injected@example.invalid", "a@example.invalid,b@example.invalid",
    "Tester <a@example.invalid>", " a@example.invalid", "a@example.invalid ", "a@bad-.invalid",
    "a@-bad.invalid", "a%0d%0a@example.invalid", ["a@example.invalid"], null, "x".repeat(65) + "@example.invalid"];
  for (const email of addresses) {
    assert.equal(validateEmail(email), false);
    const f = fixture(); f.payload.data.email = email; const h = harness();
    assert.equal((await h.run(f)).status, 204); assert.equal(h.calls.length, 0);
  }
  for (const email of ["synthetic+tag@example.invalid", "synthetic.o'neil@example.invalid", "synthetic&tag@example.invalid"])
    assert.equal(validateEmail(email), true);
});

test("types, required acknowledgements, labels, overlong fields and attachments rejected", async () => {
  const mutations = [
    (p) => { p.data = null; }, (p) => { p.data = []; },
    (p) => { p.data.question = ["question"]; }, (p) => { p.data.name = null; },
    (p) => { p.data.question = "x".repeat(1501); }, (p) => { p.data.name = "x".repeat(101); },
    (p) => { p.data["local-authority"] = "x".repeat(121); },
    (p) => { p.data["subject-category"] = "clinical-diagnosis"; },
    (p) => { p.data["privacy-acknowledgement"] = "no"; },
    (p) => { delete p.data["privacy-acknowledgement"]; },
    (p) => { delete p.data["general-question-confirmation"]; },
    (p) => { p.data["general-question-confirmation"] = "yes"; },
    (p) => { p.data["general-question-confirmation"] = "on"; },
    (p) => { p.data.question = "   "; },
    (p) => { p.data.question = "synthetic\u0000question"; },
    (p) => { p.data.name = "synthetic\nname"; },
    (p) => { p.data.attachment = "https://example.invalid/file.pdf"; },
    (p) => { p.attachments = [{ url: "https://example.invalid/file.pdf" }]; },
    (p) => { p.files = { upload: "synthetic" }; },
    (p) => { p.data["marketing-consent"] = "yes"; },
    (p) => { p.data.ip = { value: "synthetic" }; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.payload); const h = harness();
    assert.equal((await h.run(f)).status, 204); assert.equal(h.calls.length, 0);
  }
  const f = fixture(); f.payload.data.question = "x".repeat(1500);
  assert.equal(verify(f).formName, "ask-expert");
});

test("school and advisory role/topic labels and lengths are validated", async () => {
  for (const [form, key, value] of [
    ["sample-request", "role", "forged-role"], ["sample-request", "school-name", "x".repeat(201)],
    ["sample-request", "first-name", ""], ["advisory-enquiry", "topic", "forged-topic"],
    ["advisory-enquiry", "discovery-source", "forged-source"],
    ["advisory-enquiry", "phone", "not a phone"], ["advisory-enquiry", "message", "x".repeat(3001)],
  ]) {
    const f = fixture(form); f.payload.data[key] = value; const h = harness();
    assert.equal((await h.run(f)).status, 204); assert.equal(h.calls.length, 0);
  }
});

test("spam flags and filled honeypots suppress both messages", async () => {
  for (const mutate of [
    (p) => { p.spam = true; }, (p) => { p.is_spam = true; },
    (p) => { p.spam = "false"; }, (p) => { p.data["bot-field"] = "filled"; },
    (p) => { p.data["bot-field"] = "   "; },
  ]) {
    const f = fixture(); mutate(f.payload); const h = harness();
    assert.equal((await h.run(f)).status, 204); assert.equal(h.calls.length, 0);
  }
  const f = fixture(); f.payload.spam = false; f.payload.is_spam = false;
  assert.equal(verify(f).formName, "ask-expert");
});

test("HTML escaped for every user value; mailto encoded; subjects fixed; acknowledgement never echoes", () => {
  const f = fixture(); const marker = '<img src=x onerror="synthetic()"> & \' synthetic';
  f.payload.data.name = marker; f.payload.data.question = marker + "\nsecond line";
  f.payload.data["local-authority"] = marker; f.payload.data.email = "synthetic.o'neil+tag@example.invalid";
  const { owner, ack } = buildMessages(verify(f));
  assert.ok(owner.html.includes(escapeHtml(marker))); assert.equal(owner.html.includes(marker), false);
  assert.equal(owner.html.includes("<img"), false);
  assert.ok(owner.html.includes("mailto:synthetic.o%27neil%2Btag%40example.invalid"));
  assert.equal(owner.subject.includes(marker), false); assert.equal(ack.html.includes("synthetic"), false);
  assert.ok(owner.text.includes(marker));
  assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
  assert.throws(() => mailtoHref("invalid\r\n@example.invalid"));
});

test("independent owner and acknowledgement failures; 401 not retried; no provider body logged/returned", async () => {
  for (const failOwner of [false, true]) {
    const secretBody = "synthetic provider error with private-value-placeholder";
    const h = harness({ responder: (call) => new Response(secretBody, {
      status: (call.body.to[0] === OWNER) === failOwner ? 401 : 200,
    }) });
    const response = await h.run(fixture());
    assert.equal(response.status, 503); assert.equal(await response.text(), "");
    assert.equal(h.calls.length, 2); assert.equal(h.sleeps.length, 0);
    assert.ok(h.logs.includes(`form_mail:${failOwner ? "owner" : "ack"}_failed`));
    assert.ok(h.logs.includes(`form_mail:${failOwner ? "ack" : "owner"}_provider_accepted`));
    assert.equal(h.logs.join("").includes(secretBody), false);
    assert.equal(h.logs.join("").includes(validData["ask-expert"].email), false);
  }
});

test("duplicate events reuse keys and immutable bodies; mocked Resend deduplicates by purpose", async () => {
  const accepted = new Map(); let actualMockSends = 0;
  const h = harness({ responder: (call) => {
    const key = call.headers["Idempotency-Key"];
    if (accepted.has(key)) assert.deepEqual(accepted.get(key), call.body);
    else { accepted.set(key, call.body); actualMockSends += 1; }
    return new Response('{"id":"synthetic"}', { status: 200 });
  } });
  assert.equal((await h.run(fixture())).status, 204);
  assert.equal((await h.run(fixture())).status, 204);
  assert.equal(h.calls.length, 4); assert.equal(actualMockSends, 2);
  const s = verify(fixture());
  assert.equal(idempotencyKey(s, "owner"), idempotencyKey(s, "owner"));
  assert.notEqual(idempotencyKey(s, "owner"), idempotencyKey(s, "ack"));
  assert.notEqual(idempotencyKey(s, "owner"), idempotencyKey({ ...s, id: "dddddddddddddddddddddddd" }, "owner"));
  assert.ok(idempotencyKey(s, "owner").length <= 256);
  assert.equal(idempotencyKey(s, "owner").includes(s.email), false);
});

test("transient 429/5xx/network/concurrent-conflict retries are bounded and idempotent", async () => {
  for (const failure of [429, 503, "network", "concurrent"]) {
    const attempts = new Map();
    const h = harness({ responder: (call) => {
      const key = call.headers["Idempotency-Key"]; const count = (attempts.get(key) || 0) + 1;
      attempts.set(key, count);
      if (count > 1) return new Response("ok", { status: 200 });
      if (failure === "network") throw new Error("synthetic untrusted provider error");
      if (failure === "concurrent") return new Response('{"name":"concurrent_idempotent_requests"}', { status: 409 });
      return new Response("synthetic failure", { status: failure });
    } });
    assert.equal((await h.run(fixture())).status, 204); assert.equal(h.calls.length, 4);
    for (const purpose of ["owner", "ack"]) {
      const matching = h.calls.filter((call) => call.headers["Idempotency-Key"].includes(`/${purpose}/`));
      assert.deepEqual(matching[0].body, matching[1].body);
      assert.equal(matching[0].headers["Idempotency-Key"], matching[1].headers["Idempotency-Key"]);
    }
  }
  const h = harness({ responder: () => new Response("synthetic permanent failure", { status: 503 }) });
  assert.equal((await h.run(fixture())).status, 503); assert.equal(h.calls.length, 6);
  assert.deepEqual(h.sleeps.sort((a, b) => a - b), [500, 500, 1000, 1000]);
});

test("changed-payload 409 is not retried or hidden by changing the key", async () => {
  const h = harness({ responder: () => new Response('{"name":"invalid_idempotent_request"}', { status: 409 }) });
  assert.equal((await h.run(fixture())).status, 503); assert.equal(h.calls.length, 2);
  assert.equal(h.sleeps.length, 0);
});

test("missing configuration never sends and uses only fixed diagnostic stage", async () => {
  const h = harness({ env: (key) => key === "RESEND_API_KEY" ? undefined : getEnv(key) });
  assert.equal((await h.run(fixture())).status, 503); assert.equal(h.calls.length, 0);
  assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:configuration_missing"]);
});

test("logging failure cannot suppress either mail", async () => {
  const h = harness(); h.dependencies.logger = { info: () => { throw new Error("synthetic logger failure"); } };
  assert.equal((await h.run(fixture())).status, 204); assert.equal(h.calls.length, 2);
});

test("retired HTTP function returns 204 for all inputs with no parsing, env access or email calls", async () => {
  for (const input of [req(fixture()), req("{"), req(undefined, "GET")]) {
    const response = await oldEndpoint(input); assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  }
  const source = await readFile(new URL("../form-submission.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false); assert.equal(source.includes("req.json"), false);
});

test("legacy event entry keeps exact binding and no custom generic HTTP path", async () => {
  assert.equal(typeof eventEndpoint, "function");
  const source = await readFile(new URL("../submission-created.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("export const config"), false);
  assert.equal(source.includes('data["form-name"]'), false);
});

test("mock platform gateway refuses forged HTTP before handler invocation (not a real JWS test)", async () => {
  let invocations = 0;
  const mockGateway = async (request, platformVerified) => {
    if (!platformVerified) return new Response(null, { status: 401 });
    invocations += 1; const h = harness(); return h.run(await request.json());
  };
  const forged = req(fixture());
  forged.headers.set("Origin", "https://sendnavigate.org");
  forged.headers.set("X-Netlify-Event", "submission-created");
  assert.equal((await mockGateway(forged, false)).status, 401);
  assert.equal(invocations, 0);
  // Real Netlify gateway signature verification still requires a preview test;
  // no offline mock purports to implement or prove Netlify's JWS validation.
});

test("custom owner alerts default OFF; only exact true enables direct SEND Navigate owner alerts", async () => {
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    const h = harness({ env: (key) => key === "FORM_OWNER_ALERT_ENABLED" ? flag : getEnv(key) });
    assert.equal((await h.run(fixture())).status, 204);
    assert.equal(h.calls.length, 1);
    assert.notEqual(h.calls[0].body.to[0], OWNER);
    assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_custom_disabled", "form_mail:ack_provider_accepted"]);
  }
  const h = harness({ env: (key) => key === "FORM_OWNER_ALERT_ENABLED" ? "true" : getEnv(key) });
  assert.equal((await h.run(fixture())).status, 204);
  assert.equal(h.calls.length, 2);
  const owner = h.calls.find((call) => call.body.to[0] === "stephen@sendnavigate.com");
  assert.deepEqual(owner.body.to, ["stephen@sendnavigate.com"]);
  assert.equal(owner.body.subject, expectedSubjects["ask-expert"].owner);
  assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_provider_accepted", "form_mail:ack_provider_accepted"]);
});

test("custom owner alerts disabled: acknowledgement failure returns fixed failure without owner mail", async () => {
  const h = harness({
    env: (key) => key === "FORM_OWNER_ALERT_ENABLED" ? undefined : getEnv(key),
    responder: () => new Response("synthetic private provider error", { status: 401 }),
  });
  const response = await h.run(fixture());
  assert.equal(response.status, 503); assert.equal(await response.text(), "");
  assert.equal(h.calls.length, 1); assert.notEqual(h.calls[0].body.to[0], OWNER);
  assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_custom_disabled", "form_mail:ack_failed"]);
  // Native platform notifications are not invoked, disabled or affected by this function.
});

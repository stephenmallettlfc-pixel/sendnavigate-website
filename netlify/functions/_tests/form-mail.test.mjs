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
  FORM_OWNER_ALERT_ENABLED: "true", // Explicit fallback for independent-delivery tests.
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
function harness({ responder, env = getEnv } = {}) {
  const calls = []; const logs = []; const sleeps = [];
  const dependencies = {
    getEnv: env, now: NOW_FN,
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

for (const formName of Object.keys(validData)) {
  test(`${formName}: valid verified fixture sends private owner and its own acknowledgement`, async () => {
    const h = harness(); const result = await h.run(fixture(formName));
    assert.equal(result.status, 204); assert.equal(h.calls.length, 2);
    const owner = h.calls.find((call) => call.body.to[0] === OWNER);
    const ack = h.calls.find((call) => call.body.to[0] !== OWNER);
    assert.equal(owner.body.reply_to, validData[formName].email);
    assert.equal(ack.body.reply_to, OWNER);
    assert.equal(owner.body.from, FROM); assert.equal(ack.body.from, FROM);
    assert.equal(typeof owner.body.text, "string"); assert.equal(typeof ack.body.text, "string");
    assert.ok(owner.headers["Idempotency-Key"]); assert.ok(ack.headers["Idempotency-Key"]);
    assert.notEqual(owner.headers["Idempotency-Key"], ack.headers["Idempotency-Key"]);
    for (const call of h.calls) {
      assert.equal(call.options.redirect, "error");
      assert.equal(call.body.subject.includes("Synthetic"), false);
      assert.equal(call.body.subject.includes(validData[formName].email), false);
    }
    if (formName === "sample-request") {
      for (const filename of ["sample_module1_slides.pdf", "sample_facilitator_guide.pdf", "sample_eef_mapping.pdf"])
        assert.ok(ack.body.text.includes(filename));
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

test("native owner path: custom owner alerts default OFF; only exact true enables fallback", async () => {
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    const h = harness({ env: (key) => key === "FORM_OWNER_ALERT_ENABLED" ? flag : getEnv(key) });
    assert.equal((await h.run(fixture())).status, 204);
    assert.equal(h.calls.length, 1);
    assert.notEqual(h.calls[0].body.to[0], OWNER);
    assert.deepEqual(h.logs, ["form_mail:validated", "form_mail:owner_custom_disabled", "form_mail:ack_provider_accepted"]);
  }
});

test("native owner path: acknowledgement failure returns fixed failure, never sends duplicate owner mail", async () => {
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

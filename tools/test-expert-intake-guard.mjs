import test from "node:test";
import assert from "node:assert/strict";
import guard, { config } from "../netlify/edge-functions/expert-intake-guard.js";

const ORIGIN = "https://sendnavigate.org";
const MAX_BYTES = 256 * 1024;
const PRIVATE_MARKER = "synthetic-private-question-DO-NOT-ECHO";
const context = {
  next() { throw new Error("Guard must not invoke downstream processing"); },
  waitUntil() { throw new Error("Guard must not dispatch receipt or analytics work"); },
};

function runtime(t, value, throws = false) {
  if (arguments.length < 2) value = "true";
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Netlify");
  const accessed = [];
  Object.defineProperty(globalThis, "Netlify", {
    configurable: true,
    value: { env: { get(name) {
      accessed.push(name);
      if (throws) throw new Error("Synthetic configuration unavailable");
      return name === "ASK_EXPERT_INTAKE_PAUSED" ? value : undefined;
    } } },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Netlify", previous);
    else delete globalThis.Netlify;
  });
  return accessed;
}

function urlencoded(body, options = {}) {
  return new Request(`${ORIGIN}${options.path || "/expert-question-received"}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...options.headers },
    body,
  });
}

function multipart(entries, path = "/expert-question-received") {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return new Request(`${ORIGIN}${path}`, { method: "POST", body: data });
}

async function assertDenied(request) {
  const response = await guard(request, context);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-sendnavigate-intake"), "paused-not-accepted");
  assert.equal(response.headers.get("location"), null);
  const html = await response.text();
  assert.match(html, /temporarily paused/);
  assert.match(html, /href="\/resources"/);
  assert.match(html, /href="\/free-consultation"/);
  assert.match(html, /not document pre-reading or a full case review/);
  assert.ok(!html.includes(PRIVATE_MARKER));
  assert.doesNotMatch(html, /<script|gtag|form_received|expert_question_received|<form\b/i);
  assert.equal(request.bodyUsed, false);
  return html;
}

async function assertPreserved(request) {
  const originalBytes = new Uint8Array(await request.clone().arrayBuffer());
  const originalHeaders = [...request.headers];
  const originalUrl = request.url;
  assert.equal(await guard(request, context), undefined);
  assert.equal(request.bodyUsed, false);
  assert.equal(request.url, originalUrl);
  assert.deepEqual([...request.headers], originalHeaders);
  assert.deepEqual(new Uint8Array(await request.arrayBuffer()), originalBytes);
}

test("inline declaration covers native POSTs and excludes internal endpoints", () => {
  assert.deepEqual(config, { path: "/*", method: "POST", excludedPath: "/.netlify/*" });
});

for (const value of [undefined, "false", "", "TRUE", " true "]) {
  test(`optional flag ${JSON.stringify(value)} leaves intake open without cloning`, async (t) => {
    const keys = runtime(t, value);
    const request = urlencoded(`form-name=ask-expert&question=${PRIVATE_MARKER}`);
    request.clone = () => { throw new Error("Open mode must not read body"); };
    assert.equal(await guard(request, context), undefined);
    assert.equal(request.bodyUsed, false);
    assert.match(await request.text(), /form-name=ask-expert/);
    assert.deepEqual(keys, ["ASK_EXPERT_INTAKE_PAUSED"]);
  });
}

test("unavailable environment accessor defaults open", async (t) => {
  runtime(t, "true", true);
  await assertPreserved(urlencoded("form-name=ask-expert&question=synthetic"));
});

test("missing Netlify global defaults open", async (t) => {
  runtime(t);
  delete globalThis.Netlify;
  await assertPreserved(urlencoded("form-name=ask-expert"));
});

test("open multipart is unmodified", async (t) => {
  runtime(t, "false");
  await assertPreserved(multipart([["form-name", "ask-expert"], ["question", "synthetic"]]));
});

test("paused expert URL-encoded POST is refused across public paths", async (t) => {
  runtime(t);
  for (const path of ["/", "/ask-an-expert", "/expert-question-received", "/expert-question-received.html", "/other-page"]) {
    const request = urlencoded(`form-name=ask-expert&question=${PRIVATE_MARKER}`, { path });
    await assertDenied(request);
    assert.match(await request.text(), /form-name=ask-expert/);
  }
});

test("paused multipart expert is refused without consuming original", async (t) => {
  runtime(t);
  const request = multipart([["form-name", "ask-expert"], ["question", PRIVATE_MARKER]]);
  await assertDenied(request);
  assert.equal((await request.formData()).get("form-name"), "ask-expert");
});

test("percent-encoded or whitespace-padded expert identity cannot bypass", async (t) => {
  runtime(t);
  for (const body of ["form%2Dname=%61sk-expert", "form-name=+ask-expert+"]) {
    await assertDenied(urlencoded(body));
  }
});

for (const name of ["sample-request", "advisory-enquiry"]) {
  test(`paused ${name} URL-encoded body and headers are preserved`, async (t) => {
    runtime(t);
    await assertPreserved(urlencoded(`form-name=${name}&question=synthetic%20%26%20text&repeat=a&repeat=b`, {
      path: "/thank-you", headers: { "x-synthetic-test": "preserve" },
    }));
  });
  test(`paused ${name} multipart body is preserved byte-for-byte`, async (t) => {
    runtime(t);
    await assertPreserved(multipart([["form-name", name], ["question", "synthetic & text"], ["repeat", "a"], ["repeat", "b"]], "/thank-you"));
  });
}

test("GET bypasses without even accessing runtime flag", async (t) => {
  const keys = runtime(t);
  assert.equal(await guard(new Request(`${ORIGIN}/ask-an-expert?form-name=ask-expert`), context), undefined);
  assert.deepEqual(keys, []);
});

test("internal Netlify function and identity endpoints bypass unchanged", async (t) => {
  const keys = runtime(t);
  for (const path of ["/.netlify/functions/form-submission", "/.netlify/identity/token", "/.netlify"]) {
    await assertPreserved(urlencoded("form-name=ask-expert", { path }));
  }
  assert.deepEqual(keys, []);
});

test("non-native JSON and plain text requests pass unchanged while paused", async (t) => {
  runtime(t);
  for (const type of ["application/json", "text/plain"]) {
    await assertPreserved(new Request(`${ORIGIN}/webhook`, {
      method: "POST", headers: { "content-type": type }, body: '{"form-name":"ask-expert"}',
    }));
  }
});

test("duplicate URL-encoded identities are refused in either order or equal values", async (t) => {
  runtime(t);
  for (const values of [["ask-expert", "school-enquiry"], ["school-enquiry", "ask-expert"], ["school-enquiry", "school-enquiry"]]) {
    await assertDenied(urlencoded(new URLSearchParams(values.map(value => ["form-name", value])).toString()));
  }
});

test("duplicate multipart identities and file-valued identities are refused", async (t) => {
  runtime(t);
  for (const values of [["school-enquiry", "ask-expert"], ["ask-expert", "school-enquiry"], ["advisory-enquiry", "advisory-enquiry"]]) {
    await assertDenied(multipart(values.map(value => ["form-name", value])));
  }
  await assertDenied(multipart([["form-name", new File(["ask-expert"], "synthetic.txt")]]));
});

test("missing or empty form identity fails closed when explicitly paused", async (t) => {
  runtime(t);
  for (const body of ["question=synthetic", "form-name=", "form-name=+++"]) await assertDenied(urlencoded(body));
});

test("declared oversize is refused before reading or cloning", async (t) => {
  runtime(t);
  const request = urlencoded("form-name=ask-expert", { headers: { "content-length": String(MAX_BYTES + 1) } });
  request.clone = () => { throw new Error("Declared oversize must be refused before cloning"); };
  await assertDenied(request);
});

test("actual oversize is bounded even with no or misleading Content-Length", async (t) => {
  runtime(t);
  for (const headers of [{}, { "content-length": "1" }]) {
    const body = `form-name=ask-expert&question=${"x".repeat(MAX_BYTES)}`;
    const request = urlencoded(body, { headers });
    const start = performance.now();
    await assertDenied(request);
    assert.ok(performance.now() - start < 1000, "Clone cancellation must not wait for original body");
    assert.equal((await request.text()).length, body.length);
  }
});

test("exactly 256 KiB unrelated form still passes; one byte extra is refused", async (t) => {
  runtime(t);
  const prefix = "form-name=advisory-enquiry&question=";
  const body = prefix + "x".repeat(MAX_BYTES - prefix.length);
  await assertPreserved(urlencoded(body));
  await assertDenied(urlencoded(body + "x"));
});

test("paused mode preserves long multibyte consultancy text beyond the old bound", async (t) => {
  runtime(t);
  const body = new URLSearchParams({ "form-name": "advisory-enquiry", message: "漢".repeat(2400) }).toString();
  assert.ok(Buffer.byteLength(body) > 20 * 1024);
  await assertPreserved(urlencoded(body));
});

test("streamed chunks cannot evade the total byte bound", async (t) => {
  runtime(t);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("form-name=ask-expert&question="));
    for (let i = 0; i < 66; i++) controller.enqueue(new Uint8Array(4096).fill(120));
    controller.close();
  } });
  const request = new Request(`${ORIGIN}/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: stream, duplex: "half" });
  await assertDenied(request);
  assert.ok((await request.arrayBuffer()).byteLength > MAX_BYTES);
});

test("malformed URL escapes, UTF-8 and declared lengths fail closed", async (t) => {
  runtime(t);
  for (const body of ["form-name=ask-expert&question=%", "form-name=%GG", "form-name=%FF", "form-name=ask-expert&question=%C0%AF"]) {
    await assertDenied(urlencoded(body));
  }
  await assertDenied(urlencoded(new Uint8Array([255, 254])));
  await assertDenied(urlencoded("form-name=ask-expert", { headers: { "content-length": "invalid" } }));
});

test("malformed multipart or absent boundary fails closed", async (t) => {
  runtime(t);
  for (const contentType of ["multipart/form-data", "multipart/form-data; boundary=synthetic"]) {
    await assertDenied(new Request(`${ORIGIN}/`, { method: "POST", headers: { "content-type": contentType }, body: "not a multipart body" }));
  }
});

test("body stream errors fail closed without request values in response", async (t) => {
  runtime(t);
  const stream = new ReadableStream({ start(controller) { controller.error(new Error(PRIVATE_MARKER)); } });
  await assertDenied(new Request(`${ORIGIN}/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: stream, duplex: "half" }));
});

test("stalled body is bounded in time and returns a refusal", async (t) => {
  runtime(t);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("form-name=ask-expert&question="));
    // Deliberately never close or produce another chunk.
  } });
  const request = new Request(`${ORIGIN}/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: stream, duplex: "half" });
  const start = performance.now();
  await assertDenied(request);
  assert.ok(performance.now() - start < 3000);
  // Cleanup belongs to the synthetic client, never the guard's pass-through.
  void request.body.cancel().catch(() => {});
});

test("all refusals use identical fixed HTML and never reflect input or query", async (t) => {
  runtime(t);
  const first = await assertDenied(urlencoded(`form-name=ask-expert&question=${PRIVATE_MARKER}`, {
    path: `/expert-question-received?question=${PRIVATE_MARKER}`, headers: { "x-synthetic-private": PRIVATE_MARKER },
  }));
  const second = await assertDenied(urlencoded("form-name=ask-expert&question=%"));
  assert.equal(first, second);
});

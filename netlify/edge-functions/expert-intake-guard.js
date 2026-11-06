// Manual native Forms intake pause, not a quota counter or the mail-only flag.
// Configure ASK_EXPERT_INTAKE_PAUSED in Netlify's Functions runtime scope.
// Only the exact string "true" pauses intake. Missing/unavailable config stays
// open to preserve today's intake; once explicitly paused, parsing fails closed.
// Live native-storage interception still requires verification after deployment.

// Covers URL-encoded multibyte text within the existing backend's field limits.
// Still bound oversized or ambiguous native POST bodies while explicitly paused.
const MAX_BODY_BYTES = 256 * 1024;
const BODY_READ_TIMEOUT_MS = 1500;
const PAUSED_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ask an Expert is temporarily paused | SEND Navigate</title></head>
<body><main>
<h1>Ask an Expert is temporarily paused</h1>
<p>We are not accepting new Ask an Expert questions while capacity is being reviewed. This submission has not been accepted. Please do not rely on it for a reply or to meet a deadline.</p>
<p>You can <a href="/resources">find free help and resources</a> or explore a separate <a href="/free-consultation">free 30-minute consultation</a>.</p>
<p>The free consultation offers a discussion and a short written next-step summary based on that discussion, not document pre-reading or a full case review. Paid document work is separate and begins only after its scope and fee are agreed. There is no obligation to proceed.</p>
</main></body>
</html>`;

function pausedResponse() {
  // Fixed content only: no request values, logs, analytics, receipts or hooks.
  return new Response(PAUSED_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-sendnavigate-intake": "paused-not-accepted",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}

function intakeIsPaused() {
  try {
    return globalThis.Netlify?.env?.get("ASK_EXPERT_INTAKE_PAUSED") === "true";
  } catch {
    // Optional configuration, not a capacity check. Never inspect other env vars.
    return false;
  }
}

async function readBoundedClone(request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new Error("Unclassifiable form body");
  }
  // Never consume or replace the original request, including on pass-through.
  const body = request.clone().body;
  if (!body) throw new Error("Unclassifiable form body");
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  let timer;
  let complete = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Form read limit")), BODY_READ_TIMEOUT_MS);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) {
        complete = true;
        break;
      }
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error("Form read limit");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    if (!complete) {
      // A cloned stream is a tee: awaiting cancellation can wait forever for the
      // untouched original branch. Request no more data, without awaiting it.
      void reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}

function urlencodedNames(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // URLSearchParams silently repairs bad escapes; reject them before parsing
  // so an ambiguous identity cannot bypass an explicit pause.
  for (const field of text.split("&")) {
    for (const part of field.split("=")) {
      decodeURIComponent(part.replace(/\+/g, " "));
    }
  }
  return new URLSearchParams(text).getAll("form-name");
}

export default async function expertIntakeGuard(request) {
  if (request.method !== "POST") return;
  const pathname = new URL(request.url).pathname;
  // Also defend when called directly in tests; Netlify excludes these inline.
  // External third-party endpoints are outside this site's Edge route binding.
  if (pathname === "/.netlify" || pathname.startsWith("/.netlify/")) return;
  if (!intakeIsPaused()) return; // Fast pass: no clone/body parsing while open.

  const contentType = request.headers.get("content-type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded" &&
      mediaType !== "multipart/form-data") return;

  try {
    const bytes = await readBoundedClone(request);
    const names = mediaType === "application/x-www-form-urlencoded"
      ? urlencodedNames(bytes)
      : (await new Response(bytes, {
          headers: { "content-type": contentType },
        }).formData()).getAll("form-name");
    // Reject all duplicate identities, irrespective of order/value. Do not let
    // a first/last-name parser disagreement turn a school name into a bypass.
    if (names.length !== 1 || typeof names[0] !== "string" || !names[0].trim()) {
      return pausedResponse();
    }
    if (names[0].trim() === "ask-expert") return pausedResponse();
    return; // School, advisory and other valid native forms retain their bodies.
  } catch {
    // Oversized, stalled, malformed or otherwise unclassifiable native-form
    // requests are refused only while the pause is explicitly active. No PII.
    return pausedResponse();
  }
}

export const config = {
  path: "/*",
  method: "POST",
  excludedPath: "/.netlify/*",
};

import { createHash } from "node:crypto";

export const SITE_ID = "236fd2e0-16c9-4ba9-9d28-e10b190a9918";
export const FORM_IDS = Object.freeze({
  "sample-request": "6a4a38c0d37ba10008eeca08",
  "advisory-enquiry": "6a38de7bac8ea70008a7fa60",
});
// ASK_EXPERT_REGISTRATION: after registration on this SAME site, set the
// Functions-scoped ASK_EXPERT_FORM_ID environment variable to its authoritative
// Netlify form ID. Never derive this from data['form-name']; no name-only fallback.
export const OWNER = "stephen@sendnavigate.com";
export const FROM = "SEND Navigate <noreply@sendnavigate.org>";
const EMAIL_ENDPOINT = "https://api.resend.com/emails";
const MAX_EVENT_BYTES = 65536;
const MAX_ATTEMPTS = 3;
// Resend retains keys 24h. Refuse events older than 23h so we never automatically
// re-send a stale event after that window. Recovery after expiry must be manual.
const MAX_EVENT_AGE_MS = 23 * 60 * 60 * 1000;
const HEX_ID = /^[a-f0-9]{24}$/i;
const SINGLE_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const MULTILINE_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u;
const ROLE_LABELS = Object.freeze({
  headteacher: "Headteacher / Principal", sendco: "SENCo / SEND Lead",
  deputy: "Deputy / Assistant Headteacher", "mat-ceo": "MAT CEO / Director of Education",
  "cpd-provider": "CPD / INSET Provider", "class-teacher": "Class Teacher", other: "Other",
});
export const CATEGORY_LABELS = Object.freeze({
  "sen-support": "Understanding SEN support",
  "ehcp-process": "Understanding the EHCP process",
  "school-la-conversations": "Talking with school or the local authority",
  "free-help": "Finding free help",
  other: "Other general question",
});
const TOPIC_LABELS = Object.freeze({
  "Hourly Consultation (£95/hr)": "Hourly Consultation",
  "Initial Consultation (£175)": "Initial Consultation",
  "Formal Legal Letter (£275)": "Formal Legal Letter",
  "Annual Review Support (£350)": "Annual Review Support",
  "EHCP Application Support (£450)": "EHCP Application Support",
  "EHCP Review & Strengthening (£550)": "EHCP Review & Strengthening",
  "Working Document (£250)": "Working Document",
  "DLA / PIP Form Support (£295)": "DLA / PIP Form Support",
  "Mediation Support (£650)": "Mediation Support",
  "Disability Discrimination (£1,200)": "Disability Discrimination",
  "Exclusion Support (£1,350)": "Exclusion Support",
  "LA Decision Appeal Package (£1,600)": "LA Decision Appeal Package",
  "Tribunal Preparation Pack (£3,000)": "Tribunal Preparation Pack",
  "Tribunal + Representation (£4,000)": "Tribunal + Representation",
  "Complex Tribunal (£6,000)": "Complex Tribunal",
  "Monthly Retainer (£350/month)": "Monthly Retainer",
  "Not sure": "Not sure yet",
});
const DISCOVERY_LABELS = new Set([
  "Google search", "One of Stephen’s books", "Parent support group or charity",
  "Social media", "Personal recommendation", "Other",
]);
const FORM_FIELDS = Object.freeze({
  "sample-request": ["first-name", "last-name", "email", "school-name", "role"],
  "advisory-enquiry": ["name", "email", "phone", "topic", "discovery-source", "message"],
  "ask-expert": ["name", "email", "local-authority", "subject-category", "question", "privacy-acknowledgement", "general-question-confirmation"],
});
const COMMON_FIELDS = ["form-name", "bot-field", "ip"];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => Object.hasOwn(object, key);
class Rejected extends Error {
  constructor(stage) { super("Submission rejected"); this.stage = stage; }
}
const reject = (stage = "rejected_validation") => { throw new Rejected(stage); };
const stageLog = (logger, stage) => {
  // Only callers' fixed stages; no IDs, fields, error objects or provider bodies.
  try { logger.info(`form_mail:${stage}`); } catch { /* logging cannot suppress delivery */ }
};
const runtimeEnv = (key) => globalThis.Netlify?.env?.get(key);

function field(data, key, { required = false, max = 200, multiline = false } = {}) {
  if (!hasOwn(data, key)) { if (required) reject(); return ""; }
  const value = data[key];
  if (typeof value !== "string" || value.length > max ||
      (multiline ? MULTILINE_CONTROL : SINGLE_CONTROL).test(value)) reject();
  const trimmed = value.trim();
  if (required && !trimmed) reject();
  return trimmed;
}

export function validateEmail(value) {
  // Conservative ASCII single mailbox; reject lists, display names, whitespace,
  // header controls, URL escapes and quoted mailboxes rather than guessing.
  if (typeof value !== "string" || value.length > 254 || value !== value.trim() ||
      SINGLE_CONTROL.test(value) || /\s/u.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[A-Za-z0-9.!#$&'*+\-/=?^_`{|}~]+$/.test(local) ||
      local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => label.length >= 1 && label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)) &&
    /^[A-Za-z]{2,63}$/.test(labels.at(-1));
}

export function validateSubmission(envelope, { getEnv = runtimeEnv, now = Date.now } = {}) {
  // Only the supported wrapped legacy event; never payload.data || payload.
  if (!isRecord(envelope) || !hasOwn(envelope, "payload") || !isRecord(envelope.payload))
    reject("rejected_envelope");
  const payload = envelope.payload;
  if (typeof payload.form_id !== "string" || !HEX_ID.test(payload.form_id))
    reject("rejected_form_identity");
  if (hasOwn(payload, "site_id") && payload.site_id !== SITE_ID) reject("rejected_form_identity");
  const formId = payload.form_id.toLowerCase();
  let formName = Object.keys(FORM_IDS).find((name) => FORM_IDS[name] === formId);
  if (!formName) {
    const expertId = getEnv("ASK_EXPERT_FORM_ID");
    if (typeof expertId === "string" && HEX_ID.test(expertId) &&
        !Object.values(FORM_IDS).includes(expertId.toLowerCase()) && expertId.toLowerCase() === formId)
      formName = "ask-expert";
  }
  if (!formName) reject("rejected_unknown_form");
  // Optional top-level form_name is a consistency guard, not the identity source.
  // Top-level name is submitter-derived and is deliberately never used.
  if (hasOwn(payload, "form_name") && payload.form_name !== formName) reject("rejected_form_identity");
  if (formName === "ask-expert" && getEnv("ASK_EXPERT_PAUSED") === "true") reject("rejected_paused");
  if (typeof payload.id !== "string" || !HEX_ID.test(payload.id)) reject("rejected_submission_identity");
  if (typeof payload.created_at !== "string" || payload.created_at.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at))
    reject("rejected_submission_age");
  const createdAt = Date.parse(payload.created_at);
  const currentTime = now();
  if (!Number.isFinite(createdAt) || createdAt > currentTime + 5 * 60 * 1000 ||
      currentTime - createdAt > MAX_EVENT_AGE_MS) reject("rejected_submission_age");
  // The event is already Netlify-verified non-spam. Honour explicit flags if sent.
  for (const key of ["spam", "is_spam"]) {
    if (hasOwn(payload, key) && payload[key] !== false) reject("rejected_spam");
  }
  for (const key of ["files", "attachments"]) {
    if (hasOwn(payload, key) && !(Array.isArray(payload[key]) && payload[key].length === 0))
      reject("rejected_validation");
  }
  const data = payload.data;
  if (!isRecord(data) || Object.keys(data).length > 20) reject();
  const allowed = new Set([...FORM_FIELDS[formName], ...COMMON_FIELDS]);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key) || typeof data[key] !== "string") reject();
  }
  field(data, "bot-field", { max: 200 });
  if (hasOwn(data, "bot-field") && data["bot-field"].length !== 0) reject("rejected_spam");
  field(data, "ip", { max: 64 }); // Never copied to mail, URLs, logs or analytics.
  const postedName = field(data, "form-name", { max: 64 });
  if (hasOwn(data, "form-name") && postedName !== formName) reject("rejected_form_identity");
  // Validate the raw address so whitespace or CR/LF cannot be normalised away.
  if (!validateEmail(data.email)) reject();
  const submission = { formName, formId, id: payload.id.toLowerCase(), email: data.email, rows: [] };
  const add = (label, value) => submission.rows.push([label, value || "Not specified"]);
  if (formName === "sample-request") {
    const first = field(data, "first-name", { required: true, max: 100 });
    const last = field(data, "last-name", { required: true, max: 100 });
    const school = field(data, "school-name", { required: true, max: 200 });
    const role = field(data, "role", { required: true, max: 40 });
    if (!hasOwn(ROLE_LABELS, role)) reject();
    add("Name", `${first} ${last}`); add("Email", submission.email);
    add("School / organisation", school); add("Role", ROLE_LABELS[role]);
  } else if (formName === "advisory-enquiry") {
    const name = field(data, "name", { required: true, max: 100 });
    const phone = field(data, "phone", { max: 40 });
    if (phone && !/^[+0-9(). \-]{3,40}$/.test(phone)) reject();
    const topic = field(data, "topic", { required: true, max: 100 });
    if (!hasOwn(TOPIC_LABELS, topic)) reject();
    const discovery = field(data, "discovery-source", { max: 100 });
    if (discovery && !DISCOVERY_LABELS.has(discovery)) reject();
    const message = field(data, "message", { required: true, max: 3000, multiline: true });
    add("Name", name); add("Email", submission.email); add("Phone", phone);
    add("Enquiry topic", TOPIC_LABELS[topic]); add("Brief enquiry", message);
    // Discovery source is validated but not included in operational mail.
  } else {
    const name = field(data, "name", { required: true, max: 100 });
    const authority = field(data, "local-authority", { max: 120 });
    const category = field(data, "subject-category", { max: 40 });
    if (category && !hasOwn(CATEGORY_LABELS, category)) reject();
    const question = field(data, "question", { required: true, max: 1500, multiline: true });
    if (field(data, "privacy-acknowledgement", { required: true, max: 20 }) !== "yes") reject();
    if (field(data, "general-question-confirmation", { required: true, max: 20 }) !== "confirmed") reject();
    add("Name", name); add("Email", submission.email); add("Local authority", authority);
    add("General subject", CATEGORY_LABELS[category]); add("General question", question);
    add("Privacy acknowledgement", "Acknowledged; not marketing permission");
  }
  return submission;
}

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
export function mailtoHref(email) {
  if (!validateEmail(email)) throw new Error("Invalid reply address");
  // encodeURIComponent does not escape apostrophe; encode it too for HTML attrs.
  return `mailto:${encodeURIComponent(email).replace(/'/g, "%27")}`;
}
const htmlDocument = (content) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SEND Navigate</title></head><body style="font-family:Arial,sans-serif;color:#1e3a5f;line-height:1.6"><h1>SEND Navigate</h1>${content}</body></html>`;
const SAMPLE_LINKS = Object.freeze([
  ["Module 1 slide deck excerpt", "https://sendnavigate.org/sample_module1_slides.pdf"],
  ["Facilitator guide introduction", "https://sendnavigate.org/sample_facilitator_guide.pdf"],
  ["EEF Five-a-Day mapping overview", "https://sendnavigate.org/sample_eef_mapping.pdf"],
]);
const ACK_TEXT = Object.freeze({
  "sample-request": "Thank you for requesting the school sample pack. The three download links are below; these are links, not email attachments.",
  "advisory-enquiry": "Thank you for your enquiry. This automated acknowledgement confirms receipt, not that Stephen has read your message, a booked appointment, paid engagement or advice. Stephen will review the enquiry. Please do not send sensitive documents or a full case bundle. Sending an enquiry does not pause deadlines or appoint Stephen to manage your case. Do not wait for a reply if you need urgent help or have a deadline.",
  "ask-expert": "Thank you for your general question. This automated acknowledgement confirms receipt, not a promised answer or response time. Stephen will review whether the question fits the general-question service and his available capacity. Please do not send documents or identifying details. This is not a booking, payment or appointment to manage your case or deadlines. Do not wait for a reply if a deadline or urgent issue needs attention.",
});
const OWNER_SUBJECTS = Object.freeze({
  "sample-request": "New school sample request — SEND Navigate",
  "advisory-enquiry": "New advisory enquiry — SEND Navigate",
  "ask-expert": "New Ask an Expert enquiry — SEND Navigate",
});
const ACK_SUBJECTS = Object.freeze({
  "sample-request": "Your school sample pack links — SEND Navigate",
  "advisory-enquiry": "Your enquiry has been received — SEND Navigate",
  "ask-expert": "Your general question has been received — SEND Navigate",
});

export function buildMessages(submission) {
  const { formName, email, rows } = submission;
  const ownerIntro = "Private enquiry notification. Review and triage manually; this notification is not advice or proof of a personal reply.";
  const owner = {
    from: FROM, to: [OWNER], reply_to: email, subject: OWNER_SUBJECTS[formName],
    text: `${ownerIntro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n\n")}`,
    html: htmlDocument(`<p>${ownerIntro}</p><dl>${rows.map(([label, value]) =>
      `<dt><strong>${escapeHtml(label)}</strong></dt><dd style="white-space:pre-wrap">${escapeHtml(value)}</dd>`).join("")}</dl><p><a href="${escapeHtml(mailtoHref(email))}">Reply privately to the enquirer</a></p>`),
  };
  const ackText = ACK_TEXT[formName];
  const links = formName === "sample-request" ? SAMPLE_LINKS : [];
  const footer = "SEND Navigate\nThis is a transactional acknowledgement, not a marketing subscription.";
  const ack = {
    from: FROM, to: [email], reply_to: OWNER, subject: ACK_SUBJECTS[formName],
    text: `${ackText}${links.length ? "\n\n" + links.map(([label, url]) => `${label}: ${url}`).join("\n") : ""}\n\n${footer}`,
    html: htmlDocument(`<p>${ackText}</p>${links.length ? `<ul>${links.map(([label, url]) => `<li><a href="${url}">${label}</a></li>`).join("")}</ul>` : ""}<p>SEND Navigate</p><p>This is a transactional acknowledgement, not a marketing subscription.</p>`),
  };
  return { owner, ack };
}

export function idempotencyKey(submission, purpose) {
  if (!["owner", "ack"].includes(purpose)) throw new Error("Invalid delivery purpose");
  const digest = createHash("sha256").update(`${SITE_ID}:${submission.formId}:${submission.id}:${purpose}`).digest("hex");
  return `sendnavigate/form-mail/v1/${purpose}/${digest}`;
}

async function sendEmail(message, key, { apiKey, fetchImpl, sleep }) {
  const body = JSON.stringify(message); // Immutable body across retries.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let retry = false;
    try {
      const response = await fetchImpl(EMAIL_ENDPOINT, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
        body,
      });
      if (response.ok) { await response.body?.cancel(); return; }
      retry = response.status === 429 || response.status >= 500;
      if (response.status === 409) {
        // Only the documented concurrent-idempotency conflict is retryable.
        // Never log/throw the provider body, message or interpolated error.
        try { retry = (await response.json()).name === "concurrent_idempotent_requests"; }
        catch { retry = false; }
      } else { await response.body?.cancel(); }
    } catch { retry = true; /* network/timeout: same idempotency key and body */ }
    if (!retry || attempt === MAX_ATTEMPTS - 1) throw new Error("Transactional mail delivery failed");
    await sleep(500 * (2 ** attempt));
  }
}

/** INTERNAL ONLY: invoked through submission-created after Netlify's JWS check.
 * Direct local invocation is a test seam, NOT a signature verifier or HTTP API.
 */
export async function processSubmissionRequest(request, {
  getEnv = runtimeEnv, now = Date.now, fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  logger = console,
} = {}) {
  if (request.method !== "POST") return new Response(null, { status: 204 });
  let submission;
  try {
    if (request.headers.has("content-length") && Number(request.headers.get("content-length")) > MAX_EVENT_BYTES)
      reject("rejected_envelope");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_EVENT_BYTES) reject("rejected_envelope");
    let envelope;
    try { envelope = JSON.parse(raw); } catch { reject("rejected_envelope"); }
    submission = validateSubmission(envelope, { getEnv, now });
  } catch (error) {
    stageLog(logger, error instanceof Rejected ? error.stage : "rejected_internal");
    return new Response(null, { status: 204 });
  }
  // This fixed stage is diagnostic only: not durable/deduplicated acceptance
  // accounting and not a GA4 conversion, delivered answer or paid engagement.
  stageLog(logger, "validated");
  let apiKey;
  try { apiKey = getEnv("RESEND_API_KEY"); } catch { /* fail closed */ }
  if (typeof apiKey !== "string" || !apiKey || apiKey.length > 300 || SINGLE_CONTROL.test(apiKey)) {
    stageLog(logger, "configuration_missing");
    return new Response(null, { status: 503 });
  }
  const messages = buildMessages(submission);
  // Native Netlify owner notifications are the primary, independently managed
  // alert path. Avoid duplicate owner emails unless the fallback is explicitly
  // enabled after inventorying native notifications. Default is FALSE.
  let ownerAlertEnabled = false;
  try { ownerAlertEnabled = getEnv("FORM_OWNER_ALERT_ENABLED") === "true"; } catch { /* default off */ }
  const purposes = ownerAlertEnabled ? ["owner", "ack"] : ["ack"];
  if (!ownerAlertEnabled) stageLog(logger, "owner_custom_disabled");
  const outcomes = await Promise.allSettled(purposes.map((purpose) =>
    sendEmail(messages[purpose], idempotencyKey(submission, purpose), { apiKey, fetchImpl, sleep })));
  outcomes.forEach((outcome, index) => stageLog(logger,
    `${purposes[index]}_${outcome.status === "fulfilled" ? "provider_accepted" : "failed"}`));
  // Resend acceptance is not inbox delivery or personal receipt. Returning a
  // fixed failure allows platform/operator recovery within the idempotency window.
  return new Response(null, { status: outcomes.every((result) => result.status === "fulfilled") ? 204 : 503 });
}

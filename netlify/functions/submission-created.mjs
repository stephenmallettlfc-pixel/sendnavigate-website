/**
 * SECURITY BOUNDARY: exact Netlify legacy event filename, not a custom HTTP route.
 * Netlify verifies its event JWS BEFORE invoking this function. Do not rename this
 * to a generic webhook, add a custom path, or call it from browser form JavaScript.
 * https://docs.netlify.com/build/functions/trigger-on-events/
 * The documented typed FormSubmittedEvent only exposes data; the supported legacy
 * envelope retains top-level registered form_id and submission id metadata.
 */
import { processSubmissionRequest } from "./_lib/form-mail.mjs";

export default async (request) => processSubmissionRequest(request);

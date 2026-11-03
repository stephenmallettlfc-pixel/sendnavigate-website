/**
 * Retired HTTP webhook endpoint. Never parse submissions or send email here.
 * Only the platform-JWS-verified submission-created event function may send.
 * Retain this harmless 204 endpoint while old webhook registrations are inventoried.
 */
export default async () => new Response(null, { status: 204 });

export const config = {
  path: "/.netlify/functions/form-submission",
};

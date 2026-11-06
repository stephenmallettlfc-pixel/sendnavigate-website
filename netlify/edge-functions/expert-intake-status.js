export default function expertIntakeStatus() {
  let paused = false;
  try { paused = globalThis.Netlify?.env?.get('ASK_EXPERT_INTAKE_PAUSED') === 'true'; } catch { /* optional flag defaults open */ }
  return new Response(JSON.stringify({ open: !paused }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' },
  });
}
// The deployed Edge manifest accepts GET but not an explicit HEAD enum.
export const config = { path: '/expert-intake-status', method: 'GET', onError: 'fail' };

/**
 * A ceiling on how often one caller may spend money.
 *
 * `/api/writing`, `/api/tutor` and `/api/placement` each turn one POST into an Opus
 * call, and none of them is authenticated — `lib/progress-client.ts` shows what this
 * app has instead of accounts, and it is a device id the browser invents for itself,
 * which is no obstacle at all to a script that generates a new one per request. So the
 * only thing between a copy-pasted loop and an unbounded bill is how often one caller
 * is answered.
 *
 * `ponytail: in-memory, per process instance, fixed window. That is the ceiling and it
 * is the real one — N serverless instances admit N x the limit, and a cold start
 * resets every window, so this bounds a casual loop and a scrape against one warm
 * instance, not a determined attacker. The upgrade when the bill ever moves is a shared
 * counter (a Redis `INCR` with `EXPIRE`) behind the same call, which is why this module
 * exports the whole decision — the status code, the header and the body — and not the
 * arithmetic, so nothing above it has to change shape when the arithmetic does.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Above this many tracked callers, the expired ones are swept.
 *
 * A fixed window cannot leak a *timer*, but it can leak *entries*: nothing else in
 * these routes ages a key out, so a server that has seen a million addresses would
 * hold a million of them. Sweeping on the way past the bound is enough, because
 * expired windows are the only thing that grows the map — the live ones are capped by
 * how many distinct callers exist inside one window, which is the number that was
 * always the point.
 */
const MAX_TRACKED = 10_000;

/** Twenty a minute: an order of magnitude above a person sending messages. */
export const AI_CALL_LIMIT = 20;
export const AI_CALL_WINDOW_MS = 60_000;

/**
 * Who this is, as far as the edge can tell us — or `null` when it cannot.
 *
 * `x-forwarded-for` is a list, and the first entry is the original client: the later
 * ones were appended by each proxy the request crossed, so the last is usually this
 * app's own host. `x-real-ip` covers a host that sets only that.
 *
 * `null` means the request is *answered* rather than limited, which is the opposite of
 * the usual instinct and is deliberate. Behind any real proxy one of these headers is
 * always present, so `null` is either local development — one learner, who should not
 * be locked out of their own app by strangers' traffic — or someone already talking to
 * the origin directly. Keying those on one shared bucket would hand the first such
 * caller a switch that locks out everyone else behind the same missing header.
 */
export function callerKey(request: Request): string | null {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first) return first;
  return request.headers.get('x-real-ip')?.trim() || null;
}

/**
 * The refusal, or `null` when this caller is still inside its window.
 *
 * Null rather than a boolean, so that every route's guard is the same two lines and
 * the status code, the `Retry-After` header and the body all come from one place that
 * cannot drift out of agreement with itself.
 *
 * The window is counted before it is judged, so the request that crosses the limit is
 * the one refused and the count never sits one behind the answer.
 */
export function rateLimited(
  request: Request,
  limit: number = AI_CALL_LIMIT,
  windowMs: number = AI_CALL_WINDOW_MS,
): Response | null {
  const key = callerKey(request);
  if (key === null) return null;

  const now = Date.now();
  const open = windows.get(key);
  const current =
    open === undefined || now >= open.resetAt ? { count: 0, resetAt: now + windowMs } : open;
  current.count += 1;
  windows.set(key, current);

  if (windows.size > MAX_TRACKED) {
    for (const [seen, window] of windows) {
      if (window.resetAt <= now) windows.delete(seen);
    }
  }

  if (current.count <= limit) return null;

  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))),
    },
  });
}

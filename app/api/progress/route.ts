import { isValidDeviceId, parseProgressBody } from '../../../lib/progress-schema';
import { progressStore } from '../../../lib/progress-store';

/**
 * Auth-less progress sync.
 *
 *   GET    /api/progress?deviceId=<id>                    -> 200 { record } | 400 | 404
 *   PUT    /api/progress  { deviceId, stats, version? }   -> 200 { record } | 400 | 415
 *   DELETE /api/progress?deviceId=<id>                    -> 204 | 400 | 404
 *
 * Route Handlers are uncached by default and every handler below reads the request,
 * so no `dynamic` export is needed (see next/dist/docs route-handlers.md).
 */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    // Per-device private data: never let a shared cache hold on to it.
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function readDeviceId(request: Request): string | null {
  const value = new URL(request.url).searchParams.get('deviceId');
  return isValidDeviceId(value) ? value : null;
}

export async function GET(request: Request) {
  const deviceId = readDeviceId(request);
  if (!deviceId) {
    return json({ error: 'invalid_device_id' }, 400);
  }

  const record = await progressStore.get(deviceId);
  if (!record) return json({ error: 'not_found' }, 404);

  return json({ record }, 200);
}

export async function PUT(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON is the client's fault, not a server error.
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseProgressBody(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_payload', issues: parsed.issues }, 400);
  }

  const record = await progressStore.put(parsed.value);
  return json({ record }, 200);
}

export async function DELETE(request: Request) {
  const deviceId = readDeviceId(request);
  if (!deviceId) {
    return json({ error: 'invalid_device_id' }, 400);
  }

  const removed = await progressStore.remove(deviceId);
  if (!removed) return json({ error: 'not_found' }, 404);

  return new Response(null, { status: 204 });
}

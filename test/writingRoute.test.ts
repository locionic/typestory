import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/writing/route';
import { AiRefusalError, createModelClient, isAiConfigured } from '../lib/ai';
import { MAX_TEXT_CHARS, MIN_TEXT_CHARS } from '../lib/writing';

// lib/ai is mocked at the module boundary, so the Anthropic SDK is never loaded
// and this suite needs no API key and makes no network call.
vi.mock('../lib/ai', () => ({
  AiRefusalError: class AiRefusalError extends Error {},
  isAiConfigured: vi.fn(() => false),
  createModelClient: vi.fn(),
}));

const BASE = 'http://localhost:3000/api/writing';
const TEXT = 'Yesterday I go to the market with my sister and we come back very late.';

const post = (payload: unknown, contentType = 'application/json') =>
  POST(
    new Request(BASE, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  );

const validReport = {
  summary: 'Third person -s is the habit to build here.',
  corrected: 'Yesterday I went to the market with my sister, and we came back very late.',
  improvements: [{ original: 'I go', corrected: 'I went', note: 'Past tense needs -ed.' }],
};

const mockModel = (output: unknown) => {
  const generate = vi.fn().mockResolvedValue(output);
  vi.mocked(createModelClient).mockReturnValue({ generate });
  return generate;
};

beforeEach(() => {
  vi.mocked(isAiConfigured).mockReturnValue(false);
  vi.mocked(createModelClient).mockReset();
});

describe('GET /api/writing', () => {
  it('serves the caps so the page does not have to import them', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as { minTextChars: number; maxTextChars: number };
    expect(body.minTextChars).toBe(MIN_TEXT_CHARS);
    expect(body.maxTextChars).toBe(MAX_TEXT_CHARS);
  });

  it('keeps the system prompt out of the response', async () => {
    expect(await (await GET()).text()).not.toContain('JSON object');
  });
});

describe('POST /api/writing', () => {
  it('returns a validated report when a model is available', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    mockModel(validReport);

    const response = await post({ text: TEXT });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { report: typeof validReport };
    expect(body.report).toEqual(validReport);
  });

  it('asks for the depth prose feedback needs, not the placement setting', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    const generate = mockModel(validReport);

    await post({ text: TEXT });

    const [request] = generate.mock.calls[0] as [{ effort: string; maxTokens: number }];
    expect(request.effort).toBe('high');
    expect(request.maxTokens).toBeGreaterThan(2000);
  });

  it('fences the submission and keeps the prompt out of the user turn', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    const generate = mockModel(validReport);

    await post({ text: TEXT });

    const [request] = generate.mock.calls[0] as [{ system: string; user: string }];
    expect(request.system).toContain('JSON object');
    expect(request.system).not.toContain(TEXT);
    expect(request.user).toContain(`<learner_text>\n${TEXT}\n</learner_text>`);
  });

  it('explains a missing key instead of failing', async () => {
    const response = await post({ text: TEXT });
    expect(response.status).toBe(503);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ai_not_configured');
    expect(createModelClient).not.toHaveBeenCalled();
  });

  it('refuses a text too short to correct without calling a model at all', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    mockModel(validReport);

    const response = await post({ text: 'hi' });
    expect(response.status).toBe(400);
    expect(createModelClient).not.toHaveBeenCalled();
  });

  it('refuses a non-JSON content type', async () => {
    expect((await post({ text: TEXT }, 'text/plain')).status).toBe(415);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await post('{not json')).status).toBe(400);
  });

  it('refuses a payload with no text', async () => {
    expect((await post({})).status).toBe(400);
  });

  it('rejects unusable model output rather than passing it to the page', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    mockModel({ summary: 'ok', improvements: [] });

    const response = await post({ text: TEXT });
    expect(response.status).toBe(502);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_model_output');
  });

  it('reports a refusal as its own code, not a generic outage', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new AiRefusalError('declined')),
    });

    const response = await post({ text: TEXT });
    expect(response.status).toBe(502);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ai_refusal');
  });

  it('never leaks the model error text to the client', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new Error('ANTHROPIC_API_KEY=sk-secret exploded')),
    });

    const body = await (await post({ text: TEXT })).text();
    expect(body).toContain('ai_unavailable');
    expect(body).not.toContain('sk-secret');
  });
});

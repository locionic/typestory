import { describe, expect, it } from 'vitest';
import { trimHistory } from '../app/tutor/page';
import { MAX_TURNS, parseTutorRequest, type TutorMessage } from '../lib/tutor';

/** `n` complete user→assistant pairs, as the page accumulates them. */
const pairs = (n: number): TutorMessage[] =>
  Array.from({ length: n }, (_, i) => [
    { role: 'user' as const, content: `q${i}` },
    { role: 'assistant' as const, content: `a${i}` },
  ]).flat();

/**
 * Regression: the page posted the whole transcript on every question and the server
 * caps it at twelve turns. Since the transcript gains a pair per question, the eighth
 * question carried fourteen turns and was rejected — and because the failure path rolls
 * the transcript back to exactly what it was, every question after it carried the same
 * fourteen and was rejected identically. One ordinary tutoring session, and the tutor was
 * dead for the rest of it, with "try a shorter one" offered for a ten-character message.
 *
 * Driven through the real `parseTutorRequest` rather than against `MAX_TURNS` directly, so
 * the test asserts the thing that actually broke: the server accepting the request.
 */
describe('a conversation that outgrows the turn cap', () => {
  it('keeps every question postable, for as long as the learner keeps asking', () => {
    let transcript: TutorMessage[] = [];
    const rejected: number[] = [];
    let lastPosted: TutorMessage[] = [];

    for (let q = 1; q <= 40; q++) {
      const soFar = transcript;
      const history = trimHistory(soFar, MAX_TURNS);
      lastPosted = history;

      const posted = parseTutorRequest({ history, message: `question ${q}` });
      if (!posted.ok) rejected.push(q);

      transcript = [...soFar, { role: 'user', content: `question ${q}` }, { role: 'assistant', content: `answer ${q}` }];
    }

    expect(rejected).toEqual([]);
    // The wire copy is trimmed; the learner's own record of the conversation is not.
    // A forty-question session kept all eighty turns on screen.
    expect(lastPosted).toHaveLength(MAX_TURNS);
    expect(transcript).toHaveLength(80);
  });

  it('drops whole pairs, so what is sent opens on a user turn and stays even', () => {
    const turns = pairs(9);

    const trimmed = trimHistory(turns, MAX_TURNS);

    expect(trimmed).toHaveLength(12);
    // `parseTutorRequest` rejects a history that opens on an assistant turn, so a slice
    // taken from the wrong offset would trade one 400 for another.
    expect(trimmed[0]).toEqual({ role: 'user', content: 'q3' });
    expect(trimmed.every((turn, i) => turn.role === (i % 2 === 0 ? 'user' : 'assistant'))).toBe(true);
  });

  it('sends the whole conversation while it still fits', () => {
    const turns = pairs(5);

    expect(trimHistory(turns, MAX_TURNS)).toBe(turns);
  });

  it('rounds an odd cap down rather than splitting a pair', () => {
    expect(trimHistory(pairs(8), 7)).toHaveLength(6);
  });

  it('leaves the transcript it was given alone', () => {
    const turns = pairs(9);

    trimHistory(turns, MAX_TURNS);

    expect(turns).toHaveLength(18);
  });
});
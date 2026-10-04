import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Engine = typeof import('../lib/audio')['soundEngine'];
type SoundType = import('../lib/types').SwitchSound;

let engine: Engine;

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeOscillator {
  type = '';
  frequency = new FakeParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  currentTime = 0;
  destination = {} as unknown as AudioNode;
  oscillators: FakeOscillator[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  createGain() {
    return new FakeGain();
  }

  resume() {
    return Promise.resolve();
  }
}

/** Browsers that block Web Audio (Brave, hardened Chromium) throw on graph construction. */
class BlockedAudioContext extends FakeAudioContext {
  createOscillator(): never {
    throw new DOMException('Audio blocked by policy', 'NotAllowedError');
  }
}

/**
 * A browser that has no audio context to be had, rather than one that refuses to make sound.
 *
 * The distinction is the whole of this fake. `BlockedAudioContext` throws from
 * `createOscillator`, which both entry points call *inside* the `try` that wraps their graph,
 * so it is swallowed — and it is exactly the case that swallowing is for. This one throws from
 * the constructor, which both entry points call before reaching any `try`, so it was not
 * covered by anything.
 *
 * The cost was not a silent sound. `store/useTypingStore.ts` calls `playKeyClick` from
 * `handleKeyInput` with no guard of its own, so the exception unwound out of a keystroke
 * before the character was compared and recorded — the learner's key did nothing. It threw
 * again on the next one and the next, so the board was dead for the rest of the session, with
 * nothing on screen saying so: the run looked live and recorded nothing.
 */
class UnconstructableAudioContext extends FakeAudioContext {
  constructor() {
    super();
    throw new DOMException('No audio device available', 'NotSupportedError');
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  constructor(public text: string) {}
}

const install = (impl: unknown) => {
  (window as unknown as { AudioContext: unknown }).AudioContext = impl;
};

const unmock = () => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
};

beforeEach(async () => {
  // soundEngine caches its AudioContext privately, so reset modules for a clean instance.
  vi.resetModules();
  engine = (await import('../lib/audio')).soundEngine;
  FakeAudioContext.instances = [];
  install(FakeAudioContext);
});

afterEach(() => {
  unmock();
});

describe('switch sound selection', () => {
  it('defaults to a blue switch', () => {
    expect(engine.getSoundType()).toBe('blue');
  });

  it('round-trips every switch type', () => {
    const sounds: SoundType[] = ['blue', 'brown', 'bubble', 'mute'];
    for (const sound of sounds) {
      engine.setSoundType(sound);
      expect(engine.getSoundType()).toBe(sound);
    }
  });
});

describe('key click synthesis', () => {
  it('opens one context and plays one click per keystroke', () => {
    engine.playKeyClick();
    engine.playKeyClick();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(2);
  });

  it('uses a triangle wave for the clicky blue switch', () => {
    engine.setSoundType('blue');
    engine.playKeyClick();
    expect(FakeAudioContext.instances[0].oscillators[0].type).toBe('triangle');
  });

  it('uses a sine wave for the deep tactile brown switch', () => {
    engine.setSoundType('brown');
    engine.playKeyClick();
    expect(FakeAudioContext.instances[0].oscillators[0].type).toBe('sine');
  });

  it('schedules the oscillator to stop so nothing drones', () => {
    engine.playKeyClick();
    expect(FakeAudioContext.instances[0].oscillators[0].stop).toHaveBeenCalled();
  });
});

describe('mute', () => {
  it('suppresses key clicks without opening an audio context', () => {
    engine.setSoundType('mute');
    engine.playKeyClick();
    engine.playKeyClick();
    engine.playKeyClick();

    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  /**
   * The completion chime, which used to be exempt.
   *
   * This asymmetry was pinned on purpose as "a behaviour choice, not an oversight", and
   * the reasoning was that a lesson-ender is worth hearing even over a muted keyboard.
   * But the option is labelled "Mute" and nothing else, so the promise it makes is not
   * "quiet keys" — it is silence. And the reason the setting is worth having at all is
   * named three files away, in the store: "someone practising in a library or on a
   * train". A four-note arpeggio on a train is the one that gets you looked at.
   *
   * What the exemption costs is nothing. Finishing a passage already puts a card on
   * screen with the WPM, accuracy and time, so the chime is a second signal for an event
   * that already has a first one — it was redundancy, and redundancy is what a mute
   * button is for.
   *
   * The check is on the context, not the oscillators, to match the test above: the point
   * is that nothing is built at all.
   */
  it('suppresses the completion chime as well', () => {
    engine.setSoundType('mute');
    engine.playSuccessChime();

    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});

describe('success chime', () => {
  it('plays a four note arpeggio', () => {
    engine.playSuccessChime();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(4);
  });
});

describe('hostile audio environments', () => {
  it('stays silent when the browser has no Web Audio API', () => {
    unmock();
    expect(() => engine.playKeyClick()).not.toThrow();
    expect(() => engine.playSuccessChime()).not.toThrow();
  });

  it('swallows the error when the browser blocks audio', () => {
    install(BlockedAudioContext);
    expect(() => engine.playKeyClick()).not.toThrow();
    expect(() => engine.playSuccessChime()).not.toThrow();
  });

  /**
   * The control for the two above, and the reason they are two tests. All three describe a
   * browser that will not make a sound; only this one has no audio to make one with. Every
   * one of them answers the same question, so a single "stays silent" test would pass against
   * an engine that threw on construction for the rest of the session.
   */
  it('stays silent when there is no audio context to be had at all', () => {
    install(UnconstructableAudioContext);
    expect(() => engine.playKeyClick()).not.toThrow();
    expect(() => engine.playSuccessChime()).not.toThrow();
  });

  /**
   * And it has to stay silent *permanently* — the failure must not latch.
   *
   * A `try` that assigned `null` to the cached context, or that set a "broken" flag the next
   * call read, would silence every click from here on in even after the browser recovered. The
   * counter is what says the engine kept asking: two calls, two attempts to construct.
   */
  it('keeps asking, so a context that becomes available later still plays', () => {
    let attempts = 0;
    install(
      class extends FakeAudioContext {
        constructor() {
          super();
          attempts++;
          if (attempts === 1) throw new DOMException('Not yet', 'NotSupportedError');
        }
      },
    );

    expect(() => engine.playKeyClick()).not.toThrow();
    expect(() => engine.playKeyClick()).not.toThrow();

    expect(attempts).toBe(2);
    expect(FakeAudioContext.instances.length).toBeGreaterThan(0);
  });

  it('falls back to webkitAudioContext when the standard name is missing', () => {
    unmock();
    install(undefined);
    (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = FakeAudioContext;

    engine.playKeyClick();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});

describe('speech synthesis', () => {
  const installSpeech = (
    voices: { lang: string }[] | (() => { lang: string }[]) = [{ lang: 'en-GB' }],
  ) => {
    const list = typeof voices === 'function' ? voices : () => voices;
    const api = {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: vi.fn(list),
    };
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = api;
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      FakeUtterance;
    return api;
  };

  it('ignores speech requests when synthesis is unavailable', () => {
    unmock();
    expect(() => engine.speak('hello world')).not.toThrow();
  });

  it('speaks the passage at a measured learning rate', () => {
    const api = installSpeech();
    engine.speak('Q: What is a vector index?');

    expect(api.cancel).toHaveBeenCalled();
    expect(api.speak).toHaveBeenCalledTimes(1);
    const utterance = api.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe('Q: What is a vector index?');
    expect(utterance.lang).toBe('en-US');
    expect(utterance.rate).toBeLessThan(1);
  });

  it('prefers a voice matching the requested locale', () => {
    const api = installSpeech([{ lang: 'vi-VN' }, { lang: 'en-GB' }]);
    engine.speak('hello', 'en-GB');

    const utterance = api.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.voice).toEqual({ lang: 'en-GB' });
  });

  /**
   * Regression: the match was `locale || lang`, evaluated per voice in list order.
   * `Array.find` short-circuits, so the *first* English voice won even when an exact
   * locale match sat further down the list. Anyone whose en-AU voice is registered
   * before their en-US one got an Australian accent from a lesson tuned to US
   * English — and `rate: 0.95` is a teaching setting, so the pronunciation model
   * matters. Locale has to win outright, with the language-wide match only as a
   * fallback for when no exact voice exists.
   */
  it('takes an exact locale match over an earlier looser one', () => {
    const api = installSpeech([{ lang: 'en-AU' }, { lang: 'en-US' }]);
    engine.speak('hello');

    const utterance = api.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.voice).toEqual({ lang: 'en-US' });
  });

  it('falls back to any English voice only when the locale is missing', () => {
    const api = installSpeech([{ lang: 'en-AU' }]);
    engine.speak('hello');

    const utterance = api.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.voice).toEqual({ lang: 'en-AU' });
  });

  /**
   * `getVoices()` returns [] until the browser has finished loading its voice list.
   * Reading it once and caching that is what would pin a whole session to the
   * browser default, so the list is read per utterance and the voice settles on its
   * own as soon as the browser has it.
   */
  it('picks up a voice that only appears after the first utterance', () => {
    let voices: { lang: string }[] = [];
    // Passed as a thunk, not a list: the browser has not loaded its voices yet, and
    // the point of the test is that the *same* array is filled in later.
    const api = installSpeech(() => voices);

    engine.speak('first');
    const first = api.speak.mock.calls[0][0] as FakeUtterance;
    // The real API leaves `voice` null when none was chosen.
    expect(first.voice).toBeFalsy();

    voices = [{ lang: 'en-US' }];
    engine.speak('second');
    const second = api.speak.mock.calls[1][0] as FakeUtterance;
    expect(second.voice).toEqual({ lang: 'en-US' });
  });

  it('cancels the previous utterance so passages do not queue up', () => {
    const api = installSpeech();
    engine.speak('first');
    engine.speak('second');
    expect(api.cancel).toHaveBeenCalledTimes(2);
  });
});
/**
 * The surfaces the wordmark claims, held to the code.
 *
 * "Type & Speak English" is rendered by the Navbar on all ten routes and by the social card
 * on every shared link, and `lib/site.ts` is the one place that has to answer whether that is
 * backed. Its answer is a list of surfaces — and that list had the tutor on it, a page that
 * reaches `soundEngine` nowhere at all. Nothing caught it, because the speech engine above is
 * pinned thoroughly and *no control reaching it was pinned at all*: delete the Listen button
 * from the board and this suite stayed green over a promise nothing kept.
 *
 * So this is the check that closes it, and it asserts the exact set rather than a count — a
 * fourth surface has to be added here deliberately, and one that goes away is noticed. The
 * three are the vocabulary drill, the story glossary and the board's Listen button, which is
 * what `lib/site.ts` now says.
 *
 * Matched on the whole call, not on the word "speak", which also turns up in prose — "a
 * fluent speaker" on /writing, "a status region only speaks" on the board — so this needs no
 * comment stripper to tell code from English the way `test/shareMetadata.test.ts` does.
 */
describe('the surfaces the wordmark claims', () => {
  it('are exactly the ones that reach soundEngine.speak', () => {
    const callers: string[] = [];

    for (const dir of ['app', 'components']) {
      for (const entry of readdirSync(join(process.cwd(), dir), {
        recursive: true,
        encoding: 'utf8',
      })) {
        if (!/\.tsx?$/.test(entry)) continue;
        const path = `${dir}/${entry}`;
        if (readFileSync(join(process.cwd(), path), 'utf8').includes('soundEngine.speak(')) {
          callers.push(path);
        }
      }
    }

    expect(callers.sort()).toEqual([
      'app/vocab/page.tsx',
      'components/typing/StoryReader.tsx',
      'components/typing/TypingEngine.tsx',
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  // Asymmetry pinned on purpose: playKeyClick guards on 'mute' (lib/audio.ts:31) but
  // playSuccessChime does not, so the completion reward still plays. Flip this test
  // if the product decision changes — it is a behaviour choice, not an oversight.
  it('still plays the completion chime', () => {
    engine.setSoundType('mute');
    engine.playSuccessChime();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(4);
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
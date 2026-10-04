/**
 * jsdom implements no media queries at all, and `window.matchMedia` is simply absent.
 *
 * TypingEngine asks it whether the learner has asked for reduced motion before firing 80
 * confetti particles, so every test that completed a run — three files, ten assertions —
 * was throwing `window.matchMedia is not a function` at the point of celebration. The stub
 * goes here rather than into each of those files because every browser has `matchMedia`
 * and jsdom is the only place it is missing: the gap belongs to the environment, so the
 * environment fills it, and a test written after this one gets it for free.
 *
 * It answers `false` to everything. Tests that need a specific answer say so with
 * `vi.stubGlobal('matchMedia', …)`, which this restores on unstub.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

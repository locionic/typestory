import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VOCAB_BANKS } from '../../data/vocab';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const findChrome = () => CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

/** Ask the OS for an unused port so a busy 3000 never breaks the run. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });

const waitForServer = async (url: string, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`Server never became ready at ${url}. Run \`npm run build\` first.`);
    }
    await sleep(250);
  }
};

/**
 * The typing board is the element with the most direct <span> children — the stats
 * header has one, the character board has one per character. Spaces render as  .
 */
const readTargetText = (page: Page) =>
  page.evaluate(() => {
    const board = Array.from(document.querySelectorAll('div'))
      .map((el) => ({ el, spans: el.querySelectorAll(':scope > span').length }))
      .filter((candidate) => candidate.spans > 5)
      .sort((a, b) => b.spans - a.spans)[0]?.el;
    if (!board) return '';
    return Array.from(board.children)
      .map((span) => (span.textContent === ' ' ? ' ' : span.textContent))
      .join('');
  });

/**
 * The typing engine attaches its keydown listener in a React effect, so keystrokes
 * fired before hydration land nowhere and the passage silently never completes.
 * Poll until a keystroke actually sticks rather than racing hydration with a sleep.
 */
const waitForTypingEngine = async (page: Page) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    await page.keyboard.press('Backspace');
    await page.keyboard.type('q');
    const caret = await page.evaluate(() => {
      const board = Array.from(document.querySelectorAll('div'))
        .map((el) => ({ el, spans: el.querySelectorAll(':scope > span').length }))
        .filter((candidate) => candidate.spans > 5)
        .sort((a, b) => b.spans - a.spans)[0]?.el;
      if (!board) return -1;
      // The engine renders the caret as a pulsing child of the current-character span.
      return Array.from(board.children).findIndex((s) => s.querySelector('.animate-pulse'));
    });
    if (caret > 0) {
      // Escape, not Backspace: only a reset clears the probe's keystrokes, and a
      // stray wrong character would otherwise cost the run an accuracy point.
      await page.keyboard.press('Escape');
      return;
    }
    await sleep(50);
  }
  throw new Error('The typing engine never accepted a keystroke.');
};

/** Click a <button> whose visible text contains `label`. */
const clickButton = async (page: Page, label: string) => {
  const handle = await page.evaluateHandle((text) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((b) => b.textContent?.includes(text)) ?? null;
  }, label);
  const element = handle.asElement() as ElementHandle<Element> | null;
  if (!element) throw new Error(`no button containing "${label}"`);
  await element.click();
};

const openStats = async (page: Page) => {
  await page.click('button[title="View your learning progress and statistics"]');
  await page.waitForFunction(
    () => document.body.innerText.includes('Typing & Learning Analytics'),
    { timeout: 10_000 },
  );
};

/** Type the passage to completion so the device holds a session worth backing up. */
const completePassage = async (page: Page) => {
  await waitForTypingEngine(page);

  let targetText = '';
  for (let attempt = 0; attempt < 40 && !targetText; attempt++) {
    targetText = await readTargetText(page);
    if (!targetText) await sleep(100);
  }
  expect(targetText.length).toBeGreaterThan(50);

  await page.keyboard.type(targetText, { delay: 0 });
  await page.waitForFunction(() => document.body.innerText.includes('Passage Completed'), {
    timeout: 30_000,
  });
};

let server: ChildProcess | undefined;
let browser: Browser | undefined;
let baseUrl = '';
let dataDir = '';

/**
 * Everything the browser complained about, for the guard at the bottom of this file.
 *
 * The suite asserted only what it could read off the page, so a hydration mismatch or a
 * runtime error anywhere underneath a journey passed all thirteen — the app would have
 * been broken in a way no test could see, which is the failure mode most worth catching
 * in an app whose whole subject is a keystroke at a time.
 *
 * The URL is kept because the journeys that fail on purpose fail *visibly*: a fetch
 * answered with a 502 leaves Chrome's "Failed to load resource" in the console, and the
 * message alone says nothing about which endpoint it was. Paired with the status it is the
 * one entry that can be both provoked and recognised, which is what lets the other three
 * tolerated failures name a status each — see `EXPECTED_FAILURES`.
 */
const browserComplaints: { text: string; url: string }[] = [];

/**
 * Every failure this suite provokes on purpose, and the one status each may answer with.
 *
 * `/api/placement` is not here because it degrades: it answers 200 with the quiz result
 * and a failed writing outcome, so it produces no browser-level failure at all.
 *
 * Status is matched, not just the URL. A URL on this list that answered 500 instead would
 * be a real defect hiding behind a line written for a 404, and a filter that knew only the
 * URL could not tell those two apart.
 */
const EXPECTED_FAILURES: { url: string; status: number }[] = [
  // A device that has never saved anything. Documented at app/api/progress/route.ts:7 as
  // `200 { record } | 400 | 404` and handled by the client, so it is the ordinary state of
  // a first load rather than a failure at all — but only the 404 is expected here, and the
  // journeys that write progress still have to reach the same URL successfully.
  { url: '/api/progress', status: 404 },
  { url: '/api/writing', status: 502 },
  { url: '/api/tutor', status: 502 },
];

/** The status out of Chrome's `Failed to load resource: ... status of NNN (Not Found)`. */
const statusOf = (text: string): number | undefined => {
  const match = /status of (\d{3})/.exec(text);
  return match ? Number(match[1]) : undefined;
};

function watchPage(page: Page) {
  // `error` arrives as `unknown`, so the message is narrowed here rather than asserted:
  // the point of the collector is to report what went wrong, including when what went
  // wrong was not an `Error`.
  page.on('pageerror', (error: unknown) =>
    browserComplaints.push({
      text: `pageerror: ${error instanceof Error ? error.message : String(error)}`,
      url: '',
    }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserComplaints.push({ text: message.text(), url: message.location().url ?? '' });
    }
  });
}

/**
 * The only way this suite opens a page.
 *
 * This started as `browser.on('targetcreated', ...)`, which reads as the way to watch every
 * page without touching thirteen call sites. It is also a lost message: `target.page()` is
 * a promise, so the listeners attach a tick after the target exists, and the first page of
 * a run is exactly where that tick can land between navigation and a hydration error. The
 * same guard passed one run and failed the next with no code change in between, which is
 * the signature of a check whose result does not depend on what happened.
 *
 * Attaching before the page navigates is not worth being clever about.
 */
async function newPage(): Promise<Page> {
  const page = await browser!.newPage();
  watchPage(page);
  return page;
}

beforeAll(async () => {
  // Chrome is looked for *before* the server is booted. Every test skips without it, so
  // starting `next start` first meant a machine with no browser still waited out the 90s
  // server timeout and then threw "Server never became ready" — a hard failure for a run
  // that has nothing to run, on a machine that never needed `npm run build` anyway.
  const chrome = findChrome();
  if (!chrome) {
    // The skip below is deliberate — see why — but it has one consequence not worth
    // keeping: every test skips, the suite exits 0, and a green run then says nothing
    // about whether any journey works. Say so where someone will see it, because
    // failing is precisely what this branch exists to avoid.
    process.stderr.write(
      '\n  No Chrome found (looked in CHROME_PATH and the usual Linux/macOS paths).\n' +
        '  Every end-to-end journey will SKIP — this run verifies nothing.\n' +
        '  Set CHROME_PATH to a Chrome/Chromium binary to run them.\n\n',
    );
    return;
  }

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  // The server gets its own progress directory, or the run writes into the real one.
  // This suite's backup-and-restore journey drives /api/progress against a live server,
  // and lib/progress-store.ts falls back to `<cwd>/.data` — the same directory the
  // README names as the app's real, gitignored storage. Every `npm run test:e2e` was
  // leaving a record behind there, under a UUID nobody will ever use again: 33 of them
  // had piled up in the working tree. Both unit suites already redirect it to a temp
  // directory and assert nothing is created outside it; this one was simply missed.
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'typestory-e2e-'));

  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');

  // Build before starting, because `next start` serves whatever `.next` happens to
  // contain and this suite used to assume that was the current source. It is not:
  // after editing a page and running `npm run test:e2e`, the server came up on the
  // previous build and every journey passed against code that no longer existed. It
  // is not a hypothetical — it is how the vocabulary deep-link test below came to pass
  // against a reverted href, and how one unrelated journey flaked against a build from
  // two edits earlier. A green run has to mean the current tree, or it means nothing.
  //
  // `next build` rather than `next dev`, which would be a second, differently-behaving
  // server: these are production journeys, hydration is a real race here, and the
  // other 12 tests are all written against what a build produces.
  const build = spawn(process.execPath, [nextBin, 'build'], {
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production', TYPE_STORY_DATA_DIR: dataDir },
  });
  const buildExit = await new Promise<number>((resolve) =>
    build.on('exit', (code) => resolve(code ?? 1)),
  );
  if (buildExit !== 0) {
    throw new Error(`next build exited ${buildExit}; the journeys below would test nothing.`);
  }

  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    stdio: 'ignore',
    // ANTHROPIC_BASE_URL is pointed at a closed local port so the three AI journeys
    // below are hermetic. They assert that a feature which cannot reach the model
    // degrades and says so, and that used to be decided before the model was ever
    // called: the routes short-circuited on a missing ANTHROPIC_API_KEY. Now that the
    // short-circuit is gone — the SDK resolves an `ant auth login` credential chain
    // when the env var is absent, so refusing on its absence refused working machines —
    // those journeys would inherit whatever credential this machine happens to have.
    // A developer running them with a real key would get real answers, real failures, and
    // a bill; a 401 from the real API would work just as well but is a network round trip
    // per test. Port 1 is closed, so the connection is refused locally and instantly, and
    // the outcome is the same on a laptop with credentials and on a bare CI box.
  env: {
      ...process.env,
      NODE_ENV: 'production',
      TYPE_STORY_DATA_DIR: dataDir,
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
    },
  });
  await waitForServer(baseUrl);

  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
});

afterAll(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });

  /**
   * Measured, not assumed — and the measurement had to be an assertion to be worth
   * anything. A first attempt logged the complaints from this hook and reported zero,
   * which was false: vitest swallows `console.log` written from a hook like this one, so
   * the clean result and a collector that had never fired looked identical. The same
   * run that swallowed the log is what made a canary test necessary — with the log in
   * place there was no way to tell the two apart.
   *
   * The canary also corrected the substance: there is noise to filter after all. Chrome
   * logs "Failed to load resource" for the 502s those journeys provoke, so each tolerated
   * failure is matched on its URL *and* the status it is allowed to answer with, and
   * everything else fails the suite. A page's own `console.error` carries no such status
   * and no such URL, so it can never be absorbed by the filter.
   *
   * ponytail: this catches page errors and `console.error`. It does not see a resource
   * that failed to load without reaching a console message, and it does not see a
   * network failure the browser swallowed. Adding CDP `Log` capture would widen it, at
   * the cost of filtering Chrome's own request noise — worth it if a journey ever comes
   * to depend on a response status it does not read.
   */
  const unexpected = browserComplaints.filter(
    (complaint) =>
      !EXPECTED_FAILURES.some(
        (expected) =>
          complaint.url.includes(expected.url) && statusOf(complaint.text) === expected.status,
      ),
  );
  expect(
    unexpected,
    `The browser reported ${unexpected.length} unexpected problem(s).\n` +
      `All complaints:\n${browserComplaints.map((c) => `  [${c.url || 'no url'}] ${c.text}`).join('\n')}`,
  ).toEqual([]);
});

describe('the sound preference', () => {
  /**
   * Regression: the switch-sound <select> was the only control for the preference and
   * sat behind `hidden lg:flex`, so it did not exist on any screen under 1024px — the
   * phone this app's own header comment calls its primary device. Someone practising
   * in a library or on a train had no way to reach "Mute" at all.
   *
   * Also asserts the choice survives a reload, which it did not: nothing wrote the
   * value anywhere, so the store's 'blue' default came back on every visit.
   */
  it('can be muted on a phone, and stays muted', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      const select = 'select[aria-label="Select keyboard sound effect"]';
      expect(await page.waitForSelector(select, { timeout: 30_000 })).toBeTruthy();

      // `hidden` would still match a selector, so check it is actually rendered.
      expect(
        await page.evaluate((s) => {
          const el = document.querySelector(s) as HTMLElement | null;
          return !!el && el.getClientRects().length > 0;
        }, select),
      ).toBe(true);

      await page.select(select, 'mute');
      await page.evaluate((s) => {
        const el = document.querySelector(s) as HTMLSelectElement;
        el.blur();
      }, select);

      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(await page.waitForSelector(select, { timeout: 30_000 })).toBeTruthy();
      expect(await page.$eval(select, (el) => (el as HTMLSelectElement).value)).toBe('mute');
    } finally {
      await page.close();
    }
  });
});

describe('story navigation', () => {
  /**
   * Regression: the paragraph panel is how a learner jumps the typing board to any
   * paragraph, and it was a `<div onClick>` — the only interactive element in the app
   * that could not be reached or activated from the keyboard. In an app about the
   * keyboard that made the whole story navigator mouse-only, while every other control
   * in the codebase was already a `<button type="button">`.
   *
   * Driven with real key events rather than `el.click()`, so it fails for the reason
   * that mattered: a div is not focusable and does not act on Enter.
   */
  it('jumps the board to a paragraph from the keyboard alone', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(`${baseUrl}/stories/the-tortoise-and-the-hare`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForTypingEngine(page);

      const before = await readTargetText(page);
      expect(before.length).toBeGreaterThan(0);

      // The second paragraph, focused and activated the way a keyboard user would:
      // a real focus() and a real Enter keypress. No .click() anywhere — a div cannot
      // take focus at all, so this is the assertion the regression would fail.
      const handle = await page.evaluateHandle(() => {
        return document.querySelectorAll('button[aria-current]')[1] ?? null;
      });
      const paragraph = handle.asElement();
      expect(paragraph).not.toBeNull();

      await (paragraph as ElementHandle<Element>).focus();
      expect(
        await page.evaluate(
          () => document.activeElement?.tagName === 'BUTTON',
        ),
      ).toBe(true);

      await page.keyboard.press('Enter');
      await page.waitForFunction(
        () => document.querySelector('button[aria-current="true"]') !== null,
        { timeout: 10_000 },
      );

      const after = await readTargetText(page);
      expect(after).not.toBe(before);
    } finally {
      await page.close();
    }
  });
});

describe('the custom text arena', () => {
  /**
   * Regression: the Start button was gated on `inputText.trim()`, which removes
   * whitespace and nothing else, while the board is handed `normalizeTypableText(...)`
   * — which also deletes the zero-width and bidi characters a Google Docs or PDF paste
   * arrives with. Both are named in the store's own comment. A paste made only of those
   * passed the gate, normalised to an empty string, and opened a fully rendered arena
   * around a blank board: every keystroke hit `handleKeyInput`'s empty-target guard, so
   * the caret never moved, `isCompleted` never became true, the completion card never
   * appeared and no session was ever recorded — with nothing on screen to say why.
   *
   * Asserted against the real browser because that is the only place the gate lives.
   * The unit suite cannot render this component, and adding a React testing library to
   * do it would be a new dependency for one assertion when real Chrome is already here.
   */
  it('refuses to start a paste that holds no typeable characters', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${baseUrl}/custom`, { waitUntil: 'domcontentloaded' });

      const LABEL = 'Load & Start Practice';
      const isEnabled = () =>
        page.evaluate((text) => {
          const button = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes(text),
          );
          return button ? !button.disabled : null;
        }, LABEL);

      // Hydration first. Typing into a controlled textarea before React has committed
      // writes into a DOM value the first render then overwrites, so the input event
      // would be dropped and the gate would never see it. Wait for the page to reach
      // its initial committed state — the pre-filled sample loads and Start is enabled.
      await page.waitForFunction(
        (text) => {
          const button = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes(text),
          );
          return Boolean(button && !button.disabled);
        },
        { timeout: 10_000 },
        LABEL,
      );

      expect(await isEnabled()).toBe(true); // the pre-filled sample loads

      // Zero-width characters the textarea and trim() both consider real content.
      await page.evaluate(() => {
        const textarea = document.querySelector('textarea');
        if (!textarea) throw new Error('no textarea on /custom');
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, '\u200C\u200D\uFEFF   ');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // React commits on its own schedule, so wait for the gate rather than reading
      // the button in the same tick that dispatched the event.
      //
      // 10s, not 5s: every other wait in this file budgets 10s or more, and this was the
      // only one below that. It failed three consecutive times in a row on a loaded
      // machine — each at 5.2-5.4s, i.e. sitting on the ceiling — and passed on every run
      // since, against the same code and the same build. The gate itself is one React
      // commit off one dispatched event and cannot plausibly take seconds, so this is the
      // harness under load rather than the app; what exactly starves it (renderer
      // contention, or throttling of a backgrounded page) was not established. Widening
      // the budget is the fix for what was actually observed. If it ever fails at 10s, that
      // is a different and real failure, and this comment should be replaced by its cause
      // rather than the number raised again.
      await page.waitForFunction(
        (text) => {
          const button = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes(text),
          );
          return Boolean(button && button.disabled);
        },
        { timeout: 10_000 },
        LABEL,
      );
      expect(await isEnabled()).toBe(false); // the dead end cannot be entered

      // And the word count tells the same story rather than claiming "1 words".
      const words = await page.evaluate(() => document.body.innerText.match(/(\d+) words/)?.[1]);
      expect(words).toBe('0');
    } finally {
      await page.close();
    }
  });
});

describe('typing flow', () => {
  it('types a full passage and records the session', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForTypingEngine(page);

      let targetText = '';
      for (let attempt = 0; attempt < 40 && !targetText; attempt++) {
        targetText = await readTargetText(page);
        if (!targetText) await sleep(100);
      }
      expect(targetText.length).toBeGreaterThan(50);

      // Two backspaces must un-advance the caret, proving correction works.
      await page.keyboard.type('Qz', { delay: 0 });
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');

      // Escape, and not another backspace, because backspacing un-advances the caret but
      // does not refund the key: the probe's one wrong character stays in the counters and
      // is scored against the run below. `waitForTypingEngine` resets for the same reason,
      // and the arithmetic is why this matters — the landing passage is 281 characters, so
      // that one error is 99.6% of the run, which `Math.round` used to display as a perfect
      // score and record as one. The board floors it now, so this assertion is what says a
      // flawless run is the only thing that records 100.
      await page.keyboard.press('Escape');

      // Finish the passage for a clean 100% run.
      await page.keyboard.type(targetText, { delay: 0 });
      await page.waitForFunction(() => document.body.innerText.includes('Passage Completed'), {
        timeout: 30_000,
      });

      const body = await page.evaluate(() => document.body.innerText);
      expect(body).toContain('100%');

      const raw = await page.evaluate(() => localStorage.getItem('typestory_user_stats_v1'));
      expect(raw).toBeTruthy();

      const stats = JSON.parse(raw as string);
      expect(stats.sessions).toHaveLength(1);
      expect(stats.sessions[0].accuracy).toBe(100);
      expect(stats.dailyStreak.currentStreak).toBe(1);
      expect(stats.totalWordsTyped).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  /**
   * A wrong keystroke has to be identifiable without being able to see colour.
   *
   * The board marked a landed character emerald and a missed one rose, and stopped
   * there — so the entire feedback loop depended on telling those two hues apart. The
   * faint 20% background and the rounding are not a second signal; at any usable
   * contrast they are the same signal twice. A learner with a colour vision deficiency
   * read the same text twice and had no way to find their typos, which is WCAG 2.2
   * SC 1.4.1 failing on the one thing this app exists to tell you.
   *
   * Asserted against the real DOM because that is the only place the styling lives:
   * the unit config's include list covers plain `.ts` tests and not `.tsx`, and the repo
   * has no React testing library, so a class on a character span has no other home. The
   * class is checked rather than a computed colour on purpose — a colour assertion would
   * pass for any palette, including the two this defect shipped in.
   */
  it('marks a wrong character by shape as well as by colour', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForTypingEngine(page);

      let targetText = '';
      for (let attempt = 0; attempt < 40 && !targetText; attempt++) {
        targetText = await readTargetText(page);
        if (!targetText) await sleep(100);
      }
      expect(targetText.length).toBeGreaterThan(50);

      const cueAt = (index: number) =>
        page.evaluate((i) => {
          const board = Array.from(document.querySelectorAll('div'))
            .map((el) => ({ el, spans: el.querySelectorAll(':scope > span').length }))
            .filter((candidate) => candidate.spans > 5)
            .sort((a, b) => b.spans - a.spans)[0]?.el;
          if (!board) return null;
          return board.children[i]?.className ?? null;
        }, index);

      // All three states, because a cue worn by everything discriminates nothing. An
      // assertion on the wrong state alone would pass for a blanket underline, which
      // is the same defect with the colour swapped out.
      const untyped = await cueAt(1);
      expect(untyped).not.toContain('underline');

      // Wrong first: anything that is not the target's own first character.
      await page.keyboard.type(targetText[0] === 'x' ? 'y' : 'x', { delay: 0 });
      expect(await cueAt(0)).toContain('underline');

      // Escape resets the run; the same position, typed correctly, carries no cue.
      await page.keyboard.press('Escape');
      await page.keyboard.type(targetText[0], { delay: 0 });
      expect(await cueAt(0)).not.toContain('underline');
    } finally {
      await page.close();
    }
  });

  /**
   * Regression: the completion card and the session record each measured the run
   * separately — the card off `elapsedSeconds` (the 250ms display tick, which floors
   * and stops on completion) and the record off `round((endTime - startTime) / 1000)`.
   * The two disagree by a whole second whenever the run does not land on an integer,
   * and since floor is never above round the card always read faster than the history
   * recorded: the learner was congratulated with a WPM their own stats then denied.
   *
   * Needs a run that crosses a second boundary to be observable at all, which is why
   * the passage above — typed with no delay — cannot catch this and this one can.
   */
  it('shows the same WPM on the completion card as it records in the history', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      // An earlier test in this file already wrote a session to the shared origin.
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTypingEngine(page);

      let targetText = '';
      for (let attempt = 0; attempt < 40 && !targetText; attempt++) {
        targetText = await readTargetText(page);
        if (!targetText) await sleep(100);
      }
      expect(targetText.length).toBeGreaterThan(0);

      // Slow enough that the run spans several whole seconds, so the floored tick and
      // the rounded stamps are guaranteed to differ if they are read independently.
      await page.keyboard.type(targetText, { delay: 40 });
      await page.waitForFunction(() => document.body.innerText.includes('Passage Completed'), {
        timeout: 60_000,
      });

      const cardWpm = Number(
        await page.evaluate(() => {
          const match = document.body.innerText.match(/You typed at (\d+) WPM/);
          return match ? Number(match[1]) : NaN;
        }),
      );
      expect(Number.isNaN(cardWpm)).toBe(false);

      const raw = await page.evaluate(() => localStorage.getItem('typestory_user_stats_v1'));
      const stats = JSON.parse(raw as string);
      expect(stats.sessions).toHaveLength(1);

      const recorded = stats.sessions[0];
      // A multi-second run, so the two clocks are distinguishable at all.
      expect(recorded.durationSeconds).toBeGreaterThan(1);
      expect(cardWpm).toBe(recorded.wpm);
    } finally {
      await page.close();
    }
  });

  it('records the passage once, however many pages the learner visits', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    // The nav is client-side, so the typing store survives it — a full goto would
    // wipe the store and hide the very bug this is guarding against.
    const clickNav = async (label: string) => {
      const handle = await page.evaluateHandle((text) => {
        const links = Array.from(document.querySelectorAll('a'));
        return links.find((a) => a.textContent?.includes(text)) ?? null;
      }, label);
      const element = handle.asElement() as ElementHandle<Element> | null;
      if (!element) throw new Error(`no nav link containing "${label}"`);
      await element.click();
    };

    try {
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      // This file's first test already wrote a session to the shared origin.
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTypingEngine(page);

      let targetText = '';
      for (let attempt = 0; attempt < 40 && !targetText; attempt++) {
        targetText = await readTargetText(page);
        if (!targetText) await sleep(100);
      }
      await page.keyboard.type(targetText, { delay: 0 });
      await page.waitForFunction(() => document.body.innerText.includes('Passage Completed'), {
        timeout: 30_000,
      });

      // /vocab and / both mount a fresh TypingEngine while the store still holds
      // isCompleted: true from the run above. The recording guard used to be a
      // component ref, so it re-armed on each mount and re-recorded the session,
      // inflating the count, the word volume, the time spent and both averages.
      await clickNav('Word Banks');
      // The h1, not the nav link, so the wait proves the route actually swapped.
      await page.waitForFunction(
        () => document.body.innerText.includes('English Word Banks'),
        { timeout: 10_000 },
      );
      await clickNav('TypeStory');
      // Not "Passage Completed": /vocab has since loaded its own word into the store,
      // so the home page comes back showing that word, not the finished passage.
      // The h1 is what proves the route actually swapped.
      await page.waitForFunction(() => document.body.innerText.includes('Master Touch Typing'), {
        timeout: 10_000,
      });
      await clickNav('Word Banks');
      await sleep(300);

      const stats = JSON.parse(
        (await page.evaluate(() => localStorage.getItem('typestory_user_stats_v1'))) as string,
      );
      expect(stats.sessions).toHaveLength(1);
    } finally {
      await page.close();
    }
  });
});

describe('backup flow', () => {
  it('backs a session up to the server and restores it onto a wiped device', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();
    page.on('dialog', (dialog) => void dialog.accept());

    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });

      await completePassage(page);
      await openStats(page);

      // Backup is opt-in: the button has to be there and the code has to be absent
      // until it is pressed, or this app would be uploading practice history
      // without ever asking.
      expect(await page.$eval('code', (el) => el.textContent).catch(() => null)).toBeNull();
      await clickButton(page, 'Back up my progress');

      const codeHandle = await page.waitForFunction(
        () => document.querySelector('code')?.textContent ?? '',
      );
      const code = (await codeHandle.jsonValue()) as string;
      expect(code).toBeTruthy();

      // The upload is fire-and-forget, so poll rather than assume it has landed.
      const stored = await page
        .waitForFunction(
          async (deviceId) => {
            const response = await fetch(`/api/progress?deviceId=${encodeURIComponent(deviceId)}`);
            if (!response.ok) return null;
            const { record } = await response.json();
            return record.stats.sessions.length;
          },
          { timeout: 15_000, polling: 250 },
          code,
        )
        .then((handle) => handle.jsonValue());

      expect(stored).toBe(1);

      // The case the feature exists for: lose the browser's data entirely.
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openStats(page);
      expect(await page.evaluate(() => document.body.innerText)).toContain(
        'No typing sessions recorded yet',
      );

      await page.type('input[aria-label="Backup code to restore from"]', code);
      await clickButton(page, 'Restore');

      await page.waitForFunction(
        // innerText is the *rendered* text and that heading is CSS-uppercased.
        () => document.body.innerText.toLowerCase().includes('recent sessions (1)'),
        { timeout: 15_000 },
      );
    } finally {
      await page.close();
    }
  });
});

describe('writing correction flow', () => {
  it('explains a missing key instead of showing a broken panel', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(`${baseUrl}/writing`, { waitUntil: 'domcontentloaded' });

      const box = 'textarea#writing-text';
      expect(await page.waitForSelector(box, { timeout: 30_000 })).toBeTruthy();

      // The page reads the caps from the API rather than importing them, so it
      // cannot drift from the server's own limit.
      const hint = await page.$eval(box, () => document.querySelector('label')?.textContent ?? '');
      expect(hint).toContain('Your writing');

      const isDisabled = () =>
        page.evaluate(() => {
          const button = Array.from(document.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Check my writing'),
          );
          return (button as HTMLButtonElement | undefined)?.disabled ?? null;
        });

      // Nothing worth grading yet, so nothing is spent.
      expect(await isDisabled()).toBe(true);
      await page.type(box, 'Yesterday I go to the market with my sister.');
      expect(await isDisabled()).toBe(false);

      await clickButton(page, 'Check my writing');

      // The model is unreachable here (see ANTHROPIC_BASE_URL in the server spawn):
      // the page must say so plainly rather than hanging on a spinner or rendering
      // an empty report.
      await page.waitForFunction(
        () => document.body.innerText.includes('not reachable right now'),
        { timeout: 30_000 },
      );
      expect(await isDisabled()).toBe(false);
    } finally {
      await page.close();
    }
  });
});

describe('tutor flow', () => {
  it('explains a missing key and keeps the question box usable', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(`${baseUrl}/tutor`, { waitUntil: 'domcontentloaded' });

      const box = 'textarea#tutor-message';
      expect(await page.waitForSelector(box, { timeout: 30_000 })).toBeTruthy();

      // A blank Ask would spend a model call to say nothing, so it stays disabled
      // until there is an actual question in the box.
      const isDisabled = () =>
        page.evaluate(() => {
          const button = Array.from(document.querySelectorAll('button[type=submit]')).find((b) =>
            b.textContent?.includes('Ask'),
          );
          return (button as HTMLButtonElement | undefined)?.disabled ?? null;
        });

      expect(await isDisabled()).toBe(true);
      await page.type(box, 'Why is it "I have been"?');
      expect(await isDisabled()).toBe(false);

      await page.click('button[type=submit]');

      // The model is unreachable here (see ANTHROPIC_BASE_URL in the server spawn):
      // the tutor must say so plainly rather than hanging on a spinner.
      await page.waitForFunction(
        () => document.body.innerText.includes('not reachable right now'),
        { timeout: 30_000 },
      );

      // The failed question is dropped rather than left as an empty assistant turn
      // that would be re-posted as history on the next one.
      expect(await page.evaluate(() => document.body.innerText)).not.toContain('thinking…');
      expect(await isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  });
});

describe('navigation', () => {
  it('keeps every route reachable on a phone', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      // The nav used to be `hidden md:flex`, so below 768px none of the routes
      // had a link at all — in an app whose primary device is a phone.
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      for (const label of ['Stories', 'Word Banks', 'Placement', 'Writing', 'Tutor', 'Paste Text']) {
        const visible = await page.evaluate((text) => {
          const links = Array.from(document.querySelectorAll('nav a'));
          return links.some(
            (link) =>
              link.textContent?.includes(text) && link.getBoundingClientRect().width > 0,
          );
        }, label);
        expect(visible, `"${label}" is unreachable at 390px`).toBe(true);
      }
    } finally {
      await page.close();
    }
  });
});

describe('placement flow', () => {
  it('places a learner from the quiz alone when the model cannot be reached', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(`${baseUrl}/placement`, { waitUntil: 'domcontentloaded' });

      expect(await page.waitForSelector('fieldset input[type=radio]', { timeout: 30_000 })).toBeTruthy();
      expect(await page.$$('fieldset')).toHaveLength(12);

      // Submit stays locked until every question is answered.
      const submit = 'form button[type=submit]';
      expect(await page.$eval(submit, (el) => (el as HTMLButtonElement).disabled)).toBe(true);

      // The four A1 questions, answered correctly; everything else wrong. The card
      // ranks its ticks against `objective.level` rather than against each level's own
      // rate — `held` is `levels.indexOf(level) <= indexOf(objective.level)`, the
      // cascade's verdict — so 4/4 on A1 ticks A1 and leaves A2 and B1 bare whatever
      // they scored. The rates below still draw the bars, and still decide whether the
      // sentence about a score that did not carry appears.
      const A1_ANSWERS = [1, 0, 2, 2];
      for (const [i, fieldset] of (await page.$$('fieldset')).entries()) {
        const radios = await fieldset.$$('input[type=radio]');
        await (i < A1_ANSWERS.length ? radios[A1_ANSWERS[i]] : radios[0]).click();
      }
      expect(await page.$eval(submit, (el) => (el as HTMLButtonElement).disabled)).toBe(false);

      await page.type('#placement-writing', 'I really enjoy visiting my grandparents every summer.');
      await page.click(submit);

      // innerText is the *rendered* text, and the heading is CSS-uppercased.
      await page.waitForFunction(
        () => document.body.innerText.toLowerCase().includes('your english level'),
        { timeout: 30_000 },
      );

      const body = await page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/\b(A1|A2|B1)\b/);
      // The model is unreachable here (see ANTHROPIC_BASE_URL in the server spawn), so
      // the quiz must stand alone and the page must say so rather than showing a
      // broken feedback panel.
      //
      // The failing branch, not the skipping one, and the difference is the assertion.
      // The route used to report a missing ANTHROPIC_API_KEY as 'skipped', so a learner
      // who had typed an essay and asked for it to be graded was told "That is normal
      // — the writing check is optional". That short-circuit is gone: the SDK resolves
      // an `ant auth login` credential chain when the env var is absent, so refusing on
      // its absence refused machines that could have worked. An unreachable model is
      // now a failure of ours to report rather than a choice the learner made, and only
      // an empty box is a skip.
      expect(body).toContain('Your writing could not be graded');
      expect(body).not.toContain('That is normal');

      // One row per level the route shipped, and a tick on exactly the level the
      // 4/4 cleared. Read against the API rather than against the page, so this
      // cannot pass by agreeing with the page's own copy of the rule.
      const { levels } = (await (await fetch(`${baseUrl}/api/placement`)).json()) as {
        levels: string[];
      };
      const rows = (await page.evaluate(() =>
        [...document.querySelectorAll('.grid > div')].map((row) => ({
          text: (row as HTMLElement).innerText.replace(/\s+/g, ' '),
          ticked: row.querySelector('svg.lucide-circle-check') !== null,
        })),
      )) as { text: string; ticked: boolean }[];

      expect(rows.map((row) => row.text.split(' ')[0])).toEqual(levels);
      expect(rows.filter((row) => row.ticked).map((row) => row.text.split(' ')[0])).toEqual(['A1']);
    } finally {
      await page.close();
    }
  });
});
describe('vocabulary bank links', () => {
  /**
   * The landing page's three bank cards are its only deep links into /vocab, and all
   * three pointed at a bare `/vocab`. That route opens whichever bank is first, so
   * clicking the card that reads "IELTS Academic Vocabulary" and "120 core words"
   * arrived at Full-Stack terminology — a card that looks like a link to a bank and is
   * not one, with nothing on screen saying the click had been thrown away. The section
   * header's "Explore word banks" link is unaffected either way; it never named a bank.
   *
   * Asserted against the real DOM because the assertion *is* navigation: the two halves
   * of the defect live in two files (`app/page.tsx` builds the href, `app/vocab/page.tsx`
   * reads it) and no unit test can see the join. Picking the middle bank matters too —
   * the first one is what a bare `/vocab` opens, so testing only the first would pass
   * against the defect exactly as it shipped.
   */
  it('opens the bank the card named, not the first one', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await newPage();

    try {
      // From the data, not from a literal typed here: a rename in data/vocab.ts should
      // move both the card and this expectation, and a reordering should not break them.
      const bank = VOCAB_BANKS.find((b) => b.slug === 'ielts-academic')!;

      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      // The card itself, addressed by the bank it advertises rather than by its
      // position, so reordering the grid cannot silently retarget the test.
      const clicked = await page.evaluate((wanted) => {
        const card = Array.from(document.querySelectorAll('a')).find(
          (link) => link.textContent?.includes(wanted) && link.textContent?.includes('core words'),
        );
        if (!card) return null;
        const href = card.getAttribute('href');
        card.click();
        return { wanted, href };
      }, bank.title);
      expect(clicked, 'no vocabulary bank card advertises itself').not.toBeNull();
      expect(clicked!.href).toBe(`/vocab?bank=${bank.slug}`);

      // Polled rather than awaited on a navigation event: the click is a client-side
      // transition, so the URL changes in the same tick as the render and there is no
      // event to wait on. 100 × 100ms is the same budget waitForTypingEngine uses.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (page.url().includes('/vocab')) break;
        await sleep(100);
      }
      expect(page.url()).toContain('/vocab');
      await waitForTypingEngine(page);

      // The headline word is the first word of that bank, and the typing board below
      // holds the same one — proof the whole page followed the link rather than just
      // the tab ring, which is a class a stylesheet can set on the wrong element.
      // The board is read with the file's own helper: `querySelectorAll('span')` also
      // matches the nav and the virtual keyboard, and joining those in gives a string
      // that begins with neither this word nor any other.
      const landed = await page.evaluate(
        () => document.querySelector('h2.font-black')?.textContent?.trim() ?? null,
      );
      const boardText = await readTargetText(page);

      expect(landed).toBe(bank.words[0].word);
      expect(boardText.startsWith(bank.words[0].word)).toBe(true);
    } finally {
      await page.close();
    }
  });
});

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

beforeAll(async () => {
  // Chrome is looked for *before* the server is booted. Every test skips without it, so
  // starting `next start` first meant a machine with no browser still waited out the 90s
  // server timeout and then threw "Server never became ready" — a hard failure for a run
  // that has nothing to run, on a machine that never needed `npm run build` anyway.
  const chrome = findChrome();
  if (!chrome) return;

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
  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production', TYPE_STORY_DATA_DIR: dataDir },
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
    const page = await browser.newPage();

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
    const page = await browser.newPage();

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
    const page = await browser.newPage();

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
      await page.waitForFunction(
        (text) => {
          const button = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes(text),
          );
          return Boolean(button && button.disabled);
        },
        { timeout: 5000 },
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
    const page = await browser.newPage();

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
    const page = await browser.newPage();

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
    const page = await browser.newPage();

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
    const page = await browser.newPage();
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
    const page = await browser.newPage();

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

      // No ANTHROPIC_API_KEY in this environment: the page must say so plainly
      // rather than hanging on a spinner or rendering an empty report.
      await page.waitForFunction(
        () => document.body.innerText.includes('no ANTHROPIC_API_KEY set'),
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
    const page = await browser.newPage();

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

      // No ANTHROPIC_API_KEY in this environment: the tutor must say so plainly
      // rather than hanging on a spinner.
      await page.waitForFunction(
        () => document.body.innerText.includes('no ANTHROPIC_API_KEY set'),
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
    const page = await browser.newPage();

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
  it('places a learner from the quiz alone when no AI key is configured', async (ctx) => {
    if (!browser) {
      ctx.skip();
      return;
    }
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(`${baseUrl}/placement`, { waitUntil: 'domcontentloaded' });

      expect(await page.waitForSelector('fieldset input[type=radio]', { timeout: 30_000 })).toBeTruthy();
      expect(await page.$$('fieldset')).toHaveLength(12);

      // Submit stays locked until every question is answered.
      const submit = 'form button[type=submit]';
      expect(await page.$eval(submit, (el) => (el as HTMLButtonElement).disabled)).toBe(true);

      // The four A1 questions, answered correctly; everything else wrong. The
      // result card draws its ticks from the pass rate the route ships, so this is
      // the only fixture that can show one appearing — an answer key that stops
      // arriving leaves `rate >= undefined`, which is false, and the card renders no
      // ticks at all while saying nothing about it.
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
      // No ANTHROPIC_API_KEY in this environment, so the quiz must stand alone and
      // the page must say so rather than showing a broken feedback panel.
      expect(body).toContain('Your writing was not graded');

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
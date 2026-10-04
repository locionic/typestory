import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, Profiler, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Navbar from '../components/Navbar';
import { useTypingStore } from '../store/useTypingStore';

// The header now reads the pathname to say which of its links is the current page. The
// router is not in jsdom, and it is not what this file counts: the point is that nothing
// the header reads comes from the typing store, and this stub keeps it out of it.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

/**
 * How often the chrome re-renders while someone is typing.
 *
 * `useTypingStore()` with no selector resolves to the identity function, so the
 * snapshot `useSyncExternalStore` compares is the state object itself — and that
 * object is a new reference on every `set()`. The component therefore re-renders on
 * every keystroke and every 250ms tick whether or not it displays any of it.
 *
 * That is invisible on the page and costs real frames. The header, the stats modal
 * mounted behind it, the story reading panel and the whole vocabulary page all sit in
 * the store's blast radius, in an application whose central interaction *is* the
 * keystroke driving those updates. At a hundred words a minute the header is rebuilt
 * roughly eight times a second.
 *
 * Counted with `<Profiler>`, which fires once per commit of its subtree: a consumer
 * selecting a value React can compare does not re-render, so there is no commit, so it
 * does not fire. The control at the bottom is what stops that reading as "the harness
 * is broken" rather than "the component is quiet" — both look like a count stuck at 1.
 */
const roots: { unmount: () => void }[] = [];

// React needs to be told it is driving an `act` scope before anything renders.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

function renderCounting(ui: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  let commits = 0;
  act(() =>
    root.render(
      createElement(Profiler, { id: 'subject', onRender: () => void (commits += 1) }, ui),
    ),
  );
  return () => commits;
}

/** A keystroke the store cannot ignore: new text, new counts, a fresh start time. */
const typeOneCharacter = () =>
  act(() => {
    useTypingStore.getState().handleKeyInput('Q');
  });

/** Subscribes to the whole store, the way the four components under test used to. */
function WholeStoreSubscriber() {
  useTypingStore();
  return null;
}

describe('the header while someone types', () => {
  it('does not re-render on a keystroke', () => {
    const commits = renderCounting(createElement(Navbar));
    expect(commits()).toBe(1); // mount only

    typeOneCharacter();

    // The store genuinely moved — otherwise "still 1" would prove nothing.
    expect(useTypingStore.getState().totalKeystrokes).toBe(1);
    expect(useTypingStore.getState().typedText).toBe('Q');

    expect(commits()).toBe(1);
  });

  it('does not re-render on the 250ms clock', () => {
    const commits = renderCounting(createElement(Navbar));

    // The passage has started, so `elapsedSeconds` really moves and a whole-store
    // subscriber would commit for every tick.
    typeOneCharacter();
    act(() => {
      useTypingStore.getState().tick();
      useTypingStore.getState().tick();
    });

    expect(useTypingStore.getState().elapsedSeconds).toBeGreaterThanOrEqual(1);
    expect(commits()).toBe(1);
  });

  /**
   * The control. Without it the two tests above pass just as happily against a
   * harness that never fires, which is indistinguishable from a header that has
   * genuinely stopped updating.
   */
  it('re-renders a whole-store subscriber on the very same keystroke', () => {
    const commits = renderCounting(createElement(WholeStoreSubscriber));
    expect(commits()).toBe(1);

    typeOneCharacter();

    expect(commits()).toBeGreaterThan(1);
  });
});

describe('the actions the chrome selects', () => {
  /**
   * The precondition, and the thing that makes the fix above a fix rather than a
   * no-op. A selector is only worth having if its value compares equal across the
   * updates it is supposed to ignore. Actions are created once inside `create`, so
   * they are stable — but that is a property of how the store is written rather than
   * something a call site can see, and rebuilding them per keystroke would put the
   * header straight back where it started.
   */
  it('never changes identity, whatever the typing session does', () => {
    const before = {
      setSound: useTypingStore.getState().setSound,
      loadCustomText: useTypingStore.getState().loadCustomText,
      resetSession: useTypingStore.getState().resetSession,
      handleBackspace: useTypingStore.getState().handleBackspace,
    };

    typeOneCharacter();
    act(() => {
      useTypingStore.getState().tick();
      useTypingStore.getState().loadCustomText('something else entirely');
      useTypingStore.getState().setSound('brown');
      useTypingStore.getState().handleBackspace();
      useTypingStore.getState().resetSession();
    });

    const after = useTypingStore.getState();
    expect(after.setSound).toBe(before.setSound);
    expect(after.loadCustomText).toBe(before.loadCustomText);
    expect(after.resetSession).toBe(before.resetSession);
    expect(after.handleBackspace).toBe(before.handleBackspace);
  });
});
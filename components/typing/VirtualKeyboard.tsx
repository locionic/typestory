'use client';

import React from 'react';

interface VirtualKeyboardProps {
  expectedChar?: string;
}

/**
 * Exported so the story corpus can be checked against the keyboard it is typed on.
 *
 * This list *is* the app's statement of what a US layout can produce. `normalizeTypableText`
 * says so in prose and enforces nothing, so the only way the two can stay in agreement is
 * for the data to be measured against these rows rather than a second, drifting copy.
 */
export interface KeyDef {
  key: string;
  display: string;
  shiftDisplay?: string;
  finger: 'left-pinky' | 'left-ring' | 'left-middle' | 'left-index' | 'thumb' | 'right-index' | 'right-middle' | 'right-ring' | 'right-pinky';
  widthClass?: string;
  hasBump?: boolean;
}

const FINGER_NAMES: Record<string, string> = {
  'left-pinky': 'Left Pinky',
  'left-ring': 'Left Ring Finger',
  'left-middle': 'Left Middle Finger',
  'left-index': 'Left Index Finger',
  thumb: 'Thumb',
  'right-index': 'Right Index Finger',
  'right-middle': 'Right Middle Finger',
  'right-ring': 'Right Ring Finger',
  'right-pinky': 'Right Pinky',
};

/** Also exported: the corpus test derives what a learner can actually type from these rows. */
export const KEYBOARD_ROWS: KeyDef[][] = [
  // Row 1: Numbers & Symbols
  [
    { key: '`', display: '`', shiftDisplay: '~', finger: 'left-pinky' },
    { key: '1', display: '1', shiftDisplay: '!', finger: 'left-pinky' },
    { key: '2', display: '2', shiftDisplay: '@', finger: 'left-ring' },
    { key: '3', display: '3', shiftDisplay: '#', finger: 'left-middle' },
    { key: '4', display: '4', shiftDisplay: '$', finger: 'left-index' },
    { key: '5', display: '5', shiftDisplay: '%', finger: 'left-index' },
    { key: '6', display: '6', shiftDisplay: '^', finger: 'right-index' },
    { key: '7', display: '7', shiftDisplay: '&', finger: 'right-index' },
    { key: '8', display: '8', shiftDisplay: '*', finger: 'right-middle' },
    { key: '9', display: '9', shiftDisplay: '(', finger: 'right-ring' },
    { key: '0', display: '0', shiftDisplay: ')', finger: 'right-pinky' },
    { key: '-', display: '-', shiftDisplay: '_', finger: 'right-pinky' },
    { key: '=', display: '=', shiftDisplay: '+', finger: 'right-pinky' },
    { key: 'Backspace', display: 'Backspace', finger: 'right-pinky', widthClass: 'w-16 sm:w-20' },
  ],
  // Row 2: Top Row
  [
    { key: 'Tab', display: 'Tab', finger: 'left-pinky', widthClass: 'w-12 sm:w-14' },
    { key: 'q', display: 'Q', finger: 'left-pinky' },
    { key: 'w', display: 'W', finger: 'left-ring' },
    { key: 'e', display: 'E', finger: 'left-middle' },
    { key: 'r', display: 'R', finger: 'left-index' },
    { key: 't', display: 'T', finger: 'left-index' },
    { key: 'y', display: 'Y', finger: 'right-index' },
    { key: 'u', display: 'U', finger: 'right-index' },
    { key: 'i', display: 'I', finger: 'right-middle' },
    { key: 'o', display: 'O', finger: 'right-ring' },
    { key: 'p', display: 'P', finger: 'right-pinky' },
    { key: '[', display: '[', shiftDisplay: '{', finger: 'right-pinky' },
    { key: ']', display: ']', shiftDisplay: '}', finger: 'right-pinky' },
    { key: '\\', display: '\\', shiftDisplay: '|', finger: 'right-pinky' },
  ],
  // Row 3: Home Row
  [
    { key: 'Caps', display: 'Caps', finger: 'left-pinky', widthClass: 'w-14 sm:w-16' },
    { key: 'a', display: 'A', finger: 'left-pinky' },
    { key: 's', display: 'S', finger: 'left-ring' },
    { key: 'd', display: 'D', finger: 'left-middle' },
    { key: 'f', display: 'F', finger: 'left-index', hasBump: true },
    { key: 'g', display: 'G', finger: 'left-index' },
    { key: 'h', display: 'H', finger: 'right-index' },
    { key: 'j', display: 'J', finger: 'right-index', hasBump: true },
    { key: 'k', display: 'K', finger: 'right-middle' },
    { key: 'l', display: 'L', finger: 'right-ring' },
    { key: ';', display: ';', shiftDisplay: ':', finger: 'right-pinky' },
    { key: "'", display: "'", shiftDisplay: '"', finger: 'right-pinky' },
    { key: 'Enter', display: 'Enter', finger: 'right-pinky', widthClass: 'w-16 sm:w-20' },
  ],
  // Row 4: Bottom Row
  [
    { key: 'ShiftLeft', display: 'Shift', finger: 'left-pinky', widthClass: 'w-16 sm:w-20' },
    { key: 'z', display: 'Z', finger: 'left-pinky' },
    { key: 'x', display: 'X', finger: 'left-ring' },
    { key: 'c', display: 'C', finger: 'left-middle' },
    { key: 'v', display: 'V', finger: 'left-index' },
    { key: 'b', display: 'B', finger: 'left-index' },
    { key: 'n', display: 'N', finger: 'right-index' },
    { key: 'm', display: 'M', finger: 'right-index' },
    { key: ',', display: ',', shiftDisplay: '<', finger: 'right-middle' },
    { key: '.', display: '.', shiftDisplay: '>', finger: 'right-ring' },
    { key: '/', display: '/', shiftDisplay: '?', finger: 'right-pinky' },
    { key: 'ShiftRight', display: 'Shift', finger: 'right-pinky', widthClass: 'w-16 sm:w-20' },
  ],
  // Row 5: Space Bar
  [
    { key: ' ', display: 'Space', finger: 'thumb', widthClass: 'w-64 sm:w-80' },
  ],
];

/**
 * Every character this layout can produce, as one set.
 *
 * Derived from the rows above rather than written out, for the same reason they are
 * exported at all: "this character can be typed" has to have exactly one answer in the
 * codebase. A list kept beside the layout is a list that drifts from it, and this one
 * would drift silently — the corpus would keep passing while the keyboard gained a key
 * that never reached it, or lost one that still looked typable in the prose.
 *
 * `\n` and `\t` are here because Enter and Tab *are* keys in the rows; they are listed
 * first only so the intent survives someone reordering them, not because the loop misses
 * them — it does not, since neither is `length === 1`.
 */
export const TYPABLE_CHARS: ReadonlySet<string> = (() => {
  const chars = new Set<string>(['\n', '\t']);
  for (const row of KEYBOARD_ROWS) {
    for (const { key, shiftDisplay } of row) {
      if (key.length === 1) {
        chars.add(key);
        chars.add(key.toUpperCase());
      }
      if (shiftDisplay) chars.add(shiftDisplay);
    }
  }
  return chars;
})();

/**
 * The characters of `text` that no key on this layout produces, in the order they first
 * appear.
 *
 * One of them is enough to stop a run. `handleKeyInput` advances the caret on every
 * keystroke whether or not it matched, so a character with no key parks the caret on a
 * position that can never turn green: it cannot be repaired mid-passage, it does not
 * block completion, and it drags the WPM and accuracy the session is *recorded* with.
 * `test/content.test.ts` keeps the shipped corpus free of these; this is the same
 * question asked of the one passage nothing can check ahead of time — whatever a learner
 * pastes into `/custom`.
 */
export function untypeableIn(text: string): string[] {
  const out: string[] = [];
  for (const char of text) {
    if (!TYPABLE_CHARS.has(char) && !out.includes(char)) out.push(char);
  }
  return out;
}

/**
 * The plain letter a character is written on, if it is written on one.
 *
 * `é` is `e` with a mark on it, so the key that presses it is the key that presses `e`.
 * Unicode stores the mark detached and draws it on top, which is why decomposing and
 * dropping the marks is enough to find the letter underneath — and why this is a lookup
 * rather than an edit: the character on screen and the character to press both stay
 * exactly as they were.
 *
 * A character with no letter underneath comes back unchanged and matches nothing, as it
 * always did — a digit, a symbol, an ideograph.
 */
function baseLetter(char: string): string {
  return char.normalize('NFD').replace(/\p{M}/gu, '');
}

// Helper to determine if key matches expected character
function isKeyMatch(def: KeyDef, char?: string): boolean {
  if (!char) return false;
  if (char === ' ' && def.key === ' ') return true;
  if (def.key.toLowerCase() === char.toLowerCase()) return true;
  if (def.shiftDisplay === char) return true;
  // Last, so every exact match above still wins and nothing here can shadow one. This is
  // what lights the key and, through `getFingerForChar` below, names the finger: both
  // reach the layout through this one function.
  if (def.key.toLowerCase() === baseLetter(char).toLowerCase()) return true;
  return false;
}

/**
 * Whether reaching this character means holding Shift.
 *
 * Read off the layout rather than off a list of its own. A 21-symbol array spelled out
 * here held the same information as `shiftDisplay` on the keys it named, and the two
 * agreed only because nobody had changed either — so a key added to the layout rendered,
 * resolved its finger hint, and silently stopped telling the learner to hold Shift, which
 * is the one thing the prompt exists to say. `KEYBOARD_ROWS` is already the single
 * statement of this layout, so the question is asked of it.
 *
 * Uppercase letters still take the branch below it: the key they live on is the
 * lowercase one, so they are shifted without any `shiftDisplay` to match.
 */
function requiresShift(char?: string): boolean {
  if (!char) return false;
  // Asked of the base letter. `É` is neither in the A–Z range below nor on any
  // `shiftDisplay`, so an accented capital raised no prompt at all — and pressing the
  // unshifted key then gives a different character from the one on screen.
  const target = baseLetter(char);
  if (target.length === 1 && target >= 'A' && target <= 'Z') return true;
  return KEYBOARD_ROWS.some((row) => row.some((key) => key.shiftDisplay === target));
}

function getFingerForChar(char?: string): string {
  if (!char) return '';
  if (char === ' ') return 'Thumb (Space)';
  for (const row of KEYBOARD_ROWS) {
    for (const keyDef of row) {
      if (isKeyMatch(keyDef, char)) {
        return FINGER_NAMES[keyDef.finger] || '';
      }
    }
  }
  return '';
}

export default function VirtualKeyboard({ expectedChar }: VirtualKeyboardProps) {
  const needsShift = requiresShift(expectedChar);
  const fingerHint = getFingerForChar(expectedChar);

  // Finger zone color badges
  const getFingerBorder = (finger: KeyDef['finger']) => {
    switch (finger) {
      case 'left-pinky':
      case 'right-pinky':
        return 'border-pink-300 dark:border-pink-900/50';
      case 'left-ring':
      case 'right-ring':
        return 'border-amber-300 dark:border-amber-900/50';
      case 'left-middle':
      case 'right-middle':
        return 'border-emerald-300 dark:border-emerald-900/50';
      case 'left-index':
      case 'right-index':
        return 'border-cyan-300 dark:border-cyan-900/50';
      case 'thumb':
        return 'border-indigo-300 dark:border-indigo-900/50';
      default:
        return 'border-gray-200 dark:border-gray-800';
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/50">
      {/* Target Key & Finger placement hint */}
      <div className="flex items-center justify-between w-full max-w-2xl px-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-500 dark:text-gray-400">Next Target:</span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-indigo-600 px-1.5 font-mono text-xs font-bold text-white shadow-sm">
            {expectedChar === ' ' ? 'Space ␣' : expectedChar || '•'}
          </span>
          {needsShift && (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
              Hold Shift
            </span>
          )}
        </div>

        {fingerHint && (
          <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            Suggested: <span className="font-bold">{fingerHint}</span>
          </div>
        )}
      </div>

      {/* Keyboard Matrix */}
      <div className="flex flex-col items-center gap-1 sm:gap-1.5 select-none overflow-x-auto max-w-full pb-1">
        {KEYBOARD_ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-1 sm:gap-1.5">
            {row.map((keyDef) => {
              const isTarget = isKeyMatch(keyDef, expectedChar);
              const isShiftTarget =
                needsShift && (keyDef.key === 'ShiftLeft' || keyDef.key === 'ShiftRight');

              const isHighlighted = isTarget || isShiftTarget;

              return (
                <div
                  key={keyDef.key}
                  className={`relative flex flex-col items-center justify-center rounded-lg sm:rounded-xl border font-mono text-xs sm:text-sm font-semibold transition-all duration-150 ${
                    keyDef.widthClass || 'w-7 sm:w-10'
                  } h-8 sm:h-10 ${
                    isHighlighted
                      ? 'scale-105 border-indigo-500 bg-indigo-600 text-white shadow-md shadow-indigo-500/30 ring-2 ring-indigo-400 dark:bg-indigo-500'
                      : `bg-white text-gray-700 shadow-2xs hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 ${getFingerBorder(
                          keyDef.finger
                        )}`
                  }`}
                >
                  {/* Shifted symbol on top if exists */}
                  {keyDef.shiftDisplay && (
                    <span
                      className={`text-[8px] sm:text-[10px] leading-none ${
                        isHighlighted ? 'text-indigo-200' : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {keyDef.shiftDisplay}
                    </span>
                  )}
                  <span className="leading-tight">{keyDef.display}</span>

                  {/* Tactile bump for F and J */}
                  {keyDef.hasBump && (
                    <span
                      className={`absolute bottom-1 h-0.5 w-2 sm:w-2.5 rounded-full ${
                        isHighlighted ? 'bg-white' : 'bg-gray-400 dark:bg-gray-500'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-gray-500 dark:text-gray-400 pt-1">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-pink-400 bg-pink-100 dark:bg-pink-950" />
          <span>Pinky</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-amber-400 bg-amber-100 dark:bg-amber-950" />
          <span>Ring</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-emerald-400 bg-emerald-100 dark:bg-emerald-950" />
          <span>Middle</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-cyan-400 bg-cyan-100 dark:bg-cyan-950" />
          <span>Index</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-indigo-400 bg-indigo-100 dark:bg-indigo-950" />
          <span>Thumb</span>
        </div>
      </div>
    </div>
  );
}

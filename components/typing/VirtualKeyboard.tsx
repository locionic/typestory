'use client';

import React from 'react';

interface VirtualKeyboardProps {
  expectedChar?: string;
  activeKey?: string;
}

interface KeyDef {
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

const KEYBOARD_ROWS: KeyDef[][] = [
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

// Helper to determine if key matches expected character
function isKeyMatch(def: KeyDef, char?: string): boolean {
  if (!char) return false;
  if (char === ' ' && def.key === ' ') return true;
  if (def.key.toLowerCase() === char.toLowerCase()) return true;
  if (def.shiftDisplay === char) return true;
  return false;
}

function requiresShift(char?: string): boolean {
  if (!char) return false;
  if (char.length === 1 && char >= 'A' && char <= 'Z') return true;
  const shiftSymbols = ['~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '{', '}', '|', ':', '"', '<', '>', '?'];
  return shiftSymbols.includes(char);
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
                      : `bg-white text-gray-700 shadow-2xs hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-750 ${getFingerBorder(
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

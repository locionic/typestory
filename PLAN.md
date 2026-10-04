# TypeStory — Phase 2

There was no plan file in this repo before this one. Every "next tasks on the project
roadmap" instruction over the last months had nothing to point at, and the work that
happened instead was a defect stream: sentences that claimed more than the code
guaranteed, milestones the app could take back, docs describing mechanisms that had been
removed. This file exists because it was asked for twice; it is here to hold proposals,
not to pretend the phases were planned.

## Where Phase 1 landed

- **The three AI features** — placement test, writing correction, tutor chat — behind a
  single `lib/ai.ts` seam, with a closed JSON schema per caller and server-side fallbacks.
- **Progress sync** — an auth-less `GET`/`PUT`/`DELETE` `/api/progress` with a backup code
  the client mints, and a `ProgressStore` interface to swap for PostgreSQL.
- **Placement → story recommendations** — the level the quiz computes now picks three
  stories at or below it, hardest first, via a four-field `catalog` projected in the GET
  so 32K of story prose stays out of the browser bundle.
- **Milestones that hold** — `bestAccuracy` and the lifetime badge fields, so a perfect run
  cannot be withdrawn once 100 later sessions have rolled past it.
- **Docs that match the code** — the README's `503 ai_not_configured` rows, the placement
  `502`, the FAQ accordion and the reading-time sort all described things that were not
  true; each was corrected or dropped.

799 unit tests. The end-to-end suite is written and has never run: it needs Chrome's
`--no-sandbox`, which is not authorised on this machine.

---

## Phase 2

### 1. Export session history as CSV — done

A learner has two ways out of their own history today and neither is one they can use. The
backup code is opaque and restore-only — it exists to get you *back in*, not to move your
data. And the session list in the stats modal renders rows that cannot be selected. So the
records are readable and unreachable at the same time.

`TypingSessionRecord` is already flat: date, title, source, wpm, accuracy, duration, words,
keystrokes. A CSV is the whole feature. No new dependency — `Blob` and an object URL are
platform.

Three things this has to get right, each of which is a way to be wrong in a way the learner
only finds out later:

- **Formula injection.** On `/custom` the title comes from text the learner pasted. A cell
  beginning `=`, `+`, `-` or `@` is executed by Excel and Sheets on *open*. Text fields get
  a leading apostrophe when they start with one of those.
- **Encoding.** Excel on Windows reads a UTF-8 CSV as the local codepage without a BOM, so
  any non-ASCII character in a title comes out as mojibake. The file gets a `﻿`.
- **Quoting.** Titles contain commas and quotes. RFC 4180 quoting, with embedded quotes
  doubled.

One honesty constraint, from the window that already bit the stats cards: `stats.sessions`
is capped at `MAX_SESSIONS` (100). An export is of the *stored window*, not of all time,
and the button must not imply otherwise.

Shipped as `lib/csv.ts` with a `Download CSV` button beside Reset Stats, shown only when
there is something to download. The panel's "Recent Sessions (N)" heading is the honesty
anchor, so the export does not need a caveat of its own.

### 2. A WPM / accuracy trend — done

The stats modal has four cards and a list. It has no shape over time, which is the thing a
learner actually wants from a practice log: not "your average is 52" but "your average was
41 in March and is 58 now".

SVG, one `polyline`, no chart library — the library would be a dependency larger than the
feature and would need a second one for the responsive story. Draw it from `sessions`,
which already carries a timestamp, a wpm and an accuracy per row.

The constraint is the same one the export has, and it is not optional: once a learner passes
100 sessions the "trend" is a rolling window that forgets. A chart headed "your progress"
would be making a claim the data stops supporting at exactly the point the learner cares
most, so it is labelled with the window the way the accuracy card already is.

Shipped in the stats modal: one `polyline`, a `role="img"` label naming the window and the
range, and both ends of the axis printed on screen — the axis deliberately does not start at
zero, which is why the low and the high are the two labels under it. It is absent until
there are two sessions, because with one there is nothing to join.

### 3. CEFR levels on the vocabulary banks

Placement produces a level and routes a learner to *stories*. Their vocabulary is never
mentioned, because `data/vocab.ts` banks carry no level — the blocked item, not a
forgotten one. Tagging the four banks is the prerequisite and it is not derivable: "Oxford
3000 Essentials" is not a difficulty claim, and assigning A1/B1 per word is a judgement
about the word rather than a fact about the data.

Once tagged, the placement result can offer the bank at the learner's level beside the
three stories, and `/vocab` can filter the way the story catalog already does.

---

## Considered and not doing

- **A chart library.** See above. Also a permanent dependency for something the codebase can
  hold in sixty lines of SVG.
- **CI.** Deferred. It needs a runner decision and, for anything touching the AI routes, a
  secrets story — a suite that runs without `ANTHROPIC_API_KEY` locally and fails without it
  in CI is worse than no CI.
- **A persistent tutor transcript.** Declined earlier in this work; the tutor stays
  session-only, because a stored conversation is a moderation surface the app does not have.
- **Restoring a board mid-run on `/custom`.** The engine is a single state machine and
  `sessionStorage` is the whole of the persistence; not worth a half-built version.
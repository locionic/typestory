# TypeStory (Master Touch Typing with Real Stories & Technical Vocabulary)

TypeStory is an interactive, open-access keyboard typing and language learning platform. Inspired by the muscle-memory concept of `qwerty-learner`, TypeStory combines touch typing practice with real-world English stories, Oxford 3000 vocabulary banks, mechanical keyboard audio feedback, and technical software engineering practice modules.

---

## Key Features

1. **Contextual Story & Tech Typing Practice:**
   - Instead of typing random characters or isolated words, practice with authentic literature, software engineering architectures, speeches, history, and real-life dialogues (Full-Stack, RAG pipelines, Cloud DevOps, Distributed Systems, Aesop Fables, Steve Jobs Commencement Speech).
   - Paragraph-by-paragraph progression with auto-advance, backspace correction, real-time WPM, accuracy %, and error tracking.
   - Built-in English-Vietnamese vocabulary glossaries with phonetics and parts of speech for every story.

2. **Native Text-To-Speech Pronunciation Audio:**
   - Listen to native Text-To-Speech (TTS) narration with customizable speech rates.
   - Hear correct pronunciation of complex technical vocabulary and literary terms before or while typing.
   - Zero external cloud latency, zero API costs, and 100% client-side execution.

3. **Mechanical Keyboard Audio Synthesizer:**
   - Synthesizes authentic keyboard switch sounds directly using the HTML5 Web Audio API (Cherry MX Blue clicky, Cherry MX Brown tactile, Bubble pop, and Mute mode).
   - Zero audio file download latency or CDN failure risks.

4. **Touch-Typing Interactive Virtual Keyboard:**
   - Full on-screen QWERTY layout with real-time target key illumination, Shift-key combinations, and tactile F/J home-row bumps.
   - Color-coded finger zones (Pinky, Ring, Middle, Index, Thumbs) with live finger placement recommendations to train pure touch-typing muscle memory.
   - One-click toggle button on the typing board.

5. **Personal Analytics, Daily Streaks & Milestones:**
   - Automated local persistence tracking WPM trends, accuracy averages, session duration, and total words typed.
   - Daily practice streak counter (`🔥 X days`) in the navbar.
   - Milestone badges for speed thresholds (50+ WPM, 75+ WPM), 100% accuracy, and typing consistency.
   - A **Speed Trend** sparkline over the stored session window, labelled with that window and with both ends of its axis — the axis does not start at zero, so the low and the high are printed rather than left for the reader to infer. It appears once there are two sessions to join.
   - Full session history log with quick-reset capabilities, and a **Download CSV** button for taking the numbers elsewhere. The backup code is restore-only — it exists to get you back in, not to move your data out — so the CSV is the only way to reach the rows as a table. It is an export of the *stored window*, capped at the same 100 sessions the stats cards average over, and the panel's "Recent Sessions (N)" heading is what keeps that honest. Titles are quoted per RFC 4180, carry a UTF-8 BOM so Excel reads them as UTF-8 rather than the local codepage, and are defused with a leading apostrophe when they start with `=`, `+`, `-` or `@` — Excel and Sheets evaluate such a cell on *open*, and on `/custom` the title comes from text the learner pasted.

6. **Interactive Stories Catalog & Search:**
   - Real-time search by story title, author, or keywords.
   - Category filtering (Fables, Literature, Tech & History, Speeches & Essays, Daily Dialogue) and CEFR level filter (Beginner, Intermediate, Advanced).
   - Word count sorting (recommended / shortest / longest), with the reading time shown on every card. There is no separate reading-time sort: `readingTimeMinutes` is derived from `wordCount`, so the ordering would be the same one under a second name.
   - Fluent keyboard flow: press `Enter` on completion cards to immediately advance to the next paragraph or word.

7. **Vocabulary Drills & Word Banks:**
   - Curated collections for Oxford 3000 Essentials, IELTS Academic Mastery, and Tech/Software Engineering English.
   - Flashcard style word-by-word typing practice with phonetic IPA notation, definitions, and translations.

8. **Custom Text Paste Arena:**
   - Paste any article, homework text, coding documentation, or speech to immediately start typing and listening practice.

9. **AI Placement Test (CEFR A1–B1):**
   - Twelve graded questions plus a free-writing task place a learner at A1, A2 or B1 at `/placement`.
   - The quiz is scored in code, so placement is reproducible and auditable; only the writing is graded by a model.
   - Works fully without an API key — the quiz alone still places you.

10. **AI Writing Correction:**
   - Paste anything you wrote in English at `/writing`; get back a corrected version and every change explained individually.
   - A closed JSON Schema constrains the reply, and every field is length-capped, so unusable model output is rejected server-side instead of rendered.

11. **AI English Tutor Chat:**
   - Ask about grammar or a phrase that sounded wrong at `/tutor`; the tutor keeps the conversation, so "and here?" works.
   - Scoped to English — asked to do something else, it says so and offers the English angle.

12. **Engineered for Fast Organic Search Growth (SEO):**
   - 100% statically pre-rendered routes (SSG) for all stories (`/stories/[slug]`), word banks (`/vocab`), and custom mode (`/custom`).
   - Rich JSON-LD structured data: `WebApplication` and `CreativeWork` schemas on every story page.
   - Automated `sitemap.xml` and `robots.txt` generator.
   - OpenGraph and Twitter social preview metadata cards.
   - Semantic HTML5 heading hierarchy and an educational FAQ section optimized for long-tail Google search snippets. It is a section, not an accordion: `<details>` would put each answer behind a click, which is the opposite of what this line is for. The three answers are also checked against the corpus — the first names Azure, and the DevOps story carries it.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router with Turbopack)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4
- **State Management:** Zustand
- **Icons:** Lucide React
- **Animations & Delight:** Canvas-Confetti
- **Audio & Speech:** Web Audio API & Web Speech API
- **AI:** Anthropic SDK (`claude-opus-5-5`), optional, server-side only

---

## Getting Started

### Prerequisites

- Node.js 18+ (tested on Node.js v22)
- npm or pnpm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/typestory.git
cd typestory

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm run start
```

---

## Testing

```bash
npm test           # typecheck, then unit tests — stats, typing store, audio engine (jsdom, ~4s)
npm run test:e2e   # end-to-end smoke test — drives real Chrome against a production build
```

`npm test` needs nothing but the installed dependencies. It runs `tsc --noEmit` first, because Vitest
transpiles rather than typechecks: a type error is invisible to the suite, so `vitest run` on its own
reports a green run for code that will not build. Use `npm run test:watch` for the fast loop — it skips
the typecheck.

`npm run test:e2e` boots `next start` on
a free port and drives real Chrome through the app — ten journeys covering a full typed passage and
its recorded session, the placement test, a server-side backup-and-restore, every route on a phone
viewport, and the two panels' behaviour when the model key is missing. Run `npm run build` first. It
auto-detects Chrome (`CHROME_PATH` overrides) and skips itself when no browser is installed.

Covered behaviour: daily-streak arithmetic and localStorage recovery (`lib/stats.ts`), keystroke
accounting, completion guards and preference persistence (`store/useTypingStore.ts`), Web Audio and
speech-synthesis graceful degradation (`lib/audio.ts`), the progress-sync schema, route and store —
including concurrent writes of one device and device ids that are not safe filenames — the placement
scoring, model-output validation and route, the writing-correction validators and route, the tutor
history threading and validators, that a tutor conversation stays answerable past the server's
turn cap, and that the sitemap registers every page route.

---

## Progress Sync API

Practice history is local-first (`localStorage`). This optional endpoint mirrors it server-side so
progress survives a cleared browser. It is **auth-less by design** — the client generates a device
id (`crypto.randomUUID()`) and that id *is* the credential.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/progress?deviceId=<id>` | `200 { record }` · `400` · `404` |
| `PUT` | `/api/progress` | `200 { record }` · `400 { error, issues[] }` · `415` |
| `DELETE` | `/api/progress?deviceId=<id>` | `204` · `400` · `404` |

```bash
curl -X PUT http://localhost:3000/api/progress \
  -H 'content-type: application/json' \
  -d '{"deviceId":"<uuid>","stats":{ ...UserStats }}'
```

`PUT` body is `{ deviceId, stats, version? }`. Validation is all-or-nothing and returns the exact
field paths that failed, capped at 20 issues:

```json
{ "error": "invalid_payload",
  "issues": [{ "path": "stats.sessions[1].sourceType",
               "message": "expected one of story, vocab, custom" }] }
```

**Storage.** `lib/progress-store.ts` persists one JSON file per device under `TYPE_STORY_DATA_DIR`
(default `./.data`, gitignored) so the API runs with no infrastructure. `db/schema.sql` holds the
PostgreSQL schema to move to; the swap touches only the three methods on `ProgressStore`, not the
route. **Do not trust this storage in production** — it is single-node, non-transactional, and
discarded on container restart. `deviceId` becomes `user_id` when auth lands.

---

## Placement Test (CEFR A1–B1)

The first AI feature, and the reference shape writing correction followed. The split is
deliberate: **the quiz is scored in code** so it is
reproducible and auditable, and only the free-writing half goes to a model. The final level is
the *narrower* of the two — a learner who aces the quiz but writes at A1 is placed at A1.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/placement` | `200 { questions, writingTask, maxWritingChars, levels, passRate, catalog }` — bank with no answer key |
| `POST` | `/api/placement` | `200 { level, cappedByWriting, objective, writing, writingOutcome }` · `400` · `415` |

```bash
curl -X POST http://localhost:3000/api/placement \
  -H 'content-type: application/json' \
  -d '{"answers":[1,0,2,2,2,2,0,1,2,2,3,0],"writing":"I like Ha Long Bay very much."}'
```

The learner-facing page is `/placement`; it fetches the bank from `GET`, posts the answers,
and renders the level, the per-level breakdown, any writing feedback, and three stories to
start on. `catalog` is `STORIES` projected to `{ slug, title, level, readingTimeMinutes }`:
the page ranks those to recommend something at or below the placed level, hardest first, and
a client import of `data/stories.ts` would have put 32K of prose in the bundle to render three
links. An A1 is placed below the whole corpus — the gentlest story is A2 — so it is shown the
three gentlest and told the catalog starts above them.

**Scoring.** Each of the three levels has four questions; a level is held at 3-of-4
(`PASS_RATE`). The level is the highest one passed *with every level below it also passed* — 3/4 on
B1 and 0/4 on A1 is an A1, not a B1. `writing` is then capped at the model's band; a stronger
writing never raises the result.

**No key, no AI.** Set `ANTHROPIC_API_KEY` to grade the writing. Without it the quiz alone still
places someone and `writing` comes back `null` — TypeStory is client-side-first and free, so an AI
key must never gate the core experience. `writingOutcome` is the field that says *which* of the
four things made it null: `'skipped'` is the one voluntary case, an empty box, and everything that
went wrong after a learner chose to write something is `'failed'`, including a machine that cannot
authenticate. "The writing check is optional" is false of an essay that was thrown away. The test
suite mocks `lib/ai`, so `npm test` needs neither a key nor a network.

**`lib/ai.ts` is the one seam every AI feature goes through:** system prompt in, user message in,
JSON Schema in, decoded JSON out, plus optional `history` for the one multi-turn caller. Routes depend
on `ModelClient`, not on Anthropic. It uses
`claude-opus-5-5` with `output_config.format` for structured output, and server-side fallbacks so a
safety refusal is not a dead end for the learner. `effort` is a per-call argument — placement grades
at `'low'` because it is latency-sensitive classification, writing correction at `'high'` because
prose feedback is worth the extra thinking. Not streaming: every feature so far returns one card of a
few hundred tokens. A long-form tutor is the case that would earn it, and is a swap of `parse` for
`stream` + `finalMessage()` here.

**What bounds the spend.** Every route above is auth-less and reachable by anything with a `fetch`, so
each POST is one metered Opus call with nothing in front of it. `lib/rate-limit.ts` is what answers
instead: twenty calls a minute per `x-forwarded-for` address, and a `429` with a `Retry-After` for the
one after. It is in-memory per process instance, so it bounds a casual loop rather than a determined
attacker — the shared counter that would fix that sits behind the same call. `/api/placement` is the
exception and does not refuse the request: its quiz is scored in code and reaches no model, so the
ceiling sits at the grading call and a throttled essay degrades to `writingOutcome: 'failed'` with the
learner still placed. A request that arrives with no proxy header at all is answered rather than
counted, or a local `next dev` would lock its one user out.

---

## Writing Correction

Paste English you wrote; get back how a fluent speaker would phrase it plus each change explained.
The second AI feature, and the first to take `effort: 'high'`.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/writing` | `200 { minTextChars, maxTextChars }` — no prompt, no schema |
| `POST` | `/api/writing` | `200 { report }` · `400` · `415` · `429` · `502` |

```bash
curl -X POST http://localhost:3000/api/writing \
  -H 'content-type: application/json' \
  -d '{"text":"Yesterday I go to the market with my sister and we come back very late."}'
```

**The page cannot import the limits.** `lib/writing.ts` holds the system prompt, so the page takes
its caps from `GET` and imports only `type { CorrectionReport }`. A value import would be erased at
compile time, but the type import is what keeps the prompt out of the browser bundle — grep
`.next/static/chunks/` for a prompt fragment to confirm.

**Two trust boundaries.** The submission is fenced as `<learner_text>…</learner_text>` so its
contents cannot read as instructions, and the reply is treated as untrusted: the schema is closed
(`additionalProperties: false`) and `parseCorrectionReport` re-checks every field, because a schema
makes output *shaped*, not *correct*. Nothing shorter than 20 characters is graded — that is a
wasted model call, not a correction.

**No key, no AI — but an outage is reported as one.** Set `ANTHROPIC_API_KEY` and the route
calls the model. This used to answer `503 ai_not_configured` *before* `createModelClient`, on the
theory that an unconfigured key is not an outage and should not be reported as one. The SDK never
needed the key — `new Anthropic()` resolves an `ant auth login` credential chain on first *use* —
so that short-circuit could not stop a call that was going to fail; it could only refuse the
machines whose credential was not an env var, which are exactly the ones that would have worked.
There is no `ai_not_configured` code and no `503` on any route: a machine that cannot
authenticate degrades to `502 ai_unavailable`, which is a claim about the world and has to mean
it. Placement, whose half is optional, degrades instead — see below.

---

## English Tutor Chat

The third AI feature and the first with history. Placement and writing correction are single-turn by
nature; "why did it say that?" and "and here?" only mean something against the turn before them.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/tutor` | `200 { maxMessageChars, maxTurns }` — no prompt, no schema |
| `POST` | `/api/tutor` | `200 { reply }` · `400` · `415` · `429` · `502` |

```bash
curl -X POST http://localhost:3000/api/tutor \
  -H 'content-type: application/json' \
  -d '{"history":[{"role":"user","content":"What is a dangling participle?"}],
       "message":"Like \"the dog running\"?"}'
```

**History is untrusted in both directions.** A prior user turn is attacker-controlled and a prior
assistant turn is model output re-fed as if the model had written it, so a learner can put something
in an earlier turn that reads as an instruction later. Every turn is role-checked and length-capped,
the history must open with a user turn (the API rejects the whole call otherwise, so it is caught
here), and the caps are what bound it — the system prompt, not the validator, is what keeps the tutor
on English. `MAX_TURNS` and `MAX_MESSAGE_CHARS` apply to the history too: capping only the current
message would leave the same bytes reachable under a different label.

**A reply over the cap is rejected, not trimmed.** The reply is re-posted as history on the next
turn, so an over-long one would 400 the learner's *next* question with an error about something they
never typed.

**Not streaming.** A reply is a few hundred tokens — the same shape as the other two features. If the
tutor is ever widened into long-form mode, streaming belongs there, and it is a swap of `parse` for
`stream` + `finalMessage()` inside `lib/ai.ts` with nothing else changing.

---

## License

MIT License. Free for learners and developers worldwide.

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
   - Full session history log with quick-reset capabilities.

6. **Interactive Stories Catalog & Search:**
   - Real-time search by story title, author, or keywords.
   - Category filtering (Fables, Literature, Tech & History, Speeches & Essays, Daily Dialogue) and CEFR level filter (Beginner, Intermediate, Advanced).
   - Word count and reading-time sorting.
   - Fluent keyboard flow: press `Enter` on completion cards to immediately advance to the next paragraph or word.

7. **Vocabulary Drills & Word Banks:**
   - Curated collections for Oxford 3000 Essentials, IELTS Academic Mastery, and Tech/Software Engineering English.
   - Flashcard style word-by-word typing practice with phonetic IPA notation, definitions, and translations.

8. **Custom Text Paste Arena:**
   - Paste any article, homework text, coding documentation, or speech to immediately start typing and listening practice.

9. **Engineered for Fast Organic Search Growth (SEO):**
   - 100% statically pre-rendered routes (SSG) for all stories (`/stories/[slug]`), word banks (`/vocab`), and custom mode (`/custom`).
   - Rich JSON-LD structured data: `WebApplication` and `CreativeWork` schemas on every story page.
   - Automated `sitemap.xml` and `robots.txt` generator.
   - OpenGraph and Twitter social preview metadata cards.
   - Semantic HTML5 heading hierarchy and educational FAQ accordion optimized for long-tail Google search snippets.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router with Turbopack)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4
- **State Management:** Zustand
- **Icons:** Lucide React
- **Animations & Delight:** Canvas-Confetti
- **Audio & Speech:** Web Audio API & Web Speech API

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

## License

MIT License. Free for learners and developers worldwide.

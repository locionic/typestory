# TypeStory (Learn English by Typing & Speaking Stories)

TypeStory is an interactive, open-access keyboard typing and English language learning platform. Inspired by the muscle-memory concept of `qwerty-learner`, TypeStory combines touch typing practice with real-world English stories, Oxford 3000 vocabulary banks, mechanical keyboard audio feedback, and native microphone speech recognition.

---

## Key Features

1. **Contextual Story Typing Practice:**
   - Instead of typing random characters or isolated words, practice with authentic literature, speeches, history, and real-life dialogues (Aesop Fables, O. Henry, Steve Jobs Commencement Speech, Tim Berners-Lee Web History, Daily Coffee Shop Dialogue).
   - Paragraph-by-paragraph progression with auto-advance, backspace correction, real-time WPM, accuracy %, and error tracking.
   - Built-in English-Vietnamese vocabulary glossaries with phonetics and parts of speech for every story.

2. **Microphone Pronunciation Assessment (Native Speech Recognition):**
   - Built with the browser-native Web Speech API (`SpeechRecognition` and `webkitSpeechRecognition`).
   - Listen to native Text-To-Speech (TTS) narration with customizable accents and speech rates.
   - Click the microphone icon to read sentences aloud: the engine compares recognized speech against target text using normalized phonetic token alignment, reporting an accuracy percentage and highlight breakdown.
   - Zero external cloud latency, zero API costs, and 100% client-side privacy.

3. **Mechanical Keyboard Audio Synthesizer:**
   - Synthesizes authentic keyboard switch sounds directly using the HTML5 Web Audio API (Cherry MX Blue clicky, Cherry MX Brown tactile, Bubble pop, and Mute mode).
   - Zero audio file download latency or CDN failure risks.

4. **Vocabulary Drills & Word Banks:**
   - Curated collections for Oxford 3000 Essentials, IELTS Academic Mastery, and Tech/Software Engineering English.
   - Flashcard style word-by-word typing practice with phonetic IPA notation and definitions.

5. **Custom Text Paste Arena:**
   - Paste any article, homework text, coding documentation, or speech to immediately start typing and speaking practice.

6. **Engineered for Fast Organic Search Growth (SEO):**
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

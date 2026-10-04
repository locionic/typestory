export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type SourceType = 'story' | 'vocab' | 'custom';

export interface VocabItem {
  word: string;
  phonetic?: string;
  pos?: string; // part of speech
  definition: string;
  translation?: string; // e.g. Vietnamese or second language
  example?: string;
}

export interface StoryItem {
  id: string;
  slug: string;
  title: string;
  /**
   * What to credit, when the credit is a real author.
   *
   * Seven of the eleven are not: "Full-Stack Interview Series", "Everyday Dialogues",
   * "Tech History". They read fine as a source but not as a byline, and they are not
   * people — which the page never checked, so the story page asserted
   * `author: { '@type': 'Person', name: 'Everyday Dialogues' }` and the same name as an
   * OpenGraph `article:author`. A person who does not exist, in the two formats a search
   * engine parses rather than reads.
   *
   * Required rather than optional so every story has to say which it is. It is not
   * derivable: `category` comes close — every non-person here is `tech` or `dialogue` —
   * but "Grace Hopper & Computing History" is a real name under `tech`, and the next
   * person to write one would silently lose their byline.
   */
  authorIsPerson: boolean;
  author: string;
  category: 'classic' | 'fable' | 'tech' | 'dialogue' | 'essay';
  level: CefrLevel;
  /**
   * The story's subject, as a short badge: "Full-Stack Q&A", "Tech History",
   * "Inspirational Speech".
   *
   * Named for difficulty, and for nine of the eleven stories it is not one — it is what
   * the story is *about*. The two that do read as difficulty ("Beginner Friendly" on the
   * A2 tortoise fable, "Intermediate" on the B2 gift of the magi) happen to agree with
   * `level`, which is why the mismatch went unnoticed. Both surfaces render it beside
   * the level rather than inside it for that reason: `test/storyReader.test.ts` pins the
   * level pill to the level alone, so a subject can never be presented as what the level
   * means.
   */
  difficultyLabel: string;
  summary: string;
  /**
   * How many words the passage contains, from the paragraphs themselves.
   *
   * Derived rather than written out, which every sibling below is too and which this one
   * used not to be: a hand-written count has to be edited alongside the paragraph it
   * counts, and nothing enforces that. What this is printed for is the widest reach of any
   * field here — the reading time beside it, the catalog's "shortest" and "longest" sorts,
   * and the `wordCount` the story JSON-LD publishes to search engines.
   *
   * The `Q:` and `A:` markers on a drill paragraph count as words, which reads as a bug and
   * is not: `wordsTyped` in lib/stats.ts splits the same way, and the learner really did
   * type both markers. Stripping them here alone would leave the card advertising fewer
   * words than a finished run is paid for. `test/storyWordCount.test.ts` holds the two
   * together.
   */
  wordCount: number;
  /**
   * Whether this is an interview Q&A drill, derived from the paragraphs.
   *
   * Not the same question as `category: 'tech'`, which is the "Tech & Engineering" browse
   * filter and is true of every technology story. Two of the six are narrative essays, and
   * reading the category as "is this a set of questions" told a learner opening the
   * Berners-Lee story that its six paragraphs were "Question 1 of 6" under a heading
   * reading "Technical Interview Questions & Model Answers". Derived, so editing a
   * paragraph to add or drop its `Q:` moves the labels with it.
   */
  isQA: boolean;
  /**
   * How many of `paragraphs` are drills, for the "N Q&A Questions" on the catalog card.
   *
   * `isQA` cannot supply this. It answers `some`, on purpose, so a story that is one
   * drill among prose is still shown as what it mostly is rather than flattened to "not
   * a drill" — but the card read `paragraphs.length` beside that flag, which answers
   * `every`. The two disagreed by construction and agreed only because the corpus
   * happens to be uniform: all four drill stories have every paragraph a drill. Adding
   * the one paragraph `some` was chosen to accommodate — a Q&A module introduced by a
   * paragraph of context — printed "13 Q&A Questions" over a story holding one.
   *
   * Derived, as `wordCount` above is: a hand-written count would have to be edited
   * alongside the paragraph it counts, and nothing enforces that.
   */
  qaCount: number;
  readingTimeMinutes: number;
  coverEmoji: string;
  paragraphs: string[];
  keyVocabulary: VocabItem[];
}

export type SwitchSound = 'blue' | 'brown' | 'bubble' | 'mute';

export interface TypingSessionRecord {
  id: string;
  timestamp: number;
  dateStr: string; // YYYY-MM-DD
  title: string;
  sourceType: SourceType;
  wpm: number;
  accuracy: number;
  durationSeconds: number;
  wordsCount: number;
  keystrokes: number;
}

export interface UserStats {
  sessions: TypingSessionRecord[];
  dailyStreak: {
    currentStreak: number;
    bestStreak: number;
    lastActiveDate: string; // YYYY-MM-DD
  };
  totalWordsTyped: number;
  totalTimeSpentSeconds: number;
  bestWpm: number;
  averageWpm: number;
  averageAccuracy: number;
  /**
   * The best accuracy ever recorded, over every session and not just the stored window.
   *
   * `bestWpm` and `dailyStreak.bestStreak` are both lifetime, because both are things a
   * learner did once and cannot un-do. Accuracy was not, and the Pure Precision badge
   * read it out of `sessions` — a list capped at MAX_SESSIONS and sliced on both read
   * and write. Type a passage perfectly, then record 100 more sessions, and the run
   * that earned it falls off the end: a milestone the app silently takes back, with no
   * "no longer true" and nothing the learner did to deserve it.
   *
   * Required, not optional, so `Math.max` can never see `undefined` at a call site.
   * Records written before this field existed are given one on read — see
   * `sanitiseUserStats` and `parseStats`, which derive it from the sessions they still
   * hold rather than refusing the record.
   */
  bestAccuracy: number;
}

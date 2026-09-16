import { VocabItem } from '../lib/types';

export interface VocabCategory {
  id: string;
  slug: string;
  title: string;
  description: string;
  badge: string;
  iconEmoji: string;
  words: VocabItem[];
}

export const VOCAB_BANKS: VocabCategory[] = [
  {
    id: 'oxford-3000',
    slug: 'oxford-essential',
    title: 'Oxford 3000 Essentials',
    description: 'The core English vocabulary every fluent speaker needs for everyday conversations and reading.',
    badge: 'Core Foundation',
    iconEmoji: '📚',
    words: [
      {
        word: 'achieve',
        phonetic: '/əˈtʃiːv/',
        pos: 'verb',
        definition: 'Successfully bring about or reach a desired objective by effort or skill.',
        translation: 'đạt được',
        example: 'She worked tirelessly to achieve her lifelong ambition.',
      },
      {
        word: 'benefit',
        phonetic: '/ˈben.ə.fɪt/',
        pos: 'noun',
        definition: 'An advantage or profit gained from something.',
        translation: 'lợi ích',
        example: 'Regular exercise offers immense health benefits.',
      },
      {
        word: 'challenge',
        phonetic: '/ˈtʃæl.ɪndʒ/',
        pos: 'noun',
        definition: 'A task or situation that tests someone\'s abilities.',
        translation: 'thử thách',
        example: 'Learning a new language is a demanding but rewarding challenge.',
      },
      {
        word: 'discover',
        phonetic: '/dɪˈskʌv.ɚ/',
        pos: 'verb',
        definition: 'Find unexpectedly or in the course of a search.',
        translation: 'khám phá',
        example: 'Scientists discovered an ancient manuscript deep in the desert caves.',
      },
      {
        word: 'efficient',
        phonetic: '/ɪˈfɪʃ.ənt/',
        pos: 'adj',
        definition: 'Achieving maximum productivity with minimum wasted effort or expense.',
        translation: 'hiệu quả',
        example: 'The new high-speed rail offers an efficient transit option.',
      },
      {
        word: 'generate',
        phonetic: '/ˈdʒen.ə.reɪt/',
        pos: 'verb',
        definition: 'Cause something, especially an emotion or situation, to arise or come about.',
        translation: 'tạo ra / phát sinh',
        example: 'Wind turbines generate clean, renewable electricity.',
      },
      {
        word: 'improve',
        phonetic: '/ɪmˈpruːv/',
        pos: 'verb',
        definition: 'Make or become better.',
        translation: 'cải thiện',
        example: 'Daily typing practice will improve your typing speed and muscle memory.',
      },
      {
        word: 'knowledge',
        phonetic: '/ˈnɑː.lɪdʒ/',
        pos: 'noun',
        definition: 'Facts, information, and skills acquired through experience or education.',
        translation: 'kiến thức',
        example: 'Sharing knowledge freely empowers communities worldwide.',
      },
    ],
  },
  {
    id: 'ielts-academic',
    slug: 'ielts-academic',
    title: 'IELTS Academic Vocabulary',
    description: 'High-scoring academic collocations and abstract nouns for IELTS Band 7.5+ writing and speaking.',
    badge: 'Exam Prep',
    iconEmoji: '🎓',
    words: [
      {
        word: 'ubiquitous',
        phonetic: '/juːˈbɪk.wə.t̬əs/',
        pos: 'adj',
        definition: 'Present, appearing, or found everywhere simultaneously.',
        translation: 'phổ biến ở khắp mọi nơi',
        example: 'Smartphones have become ubiquitous across modern urban life.',
      },
      {
        word: 'substantiate',
        phonetic: '/səbˈstæn.ʃi.eɪt/',
        pos: 'verb',
        definition: 'Provide evidence to support or prove the truth of a claim.',
        translation: 'chứng minh / xác thực',
        example: 'Researchers must substantiate their hypotheses with rigorous clinical data.',
      },
      {
        word: 'mitigate',
        phonetic: '/ˈmɪt̬.ə.ɡeɪt/',
        pos: 'verb',
        definition: 'Make less severe, serious, or painful.',
        translation: 'giảm nhẹ / làm dịu',
        example: 'Reforestation initiatives help mitigate the impacts of climate change.',
      },
      {
        word: 'pragmatic',
        phonetic: '/præɡˈmæt̬.ɪk/',
        pos: 'adj',
        definition: 'Dealing with things sensibly and realistically in a way that is based on practical conditions.',
        translation: 'thực tế / thực dụng',
        example: 'We must adopt a pragmatic approach to renewable energy infrastructure.',
      },
      {
        word: 'corroborate',
        phonetic: '/kəˈrɑː.bə.reɪt/',
        pos: 'verb',
        definition: 'Confirm or give support to a statement, theory, or finding.',
        translation: 'chứng thực / củng cố',
        example: 'Independent forensic studies corroborate the witness testimony.',
      },
    ],
  },
  {
    id: 'tech-developer',
    slug: 'tech-developer',
    title: 'Developer & Tech English',
    description: 'Essential terminology for software engineers, code reviews, documentation, and technical interviews.',
    badge: 'Software Engineering',
    iconEmoji: '💻',
    words: [
      {
        word: 'asynchronous',
        phonetic: '/eɪˈsɪŋ.krə.nəs/',
        pos: 'adj',
        definition: 'Not occurring at the same time; executing tasks without blocking the main execution thread.',
        translation: 'bất đồng bộ',
        example: 'Asynchronous I/O allows node servers to handle thousands of concurrent connections.',
      },
      {
        word: 'idempotent',
        phonetic: '/ˌaɪ.dəmˈpoʊ.tənt/',
        pos: 'adj',
        definition: 'An operation that can be applied multiple times without changing the result beyond the initial application.',
        translation: 'bất biến qua các lần lặp',
        example: 'HTTP PUT and DELETE endpoints must remain strictly idempotent.',
      },
      {
        word: 'immutable',
        phonetic: '/ɪˈmjuː.t̬ə.bəl/',
        pos: 'adj',
        definition: 'Unchanging over time or unable to be modified after creation.',
        translation: 'bất biến / không thể thay đổi',
        example: 'Functional programming favors immutable data structures to prevent race conditions.',
      },
      {
        word: 'concurrency',
        phonetic: '/kənˈkɝː.ən.si/',
        pos: 'noun',
        definition: 'The ability of different parts or units of a program to be executed out-of-order without affecting the final outcome.',
        translation: 'tính đồng thời',
        example: 'Go routines provide lightweight concurrency primitives with minimal memory overhead.',
      },
      {
        word: 'refactor',
        phonetic: '/riːˈfæk.tɚ/',
        pos: 'verb',
        definition: 'Restructure existing computer code without changing its external behavior.',
        translation: 'tái cấu trúc mã nguồn',
        example: 'We decided to refactor the monolithic auth module into smaller composable services.',
      },
    ],
  },
];

'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Flame,
  Zap,
  Target,
  BookOpen,
  Clock,
  Trash2,
  Award,
  CheckCircle2,
  CloudUpload,
  CloudOff,
  Copy,
  Download,
} from 'lucide-react';
import { useUserStats, clearUserStats, liveStreak, saveUserStats } from '../../lib/stats';
import {
  useBackupCode,
  useBackupPushFailed,
  enableBackup,
  disableBackup,
  adoptBackupCode,
  fetchBackup,
  getBackupCode,
  pushProgress,
} from '../../lib/progress-client';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The dialog's name, wired to its own heading — one constant so the two cannot disagree. */
const STATS_TITLE_ID = 'stats-modal-title';

/**
 * The unit a count is counted in, so one does not arrive as a plural.
 *
 * Four sentences in this panel put a hardcoded plural after a count, and one is not an edge
 * case: a learner's first finished session makes `currentStreak`, `bestStreak` and
 * `sessions.length` all 1, and this panel is what they open to see it. Zero was already
 * right and two was already right, which is why it survived — the suite pins "0 days" and
 * "12 days" and never a 1.
 *
 * `day${n === 1 ? '' : 's'}` is the form `components/Navbar.tsx` uses in its own aria-label,
 * for the same figure. That one was right and this one was not, which is the drift a copy
 * is worth having once for: a shared helper would have put both on the same rule, and the
 * remaining inline copy in Navbar and in `app/custom/page.tsx` is left as it is rather than
 * spread further for a suffix.
 */
const unit = (count: number, singular: string): string => (count === 1 ? singular : `${singular}s`);

export default function StatsModal({ isOpen, onClose }: StatsModalProps) {
  const stats = useUserStats();
  const backupCode = useBackupCode();
  const pushFailed = useBackupPushFailed();
  const [codeInput, setCodeInput] = useState('');
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const startBackup = () => {
    if (!enableBackup()) {
      setBackupMessage('This browser will not let the app store a backup code.');
      return;
    }
    // Upload what is already here rather than making the first backup wait for the
    // next finished passage.
    pushProgress(stats);
    setBackupMessage('Backup is on. Keep this code — it is the only way back in.');
  };

  const stopBackup = async () => {
    const ok = confirm(
      'Stop backing up and delete the stored copy? Your progress stays in this browser, ' +
        'but there will be nothing left to restore from.',
    );
    if (!ok) return;
    setCodeInput('');
    // Asked, not assumed. `disableBackup` used to return nothing and swallow every
    // failure, so this said "the stored copy was deleted" over a request that had not
    // been sent, let alone answered — and the code needed to check was already gone, so
    // the learner had no way to confirm it themselves. A partial result still gets a plain
    // sentence: backup is off either way, which is the part they actually asked for.
    const deleted = await disableBackup();
    setBackupMessage(
      deleted
        ? 'Backup is off, and the stored copy was deleted.'
        : 'Backup is off, but the stored copy could not be deleted — it may still be on the server.',
    );
  };

  const copyCode = async () => {
    if (!backupCode) return;
    if (!navigator.clipboard) {
      setBackupMessage('Clipboard access is blocked here — select the code and copy it.');
      return;
    }
    try {
      await navigator.clipboard.writeText(backupCode);
      setBackupMessage('Code copied.');
    } catch {
      setBackupMessage('Could not copy — select the code and copy it by hand.');
    }
  };

  const restore = async () => {
    const wanted = codeInput.trim();
    setRestoring(true);
    const found = await fetchBackup(wanted);

    if (!found.ok) {
      setBackupMessage(found.error);
      setRestoring(false);
      return;
    }

    // Confirm only now: there is nothing to warn about until a backup has been
    // found. Without one of its own, this device's copy cannot be recovered.
    //
    // Three states rather than two, and the third is the one that mattered. The saving
    // below passes `upload = false` so the pre-restore history survives on the server
    // under this device's own code instead of being overwritten by what was just fetched —
    // which is only a place it can survive if it got there. It did not, when the last push
    // was refused: `pushProgress` is fire-and-forget, so a device can hold a code for
    // weeks with nothing on the server, and this panel says so, in the amber notice above
    // the button this dialog is behind — "the last upload did not reach the server… nothing
    // has been lost".
    //
    // On that device the promise below was the opposite of the notice beside it, both on
    // screen at once. Agreeing overwrote localStorage and uploaded nothing, by design, so
    // the history was on neither side and the sentence above had just become false.
    let recovery = 'What is here now stays recoverable under this device’s own code.';
    if (!backupCode) {
      recovery = 'This device has no backup of its own, so what is here now cannot be recovered.';
    } else if (pushFailed) {
      recovery =
        'The last upload from this device did not reach the server, so what is here now is ' +
        'not on it, and restoring does not upload it first — so this cannot be recovered.';
    }
    const ok = confirm(`Replace the progress on this device with that backup? ${recovery}`);
    if (!ok) {
      setRestoring(false);
      return;
    }

    // Stored before the code is switched over, and not uploaded at all.
    //
    // Adopting first meant a refused write left the device pointing at the code the
    // learner had just typed, holding a backup that did not contain the progress they
    // were told was restored. Saving first and bailing means neither happened.
    //
    // The upload is the other half of that, and it was the half this ordering broke.
    // `saveUserStats` pushes on every write, and `pushProgress` reads the code live at
    // call time — so saving here uploaded the restored record under the code the device
    // was *still* on, and the PUT is a whole-record overwrite. The confirmation above had
    // just promised that the pre-restore history "stays recoverable under this device's
    // own code", and that is precisely the copy it destroyed, one line later, with no
    // indication anything had gone. `WANTED` already holds this record: it was fetched
    // from there a moment ago, so there is nothing to send, and the next finished passage
    // uploads whatever this becomes.
    if (!saveUserStats(found.stats, false)) {
      setBackupMessage(
        'This browser would not let the app store the restored progress, so nothing was ' +
          'changed. What is on this device now is exactly what was here before.',
      );
      setRestoring(false);
      return;
    }

    // The one caller that never asked `adoptBackupCode` whether it worked. It returns
    // false rather than swallowing a storage failure, and both of its siblings in this
    // file check it and tell the learner which answer they got — see `stopBackup`. The
    // sentence below is only true when it came back true: when the write is refused the
    // device keeps whatever code it already had, so the progress just restored is
    // uploaded under *that* one while this names the one that was typed, and the learner
    // is left believing their history is under a code it is not. `getBackupCode` is the
    // state that decides it, and it distinguishes the two ways to be wrong without a
    // second return value: "still backing up to the old one" and "nothing is backed up"
    // are different sentences and only one of them is true at a time.
    const adopted = adoptBackupCode(wanted);
    setCodeInput('');

    if (adopted) {
      setBackupMessage('Restored. This device backs up to that code from now on.');
    } else {
      const stillOn = getBackupCode();
      setBackupMessage(
        `Restored, but this browser would not let the app store that code, so ${
          stillOn ? `this device is still backing up to ${stillOn}` : 'nothing is backed up'
        }.`,
      );
    }
    setRestoring(false);
  };

  /**
   * Being a dialog, rather than a div that looks like one.
   *
   * Three keyboard failures stack in this panel, and fixing any one alone leaves the
   * other two: it was never announced, so nothing said a dialog had opened; focus stayed
   * on the trigger *behind* the backdrop, so Tab walked content the learner cannot see;
   * and with no Escape handler the only exit was the close button, which until last
   * turn had no name either. A learner using the keyboard alone could open this and have
   * no way to tell what had happened.
   *
   * Focus goes to the panel itself rather than to the close button, which is the standard
   * ordering: the dialog's own name is then announced, where focusing a control announces
   * only that control. `tabIndex={-1}` is what makes a div focusable at all — without it
   * the ref below resolves and `.focus()` is a no-op, which would look identical to this
   * working.
   */
  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Seconds, until there are enough of them to be worth rounding into minutes.
  //
  // The "~" above this number is what makes `Math.round` fair: 12.5 minutes legitimately
  // reads "~13 min". It cannot do that job at zero. A first run is tens of seconds — a
  // short passage, one sitting — and `Math.round` printed that as `~0 min` on the same line
  // as a word count saying 45, on the card a learner opens the moment they finish their
  // first session. Zero minutes is not an approximation of twenty seconds; there is no
  // value of it here to be approximately.
  const streakDays = liveStreak(stats.dailyStreak);

  // The window both headline averages were taken over, named once.
  //
  // These are two cards in one grid, and both figures come from the same list: the accuracy
  // card is `Math.floor`ed at `lib/stats.ts:443` and the speed card rounded at `:444`, each
  // over `updatedSessions` — the newest-first array that becomes `stats.sessions`. So the
  // count is one number, and it used to be rendered twice with only one of the two
  // renderings saying so: the accuracy card carried "Last N sessions" because a literal 100
  // was true of nobody below a hundred, and the speed card sat beside it reading a bare
  // "Avg", directly under a lifetime peak. "Avg" is the word that most invites the lifetime
  // reading, and nothing on that card said otherwise.
  //
  // One constant rather than the same sentence written twice, because the failure this is
  // fixing is precisely the two drifting apart. It needs no cap of its own: `sanitizeSessions`
  // truncates the array to `MAX_SESSIONS` on the way in and on the way out, so the count is
  // already bounded by the same limit the averages are taken over.
  const sessionCount = stats.sessions.length;
  const sessionWindow = `Last ${sessionCount} ${unit(sessionCount, 'session')}`;

  const totalTime =
    stats.totalTimeSpentSeconds < 60
      ? `${stats.totalTimeSpentSeconds}s`
      : `${Math.round(stats.totalTimeSpentSeconds / 60)} min`;

  // Achievement logic
  const achievements = [
    {
      id: 'first_step',
      title: 'First Flight',
      desc: 'Complete your first practice session',
      unlocked: stats.sessions.length >= 1,
      icon: '🌱',
    },
    {
      id: 'speed_50',
      title: 'Speed Sprinter',
      desc: 'Achieve 50+ WPM in any session',
      unlocked: stats.bestWpm >= 50,
      icon: '⚡',
    },
    {
      id: 'speed_75',
      title: 'Typing Virtuoso',
      desc: 'Achieve 75+ WPM in any session',
      unlocked: stats.bestWpm >= 75,
      icon: '🚀',
    },
    {
      id: 'perfectionist',
      title: 'Pure Precision',
      desc: 'Complete a session with 100% accuracy',
      // `bestAccuracy`, not `sessions.some(...)`. This was the only badge reading the
      // rolling window, so it was the only one the app could take back: type a passage
      // perfectly, record 100 more sessions, and the run that earned this falls off the
      // end of the list — "Milestone Badges (5/6)" becomes "(4/6)" for something that
      // never stopped being true. The other four already read lifetime fields
      // (`bestWpm`, `dailyStreak.bestStreak`, `totalWordsTyped`) for exactly that reason.
      unlocked: stats.bestAccuracy >= 100,
      icon: '🎯',
    },
    {
      id: 'streak_3',
      title: 'Consistency King',
      desc: 'Maintain a 3-day typing streak',
      unlocked: stats.dailyStreak.bestStreak >= 3,
      icon: '🔥',
    },
    {
      id: 'words_1000',
      title: 'Vocabulary Scholar',
      desc: 'Type over 1,000 words total',
      unlocked: stats.totalWordsTyped >= 1000,
      icon: '📖',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={STATS_TITLE_ID}
        tabIndex={-1}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-800 dark:bg-gray-900"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <h2 id={STATS_TITLE_ID} className="text-lg font-bold text-gray-900 dark:text-white">
                Typing &amp; Learning Analytics
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Your personal muscle memory and language milestones
              </p>
            </div>
          </div>
          {/* Named, and it is the only way out: the backdrop carries no onClick and no
              key handler closes this, so a screen reader reaches an unnamed "button" as
              the sole exit from a modal it was never told it was in. The X is the whole
              label for anyone who cannot see it. Everything else in this panel is found
              by its text — which is exactly why this one was missed. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close statistics"
            className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Daily Streak */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5 dark:border-amber-900/30 dark:bg-amber-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                <Flame className="h-4 w-4 text-amber-500 fill-amber-500" />
                <span>Streak</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-amber-900 dark:text-amber-200">
                {streakDays}{' '}
                <span className="text-xs font-normal">{unit(streakDays, 'day')}</span>
              </div>
              {/* `bestStreak` is a lifetime figure, not a claim about today, so it is
                  read straight: this card's current number is the lapsed-and-decayed one
                  and the best below it never lapses. See `liveStreak`. */}
              <div className="text-[10px] text-amber-700/80 dark:text-amber-400/70">
                Best: {stats.dailyStreak.bestStreak} {unit(stats.dailyStreak.bestStreak, 'day')}
              </div>
            </div>

            {/* Peak Speed */}
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3.5 dark:border-indigo-900/30 dark:bg-indigo-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-400">
                <Zap className="h-4 w-4 text-indigo-500 fill-indigo-500" />
                <span>Peak Speed</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-indigo-900 dark:text-indigo-200">
                {stats.bestWpm}{' '}
                <span className="text-xs font-normal">WPM</span>
              </div>
              {/* The window, because the number above is a peak and this is its opposite —
                  and because `averageWpm` is not a lifetime mean. It is over the stored
                  history, so it changes meaning as the history fills: at three sessions it
                  is everything the learner has ever done, at a hundred it is a rolling
                  recent figure, and "Avg" alone cannot tell those two apart. */}
              <div className="text-[10px] text-indigo-700/80 dark:text-indigo-400/70">
                Avg: {stats.averageWpm} WPM · {sessionWindow}
              </div>
            </div>

            {/* Accuracy */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <Target className="h-4 w-4 text-emerald-500" />
                <span>Accuracy</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-emerald-900 dark:text-emerald-200">
                {/* A dash rather than the stored value until there is a session to
                    average. `DEFAULT_STATS.averageAccuracy` is 100 — a sentinel, since the
                    field is a percent the schema bounds and a push has to carry — and 100
                    is the best number this card can ever show, so rendering it read as a
                    measurement of a learner who had not typed a character: 100% accuracy
                    sitting beside 0 WPM and 0 words, all four read at once on first open.
                    Zero is no better — that claims every key was wrong. The other three
                    cards dodge this by defaulting to 0, which reads honestly; this one
                    cannot, so it says it has nothing to say yet. */}
                {sessionCount === 0 ? '—' : `${stats.averageAccuracy}%`}
              </div>
              {/* `sessionWindow`, not the sentence: the literal 100 this replaced was
                  right only once a learner had 100 sessions and wrong for every learner
                  before that — "Last 100 sessions" beside an average of three, which is
                  the reading it invited. Why it is one constant shared with the speed card
                  is at its declaration above. */}
              <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/70">
                {sessionWindow}
              </div>
            </div>

            {/* Practice Volume */}
            <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-3.5 dark:border-purple-900/30 dark:bg-purple-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700 dark:text-purple-400">
                <BookOpen className="h-4 w-4 text-purple-500" />
                <span>Volume</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-purple-900 dark:text-purple-200">
                {stats.totalWordsTyped.toLocaleString()}
              </div>
              <div className="text-[10px] text-purple-700/80 dark:text-purple-400/70">
                words (~{totalTime})
              </div>
            </div>
          </div>

          {/* Progress Backup */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/40 p-4 dark:border-gray-800 dark:bg-gray-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                {backupCode ? (
                  <CloudUpload className="h-4 w-4 text-indigo-500" />
                ) : (
                  <CloudOff className="h-4 w-4 text-gray-400" />
                )}
                Progress Backup
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  backupCode
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {backupCode ? 'On' : 'Off'}
              </span>
            </div>

            {!backupCode ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-sm text-xs leading-snug text-gray-500 dark:text-gray-400">
                  Your history lives in this browser only. A backup keeps a copy on the
                  server you can restore after clearing site data or switching machines.
                </p>
                <button
                  type="button"
                  onClick={startBackup}
                  className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  <span>Back up my progress</span>
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="select-all break-all rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    {backupCode}
                  </code>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopBackup}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 transition hover:text-rose-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Stop and delete</span>
                  </button>
                </div>
              </div>
            )}

            {/* Available in both states: restoring onto a device that has lost its
                data is exactly the case where no code exists here yet. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="Backup code to restore from"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Paste a backup code"
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-gray-700 placeholder:font-sans focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <button
                type="button"
                onClick={restore}
                disabled={restoring || !codeInput.trim()}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Download className="h-3.5 w-3.5 text-indigo-500" />
                <span>{restoring ? 'Restoring…' : 'Restore'}</span>
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-gray-400">
              Restoring replaces everything on this device and points it at that code.
            </p>

            {backupMessage && (
              <p role="status" className="mt-3 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                {backupMessage}
              </p>
            )}

            {/* The one thing this panel could not say before: that the backup had stopped.

                `pushProgress` reports nothing, so a run refused at the server — a whole
                record refused for one bad field — was indistinguishable from a saved one,
                and the learner only found out on another machine with nothing to restore.

                Gated on the code because a push that was already on the wire settles after
                `disableBackup` has cleared it, and its verdict describes a backup that no
                longer exists. Worded to stop short of alarm: the session is safe in this
                browser, which is what the panel is for. */}
            {backupCode && pushFailed && (
              <p
                role="status"
                className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
              >
                Backup is on, but the last upload did not reach the server. Your progress is
                safe in this browser and nothing has been lost — it just is not reaching the
                server right now.
              </p>
            )}
          </div>

          {/* Achievement Badges */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
              Milestone Badges ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
            </h3>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {achievements.map((item) => (
                <div
                  key={item.id}
                  /* Locked is a grey card, not a faded one. It carried `opacity-50` to say
                    * "not yet earned", which halves every colour inside the element rather
                    * than only the background the class was picked for: the milestone name
                    * measured 1.31:1 in light mode and its description 1.25:1, against the
                    * 4.5:1 SC 1.4.3 asks of 10-12px text. The whole point of a locked badge
                    * is to tell the learner what to aim at, and that one said nothing. The
                    * border and fill still separate the two states, and unlocked keeps the
                    * tick beside its name. See dimmedText in test/statsModal.test.ts. */
                  className={`flex items-start gap-2.5 rounded-2xl border p-3 transition ${
                    item.unlocked
                      ? 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20'
                      : 'border-gray-200 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-800'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">
                        {item.title}
                      </span>
                      {item.unlocked && (
                        <CheckCircle2 className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Practice Log */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Recent Sessions ({stats.sessions.length})
              </h3>
              {stats.sessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    // Names three things, because the reset takes three: this removes the
                    // whole stored record, and `dailyStreak` is in it. It is also the only
                    // one of the three that cannot be rebuilt by doing the thing — a cleared
                    // history comes back after one more passage, a streak comes back a day
                    // at a time — so the confirmation says so rather than leaving the
                    // learner to find out. See test/statsModal.test.ts.
                    if (
                      confirm(
                        'Reset your typing stats, session history and streak? ' +
                          'The streak cannot be rebuilt by practising — it takes one day per day.',
                      )
                    ) {
                      clearUserStats();
                    }
                  }}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-500 hover:text-rose-600"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Reset Stats</span>
                </button>
              )}
            </div>

            {/* Every session in the list, not the newest fifteen: the box scrolls, so the
                slice bought nothing and cost the learner their history. The heading counts
                all of them, so a learner with twenty sessions was told twenty and shown
                fifteen, the other five unreachable from anywhere in the app. `MAX_SESSIONS`
                is 100, and a hundred rows in a scrolling box is nothing to render. */}
            {stats.sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-xs text-gray-400 dark:border-gray-800">
                No typing sessions recorded yet. Complete any story or vocabulary drill to see your stats here!
              </div>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {stats.sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-xs dark:border-gray-800 dark:bg-gray-800/60"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-gray-800 dark:text-gray-200">
                          {session.title}
                        </span>
                        <span className="rounded bg-gray-200 px-1.5 py-0.2 text-[9px] font-bold uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {session.sourceType}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                        <Clock className="h-2.5 w-2.5" />
                        <span>{session.dateStr}</span>
                        <span>•</span>
                        <span>{session.wordsCount} {unit(session.wordsCount, 'word')} in {session.durationSeconds}s</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="font-mono font-black text-indigo-600 dark:text-indigo-400">
                          {session.wpm} WPM
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {session.accuracy}% acc
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Synthesized mechanical keyboard sounds & native speech TTS
import { SwitchSound } from './types';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private soundType: SwitchSound = 'blue';

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setSoundType(type: SwitchSound) {
    this.soundType = type;
  }

  public getSoundType(): SwitchSound {
    return this.soundType;
  }

  public playKeyClick() {
    if (this.soundType === 'mute') return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (this.soundType === 'blue') {
        // Crisp clicky switch
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200 + Math.random() * 200, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.035);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      } else if (this.soundType === 'brown') {
        // Deep tactile switch
        osc.type = 'sine';
        osc.frequency.setValueAtTime(380 + Math.random() * 40, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.045);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      } else {
        // Bubble pop sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.04);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(now + 0.05);
    } catch {
      // Audio fails silently if blocked
    }
  }

  public playSuccessChime() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6
      notes.forEach((freq, idx) => {
        const start = ctx.currentTime + idx * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.35);
      });
    } catch {
      // Audio error ignored
    }
  }

  // Native Web Speech Synthesis TTS
  public speak(text: string, voiceLang: 'en-US' | 'en-GB' = 'en-US') {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // Stop any pending utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = voiceLang;
      utterance.rate = 0.95; // Slightly measured rate for language learning
      utterance.pitch = 1.0;

      // Prefer a natural English voice if available
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice = voices.find(
        (v) => v.lang.startsWith(voiceLang) || v.lang.startsWith('en')
      );
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore TTS error
    }
  }
}

export const soundEngine = new SoundEngine();

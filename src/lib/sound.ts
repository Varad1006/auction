"use client";

// Tiny synthesized sound effects (no audio files). Browsers only allow audio
// after a user gesture, so call unlockAudio() from a tap/click first.

type Win = Window & { webkitAudioContext?: typeof AudioContext };
let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const C = window.AudioContext ?? (window as Win).webkitAudioContext;
    if (!C) return;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function play(notes: [freq: number, start: number, duration: number][], type: OscillatorType, volume: number) {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (const [freq, start, duration] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.05);
  }
}

export const sounds = {
  /** Bright two-note chime: a wishlisted player is up. */
  wishlist: () =>
    play(
      [
        [880, 0, 0.18],
        [1319, 0.15, 0.4],
        [880, 0.6, 0.18],
        [1319, 0.75, 0.4],
      ],
      "sine",
      0.25,
    ),
  /** Two sharp descending beeps. */
  outbid: () =>
    play(
      [
        [988, 0, 0.14],
        [740, 0.16, 0.22],
      ],
      "square",
      0.12,
    ),
  /** Rising arpeggio. */
  won: () =>
    play(
      [
        [523, 0, 0.16],
        [659, 0.12, 0.16],
        [784, 0.24, 0.16],
        [1047, 0.36, 0.35],
      ],
      "triangle",
      0.2,
    ),
};

const KEY = "auction:sound";

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
}

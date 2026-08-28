/**
 * Generates video/public/bed.wav — the 30-second audio bed, from scratch.
 *
 * Synthesised rather than sourced. A launch post is a commercial use, and every
 * "royalty-free" library track carries an attribution or licence term that has to
 * be honoured and tracked; generating the bed means the audio is ours outright,
 * with no third-party terms attached to a file that will be reposted.
 *
 * It also lets the music hit the picture exactly. Every accent below is placed at
 * a frame number taken from the same SCENES table the visuals use, so the blips
 * land on the access boxes filling, the three-note motif lands on the plan ticks
 * being drawn, and the bloom lands on the cut into the CTA. Cutting a stock track
 * to those marks by ear is the part that would actually take an afternoon.
 *
 * Deterministic: the noise source is a seeded LCG, not Math.random, so the file is
 * byte-identical on every run. That is what makes it safe to gitignore the .wav
 * and regenerate it as a build step — a nondeterministic generator would produce a
 * different bed for whoever renders next.
 *
 *   node scripts/gen-audio.mjs
 *
 * Run automatically by `npm run render` and `npm run studio`.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const FPS = 30;
const SECONDS = 30;
const N = SR * SECONDS;

const L = new Float64Array(N);
const R = new Float64Array(N);

/** Frames → seconds, so timings can be written in the units the scenes use. */
const f = (frame) => frame / FPS;

/* Seeded LCG. Numerically the classic MINSTD constants; all that matters here is
   that it is stable across runs and platforms, which Math.random is not. */
let seed = 0x2f6e2b1;
const rand = () => {
  seed = (seed * 48271) % 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};

/** Raised-cosine ramp — no clicks, unlike a linear one at a zero crossing. */
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));

/**
 * Adds one pad voice: a note, built additively from six harmonics.
 *
 * `1 / h^1.7` rolls the harmonics off steeply enough to sound like something with
 * a lowpass on it rather than a raw sawtooth, which is the difference between a
 * pad and a buzz. Two of these per note, detuned a fraction of a percent, is what
 * gives the chord width without a chorus effect.
 */
function pad({ freq, t0, t1, attack, release, amp, pan }) {
  const i0 = Math.max(0, Math.floor(t0 * SR));
  const i1 = Math.min(N, Math.ceil(t1 * SR));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);

  for (let i = i0; i < i1; i++) {
    const t = i / SR;
    const env =
      smooth((t - t0) / attack) * smooth((t1 - t) / release);
    if (env <= 0) continue;

    let s = 0;
    for (let h = 1; h <= 6; h++) {
      s += Math.sin(2 * Math.PI * freq * h * t) / Math.pow(h, 1.7);
    }
    /* Slow 0.07 Hz tremolo, different phase per note via the frequency itself.
       Holding a chord dead still for five seconds is what makes a bed sound like
       a synth patch instead of a performance. */
    const trem = 1 + 0.12 * Math.sin(2 * Math.PI * 0.07 * t + freq);
    const v = s * env * amp * trem;
    L[i] += v * gl;
    R[i] += v * gr;
  }
}

/** A struck tone with an exponential tail — used for every accent and blip. */
function blip({ freq, t0, decay, amp, pan = 0, harmonic = 0.35 }) {
  const i0 = Math.max(0, Math.floor(t0 * SR));
  const i1 = Math.min(N, Math.ceil((t0 + decay * 4) * SR));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);

  for (let i = i0; i < i1; i++) {
    const t = i / SR;
    const d = t - t0;
    /* 1ms attack. Without it the waveform starts mid-air and every blip gets a
       click on the front that is inaudible alone and obvious in a row of six. */
    const env = Math.min(1, d / 0.001) * Math.exp(-d / decay);
    const s =
      Math.sin(2 * Math.PI * freq * t) +
      harmonic * Math.sin(2 * Math.PI * freq * 2 * t);
    const v = s * env * amp;
    L[i] += v * gl;
    R[i] += v * gr;
  }
}

/** Filtered noise, for hats and the swells before a cut. */
function noise({ t0, dur, amp, rise = false, bright = 0.5 }) {
  const i0 = Math.max(0, Math.floor(t0 * SR));
  const i1 = Math.min(N, Math.ceil((t0 + dur) * SR));
  let prevL = 0;
  let prevR = 0;

  for (let i = i0; i < i1; i++) {
    const p = (i - i0) / (i1 - i0);
    const env = rise ? Math.pow(p, 2) : Math.pow(1 - p, 2.5);
    const nl = rand();
    const nr = rand();
    /* One-pole highpass by differencing against a smoothed copy. `bright` sets
       how much of the low end survives; a full-band noise burst reads as tape
       hiss over a bed this quiet. */
    prevL += (nl - prevL) * bright;
    prevR += (nr - prevR) * bright;
    L[i] += (nl - prevL) * env * amp;
    R[i] += (nr - prevR) * env * amp;
  }
}

/* ---------------------------------------------------------------------------
   Harmony. A minor, one chord per scene — the long scenes get two, so the
   harmony turns over without ever changing off a cut.

   Ending F → C is a plagal cadence: it resolves rather than trailing off, which
   is what the CTA needs when the loop is about to restart.
   --------------------------------------------------------------------------- */
const A_MIN = { notes: [220.0, 261.63, 329.63], sub: 110.0 };
const F_MAJ = { notes: [174.61, 220.0, 261.63], sub: 87.31 };
const C_MAJ = { notes: [196.0, 261.63, 329.63], sub: 130.81 };
const G_MAJ = { notes: [196.0, 246.94, 293.66], sub: 98.0 };

const PROGRESSION = [
  { chord: A_MIN, t0: f(0), t1: f(150) }, // wordmark
  { chord: F_MAJ, t0: f(112), t1: f(210) }, // access, first half
  { chord: C_MAJ, t0: f(200), t1: f(285) }, // access, second half
  { chord: A_MIN, t0: f(262), t1: f(390) }, // agent, the instruction
  { chord: G_MAJ, t0: f(375), t1: f(495) }, // agent, the plan
  { chord: F_MAJ, t0: f(472), t1: f(555) }, // stack
  { chord: C_MAJ, t0: f(545), t1: f(615) }, // stack → chains
  { chord: A_MIN, t0: f(600), t1: f(675) }, // chains
  { chord: G_MAJ, t0: f(660), t1: f(735) }, // chains → cta
  { chord: C_MAJ, t0: f(712), t1: f(825) }, // cta
  { chord: F_MAJ, t0: f(810), t1: f(870) }, // cta, the turn
  { chord: C_MAJ, t0: f(855), t1: f(900) }, // resolve
];

/* Chords deliberately overlap by ~10 frames so each one's release crossfades into
   the next attack. Butting them end to end leaves a hole at every change. */
for (const { chord, t0, t1 } of PROGRESSION) {
  chord.notes.forEach((freq, i) => {
    const pan = (i - 1) * 0.45;
    for (const detune of [1 - 0.0012, 1 + 0.0012]) {
      pad({
        freq: freq * detune,
        t0,
        t1,
        attack: 0.55,
        release: 0.7,
        amp: 0.022,
        pan,
      });
    }
  });
  /* Sub sine, centred and clean — no harmonics, or it muddies everything above. */
  pad({
    freq: chord.sub,
    t0,
    t1,
    attack: 0.6,
    release: 0.8,
    amp: 0.05,
    pan: 0,
  });
}

/* ---------------------------------------------------------------------------
   Pulse. 120 BPM, which is 15 frames a beat — the same interval as the caret
   blink in ui.tsx, so the two are locked without either referencing the other.

   Starts a second in, so the opening frame is quiet, and drops out over the last
   two seconds so the CTA is left on harmony alone.
   --------------------------------------------------------------------------- */
const BEAT = 0.5;
for (let beat = 2; beat * BEAT < 28.2; beat++) {
  const t = beat * BEAT;
  const fade = t > 26.5 ? Math.max(0, 1 - (t - 26.5) / 1.7) : 1;
  blip({ freq: 61.74, t0: t, decay: 0.13, amp: 0.115 * fade, harmonic: 0.1 });
  /* Hat on the off-beat only. On every beat it turns a bed into a backing track. */
  noise({ t0: t + BEAT / 2, dur: 0.05, amp: 0.02 * fade, bright: 0.75 });
}

/* ---------------------------------------------------------------------------
   Scene accents. One bloom on each cut, with a short noise swell leading into it.
   Frame numbers are the cumulative boundaries from theme.ts.
   --------------------------------------------------------------------------- */
const CUTS = [0, 120, 270, 480, 600, 720];
for (const frame of CUTS) {
  const t = f(frame);
  if (t > 0.3) noise({ t0: t - 0.32, dur: 0.32, amp: 0.03, rise: true, bright: 0.5 });
  blip({ freq: 880, t0: t, decay: 0.55, amp: 0.05, harmonic: 0.5 });
  blip({ freq: 293.66, t0: t, decay: 0.9, amp: 0.045, harmonic: 0.2 });
}

/* The six access boxes filling, at the frames Access.tsx fills them. A rising
   pentatonic rather than one repeated note: six identical blips sound like an
   error tone repeating, six rising ones sound like progress. */
const BOX_FRAMES = [26, 38, 50, 62, 74, 86];
const BOX_NOTES = [1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0];
BOX_FRAMES.forEach((frame, i) => {
  blip({
    freq: BOX_NOTES[i],
    t0: f(120 + frame),
    decay: 0.13,
    amp: 0.042,
    pan: (i / 5) * 0.8 - 0.4,
    harmonic: 0.2,
  });
});

/* The unlock, at Access.tsx's UNLOCK_AT. A held triad, the only sustained accent
   in the piece — it is the one moment the video is actually about. */
for (const freq of [523.25, 659.26, 783.99]) {
  blip({ freq, t0: f(120 + 104), decay: 0.85, amp: 0.038, harmonic: 0.25 });
}

/* The three plan ticks being drawn, at Agent.tsx's step frames + the 10-frame
   delay before each tick starts. An E minor triad arpeggiated upward. */
const TICK_FRAMES = [84 + 12, 112 + 12, 140 + 12];
const TICK_NOTES = [659.26, 783.99, 987.77];
TICK_FRAMES.forEach((frame, i) => {
  blip({
    freq: TICK_NOTES[i],
    t0: f(270 + frame),
    decay: 0.3,
    amp: 0.05,
    harmonic: 0.3,
  });
});

/* The turn into the CTA gets a longer riser than the other cuts and one extra
   octave on the bloom, so the last scene arrives rather than merely following. */
noise({ t0: f(720) - 0.8, dur: 0.8, amp: 0.045, rise: true, bright: 0.4 });
blip({ freq: 1046.5, t0: f(720), decay: 1.4, amp: 0.035, harmonic: 0.4 });

/* ---------------------------------------------------------------------------
   Master.
   --------------------------------------------------------------------------- */
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  /* 0.4s in, 1.6s out. The long tail matters because the video loops on X — a
     hard cut to silence at 30.00s clicks against the restart. */
  const g = smooth(t / 0.4) * smooth((SECONDS - t) / 1.6);

  /* tanh soft-clip. Peaks here come from accents landing on a chord change, and
     a hard limiter would flatten the transient that makes the accent audible;
     tanh rounds it instead. Divided back out so unity gain stays unity. */
  const sl = Math.tanh(L[i] * g * 1.25) / 1.25;
  const sr = Math.tanh(R[i] * g * 1.25) / 1.25;
  L[i] = sl;
  R[i] = sr;
  peak = Math.max(peak, Math.abs(sl), Math.abs(sr));
}

/* Normalise to -1 dBFS. Deliberately not to 0: a bed that arrives at full scale
   is the one people mute. */
const norm = peak > 0 ? 0.891 / peak : 1;

const bytes = N * 2 * 2;
const buf = Buffer.alloc(44 + bytes);
buf.write("RIFF", 0, "ascii");
buf.writeUInt32LE(36 + bytes, 4);
buf.write("WAVE", 8, "ascii");
buf.write("fmt ", 12, "ascii");
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(2, 22); // stereo
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2 * 2, 28); // byte rate
buf.writeUInt16LE(4, 32); // block align
buf.writeUInt16LE(16, 34); // bits
buf.write("data", 36, "ascii");
buf.writeUInt32LE(bytes, 40);

for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "bed.wav");
writeFileSync(out, buf);
console.log(
  `bed.wav  ${SECONDS}s  ${SR}Hz stereo  ${(buf.length / 1024 / 1024).toFixed(2)} MB  peak before normalise ${peak.toFixed(3)}`,
);

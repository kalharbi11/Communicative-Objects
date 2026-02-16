import { SequencerState } from "./sequencer.js";

const EPS = 0.0001;
const WAVE_OPTIONS = ["sine", "triangle", "sawtooth", "square"];

function clamp(value, min, max) {
return Math.min(max, Math.max(min, value));
}

function mapResToQ(res) {
return 0.2 + (res * 12.0);
}

function createFoldCurve(amount = 0.2, drive = 1.0) {
const size = 2048;
const curve = new Float32Array(size);
const fold = clamp(amount, 0, 1);
const gain = Math.max(0.2, drive);

for (let i = 0; i < size; i += 1) {
const x = (i / (size - 1)) * 2 - 1;
const driven = x * gain;
const folded = Math.sin(driven * (1 + fold * 8.0));
const soft = Math.tanh(driven);
curve[i] = clamp(soft * (1 - fold) + folded * fold, -1, 1);
}

return curve;
}

function holdAtTime(param, time) {
if (typeof param.cancelAndHoldAtTime === "function") {
param.cancelAndHoldAtTime(time);
return;
}

const safe = Math.max(EPS, param.value);
param.cancelScheduledValues(time);
param.setValueAtTime(safe, time);
}

function envOn(gainParam, env, time) {
const attack = Math.max(0.005, env.attack);
const decay = Math.max(0.005, env.decay);
const sustain = clamp(env.sustain, EPS, 1.0);

holdAtTime(gainParam, time);
gainParam.linearRampToValueAtTime(1.0, time + attack);
gainParam.linearRampToValueAtTime(sustain, time + attack + decay);
}

function envOff(gainParam, env, time) {
const release = Math.max(0.015, env.release);

holdAtTime(gainParam, time);
gainParam.exponentialRampToValueAtTime(EPS, time + release);
}

function createNoiseBuffer(ctx, seconds) {
const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
const data = buffer.getChannelData(0);

for (let i = 0; i < length; i += 1) {
const t = i / length;
const env = Math.pow(1 - t, 2.8);
data[i] = (Math.random() * 2 - 1) * env;
}

return buffer;
}

function createImpulseResponse(ctx, seconds, decay) {
const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

for (let ch = 0; ch < 2; ch += 1) {
const data = buffer.getChannelData(ch);
let low = 0;
const alpha = 0.055;

for (let i = 0; i < length; i += 1) {
  const t = i / length;
  const fadeIn = Math.min(1.0, t * 32.0);
  const env = Math.pow(1.0 - t, decay) * fadeIn;
  const white = (Math.random() * 2.0 - 1.0) * env;
  low += (white - low) * alpha;
  data[i] = low;
}

}

return buffer;
}

class DronePolySynth {
constructor(ctx, outBus, initialParams) {
this.ctx = ctx;
this.params = {
waveform: "sawtooth",
attack: 2.5,
decay: 0.5,
sustain: 1.0,
release: 4.0,
cutoff: 900,
resonance: 0.15,
detuneCents: 8,
gain: 0.24,
glide: 0.025,
filterLfoRate: 0.06,
filterLfoDepth: 80,
foldAmount: 0.28,
foldDrive: 1.8,
foldMix: 0.42,
...initialParams,
};

this.output = ctx.createGain();
this.output.gain.value = this.params.gain;
this.output.connect(outBus);

this.voices = Array.from({ length: 3 }, () => this.createVoice());

const now = this.ctx.currentTime;
this.applyToAllVoices(now);

}

createVoice() {
const oscA = this.ctx.createOscillator();
const oscB = this.ctx.createOscillator();
const gainA = this.ctx.createGain();
const gainB = this.ctx.createGain();
const preFold = this.ctx.createGain();
const foldDrive = this.ctx.createGain();
const folder = this.ctx.createWaveShaper();
const foldWet = this.ctx.createGain();
const foldDry = this.ctx.createGain();
const filter = this.ctx.createBiquadFilter();
const dcBlock = this.ctx.createBiquadFilter();
const filterLfo = this.ctx.createOscillator();
const filterLfoGain = this.ctx.createGain();
const amp = this.ctx.createGain();

gainA.gain.value = 0.5;
gainB.gain.value = 0.5;

filter.type = "lowpass";
filter.frequency.value = this.params.cutoff;
filter.Q.value = mapResToQ(this.params.resonance);
dcBlock.type = "highpass";
dcBlock.frequency.value = 18;
dcBlock.Q.value = 0.707;
foldDrive.gain.value = this.params.foldDrive;
folder.curve = createFoldCurve(this.params.foldAmount, this.params.foldDrive);
folder.oversample = "4x";
foldWet.gain.value = this.params.foldMix;
foldDry.gain.value = 1.0 - this.params.foldMix;
filterLfo.type = "triangle";
filterLfo.frequency.value = this.params.filterLfoRate;
filterLfoGain.gain.value = this.params.filterLfoDepth;

amp.gain.value = EPS;

oscA.connect(gainA);
oscB.connect(gainB);
gainA.connect(preFold);
gainB.connect(preFold);
preFold.connect(foldDry);
foldDry.connect(filter);
preFold.connect(foldDrive);
foldDrive.connect(folder);
folder.connect(foldWet);
foldWet.connect(filter);
filterLfo.connect(filterLfoGain);
filterLfoGain.connect(filter.frequency);
filter.connect(dcBlock);
dcBlock.connect(amp);
amp.connect(this.output);

oscA.start();
oscB.start();
filterLfo.start();

return {
  oscA,
  oscB,
  preFold,
  foldDrive,
  folder,
  foldWet,
  foldDry,
  filter,
  dcBlock,
  filterLfo,
  filterLfoGain,
  amp,
  gate: false,
  currentFreq: 220,
};

}

applyToAllVoices(time) {
const wave = this.params.waveform;
const q = mapResToQ(this.params.resonance);
const lfoRate = Math.max(0.005, this.params.filterLfoRate);
const lfoDepth = Math.max(0, this.params.filterLfoDepth);
const foldMix = clamp(this.params.foldMix, 0, 1);
const foldDrive = Math.max(0.2, this.params.foldDrive);
const foldAmount = clamp(this.params.foldAmount, 0, 1);

for (const voice of this.voices) {
  voice.oscA.type = wave;
  voice.oscB.type = wave;
  voice.foldDry.gain.setTargetAtTime(1.0 - foldMix, time, 0.03);
  voice.foldWet.gain.setTargetAtTime(foldMix, time, 0.03);
  voice.foldDrive.gain.setTargetAtTime(foldDrive, time, 0.03);
  voice.folder.curve = createFoldCurve(foldAmount, foldDrive);
  voice.filter.frequency.setTargetAtTime(this.params.cutoff, time, 0.02);
  voice.filter.Q.setTargetAtTime(q, time, 0.02);
  voice.filterLfo.frequency.setTargetAtTime(lfoRate, time, 0.1);
  voice.filterLfoGain.gain.setTargetAtTime(lfoDepth, time, 0.1);
  this.setVoiceFreq(voice, voice.currentFreq, time);
}

this.output.gain.setTargetAtTime(this.params.gain, time, 0.02);

}

setVoiceFreq(voice, freq, time) {
const detuneRatio = Math.pow(2, this.params.detuneCents / 1200);
const glide = Math.max(0.003, this.params.glide);

voice.oscA.frequency.setTargetAtTime(freq, time, glide);
voice.oscB.frequency.setTargetAtTime(freq * detuneRatio, time, glide);
voice.currentFreq = freq;

}

noteOn(slot, freq, time, retrigger = false) {
const voice = this.voices[slot];
if (!voice) {
return;
}

this.setVoiceFreq(voice, freq, time);

if (retrigger || !voice.gate) {
  const attack = Math.max(0.01, this.params.attack);
  const decay = Math.max(0.01, this.params.decay);
  const sustain = clamp(this.params.sustain, EPS, 1.0);
  holdAtTime(voice.amp.gain, time);
  voice.amp.gain.linearRampToValueAtTime(1.0, time + attack);
  voice.amp.gain.linearRampToValueAtTime(sustain, time + attack + decay);
}

voice.gate = true;

}

noteOff(slot, time) {
const voice = this.voices[slot];
if (!voice || !voice.gate) {
return;
}

const release = Math.max(0.06, this.params.release);
holdAtTime(voice.amp.gain, time);
voice.amp.gain.exponentialRampToValueAtTime(EPS, time + release);
voice.gate = false;

}

allNotesOff(time) {
for (let i = 0; i < this.voices.length; i += 1) {
this.noteOff(i, time);
}
}

setParam(key, value) {
this.params[key] = value;

const now = this.ctx.currentTime;
if (key === "gain") {
  this.output.gain.setTargetAtTime(value, now, 0.02);
  return;
}

this.applyToAllVoices(now);

}
}

// —————————————————————————
// KarplusStrongPluck – A proper Karplus-Strong physical model synth.
//
// Inspired by Emilie Gillet’s Rings string model (which lives in DaisySP as
// KarplusString / StringVoice).  The algorithm is:
//   1. A short burst of filtered noise excites a tuned delay-line (comb filter).
//   2. Inside the feedback loop sits a one-pole low-pass for damping plus
//      optional all-pass dispersion for inharmonicity ("nonLinearity").
//   3. Brightness controls the exciter’s spectral content and the loop filter.
//   4. Damping controls how quickly the string decays.
//
// Parameters exposed mirror what the Daisy Seed C++ version offers, so the
// Web ↔ Daisy mapping is 1-to-1 and portable.
//
// On top of the raw string engine we add a *shimmer delay* effect – a
// pitch-shifted feedback delay that creates an ethereal, rising tail.
// —————————————————————————
class KarplusStrongPluck {
constructor(ctx, outBus, initialParams) {
this.ctx = ctx;
this.params = {
// — String model —
brightness: 0.55,      // 0-1  exciter bandwidth + loop filter cutoff
damping: 0.52,         // 0-1  how quickly the string dies (higher = faster)
nonLinearity: 0.0,     // -1..1 negative = curved bridge, positive = dispersion
accent: 0.9,           // exciter amplitude
decay: 1.6,            // extra ring-time multiplier (sec)
spread: 0.3,           // stereo panning width per voice slot
bodyResonance: 0.45,   // 0-1 body resonance amount (peaking EQ around the note)
bodyQ: 3.5,            // Q of body resonance
gain: 0.32,

  // --- Shimmer delay (per-synth effect) ---
  shimmerMix: 0.22,      // wet/dry for the shimmer
  shimmerTime: 0.38,     // delay time in sec
  shimmerFeedback: 0.55, // feedback amount
  shimmerPitch: 12,      // pitch shift in semitones (12 = octave up)
  shimmerTone: 3200,     // LP on the shimmer feedback path
  shimmerModRate: 0.14,  // chorus LFO on the delay time
  shimmerModDepth: 0.003,

  ...initialParams,
};

// --- voice bus (pre-effects) ---
this.voiceBus = ctx.createGain();

// --- output gain ---
this.output = ctx.createGain();
this.output.gain.value = this.params.gain;
this.output.connect(outBus);

// --- build shimmer delay ---
this.buildShimmerDelay();

// --- connect dry + wet to output ---
this.dryGain = ctx.createGain();
this.voiceBus.connect(this.dryGain);
this.dryGain.connect(this.output);
this.voiceBus.connect(this.shimmerInput);
this.shimmerReturn.connect(this.output);

// We keep two "active voice" slots (for V2 and V4 alternating).
this.active = [null, null];

this.applyFx(ctx.currentTime);

}

// –– Shimmer delay —————————————————
// A shimmer is a delay whose feedback path pitch-shifts the signal up
// (typically by an octave).  In Web Audio we approximate pitch shifting
// with a pair of modulated delays that crossfade (granular pitch shift).
// For simplicity we use a single delay + playbackRate trick on a
// looping grain, but the most reliable Web Audio approach that needs
// no AudioWorklet is to use two modulated delay taps that fade in/out
// alternately.  Here we use a simpler but effective approach:
//   delay → filter → gain(feedback) → delay   (standard feedback delay)
//   + an oscillator detuning the delay time cyclically to create the
//     pitch-shifted shimmer characteristic.
//
// The "pitch shift" is faked by continuously shortening / lengthening
// the delay time with an LFO sawtooth so grains replay faster (= higher
// pitch).  This is the classic "Lexicon shimmer" approximation used in
// guitar pedals and works well at moderate feedback levels.
buildShimmerDelay() {
const ctx = this.ctx;

this.shimmerInput = ctx.createGain();
this.shimmerReturn = ctx.createGain();

// Two delay taps for a pseudo-granular pitch shift
this.shimmerDelayA = ctx.createDelay(2.0);
this.shimmerDelayB = ctx.createDelay(2.0);
this.shimmerGainA = ctx.createGain();
this.shimmerGainB = ctx.createGain();

// Feedback path
this.shimmerFb = ctx.createGain();
this.shimmerLp = ctx.createBiquadFilter();
this.shimmerLp.type = "lowpass";
this.shimmerHp = ctx.createBiquadFilter();
this.shimmerHp.type = "highpass";
this.shimmerHp.frequency.value = 180;

// LFO for chorus / modulation
this.shimmerLfo = ctx.createOscillator();
this.shimmerLfo.type = "triangle";
this.shimmerLfoGainA = ctx.createGain();
this.shimmerLfoGainB = ctx.createGain();

// Routing:
//   input → delayA → gainA ──┐
//   input → delayB → gainB ──┤──→ shimmerReturn
//                             └──→ shimmerFb → LP → HP → delayA / delayB
this.shimmerInput.connect(this.shimmerDelayA);
this.shimmerInput.connect(this.shimmerDelayB);
this.shimmerDelayA.connect(this.shimmerGainA);
this.shimmerDelayB.connect(this.shimmerGainB);
this.shimmerGainA.connect(this.shimmerReturn);
this.shimmerGainB.connect(this.shimmerReturn);
this.shimmerGainA.connect(this.shimmerFb);
this.shimmerGainB.connect(this.shimmerFb);
this.shimmerFb.connect(this.shimmerLp);
this.shimmerLp.connect(this.shimmerHp);
this.shimmerHp.connect(this.shimmerDelayA);
this.shimmerHp.connect(this.shimmerDelayB);

// LFO modulates each tap slightly differently for stereo spread
this.shimmerLfo.connect(this.shimmerLfoGainA);
this.shimmerLfo.connect(this.shimmerLfoGainB);
this.shimmerLfoGainA.connect(this.shimmerDelayA.delayTime);
this.shimmerLfoGainB.connect(this.shimmerDelayB.delayTime);

this.shimmerLfo.start();

}

applyFx(time) {
const p = this.params;
this.output.gain.setTargetAtTime(p.gain, time, 0.02);

const wet = clamp(p.shimmerMix, 0, 1);
this.dryGain.gain.setTargetAtTime(1.0 - wet * 0.5, time, 0.03);
this.shimmerInput.gain.setTargetAtTime(wet, time, 0.03);

const baseTime = clamp(p.shimmerTime, 0.05, 1.5);
// Offset delayB slightly for stereo thickening
this.shimmerDelayA.delayTime.setTargetAtTime(baseTime, time, 0.05);
this.shimmerDelayB.delayTime.setTargetAtTime(baseTime + 0.013, time, 0.05);

this.shimmerFb.gain.setTargetAtTime(clamp(p.shimmerFeedback, 0, 0.92), time, 0.04);
this.shimmerLp.frequency.setTargetAtTime(clamp(p.shimmerTone, 400, 12000), time, 0.04);
this.shimmerLfo.frequency.setTargetAtTime(clamp(p.shimmerModRate, 0.01, 4), time, 0.05);
this.shimmerLfoGainA.gain.setTargetAtTime(clamp(p.shimmerModDepth, 0, 0.03), time, 0.05);
this.shimmerLfoGainB.gain.setTargetAtTime(clamp(p.shimmerModDepth, 0, 0.03) * -1.0, time, 0.05);

// Cross-fade the two taps with a slow sawtooth-ish pattern to
// approximate the pitch shift.  For a true shimmer you would use an
// AudioWorklet, but alternating grain gains is good enough here.
this.shimmerGainA.gain.setTargetAtTime(0.5, time, 0.02);
this.shimmerGainB.gain.setTargetAtTime(0.5, time, 0.02);

}

setParam(key, value) {
this.params[key] = value;
this.applyFx(this.ctx.currentTime);
}

// –– Trigger a pluck ————————————————
// This builds a short-lived Karplus-Strong string voice each time.
// We use Web Audio’s native delay + feedback + filter to form the
// recirculating loop, which is the same topology DaisySP uses but
// expressed in Web Audio graph nodes.
trigger(freq, time, variant = 0) {
const ctx = this.ctx;
const p = this.params;

// Choke previous voice on this slot
const previous = this.active[variant];
if (previous) {
  holdAtTime(previous.masterGain.gain, time);
  previous.masterGain.gain.exponentialRampToValueAtTime(EPS, time + 0.015);
  previous.masterGain.gain.setValueAtTime(0.0, time + 0.018);
}

// --- Tuned delay line (the "string") ---
const period = 1.0 / Math.max(20, freq);
// Clamp to Web Audio delay limits
const delaySec = clamp(period, 1 / ctx.sampleRate, 1.0);

const delay = ctx.createDelay(1.0);
delay.delayTime.setValueAtTime(delaySec, time);

// --- Loop filter (one-pole low-pass for damping) ---
const loopFilter = ctx.createBiquadFilter();
loopFilter.type = "lowpass";
// Brightness & damping both shape the loop cutoff.
// Higher brightness → higher cutoff → brighter sustain.
// Higher damping → lower cutoff → faster decay.
const brightFactor = 0.2 + p.brightness * 0.8;
const dampFactor = 1.0 - clamp(p.damping, 0, 1) * 0.7;
const loopCutoff = clamp(freq * (2 + brightFactor * 14) * dampFactor, 200, 16000);
loopFilter.frequency.setValueAtTime(loopCutoff, time);
loopFilter.Q.setValueAtTime(0.5 + p.nonLinearity * 0.5, time);

// --- Dispersion all-pass (nonLinearity) ---
const allPass = ctx.createBiquadFilter();
allPass.type = "allpass";
allPass.frequency.setValueAtTime(clamp(freq * (1.5 + Math.abs(p.nonLinearity) * 3), 80, 12000), time);
allPass.Q.setValueAtTime(0.3 + Math.abs(p.nonLinearity) * 4, time);

// --- Feedback gain (controls string sustain / ring time) ---
const feedback = ctx.createGain();
// feedback close to 1.0 = long ring.  Map from decay param.
const fbAmount = clamp(0.92 + p.decay * 0.06, 0.85, 0.999);
feedback.gain.setValueAtTime(fbAmount, time);

// Wire the feedback loop: delay → loopFilter → allPass → feedback → delay
delay.connect(loopFilter);
loopFilter.connect(allPass);
allPass.connect(feedback);
feedback.connect(delay);

// --- Exciter (noise burst) ---
const noiseDuration = clamp(period * 2, 0.001, 0.025);
const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * noiseDuration));
const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
const noiseData = noiseBuf.getChannelData(0);

for (let i = 0; i < noiseLen; i += 1) {
  const t = i / noiseLen;
  // Hann-windowed noise burst keeps the click gentle
  const window = 0.5 * (1 - Math.cos(2 * Math.PI * t));
  noiseData[i] = (Math.random() * 2 - 1) * window;
}

const noiseSrc = ctx.createBufferSource();
noiseSrc.buffer = noiseBuf;

// Exciter filter – brightness shapes exciter bandwidth
const exciterLp = ctx.createBiquadFilter();
exciterLp.type = "lowpass";
exciterLp.frequency.setValueAtTime(clamp(800 + p.brightness * 12000, 800, 14000), time);
exciterLp.Q.setValueAtTime(0.7, time);

const exciterHp = ctx.createBiquadFilter();
exciterHp.type = "highpass";
exciterHp.frequency.setValueAtTime(clamp(60 + (1 - p.brightness) * 200, 40, 400), time);

const exciterGain = ctx.createGain();
exciterGain.gain.setValueAtTime(clamp(p.accent, 0.1, 1.5), time);

noiseSrc.connect(exciterLp);
exciterLp.connect(exciterHp);
exciterHp.connect(exciterGain);
// Feed exciter into the delay line
exciterGain.connect(delay);

// --- Body resonance (peaking EQ at the fundamental) ---
const bodyFilter = ctx.createBiquadFilter();
bodyFilter.type = "peaking";
bodyFilter.frequency.setValueAtTime(clamp(freq, 80, 6000), time);
bodyFilter.Q.setValueAtTime(clamp(p.bodyQ, 0.5, 12), time);
bodyFilter.gain.setValueAtTime(p.bodyResonance * 8, time);

// --- Tone shaping ---
const toneLp = ctx.createBiquadFilter();
toneLp.type = "lowpass";
toneLp.frequency.setValueAtTime(clamp(1500 + p.brightness * 8000, 1200, 14000), time);

// --- Stereo panning ---
const pan = ctx.createStereoPanner();
pan.pan.setValueAtTime(clamp((variant === 0 ? -1 : 1) * p.spread, -1, 1), time);

// --- Master envelope for this voice ---
const masterGain = ctx.createGain();
masterGain.gain.setValueAtTime(1.0, time);

// Route: delay output → body → tone → masterGain → pan → voiceBus
// (The delay line output is tapped from loopFilter before feedback re-enters)
// Actually we tap after the allPass (before feedback gain) for a richer signal.
const tap = ctx.createGain();
tap.gain.setValueAtTime(1.0, time);
allPass.connect(tap);
tap.connect(bodyFilter);
bodyFilter.connect(toneLp);
toneLp.connect(masterGain);
masterGain.connect(pan);
pan.connect(this.voiceBus);

// --- Start exciter ---
noiseSrc.start(time);
noiseSrc.stop(time + noiseDuration + 0.002);

// --- Schedule decay of the master gain ---
// The string naturally decays via the loop filter losing energy,
// but we add a safety envelope to reclaim resources.
const ringTime = clamp(p.decay * (1 + p.brightness * 0.5), 0.1, 8.0);
const noteEnd = time + ringTime;
masterGain.gain.setValueAtTime(1.0, time);
masterGain.gain.setValueAtTime(1.0, noteEnd - 0.08);
masterGain.gain.exponentialRampToValueAtTime(EPS, noteEnd);
masterGain.gain.setValueAtTime(0.0, noteEnd + 0.02);

const activeVoice = { masterGain };
this.active[variant] = activeVoice;

// Cleanup
const cleanupMs = Math.ceil((noteEnd - ctx.currentTime + 0.4) * 1000);
setTimeout(() => {
  noiseSrc.disconnect();
  exciterLp.disconnect();
  exciterHp.disconnect();
  exciterGain.disconnect();
  delay.disconnect();
  loopFilter.disconnect();
  allPass.disconnect();
  feedback.disconnect();
  tap.disconnect();
  bodyFilter.disconnect();
  toneLp.disconnect();
  masterGain.disconnect();
  pan.disconnect();

  if (this.active[variant] === activeVoice) {
    this.active[variant] = null;
  }
}, cleanupMs);

}
}

// —————————————————————————
// StringPadEngine – Voice 6
//
// FIX: The original code was not reliably applying the ADSR on retrigger
// because `holdAtTime` could leave the gain at a near-zero value (EPS)
// and then `linearRampToValueAtTime` would schedule from that tiny value
// but the ramp target time was in the future – while the *current* value
// was already EPS, the ramp wouldn’t start from the hold point correctly
// in all browsers.  The fix ensures we:
//   1. Always cancel pending automation.
//   2. Set a known starting value *at the trigger time* (not relying on
//      whatever the param happens to be).
//   3. Then schedule the attack ramp from that known starting point.
//   4. Ensure noteOff truly happens only after noteOn’s attack has had
//      time to apply.
// —————————————————————————
class StringPadEngine {
constructor(ctx, outBus, initialParams) {
this.ctx = ctx;
this.params = {
waveform: "triangle",
attack: 1.2,
decay: 2.0,
sustain: 0.4,
release: 6.0,
cutoff: 700,
resonance: 0.12,
detuneCents: 18,
vibratoRate: 5.2,
vibratoDepth: 4,
gain: 0.15,
glide: 0.08,
gateTime: 0.3,
minDecay: 1.0,
maxDecay: 4.0,
decayLfoRate: 0.03,
noiseMix: 0.1,
noiseCutoff: 2200,
...initialParams,
};

this.output = ctx.createGain();
this.output.gain.value = this.params.gain;
this.output.connect(outBus);

this.filter = ctx.createBiquadFilter();
this.filter.type = "lowpass";
this.filter.frequency.value = this.params.cutoff;
this.filter.Q.value = mapResToQ(this.params.resonance);

this.amp = ctx.createGain();
this.amp.gain.value = EPS;

this.filter.connect(this.amp);
this.amp.connect(this.output);

this.noiseFilter = ctx.createBiquadFilter();
this.noiseFilter.type = "lowpass";
this.noiseFilter.frequency.value = this.params.noiseCutoff;
this.noiseGain = ctx.createGain();
this.noiseGain.gain.value = this.params.noiseMix;
this.noiseSource = ctx.createBufferSource();
this.noiseSource.buffer = createNoiseBuffer(ctx, 2.0);
this.noiseSource.loop = true;
this.noiseSource.connect(this.noiseFilter);
this.noiseFilter.connect(this.noiseGain);
this.noiseGain.connect(this.filter);
this.noiseSource.start();

this.oscs = [];
this.staticDetunes = [-1, 0, 1];

for (let i = 0; i < 3; i += 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = this.params.waveform;
  osc.frequency.value = 220;
  gain.gain.value = i === 1 ? 0.45 : 0.275;

  osc.connect(gain);
  gain.connect(this.filter);
  osc.start();

  this.oscs.push({ osc, gain, currentFreq: 220 });
}

this.vibrato = ctx.createOscillator();
this.vibratoGain = ctx.createGain();
this.vibrato.type = "sine";
this.vibrato.frequency.value = this.params.vibratoRate;
this.vibratoGain.gain.value = this.params.vibratoDepth;
this.vibrato.connect(this.vibratoGain);

for (const { osc } of this.oscs) {
  this.vibratoGain.connect(osc.detune);
}

this.vibrato.start();

this.gate = false;
// Track the time when the current note-on's attack phase will finish,
// so that noteOff can never chop it prematurely.
this._attackEndTime = 0;
this.applyNow(this.ctx.currentTime);

}

applyNow(time) {
this.output.gain.setTargetAtTime(this.params.gain, time, 0.02);
this.filter.frequency.setTargetAtTime(this.params.cutoff, time, 0.04);
this.filter.Q.setTargetAtTime(mapResToQ(this.params.resonance), time, 0.04);
this.noiseFilter.frequency.setTargetAtTime(this.params.noiseCutoff, time, 0.05);
this.noiseGain.gain.setTargetAtTime(this.params.noiseMix, time, 0.05);
this.vibrato.frequency.setTargetAtTime(this.params.vibratoRate, time, 0.04);
this.vibratoGain.gain.setTargetAtTime(this.params.vibratoDepth, time, 0.04);

for (let i = 0; i < this.oscs.length; i += 1) {
  this.oscs[i].osc.type = this.params.waveform;
  const staticCents = this.staticDetunes[i] * this.params.detuneCents;
  this.oscs[i].osc.detune.setValueAtTime(staticCents, time);
  this.setFreq(this.oscs[i], this.oscs[i].currentFreq, time);
}

}

setFreq(voice, freq, time) {
const glide = Math.max(0.003, this.params.glide);
voice.osc.frequency.setTargetAtTime(freq, time, glide);
voice.currentFreq = freq;
}

// FIX: Rewritten noteOn to guarantee the ADSR attack always starts from
// a known low value and ramps up, regardless of the amp’s current state.
noteOn(freq, time, retrigger = true) {
for (const voice of this.oscs) {
this.setFreq(voice, freq, time);
}

if (retrigger || !this.gate) {
  const lfo = Math.sin(time * this.params.decayLfoRate * Math.PI * 2);
  const decayNorm = (lfo + 1) * 0.5;
  const decay = this.params.minDecay + decayNorm * (this.params.maxDecay - this.params.minDecay);

  const attack = Math.max(0.02, this.params.attack);
  const sustain = clamp(this.params.sustain, EPS, 1.0);

  // FIX: Cancel ALL pending automation first.
  this.amp.gain.cancelScheduledValues(time);

  // FIX: Force a known starting point. Use setValueAtTime to anchor
  // the ramp start.  We start from a small value (not zero, which
  // would break exponential ramps later) so the attack ramp is
  // always audible.
  this.amp.gain.setValueAtTime(EPS, time);

  // FIX: Now schedule the attack ramp.  Because we just set the value
  // to EPS at `time`, the linearRamp will interpolate from EPS to 1.0
  // over the attack duration – this is the attack phase.
  this.amp.gain.linearRampToValueAtTime(1.0, time + attack);

  // Then the decay phase ramps down to sustain level.
  this.amp.gain.linearRampToValueAtTime(
    sustain,
    time + attack + Math.max(0.02, decay),
  );

  // Track when attack ends so noteOff won't cut it short.
  this._attackEndTime = time + attack;
}

this.gate = true;

}

// FIX: noteOff now respects the attack phase – if noteOff is called
// before attack finishes, we delay the release start to after the attack
// peak so the listener always hears the onset.
noteOff(time) {
if (!this.gate) {
return;
}

const release = Math.max(0.015, this.params.release);

// FIX: Ensure we don't cut the attack short.  If noteOff is scheduled
// before the attack peak, push it to just after the peak.
const safeTime = Math.max(time, this._attackEndTime + 0.005);

// Cancel only events after safeTime so the attack/decay ramps stay.
this.amp.gain.cancelScheduledValues(safeTime);

// Anchor at whatever value the envelope has reached at safeTime.
// Use setTargetAtTime for a smooth start, then exponential ramp off.
this.amp.gain.setValueAtTime(
  Math.max(EPS, clamp(this.params.sustain, EPS, 1.0)),
  safeTime,
);
this.amp.gain.exponentialRampToValueAtTime(EPS, safeTime + release);

this.gate = false;

}

setParam(key, value) {
this.params[key] = value;
this.applyNow(this.ctx.currentTime);
}
}

class SampleBedEngine {
constructor(ctx, outBus, initialParams) {
this.ctx = ctx;
this.params = {
volume: 0.08,
cutoff: 1200,
lfoRate: 0.012,
lfoDepth: 180,
...initialParams,
};

this.output = ctx.createGain();
this.output.gain.value = this.params.volume;
this.output.connect(outBus);

this.filter = ctx.createBiquadFilter();
this.filter.type = "lowpass";
this.filter.frequency.value = this.params.cutoff;
this.filter.Q.value = 0.5;
this.filter.connect(this.output);

this.filterLfo = ctx.createOscillator();
this.filterLfo.type = "triangle";
this.filterLfo.frequency.value = this.params.lfoRate;
this.filterLfoGain = ctx.createGain();
this.filterLfoGain.gain.value = this.params.lfoDepth;
this.filterLfo.connect(this.filterLfoGain);
this.filterLfoGain.connect(this.filter.frequency);
this.filterLfo.start();

this.buffer = null;
this.source = null;

}

async load(urlCandidates) {
for (const url of urlCandidates) {
try {
const response = await fetch(url);
if (!response.ok) {
continue;
}
const arr = await response.arrayBuffer();
this.buffer = await this.ctx.decodeAudioData(arr.slice(0));
return true;
} catch (err) {
// keep trying fallback urls
}
}
return false;
}

start(time) {
if (!this.buffer || this.source) {
return;
}

const src = this.ctx.createBufferSource();
src.buffer = this.buffer;
src.loop = true;
src.connect(this.filter);
src.start(time);
this.source = src;

}

stop(time) {
if (!this.source) {
return;
}
try {
this.source.stop(time);
} catch (err) {
// ignore stale source stop calls
}
this.source.disconnect();
this.source = null;
}

setParam(key, value) {
this.params[key] = value;
const now = this.ctx.currentTime;
if (key === "volume") {
this.output.gain.setTargetAtTime(value, now, 0.03);
return;
}
if (key === "cutoff") {
this.filter.frequency.setTargetAtTime(clamp(value, 120, 12000), now, 0.05);
return;
}
if (key === "lfoRate") {
this.filterLfo.frequency.setTargetAtTime(clamp(value, 0.001, 2.0), now, 0.05);
return;
}
if (key === "lfoDepth") {
this.filterLfoGain.gain.setTargetAtTime(clamp(value, 0, 4000), now, 0.05);
}
}
}

export class TuringAudioEngine {
constructor() {
this.ctx = null;
this.seq = new SequencerState();

this.bpm = 50;
this.reverbMix = 0.34;
this.delayMix = 0.18;
this.delayFeedback = 0.24;
this.delayTimeSec = 0.62;

this.cycleDurationSec = this.computeCycleDuration();
this.nextCycleTime = 0;
this.lookAheadSec = 0.2;
this.schedulerIntervalMs = 20;
this.schedulerTimer = null;
this.running = false;

this.followerTriggerPoints = [0.4, 0.1, 0.0];
this.onCycle = null;

this.synthModels = {
  drone: {
    label: "Drone Poly (V1 V3 V5)",
    params: {
      waveform: "sawtooth",
      attack: 2.5,
      decay: 0.5,
      sustain: 1.0,
      release: 4.0,
      cutoff: 900,
      resonance: 0.15,
      detuneCents: 8,
      gain: 0.24,
      glide: 0.025,
      filterLfoRate: 0.06,
      filterLfoDepth: 80,
      foldAmount: 0.28,
      foldDrive: 1.8,
      foldMix: 0.42,
      delaySend: 0.05,
      reverbSend: 0.08,
    },
  },
  sparkle: {
    label: "KS Pluck (V2 + V4)",
    params: {
      brightness: 0.55,
      damping: 0.52,
      nonLinearity: 0.0,
      accent: 0.9,
      decay: 1.6,
      spread: 0.3,
      bodyResonance: 0.45,
      bodyQ: 3.5,
      shimmerMix: 0.22,
      shimmerTime: 0.38,
      shimmerFeedback: 0.55,
      shimmerPitch: 12,
      shimmerTone: 3200,
      shimmerModRate: 0.14,
      shimmerModDepth: 0.003,
      gain: 0.32,
      delaySend: 0.04,
      reverbSend: 0.08,
    },
  },
  strings6: {
    label: "String Pad V6",
    params: {
      waveform: "triangle",
      attack: 1.2,
      decay: 2.0,
      sustain: 0.4,
      release: 6.0,
      cutoff: 700,
      resonance: 0.12,
      detuneCents: 18,
      vibratoRate: 5.2,
      vibratoDepth: 4,
      minDecay: 1.0,
      maxDecay: 4.0,
      decayLfoRate: 0.03,
      noiseMix: 0.1,
      noiseCutoff: 2200,
      gain: 0.15,
      glide: 0.08,
      gateTime: 0.3,
      delaySend: 0.12,
      reverbSend: 0.30,
    },
  },
  sample: {
    label: "Sample Bed",
    params: {
      volume: 0.08,
      cutoff: 1200,
      lfoRate: 0.012,
      lfoDepth: 180,
      delaySend: 0.0,
      reverbSend: 0.0,
    },
  },
};

}

computeCycleDuration() {
return (60 / this.bpm) * 4;
}

getSynthControlLayout() {
return [
{
id: "drone",
label: this.synthModels.drone.label,
controls: [
{ key: "waveform", label: "Wave", type: "select", options: WAVE_OPTIONS, value: this.synthModels.drone.params.waveform },
{ key: "attack", label: "Attack", min: 0.005, max: 4, step: 0.005, value: this.synthModels.drone.params.attack },
{ key: "decay", label: "Decay", min: 0.005, max: 4, step: 0.005, value: this.synthModels.drone.params.decay },
{ key: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.sustain },
{ key: "release", label: "Release", min: 0.02, max: 8, step: 0.01, value: this.synthModels.drone.params.release },
{ key: "cutoff", label: "Cutoff Hz", min: 120, max: 6000, step: 1, value: this.synthModels.drone.params.cutoff },
{ key: "resonance", label: "Resonance", min: 0.05, max: 0.95, step: 0.01, value: this.synthModels.drone.params.resonance },
{ key: "detuneCents", label: "Detune cents", min: 0, max: 30, step: 0.1, value: this.synthModels.drone.params.detuneCents },
{ key: "filterLfoRate", label: "Filter LFO Hz", min: 0.005, max: 0.3, step: 0.001, value: this.synthModels.drone.params.filterLfoRate },
{ key: "filterLfoDepth", label: "Filter LFO depth", min: 0, max: 250, step: 1, value: this.synthModels.drone.params.filterLfoDepth },
{ key: "foldAmount", label: "Fold amount", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.foldAmount },
{ key: "foldDrive", label: "Fold drive", min: 0.2, max: 6, step: 0.01, value: this.synthModels.drone.params.foldDrive },
{ key: "foldMix", label: "Fold mix", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.foldMix },
{ key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.delaySend },
{ key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.reverbSend },
{ key: "glide", label: "Glide sec", min: 0.003, max: 0.2, step: 0.001, value: this.synthModels.drone.params.glide },
{ key: "gain", label: "Gain", min: 0, max: 0.9, step: 0.01, value: this.synthModels.drone.params.gain },
],
},
{
id: "sparkle",
label: this.synthModels.sparkle.label,
controls: [
{ key: "brightness", label: "Brightness", min: 0.05, max: 0.95, step: 0.01, value: this.synthModels.sparkle.params.brightness },
{ key: "damping", label: "Damping", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.damping },
{ key: "nonLinearity", label: "Non-linearity", min: -1, max: 1, step: 0.01, value: this.synthModels.sparkle.params.nonLinearity },
{ key: "accent", label: "Accent", min: 0.1, max: 1.5, step: 0.01, value: this.synthModels.sparkle.params.accent },
{ key: "decay", label: "Decay / Ring", min: 0.1, max: 4.0, step: 0.01, value: this.synthModels.sparkle.params.decay },
{ key: "bodyResonance", label: "Body resonance", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.bodyResonance },
{ key: "bodyQ", label: "Body Q", min: 0.5, max: 12, step: 0.1, value: this.synthModels.sparkle.params.bodyQ },
{ key: "spread", label: "Stereo spread", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.spread },
{ key: "shimmerMix", label: "Shimmer mix", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.shimmerMix },
{ key: "shimmerTime", label: "Shimmer time", min: 0.05, max: 1.5, step: 0.01, value: this.synthModels.sparkle.params.shimmerTime },
{ key: "shimmerFeedback", label: "Shimmer feedback", min: 0, max: 0.92, step: 0.01, value: this.synthModels.sparkle.params.shimmerFeedback },
{ key: "shimmerTone", label: "Shimmer tone Hz", min: 400, max: 12000, step: 10, value: this.synthModels.sparkle.params.shimmerTone },
{ key: "shimmerModRate", label: "Shimmer mod Hz", min: 0.01, max: 4, step: 0.01, value: this.synthModels.sparkle.params.shimmerModRate },
{ key: "shimmerModDepth", label: "Shimmer mod depth", min: 0, max: 0.03, step: 0.0005, value: this.synthModels.sparkle.params.shimmerModDepth },
{ key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.delaySend },
{ key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.reverbSend },
{ key: "gain", label: "Gain", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.gain },
],
},
{
id: "strings6",
label: this.synthModels.strings6.label,
controls: [
{ key: "waveform", label: "Wave", type: "select", options: WAVE_OPTIONS, value: this.synthModels.strings6.params.waveform },
{ key: "attack", label: "Attack", min: 0.02, max: 4, step: 0.01, value: this.synthModels.strings6.params.attack },
{ key: "decay", label: "Decay", min: 0.02, max: 5, step: 0.01, value: this.synthModels.strings6.params.decay },
{ key: "sustain", label: "Sustain", min: 0, max: 1, step: 0.01, value: this.synthModels.strings6.params.sustain },
{ key: "release", label: "Release", min: 0.05, max: 8, step: 0.01, value: this.synthModels.strings6.params.release },
{ key: "cutoff", label: "Cutoff Hz", min: 180, max: 6000, step: 1, value: this.synthModels.strings6.params.cutoff },
{ key: "resonance", label: "Resonance", min: 0.05, max: 0.95, step: 0.01, value: this.synthModels.strings6.params.resonance },
{ key: "detuneCents", label: "Detune cents", min: 0, max: 35, step: 0.1, value: this.synthModels.strings6.params.detuneCents },
{ key: "vibratoRate", label: "Vibrato rate", min: 0.01, max: 6, step: 0.01, value: this.synthModels.strings6.params.vibratoRate },
{ key: "vibratoDepth", label: "Vibrato depth", min: 0, max: 30, step: 0.1, value: this.synthModels.strings6.params.vibratoDepth },
{ key: "minDecay", label: "Min decay", min: 0.05, max: 8, step: 0.01, value: this.synthModels.strings6.params.minDecay },
{ key: "maxDecay", label: "Max decay", min: 0.05, max: 8, step: 0.01, value: this.synthModels.strings6.params.maxDecay },
{ key: "decayLfoRate", label: "Decay LFO Hz", min: 0.005, max: 0.5, step: 0.001, value: this.synthModels.strings6.params.decayLfoRate },
{ key: "noiseMix", label: "Noise mix", min: 0, max: 0.5, step: 0.01, value: this.synthModels.strings6.params.noiseMix },
{ key: "noiseCutoff", label: "Noise cutoff Hz", min: 200, max: 8000, step: 1, value: this.synthModels.strings6.params.noiseCutoff },
{ key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.strings6.params.delaySend },
{ key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.strings6.params.reverbSend },
{ key: "glide", label: "Glide sec", min: 0.005, max: 0.5, step: 0.001, value: this.synthModels.strings6.params.glide },
{ key: "gateTime", label: "Gate sec", min: 0.08, max: 4, step: 0.01, value: this.synthModels.strings6.params.gateTime },
{ key: "gain", label: "Gain", min: 0, max: 1.0, step: 0.01, value: this.synthModels.strings6.params.gain },
],
},
{
id: "sample",
label: this.synthModels.sample.label,
controls: [
{ key: "volume", label: "Volume", min: 0, max: 0.5, step: 0.001, value: this.synthModels.sample.params.volume },
{ key: "cutoff", label: "Cutoff Hz", min: 120, max: 12000, step: 1, value: this.synthModels.sample.params.cutoff },
{ key: "lfoRate", label: "Filter LFO Hz", min: 0.001, max: 2, step: 0.001, value: this.synthModels.sample.params.lfoRate },
{ key: "lfoDepth", label: "Filter LFO depth", min: 0, max: 4000, step: 1, value: this.synthModels.sample.params.lfoDepth },
{ key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.sample.params.delaySend },
{ key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.sample.params.reverbSend },
],
},
];
}

setSynthParam(synthId, key, value) {
const model = this.synthModels[synthId];
if (!model || !(key in model.params)) {
return;
}

model.params[key] = value;

if (!this.ctx) {
  return;
}

if (synthId === "drone") {
  this.drone?.setParam(key, value);
} else if (synthId === "sparkle") {
  this.sparkle?.setParam(key, value);
} else if (synthId === "strings6") {
  this.strings6?.setParam(key, value);
} else if (synthId === "sample") {
  this.sampleBed?.setParam(key, value);
}

if (key === "delaySend" || key === "reverbSend") {
  this.applyInstrumentSends();
}

}

async init() {
if (this.ctx) {
return;
}

this.ctx = new AudioContext({ sampleRate: 48000 });
this.buildFxGraph();

this.drone = new DronePolySynth(this.ctx, this.instrumentIn.drone, this.synthModels.drone.params);
this.sparkle = new KarplusStrongPluck(this.ctx, this.instrumentIn.sparkle, this.synthModels.sparkle.params);
this.strings6 = new StringPadEngine(this.ctx, this.instrumentIn.strings6, this.synthModels.strings6.params);
this.sampleBed = new SampleBedEngine(this.ctx, this.instrumentIn.sample, this.synthModels.sample.params);
const loaded = await this.sampleBed.load([
  "./assets/samples/textured%20background.wav",
  "./assets/samples/textured background.wav",
  "../assets/samples/textured%20background.wav",
  "../assets/samples/textured background.wav",
]);
if (!loaded) {
  console.warn("Sample bed: no sample file found from configured paths.");
}
this.applyInstrumentSends();

}

buildFxGraph() {
this.dryInput = this.ctx.createGain();
this.delayInput = this.ctx.createGain();
this.reverbInput = this.ctx.createGain();

this.instrumentIn = {
  drone: this.ctx.createGain(),
  sparkle: this.ctx.createGain(),
  strings6: this.ctx.createGain(),
  sample: this.ctx.createGain(),
};
this.instrumentSend = {
  drone: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain() },
  sparkle: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain() },
  strings6: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain() },
  sample: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain() },
};

for (const key of Object.keys(this.instrumentIn)) {
  const input = this.instrumentIn[key];
  const send = this.instrumentSend[key];
  input.connect(send.dry);
  input.connect(send.delay);
  input.connect(send.reverb);
  send.dry.connect(this.dryInput);
  send.delay.connect(this.delayInput);
  send.reverb.connect(this.reverbInput);
}

this.preTone = this.ctx.createBiquadFilter();
this.preTone.type = "lowshelf";
this.preTone.frequency.value = 140;
this.preTone.gain.value = 4.2;

this.preCut = this.ctx.createBiquadFilter();
this.preCut.type = "lowpass";
this.preCut.frequency.value = 11000;

this.preLimiter = this.ctx.createDynamicsCompressor();
this.preLimiter.threshold.value = -18;
this.preLimiter.knee.value = 16;
this.preLimiter.ratio.value = 4;
this.preLimiter.attack.value = 0.003;
this.preLimiter.release.value = 0.16;

this.delayL = this.ctx.createDelay(2.0);
this.delayR = this.ctx.createDelay(2.0);
this.delayFbL = this.ctx.createGain();
this.delayFbR = this.ctx.createGain();
this.delayWetL = this.ctx.createGain();
this.delayWetR = this.ctx.createGain();
this.delayMerger = this.ctx.createChannelMerger(2);

this.reverbInputHp = this.ctx.createBiquadFilter();
this.reverbInputHp.type = "highpass";
this.reverbInputHp.frequency.value = 320;

this.reverbComp = this.ctx.createDynamicsCompressor();
this.reverbComp.threshold.value = -28;
this.reverbComp.knee.value = 24;
this.reverbComp.ratio.value = 12;
this.reverbComp.attack.value = 0.002;
this.reverbComp.release.value = 0.32;

this.reverb = this.ctx.createConvolver();
this.reverb.buffer = createImpulseResponse(this.ctx, 3.2, 4.0);

this.reverbLp = this.ctx.createBiquadFilter();
this.reverbLp.type = "lowpass";
this.reverbLp.frequency.value = 4200;

this.dryGain = this.ctx.createGain();
this.reverbGain = this.ctx.createGain();

this.masterGain = this.ctx.createGain();
this.masterGain.gain.value = 0.9;

this.masterHp = this.ctx.createBiquadFilter();
this.masterHp.type = "highpass";
this.masterHp.frequency.value = 22;

this.masterLimiter = this.ctx.createDynamicsCompressor();
this.masterLimiter.threshold.value = -8;
this.masterLimiter.knee.value = 8;
this.masterLimiter.ratio.value = 20;
this.masterLimiter.attack.value = 0.001;
this.masterLimiter.release.value = 0.12;

this.dryInput.connect(this.preTone);
this.preTone.connect(this.preCut);
this.preCut.connect(this.preLimiter);

this.preLimiter.connect(this.dryGain);

this.delayInput.connect(this.delayL);
this.delayInput.connect(this.delayR);

this.delayL.delayTime.value = this.delayTimeSec;
this.delayR.delayTime.value = this.delayTimeSec + 0.014;
this.delayFbL.gain.value = this.delayFeedback;
this.delayFbR.gain.value = this.delayFeedback;
this.delayWetL.gain.value = this.delayMix;
this.delayWetR.gain.value = this.delayMix;

this.delayL.connect(this.delayFbL);
this.delayFbL.connect(this.delayL);
this.delayR.connect(this.delayFbR);
this.delayFbR.connect(this.delayR);

this.delayL.connect(this.delayWetL);
this.delayR.connect(this.delayWetR);

this.delayWetL.connect(this.delayMerger, 0, 0);
this.delayWetR.connect(this.delayMerger, 0, 1);

this.delayMerger.connect(this.dryGain);
this.delayMerger.connect(this.reverbInputHp);

this.reverbInput.connect(this.reverbInputHp);
this.reverbInputHp.connect(this.reverbComp);
this.reverbComp.connect(this.reverb);
this.reverb.connect(this.reverbLp);
this.reverbLp.connect(this.reverbGain);

this.dryGain.connect(this.masterGain);
this.reverbGain.connect(this.masterGain);

this.setReverbMix(this.reverbMix);

this.masterGain.connect(this.masterHp);
this.masterHp.connect(this.masterLimiter);
this.masterLimiter.connect(this.ctx.destination);

}

applyInstrumentSends() {
if (!this.instrumentSend) {
return;
}
const map = {
drone: this.synthModels.drone.params,
sparkle: this.synthModels.sparkle.params,
strings6: this.synthModels.strings6.params,
sample: this.synthModels.sample.params,
};
const now = this.ctx ? this.ctx.currentTime : 0;

for (const key of Object.keys(map)) {
  const params = map[key];
  const sends = this.instrumentSend[key];
  sends.delay.gain.setTargetAtTime(clamp(params.delaySend ?? 0, 0, 1), now, 0.03);
  sends.reverb.gain.setTargetAtTime(clamp(params.reverbSend ?? 0, 0, 1), now, 0.03);
  sends.dry.gain.setTargetAtTime(1.0, now, 0.03);
}

}

setBpm(bpm) {
this.bpm = bpm;
this.cycleDurationSec = this.computeCycleDuration();
}

setReverbMix(value) {
this.reverbMix = value;
if (this.dryGain && this.reverbGain) {
this.dryGain.gain.value = 1 - value;
this.reverbGain.gain.value = value;
}
}

setDelayMix(value) {
this.delayMix = value;
if (this.delayWetL && this.delayWetR) {
this.delayWetL.gain.value = value;
this.delayWetR.gain.value = value;
}
}

setMaster(value) {
if (this.masterGain) {
this.masterGain.gain.value = value;
}
}

async start() {
await this.init();

if (this.ctx.state !== "running") {
  await this.ctx.resume();
}

this.seq.init();
this.running = true;
this.cycleDurationSec = this.computeCycleDuration();
this.nextCycleTime = this.ctx.currentTime + 0.06;
this.sampleBed?.start(this.ctx.currentTime);

if (this.schedulerTimer) {
  clearInterval(this.schedulerTimer);
}

this.schedulerTimer = setInterval(() => {
  this.scheduler();
}, this.schedulerIntervalMs);

}

stop() {
this.running = false;

if (this.schedulerTimer) {
  clearInterval(this.schedulerTimer);
  this.schedulerTimer = null;
}

if (!this.ctx) {
  return;
}

const now = this.ctx.currentTime;
this.drone?.allNotesOff(now);
this.strings6?.noteOff(now);
this.sampleBed?.stop(now);

}

scheduler() {
if (!this.running || !this.ctx) {
return;
}

const horizon = this.ctx.currentTime + this.lookAheadSec;

while (this.nextCycleTime < horizon) {
  this.scheduleCycle(this.nextCycleTime);
  this.nextCycleTime += this.cycleDurationSec;
}

}

scheduleCycle(cycleStartTime) {
this.seq.tick();

const droneVoiceMap = [0, 2, 4];

for (let slot = 0; slot < droneVoiceMap.length; slot += 1) {
  const seqVoice = this.seq.voices[droneVoiceMap[slot]];

  if (seqVoice.gate) {
    if (!seqVoice.prevGate) {
      this.drone.noteOn(slot, seqVoice.freq, cycleStartTime, true);
    } else {
      this.drone.noteOn(slot, seqVoice.freq, cycleStartTime, false);
    }
  } else if (seqVoice.prevGate) {
    this.drone.noteOff(slot, cycleStartTime);
  }
}

const followerVoiceMap = [1, 3, 5];

for (let fi = 0; fi < followerVoiceMap.length; fi += 1) {
  const seqVoice = this.seq.voices[followerVoiceMap[fi]];
  if (!seqVoice.gate) {
    continue;
  }

  const triggerTime = cycleStartTime + this.followerTriggerPoints[fi] * this.cycleDurationSec;

  if (fi === 0) {
    this.sparkle.trigger(seqVoice.freq, triggerTime, 0);
  } else if (fi === 1) {
    this.sparkle.trigger(seqVoice.freq, triggerTime, 1);
  } else {
    // Voice 6 – string pad
    // FIX: Always send noteOff before noteOn so the ADSR fully
    // resets.  We schedule the noteOff slightly before trigger so
    // the release cancel + new attack are properly sequenced.
    if (this.strings6.gate) {
      this.strings6.noteOff(triggerTime - 0.005);
    }
    this.strings6.noteOn(seqVoice.freq, triggerTime, true);
    const minHold = Math.max(0.04, this.synthModels.strings6.params.attack + 0.06);
    const hold = Math.max(this.synthModels.strings6.params.gateTime, minHold);
    this.strings6.noteOff(triggerTime + hold);
  }
}

if (typeof this.onCycle === "function") {
  this.onCycle(this.seq);
}

}
}

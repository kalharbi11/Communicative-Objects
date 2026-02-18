import { SequencerState } from "./sequencer.js";

const EPS = 0.0001;
const WAVE_OPTIONS = ["sine", "triangle", "sawtooth", "square"];
const VA_WAVE_OPTIONS = ["triangle", "sawtooth", "square", "polyblep_saw"];
const VA_VELOCITY_ROUTE_OPTIONS = ["off", "vcf", "vca", "vcf+vca"];
const SILENCE_TAIL_SEC = 0.012;
const MIN_ATTACK_SEC = 0.003;
const MIN_RELEASE_SEC = 0.01;
const KEYTRACK_REF_HZ = 261.625565; // C4

console.log("[audio-engine] BUILD:", "2026-02-17 A", "sparkleGainDefault=", 0.40);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function vaWaveToOscType(wave) {
  if (wave === "polyblep_saw") return "sawtooth";
  if (wave === "triangle" || wave === "sawtooth" || wave === "square") return wave;
  return "sawtooth";
}

function normToSeconds(value, minSec, maxSec, curve = 2.0) {
  const n = clamp(value, 0, 1);
  return minSec + (maxSec - minSec) * Math.pow(n, curve);
}

function normToLfoHz(value, maxHz = 8.0) {
  return 0.02 + clamp(value, 0, 1) * maxHz;
}

function freqToMidi(freq) {
  return 69 + (12 * Math.log2(Math.max(1, freq) / 440));
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

function createSoftClipCurve(amount = 2.2) {
  const size = 2048;
  const curve = new Float32Array(size);
  const drive = Math.max(0.5, amount);
  const norm = Math.tanh(drive);

  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
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

function rampGainToSilence(gainParam, startTime, releaseSec) {
  const release = Math.max(MIN_RELEASE_SEC, releaseSec);
  const releaseEnd = startTime + release;
  gainParam.exponentialRampToValueAtTime(EPS, releaseEnd);
  gainParam.linearRampToValueAtTime(0.0, releaseEnd + SILENCE_TAIL_SEC);
}

function envOff(gainParam, env, time) {
  const release = Math.max(0.015, env.release);
  holdAtTime(gainParam, time);
  rampGainToSilence(gainParam, time, release);
}

function createOutputToneStage(ctx, hpCutoff, lpCutoff) {
  const hpValue = Number.isFinite(hpCutoff) ? hpCutoff : 20;
  const lpValue = Number.isFinite(lpCutoff) ? lpCutoff : 20000;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = clamp(hpValue, 20, 1200);
  hp.Q.value = 0.707;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = clamp(lpValue, 1200, 20000);
  lp.Q.value = 0.707;

  hp.connect(lp);
  return { hp, lp };
}

function applyOutputToneStage(stage, hpCutoff, lpCutoff, time) {
  const hpValue = Number.isFinite(hpCutoff) ? hpCutoff : 20;
  const lpValue = Number.isFinite(lpCutoff) ? lpCutoff : 20000;
  stage.hp.frequency.setTargetAtTime(clamp(hpValue, 20, 1200), time, 0.04);
  stage.lp.frequency.setTargetAtTime(clamp(lpValue, 1200, 20000), time, 0.04);
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
      attack: 3.5,
      decay: 0.7,
      sustain: 1.0,
      release: 6.0,
      cutoff: 800,
      resonance: 0.15,
      detuneCents: 8,
      gain: 0.24,
      glide: 0.00,
      filterLfoRate: 0.06,
      filterLfoDepth: 80,
      foldAmount: 0.28,
      foldDrive: 1.8,
      foldMix: 0.42,
      outHpCutoff: 24,
      outLpCutoff: 5000,
      ...initialParams,
    };

    this.output = ctx.createGain();
    this.output.gain.value = this.params.gain;
    this.outTone = createOutputToneStage(ctx, this.params.outHpCutoff, this.params.outLpCutoff);
    this.output.connect(this.outTone.hp);
    this.outTone.lp.connect(outBus);

    // Two voices per slot allows release tails to finish when the same slot retriggers.
    this.voicesBySlot = Array.from({ length: 3 }, () => [this.createVoice(), this.createVoice()]);
    this.voices = this.voicesBySlot.flat();
    this.activeVoiceIndex = [0, 0, 0];

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
    const lfoRate = Math.max(0, this.params.filterLfoRate);
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
    applyOutputToneStage(this.outTone, this.params.outHpCutoff, this.params.outLpCutoff, time);
  }

  setVoiceFreq(voice, freq, time) {
    const detuneRatio = Math.pow(2, this.params.detuneCents / 1200);
    const glide = Math.max(0.003, this.params.glide);

    voice.oscA.frequency.setTargetAtTime(freq, time, glide);
    voice.oscB.frequency.setTargetAtTime(freq * detuneRatio, time, glide);
    voice.currentFreq = freq;
  }

  trigger(slot, freq, time, holdSec = 0.0) {
    const bank = this.voicesBySlot[slot];
    if (!bank || bank.length === 0) return;

    this.activeVoiceIndex[slot] = (this.activeVoiceIndex[slot] + 1) % bank.length;
    const voice = bank[this.activeVoiceIndex[slot]];

    this.setVoiceFreq(voice, freq, time);

    const attack = Math.max(MIN_ATTACK_SEC, this.params.attack);
    const decay = Math.max(0.01, this.params.decay);
    const sustain = clamp(this.params.sustain, EPS, 1.0);
    const release = Math.max(MIN_RELEASE_SEC, this.params.release);
    const hold = Math.max(0.02, holdSec);
    const clickGuard = 0.004;
    const releaseStart = time + clickGuard + attack + decay + hold;

    holdAtTime(voice.amp.gain, time);
    voice.amp.gain.setTargetAtTime(EPS, time, 0.003);
    voice.amp.gain.linearRampToValueAtTime(1.0, time + clickGuard + attack);
    voice.amp.gain.linearRampToValueAtTime(sustain, time + clickGuard + attack + decay);
    voice.amp.gain.setValueAtTime(sustain, releaseStart);
    rampGainToSilence(voice.amp.gain, releaseStart, release);
    voice.gate = true;
  }

  noteOn(slot, freq, time, retrigger = false) {
    const bank = this.voicesBySlot[slot];
    if (!bank || bank.length === 0) return;

    if (retrigger) {
      this.activeVoiceIndex[slot] = (this.activeVoiceIndex[slot] + 1) % bank.length;
    }

    const voice = bank[this.activeVoiceIndex[slot]];

    this.setVoiceFreq(voice, freq, time);

    if (retrigger || !voice.gate) {
      const attack = Math.max(MIN_ATTACK_SEC, this.params.attack);
      const decay = Math.max(0.01, this.params.decay);
      const sustain = clamp(this.params.sustain, EPS, 1.0);
      holdAtTime(voice.amp.gain, time);
      voice.amp.gain.linearRampToValueAtTime(1.0, time + attack);
      voice.amp.gain.linearRampToValueAtTime(sustain, time + attack + decay);
    }

    voice.gate = true;
  }

  noteOff(slot, time) {
    const bank = this.voicesBySlot[slot];
    if (!bank) return;

    const release = Math.max(MIN_RELEASE_SEC, this.params.release);
    for (const voice of bank) {
      holdAtTime(voice.amp.gain, time);
      rampGainToSilence(voice.amp.gain, time, release);
      voice.gate = false;
    }
  }

  allNotesOff(time) {
    for (let slot = 0; slot < this.voicesBySlot.length; slot += 1) this.noteOff(slot, time);
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

// Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€Ã¢â‚¬â€

// ----------------------------------------------------------------------------
// Sparkle engine: VA 7-Voice style (based on Nettech15 Daisy-Seed-7-Voice-VA-Synthesizer)
// Web version approximation: dual-osc + mix -> 4-pole LPF -> VCA, with separate ADSR for VCF + VCA.
// LFOs are implemented via AudioParams (pitch) and kept lightweight for browser stability.
// ----------------------------------------------------------------------------

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _makeBandlimitedPeriodicWave(ctx, type, duty = 0.5, harmonics = 64) {
  // PeriodicWave coefficients (real=cos, imag=sin). We use sine-series style shapes.
  // This is *not* perfect polyBLEP; it is a pragmatic anti-alias-ish wave for WebAudio.
  const n = Math.max(8, Math.min(256, harmonics | 0));
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  real[0] = 0; imag[0] = 0;

  if (type === "triangle") {
    // Odd harmonics, amplitude ~ 1/n^2 with alternating sign.
    for (let k = 1; k <= n; k += 2) {
      const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
      imag[k] = (8 / (Math.PI * Math.PI)) * sign / (k * k);
    }
  } else if (type === "square") {
    // Odd harmonics, amplitude ~ 1/n.
    for (let k = 1; k <= n; k += 2) {
      imag[k] = 4 / (Math.PI * k);
    }
  } else if (type === "sawtooth") {
    // All harmonics, amplitude ~ 1/n with alternating sign.
    for (let k = 1; k <= n; k += 1) {
      const sign = (k % 2 === 0) ? -1 : 1;
      imag[k] = (2 / (Math.PI * k)) * sign;
    }
  } else if (type === "pulse") {
    // Pulse (PWM) approximation. duty in (0..1). Uses sine-series b_k = 2/(kπ) * sin(kπd).
    const d = _clamp(duty, 0.01, 0.99);
    for (let k = 1; k <= n; k += 1) {
      imag[k] = (4 / (Math.PI * k)) * Math.sin(Math.PI * k * d);
    }
  } else {
    // Fallback to sine (shouldn't happen)
    imag[1] = 1;
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

function _waveIdToType(id) {
  // UI options: triangle / sawtooth / square / polyblep_saw
  if (id === "polyblep_saw") return "sawtooth";
  if (id === "polyb_lep_saw") return "sawtooth";
  if (id === "polyblep_saw") return "sawtooth";
  if (id === "triangle") return "triangle";
  if (id === "sawtooth") return "sawtooth";
  if (id === "square") return "square";
  return "triangle";
}

class VA7Voice {
  constructor(ctx, outBus) {
    this.ctx = ctx;
    this.outBus = outBus;

    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();

    this.osc1Gain = ctx.createGain();
    this.osc2Gain = ctx.createGain();
    this.mix = ctx.createGain();

    // 4-pole LPF approximation: two cascaded biquads
    this.f1 = ctx.createBiquadFilter();
    this.f2 = ctx.createBiquadFilter();
    this.f1.type = "lowpass";
    this.f2.type = "lowpass";

    this.vca = ctx.createGain();
    this.vca.gain.value = 0;

    // Output safety HP/LP (set per engine params)
    this.outHP = ctx.createBiquadFilter();
    this.outHP.type = "highpass";
    this.outLP = ctx.createBiquadFilter();
    this.outLP.type = "lowpass";

    // Routing
    this.osc1.connect(this.osc1Gain).connect(this.mix);
    this.osc2.connect(this.osc2Gain).connect(this.mix);
    this.mix.connect(this.f1);
    this.f1.connect(this.f2);
    this.f2.connect(this.vca);
    this.vca.connect(this.outHP);
    this.outHP.connect(this.outLP);
    this.outLP.connect(outBus);

    // Pitch LFO (AudioParam modulation)
    this.pitchLfo = ctx.createOscillator();
    this.pitchLfoGain = ctx.createGain();
    this.pitchLfoGain.gain.value = 0;
    this.pitchLfo.connect(this.pitchLfoGain);
    this.pitchLfoGain.connect(this.osc1.detune);
    this.pitchLfoGain.connect(this.osc2.detune);
    this.pitchLfo.start();

    // state
    this.active = false;
    this.started = false;
    this.noteOnTime = 0;
    this.baseFreq = 220;

    // cached for release scheduling
    this.envA = { a: 0.01, d: 0.2, s: 0.8, r: 0.2 };
    this.envF = { a: 0.01, d: 0.2, s: 0.5, r: 0.2 };
    this.filterBase = 1000;
    this.filterNoteBase = 1000;
    this.filterRes = 0.2;
    this.filterEnvAmt = 0.5;
    this.vcfKbdFollow = 0.0;
    this.envKbdFollow = 0.0;
    this.envTimeScale = 1.0;

    this.velocityRoute = "vcf+vca";
    this.vel = 1.0;
  }

  _ensureStarted(now) {
    if (this.started) return;
    this.osc1.start(now);
    this.osc2.start(now);
    this.started = true;
  }

  setStaticParams(params, now) {
    // Waveforms (band-limited periodic waves)
    const w1 = _waveIdToType(params.waveform);
    const w2 = _waveIdToType(params.osc2Waveform);

    // PWM: if square selected we allow PW to shape pulse; otherwise ignore PW.
    const pw1 = _clamp(params.oscPw ?? 0.5, 0.01, 0.99);
    const pw2 = _clamp(params.osc2Pw ?? 0.5, 0.01, 0.99);

    if (w1 === "square") this.osc1.setPeriodicWave(_makeBandlimitedPeriodicWave(this.ctx, "pulse", pw1, 64));
    else this.osc1.setPeriodicWave(_makeBandlimitedPeriodicWave(this.ctx, w1, 0.5, 64));

    if (w2 === "square") this.osc2.setPeriodicWave(_makeBandlimitedPeriodicWave(this.ctx, "pulse", pw2, 64));
    else this.osc2.setPeriodicWave(_makeBandlimitedPeriodicWave(this.ctx, w2, 0.5, 64));

    // Mix
    const mix = _clamp(params.oscMix ?? 0.5, 0, 1);
    // equal-power-ish crossfade
    this.osc1Gain.gain.setTargetAtTime(Math.cos(mix * Math.PI * 0.5), now, 0.02);
    this.osc2Gain.gain.setTargetAtTime(Math.sin(mix * Math.PI * 0.5), now, 0.02);

    // Filter base / res / amount
    this.filterBase = _clamp(params.filterCutoff ?? 1000, 30, 20000);
    this.filterRes = _clamp(params.filterRes ?? 0.2, 0.0001, 0.999);
    this.filterEnvAmt = _clamp(params.egFAmount ?? 0.5, 0, 2);
    this.vcfKbdFollow = _clamp(params.vcfKbdFollow ?? 0.0, 0, 1);
    this.envKbdFollow = _clamp(params.envKbdFollow ?? 0.0, 0, 1);
    const keyTracking = this._computeKeyTracking(this.baseFreq || KEYTRACK_REF_HZ);
    this.envTimeScale = keyTracking.envScale;
    this.filterNoteBase = _clamp(this.filterBase * keyTracking.cutoffScale, 30, 20000);

    // Q mapping: keep stable (biquad Q can explode)
    const q = 0.5 + this.filterRes * 18.0;
    this.f1.Q.setTargetAtTime(q, now, 0.02);
    this.f2.Q.setTargetAtTime(q, now, 0.02);
    this.f1.frequency.setTargetAtTime(this.filterNoteBase, now, 0.03);
    this.f2.frequency.setTargetAtTime(this.filterNoteBase, now, 0.03);

    // Output HP/LP
    this.outHP.frequency.setTargetAtTime(_clamp(params.outHpCutoff ?? 20, 10, 8000), now, 0.02);
    this.outLP.frequency.setTargetAtTime(_clamp(params.outLpCutoff ?? 20000, 200, 20000), now, 0.02);

    // Pitch LFO
    this.pitchLfo.type = params.lfoWaveform === "sine" ? "sine" : "triangle";
    this.pitchLfo.frequency.setTargetAtTime(_clamp(params.lfoFreq ?? 0.1, 0.01, 25), now, 0.02);
    // lfoAmp in UI is small (e.g. 0.024). Treat as ~cents = value*1000.
    this.pitchLfoGain.gain.setTargetAtTime(_clamp((params.lfoAmp ?? 0) * 1000, 0, 200), now, 0.05);

    // Velocity routing (string)
    this.velocityRoute = params.velSelect ?? "vcf+vca";
  }

  _computeKeyTracking(freq) {
    const safeFreq = Math.max(1, freq);
    const midi = _clamp(freqToMidi(safeFreq), 0, 120);
    const keyPos = _clamp((midi - 24) / 84, 0, 1); // low->high range

    // Typical key tracking: higher notes open filter more.
    const cutoffScale = _clamp(
      Math.pow(safeFreq / KEYTRACK_REF_HZ, this.vcfKbdFollow),
      0.125,
      8.0,
    );

    // Higher notes shorten envelopes as env key-follow increases.
    const envScale = _clamp(1.0 - (this.envKbdFollow * keyPos * 0.7), 0.2, 1.0);

    return { cutoffScale, envScale };
  }

  setEnvelopeParams(params) {
    this.envA = {
      a: _clamp(params.egAAttack ?? 0.01, 0.001, 10),
      d: _clamp(params.egADecay ?? 0.2, 0.001, 10),
      s: _clamp(params.egASustain ?? 0.8, 0, 1),
      r: _clamp(params.egARelease ?? 0.2, 0.001, 20),
    };
    this.envF = {
      a: _clamp(params.egFAttack ?? 0.01, 0.001, 10),
      d: _clamp(params.egFDecay ?? 0.2, 0.001, 10),
      s: _clamp(params.egFSustain ?? 0.5, 0, 1),
      r: _clamp(params.egFRelease ?? 0.2, 0.001, 20),
    };
  }

  _scheduleVCAOn(now) {
    // Attack/Decay/Sustain
    const A = Math.max(MIN_ATTACK_SEC, this.envA.a * this.envTimeScale);
    const D = Math.max(0.002, this.envA.d * this.envTimeScale);
    const S = this.envA.s;

    this.vca.gain.cancelScheduledValues(now);
    this.vca.gain.setValueAtTime(0.0, now);

    const peak = 1.0;
    const sustain = S;

    this.vca.gain.linearRampToValueAtTime(peak, now + A);
    this.vca.gain.linearRampToValueAtTime(sustain, now + A + D);
  }

  _scheduleVCFOn(now) {
    const A = Math.max(MIN_ATTACK_SEC, this.envF.a * this.envTimeScale);
    const D = Math.max(0.002, this.envF.d * this.envTimeScale);
    const S = this.envF.s;

    // Velocity to filter (optional)
    const velToF = (this.velocityRoute === "vcf" || this.velocityRoute === "vcf+vca") ? this.vel : 1.0;

    // Use cutoff-relative env modulation so low cutoff values stay meaningful.
    const base = this.filterNoteBase;
    const amt = _clamp(this.filterEnvAmt * velToF, 0, 2);
    const peakMul = 1.0 + (2.5 * amt);
    const susMul = 1.0 + (2.5 * amt * S);

    const c0 = _clamp(base, 30, 20000);
    const cPeak = _clamp(base * peakMul, 30, 20000);
    const cSus = _clamp(base * susMul, 30, 20000);

    const p1 = now + A;
    const p2 = now + A + D;

    this.f1.frequency.cancelScheduledValues(now);
    this.f2.frequency.cancelScheduledValues(now);
    this.f1.frequency.setValueAtTime(c0, now);
    this.f2.frequency.setValueAtTime(c0, now);
    this.f1.frequency.linearRampToValueAtTime(cPeak, p1);
    this.f2.frequency.linearRampToValueAtTime(cPeak, p1);
    this.f1.frequency.linearRampToValueAtTime(cSus, p2);
    this.f2.frequency.linearRampToValueAtTime(cSus, p2);
  }

  noteOn(freq, now, params, vel = 1.0) {
    this._ensureStarted(now);
    this.active = true;
    this.noteOnTime = now;
    this.vel = _clamp(vel, 0.01, 1.0);

    // Base frequency (with osc2 transpose + detune)
    this.baseFreq = Math.max(10, freq);
    // Apply static params (waves, mix, output filters, LFO)
    this.setEnvelopeParams(params);
    this.setStaticParams(params, now);

    const osc2Transpose = params.osc2Transpose ?? 1.0;
    const osc2Detune = params.osc2Detune ?? 0.0; // semitones-ish small range
    const masterDetuneHz = params.detune ?? 0.0;
    const masterTuneSt = params.masterTune ?? 0.0;

    // We do tuning in Hz->cents domain for detune params.
    const tuneRatio = Math.pow(2, masterTuneSt / 12);
    const f1 = this.baseFreq * tuneRatio;
    const f2 = this.baseFreq * tuneRatio * Math.max(0.01, osc2Transpose);

    this.osc1.frequency.setValueAtTime(f1, now);
    this.osc2.frequency.setValueAtTime(f2, now);

    // master detune Hz -> cents approx around f1
    const detuneCents = (masterDetuneHz / Math.max(1, f1)) * 1200 / Math.LN2;
    this.osc1.detune.setTargetAtTime(detuneCents, now, 0.02);
    this.osc2.detune.setTargetAtTime(detuneCents + (osc2Detune * 100), now, 0.02);

    // Velocity to VCA
    const velToA = (this.velocityRoute === "vca" || this.velocityRoute === "vcf+vca") ? this.vel : 1.0;
    const vcaScale = 0.9 * velToA; // keep headroom
    this.mix.gain.setTargetAtTime(vcaScale, now, 0.01);

    // Schedule envelopes
    this._scheduleVCAOn(now);
    this._scheduleVCFOn(now);
  }

  noteOff(now) {
    if (!this.active) return;
    this.active = false;

    const R = Math.max(MIN_RELEASE_SEC, this.envA.r * this.envTimeScale);
    const RF = Math.max(0.003, this.envF.r * this.envTimeScale);

    // VCA release
    const gNow = this.vca.gain.value;
    this.vca.gain.cancelScheduledValues(now);
    this.vca.gain.setValueAtTime(gNow, now);
    this.vca.gain.linearRampToValueAtTime(0.0, now + R);

    // Filter release: glide toward base
    const base = _clamp(this.filterNoteBase, 30, 20000);
    this.f1.frequency.cancelScheduledValues(now);
    this.f2.frequency.cancelScheduledValues(now);
    this.f1.frequency.setValueAtTime(this.f1.frequency.value, now);
    this.f2.frequency.setValueAtTime(this.f2.frequency.value, now);
    this.f1.frequency.linearRampToValueAtTime(base, now + RF);
    this.f2.frequency.linearRampToValueAtTime(base, now + RF);
  }
}

class VA7VoiceSynth {
  constructor(ctx, outBus, params, numSlots = 2) {
    this.ctx = ctx;
    this.outBus = outBus;
    this.params = { ...params };

    this.output = ctx.createGain();
    this.output.gain.value = this.params.gain ?? 0.4;
    this.output.connect(outBus);

    this.voicesBySlot = Array.from({ length: numSlots }, () => new VA7Voice(ctx, this.output));

    // tiny de-click safety: always keep output from jumping
    this.output.gain.setTargetAtTime(this.output.gain.value, ctx.currentTime, 0.02);
  }

  setParam(key, value) {
    this.params[key] = value;
    const now = this.ctx.currentTime;

    if (key === "gain") {
      this.output.gain.setTargetAtTime(value, now, 0.02);
      return;
    }

    // For all other params, push to all voices (static params)
    for (const v of this.voicesBySlot) {
      v.setEnvelopeParams(this.params);
      v.setStaticParams(this.params, now);
    }
  }

  trigger(freq, time, slot = 0) {
    const idx = _clamp(slot | 0, 0, this.voicesBySlot.length - 1);
    // If already active, soft-release first to avoid discontinuity
    this.voicesBySlot[idx].noteOff(time);
    this.voicesBySlot[idx].noteOn(freq, time, this.params, 1.0);
  }

  release(slot = 0, time) {
    const idx = _clamp(slot | 0, 0, this.voicesBySlot.length - 1);
    this.voicesBySlot[idx].noteOff(time);
  }

  allNotesOff(time) {
    for (let i = 0; i < this.voicesBySlot.length; i += 1) this.release(i, time);
  }
}

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
      gain: 0.12,
      glide: 0.00,
      gateTime: 0.3,
      minDecay: 1.0,
      maxDecay: 4.0,
      decayLfoRate: 0.03,
      noiseMix: 0.1,
      noiseCutoff: 2200,
      outHpCutoff: 45,
      outLpCutoff: 15000,
      ...initialParams,
    };

    this.output = ctx.createGain();
    this.output.gain.value = this.params.gain;
    this.outTone = createOutputToneStage(ctx, this.params.outHpCutoff, this.params.outLpCutoff);
    this.output.connect(this.outTone.hp);
    this.outTone.lp.connect(outBus);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.params.cutoff;
    this.filter.Q.value = mapResToQ(this.params.resonance);

    this.amp = ctx.createGain();
    this.amp.gain.value = EPS;

    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1.0;
    this.voiceBus.connect(this.filter);
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
    this.noiseGain.connect(this.voiceBus);
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
      gain.connect(this.voiceBus);
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
    applyOutputToneStage(this.outTone, this.params.outHpCutoff, this.params.outLpCutoff, time);

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

  noteOn(freq, time, retrigger = true) {
    for (const voice of this.oscs) this.setFreq(voice, freq, time);

    if (retrigger || !this.gate) {
      const attack = Math.max(MIN_ATTACK_SEC, this.params.attack);
      const lfo = Math.sin(time * this.params.decayLfoRate * Math.PI * 2);
      const decayNorm = (lfo + 1) * 0.5;
      const decay = this.params.minDecay + decayNorm * (this.params.maxDecay - this.params.minDecay);
      const sustain = clamp(this.params.sustain, EPS, 1.0);
      const baseCut = clamp(this.params.cutoff, 120, 12000);
      const peakCut = clamp(baseCut * 2.6, baseCut + 20, 12000);

      // Smooth retrigger to avoid clicks while still giving a clear attack.
      holdAtTime(this.amp.gain, time);
      this.amp.gain.setTargetAtTime(EPS, time, 0.003);
      this.amp.gain.linearRampToValueAtTime(1.0, time + 0.006 + attack);
      this.amp.gain.linearRampToValueAtTime(sustain, time + attack + Math.max(0.02, decay));

      // Tie cutoff movement to the note envelope so filter is clearly audible.
      holdAtTime(this.filter.frequency, time);
      this.filter.frequency.setValueAtTime(Math.max(120, baseCut * 0.65), time);
      this.filter.frequency.linearRampToValueAtTime(peakCut, time + Math.max(0.01, attack * 0.75));
      this.filter.frequency.exponentialRampToValueAtTime(
        Math.max(120, baseCut),
        time + attack + Math.max(0.04, decay * 0.9),
      );
    }

    this.gate = true;
  }

  noteOff(time) {
    const release = Math.max(MIN_RELEASE_SEC, this.params.release);
    const baseCut = clamp(this.params.cutoff, 120, 12000);

    holdAtTime(this.amp.gain, time);
    rampGainToSilence(this.amp.gain, time, release);

    holdAtTime(this.filter.frequency, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(120, baseCut * 0.65),
      time + Math.max(0.03, release * 0.85),
    );

    this.gate = false;
  }

  trigger(freq, time, holdSec = null) {
    this.noteOn(freq, time, true);
    const minHold = Math.max(0.04, this.params.attack + this.params.decay + 0.08);
    const hold = Math.max(minHold, holdSec ?? this.params.gateTime);
    this.noteOff(time + hold);
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
      loopBlendSec: 0.09,
      startFadeSec: 0.4,
      stopFadeSec: 0.08,
      startOffsetSec: 0.0,
      outHpCutoff: 24,
      outLpCutoff: 18000,
      ...initialParams,
    };

    this.output = ctx.createGain();
    this.output.gain.value = this.params.volume;
    this.outTone = createOutputToneStage(ctx, this.params.outHpCutoff, this.params.outLpCutoff);
    this.output.connect(this.outTone.hp);
    this.outTone.lp.connect(outBus);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.params.cutoff;
    this.filter.Q.value = 0.5;
    this.filter.connect(this.output);

    this.sourceGain = ctx.createGain();
    this.sourceGain.gain.value = 0.0;
    this.sourceGain.connect(this.filter);

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

  createLoopBlendedBuffer(buffer) {
    const blendSec = clamp(this.params.loopBlendSec, 0, 0.75);
    const maxBlend = Math.floor(buffer.length * 0.25);
    const blendSamples = Math.min(Math.floor(blendSec * buffer.sampleRate), maxBlend);
    if (blendSamples < 32) return buffer;

    const edgeStart = buffer.length - blendSamples;
    const out = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      dst.set(src);

      for (let i = 0; i < blendSamples; i += 1) {
        const x = i / (blendSamples - 1);
        const fadeIn = Math.sin(x * Math.PI * 0.5);
        const fadeOut = Math.cos(x * Math.PI * 0.5);
        const head = src[i];
        const tail = src[edgeStart + i];

        dst[i] = (head * fadeIn) + (tail * fadeOut);
        dst[edgeStart + i] = (tail * fadeIn) + (head * fadeOut);
      }
    }

    return out;
  }

  async load(urlCandidates) {
    for (const url of urlCandidates) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const arr = await response.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arr.slice(0));
        this.buffer = this.createLoopBlendedBuffer(decoded);
        return true;
      } catch (err) {
        // keep trying fallback urls
      }
    }
    return false;
  }

  start(time) {
    if (!this.buffer || this.source) return;

    const src = this.ctx.createBufferSource();
    const startAt = Math.max(this.ctx.currentTime, Number.isFinite(time) ? time : this.ctx.currentTime);
    const fadeIn = clamp(this.params.startFadeSec, 0.02, 2.5);
    const startOffset = Math.max(0, this.params.startOffsetSec);
    const loopOffset = this.buffer.duration > 0 ? startOffset % this.buffer.duration : 0;

    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.sourceGain);
    holdAtTime(this.sourceGain.gain, startAt);
    this.sourceGain.gain.setValueAtTime(0.0, startAt);
    this.sourceGain.gain.linearRampToValueAtTime(1.0, startAt + fadeIn);
    src.start(startAt, loopOffset);
    this.source = src;
  }

  stop(time) {
    if (!this.source) return;
    const src = this.source;
    this.source = null;
    const stopAt = Math.max(this.ctx.currentTime, Number.isFinite(time) ? time : this.ctx.currentTime);
    const fadeOut = clamp(this.params.stopFadeSec, 0.01, 1.0);
    const disconnectAt = stopAt + fadeOut + 0.02;

    holdAtTime(this.sourceGain.gain, stopAt);
    this.sourceGain.gain.linearRampToValueAtTime(EPS, stopAt + fadeOut);
    this.sourceGain.gain.linearRampToValueAtTime(0.0, disconnectAt);

    src.onended = () => {
      try {
        src.disconnect();
      } catch (err) {
        // ignore stale source disconnect calls
      }
    };
    try {
      src.stop(disconnectAt);
    } catch (err) {
      // ignore stale source stop calls
    }
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
      this.filterLfo.frequency.setTargetAtTime(clamp(value, 0, 2.0), now, 0.05);
      return;
    }
    if (key === "lfoDepth") {
      this.filterLfoGain.gain.setTargetAtTime(clamp(value, 0, 4000), now, 0.05);
      return;
    }
    if (key === "outHpCutoff" || key === "outLpCutoff") {
      applyOutputToneStage(this.outTone, this.params.outHpCutoff, this.params.outLpCutoff, now);
    }
  }
}

export class TuringAudioEngine {
  constructor() {
    this.ctx = null;
    this.seq = new SequencerState();
    this.startCycleOffset = 9;

    // Global defaults (match screenshot)
    this.bpm = 50;
    this.reverbMix = 0.34;
    this.delayMix = 0.18;
    this.delayFeedback = 0.24;
    this.delayTimeSec = 0.62;
    this.shimmerMix = 0.12;
    this.delayModRate = 0.12;
    this.delayModDepth = 0.0024;
    this.shimmerModRate = 0.22;
    this.shimmerModDepth = 0.0030;
    this.masterLevel = 0.9;
    this.debugBypassDelayReverbSends = false;
    this.startupGainRampSec = 0.14;
    this.fxSendRampDelaySec = 0.35;
    this.fxSendRampSec = 0.28;
    this.fxFeedbackRampSec = 0.35;
    this.startScheduleDelaySec = 0.72;
    this.sampleStartDelaySec = 0.12;

    this.cycleDurationSec = this.computeCycleDuration();
    this.nextCycleTime = 0;
    this.lookAheadSec = 0.2;
    this.schedulerIntervalMs = 20;
    this.schedulerTimer = null;
    this.running = false;

    this.followerTriggerPoints = [0.4, 0.1, 0.0];
    this.onCycle = null;

    // Instrument defaults (match screenshot)
    this.synthModels = {
      drone: {
        label: "Drone Poly (V1 V3 V5)",
        params: {
          waveform: "sawtooth",
          attack: 2.46,
          decay: 2.9,
          sustain: 0.37,
          release: 6.11,
          cutoff: 532,
          resonance: 0.13,
          detuneCents: 11.0,
          gain: 0.27,
          glide: 0.025,
          filterLfoRate: 0.0,
          filterLfoDepth: 49.0,
          foldAmount: 0.17,
          foldDrive: 1.71,
          foldMix: 0.31,
          outHpCutoff: 68,
          outLpCutoff: 5753,
          delaySend: 0.05,
          reverbSend: 0.09,
          shimmerSend: 0.07,
        },
      },

      sparkle: {
        label: "VA 7-Voice (V2 + V4)",
        params: {
          waveform: "triangle",
          oscMix: 0.39,
          detune: 0.0,
          oscPw: 0.22,
          osc2Waveform: "sawtooth",
          osc2Detune: 0.10,
          osc2Transpose: 0.98,
          osc2Pw: 0.39,
          egAAttack: 0.315,
          egADecay: 0.238,
          egASustain: 0.336,
          egARelease: 0.255,
          egFAttack: 0.290,
          egFDecay: 0.342,
          egFSustain: 0.238,
          egFRelease: 0.259,
          lfoWaveform: "triangle",
          lfoFreq: 0.0,
          lfoAmp: 0.0,
          pwmLfoWaveform: "sawtooth",
          pwmLfoFreq: 0.485,
          pwmLfoAmp: 0.026,
          pwm2LfoWaveform: "triangle",
          pwm2LfoFreq: 0.196,
          pwm2LfoAmp: 0.040,
          vcaVcfLfoWaveform: "triangle",
          vcaVcfLfoFreq: 0.03,
          vcaVcfLfoAmp: 0.00,
          vcfKbdFollow: 1.00,
          envKbdFollow: 1.00,
          filterRes: 0.05,
          filterCutoff: 305,
          egFAmount: 1.25,
          velSelect: "vcf+vca",
          midiChannel: 1,
          masterTune: 0.00,
          gain: 0.32,
          outHpCutoff: 112,
          outLpCutoff: 6872,
          delaySend: 0.42,
          reverbSend: 0.43,
          shimmerSend: 0.30,
        },
      },

      strings6: {
        label: "String Pad V6",
        params: {
          waveform: "sawtooth",
          attack: 2.72,
          decay: 4.26,
          sustain: 0.8,
          release: 4.1,
          cutoff: 270,
          resonance: 0.06,
          detuneCents: 12.0,
          vibratoRate: 4.51,
          vibratoDepth: 25.9,
          minDecay: 1.4,
          maxDecay: 2.56,
          decayLfoRate: 0.0,
          noiseMix: 0.36,
          noiseCutoff: 2764,
          outHpCutoff: 195,
          outLpCutoff: 15000,
          delaySend: 0.57,
          reverbSend: 0.4,
          shimmerSend: 0.58,
          glide: 0.021,
          gateTime: 3.078,
          gain: 0.4,
        },
      },

      sample: {
        label: "Sample Bed",
        params: {
          volume: 0.028,
          cutoff: 2864,
          lfoRate: 0.0,
          lfoDepth: 160.0,
          outHpCutoff: 218,
          outLpCutoff: 7571,
          delaySend: 0.0,
          reverbSend: 0.0,
          shimmerSend: 0.0,
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
          { key: "filterLfoRate", label: "Filter LFO Hz", min: 0, max: 0.3, step: 0.001, value: this.synthModels.drone.params.filterLfoRate },
          { key: "filterLfoDepth", label: "Filter LFO depth", min: 0, max: 250, step: 1, value: this.synthModels.drone.params.filterLfoDepth },
          { key: "foldAmount", label: "Fold amount", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.foldAmount },
          { key: "foldDrive", label: "Fold drive", min: 0.2, max: 6, step: 0.01, value: this.synthModels.drone.params.foldDrive },
          { key: "foldMix", label: "Fold mix", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.foldMix },
          { key: "outHpCutoff", label: "Low cut Hz", min: 20, max: 1200, step: 1, value: this.synthModels.drone.params.outHpCutoff },
          { key: "outLpCutoff", label: "High cut Hz", min: 1200, max: 20000, step: 1, value: this.synthModels.drone.params.outLpCutoff },
          { key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.delaySend },
          { key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.reverbSend },
          { key: "shimmerSend", label: "Shimmer send", min: 0, max: 1, step: 0.01, value: this.synthModels.drone.params.shimmerSend },
          { key: "glide", label: "Glide sec", min: 0.003, max: 0.2, step: 0.001, value: this.synthModels.drone.params.glide },
          { key: "gain", label: "Gain", min: 0, max: 0.9, step: 0.01, value: this.synthModels.drone.params.gain },
        ],
      },

      
      {
        id: "sparkle",
        label: this.synthModels.sparkle.label,
        controls: [
          { key: "waveform", label: "Osc1 Wave", type: "select", options: VA_WAVE_OPTIONS, value: this.synthModels.sparkle.params.waveform },
          { key: "osc2Waveform", label: "Osc2 Wave", type: "select", options: VA_WAVE_OPTIONS, value: this.synthModels.sparkle.params.osc2Waveform },
          { key: "oscMix", label: "Osc mix", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.oscMix },
          { key: "detune", label: "Master detune Hz", min: -60, max: 60, step: 0.1, value: this.synthModels.sparkle.params.detune },
          { key: "masterTune", label: "Master tune st", min: -2, max: 2, step: 0.01, value: this.synthModels.sparkle.params.masterTune },
          { key: "oscPw", label: "Osc1 PW", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.oscPw },
          { key: "osc2Pw", label: "Osc2 PW", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.osc2Pw },
          { key: "osc2Detune", label: "Osc2 detune", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.osc2Detune },
          { key: "osc2Transpose", label: "Osc2 transpose", min: 0.25, max: 4, step: 0.01, value: this.synthModels.sparkle.params.osc2Transpose },

          { key: "egFAttack", label: "VCF attack", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egFAttack },
          { key: "egFDecay", label: "VCF decay", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egFDecay },
          { key: "egFSustain", label: "VCF sustain", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egFSustain },
          { key: "egFRelease", label: "VCF release", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egFRelease },
          { key: "egAAttack", label: "VCA attack", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egAAttack },
          { key: "egADecay", label: "VCA decay", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egADecay },
          { key: "egASustain", label: "VCA sustain", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egASustain },
          { key: "egARelease", label: "VCA release", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.egARelease },

          { key: "filterCutoff", label: "VCF cutoff Hz", min: 40, max: 18000, step: 1, value: this.synthModels.sparkle.params.filterCutoff },
          { key: "filterRes", label: "VCF resonance", min: 0.01, max: 0.95, step: 0.01, value: this.synthModels.sparkle.params.filterRes },
          { key: "egFAmount", label: "VCF env amount", min: 0, max: 2, step: 0.01, value: this.synthModels.sparkle.params.egFAmount },
          { key: "vcfKbdFollow", label: "VCF key follow", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.vcfKbdFollow },
          { key: "envKbdFollow", label: "ENV key follow", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.envKbdFollow },

          { key: "lfoWaveform", label: "Pitch LFO wave", type: "select", options: VA_WAVE_OPTIONS, value: this.synthModels.sparkle.params.lfoWaveform },
          { key: "lfoFreq", label: "Pitch LFO rate", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.lfoFreq },
          { key: "lfoAmp", label: "Pitch LFO depth", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.lfoAmp },

          { key: "pwmLfoWaveform", label: "PWM1 LFO wave", type: "select", options: VA_WAVE_OPTIONS, value: this.synthModels.sparkle.params.pwmLfoWaveform },
          { key: "pwmLfoFreq", label: "PWM1 LFO rate", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.pwmLfoFreq },
          { key: "pwmLfoAmp", label: "PWM1 LFO depth", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.pwmLfoAmp },

          { key: "pwm2LfoWaveform", label: "PWM2 LFO wave", type: "select", options: VA_WAVE_OPTIONS, value: this.synthModels.sparkle.params.pwm2LfoWaveform },
          { key: "pwm2LfoFreq", label: "PWM2 LFO rate", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.pwm2LfoFreq },
          { key: "pwm2LfoAmp", label: "PWM2 LFO depth", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.pwm2LfoAmp },

          { key: "vcaVcfLfoWaveform", label: "VCA/VCF LFO wave", type: "select", options: VA_WAVE_OPTIONS, value: this.synthModels.sparkle.params.vcaVcfLfoWaveform },
          { key: "vcaVcfLfoFreq", label: "VCA/VCF LFO rate", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.vcaVcfLfoFreq },
          { key: "vcaVcfLfoAmp", label: "VCA/VCF LFO depth", min: 0, max: 1, step: 0.001, value: this.synthModels.sparkle.params.vcaVcfLfoAmp },

          { key: "velSelect", label: "Velocity route", type: "select", options: VA_VELOCITY_ROUTE_OPTIONS, value: this.synthModels.sparkle.params.velSelect },
          { key: "midiChannel", label: "MIDI channel", min: 1, max: 16, step: 1, value: this.synthModels.sparkle.params.midiChannel },
          { key: "outHpCutoff", label: "Low cut Hz", min: 20, max: 1200, step: 1, value: this.synthModels.sparkle.params.outHpCutoff },
          { key: "outLpCutoff", label: "High cut Hz", min: 1200, max: 20000, step: 1, value: this.synthModels.sparkle.params.outLpCutoff },

          { key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.delaySend },
          { key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.reverbSend },
          { key: "shimmerSend", label: "Shimmer send", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.shimmerSend },

          { key: "gain", label: "Gain", min: 0, max: 2.0, step: 0.01, value: this.synthModels.sparkle.params.gain },
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
          { key: "decayLfoRate", label: "Decay LFO Hz", min: 0, max: 0.5, step: 0.001, value: this.synthModels.strings6.params.decayLfoRate },
          { key: "noiseMix", label: "Noise mix", min: 0, max: 0.5, step: 0.01, value: this.synthModels.strings6.params.noiseMix },
          { key: "noiseCutoff", label: "Noise cutoff Hz", min: 200, max: 8000, step: 1, value: this.synthModels.strings6.params.noiseCutoff },
          { key: "outHpCutoff", label: "Low cut Hz", min: 20, max: 1200, step: 1, value: this.synthModels.strings6.params.outHpCutoff },
          { key: "outLpCutoff", label: "High cut Hz", min: 1200, max: 20000, step: 1, value: this.synthModels.strings6.params.outLpCutoff },
          { key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.strings6.params.delaySend },
          { key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.strings6.params.reverbSend },
          { key: "shimmerSend", label: "Shimmer send", min: 0, max: 1, step: 0.01, value: this.synthModels.strings6.params.shimmerSend },
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
          { key: "lfoRate", label: "Filter LFO Hz", min: 0, max: 2, step: 0.001, value: this.synthModels.sample.params.lfoRate },
          { key: "lfoDepth", label: "Filter LFO depth", min: 0, max: 4000, step: 1, value: this.synthModels.sample.params.lfoDepth },
          { key: "outHpCutoff", label: "Low cut Hz", min: 20, max: 1200, step: 1, value: this.synthModels.sample.params.outHpCutoff },
          { key: "outLpCutoff", label: "High cut Hz", min: 1200, max: 20000, step: 1, value: this.synthModels.sample.params.outLpCutoff },
          { key: "delaySend", label: "Delay send", min: 0, max: 1, step: 0.01, value: this.synthModels.sample.params.delaySend },
          { key: "reverbSend", label: "Reverb send", min: 0, max: 1, step: 0.01, value: this.synthModels.sample.params.reverbSend },
          { key: "shimmerSend", label: "Shimmer send", min: 0, max: 1, step: 0.01, value: this.synthModels.sample.params.shimmerSend },
        ],
      },
    ];
  }

  setSynthParam(synthId, key, value) {
    const model = this.synthModels[synthId];
    if (!model || !(key in model.params)) return;

    model.params[key] = value;

    if (!this.ctx) return;

    if (synthId === "drone") this.drone?.setParam(key, value);
    else if (synthId === "sparkle") this.sparkle?.setParam(key, value);
    else if (synthId === "strings6") this.strings6?.setParam(key, value);
    else if (synthId === "sample") this.sampleBed?.setParam(key, value);

    if (key === "delaySend" || key === "reverbSend" || key === "shimmerSend") this.applyInstrumentSends();
  }

  async init() {
    if (this.ctx) return;

    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.buildFxGraph();

    this.drone = new DronePolySynth(this.ctx, this.instrumentIn.drone, this.synthModels.drone.params);
    this.sparkle = new VA7VoiceSynth(this.ctx, this.instrumentIn.sparkle, this.synthModels.sparkle.params, 2);
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
    this.shimmerInput = this.ctx.createGain();

    this.instrumentIn = {
      drone: this.ctx.createGain(),
      sparkle: this.ctx.createGain(),
      strings6: this.ctx.createGain(),
      sample: this.ctx.createGain(),
    };
    this.instrumentSend = {
      drone: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain(), shimmer: this.ctx.createGain() },
      sparkle: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain(), shimmer: this.ctx.createGain() },
      strings6: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain(), shimmer: this.ctx.createGain() },
      sample: { dry: this.ctx.createGain(), delay: this.ctx.createGain(), reverb: this.ctx.createGain(), shimmer: this.ctx.createGain() },
    };

    for (const key of Object.keys(this.instrumentIn)) {
      const input = this.instrumentIn[key];
      const send = this.instrumentSend[key];
      input.connect(send.dry);
      input.connect(send.delay);
      input.connect(send.reverb);
      input.connect(send.shimmer);
      send.dry.connect(this.dryInput);
      send.delay.connect(this.delayInput);
      send.reverb.connect(this.reverbInput);
      send.shimmer.connect(this.shimmerInput);
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

    this.reverbInputHp = this.ctx.createBiquadFilter();
    this.reverbInputHp.type = "highpass";
    this.reverbInputHp.frequency.value = 320;
    this.reverbInputDcBlock = this.ctx.createBiquadFilter();
    this.reverbInputDcBlock.type = "highpass";
    this.reverbInputDcBlock.frequency.value = 30;

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
    this.masterGain.gain.value = 0.0;

    this.masterHp = this.ctx.createBiquadFilter();
    this.masterHp.type = "highpass";
    this.masterHp.frequency.value = 22;

    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -8;
    this.masterLimiter.knee.value = 8;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.12;
    this.startupGain = this.ctx.createGain();
    this.startupGain.gain.value = 0.0;

    this.dryInput.connect(this.preTone);
    this.preTone.connect(this.preCut);
    this.preCut.connect(this.preLimiter);
    this.preLimiter.connect(this.dryGain);

    // Clean stereo ping-pong delay with filtered feedback + light modulation
    this.delayL = this.ctx.createDelay(2.0);
    this.delayR = this.ctx.createDelay(2.0);
    this.delayInputHp = this.ctx.createBiquadFilter();
    this.delayInputHp.type = "highpass";
    this.delayInputHp.frequency.value = 30;

    // Feedback paths (cross-feedback for ping-pong)
    this.delayFbL = this.ctx.createGain();
    this.delayFbR = this.ctx.createGain();

    // Filters inside the feedback loop (this is what removes mud)
    this.delayFbHpL = this.ctx.createBiquadFilter();
    this.delayFbHpR = this.ctx.createBiquadFilter();
    this.delayFbLpL = this.ctx.createBiquadFilter();
    this.delayFbLpR = this.ctx.createBiquadFilter();

    this.delayFbHpL.type = "highpass";
    this.delayFbHpR.type = "highpass";
    this.delayFbHpL.frequency.value = 220;
    this.delayFbHpR.frequency.value = 220;

    this.delayFbLpL.type = "lowpass";
    this.delayFbLpR.type = "lowpass";
    this.delayFbLpL.frequency.value = 6200;
    this.delayFbLpR.frequency.value = 6200;

    // Wet gains per side
    this.delayWetL = this.ctx.createGain();
    this.delayWetR = this.ctx.createGain();
    this.delayMerger = this.ctx.createChannelMerger(2);

    // Light modulation to keep repeats alive (tiny, not chorusy)
    this.delayMod = this.ctx.createOscillator();
    this.delayMod.type = "sine";
    this.delayMod.frequency.value = this.delayModRate;
    this.delayModGainL = this.ctx.createGain();
    this.delayModGainR = this.ctx.createGain();
    this.delayModGainL.gain.value = 0.0;
    this.delayModGainR.gain.value = 0.0;
    this.delayMod.connect(this.delayModGainL);
    this.delayMod.connect(this.delayModGainR);
    this.delayModGainL.connect(this.delayL.delayTime);
    this.delayModGainR.connect(this.delayR.delayTime);
    this.delayMod.start();

    // Set base times / feedback / wet
    this.delayL.delayTime.value = this.delayTimeSec;
    this.delayR.delayTime.value = this.delayTimeSec * 0.985;
    this.delayFbL.gain.value = this.delayFeedback;
    this.delayFbR.gain.value = this.delayFeedback;
    this.delayWetL.gain.value = this.delayMix;
    this.delayWetR.gain.value = this.delayMix;

    // Input to delay (mono input feeds both)
    this.delayInput.connect(this.delayInputHp);
    this.delayInputHp.connect(this.delayL);
    this.delayInputHp.connect(this.delayR);

    // Cross feedback: L -> filters -> fbL -> R, R -> filters -> fbR -> L
    this.delayL.connect(this.delayFbHpL);
    this.delayFbHpL.connect(this.delayFbLpL);
    this.delayFbLpL.connect(this.delayFbL);
    this.delayFbL.connect(this.delayR);

    this.delayR.connect(this.delayFbHpR);
    this.delayFbHpR.connect(this.delayFbLpR);
    this.delayFbLpR.connect(this.delayFbR);
    this.delayFbR.connect(this.delayL);

    // Wet taps
    this.delayL.connect(this.delayWetL);
    this.delayR.connect(this.delayWetR);

    this.delayWetL.connect(this.delayMerger, 0, 0);
    this.delayWetR.connect(this.delayMerger, 0, 1);

    // Wet delay feeds dry mix + a little into reverb input for cohesion
    this.delayMerger.connect(this.dryGain);
    this.delayMerger.connect(this.reverbInputDcBlock);

    this.reverbInput.connect(this.reverbInputDcBlock);
    this.reverbInputDcBlock.connect(this.reverbInputHp);
    this.reverbInputHp.connect(this.reverbComp);
    this.reverbComp.connect(this.reverb);
    this.reverb.connect(this.reverbLp);
    this.reverbLp.connect(this.reverbGain);

    // Shimmer bus (bright, airy wash; restrained to avoid mud)
    this.shimmerInputHp = this.ctx.createBiquadFilter();
    this.shimmerInputHp.type = "highpass";
    this.shimmerInputHp.frequency.value = 900;

    this.shimmer = this.ctx.createConvolver();
    // shorter / brighter IR than main reverb
    this.shimmer.buffer = createImpulseResponse(this.ctx, 1.8, 2.2);

    this.shimmerLp = this.ctx.createBiquadFilter();
    this.shimmerLp.type = "lowpass";
    this.shimmerLp.frequency.value = 7800;
    this.shimmerLp.Q.value = 0.7;

    // Light stereo chorus to create "shimmer" motion (not a true pitch-shift, but clean + airy)
    this.shimmerChorusL = this.ctx.createDelay(0.06);
    this.shimmerChorusR = this.ctx.createDelay(0.06);
    this.shimmerChorusL.delayTime.value = 0.018;
    this.shimmerChorusR.delayTime.value = 0.026;

    this.shimmerLfo = this.ctx.createOscillator();
    this.shimmerLfo.type = "sine";
    this.shimmerLfo.frequency.value = this.shimmerModRate;
    this.shimmerLfoGainL = this.ctx.createGain();
    this.shimmerLfoGainR = this.ctx.createGain();
    this.shimmerLfoGainL.gain.value = this.shimmerModDepth;
    this.shimmerLfoGainR.gain.value = this.shimmerModDepth * 1.14;
    this.shimmerLfo.connect(this.shimmerLfoGainL);
    this.shimmerLfo.connect(this.shimmerLfoGainR);
    this.shimmerLfoGainL.connect(this.shimmerChorusL.delayTime);
    this.shimmerLfoGainR.connect(this.shimmerChorusR.delayTime);
    this.shimmerLfo.start();

    this.shimmerGain = this.ctx.createGain();
    this.shimmerGain.gain.value = 0.0; // controlled by setShimmerMix

    this.shimmerMerger = this.ctx.createChannelMerger(2);

    this.shimmerInput.connect(this.shimmerInputHp);
    this.shimmerInputHp.connect(this.shimmer);
    this.shimmer.connect(this.shimmerLp);

    this.shimmerLp.connect(this.shimmerChorusL);
    this.shimmerLp.connect(this.shimmerChorusR);
    this.shimmerChorusL.connect(this.shimmerMerger, 0, 0);
    this.shimmerChorusR.connect(this.shimmerMerger, 0, 1);

    this.shimmerMerger.connect(this.shimmerGain);

    this.dryGain.connect(this.masterGain);
    this.reverbGain.connect(this.masterGain);
    this.shimmerGain.connect(this.masterGain);

    this.setReverbMix(this.reverbMix);
    this.setShimmerMix(this.shimmerMix);

    this.masterGain.connect(this.masterHp);
    this.masterHp.connect(this.masterLimiter);
    this.masterLimiter.connect(this.startupGain);
    this.startupGain.connect(this.ctx.destination);
  }

  resolveSendTargets(params) {
    const delay = this.debugBypassDelayReverbSends ? 0 : clamp(params.delaySend ?? 0, 0, 1);
    const reverb = this.debugBypassDelayReverbSends ? 0 : clamp(params.reverbSend ?? 0, 0, 1);
    const shimmer = clamp(params.shimmerSend ?? 0, 0, 1);
    return { delay, reverb, shimmer };
  }

  applyInstrumentSends(atTime = null, timeConstant = 0.02) {
    if (!this.instrumentSend) return;

    const map = {
      drone: this.synthModels.drone.params,
      sparkle: this.synthModels.sparkle.params,
      strings6: this.synthModels.strings6.params,
      sample: this.synthModels.sample.params,
    };
    const now = atTime ?? (this.ctx ? this.ctx.currentTime : 0);

    for (const key of Object.keys(map)) {
      const params = map[key];
      const sends = this.instrumentSend[key];
      const targets = this.resolveSendTargets(params);
      sends.delay.gain.setTargetAtTime(targets.delay, now, timeConstant);
      sends.reverb.gain.setTargetAtTime(targets.reverb, now, timeConstant);
      sends.shimmer.gain.setTargetAtTime(targets.shimmer, now, timeConstant);
      sends.dry.gain.setTargetAtTime(1.0, now, timeConstant);
    }
  }

  applyStartupFxRamps(now) {
    if (!this.instrumentSend) return;

    const map = {
      drone: this.synthModels.drone.params,
      sparkle: this.synthModels.sparkle.params,
      strings6: this.synthModels.strings6.params,
      sample: this.synthModels.sample.params,
    };

    const sendRampStart = now + this.fxSendRampDelaySec;
    const sendRampEnd = sendRampStart + this.fxSendRampSec;
    const feedbackRampStart = now + 0.02;
    const feedbackRampEnd = feedbackRampStart + this.fxFeedbackRampSec;

    for (const key of Object.keys(map)) {
      const params = map[key];
      const sends = this.instrumentSend[key];
      const targets = this.resolveSendTargets(params);

      holdAtTime(sends.delay.gain, now);
      sends.delay.gain.setValueAtTime(0.0, now);
      sends.delay.gain.setValueAtTime(0.0, sendRampStart);
      sends.delay.gain.linearRampToValueAtTime(targets.delay, sendRampEnd);

      holdAtTime(sends.reverb.gain, now);
      sends.reverb.gain.setValueAtTime(0.0, now);
      sends.reverb.gain.setValueAtTime(0.0, sendRampStart);
      sends.reverb.gain.linearRampToValueAtTime(targets.reverb, sendRampEnd);

      sends.shimmer.gain.setTargetAtTime(targets.shimmer, now, 0.02);
      sends.dry.gain.setTargetAtTime(1.0, now, 0.02);
    }

    // Ramp delay modulation depth in gently after startup to avoid delay-time jump clicks
    if (this.delayModGainL && this.delayModGainR) {
      holdAtTime(this.delayModGainL.gain, now);
      holdAtTime(this.delayModGainR.gain, now);
      this.delayModGainL.gain.setValueAtTime(0.0, now);
      this.delayModGainR.gain.setValueAtTime(0.0, now);
      this.delayModGainL.gain.setValueAtTime(0.0, sendRampStart);
      this.delayModGainR.gain.setValueAtTime(0.0, sendRampStart);
      this.delayModGainL.gain.linearRampToValueAtTime(this.delayModDepth, sendRampEnd);
      this.delayModGainR.gain.linearRampToValueAtTime(this.delayModDepth * 1.08, sendRampEnd);
    }



    if (this.delayFbL && this.delayFbR) {
      holdAtTime(this.delayFbL.gain, now);
      holdAtTime(this.delayFbR.gain, now);
      this.delayFbL.gain.setValueAtTime(0.0, now);
      this.delayFbR.gain.setValueAtTime(0.0, now);
      this.delayFbL.gain.setValueAtTime(0.0, feedbackRampStart);
      this.delayFbR.gain.setValueAtTime(0.0, feedbackRampStart);
      this.delayFbL.gain.linearRampToValueAtTime(this.delayFeedback, feedbackRampEnd);
      this.delayFbR.gain.linearRampToValueAtTime(this.delayFeedback, feedbackRampEnd);
    }

    if (this.reverbGain) {
      holdAtTime(this.reverbGain.gain, now);
      this.reverbGain.gain.setValueAtTime(0.0, now);
      this.reverbGain.gain.setValueAtTime(0.0, sendRampStart);
      this.reverbGain.gain.linearRampToValueAtTime(this.reverbMix, sendRampEnd);
    }

    if (this.delayWetL && this.delayWetR) {
      holdAtTime(this.delayWetL.gain, now);
      holdAtTime(this.delayWetR.gain, now);
      this.delayWetL.gain.setValueAtTime(0.0, now);
      this.delayWetR.gain.setValueAtTime(0.0, now);
      this.delayWetL.gain.setValueAtTime(0.0, sendRampStart);
      this.delayWetR.gain.setValueAtTime(0.0, sendRampStart);
      this.delayWetL.gain.linearRampToValueAtTime(this.delayMix, sendRampEnd);
      this.delayWetR.gain.linearRampToValueAtTime(this.delayMix, sendRampEnd);
    }
  }

  setBpm(bpm) {
    this.bpm = bpm;
    this.cycleDurationSec = this.computeCycleDuration();
  }

  setReverbMix(value) {
    this.reverbMix = value;
    if (this.dryGain && this.reverbGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.dryGain.gain.setTargetAtTime(1 - value, now, 0.02);
      this.reverbGain.gain.setTargetAtTime(value, now, 0.02);
    }
  }

  setDelayMix(value) {
    this.delayMix = value;
    if (this.delayWetL && this.delayWetR && this.ctx) {
      const now = this.ctx.currentTime;
      this.delayWetL.gain.setTargetAtTime(value, now, 0.02);
      this.delayWetR.gain.setTargetAtTime(value, now, 0.02);
    }
  }

  setDelayModRate(value) {
    this.delayModRate = value;
    if (this.delayMod && this.ctx) {
      this.delayMod.frequency.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    }
  }

  setDelayModDepth(value) {
    this.delayModDepth = value;
    if (this.delayModGainL && this.delayModGainR && this.ctx) {
      const now = this.ctx.currentTime;
      this.delayModGainL.gain.setTargetAtTime(value, now, 0.05);
      this.delayModGainR.gain.setTargetAtTime(value * 1.08, now, 0.05);
    }
  }

  setShimmerMix(value) {
    this.shimmerMix = value;
    if (this.shimmerGain && this.ctx) {
      this.shimmerGain.gain.setTargetAtTime(clamp(value, 0, 1), this.ctx.currentTime, 0.02);
    }
  }

  setDebugBypassDelayReverbSends(enabled) {
    this.debugBypassDelayReverbSends = !!enabled;
    this.applyInstrumentSends();
  }

  setShimmerModRate(value) {
    this.shimmerModRate = value;
    if (this.shimmerLfo && this.ctx) {
      this.shimmerLfo.frequency.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    }
  }

  setShimmerModDepth(value) {
    this.shimmerModDepth = value;
    if (this.shimmerLfoGainL && this.shimmerLfoGainR && this.ctx) {
      const now = this.ctx.currentTime;
      this.shimmerLfoGainL.gain.setTargetAtTime(value, now, 0.05);
      this.shimmerLfoGainR.gain.setTargetAtTime(value * 1.14, now, 0.05);
    }
  }

  setMaster(value) {
    this.masterLevel = value;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);
    }
  }

  noteOn(voiceId, freq, time) {
    if (!Number.isFinite(freq)) return;

    switch (voiceId) {
      case 0:
        this.drone?.noteOn(0, freq, time, true);
        break;
      case 1:
        this.sparkle?.trigger(freq, time, 0);
        break;
      case 2:
        this.drone?.noteOn(1, freq, time, true);
        break;
      case 3:
        this.sparkle?.trigger(freq, time, 1);
        break;
      case 4:
        this.drone?.noteOn(2, freq, time, true);
        break;
      case 5:
        this.strings6?.noteOn(freq, time, true);
        break;
      default:
        break;
    }
  }

  noteOff(voiceId, time) {
    switch (voiceId) {
      case 0:
        this.drone?.noteOff(0, time);
        break;
      case 1:
        this.sparkle?.release(0, time);
        break;
      case 2:
        this.drone?.noteOff(1, time);
        break;
      case 3:
        this.sparkle?.release(1, time);
        break;
      case 4:
        this.drone?.noteOff(2, time);
        break;
      case 5:
        this.strings6?.noteOff(time);
        break;
      default:
        break;
    }
  }

  async start() {
    await this.init();

    if (this.ctx.state !== "running") await this.ctx.resume();
    const now = this.ctx.currentTime;
    const startupFadeSec = Math.max(0.02, this.startupGainRampSec);

    holdAtTime(this.masterGain.gain, now);
    this.masterGain.gain.setTargetAtTime(this.masterLevel, now, 0.03);

    if (this.startupGain) {
      holdAtTime(this.startupGain.gain, now);
      this.startupGain.gain.setValueAtTime(0.0, now);
      this.startupGain.gain.linearRampToValueAtTime(1.0, now + startupFadeSec);
    }

    this.applyStartupFxRamps(now);

    this.seq.init(this.startCycleOffset);
    this.running = true;
    this.cycleDurationSec = this.computeCycleDuration();
    this.nextCycleTime = now + this.startScheduleDelaySec;
    this.sampleBed?.start(now + this.sampleStartDelaySec);

    if (this.schedulerTimer) clearInterval(this.schedulerTimer);

    this.schedulerTimer = setInterval(() => this.scheduler(), this.schedulerIntervalMs);
  }
  stop() {
    // HARD STOP: immediately silences *everything* (including delay / reverb tails)
    // by closing the AudioContext. Start() will rebuild a fresh graph.
    this.running = false;

    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    try { this.drone?.allNotesOff(now); } catch (err) {}
    try { this.sparkle?.allNotesOff(now); } catch (err) {}
    try { this.strings6?.noteOff(now); } catch (err) {}
    try { this.sampleBed?.stop(now); } catch (err) {}

    const ctxToClose = this.ctx;
    this.ctx = null;

    this.drone = null;
    this.sparkle = null;
    this.strings6 = null;
    this.sampleBed = null;
    this.instrumentIn = null;
    this.instrumentSend = null;

    try {
      ctxToClose.close();
    } catch (err) {
      // ignore
    }
  }

  scheduler() {
    if (!this.running || !this.ctx) return;

    const horizon = this.ctx.currentTime + this.lookAheadSec;

    while (this.nextCycleTime < horizon) {
      this.scheduleCycle(this.nextCycleTime);
      this.nextCycleTime += this.cycleDurationSec;
    }
  }

  scheduleCycle(cycleStartTime) {
    this.seq.tick();

    const voiceOffsets = [0, this.followerTriggerPoints[0], 0, this.followerTriggerPoints[1], 0, this.followerTriggerPoints[2]];

    for (let voiceId = 0; voiceId < this.seq.voices.length; voiceId += 1) {
      const seqVoice = this.seq.voices[voiceId];
      const eventTime = cycleStartTime + voiceOffsets[voiceId] * this.cycleDurationSec;

      if (seqVoice.justOn) {
        this.noteOn(voiceId, seqVoice.freq, eventTime);
      }

      if (seqVoice.justOff) {
        this.noteOff(voiceId, eventTime);
      }
    }

    if (typeof this.onCycle === "function") this.onCycle(this.seq);
  }
}

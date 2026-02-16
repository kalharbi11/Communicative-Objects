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

class SparklePluckEngine {
  constructor(ctx, outBus, initialParams) {
    this.ctx = ctx;
    this.params = {
      brightness: 0.52,
      brightnessLfoRate: 0.07,
      brightnessLfoDepth: 0.14,
      structure: 0.56,
      damping: 0.68,
      accent: 1.0,
      attack: 0.0015,
      hold: 0.01,
      release: 0.09,
      spread: 0.3,
      bodyQ: 5.0,
      gain: 0.32,
      fxMix: 0.12,
      fxTime: 0.12,
      fxFeedback: 0.22,
      fxHighpass: 1400,
      fxLowpass: 7800,
      fxModRate: 0.16,
      fxModDepth: 0.004,
      ...initialParams,
    };

    this.voiceBus = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.fxSend = ctx.createGain();
    this.fxDelay = ctx.createDelay(1.5);
    this.fxHighpass = ctx.createBiquadFilter();
    this.fxLowpass = ctx.createBiquadFilter();
    this.fxTilt = ctx.createBiquadFilter();
    this.fxFeedback = ctx.createGain();
    this.fxReturn = ctx.createGain();
    this.fxLfo = ctx.createOscillator();
    this.fxLfoGain = ctx.createGain();

    this.output = ctx.createGain();
    this.output.gain.value = this.params.gain;
    this.output.connect(outBus);

    this.fxHighpass.type = "highpass";
    this.fxLowpass.type = "lowpass";
    this.fxTilt.type = "highshelf";
    this.fxTilt.frequency.value = 2400;
    this.fxTilt.gain.value = 5.0;

    this.voiceBus.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this.voiceBus.connect(this.fxSend);
    this.fxSend.connect(this.fxDelay);
    this.fxDelay.connect(this.fxHighpass);
    this.fxHighpass.connect(this.fxLowpass);
    this.fxLowpass.connect(this.fxTilt);
    this.fxTilt.connect(this.fxReturn);
    this.fxReturn.connect(this.output);
    this.fxTilt.connect(this.fxFeedback);
    this.fxFeedback.connect(this.fxDelay);

    this.fxLfo.type = "triangle";
    this.fxLfo.connect(this.fxLfoGain);
    this.fxLfoGain.connect(this.fxDelay.delayTime);
    this.fxLfo.start();

    this.noiseBuffer = createNoiseBuffer(ctx, 0.02);
    this.active = [null, null];
    this.applyFx(this.ctx.currentTime);
  }

  applyFx(time) {
    const p = this.params;
    this.output.gain.setTargetAtTime(p.gain, time, 0.02);
    this.dryGain.gain.setTargetAtTime(1.0 - clamp(p.fxMix, 0, 1), time, 0.03);
    this.fxSend.gain.setTargetAtTime(clamp(p.fxMix, 0, 1), time, 0.03);
    this.fxDelay.delayTime.setTargetAtTime(clamp(p.fxTime, 0.03, 1.2), time, 0.05);
    this.fxFeedback.gain.setTargetAtTime(clamp(p.fxFeedback, 0, 0.95), time, 0.04);
    this.fxHighpass.frequency.setTargetAtTime(clamp(p.fxHighpass, 100, 6000), time, 0.03);
    this.fxLowpass.frequency.setTargetAtTime(clamp(p.fxLowpass, 800, 14000), time, 0.03);
    this.fxLfo.frequency.setTargetAtTime(clamp(p.fxModRate, 0.01, 3.0), time, 0.05);
    this.fxLfoGain.gain.setTargetAtTime(clamp(p.fxModDepth, 0, 0.04), time, 0.05);
  }

  setParam(key, value) {
    this.params[key] = value;
    this.applyFx(this.ctx.currentTime);
  }

  trigger(freq, time, variant = 0) {
    const p = this.params;
    const lfo = Math.sin(time * p.brightnessLfoRate * Math.PI * 2);
    const brightness = clamp(p.brightness + lfo * p.brightnessLfoDepth, 0.1, 0.8);
    const attack = Math.max(0.0005, p.attack);
    const hold = Math.max(0.001, p.hold);
    const ring = Math.max(0.02, p.release);

    // Choke previous pluck on this lane to keep a crisp triggered feel.
    const previous = this.active[variant];
    if (previous) {
      holdAtTime(previous.masterGain.gain, time);
      previous.masterGain.gain.exponentialRampToValueAtTime(EPS, time + 0.01);
      previous.masterGain.gain.setValueAtTime(0.0, time + 0.012);
    }

    const modeMix = this.ctx.createGain();
    const toneLp = this.ctx.createBiquadFilter();
    const toneHp = this.ctx.createBiquadFilter();
    const body = this.ctx.createBiquadFilter();
    const pan = this.ctx.createStereoPanner();
    const masterGain = this.ctx.createGain();

    toneLp.type = "lowpass";
    toneLp.frequency.value = 1300 + brightness * 9000;
    toneLp.Q.value = 0.6 + p.structure * 1.2;

    toneHp.type = "highpass";
    toneHp.frequency.value = 60 + (1.0 - brightness) * 120;

    body.type = "peaking";
    body.frequency.value = clamp(freq * (1.0 + p.structure * 0.12), 120, 5500);
    body.Q.value = clamp(p.bodyQ, 0.5, 8.0);
    body.gain.value = 3.0 + p.structure * 7.0;

    pan.pan.value = clamp((variant === 0 ? -1 : 1) * p.spread, -1, 1);

    modeMix.connect(body);
    body.connect(toneLp);
    toneLp.connect(toneHp);
    toneHp.connect(masterGain);
    masterGain.connect(pan);
    pan.connect(this.voiceBus);

    const modeRatios = [
      1.0,
      2.01 + p.structure * 0.08,
      3.18 + p.structure * 0.22,
      4.25 + p.structure * 0.45,
      5.36 + p.structure * 0.8,
    ];
    const modeWeights = [
      1.00,
      0.58 + brightness * 0.18,
      0.34 + p.structure * 0.28,
      0.22 + p.structure * 0.34,
      0.14 + p.structure * 0.30,
    ];
    const weightNorm = modeWeights.reduce((sum, w) => sum + w, 0.0);
    const dampScale = 1.15 - clamp(p.damping, 0, 1) * 0.85;

    const modeOscs = [];
    const modeGains = [];
    let noteEnd = time;

    for (let i = 0; i < modeRatios.length; i += 1) {
      const osc = this.ctx.createOscillator();
      const mg = this.ctx.createGain();

      const ratio = modeRatios[i];
      const modeFreq = clamp(freq * ratio, 60, 12000);
      const modeAmp = (modeWeights[i] / weightNorm) * (0.95 + brightness * 0.85) * p.accent;
      const modeDecay = Math.max(0.02, ring * dampScale * (1.18 - i * 0.16));
      const modeEnd = time + attack + hold + modeDecay;
      noteEnd = Math.max(noteEnd, modeEnd);

      osc.type = "sine";
      osc.frequency.setValueAtTime(modeFreq, time);

      mg.gain.setValueAtTime(EPS, time);
      mg.gain.linearRampToValueAtTime(Math.max(EPS, modeAmp), time + attack);
      mg.gain.setValueAtTime(Math.max(EPS, modeAmp), time + attack + hold);
      mg.gain.exponentialRampToValueAtTime(EPS, modeEnd);

      osc.connect(mg);
      mg.connect(modeMix);

      osc.start(time);
      osc.stop(modeEnd + 0.02);

      modeOscs.push(osc);
      modeGains.push(mg);
    }

    // Fast exciter burst for the initial strike transient.
    const noise = this.ctx.createBufferSource();
    const burstGain = this.ctx.createGain();
    const burstHp = this.ctx.createBiquadFilter();
    const burstLp = this.ctx.createBiquadFilter();

    noise.buffer = this.noiseBuffer;
    burstHp.type = "highpass";
    burstHp.frequency.value = 150 + (1.0 - brightness) * 1100;
    burstLp.type = "lowpass";
    burstLp.frequency.value = 1200 + brightness * 10000;

    const burstAmp = 0.08 + p.accent * 0.16;
    burstGain.gain.setValueAtTime(EPS, time);
    burstGain.gain.linearRampToValueAtTime(burstAmp, time + attack);
    burstGain.gain.exponentialRampToValueAtTime(EPS, time + attack + hold + 0.012);

    noise.connect(burstGain);
    burstGain.connect(burstHp);
    burstHp.connect(burstLp);
    burstLp.connect(modeMix);
    noise.start(time);
    noise.stop(time + attack + hold + 0.03);

    masterGain.gain.setValueAtTime(1.0, time);
    masterGain.gain.setValueAtTime(1.0, noteEnd + 0.01);
    masterGain.gain.exponentialRampToValueAtTime(EPS, noteEnd + 0.07);
    masterGain.gain.setValueAtTime(0.0, noteEnd + 0.09);

    const activeVoice = { masterGain };
    this.active[variant] = activeVoice;

    const cleanupDelaySec = Math.max(0.0, noteEnd - this.ctx.currentTime) + 0.35;
    const cleanupMs = Math.ceil(cleanupDelaySec * 1000);
    setTimeout(() => {
      noise.disconnect();
      burstGain.disconnect();
      burstHp.disconnect();
      burstLp.disconnect();
      for (const osc of modeOscs) {
        osc.disconnect();
      }
      for (const mg of modeGains) {
        mg.disconnect();
      }
      modeMix.disconnect();
      body.disconnect();
      toneLp.disconnect();
      toneHp.disconnect();
      masterGain.disconnect();
      pan.disconnect();

      if (this.active[variant] === activeVoice) {
        this.active[variant] = null;
      }
    }, cleanupMs);
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

  noteOn(freq, time, retrigger = true) {
    for (const voice of this.oscs) {
      this.setFreq(voice, freq, time);
    }

    if (retrigger || !this.gate) {
      const lfo = Math.sin(time * this.params.decayLfoRate * Math.PI * 2);
      const decayNorm = (lfo + 1) * 0.5;
      const decay = this.params.minDecay + decayNorm * (this.params.maxDecay - this.params.minDecay);

      holdAtTime(this.amp.gain, time);
      this.amp.gain.linearRampToValueAtTime(1.0, time + Math.max(0.02, this.params.attack));
      this.amp.gain.linearRampToValueAtTime(
        clamp(this.params.sustain, EPS, 1.0),
        time + Math.max(0.02, this.params.attack) + Math.max(0.02, decay),
      );
    }

    this.gate = true;
  }

  noteOff(time) {
    envOff(this.amp.gain, this.params, time);
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
        label: "Sparkle Pluck (V2 + V4)",
        params: {
          brightness: 0.52,
          brightnessLfoRate: 0.07,
          brightnessLfoDepth: 0.14,
          structure: 0.56,
          damping: 0.68,
          accent: 1.0,
          attack: 0.0015,
          hold: 0.01,
          release: 0.09,
          spread: 0.3,
          bodyQ: 5.0,
          fxMix: 0.12,
          fxTime: 0.12,
          fxFeedback: 0.22,
          fxHighpass: 1400,
          fxLowpass: 7800,
          fxModRate: 0.16,
          fxModDepth: 0.004,
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
          { key: "brightness", label: "Brightness", min: 0.1, max: 0.9, step: 0.01, value: this.synthModels.sparkle.params.brightness },
          { key: "brightnessLfoRate", label: "Bright LFO Hz", min: 0.01, max: 0.4, step: 0.001, value: this.synthModels.sparkle.params.brightnessLfoRate },
          { key: "brightnessLfoDepth", label: "Bright LFO depth", min: 0, max: 0.5, step: 0.01, value: this.synthModels.sparkle.params.brightnessLfoDepth },
          { key: "structure", label: "Structure", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.structure },
          { key: "damping", label: "Damping", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.damping },
          { key: "accent", label: "Accent", min: 0.1, max: 1.5, step: 0.01, value: this.synthModels.sparkle.params.accent },
          { key: "attack", label: "Attack", min: 0.0005, max: 0.02, step: 0.0005, value: this.synthModels.sparkle.params.attack },
          { key: "hold", label: "Hold", min: 0.001, max: 0.1, step: 0.001, value: this.synthModels.sparkle.params.hold },
          { key: "release", label: "Ring time", min: 0.02, max: 1.5, step: 0.001, value: this.synthModels.sparkle.params.release },
          { key: "bodyQ", label: "Body Q", min: 0.5, max: 8, step: 0.1, value: this.synthModels.sparkle.params.bodyQ },
          { key: "spread", label: "Stereo spread", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.spread },
          { key: "fxMix", label: "Sparkle FX mix", min: 0, max: 1, step: 0.01, value: this.synthModels.sparkle.params.fxMix },
          { key: "fxTime", label: "Sparkle FX time", min: 0.03, max: 1.2, step: 0.001, value: this.synthModels.sparkle.params.fxTime },
          { key: "fxFeedback", label: "Sparkle FX feedback", min: 0, max: 0.95, step: 0.01, value: this.synthModels.sparkle.params.fxFeedback },
          { key: "fxHighpass", label: "Sparkle FX HP Hz", min: 100, max: 6000, step: 1, value: this.synthModels.sparkle.params.fxHighpass },
          { key: "fxLowpass", label: "Sparkle FX LP Hz", min: 800, max: 14000, step: 1, value: this.synthModels.sparkle.params.fxLowpass },
          { key: "fxModRate", label: "Sparkle FX mod Hz", min: 0.01, max: 3, step: 0.01, value: this.synthModels.sparkle.params.fxModRate },
          { key: "fxModDepth", label: "Sparkle FX mod depth", min: 0, max: 0.04, step: 0.0005, value: this.synthModels.sparkle.params.fxModDepth },
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
    this.sparkle = new SparklePluckEngine(this.ctx, this.instrumentIn.sparkle, this.synthModels.sparkle.params);
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
        if (this.strings6.gate) {
          this.strings6.noteOff(triggerTime);
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

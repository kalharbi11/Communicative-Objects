// Industrial Noise Audio Engine - Author & Punisher inspired
// All synthesis done with Web Audio API

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterFilter: BiquadFilterNode | null = null;
let masterDistortion: WaveShaperNode | null = null;
let convolver: ConvolverNode | null = null;
let compressor: DynamicsCompressorNode | null = null;

// Active voice tracking
const activeVoices: Map<string, { stop: () => void }> = new Map();

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 44100 });
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
}

function makeDistortionCurve(amount: number): Float32Array {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Aggressive hard-clip distortion curve for scream
function makeHardClipCurve(drive: number): Float32Array {
  const samples = 44100;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    // Tanh saturation with high drive
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

function createReverbBuffer(audioCtx: AudioContext, duration: number, decay: number): AudioBuffer {
  const length = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function createNoiseBuffer(audioCtx: AudioContext, type: 'white' | 'pink' | 'brown'): AudioBuffer {
  const length = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  if (type === 'white') {
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  } else if (type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else { // brown
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }
  }
  return buffer;
}

// Pre-generate noise buffers for performance
let whiteNoiseBuffer: AudioBuffer | null = null;
let brownNoiseBuffer: AudioBuffer | null = null;
let pinkNoiseBuffer: AudioBuffer | null = null;

// Cathedral-style reverb for scream
let screamReverb: ConvolverNode | null = null;

export function initAudio() {
  const audioCtx = getCtx();

  // Pre-generate noise buffers
  whiteNoiseBuffer = createNoiseBuffer(audioCtx, 'white');
  brownNoiseBuffer = createNoiseBuffer(audioCtx, 'brown');
  pinkNoiseBuffer = createNoiseBuffer(audioCtx, 'pink');

  // Master compressor
  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;

  // Master distortion
  masterDistortion = audioCtx.createWaveShaper();
  masterDistortion.curve = makeDistortionCurve(20);
  masterDistortion.oversample = '4x';

  // Master filter
  masterFilter = audioCtx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = 8000;
  masterFilter.Q.value = 2;

  // Reverb - large space
  convolver = audioCtx.createConvolver();
  convolver.buffer = createReverbBuffer(audioCtx, 4, 2.0);

  // Scream reverb - cathedral-like (longer, brighter)
  screamReverb = audioCtx.createConvolver();
  screamReverb.buffer = createReverbBuffer(audioCtx, 5, 1.5);

  // Master gain
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;

  // Dry path
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.7;

  // Wet path
  const wetGain = audioCtx.createGain();
  wetGain.gain.value = 0.35;

  // Routing
  masterFilter.connect(masterDistortion);
  masterDistortion.connect(compressor);
  compressor.connect(dryGain);
  compressor.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  masterGain.connect(audioCtx.destination);

  return audioCtx;
}

function connectToMaster(node: AudioNode) {
  if (masterFilter) {
    node.connect(masterFilter);
  }
}

// ==========================================
// SCREAM SYNTH v3 - Hybrid voiced/noise source
// 
// Why the old version sounded like wind:
// Pure white noise through bandpass = filtered wind.
// Real screams have PITCH from vocal fold vibration,
// combined with turbulent noise from extreme airflow.
//
// Architecture:
// 1. SOURCE: Sawtooth oscillator (vocal folds) + white noise (turbulence)
//    mixed together. Sawtooth gives pitch & harmonics, noise gives breath.
// 2. FORMANT BANK: 5 parallel resonant bandpass filters at real vocal
//    formant frequencies (F1-F5). F1/F2 sweep upward to simulate
//    the scream intensifying. High Q = resonant, vocal quality.
// 3. SUBHARMONICS: Oscillator one octave below adds false-fold growl.
// 4. DISTORTION: 3-stage cascade (pre-boost → asymmetric clip → 
//    tanh saturation → hard waveshaper). This is what makes it SCREAM.
// 5. POST EQ: Tame fizzy highs, boost 2-4kHz "presence/scream" range.
// 6. ADSR ENVELOPE: Clean attack/decay/sustain/release with no wobble.
//    Longer attack for slow swell, long release for fade-out tail.
// ==========================================

// Formant frequencies based on vocal acoustics research:
// "AH" vowel (screaming): F1≈800, F2≈1200, F3≈2800, F4≈3500, F5≈4950
// Lower = more guttural/growl, higher = more shriek
const SCREAM_VOICES = [
  {
    // Voice I: Deep death-metal growl
    pitch: 65,
    noiseMix: 0.35,
    formants: [
      { freq: 550, freqEnd: 700, Q: 16, gain: 1.0 },
      { freq: 900, freqEnd: 1150, Q: 14, gain: 0.8 },
      { freq: 2400, freqEnd: 2600, Q: 10, gain: 0.4 },
      { freq: 3200, freqEnd: 3400, Q: 8, gain: 0.25 },
      { freq: 4500, freqEnd: 4500, Q: 6, gain: 0.1 },
    ],
    subGain: 0.25,
    distDrive: 60,
    postLpFreq: 4500,
    // ADSR envelope
    attack: 0.4,    // Slow swell in
    decay: 0.3,
    sustain: 0.25,
    release: 1.2,   // Long fade out
    label: 'GROWL',
  },
  {
    // Voice II: Aggressive mid growl/bark
    pitch: 90,
    noiseMix: 0.4,
    formants: [
      { freq: 650, freqEnd: 850, Q: 15, gain: 1.0 },
      { freq: 1050, freqEnd: 1350, Q: 13, gain: 0.85 },
      { freq: 2600, freqEnd: 2900, Q: 10, gain: 0.45 },
      { freq: 3400, freqEnd: 3600, Q: 8, gain: 0.3 },
      { freq: 4800, freqEnd: 4800, Q: 6, gain: 0.12 },
    ],
    subGain: 0.18,
    distDrive: 75,
    postLpFreq: 5500,
    attack: 0.35,
    decay: 0.25,
    sustain: 0.26,
    release: 1.0,
    label: 'GUT',
  },
  {
    // Voice III: Harsh aggressive scream
    pitch: 120,
    noiseMix: 0.45,
    formants: [
      { freq: 750, freqEnd: 1000, Q: 14, gain: 1.0 },
      { freq: 1150, freqEnd: 1500, Q: 12, gain: 0.9 },
      { freq: 2700, freqEnd: 3100, Q: 10, gain: 0.5 },
      { freq: 3500, freqEnd: 3800, Q: 8, gain: 0.35 },
      { freq: 4900, freqEnd: 5000, Q: 6, gain: 0.15 },
    ],
    subGain: 0.12,
    distDrive: 90,
    postLpFreq: 6000,
    attack: 0.3,
    decay: 0.2,
    sustain: 0.27,
    release: 0.8,
    label: 'BARK',
  },
  {
    // Voice IV: High intense scream (still dark, not shrill)
    pitch: 155,
    noiseMix: 0.5,
    formants: [
      { freq: 850, freqEnd: 1100, Q: 13, gain: 1.0 },
      { freq: 1250, freqEnd: 1650, Q: 11, gain: 0.9 },
      { freq: 2800, freqEnd: 3200, Q: 9, gain: 0.55 },
      { freq: 3600, freqEnd: 4000, Q: 7, gain: 0.35 },
      { freq: 4950, freqEnd: 5100, Q: 5, gain: 0.15 },
    ],
    subGain: 0.08,
    distDrive: 110,
    postLpFreq: 6500,
    attack: 0.25,
    decay: 0.2,
    sustain: 0.28,
    release: 0.7,
    label: 'SCREAM',
  },
];

// Asymmetric soft-clip curve (more natural vocal-fold-like distortion)
// Positive side clips softer, negative side clips harder.
// This asymmetry generates even harmonics like a real voice.
function makeAsymClipCurve(drive: number): Float32Array {
  const n = 8192;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    if (x >= 0) {
      curve[i] = Math.tanh(x * drive * 0.8);
    } else {
      curve[i] = Math.tanh(x * drive * 1.2);
    }
  }
  return curve;
}

export function startScreamVoice(voiceIndex: number): string {
  const audioCtx = getCtx();
  const id = `scream-${voiceIndex}-${Date.now()}`;
  const voice = SCREAM_VOICES[voiceIndex];
  const now = audioCtx.currentTime;

  // ===================================================
  // SOURCE LAYER 1: Sawtooth oscillator (vocal folds)
  // Sawtooth is harmonically rich like real vocal fold vibration.
  // Multiple detuned copies for thickness (chorus effect).
  // ===================================================
  const oscMix = audioCtx.createGain();
  oscMix.gain.value = 1.0 - voice.noiseMix;

  const oscs: OscillatorNode[] = [];
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = voice.pitch * (1 + (i - 1) * 0.006);
    const g = audioCtx.createGain();
    g.gain.value = 0.33;
    osc.connect(g);
    g.connect(oscMix);
    oscs.push(osc);
  }

  // ===================================================
  // SOURCE LAYER 2: White noise (turbulent breath)
  // ===================================================
  const noiseSrc = audioCtx.createBufferSource();
  noiseSrc.buffer = whiteNoiseBuffer;
  noiseSrc.loop = true;
  const noiseMixGain = audioCtx.createGain();
  noiseMixGain.gain.value = voice.noiseMix;
  noiseSrc.connect(noiseMixGain);

  // ===================================================
  // SOURCE LAYER 3: Subharmonic (false vocal fold growl)
  // One octave below fundamental
  // ===================================================
  const subOsc = audioCtx.createOscillator();
  subOsc.type = 'sawtooth';
  subOsc.frequency.value = voice.pitch * 0.5;
  const subMixGain = audioCtx.createGain();
  subMixGain.gain.value = voice.subGain;
  subOsc.connect(subMixGain);

  // ===================================================
  // MIX all sources before formant filtering
  // ===================================================
  const sourceMix = audioCtx.createGain();
  sourceMix.gain.value = 1.0;
  oscMix.connect(sourceMix);
  noiseMixGain.connect(sourceMix);
  subMixGain.connect(sourceMix);

  // ===================================================
  // FORMANT FILTER BANK (5 parallel resonant bandpass)
  // Each filter = one vocal tract resonance.
  // F1 & F2 sweep upward to simulate scream intensifying.
  // ===================================================
  const formantMix = audioCtx.createGain();
  formantMix.gain.value = 1.0;

  const formantFilters: BiquadFilterNode[] = [];

  voice.formants.forEach((f) => {
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = f.Q;
    bp.frequency.setValueAtTime(f.freq, now);
    bp.frequency.linearRampToValueAtTime(f.freqEnd, now + 0.6);
    bp.frequency.setTargetAtTime(f.freqEnd * 0.95, now + 0.8, 0.8);
    formantFilters.push(bp);

    const fGain = audioCtx.createGain();
    fGain.gain.value = f.gain * 0.4;

    sourceMix.connect(bp);
    bp.connect(fGain);
    fGain.connect(formantMix);
  });

  // ===================================================
  // FORMANT SWEEP tied to attack - formants open up as
  // the scream builds during the attack phase
  // ===================================================
  // (Already handled above via linearRampToValueAtTime on each formant,
  //  sweep duration matches roughly the attack time)

  // ===================================================
  // DISTORTION CASCADE - 3 stages
  // ===================================================

  // Pre-distortion boost at F2 frequency
  const preBoost = audioCtx.createBiquadFilter();
  preBoost.type = 'peaking';
  preBoost.frequency.value = voice.formants[1].freqEnd;
  preBoost.Q.value = 1.5;
  preBoost.gain.value = 18;

  // Stage 1: Asymmetric clip (even harmonics, vocal-like)
  const dist1 = audioCtx.createWaveShaper();
  dist1.curve = makeAsymClipCurve(voice.distDrive);
  dist1.oversample = '4x';

  // Inter-stage EQ - boost "scream presence" range
  const interEq = audioCtx.createBiquadFilter();
  interEq.type = 'peaking';
  interEq.frequency.value = 3000;
  interEq.Q.value = 1;
  interEq.gain.value = 8;

  // Stage 2: Hard tanh saturation
  const dist2 = audioCtx.createWaveShaper();
  dist2.curve = makeHardClipCurve(voice.distDrive * 0.8);
  dist2.oversample = '4x';

  // Stage 3: Final aggressive waveshaper
  const dist3 = audioCtx.createWaveShaper();
  dist3.curve = makeDistortionCurve(voice.distDrive * 1.2);
  dist3.oversample = '2x';

  // ===================================================
  // POST-DISTORTION EQ
  // ===================================================
  const hiPass = audioCtx.createBiquadFilter();
  hiPass.type = 'highpass';
  hiPass.frequency.value = 80;
  hiPass.Q.value = 0.7;

  const postLp = audioCtx.createBiquadFilter();
  postLp.type = 'lowpass';
  postLp.frequency.value = voice.postLpFreq;
  postLp.Q.value = 0.7;

  const presenceBoost = audioCtx.createBiquadFilter();
  presenceBoost.type = 'peaking';
  presenceBoost.frequency.value = 3000;
  presenceBoost.Q.value = 2;
  presenceBoost.gain.value = 5;

  // ===================================================
  // ADSR AMPLITUDE ENVELOPE
  // A = slow swell, D = slight dip, S = sustain level, R = long fade (on stop)
  // ===================================================
  const peakLevel = 0.30;
  const sustainLevel = peakLevel * voice.sustain / 0.3; // normalize
  const ampEnv = audioCtx.createGain();
  ampEnv.gain.setValueAtTime(0, now);
  // Attack: slow rise to peak
  ampEnv.gain.linearRampToValueAtTime(peakLevel, now + voice.attack);
  // Decay: settle to sustain level
  ampEnv.gain.linearRampToValueAtTime(sustainLevel, now + voice.attack + voice.decay);

  // ===================================================
  // REVERB SEND
  // ===================================================
  const reverbSend = audioCtx.createGain();
  reverbSend.gain.value = 0.2;

  // ===================================================
  // SIGNAL CHAIN
  // ===================================================
  formantMix.connect(preBoost);
  preBoost.connect(dist1);
  dist1.connect(interEq);
  interEq.connect(dist2);
  dist2.connect(dist3);
  dist3.connect(hiPass);
  hiPass.connect(postLp);
  postLp.connect(presenceBoost);
  presenceBoost.connect(ampEnv);

  connectToMaster(ampEnv);

  if (screamReverb && masterFilter) {
    ampEnv.connect(reverbSend);
    reverbSend.connect(screamReverb);
    screamReverb.connect(masterFilter);
  }

  // ===================================================
  // START
  // ===================================================
  oscs.forEach(o => o.start(now));
  noiseSrc.start(now);
  subOsc.start(now);

  const stop = () => {
    const t = audioCtx.currentTime;
    // Release: slow fade out using voice.release time
    ampEnv.gain.cancelScheduledValues(t);
    ampEnv.gain.setValueAtTime(ampEnv.gain.value, t);
    ampEnv.gain.linearRampToValueAtTime(0, t + voice.release);

    // Formants sweep back down during release
    formantFilters.forEach((bp, i) => {
      bp.frequency.cancelScheduledValues(t);
      bp.frequency.setValueAtTime(bp.frequency.value, t);
      bp.frequency.linearRampToValueAtTime(voice.formants[i].freq, t + voice.release);
    });

    setTimeout(() => {
      oscs.forEach(o => { try { o.stop(); } catch {} });
      try { noiseSrc.stop(); } catch {}
      try { subOsc.stop(); } catch {}
    }, voice.release * 1000 + 100);
    activeVoices.delete(id);
  };

  activeVoices.set(id, { stop });
  return id;
}

// ==========================================
// NOISE SYNTHS
// ==========================================

const NOISE_CONFIGS = [
  { type: 'white' as const, filterFreq: 1200, Q: 12, distAmount: 100, lpFreq: 3000, label: 'SCREECH' },
  { type: 'pink' as const, filterFreq: 250, Q: 8, distAmount: 60, lpFreq: 1500, label: 'RUMBLE' },
  { type: 'white' as const, filterFreq: 3000, Q: 18, distAmount: 200, lpFreq: 5000, label: 'SHRED' },
  { type: 'brown' as const, filterFreq: 100, Q: 4, distAmount: 40, lpFreq: 800, label: 'DRONE' },
];

export function startNoise(noiseIndex: number): string {
  const audioCtx = getCtx();
  const id = `noise-${noiseIndex}-${Date.now()}`;
  const config = NOISE_CONFIGS[noiseIndex];
  const now = audioCtx.currentTime;

  const bufferMap = { white: whiteNoiseBuffer, pink: pinkNoiseBuffer, brown: brownNoiseBuffer };
  const source = audioCtx.createBufferSource();
  source.buffer = bufferMap[config.type] || createNoiseBuffer(audioCtx, config.type);
  source.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = config.filterFreq;
  filter.Q.value = config.Q;

  const filterLfo = audioCtx.createOscillator();
  filterLfo.type = 'sine';
  filterLfo.frequency.value = 0.3 + Math.random() * 0.5;
  const filterLfoGain = audioCtx.createGain();
  filterLfoGain.gain.value = config.filterFreq * 0.4;
  filterLfo.connect(filterLfoGain);
  filterLfoGain.connect(filter.frequency);

  const dist = audioCtx.createWaveShaper();
  dist.curve = makeDistortionCurve(config.distAmount);
  dist.oversample = '4x';

  // Low-pass filter to tame highs and darken the sound
  const lpFilter = audioCtx.createBiquadFilter();
  lpFilter.type = 'lowpass';
  lpFilter.frequency.value = config.lpFreq;
  lpFilter.Q.value = 2;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.08);

  const postFilter = audioCtx.createBiquadFilter();
  postFilter.type = 'peaking';
  postFilter.frequency.value = config.filterFreq * 1.2;
  postFilter.Q.value = 2;
  postFilter.gain.value = 6;

  source.connect(filter);
  filter.connect(dist);
  dist.connect(lpFilter);
  lpFilter.connect(postFilter);
  postFilter.connect(gain);
  connectToMaster(gain);

  source.start(now);
  filterLfo.start(now);

  const stop = () => {
    const t = audioCtx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.15);
    setTimeout(() => {
      try { source.stop(); } catch {}
      try { filterLfo.stop(); } catch {}
    }, 200);
    activeVoices.delete(id);
  };

  activeVoices.set(id, { stop });
  return id;
}

// ==========================================
// AGGRESSIVE DRUMS - All overly dramatic & long
// Inspired by Author & Punisher: massive, 
// decaying, distorted, earth-shaking
// ==========================================

export function triggerDrum(drumIndex: number) {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  switch (drumIndex) {
    case 0: // SEISMIC KICK - earth-shattering sub drop with massive trail
      {
        // Main body - sine with deep pitch sweep
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(25, now + 1.5);
        osc.frequency.exponentialRampToValueAtTime(15, now + 3.0);

        // Sub layer - ultra deep
        const sub = audioCtx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(100, now);
        sub.frequency.exponentialRampToValueAtTime(18, now + 2.5);

        // Second sub harmonic
        const sub2 = audioCtx.createOscillator();
        sub2.type = 'triangle';
        sub2.frequency.setValueAtTime(50, now);
        sub2.frequency.exponentialRampToValueAtTime(12, now + 3.0);

        // Transient click - aggressive
        const click = audioCtx.createOscillator();
        click.type = 'square';
        click.frequency.setValueAtTime(3000, now);
        click.frequency.exponentialRampToValueAtTime(80, now + 0.03);
        const clickGain = audioCtx.createGain();
        clickGain.gain.setValueAtTime(0.5, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        // Body distortion
        const dist = audioCtx.createWaveShaper();
        dist.curve = makeDistortionCurve(80);
        dist.oversample = '4x';

        // Body gain - very long decay
        const bodyGain = audioCtx.createGain();
        bodyGain.gain.setValueAtTime(0.7, now);
        bodyGain.gain.setValueAtTime(0.65, now + 0.1);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 3.5);

        const subGain = audioCtx.createGain();
        subGain.gain.setValueAtTime(0.5, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

        const sub2Gain = audioCtx.createGain();
        sub2Gain.gain.setValueAtTime(0.3, now);
        sub2Gain.gain.exponentialRampToValueAtTime(0.001, now + 3.5);

        // Noise rumble tail
        const noiseSrc = audioCtx.createBufferSource();
        noiseSrc.buffer = brownNoiseBuffer;
        noiseSrc.playbackRate.setValueAtTime(0.8, now);
        noiseSrc.playbackRate.exponentialRampToValueAtTime(0.2, now + 2.0);
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.25, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(500, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(60, now + 2.0);
        const noiseDist = audioCtx.createWaveShaper();
        noiseDist.curve = makeDistortionCurve(60);

        osc.connect(dist);
        dist.connect(bodyGain);
        sub.connect(subGain);
        sub2.connect(sub2Gain);
        click.connect(clickGain);
        noiseSrc.connect(noiseFilter);
        noiseFilter.connect(noiseDist);
        noiseDist.connect(noiseGain);

        connectToMaster(bodyGain);
        connectToMaster(subGain);
        connectToMaster(sub2Gain);
        connectToMaster(clickGain);
        connectToMaster(noiseGain);

        osc.start(now); sub.start(now); sub2.start(now); click.start(now); noiseSrc.start(now);
        osc.stop(now + 3.5); sub.stop(now + 3.0); sub2.stop(now + 3.5);
        click.stop(now + 0.05); noiseSrc.stop(now + 2.5);
      }
      break;

    case 1: // INDUSTRIAL DETONATION - snare reimagined as an explosion of metal
      {
        // Pitched noise sweep down
        const noise = audioCtx.createBufferSource();
        noise.buffer = whiteNoiseBuffer;
        noise.playbackRate.setValueAtTime(2.0, now);
        noise.playbackRate.exponentialRampToValueAtTime(0.5, now + 1.5);

        // Heavy distortion chain
        const dist1 = audioCtx.createWaveShaper();
        dist1.curve = makeDistortionCurve(120);
        dist1.oversample = '4x';
        const dist2 = audioCtx.createWaveShaper();
        dist2.curve = makeHardClipCurve(30);

        // Filter sweep
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.Q.value = 5;
        noiseFilter.frequency.setValueAtTime(6000, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(300, now + 2.0);

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.45, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        // Body tone - metallic
        const tone = audioCtx.createOscillator();
        tone.type = 'sawtooth';
        tone.frequency.setValueAtTime(400, now);
        tone.frequency.exponentialRampToValueAtTime(80, now + 0.5);
        const toneDist = audioCtx.createWaveShaper();
        toneDist.curve = makeDistortionCurve(80);
        const toneGain = audioCtx.createGain();
        toneGain.gain.setValueAtTime(0.35, now);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

        // Sub boom underneath
        const boom = audioCtx.createOscillator();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(80, now);
        boom.frequency.exponentialRampToValueAtTime(20, now + 2.0);
        const boomGain = audioCtx.createGain();
        boomGain.gain.setValueAtTime(0.4, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        noise.connect(noiseFilter);
        noiseFilter.connect(dist1);
        dist1.connect(dist2);
        dist2.connect(noiseGain);
        tone.connect(toneDist);
        toneDist.connect(toneGain);
        boom.connect(boomGain);

        connectToMaster(noiseGain);
        connectToMaster(toneGain);
        connectToMaster(boomGain);

        noise.start(now); tone.start(now); boom.start(now);
        noise.stop(now + 2.5); tone.stop(now + 1.5); boom.stop(now + 2.5);
      }
      break;

    case 2: // TECTONIC SLAM - massive low-end impact with grinding metal trail
      {
        // Initial impact - pitched noise burst
        const impact = audioCtx.createBufferSource();
        impact.buffer = whiteNoiseBuffer;
        impact.playbackRate.setValueAtTime(1.2, now);
        impact.playbackRate.exponentialRampToValueAtTime(0.15, now + 2.0);

        const impDist = audioCtx.createWaveShaper();
        impDist.curve = makeDistortionCurve(200);
        impDist.oversample = '4x';

        const impFilter = audioCtx.createBiquadFilter();
        impFilter.type = 'lowpass';
        impFilter.frequency.setValueAtTime(8000, now);
        impFilter.frequency.exponentialRampToValueAtTime(100, now + 2.5);
        impFilter.Q.value = 4;

        const impGain = audioCtx.createGain();
        impGain.gain.setValueAtTime(0.5, now);
        impGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

        // Grinding tones - inharmonic frequencies that sound like twisting metal
        const grindFreqs = [55, 77, 113, 167];
        grindFreqs.forEach((f, i) => {
          const osc = audioCtx.createOscillator();
          osc.type = i % 2 === 0 ? 'sawtooth' : 'square';
          osc.frequency.setValueAtTime(f * 2, now);
          osc.frequency.exponentialRampToValueAtTime(f * 0.5, now + 2.5);

          const gDist = audioCtx.createWaveShaper();
          gDist.curve = makeDistortionCurve(100 + i * 30);

          const gGain = audioCtx.createGain();
          gGain.gain.setValueAtTime(0.12, now);
          gGain.gain.exponentialRampToValueAtTime(0.001, now + 2.0 + i * 0.3);

          osc.connect(gDist);
          gDist.connect(gGain);
          connectToMaster(gGain);
          osc.start(now);
          osc.stop(now + 2.5 + i * 0.3);
        });

        // Sub foundation
        const sub = audioCtx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(50, now);
        sub.frequency.exponentialRampToValueAtTime(12, now + 3.0);
        const subGain = audioCtx.createGain();
        subGain.gain.setValueAtTime(0.5, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 3.5);

        impact.connect(impFilter);
        impFilter.connect(impDist);
        impDist.connect(impGain);
        sub.connect(subGain);

        connectToMaster(impGain);
        connectToMaster(subGain);

        impact.start(now); sub.start(now);
        impact.stop(now + 3.0); sub.stop(now + 3.5);
      }
      break;

    case 3: // CATACLYSM - maximum destruction, longest tail
      {
        // Pitched down noise - sweeps from high to ultra low
        const noise = audioCtx.createBufferSource();
        noise.buffer = whiteNoiseBuffer;
        noise.playbackRate.setValueAtTime(2.0, now);
        noise.playbackRate.exponentialRampToValueAtTime(0.1, now + 2.5);

        // Triple distortion cascade
        const dist1 = audioCtx.createWaveShaper();
        dist1.curve = makeDistortionCurve(150);
        dist1.oversample = '4x';
        const dist2 = audioCtx.createWaveShaper();
        dist2.curve = makeHardClipCurve(50);
        const dist3 = audioCtx.createWaveShaper();
        dist3.curve = makeDistortionCurve(100);

        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(12000, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(80, now + 3.0);
        noiseFilter.Q.value = 3;

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.5, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 4.0);

        // Sub boom - the deepest
        const boom = audioCtx.createOscillator();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(80, now);
        boom.frequency.exponentialRampToValueAtTime(10, now + 3.0);
        const boomDist = audioCtx.createWaveShaper();
        boomDist.curve = makeDistortionCurve(40);
        const boomGain = audioCtx.createGain();
        boomGain.gain.setValueAtTime(0.6, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 4.0);

        // Secondary sub
        const boom2 = audioCtx.createOscillator();
        boom2.type = 'triangle';
        boom2.frequency.setValueAtTime(40, now);
        boom2.frequency.exponentialRampToValueAtTime(8, now + 3.5);
        const boom2Gain = audioCtx.createGain();
        boom2Gain.gain.setValueAtTime(0.4, now);
        boom2Gain.gain.exponentialRampToValueAtTime(0.001, now + 4.0);

        // Brown noise rumble layer
        const rumble = audioCtx.createBufferSource();
        rumble.buffer = brownNoiseBuffer;
        rumble.playbackRate.value = 0.5;
        const rumbleFilter = audioCtx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.setValueAtTime(300, now);
        rumbleFilter.frequency.exponentialRampToValueAtTime(40, now + 3.0);
        const rumbleDist = audioCtx.createWaveShaper();
        rumbleDist.curve = makeDistortionCurve(80);
        const rumbleGain = audioCtx.createGain();
        rumbleGain.gain.setValueAtTime(0.3, now + 0.1);
        rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 3.5);

        // Impact transient
        const click = audioCtx.createOscillator();
        click.type = 'square';
        click.frequency.setValueAtTime(5000, now);
        click.frequency.exponentialRampToValueAtTime(50, now + 0.05);
        const clickGain = audioCtx.createGain();
        clickGain.gain.setValueAtTime(0.6, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        noise.connect(noiseFilter);
        noiseFilter.connect(dist1);
        dist1.connect(dist2);
        dist2.connect(dist3);
        dist3.connect(noiseGain);
        boom.connect(boomDist);
        boomDist.connect(boomGain);
        boom2.connect(boom2Gain);
        rumble.connect(rumbleFilter);
        rumbleFilter.connect(rumbleDist);
        rumbleDist.connect(rumbleGain);
        click.connect(clickGain);

        connectToMaster(noiseGain);
        connectToMaster(boomGain);
        connectToMaster(boom2Gain);
        connectToMaster(rumbleGain);
        connectToMaster(clickGain);

        noise.start(now); boom.start(now); boom2.start(now);
        rumble.start(now); click.start(now);
        noise.stop(now + 4.0); boom.stop(now + 4.0); boom2.stop(now + 4.0);
        rumble.stop(now + 3.5); click.stop(now + 0.07);
      }
      break;
  }
}

// ==========================================
// GLOBAL CONTROLS
// ==========================================

export function setMacro(value: number) {
  if (!masterFilter || !masterDistortion || !ctx) return;

  const now = ctx.currentTime;
  const filterFreq = 200 + value * 11800;
  masterFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);

  const distAmount = 5 + value * 200;
  masterDistortion.curve = makeDistortionCurve(distAmount);

  const q = 1 + Math.sin(value * Math.PI) * 8;
  masterFilter.Q.setTargetAtTime(q, now, 0.05);
}

export function stopVoice(id: string) {
  const voice = activeVoices.get(id);
  if (voice) {
    voice.stop();
  }
}

export function stopAll() {
  activeVoices.forEach(v => v.stop());
  activeVoices.clear();
}

export function getNoiseConfig(index: number) {
  return NOISE_CONFIGS[index];
}
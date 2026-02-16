# Turing Sequencer — Audio Engine Rebuild Instructions

## Context for AI Code Agent

You are modifying `main_daisy.cpp` for a Daisy Seed generative ambient sequencer. The sequencer logic lives in `turing_sequencer.h` (do NOT modify it). The sequencer produces 6 voices: drones (V1, V3, V5) that sustain and phase in/out on coprime gate cycles, sparkles (V2, V4) that fire short triggered notes, and a pad (V6) that echoes V4's note with a long envelope. The current code compiles and runs but sounds bad — thin sines, no texture, no character differentiation between engines, and a single master effects bus that muds everything together.

This document describes the complete audio engine rebuild. Follow these instructions precisely. Use only DaisySP and libDaisy classes — no external libraries.

---

## OVERVIEW: 4 Engines + Sample Layer + Effects

| Engine | Voices | Role | Character |
|--------|--------|------|-----------|
| **Drone Synth** | V1, V3, V5 | Warm sustained bed | 2× detuned saws + sample layer → SVF lowpass, very gentle filter LFO |
| **Sparkle Synth** | V2, V4 | Short triggered events | StringVoice (Karplus-Strong pluck), shared engine with per-voice LFO on brightness |
| **Shimmer Pad** | V6 | Echoed contrasting texture | 2× detuned triangle + WhiteNoise blend → SVF lowpass, wide vibrato, variable-length envelope |
| **Sample Layer** | Always on | Nature/field recording bed | Looping 16-bit 48kHz sample, continuous playback, slow filter LFO |
| **Effects** | — | Spatial processing | Per-engine send levels into shared delay + reverb |

---

## ENGINE 1: DRONE SYNTH (Voices 1, 3, 5)

### Musical Intent
These are the harmonic foundation — warm, full, present but never harsh. Think of the sustained chord tones in Brian Eno's "Music for Airports." You should hear rich low-mid warmth with no exposed high harmonics. The filter cuts everything sharp, the slight detune between the two oscillators creates a slow organic beating, and a very subtle filter LFO (barely perceptible) keeps the sound alive without becoming a noticeable wobble effect.

The user specifically does NOT want obvious modulation or wobble. The LFO exists only to prevent the sound from feeling static/digital. It should be so slow and narrow-range that you'd only notice it was there if it stopped.

### Why Saw Instead of Sine
Sine waves contain zero harmonics — there's nothing for a filter to shape, so it always sounds thin and electronic regardless of settings. Sawtooth waves contain every harmonic at decreasing amplitude. When lowpass-filtered at a moderate cutoff, the higher harmonics are removed and you get a warm, full tone that retains body. This is the basis of every classic analog pad sound. Use `WAVE_POLYBLEP_SAW` which is band-limited (no aliasing artifacts) and costs roughly the same CPU as a sine on the Daisy.

### Technical Specification

**Replace the `DroneVoice` struct with:**

```cpp
struct DroneVoice {
    Oscillator osc1;           // Primary saw
    Oscillator osc2;           // Detuned saw
    Svf        filter;
    Adsr       env;
    Oscillator filter_lfo;     // NEW: very slow triangle LFO for filter cutoff
    bool       env_gate;
    float      target_freq;
    float      current_freq;
    float      detune_cents;
    float      volume;
    float      base_filter_freq; // Center frequency for filter
    float      lfo_depth;        // How many Hz the LFO moves the cutoff (small!)
};
```

**Replace `DroneParams` with:**

```cpp
struct DroneParams {
    float attack;
    float decay;
    float sustain;
    float release;
    float filter_freq;      // Base cutoff — everything above this is gone
    float filter_res;
    float detune_cents;
    float volume;
    float lfo_rate;         // Hz — very slow
    float lfo_depth;        // Hz — very narrow range
};
```

**New parameter values:**

```cpp
static const DroneParams DRONE_PARAMS[3] = {
    // Voice 1 (Root): Fullest, warmest, most present
    // Cutoff 900 Hz removes all harshness, keeps warmth.
    // LFO at 0.06 Hz = one full cycle every ~17 seconds. Depth ±80 Hz.
    // Detune 8 cents: gentle beating, not chorus-y.
    {2.5f, 0.5f, 1.0f, 4.0f,  900.0f, 0.18f, 8.0f, 0.25f,  0.06f, 80.0f},

    // Voice 3 (Third): Slightly less present, tighter filter
    // LFO at 0.045 Hz (different rate = phases against V1 LFO over time)
    {2.5f, 0.5f, 1.0f, 4.0f,  850.0f, 0.15f, 6.0f, 0.20f,  0.045f, 60.0f},

    // Voice 5 (Scale Walker): Quietest, most filtered
    // LFO at 0.08 Hz (faster but narrower — just keeps it alive)
    {2.5f, 0.5f, 1.0f, 4.0f,  800.0f, 0.12f, 5.0f, 0.13f,  0.08f, 50.0f},
};
```

**Initialization changes in `InitSynth()`:**

For each drone voice:
- Set `osc1` and `osc2` waveform to `Oscillator::WAVE_POLYBLEP_SAW` (was `WAVE_SIN`)
- Init `filter_lfo` as a new `Oscillator`, set waveform to `WAVE_TRI`, set frequency to `lfo_rate`, set amplitude to 1.0
- Store `base_filter_freq` and `lfo_depth` from params
- All three drone LFOs run at different rates (0.06, 0.045, 0.08 Hz) — they are coprime-ish so the combined filter movement across all 3 drones never exactly repeats. This creates very slow timbral evolution without any voice ever doing an obvious "wah" effect.

**Audio callback changes for drones:**

In the per-sample drone loop, before `d.filter.Process(sig)`:

```cpp
// Compute filter cutoff with gentle LFO modulation
float lfo_val = d.filter_lfo.Process(); // Returns -1.0 to 1.0
float cutoff = d.base_filter_freq + (lfo_val * d.lfo_depth);
// Safety clamp: never go below 200 Hz (prevents boominess) or above 2000 Hz (prevents harshness)
if (cutoff < 200.0f) cutoff = 200.0f;
if (cutoff > 2000.0f) cutoff = 2000.0f;
d.filter.SetFreq(cutoff);
```

**Important anti-harshness measure:** The user has experienced painful feedback resonance at higher octaves when modulation stacks up. To prevent this:
- Keep filter resonance LOW (0.12–0.18). Never above 0.25. Resonance amplifies the cutoff frequency — at high notes with high resonance, it rings painfully.
- The LFO depth values (50–80 Hz) are intentionally small relative to the cutoff (800–900 Hz). That's roughly ±8% movement. Enough to be alive, never enough to expose harsh harmonics.
- Clamp cutoff hard at 2000 Hz max in the callback. Even if a bug stacks values, it can never get harsh.

---

## ENGINE 2: SPARKLE SYNTH (Voices 2 and 4)

### Musical Intent
These are short, bright, crystalline events — like someone lightly plucking a guitar string in a cathedral. They trigger, ring for a moment, and trail away into the reverb/delay. They should feel almost percussive in their attack but musical in their decay. Think of Mutable Instruments Rings in "string" mode with moderate damping.

The user wants these to be "almost percussion with interesting trailing." Each pluck should sound slightly different from the last — not through randomized pitch but through a continuously shifting timbral parameter. A slow free-running LFO modulates the StringVoice's brightness parameter, so whatever value the LFO happens to be at when a note triggers determines that note's character. Some will be warmer, some brighter, unpredictably.

### Why StringVoice
DaisySP's `StringVoice` class is a port of the Karplus-Strong algorithm from Mutable Instruments' Rings module. It works by exciting a tuned delay line with a burst of filtered noise — physically modelling how a real string vibrates when plucked. The result is far more natural and musical than any oscillator+envelope approach. It handles its own internal envelope (the string naturally decays), so you don't need an external ADSR. You just call `Trig()` and it plays.

### Technical Specification

**Replace the `SparkleVoice` struct with:**

```cpp
struct SparkleVoice {
    StringVoice  string;       // DaisySP Karplus-Strong voice — replaces osc+filter+env entirely
    Oscillator   brightness_lfo; // Free-running LFO that modulates brightness
    float        base_brightness;
    float        brightness_lfo_depth;
    float        volume;
    bool         triggered;    // Flag to track if we just triggered this cycle
};
```

**Remove `SparkleParams` and replace with:**

```cpp
struct SparkleParams {
    float brightness;       // Base brightness 0.0–1.0 (how much high freq in the pluck)
    float brightness_lfo_rate; // Hz — slow, free-running
    float brightness_lfo_depth; // ± modulation range
    float structure;        // Harmonic content 0.0–1.0 (0 = pure fundamental, higher = richer)
    float damping;          // How quickly the string decays 0.0–1.0 (lower = longer ring)
    float accent;           // Base pluck intensity
    float volume;
};

static const SparkleParams SPARKLE_PARAMS[2] = {
    // Voice 2 (Mirror): Slightly brighter, moderate ring
    // brightness 0.45 = warm but present. LFO at 0.07 Hz drifts it ±0.15 (range 0.30–0.60).
    // structure 0.4 = some overtones but not metallic.
    // damping 0.35 = rings for about 1–2 seconds depending on pitch.
    {0.45f, 0.07f, 0.15f,  0.40f, 0.35f, 0.6f, 0.22f},

    // Voice 4 (Wanderer): Darker, longer ring
    // brightness 0.35 = warmer. LFO at 0.05 Hz drifts ±0.12 (range 0.23–0.47).
    // damping 0.28 = rings longer, more sustained shimmer.
    {0.35f, 0.05f, 0.12f,  0.35f, 0.28f, 0.5f, 0.18f},
};
```

**Initialization in `InitSynth()`:**

For each sparkle voice (`i = 0, 1`):

```cpp
auto& sp = sparkles[i];
auto& p = SPARKLE_PARAMS[i];

sp.string.Init(sample_rate);
sp.string.SetFreq(440.0f);        // Will be set per-trigger
sp.string.SetStructure(p.structure);
sp.string.SetBrightness(p.brightness);
sp.string.SetDamping(p.damping);
sp.string.SetAccent(p.accent);
sp.string.SetSustain(false);      // We want natural decay, not infinite sustain

sp.brightness_lfo.Init(sample_rate);
sp.brightness_lfo.SetWaveform(Oscillator::WAVE_TRI);
sp.brightness_lfo.SetFreq(p.brightness_lfo_rate);
sp.brightness_lfo.SetAmp(1.0f);

sp.base_brightness = p.brightness;
sp.brightness_lfo_depth = p.brightness_lfo_depth;
sp.volume = p.volume;
sp.triggered = false;
```

**Trigger logic in `CheckFollowerTriggers()`:**

When a sparkle voice fires (where you currently set `sp.env_gate = true`), replace with:

```cpp
auto& sp = sparkles[fi];
sp.string.SetFreq(voice.freq);

// Read the free-running LFO's current position to set this note's brightness
float lfo_val = sp.brightness_lfo.Process(); // Will be called per-sample anyway, but grab current
float brightness = sp.base_brightness + (lfo_val * sp.brightness_lfo_depth);
if (brightness < 0.1f) brightness = 0.1f;
if (brightness > 0.8f) brightness = 0.8f;
sp.string.SetBrightness(brightness);

// Volume randomization (±4dB equivalent): same approach as before
float rand_vol = SPARKLE_PARAMS[fi].volume * (0.6f + 0.8f * ((float)(seed.system.GetTick() % 1000) / 1000.0f));
sp.volume = rand_vol;

// Trigger the string
sp.string.Trig();
sp.triggered = true;
```

**Audio callback for sparkles:**

Replace the entire sparkle rendering block. StringVoice handles its own envelope internally — you do NOT need the `env_gate` / `env.Process()` system. Just call `Process()` every sample:

```cpp
for (int si = 0; si < 2; si++) {
    auto& sp = sparkles[si];

    // Advance the brightness LFO every sample (free-running)
    sp.brightness_lfo.Process();

    // StringVoice produces its own enveloped signal
    float sig = sp.string.Process();
    sig *= sp.volume;

    // Sparkles go to a SEPARATE mix bus (for independent effects send)
    sparkle_bus_l += sig;
    sparkle_bus_r += sig;
}
```

**Remove** all sparkle-related `env_gate`, `env.Process()`, `osc1`, and filter code. StringVoice replaces all of it.

**Remove** the sparkle auto-release timing code (the `sparkle_gate_samples` section in the audio callback). StringVoice handles its own decay.

---

## ENGINE 3: SHIMMER PAD (Voice 6)

### Musical Intent
Voice 6 echoes Voice 4's note. It should sound completely different from both the drones and the sparkles — its own instrument. The user wants "a wobbling long note with long attack and decay that sweeps in shimmering and goes away." It should be contrasting but complementary: where the drones are warm saws, V6 uses triangles (softer, hollow) with a breath of noise mixed in (texture, air). A vibrato LFO gives it a bowed-string quality. And critically: the decay length varies every trigger, controlled by a free-running LFO. Sometimes V6 lingers for 4 seconds, sometimes it's gone in 1.5. This makes it unpredictable and alive.

### Why Triangle + Noise
Triangle waves have only odd harmonics (like a clarinet) — they sound hollow and pure compared to the buzzy richness of saws. This immediately differentiates V6 from the drone layer. The noise addition (filtered white noise mixed at low amplitude) adds the "breath" or "air" quality — like hearing the bow scraping on a string, or wind through a flute. It's what separates a synth pad from a "texture."

### Technical Specification

**Replace the `PadVoice` struct with:**

```cpp
struct PadVoice {
    Oscillator  osc1;           // Triangle
    Oscillator  osc2;           // Triangle, detuned wide
    WhiteNoise  noise;          // Breath/air texture layer
    Svf         filter;         // Main lowpass
    Svf         noise_filter;   // Bandpass filter for noise (shapes the "air" band)
    Adsr        env;
    Oscillator  vibrato_lfo;    // Pitch vibrato — bowed string feel
    Oscillator  decay_lfo;      // Free-running LFO that sets decay time per trigger
    bool        env_gate;
    float       target_freq;
    float       current_freq;
    float       volume;
    float       noise_mix;      // 0.0–1.0, how much noise vs oscillators
    float       vibrato_depth_cents;
    float       detune_cents;
};
```

**New pad parameters:**

```cpp
static const struct {
    float attack;           // Long attack — sweeps in
    float min_decay;        // Minimum decay time (when LFO is at bottom)
    float max_decay;        // Maximum decay time (when LFO is at top)
    float sustain;
    float release;          // Long release — fades away
    float filter_freq;      // Darker than drones
    float filter_res;
    float noise_filter_freq; // Bandpass center for the noise layer
    float noise_mix;        // Blend: 0 = pure triangle, 1 = pure noise
    float detune_cents;     // Wide for chorus
    float vibrato_rate;     // Hz
    float vibrato_depth;    // Cents
    float decay_lfo_rate;   // Hz — slow free-running LFO that varies decay
    float volume;
} PAD_PARAMS = {
    1.2f,           // attack: 1.2 seconds — sweeps in slowly
    1.0f,           // min_decay: shortest version
    4.0f,           // max_decay: longest version
    0.4f,           // sustain: moderate hold level
    6.0f,           // release: long fade
    700.0f,         // filter_freq: darker than drones (700 vs 800–900)
    0.12f,          // filter_res: low, no ringing
    2200.0f,        // noise_filter: bandpass at 2.2kHz — "air" frequency band
    0.10f,          // noise_mix: 10% noise, subtle breath
    18.0f,          // detune: 18 cents — wider than drones, more chorus shimmer
    5.2f,           // vibrato rate: 5.2 Hz — realistic bowed string speed
    4.0f,           // vibrato depth: ±4 cents — subtle pitch wobble
    0.03f,          // decay_lfo_rate: 0.03 Hz = one cycle per ~33 seconds
    0.15f           // volume
};
```

**Initialization in `InitSynth()`:**

```cpp
// V6 oscillators: triangle waves (hollow, clarinet-like)
pad.osc1.Init(sample_rate);
pad.osc1.SetWaveform(Oscillator::WAVE_TRI);
pad.osc1.SetAmp(1.0f);

pad.osc2.Init(sample_rate);
pad.osc2.SetWaveform(Oscillator::WAVE_TRI);
pad.osc2.SetAmp(1.0f);

// Noise generator for breath/air texture
pad.noise.Init();

// Noise shaping: bandpass filter isolates the "air" frequency band
pad.noise_filter.Init(sample_rate);
pad.noise_filter.SetFreq(PAD_PARAMS.noise_filter_freq);
pad.noise_filter.SetRes(0.3f); // Moderate Q — not too narrow, not white

// Main lowpass filter
pad.filter.Init(sample_rate);
pad.filter.SetFreq(PAD_PARAMS.filter_freq);
pad.filter.SetRes(PAD_PARAMS.filter_res);

// Envelope — attack and release are fixed, decay will be set per-trigger
pad.env.Init(sample_rate);
pad.env.SetTime(ADSR_SEG_ATTACK, PAD_PARAMS.attack);
pad.env.SetTime(ADSR_SEG_DECAY, PAD_PARAMS.min_decay); // Will be overridden per trigger
pad.env.SetSustainLevel(PAD_PARAMS.sustain);
pad.env.SetTime(ADSR_SEG_RELEASE, PAD_PARAMS.release);

// Vibrato LFO — sine wave, always running
pad.vibrato_lfo.Init(sample_rate);
pad.vibrato_lfo.SetWaveform(Oscillator::WAVE_SIN);
pad.vibrato_lfo.SetFreq(PAD_PARAMS.vibrato_rate);
pad.vibrato_lfo.SetAmp(1.0f);

// Decay modulation LFO — free-running, determines decay length on each trigger
pad.decay_lfo.Init(sample_rate);
pad.decay_lfo.SetWaveform(Oscillator::WAVE_TRI);
pad.decay_lfo.SetFreq(PAD_PARAMS.decay_lfo_rate);
pad.decay_lfo.SetAmp(1.0f);

pad.noise_mix = PAD_PARAMS.noise_mix;
pad.vibrato_depth_cents = PAD_PARAMS.vibrato_depth;
pad.detune_cents = PAD_PARAMS.detune_cents;
pad.volume = PAD_PARAMS.volume;
pad.env_gate = false;
```

**Trigger logic for V6 in `CheckFollowerTriggers()`:**

When V6 fires, replace the current trigger code with:

```cpp
pad.target_freq = voice.freq;
pad.current_freq = voice.freq;

// Read the free-running decay LFO to set THIS note's decay time
float decay_lfo_val = pad.decay_lfo.Process(); // -1 to 1
float decay_normalized = (decay_lfo_val + 1.0f) * 0.5f; // 0 to 1
float decay_time = PAD_PARAMS.min_decay + decay_normalized * (PAD_PARAMS.max_decay - PAD_PARAMS.min_decay);
pad.env.SetTime(ADSR_SEG_DECAY, decay_time);

pad.env_gate = true;
```

This means: some V6 notes decay in ~1 second (quick shimmer), others linger for ~4 seconds (long wash). The LFO cycles so slowly (33 seconds) that there's no pattern a listener would detect.

**Audio callback for V6:**

```cpp
{
    auto& p = pad;

    // Vibrato: pitch modulation from sine LFO
    float vib = p.vibrato_lfo.Process(); // -1 to 1
    float vib_ratio = powf(2.0f, (vib * p.vibrato_depth_cents) / 1200.0f);
    float freq_with_vibrato = p.current_freq * vib_ratio;

    // Set oscillator frequencies
    p.osc1.SetFreq(freq_with_vibrato);
    float detune_ratio = powf(2.0f, p.detune_cents / 1200.0f);
    p.osc2.SetFreq(freq_with_vibrato * detune_ratio);

    // Generate oscillator signal
    float osc_sig = (p.osc1.Process() + p.osc2.Process()) * 0.5f;

    // Generate shaped noise (the "breath" layer)
    float raw_noise = p.noise.Process();
    p.noise_filter.Process(raw_noise);
    float shaped_noise = p.noise_filter.Band(); // Bandpass output — isolates the "air" band

    // Blend oscillators and noise
    float sig = osc_sig * (1.0f - p.noise_mix) + shaped_noise * p.noise_mix;

    // Filter
    p.filter.Process(sig);
    sig = p.filter.Low();

    // Envelope
    float amp = p.env.Process(p.env_gate);
    sig *= amp * p.volume;

    // V6 goes to its own bus (for independent reverb send)
    pad_bus_l += sig;
    pad_bus_r += sig;
}
```

**Keep** the pad auto-release timing code (the gate duration section), but increase the gate time to ~0.3 seconds (shorter than the shortest decay). The ADSR's attack + decay + release handle the full shape. The gate just needs to be long enough for the attack phase to complete before release begins.

Update: `uint32_t pad_gate_samples = (uint32_t)(0.3f * sample_rate);`

Also, advance the decay LFO every sample in the audio callback (even when V6 isn't sounding) so it's truly free-running:

```cpp
pad.decay_lfo.Process(); // Keep this running always
```

---

## ENGINE 4: SAMPLE LAYER (Always On)

### Musical Intent
A 16-second field recording / texture sample loops continuously underneath everything. It's very quiet — a bed, not a voice. Think of distant rain, or the hum of a room, or tape hiss. It adds organic depth that pure synthesis can't achieve. A very slow filter LFO gently opens and closes the brightness, like clouds passing over — never enough to be a noticeable effect, just enough to keep it alive.

### Technical Specification

**Sample data:** The user has a 16-bit mono WAV at 48kHz, 16 seconds long, ~600KB. This must be converted to a C header file containing an `int16_t` array. Use `xxd` or a wav-to-c converter. The resulting array will be ~768,000 samples (16 sec × 48000 samples/sec). At 2 bytes per sample, that's ~1.5MB as source text but the compiled data is ~1.5MB.

Place the sample data in SDRAM (Daisy Seed has 64MB):

```cpp
// In a header file, e.g. sample_data.h:
#include "daisy_seed.h"  // for DSY_SDRAM_BSS

#define SAMPLE_LENGTH 768000  // Adjust to actual sample count
extern const int16_t sample_data[SAMPLE_LENGTH]; // Defined in sample_data.cpp
```

**If the array is too large for flash**, use the `DSY_SDRAM_BSS` attribute and copy from flash to SDRAM at init, or store as a raw binary in flash and read it. For a school project, the simplest approach: generate a `.cpp` file with `const int16_t sample_data[] = { ... };` and `#define SAMPLE_LENGTH ...`. If it fits in flash (the H750 has 128KB internal flash + 8MB external QSPI flash), it's fine. If not, use SDRAM.

**Sample playback struct:**

```cpp
struct SamplePlayer {
    float    phase;           // Current read position (floating point for interpolation)
    float    playback_rate;   // 1.0 = normal speed, matches 48kHz→48kHz
    Svf      filter;          // Lowpass for tonal shaping
    Oscillator filter_lfo;    // Very slow filter modulation
    float    base_filter_freq;
    float    lfo_depth;       // Small — 10-20% of base freq
    float    volume;
    float    fade_length;     // Crossfade samples at loop point
};

static SamplePlayer sampler;
```

**Parameters:**

```cpp
// Sample layer parameters
static const float SAMPLE_FILTER_FREQ    = 1200.0f;  // Base lowpass cutoff
static const float SAMPLE_FILTER_LFO_RATE = 0.012f;  // 0.012 Hz = one cycle per ~83 seconds (~5 sequencer cycles at 50 BPM)
static const float SAMPLE_FILTER_LFO_DEPTH = 180.0f; // ±180 Hz = roughly 15% of 1200 Hz
static const float SAMPLE_VOLUME          = 0.08f;   // Very quiet — a bed, not a voice
static const float SAMPLE_FADE_SAMPLES   = 2400.0f;  // 50ms crossfade at loop point (48000 * 0.05)
```

**Initialization:**

```cpp
sampler.phase = 0.0f;
sampler.playback_rate = 1.0f; // Same sample rate as hardware — no pitch shift

sampler.filter.Init(sample_rate);
sampler.filter.SetFreq(SAMPLE_FILTER_FREQ);
sampler.filter.SetRes(0.08f); // Very low resonance — transparent

sampler.filter_lfo.Init(sample_rate);
sampler.filter_lfo.SetWaveform(Oscillator::WAVE_TRI);
sampler.filter_lfo.SetFreq(SAMPLE_FILTER_LFO_RATE);
sampler.filter_lfo.SetAmp(1.0f);

sampler.base_filter_freq = SAMPLE_FILTER_FREQ;
sampler.lfo_depth = SAMPLE_FILTER_LFO_DEPTH;
sampler.volume = SAMPLE_VOLUME;
sampler.fade_length = SAMPLE_FADE_SAMPLES;
```

**Per-sample audio processing:**

```cpp
// --- Sample Layer ---
{
    // Read sample with linear interpolation
    uint32_t idx = (uint32_t)sampler.phase;
    float frac = sampler.phase - (float)idx;

    // Wrap indices for safety
    uint32_t idx0 = idx % SAMPLE_LENGTH;
    uint32_t idx1 = (idx + 1) % SAMPLE_LENGTH;

    // Convert int16 to float (-1.0 to 1.0)
    float s0 = (float)sample_data[idx0] / 32768.0f;
    float s1 = (float)sample_data[idx1] / 32768.0f;
    float raw = s0 + frac * (s1 - s0); // Linear interpolation

    // Crossfade at loop boundary to prevent clicks
    float dist_to_end = (float)(SAMPLE_LENGTH - idx0);
    float dist_from_start = (float)idx0;
    float fade = 1.0f;
    if (dist_to_end < sampler.fade_length) {
        fade = dist_to_end / sampler.fade_length; // Fade out near end
    }
    if (dist_from_start < sampler.fade_length) {
        float fade_in = dist_from_start / sampler.fade_length;
        if (fade_in < fade) fade = fade_in; // Fade in at start
    }
    raw *= fade;

    // Filter with slow LFO modulation
    float lfo_val = sampler.filter_lfo.Process();
    float cutoff = sampler.base_filter_freq + (lfo_val * sampler.lfo_depth);
    if (cutoff < 300.0f) cutoff = 300.0f;
    if (cutoff > 2500.0f) cutoff = 2500.0f;
    sampler.filter.SetFreq(cutoff);

    sampler.filter.Process(raw);
    float sample_sig = sampler.filter.Low() * sampler.volume;

    // Add to drone bus (it lives with the drones, part of the harmonic bed)
    drone_bus_l += sample_sig;
    drone_bus_r += sample_sig;

    // Advance playback position
    sampler.phase += sampler.playback_rate;
    if (sampler.phase >= (float)SAMPLE_LENGTH) {
        sampler.phase -= (float)SAMPLE_LENGTH;
    }
}
```

The sample layer goes directly to the drone bus because it's part of the bed. It should be filtered and quiet enough that it blends with the drones, adding organic depth without being identifiable as a separate element.

---

## EFFECTS: PER-ENGINE SEND ROUTING

### Musical Intent
The current code routes everything into one mix bus, then through one delay and one reverb. This muds the drones and sparkles together — the sustained drones overwhelm the reverb, and the sparkles can't trail properly because they're competing.

The fix: use THREE separate mix buses before the effects, with different send levels per bus. Still only ONE ReverbSc instance (CPU) and ONE stereo delay pair (CPU). The difference is how much of each engine reaches them.

### Routing Architecture

```
Drone bus (V1,V3,V5 + sample layer)
    → dry_mix at 100%
    → delay send at 5%      (almost no delay on drones)
    → reverb send at 8%     (touch of space, not wash)

Sparkle bus (V2, V4)
    → dry_mix at 60%
    → delay send at 35%     (heavy — plucks echo and trail)
    → reverb send at 50%    (heavy — plucks bloom in space)

Pad bus (V6)
    → dry_mix at 80%
    → delay send at 15%     (some echo but not as much as sparkles)
    → reverb send at 30%    (moderate space)
```

### Technical Implementation

**Declare three bus variables at the top of the audio callback per-sample loop:**

```cpp
float drone_bus_l = 0.0f, drone_bus_r = 0.0f;
float sparkle_bus_l = 0.0f, sparkle_bus_r = 0.0f;
float pad_bus_l = 0.0f, pad_bus_r = 0.0f;
```

**Each engine writes to its own bus** (as shown in the engine sections above).

**After all engines have rendered, mix into the effects:**

```cpp
// --- Per-engine send levels ---
static const float DRONE_DRY     = 1.0f;
static const float DRONE_DELAY   = 0.05f;
static const float DRONE_REVERB  = 0.08f;

static const float SPARKLE_DRY   = 0.60f;
static const float SPARKLE_DELAY = 0.35f;
static const float SPARKLE_REVERB = 0.50f;

static const float PAD_DRY       = 0.80f;
static const float PAD_DELAY     = 0.15f;
static const float PAD_REVERB    = 0.30f;

// Dry sum
float dry_l = drone_bus_l * DRONE_DRY
            + sparkle_bus_l * SPARKLE_DRY
            + pad_bus_l * PAD_DRY;
float dry_r = drone_bus_r * DRONE_DRY
            + sparkle_bus_r * SPARKLE_DRY
            + pad_bus_r * PAD_DRY;

// Delay input (weighted sum of all buses)
float delay_input_l = drone_bus_l * DRONE_DELAY
                    + sparkle_bus_l * SPARKLE_DELAY
                    + pad_bus_l * PAD_DELAY;
float delay_input_r = drone_bus_r * DRONE_DELAY
                    + sparkle_bus_r * SPARKLE_DELAY
                    + pad_bus_r * PAD_DELAY;

// Process delay
float delay_read_l = delay_l.Read();
float delay_read_r = delay_r.Read();
delay_l.Write(delay_input_l + delay_read_l * delay_feedback);
delay_r.Write(delay_input_r + delay_read_r * delay_feedback);

// Reverb input (weighted sum + delay output)
float reverb_input_l = drone_bus_l * DRONE_REVERB
                     + sparkle_bus_l * SPARKLE_REVERB
                     + pad_bus_l * PAD_REVERB
                     + delay_read_l * 0.3f;  // Some delay feeds into reverb
float reverb_input_r = drone_bus_r * DRONE_REVERB
                     + sparkle_bus_r * SPARKLE_REVERB
                     + pad_bus_r * PAD_REVERB
                     + delay_read_r * 0.3f;

// Process reverb
float rev_l, rev_r;
reverb.Process(reverb_input_l, reverb_input_r, &rev_l, &rev_r);

// Final output
out[0][i] = dry_l + delay_read_l + rev_l;
out[1][i] = dry_r + delay_read_r + rev_r;
```

### Effects Parameter Changes

```cpp
// Longer delay time — more spacious for ambient
static float delay_time_sec   = 0.85f;   // Was 0.6, now 0.85
static float delay_feedback   = 0.25f;   // Was 0.30, slightly less to avoid buildup
static float delay_mix        = 0.20f;   // Not used in new routing — send levels replace this

// Reverb: longer tail, darker
static float reverb_feedback  = 0.90f;   // Was 0.88, slightly longer
static float reverb_lpfreq    = 6500.0f; // Was 8000, darker reverb tail
```

Also update the delay time offset for stereo width:
- `delay_l` time = 0.85 seconds
- `delay_r` time = 0.85 + 0.018 seconds (18ms offset for stereo spread — was 14ms)

---

## CPU BUDGET ESTIMATE

| Component | Count | Approx CPU % |
|-----------|-------|-------------|
| Polyblep Saw oscillators | 6 (drone) + 2 (pad) = 8 | ~8% |
| Triangle oscillators | 2 (V6 pad) | ~2% |
| StringVoice | 2 (sparkles) | ~8% |
| Svf filters | 3 (drone) + 1 (V6 noise) + 1 (V6 main) + 1 (sample) = 6 | ~6% |
| WhiteNoise | 1 | <1% |
| ADSR envelopes | 3 (drone) + 1 (V6) = 4 | ~2% |
| LFOs (Oscillator as tri/sin) | 3 (drone filter) + 2 (sparkle brightness) + 2 (V6 vibrato + decay) + 1 (sample filter) = 8 | ~2% |
| ReverbSc | 1 | ~10% |
| DelayLine | 2 | ~2% |
| Sample playback | 1 (buffer read + interpolation) | <1% |
| **Total** | | **~42%** |

Comfortable headroom. Room for the future Turing Detection Layer events.

---

## SUMMARY OF CHANGES FROM CURRENT CODE

1. **DroneVoice struct**: Add `filter_lfo`, `base_filter_freq`, `lfo_depth`. Change osc waveforms from `WAVE_SIN` to `WAVE_POLYBLEP_SAW`. Lower filter cutoff from 1800 to 800–900. Add per-sample LFO→filter modulation with hard clamp at 2000 Hz.

2. **SparkleVoice struct**: Remove `osc1`, `filter`, `env`, `env_gate`. Replace with `StringVoice string`, add `brightness_lfo`. Remove all sparkle ADSR/gate logic. Trigger via `string.Trig()`. Remove sparkle auto-release code.

3. **PadVoice struct**: Add `WhiteNoise noise`, `noise_filter` (Svf bandpass), `vibrato_lfo`, `decay_lfo`. Change osc waveforms to `WAVE_TRI`. Widen detune to 18 cents. Add per-trigger variable decay time. Add per-sample vibrato modulation.

4. **New SamplePlayer**: Add struct, init, per-sample processing. Requires sample data as a compiled C array in a header file. Plays continuously, loops with crossfade, filtered with slow LFO.

5. **Effects routing**: Replace single mix bus with three buses (`drone_bus`, `sparkle_bus`, `pad_bus`). Apply different dry/delay/reverb send levels per bus. Delay feeds partially into reverb. Increase delay time to 0.85s, increase reverb feedback to 0.90, lower reverb LP to 6500.

6. **Remove** the `reverb_mix` concept (was a single wet/dry knob). The new routing replaces it with per-engine send levels. The final output sums dry + delay + reverb directly.

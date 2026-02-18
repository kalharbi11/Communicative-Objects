# Ambient Turing Machine (Web Preview Rig)

A minimal, performance-first web “readout” that mirrors the Daisy Seed instrument: a deterministic, Turing‑style generative sequencer driving multiple voices through a shared FX bus (delay + reverb + shimmer).

This repo documents the **WebAudio preview harness** you can run in a browser to tune sequencing + mixing behavior before porting to Daisy Seed.

---

## What changed recently (important)

### Sparkle engine is now VA (not OP6 / not FM)
The **Sparkle** voice is now a **Virtual Analog (VA) 7‑voice style engine** (dual‑oscillator + filter + VCA, with separate VCF/VCA envelopes), inspired by:

- Nettech15 — **Daisy Seed 7 Voice VA Synthesizer** (reference architecture + parameter set)  
  https://github.com/Nettech15/Daisy-Seed-7-Voice-VA-Synthesizer

In the web version, we mirror the *control surface + behavior* (osc mix, PWM, transpose/detune, VCF ADSR, VCA ADSR, pitch LFO, output HP/LP, FX sends), not a bit‑for‑bit DSP clone.

---

## Project structure

- `index.html` — UI layout (circles + parameter panels + global sliders)
- `styles.css` — styling
- `app.js` — glue: UI ↔ engine wiring, Start/Stop, slider listeners
- `sequencer.js` — deterministic generative “Turing” sequencer (six voices)
- `audio-engine.js` — WebAudio synth engines + routing + event scheduling + hard stop

Most runtime/audio issues originate in `audio-engine.js`.

---

## Core design principles

### 1) Gate-based sequencing (not trigger-only)
The sequencer outputs **gate edge events**:

- `gate ON` (step turns on): start Attack/Decay and hold Sustain
- `gate OFF` (step turns off): run Release tail (do **not** hard-mute)

This matches how keyboard synths behave and prevents “chopped” tails.

### 2) Mixer-style FX sends (shared bus)
Each instrument has independent sends into shared FX:

- `delaySend`
- `reverbSend`
- `shimmerSend`

Global controls set the overall wet mix / character, but **instrument sends** control who “excites” the FX.

### 3) Hard Stop is a panic/kill
Stop closes the `AudioContext` so **delay/reverb/shimmer tails die instantly**. This is intentional for performance control.

---

## Sequencer architecture (`sequencer.js`)

- Runs on a BPM-driven clock
- Maintains per-voice state (note index, octave, gate on/off, rule state)
- Deterministic “rule mutation” and cross-voice dependencies (no RNG)
- Produces `justOn` / `justOff` edges each cycle
- `app.js` renders a compact trace (“trail”) so you can see what rules are driving sound

Flow:
1. `SequencerState.tick()` updates logic for the next cycle
2. Voices flip ON/OFF and/or change pitch
3. Engine schedules `noteOn` / `noteOff` for each voice at WebAudio time

---

## Audio engine architecture (`audio-engine.js`)

### Overview
The engine constructs a routing graph:

- per-instrument dry path
- per-instrument send gains into delay/reverb/shimmer
- master FX bus (delay + reverb + shimmer)
- master output (tone shaping + safety limiting)
- look-ahead scheduler for stable timing

### Voices / engines
Typical layers (names may evolve; pattern stays consistent):

- **Drone**: sustained tonal bed (slow ADSR, filter motion)
- **Sparkle (VA)**: articulated VA engine (dual osc + VCF/VCA envelopes)
- **Strings**: slower pad layer (detune + noise + vibrato)
- **Sample Bed** (optional): quiet texture layer

Each engine exposes:
- tone controls (osc shapes/mix, cutoff/resonance, LFOs, envelopes)
- output HP/LP (instrument-level cleanup)
- FX send levels

---

## UI architecture (`index.html` + `app.js`)

### Where defaults come from
- **Global sliders** (BPM, master FX mixes, master level) are defined in `index.html` via input `value=...`.
- **Per-voice parameter defaults** come from `audio-engine.js` through `engine.getSynthControlLayout()`.

`app.js` builds all per-voice sliders from the engine layout at startup. If you change default params in `audio-engine.js`, refresh the page and the engine + UI should match.

### Cache-busting (if you’re not seeing updated defaults)
ES modules can cache aggressively. If you’re editing a lot, add a version suffix:

- In `index.html`:
  `<script type="module" src="./app.js?v=YYYYMMDDx"></script>`
- In `app.js`:
  `import { TuringAudioEngine } from "./audio-engine.js?v=YYYYMMDDx";`

---

## Running locally

### VS Code Live Server
Right-click `index.html` → **Open with Live Server** → click **Start**

### Python static server
```bash
python -m http.server 5500
```
Open:
`http://127.0.0.1:5500/`

---

## Troubleshooting

### Blank page / no UI
Usually a syntax error in `audio-engine.js` prevents `app.js` from running.

- Open DevTools → Console
- Fix the first red error
- Hard refresh

### Clicking at note edges
Common causes:
- attack = 0 ms (instant gain jump)
- instantaneous `setValueAtTime()` on gain or filter cutoff
- abrupt filter cutoff changes

Fix pattern:
- minimum attack ~3–5 ms
- minimum release ~10–20 ms
- use `setTargetAtTime()` or short ramps for gain + cutoff
- smooth per-block parameter changes (especially for Daisy port)

### Loud “thunder” at Start into reverb
Typical cause: FX feedback paths or wet sends start non-zero.

Fix pattern:
- initialize sends to 0
- ramp wet and feedback in after a short startup window
- add a short master fade-in

---

## Porting notes: Web → Daisy Seed (high level)

Directly portable:
- sequencer logic + gate concept
- per-instrument send mixer architecture
- parameter ranges and curated defaults

Needs adaptation:
- WebAudio node graph → DaisySP signal chain
- reverbs/delays → Daisy equivalents (and buffer clearing on stop)
- AudioParam smoothing → per-sample / per-block smoothing
- “Hard stop” → output mute + clear delay/reverb buffers (no AudioContext close)

Embedded stability tips:
- DC blocking / HPF before reverb and inside feedback loops
- filter the feedback path (HPF/LPF) for clean repeats
- smooth **everything** (avoid zipper noise)

---

## License
(Add your preferred license.)

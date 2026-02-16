# Ambient Turing Machine Web Harness

This browser harness mirrors the current Daisy sequencing rules from `turing_sequencer.h` with an engine layout aligned to the firmware intent:

- `Drone Poly` engine for V1/V3/V5 (single polyphonic synth, with pre-filter wavefold/distortion stage)
- `Sparkle` pluck physical-model style engine shared by V2 and V4 (Rings/Elements-inspired controls)
- `Shimmer Pad V6` engine (detuned triangle + noise + vibrato)
- `Sample Bed` engine (continuous background sample with lowpass + LFO modulation)
- Master FX: stereo delay + tamed convolution reverb + dynamics control

## Run

Use any static server from the repo root.

```powershell
cd web
python -m http.server 8080
```

Then open:

`http://localhost:8080`

## Files

- `index.html`: UI and monitoring view
- `styles.css`: visual design and responsive layout
- `sequencer.js`: direct port of sequencing logic from C++
- `audio-engine.js`: synth engines + scheduling + FX
- `app.js`: control bindings, synth parameter UI, and state rendering

## Notes

- Browser audio requires a user click to start.
- Sound character is not bit-identical to DaisySP because browser DSP and DaisySP internals differ, but sequencing and engine roles are matched.
- Daisy vendor repos are not included in this GitHub project copy. Use:
  - `https://github.com/electro-smith/libDaisy`
  - `https://github.com/electro-smith/DaisySP`
  - `https://github.com/electro-smith/DaisyExamples`

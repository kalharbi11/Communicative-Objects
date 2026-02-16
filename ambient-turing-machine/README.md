# Ambient Turing Machine

This project contains:
- Daisy firmware source (`main_daisy.cpp`, `turing_sequencer.h`, build scripts)
- Browser harness (`web/`) for testing and tuning without hardware

Live page (within this repo):
- `https://kalharbi11.github.io/Communicative-Objects/ambient-turing-machine/web/`

## Note on Daisy Libraries

To keep this GitHub project lighter, Daisy vendor libraries/examples are **not** included here.

Use these upstream repos when building firmware:
- libDaisy: `https://github.com/electro-smith/libDaisy`
- DaisySP: `https://github.com/electro-smith/DaisySP`
- DaisyExamples: `https://github.com/electro-smith/DaisyExamples`

## Structure

- `web/index.html` - interactive web harness entrypoint
- `web/audio-engine.js` - synth engines and routing
- `web/sequencer.js` - sequencer logic mirror
- `main_daisy.cpp` - firmware implementation
- `PROJECT_INSTRUCTIONS.md` - handoff architecture summary

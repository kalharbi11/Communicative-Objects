# Ambient Turing Machine - Project Instructions (Agent Handoff)

This file is the source-of-truth handoff for future AI/code agents working in this folder.

## Purpose

Ambient, rule-based generative music system for Daisy Seed firmware, with a browser harness for preview/tweaking.

Design intent:
- Runs continuously without requiring user interaction.
- Musical logic is deterministic/rule-based (not random noodling).
- 6 musical voices with distinct roles.
- Hardware-ready controls added: BPM pot + root-advance momentary button + 6 voice LEDs.

## Repository Layout

- `main_daisy.cpp`: Daisy firmware audio engine + hardware I/O + render loop.
- `turing_sequencer.h`: Sequencer/rule logic (source of truth for note/gate behavior).
- `sample_data.h`, `sample_data.cpp`: Converted mono sample layer data.
- `Makefile`: Daisy build configuration.
- `tools/convert_sample_to_header.py`: WAV -> mono 48k int16 C array conversion tool.
- `scripts/build_daisy.ps1`: Windows build entrypoint.
- `scripts/program_dfu.ps1`: Windows DFU flashing entrypoint.
- `web/`: Browser harness (sequencer mirror + separate web audio engines + UI/debug view).

## Final Audio Architecture (Daisy Firmware)

The Daisy firmware currently uses:

1. Drone engine (voices V1, V3, V5)
- Two detuned `WAVE_POLYBLEP_SAW` oscillators per drone voice.
- `Svf` lowpass filter per voice.
- `Adsr` envelope per voice.
- Very slow filter LFO per voice (`Oscillator::WAVE_TRI`) for subtle timbral movement.

2. Sparkle engine (voices V2, V4)
- `StringVoice` per sparkle voice (Karplus/physical-model style).
- Per-voice brightness LFO to vary pluck color at trigger time.
- Internal decay handled by `StringVoice`; no external ADSR gate shaping used for sparkles.

3. Pad engine (voice V6)
- Two detuned triangle oscillators + filtered white noise blend.
- Main lowpass `Svf` and separate noise `Svf`.
- `Adsr` with long release.
- Vibrato LFO + decay-time LFO (decay varies per trigger).

4. Sample bed
- Continuous looping mono sample (`sample_data[]`) with edge fade and filtered tone shaping.
- Sample is mixed mainly into drone bus for texture bed.

5. FX routing
- Per-engine send amounts to delay and reverb buses.
- Stereo delay (`DelayLine<float, 96000>`) and `ReverbSc`.
- Final mix: dry + delay return + reverb return.

## Voice Mapping and Trigger Flow

Sequencer has 6 logical voices in `turing_sequencer.h`:
- V1 root drone
- V2 mirror follower
- V3 third drone
- V4 wanderer follower
- V5 scale walker drone
- V6 echo/pad role

Firmware mapping:
- Drone synth consumes sequencer voices `[0, 2, 4]` directly on cycle tick.
- Follower trigger points inside each cycle are `[0.4, 0.1, 0.7]` of cycle duration.
- At follower triggers:
  - V2 trigger point drives sparkle voice 1.
  - V4 trigger point drives sparkle voice 2.
  - V6 trigger point drives pad voice.

## Hardware I/O Prepared in Firmware

Configured in `main_daisy.cpp`:

- LEDs for voice activity/glow:
  - `D0 D1 D2 D3 D4 D5`
  - Audio-reactive brightness with fast attack / slow release.
  - Includes delay/reverb trail contribution, so LEDs fade with tails.

- BPM pot:
  - `D21` (`A6`, ADC input).
  - Mapped to `30..120 BPM`, smoothed.

- Root-advance button:
  - `D14` momentary.
  - Rising edge requests sequencer root nudge.
  - Implemented as deferred flag (`root_nudge_request`) applied in cycle tick processing.

- Audio output jacks:
  - Use Daisy Seed dedicated audio pins:
    - Pin 18 = AUDIO OUT L
    - Pin 19 = AUDIO OUT R
    - Pin 20 = AGND
  - Do not use `D22/D23` for line out jacks in this project.

## Memory / Boot Configuration (Important)

Large sample + DSP memory required memory-section placement:

- Delay lines are in SDRAM:
  - `DSY_SDRAM_BSS` on delay buffers.

- Sample array is in QSPI section:
  - `DSY_QSPI_DATA` on `sample_data`.

- Build app type is bootloader QSPI mode:
  - `APP_TYPE = BOOT_QSPI` in `Makefile`.

Implication:
- Flash using DFU bootloader flow (`make program-dfu`), not normal `program` for this app type.

## Build / Flash Workflow (Windows)

Use these scripts from repo root:

- Build:
  - `.\scripts\build_daisy.ps1`
  - Clean build: `.\scripts\build_daisy.ps1 -Clean`

- Flash (DFU):
  - `.\scripts\program_dfu.ps1`

Expected build artifacts:
- `build/AmbientTuringMachine.elf`
- `build/AmbientTuringMachine.bin`
- `build/AmbientTuringMachine.hex`

## Required Tooling (already prepared on this machine)

- ARM GCC toolchain (arm-none-eabi) expected at:
  - `C:\Program Files (x86)\Arm GNU Toolchain arm-none-eabi\14.2 rel1\bin`
- MSYS2 bash:
  - `C:\msys64\usr\bin\bash.exe`
- `make` and `dfu-util` from MSYS2 environment.
- `libDaisy/` and `DaisySP/` are present locally in repo.

## Sample Conversion Notes

Tool:
- `tools/convert_sample_to_header.py`

Behavior:
- Accepts mono or stereo WAV input.
- Downmixes to mono, removes DC offset, resamples to 48k, normalizes to int16.
- Writes `sample_data.h` / `sample_data.cpp`.

So stereo source files in `assets/samples` are acceptable; conversion handles downmix.

## Web Harness (Current Final State)

Web files:
- `web/sequencer.js`: Port of sequencer behavior.
- `web/audio-engine.js`: Browser audio engines + scheduling + FX.
- `web/app.js`: UI wiring, debug/state rendering, control binding.
- `web/index.html`, `web/styles.css`: UI/visual layout.

Web engine setup (final):
- Poly drone synth for V1/V3/V5.
- Separate piano-style engines for V2 and V4.
- String pad engine for V6.
- Master delay + convolver reverb + dynamics.
- Full per-engine parameter UI exposed.
- Voice debug lines with 3-line history trail (current + two faded prior cycles).
- Global status trail with cycle/root/zone.

Important:
- Web and Daisy are intended to be behaviorally close, not bit-identical DSP replicas.
- Sequencing logic is mirrored; synthesis internals differ by platform.

## Assumptions / Guardrails for Future Changes

- Keep `turing_sequencer.h` as sequencing source-of-truth unless explicitly changing composition rules.
- Maintain 48 kHz sample rate on both Daisy and web harness for parity.
- Preserve click-avoidance envelope scheduling and no hard gate discontinuities.
- If changing sample length/quality, recheck memory usage and keep QSPI/SDRAM placement.
- If changing pin map, update both `main_daisy.cpp` comments/constants and this file.

## Quick Start for a New Agent

1. Read this file.
2. Read `main_daisy.cpp` and `turing_sequencer.h`.
3. Build once with `.\scripts\build_daisy.ps1`.
4. For browser work, run static server in `web/` and open UI.
5. Make changes while preserving the architecture above unless user explicitly requests a redesign.


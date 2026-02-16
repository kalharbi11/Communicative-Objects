# Daisy Seed Firmware Quickstart

## Included

- `main_daisy.cpp`: ambient engine + sequencer integration
- `sample_data.h` / `sample_data.cpp`: converted mono 48kHz sample layer data
- `turing_sequencer.h`: rule engine logic
- `libDaisy/` and `DaisySP/`: downloaded locally
- `Makefile`: root build entry point

## Pin Plan (prepared)

- LEDs (voice states with fade + delay trail): `D0 D1 D2 D3 D4 D5`
- BPM pot (ADC): `D21` (`A6`)
- Root advance button (momentary): `D14`
- Audio output jacks (line out): Daisy Seed dedicated audio pins `18 = OUT L`, `19 = OUT R`, with `20 = AGND`

## Build

From repo root:

```powershell
.\scripts\build_daisy.ps1
```

## Upload

Use one of the libDaisy make targets once your Seed is connected:

```powershell
.\scripts\program_dfu.ps1
```

## Notes

- `APP_TYPE = BOOT_QSPI` is enabled in `Makefile` so this build can hold the large sample.
- With this app type, upload with DFU (`program-dfu`) via Daisy bootloader.
- BPM pot is mapped `30..120 BPM`.
- Button is momentary (rising-edge) and requests root nudge.
- LED brightness is audio-reactive with slow release and delay/reverb trail influence.
- Delay memory is placed in SDRAM and sample data is placed in QSPI flash for memory headroom.
- Sample conversion tool is in `tools/convert_sample_to_header.py`.
- Stereo source files are fine: conversion tool downmixes to mono `int16` for `sample_data.cpp`.

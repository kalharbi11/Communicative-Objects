// Platform-matched sequencer logic ported from turing_sequencer.h

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

function degreeToMidi(rootChromatic, degree, baseOctave, minOctave = -1) {
  let octOffset = 0;
  let normDegree = 0;

  if (degree >= 0) {
    octOffset = Math.trunc(degree / 7);
    normDegree = degree % 7;
  } else {
    octOffset = Math.trunc((degree - 6) / 7);
    normDegree = ((degree % 7) + 7) % 7;
  }

  const semitoneOffset = MAJOR_SCALE[normDegree];
  let midi = (baseOctave + octOffset) * 12 + rootChromatic + semitoneOffset;

  if (minOctave >= 0) {
    const minMidi = minOctave * 12;
    while (midi < minMidi) {
      midi += 12;
    }
  }

  return midi;
}

function midiToFreq(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function midiToNoteInfo(midi) {
  let octave = Math.trunc(midi / 12);
  let noteIndex = midi % 12;
  if (noteIndex < 0) {
    noteIndex += 12;
    octave -= 1;
  }
  return { noteIndex, octave };
}

function makeVoice() {
  return {
    freq: 0,
    midiNote: 0,
    degree: 0,
    octave: 3,
    gate: false,
    prevGate: false,
    active: false,
    noteIndex: 0,
    finalOctave: 0,
  };
}

export class SequencerState {
  constructor() {
    this.cycle = 0;
    this.voices = Array.from({ length: 6 }, makeVoice);

    this.frozenV2Degree = 4;
    this.frozenV4Degree = 5;
    this.frozenV6Degree = 3;
    this.prevV4DegreeForEcho = 5;

    this.v5History = [0, 0];
    this.lastV2TriggerCycle = -100;

    this.rootChromatic = 0;
    this.rootCycleIndex = 0;

    this.init();
  }

  init() {
    this.cycle = 0;
    this.frozenV2Degree = 4;
    this.frozenV4Degree = 5;
    this.frozenV6Degree = 3;
    this.prevV4DegreeForEcho = 5;
    this.v5History = [0, 0];
    this.lastV2TriggerCycle = -100;
    this.rootChromatic = 0;
    this.rootCycleIndex = 0;

    for (let i = 0; i < 6; i += 1) {
      const v = this.voices[i];
      v.gate = false;
      v.prevGate = false;
      v.active = false;
      v.degree = 0;
      v.octave = 3;
    }

    this.voices[0].midiNote = degreeToMidi(0, 0, 3);
    this.voices[1].midiNote = degreeToMidi(0, 4, 3, 4);
    this.voices[2].midiNote = degreeToMidi(0, 2, 3);
    this.voices[3].midiNote = degreeToMidi(0, 5, 3, 4);
    this.voices[4].midiNote = degreeToMidi(0, 0, 4);
    this.voices[5].midiNote = degreeToMidi(0, 3, 4, 4);

    for (let i = 0; i < 6; i += 1) {
      this.voices[i].freq = midiToFreq(this.voices[i].midiNote);
      const info = midiToNoteInfo(this.voices[i].midiNote);
      this.voices[i].noteIndex = info.noteIndex;
      this.voices[i].finalOctave = info.octave;
    }
  }

  tick() {
    const cycle = this.cycle;

    for (let i = 0; i < 6; i += 1) {
      this.voices[i].prevGate = this.voices[i].gate;
    }

    this.rootCycleIndex = Math.trunc(cycle / 12) % 12;
    this.rootChromatic = CIRCLE_OF_FIFTHS[this.rootCycleIndex];
    const root = this.rootChromatic;

    const gates = [false, false, false, false, false, false];
    gates[0] = (cycle % 12) < 10;
    gates[2] = (cycle % 7) < 5;
    gates[4] = (cycle % 5) < 4;

    if (cycle % 3 === 0 && this.voices[4].prevGate) {
      gates[1] = true;
      this.lastV2TriggerCycle = cycle;
    }

    if (cycle % 5 === 0 && (cycle - this.lastV2TriggerCycle) <= 2) {
      gates[3] = true;
    }

    gates[5] = (cycle % 4) === 0;

    for (let i = 0; i < 6; i += 1) {
      this.voices[i].gate = gates[i];
    }

    this.voices[0].degree = 0;
    this.voices[0].octave = 3;
    this.voices[0].midiNote = degreeToMidi(root, 0, 3);
    this.voices[0].freq = midiToFreq(this.voices[0].midiNote);

    this.voices[2].degree = 2;
    this.voices[2].octave = 3;
    this.voices[2].midiNote = degreeToMidi(root, 2, 3);
    this.voices[2].freq = midiToFreq(this.voices[2].midiNote);

    const v5Step = Math.trunc(cycle / 3) % 7;
    this.voices[4].degree = v5Step;
    this.voices[4].octave = gates[2] ? 4 : 3;
    this.voices[4].midiNote = degreeToMidi(root, v5Step, this.voices[4].octave, 3);
    if (this.voices[4].midiNote >= 72) {
      this.voices[4].midiNote -= 12;
    }
    this.voices[4].freq = midiToFreq(this.voices[4].midiNote);

    const prevV5 = this.v5History[0];
    this.v5History[1] = prevV5;
    this.v5History[0] = v5Step;

    if (gates[1]) {
      let v2Change = 0;
      if (v5Step > prevV5) {
        v2Change = -1;
      } else if (v5Step < prevV5) {
        v2Change = 1;
      }
      this.frozenV2Degree += v2Change;
    }
    this.voices[1].degree = this.frozenV2Degree;
    this.voices[1].octave = 3;
    this.voices[1].midiNote = degreeToMidi(root, this.frozenV2Degree, 3, 4);
    this.voices[1].freq = midiToFreq(this.voices[1].midiNote);

    this.prevV4DegreeForEcho = this.frozenV4Degree;

    if (gates[3]) {
      const v3WasOn = this.voices[2].prevGate;
      const v2WasOn = this.voices[1].prevGate;
      let v4Change = 0;

      if (v3WasOn && v2WasOn) {
        v4Change = 1;
      } else if (v3WasOn && !v2WasOn) {
        v4Change = -2;
      } else if (!v3WasOn && v2WasOn) {
        v4Change = 0;
      } else {
        v4Change = 3;
      }

      this.frozenV4Degree += v4Change;
    }

    this.voices[3].degree = this.frozenV4Degree;
    this.voices[3].octave = 3;
    this.voices[3].midiNote = degreeToMidi(root, this.frozenV4Degree, 3, 4);
    this.voices[3].freq = midiToFreq(this.voices[3].midiNote);

    if (gates[5]) {
      this.frozenV6Degree = this.prevV4DegreeForEcho;
    }

    const v1WasOn = this.voices[0].prevGate;
    const v6Octave = v1WasOn ? 4 : 5;
    this.voices[5].degree = this.frozenV6Degree;
    this.voices[5].octave = v6Octave;
    this.voices[5].midiNote = degreeToMidi(root, this.frozenV6Degree, v6Octave, 4);
    if (this.voices[5].midiNote >= 84) {
      this.voices[5].midiNote -= 12;
    }
    this.voices[5].freq = midiToFreq(this.voices[5].midiNote);

    for (let i = 0; i < 6; i += 1) {
      const info = midiToNoteInfo(this.voices[i].midiNote);
      this.voices[i].noteIndex = info.noteIndex;
      this.voices[i].finalOctave = info.octave;
      this.voices[i].active = this.voices[i].gate;
    }

    this.cycle += 1;
  }

  nudgeRoot() {
    const next = (Math.trunc(this.cycle / 12) + 1) * 12;
    this.cycle = next;
  }
}

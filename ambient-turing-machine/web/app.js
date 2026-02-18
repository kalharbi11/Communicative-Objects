import { NOTE_NAMES } from "./sequencer.js";
import { TuringAudioEngine } from "./audio-engine.js?v=20260217a";

const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

const VOICE_META = [
  {
    id: "V1",
    role: "Root drone",
    color: {
      outline: "rgba(193, 82, 66, 0.46)",
      core: "rgba(193, 82, 66, 0.42)",
      glow: "rgba(193, 82, 66, 0.34)",
      text: "rgba(193, 82, 66, 0.52)",
    },
  },
  {
    id: "V2",
    role: "Mirror sparkle",
    color: {
      outline: "rgba(72, 136, 120, 0.46)",
      core: "rgba(72, 136, 120, 0.42)",
      glow: "rgba(72, 136, 120, 0.34)",
      text: "rgba(72, 136, 120, 0.52)",
    },
  },
  {
    id: "V3",
    role: "Third drone",
    color: {
      outline: "rgba(86, 106, 154, 0.46)",
      core: "rgba(86, 106, 154, 0.42)",
      glow: "rgba(86, 106, 154, 0.34)",
      text: "rgba(86, 106, 154, 0.52)",
    },
  },
  {
    id: "V4",
    role: "Wanderer sparkle",
    color: {
      outline: "rgba(159, 114, 57, 0.46)",
      core: "rgba(159, 114, 57, 0.42)",
      glow: "rgba(159, 114, 57, 0.34)",
      text: "rgba(159, 114, 57, 0.52)",
    },
  },
  {
    id: "V5",
    role: "Scale walker drone",
    color: {
      outline: "rgba(117, 90, 150, 0.46)",
      core: "rgba(117, 90, 150, 0.42)",
      glow: "rgba(117, 90, 150, 0.34)",
      text: "rgba(117, 90, 150, 0.52)",
    },
  },
  {
    id: "V6",
    role: "String pad",
    color: {
      outline: "rgba(69, 124, 159, 0.46)",
      core: "rgba(69, 124, 159, 0.42)",
      glow: "rgba(69, 124, 159, 0.34)",
      text: "rgba(69, 124, 159, 0.52)",
    },
  },
];

const engine = new TuringAudioEngine();
if (typeof window !== "undefined") {
  window.engine = engine;
  window.turingDebug = {
    bypassDelayReverbSends(enabled = true) {
      engine.setDebugBypassDelayReverbSends(!!enabled);
      return engine.debugBypassDelayReverbSends;
    },
    get bypassDelayReverbSendsState() {
      return engine.debugBypassDelayReverbSends;
    },
  };
}

const els = {
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  nudge: document.querySelector("#nudge"),
  status: document.querySelector("#status"),
  bpm: document.querySelector("#bpm"),
  bpmValue: document.querySelector("#bpm-value"),
  reverb: document.querySelector("#reverb"),
  reverbValue: document.querySelector("#reverb-value"),
  delay: document.querySelector("#delay"),
  delayValue: document.querySelector("#delay-value"),
  delayModRate: document.querySelector("#delay-mod-rate"),
  delayModRateValue: document.querySelector("#delay-mod-rate-value"),
  delayModDepth: document.querySelector("#delay-mod-depth"),
  delayModDepthValue: document.querySelector("#delay-mod-depth-value"),
  shimmer: document.querySelector("#shimmer"),
  shimmerValue: document.querySelector("#shimmer-value"),
  shimmerModRate: document.querySelector("#shimmer-mod-rate"),
  shimmerModRateValue: document.querySelector("#shimmer-mod-rate-value"),
  shimmerModDepth: document.querySelector("#shimmer-mod-depth"),
  shimmerModDepthValue: document.querySelector("#shimmer-mod-depth-value"),
  master: document.querySelector("#master"),
  masterValue: document.querySelector("#master-value"),
  voiceGrid: document.querySelector("#voice-grid"),
  synthControls: document.querySelector("#voice-controls"),
  globalTrailLines: Array.from(document.querySelectorAll("#global-trail .trail-line")),
};

const voiceEls = [];
const voiceHistory = Array.from({ length: 6 }, () => []);
const globalHistory = [];
let prevSnapshot = null;

function setStatus(text) {
  els.status.textContent = text;
}

function noteLabel(voice) {
  return `${NOTE_NAMES[voice.noteIndex]}${voice.finalOctave}`;
}

function bareNote(voice) {
  return NOTE_NAMES[voice.noteIndex];
}

function pushHistory(history, line) {
  history.unshift(line);
  if (history.length > 3) {
    history.length = 3;
  }
}

function historyAt(history, idx) {
  return history[idx] ?? "";
}

function cyclePhase12(cycleDisplay) {
  return (cycleDisplay % 12) + 1;
}

function cycleZone(cycleDisplay) {
  const phase = cyclePhase12(cycleDisplay);
  if (phase <= 4) {
    return "cycles 1-4: clustered";
  }
  if (phase <= 8) {
    return "cycles 5-8: mid spread";
  }
  return "cycles 9-12: wide spread";
}

function directionSymbol(current, previous) {
  if (current > previous) {
    return "^";
  }
  if (current < previous) {
    return "v";
  }
  return "-";
}

function createVoiceCard(meta) {
  const card = document.createElement("article");
  card.className = "voice-card";

  const top = document.createElement("div");
  top.className = "voice-top";

  const id = document.createElement("strong");
  id.className = "voice-id mono";
  id.textContent = meta.id;

  const role = document.createElement("span");
  role.className = "voice-role";
  role.textContent = meta.role;

  top.append(id, role);

  const circle = document.createElement("div");
  circle.className = "voice-circle";

  const note = document.createElement("span");
  note.className = "voice-note";
  note.textContent = "--";

  circle.append(note);

  const trail = document.createElement("div");
  trail.className = "voice-trail mono";

  const line0 = document.createElement("p");
  line0.className = "trail-line trail-current";

  const line1 = document.createElement("p");
  line1.className = "trail-line trail-previous-1";

  const line2 = document.createElement("p");
  line2.className = "trail-line trail-previous-2";

  trail.append(line0, line1, line2);

  card.style.setProperty("--voice-outline", meta.color.outline);
  card.style.setProperty("--voice-core", meta.color.core);
  card.style.setProperty("--voice-glow", meta.color.glow);
  card.style.setProperty("--voice-text", meta.color.text);

  card.append(top, circle, trail);

  return {
    card,
    circle,
    note,
    lines: [line0, line1, line2],
  };
}

function buildVoiceGrid() {
  for (let i = 0; i < VOICE_META.length; i += 1) {
    const voiceCard = createVoiceCard(VOICE_META[i]);
    voiceEls.push(voiceCard);
    els.voiceGrid.append(voiceCard.card);
  }
}

function formatControlValue(control, value) {
  if (control.type === "select") {
    return String(value);
  }

  const key = String(control.key).toLowerCase();
  const label = String(control.label ?? "").toLowerCase();
  if (key.includes("cutoff") || label.includes("hz")) {
    return `${Math.round(value)} Hz`;
  }
  if (key.includes("vibratorate")) {
    return `${value.toFixed(2)} Hz`;
  }
  if (key.includes("detune") || key.includes("depth")) {
    return `${value.toFixed(1)}`;
  }
  if (key.includes("attack") || key.includes("decay") || key.includes("release") || key.includes("gate") || key.includes("glide")) {
    return `${value.toFixed(3)} s`;
  }
  return value.toFixed(3);
}

function createEngineControlRow(engineId, control) {
  const row = document.createElement("div");
  row.className = "param-row";

  const meta = document.createElement("div");
  meta.className = "param-meta";

  const label = document.createElement("label");
  label.textContent = control.label;

  const readout = document.createElement("span");
  readout.className = "param-value";
  readout.textContent = formatControlValue(control, control.value);

  meta.append(label, readout);
  row.append(meta);

  if (control.type === "select") {
    const select = document.createElement("select");

    for (const option of control.options ?? []) {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      if (option === control.value) {
        opt.selected = true;
      }
      select.append(opt);
    }

    select.addEventListener("change", () => {
      readout.textContent = String(select.value);
      engine.setSynthParam(engineId, control.key, select.value);
    });

    row.append(select);
    return row;
  }

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(control.min);
  input.max = String(control.max);
  input.step = String(control.step);
  input.value = String(control.value);

  input.addEventListener("input", () => {
    const next = Number(input.value);
    readout.textContent = formatControlValue(control, next);
    engine.setSynthParam(engineId, control.key, next);
  });

  row.append(input);
  return row;
}

function buildSynthControls() {
  const engines = engine.getSynthControlLayout();

  for (const synth of engines) {
    const card = document.createElement("article");
    card.className = "param-card";

    const head = document.createElement("div");
    head.className = "param-head";

    const id = document.createElement("strong");
    id.className = "param-id";
    id.textContent = synth.id;

    const role = document.createElement("span");
    role.className = "param-role";
    role.textContent = synth.label;

    head.append(id, role);
    card.append(head);

    for (const control of synth.controls) {
      card.append(createEngineControlRow(synth.id, control));
    }

    els.synthControls.append(card);
  }
}

function rebuildSynthControls() {
  els.synthControls.innerHTML = "";
  buildSynthControls();
}

function buildVoiceLines(seq, previous, cycleDisplay) {
  const voices = seq.voices;
  const rootName = NOTE_NAMES[seq.rootChromatic];
  const nextRoot = NOTE_NAMES[CIRCLE_OF_FIFTHS[(seq.rootCycleIndex + 1) % CIRCLE_OF_FIFTHS.length]];

  const v1 = voices[0];
  const v2 = voices[1];
  const v3 = voices[2];
  const v4 = voices[3];
  const v5 = voices[4];
  const v6 = voices[5];

  const pV2 = previous ? previous.voices[1] : v2;
  const pV4 = previous ? previous.voices[3] : v4;
  const pV5 = previous ? previous.voices[4] : v5;
  const pV6 = previous ? previous.voices[5] : v6;

  const v5Move = directionSymbol(v5.degree, pV5.degree);
  const v5DegreeDisplay = ((v5.degree % 7) + 7) % 7 + 1;

  let mirrorRule = "no trigger";
  if (v2.gate) {
    if (v5Move === "^") {
      mirrorRule = "v5 went ^ so v2 v";
    } else if (v5Move === "v") {
      mirrorRule = "v5 went v so v2 ^";
    } else {
      mirrorRule = "v5 held so v2 held";
    }
  }

  let wanderRule = "hold";
  if (v4.gate) {
    const v3WasOn = v3.prevGate;
    const v2WasOn = v2.prevGate;
    if (v3WasOn && v2WasOn) {
      wanderRule = "both on -> +1";
    } else if (v3WasOn && !v2WasOn) {
      wanderRule = "v3 on, v2 off -> -2";
    } else if (!v3WasOn && v2WasOn) {
      wanderRule = "v3 off, v2 on -> 0";
    } else {
      wanderRule = "both off -> +3";
    }
  }

  const semitoneRead = Math.abs(v2.midiNote - v3.midiNote) % 12;
  const octFlip = pV6.finalOctave !== v6.finalOctave ? "yes" : "no";

  return [
    `${noteLabel(v1)} | cycle ${cyclePhase12(cycleDisplay)}/12 | next: ${nextRoot}`,
    `${noteLabel(v2)} | ${noteLabel(pV2)} -> ${noteLabel(v2)} | ${mirrorRule}`,
    `${noteLabel(v3)} | 3rd of ${rootName}`,
    `v3=${bareNote(v3)} v2=${bareNote(v2)} | ${semitoneRead}st | ${wanderRule} | ${noteLabel(pV4)} -> ${noteLabel(v4)}`,
    `${noteLabel(v5)} | deg ${v5DegreeDisplay}/7 ${v5Move}`,
    `echo v4 prev: ${noteLabel(pV4)} | oct flip: ${octFlip}`,
  ];
}

function buildGlobalLine(seq, cycleDisplay) {
  const count = cycleDisplay + 1;
  const root = NOTE_NAMES[seq.rootChromatic];
  return `cycle ${count} | root ${root} | zone ${cycleZone(cycleDisplay)}`;
}

function snapshot(seq) {
  return {
    cycle: seq.cycle,
    rootChromatic: seq.rootChromatic,
    rootCycleIndex: seq.rootCycleIndex,
    voices: seq.voices.map((voice) => ({
      noteIndex: voice.noteIndex,
      finalOctave: voice.finalOctave,
      midiNote: voice.midiNote,
      degree: voice.degree,
      gate: voice.gate,
      prevGate: voice.prevGate,
    })),
  };
}

function render(seq, options = {}) {
  const { commitHistory = false } = options;
  const cycleDisplay = Math.max(0, seq.cycle - 1);

  if (commitHistory) {
    const lines = buildVoiceLines(seq, prevSnapshot, cycleDisplay);
    for (let i = 0; i < lines.length; i += 1) {
      pushHistory(voiceHistory[i], lines[i]);
    }
    pushHistory(globalHistory, buildGlobalLine(seq, cycleDisplay));
  }

  for (let i = 0; i < voiceEls.length; i += 1) {
    const voice = seq.voices[i];
    const ui = voiceEls[i];

    ui.note.textContent = noteLabel(voice);
    ui.circle.classList.toggle("active", voice.gate);

    ui.lines[0].textContent = historyAt(voiceHistory[i], 0);
    ui.lines[1].textContent = historyAt(voiceHistory[i], 1);
    ui.lines[2].textContent = historyAt(voiceHistory[i], 2);
  }

  els.globalTrailLines[0].textContent = historyAt(globalHistory, 0);
  els.globalTrailLines[1].textContent = historyAt(globalHistory, 1);
  els.globalTrailLines[2].textContent = historyAt(globalHistory, 2);

  prevSnapshot = snapshot(seq);
}

buildVoiceGrid();
rebuildSynthControls();

for (let i = 0; i < voiceHistory.length; i += 1) {
  pushHistory(voiceHistory[i], "idle | awaiting cycle data");
}
pushHistory(globalHistory, "cycle 0 | root C | zone cycles 1-4: clustered");

engine.onCycle = (seq) => {
  render(seq, { commitHistory: true });
};

els.start.addEventListener("click", async () => {
  try {
    setStatus("Starting audio engine...");
    await engine.start();
    setStatus("Running");
    els.start.disabled = true;
    els.stop.disabled = false;
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

els.stop.addEventListener("click", () => {
  engine.stop();
  setStatus("Stopped");
  els.start.disabled = false;
  els.stop.disabled = true;
});

els.nudge.addEventListener("click", () => {
  engine.seq.nudgeRoot();
  render(engine.seq, { commitHistory: false });
});

els.bpm.addEventListener("input", () => {
  const bpm = Number(els.bpm.value);
  els.bpmValue.textContent = `${bpm}`;
  engine.setBpm(bpm);
});

els.reverb.addEventListener("input", () => {
  const value = Number(els.reverb.value);
  els.reverbValue.textContent = value.toFixed(2);
  engine.setReverbMix(value);
});

els.delay.addEventListener("input", () => {
  const value = Number(els.delay.value);
  els.delayValue.textContent = value.toFixed(2);
  engine.setDelayMix(value);
});
if (els.delayModRate) {
  els.delayModRate.addEventListener("input", () => {
    const value = Number(els.delayModRate.value);
    if (els.delayModRateValue) els.delayModRateValue.textContent = `${value.toFixed(3)} Hz`;
    engine.setDelayModRate(value);
  });
}
if (els.delayModDepth) {
  els.delayModDepth.addEventListener("input", () => {
    const value = Number(els.delayModDepth.value);
    if (els.delayModDepthValue) els.delayModDepthValue.textContent = `${value.toFixed(4)} s`;
    engine.setDelayModDepth(value);
  });
}
if (els.shimmer) {
  els.shimmer.addEventListener("input", () => {
    const value = Number(els.shimmer.value);
    if (els.shimmerValue) els.shimmerValue.textContent = value.toFixed(2);
    engine.setShimmerMix(value);
  });
}
if (els.shimmerModRate) {
  els.shimmerModRate.addEventListener("input", () => {
    const value = Number(els.shimmerModRate.value);
    if (els.shimmerModRateValue) els.shimmerModRateValue.textContent = `${value.toFixed(3)} Hz`;
    engine.setShimmerModRate(value);
  });
}
if (els.shimmerModDepth) {
  els.shimmerModDepth.addEventListener("input", () => {
    const value = Number(els.shimmerModDepth.value);
    if (els.shimmerModDepthValue) els.shimmerModDepthValue.textContent = `${value.toFixed(4)} s`;
    engine.setShimmerModDepth(value);
  });
}


els.master.addEventListener("input", () => {
  const value = Number(els.master.value);
  els.masterValue.textContent = value.toFixed(2);
  engine.setMaster(value);
});

els.bpmValue.textContent = els.bpm.value;
els.reverbValue.textContent = Number(els.reverb.value).toFixed(2);
els.delayValue.textContent = Number(els.delay.value).toFixed(2);
if (els.delayModRate && els.delayModRateValue) els.delayModRateValue.textContent = `${Number(els.delayModRate.value).toFixed(3)} Hz`;
if (els.delayModDepth && els.delayModDepthValue) els.delayModDepthValue.textContent = `${Number(els.delayModDepth.value).toFixed(4)} s`;
if (els.shimmer && els.shimmerValue) els.shimmerValue.textContent = Number(els.shimmer.value).toFixed(2);
if (els.shimmerModRate && els.shimmerModRateValue) els.shimmerModRateValue.textContent = `${Number(els.shimmerModRate.value).toFixed(3)} Hz`;
if (els.shimmerModDepth && els.shimmerModDepthValue) els.shimmerModDepthValue.textContent = `${Number(els.shimmerModDepth.value).toFixed(4)} s`;
els.masterValue.textContent = Number(els.master.value).toFixed(2);

render(engine.seq, { commitHistory: false });
setStatus("Idle (click Start to unlock audio)");

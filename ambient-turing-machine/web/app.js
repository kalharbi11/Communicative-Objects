import { TuringAudioEngine } from “./audio-engine.js”;

const engine = new TuringAudioEngine();
let uiUpdateInterval = null;

// ==========================================
// iOS AUDIO UNLOCK
// ==========================================
// iOS requires a user gesture to unlock AudioContext.
// We unlock on the first button press.
let audioUnlocked = false;

async function unlockAudio() {
if (audioUnlocked) return;

try {
await engine.init();
if (engine.ctx && engine.ctx.state === “suspended”) {
await engine.ctx.resume();
}
audioUnlocked = true;
console.log(“✓ Audio unlocked for iOS”);
} catch (err) {
console.error(“Audio unlock failed:”, err);
}
}

// ==========================================
// DOM REFERENCES
// ==========================================
const startBtn = document.getElementById(“start”);
const stopBtn = document.getElementById(“stop”);
const nudgeBtn = document.getElementById(“nudge”);
const statusSpan = document.getElementById(“status”);

const bpmSlider = document.getElementById(“bpm”);
const bpmValue = document.getElementById(“bpm-value”);
const reverbSlider = document.getElementById(“reverb”);
const reverbValue = document.getElementById(“reverb-value”);
const delaySlider = document.getElementById(“delay”);
const delayValue = document.getElementById(“delay-value”);
const masterSlider = document.getElementById(“master”);
const masterValue = document.getElementById(“master-value”);

const voiceControlsContainer = document.getElementById(“voice-controls”);
const voiceGrid = document.getElementById(“voice-grid”);
const globalTrail = document.getElementById(“global-trail”);

// ==========================================
// INIT UI
// ==========================================
function initUI() {
// Set initial slider values
bpmSlider.value = engine.bpm;
bpmValue.textContent = engine.bpm;

reverbSlider.value = engine.reverbMix;
reverbValue.textContent = engine.reverbMix.toFixed(2);

delaySlider.value = engine.delayMix;
delayValue.textContent = engine.delayMix.toFixed(2);

masterSlider.value = 0.9;
masterValue.textContent = “0.90”;

// Build synth controls
buildSynthControls();

// Build voice state cards
buildVoiceGrid();

// Update status
updateStatus();
}

// ==========================================
// SYNTH CONTROLS
// ==========================================
function buildSynthControls() {
const layout = engine.getSynthControlLayout();
voiceControlsContainer.innerHTML = “”;

for (const group of layout) {
const groupEl = document.createElement(“div”);
groupEl.className = “voice-control-group”;

```
const title = document.createElement("h3");
title.textContent = group.label;
groupEl.appendChild(title);

for (const control of group.controls) {
  const row = document.createElement("div");
  row.className = "control-row";

  if (control.type === "select") {
    const label = document.createElement("label");
    label.textContent = control.label;
    
    const select = document.createElement("select");
    select.dataset.synthId = group.id;
    select.dataset.key = control.key;
    
    for (const opt of control.options) {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      if (opt === control.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    
    select.addEventListener("change", (e) => {
      engine.setSynthParam(group.id, control.key, e.target.value);
    });
    
    label.appendChild(select);
    row.appendChild(label);
  } else {
    const label = document.createElement("label");
    
    const labelText = document.createElement("span");
    labelText.textContent = control.label;
    label.appendChild(labelText);
    
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = control.min;
    slider.max = control.max;
    slider.step = control.step;
    slider.value = control.value;
    slider.dataset.synthId = group.id;
    slider.dataset.key = control.key;
    label.appendChild(slider);
    
    const valueSpan = document.createElement("span");
    valueSpan.className = "value";
    valueSpan.textContent = formatValue(control.value, control.step);
    label.appendChild(valueSpan);
    
    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      engine.setSynthParam(group.id, control.key, val);
      valueSpan.textContent = formatValue(val, control.step);
    });
    
    row.appendChild(label);
  }
  
  groupEl.appendChild(row);
}

voiceControlsContainer.appendChild(groupEl);
```

}
}

function formatValue(value, step) {
const decimals = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 0;
return value.toFixed(decimals);
}

// ==========================================
// VOICE GRID
// ==========================================
function buildVoiceGrid() {
voiceGrid.innerHTML = “”;

for (let i = 0; i < 6; i++) {
const card = document.createElement(“div”);
card.className = “voice-card”;
card.dataset.voice = i;

```
const title = document.createElement("h3");
title.textContent = `V${i + 1}`;
card.appendChild(title);

const freq = document.createElement("div");
freq.className = "freq";
freq.textContent = "—";
card.appendChild(freq);

const note = document.createElement("div");
note.className = "note";
note.textContent = "";
card.appendChild(note);

voiceGrid.appendChild(card);
```

}
}

function updateVoiceGrid() {
for (let i = 0; i < 6; i++) {
const card = voiceGrid.querySelector(`[data-voice="${i}"]`);
if (!card) continue;

```
const voice = engine.seq.voices[i];
const freqEl = card.querySelector(".freq");
const noteEl = card.querySelector(".note");

if (voice.gate) {
  card.classList.add("active");
  freqEl.textContent = `${voice.freq.toFixed(1)} Hz`;
  noteEl.textContent = freqToNote(voice.freq);
} else {
  card.classList.remove("active");
  freqEl.textContent = "—";
  noteEl.textContent = "";
}
```

}
}

function freqToNote(freq) {
const noteNames = [“C”, “C#”, “D”, “D#”, “E”, “F”, “F#”, “G”, “G#”, “A”, “A#”, “B”];
const a4 = 440;
const c0 = a4 * Math.pow(2, -4.75);
const halfSteps = Math.round(12 * Math.log2(freq / c0));
const octave = Math.floor(halfSteps / 12);
const note = noteNames[halfSteps % 12];
return `${note}${octave}`;
}

// ==========================================
// HISTORY TRAIL
// ==========================================
const history = [];

function updateHistory() {
const state = {
root: engine.seq.rootNote,
register: engine.seq.turingRegister.toString(2).padStart(16, “0”),
scale: engine.seq.currentScale.name,
};

history.unshift(state);
if (history.length > 3) {
history.pop();
}

const lines = globalTrail.querySelectorAll(”.trail-line”);

for (let i = 0; i < 3; i++) {
if (history[i]) {
const s = history[i];
lines[i].textContent = `Root: ${s.root} | Register: ${s.register} | Scale: ${s.scale}`;
} else {
lines[i].textContent = “”;
}
}
}

// ==========================================
// STATUS UPDATE
// ==========================================
function updateStatus() {
if (engine.running) {
statusSpan.textContent = “Running”;
statusSpan.style.color = “var(–accent)”;
} else if (audioUnlocked) {
statusSpan.textContent = “Ready”;
statusSpan.style.color = “var(–primary)”;
} else {
statusSpan.textContent = “Idle (tap Start to unlock audio)”;
statusSpan.style.color = “var(–text-dim)”;
}
}

// ==========================================
// CONTROLS
// ==========================================
startBtn.addEventListener(“click”, async () => {
// CRITICAL: Unlock audio on first user gesture
await unlockAudio();

await engine.start();

startBtn.disabled = true;
stopBtn.disabled = false;
nudgeBtn.disabled = false;

updateStatus();

// Start UI update loop
if (uiUpdateInterval) {
clearInterval(uiUpdateInterval);
}
uiUpdateInterval = setInterval(() => {
updateVoiceGrid();
}, 100);

// Register cycle callback
engine.onCycle = () => {
updateHistory();
};
});

stopBtn.addEventListener(“click”, () => {
engine.stop();

startBtn.disabled = false;
stopBtn.disabled = true;
nudgeBtn.disabled = true;

updateStatus();

if (uiUpdateInterval) {
clearInterval(uiUpdateInterval);
uiUpdateInterval = null;
}
});

nudgeBtn.addEventListener(“click”, () => {
engine.seq.nudgeRoot();
updateHistory();
});

bpmSlider.addEventListener(“input”, (e) => {
const val = parseInt(e.target.value);
engine.setBpm(val);
bpmValue.textContent = val;
});

reverbSlider.addEventListener(“input”, (e) => {
const val = parseFloat(e.target.value);
engine.setReverbMix(val);
reverbValue.textContent = val.toFixed(2);
});

delaySlider.addEventListener(“input”, (e) => {
const val = parseFloat(e.target.value);
engine.setDelayMix(val);
delayValue.textContent = val.toFixed(2);
});

masterSlider.addEventListener(“input”, (e) => {
const val = parseFloat(e.target.value);
engine.setMaster(val);
masterValue.textContent = val.toFixed(2);
});

// ==========================================
// INIT
// ==========================================
initUI();

// iOS wake lock (optional, prevents screen sleep during long sessions)
if (“wakeLock” in navigator) {
let wakeLock = null;
startBtn.addEventListener(“click”, async () => {
try {
wakeLock = await navigator.wakeLock.request(“screen”);
console.log(“✓ Screen wake lock active”);
} catch (err) {
// Wake lock not critical, ignore errors
}
});
}
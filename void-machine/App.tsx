import { useState, useCallback, useRef, useEffect } from 'react';
import { PadButton } from './components/PadButton';
import { PotWheel } from './components/PotWheel';
import { Visualizer } from './components/Visualizer';
import {
  initAudio,
  startScreamVoice,
  startNoise,
  triggerDrum,
  setMacro,
  stopVoice,
  stopAll,
} from './components/audio-engine';

// Color palette - blood reds, industrial oranges, cold whites
const COLORS = {
  scream: { bg: '#8b0000', glow: '#ff2222' },
  noise: { bg: '#7a3800', glow: '#ff8800' },
  drums: { bg: '#1a1a3a', glow: '#8888ff' },
  accent: '#ff3333',
};

const SCREAM_LABELS = ['I', 'II', 'III', 'IV'];
const SCREAM_NOTES = ['GROWL', 'GUT', 'BARK', 'SCREAM'];

const NOISE_LABELS = ['SCREECH', 'RUMBLE', 'SHRED', 'DRONE'];

const DRUM_LABELS = ['SEISMIC', 'DETONATE', 'TECTONIC', 'CATACLYSM'];
const DRUM_SUBS = ['Sub Drop', 'Metal Burst', 'Grinding', 'Max Destroy'];

const SCREAM_KEYS = ['q', 'w', 'e', 'r'];
const NOISE_KEYS = ['a', 's', 'd', 'f'];
const DRUM_KEYS = ['z', 'x', 'c', 'v'];

export default function App() {
  const [initialized, setInitialized] = useState(false);
  const [activeVoices, setActiveVoices] = useState(0);
  const activeCountRef = useRef(0);

  const trackVoice = useCallback((delta: number) => {
    activeCountRef.current = Math.max(0, activeCountRef.current + delta);
    setActiveVoices(activeCountRef.current);
  }, []);

  const handleInit = useCallback(() => {
    initAudio();
    setInitialized(true);
  }, []);

  // Handle scream press
  const handleScreamPress = useCallback((index: number) => {
    if (!initialized) return '';
    trackVoice(1);
    return startScreamVoice(index);
  }, [initialized, trackVoice]);

  // Handle scream release
  const handleScreamRelease = useCallback((id: string) => {
    stopVoice(id);
    trackVoice(-1);
  }, [trackVoice]);

  // Handle noise press
  const handleNoisePress = useCallback((index: number) => {
    if (!initialized) return '';
    trackVoice(1);
    return startNoise(index);
  }, [initialized, trackVoice]);

  // Handle noise release
  const handleNoiseRelease = useCallback((id: string) => {
    stopVoice(id);
    trackVoice(-1);
  }, [trackVoice]);

  // Handle drum trigger
  const handleDrumTrigger = useCallback((index: number) => {
    if (!initialized) return;
    trackVoice(1);
    triggerDrum(index);
    setTimeout(() => trackVoice(-1), 500);
  }, [initialized, trackVoice]);

  // Handle macro
  const handleMacro = useCallback((value: number) => {
    setMacro(value);
  }, []);

  // Handle stop all
  const handleStopAll = useCallback(() => {
    stopAll();
    activeCountRef.current = 0;
    setActiveVoices(0);
  }, []);

  // Keyboard: space = stop all
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && initialized) {
        e.preventDefault();
        handleStopAll();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [initialized, handleStopAll]);

  if (!initialized) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-8"
        style={{ background: '#050505' }}
      >
        {/* Title */}
        <div className="text-center">
          <h1
            className="tracking-[0.4em] uppercase mb-2"
            style={{
              color: '#ff2222',
              fontSize: '2.5rem',
              textShadow: '0 0 40px rgba(255,34,34,0.3)',
              fontFamily: 'monospace',
            }}
          >
            MACHINA
          </h1>
          <p
            className="tracking-[0.3em] uppercase"
            style={{ color: '#444', fontSize: '0.65rem' }}
          >
            Industrial Noise Instrument
          </p>
        </div>

        {/* Glitch lines */}
        <div className="w-64 h-px relative overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, transparent, #ff222244, transparent)',
            }}
          />
        </div>

        <button
          onClick={handleInit}
          className="px-12 py-4 uppercase tracking-[0.3em] cursor-pointer transition-all duration-200 hover:scale-105"
          style={{
            background: 'transparent',
            border: '1px solid #ff222266',
            color: '#ff2222',
            fontSize: '0.75rem',
            boxShadow: '0 0 30px rgba(255,34,34,0.1)',
            fontFamily: 'monospace',
          }}
        >
          Initialize Audio Engine
        </button>

        <p style={{ color: '#333', fontSize: '0.55rem', letterSpacing: '0.2em' }}>
          CLICK TO ACTIVATE • USE HEADPHONES FOR BEST EXPERIENCE
        </p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: '#050505',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-4">
          <h1
            className="tracking-[0.3em] uppercase"
            style={{
              color: '#ff2222',
              fontSize: '1rem',
              textShadow: '0 0 20px rgba(255,34,34,0.2)',
            }}
          >
            MACHINA
          </h1>
          <span style={{ color: '#333', fontSize: '0.55rem', letterSpacing: '0.15em' }}>
            v2.0 // INDUSTRIAL NOISE ENGINE
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Activity indicator */}
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: activeVoices > 0 ? '#ff2222' : '#333',
                boxShadow: activeVoices > 0 ? '0 0 8px #ff2222' : 'none',
                transition: 'all 0.1s',
              }}
            />
            <span style={{ color: '#555', fontSize: '0.55rem', letterSpacing: '0.1em' }}>
              {activeVoices} ACTIVE
            </span>
          </div>

          <button
            onClick={handleStopAll}
            className="px-4 py-1.5 uppercase tracking-[0.2em] cursor-pointer transition-all hover:border-[#ff2222]"
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#666',
              fontSize: '0.55rem',
            }}
          >
            Kill All [SPACE]
          </button>
        </div>
      </header>

      {/* Visualizer */}
      <div className="px-6 py-3">
        <Visualizer activeCount={activeVoices} color={COLORS.accent} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 px-6 py-4">
        {/* Pad grid */}
        <div className="flex-1 flex flex-col gap-6">
          {/* SCREAM SECTION */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: COLORS.scream.glow }} />
              <span
                className="uppercase tracking-[0.25em]"
                style={{ color: COLORS.scream.glow, fontSize: '0.6rem', opacity: 0.8 }}
              >
                Scream Synth — Noise + Formants + Distortion
              </span>
              <div className="flex-1 h-px" style={{ background: `${COLORS.scream.glow}15` }} />
              <span style={{ color: '#333', fontSize: '0.5rem', letterSpacing: '0.1em' }}>
                HOLD OR DOUBLE-TAP TO LOCK
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {SCREAM_LABELS.map((label, i) => (
                <PadButton
                  key={`scream-${i}`}
                  label={label}
                  sublabel={SCREAM_NOTES[i]}
                  color={COLORS.scream.bg}
                  glowColor={COLORS.scream.glow}
                  onPress={() => handleScreamPress(i)}
                  onRelease={handleScreamRelease}
                  isHold={true}
                  canToggle={true}
                  keyBind={SCREAM_KEYS[i]}
                />
              ))}
            </div>
          </div>

          {/* NOISE SECTION */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: COLORS.noise.glow }} />
              <span
                className="uppercase tracking-[0.25em]"
                style={{ color: COLORS.noise.glow, fontSize: '0.6rem', opacity: 0.8 }}
              >
                Noise Generators — Filtered &amp; Distorted
              </span>
              <div className="flex-1 h-px" style={{ background: `${COLORS.noise.glow}15` }} />
              <span style={{ color: '#333', fontSize: '0.5rem', letterSpacing: '0.1em' }}>
                HOLD OR DOUBLE-TAP TO LOCK
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {NOISE_LABELS.map((label, i) => (
                <PadButton
                  key={`noise-${i}`}
                  label={label}
                  color={COLORS.noise.bg}
                  glowColor={COLORS.noise.glow}
                  onPress={() => handleNoisePress(i)}
                  onRelease={handleNoiseRelease}
                  isHold={true}
                  canToggle={true}
                  keyBind={NOISE_KEYS[i]}
                />
              ))}
            </div>
          </div>

          {/* DRUMS SECTION */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: COLORS.drums.glow }} />
              <span
                className="uppercase tracking-[0.25em]"
                style={{ color: COLORS.drums.glow, fontSize: '0.6rem', opacity: 0.8 }}
              >
                Percussion — Industrial Hits
              </span>
              <div className="flex-1 h-px" style={{ background: `${COLORS.drums.glow}15` }} />
              <span style={{ color: '#333', fontSize: '0.5rem', letterSpacing: '0.1em' }}>
                TAP TO TRIGGER
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {DRUM_LABELS.map((label, i) => (
                <PadButton
                  key={`drum-${i}`}
                  label={label}
                  sublabel={DRUM_SUBS[i]}
                  color={COLORS.drums.bg}
                  glowColor={COLORS.drums.glow}
                  onPress={() => { handleDrumTrigger(i); return undefined as unknown as string; }}
                  isHold={false}
                  keyBind={DRUM_KEYS[i]}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right panel - Pot wheel & info */}
        <div className="lg:w-56 flex flex-col items-center gap-6 lg:border-l lg:border-[#1a1a1a] lg:pl-6">
          {/* Global Macro Pot */}
          <div className="flex flex-col items-center gap-2">
            <span
              className="uppercase tracking-[0.3em]"
              style={{ color: '#555', fontSize: '0.5rem' }}
            >
              Global Macro
            </span>
            <PotWheel
              label="Destroy"
              onChange={handleMacro}
              initialValue={0.5}
              color={COLORS.accent}
            />
            <div
              className="text-center mt-2 px-3 py-2 rounded"
              style={{
                background: '#0a0a0a',
                border: '1px solid #1a1a1a',
              }}
            >
              <p style={{ color: '#444', fontSize: '0.5rem', letterSpacing: '0.1em', lineHeight: 1.6 }}>
                FILTER CUTOFF<br />
                DISTORTION<br />
                RESONANCE
              </p>
            </div>
          </div>

          {/* Separator */}
          <div className="w-full h-px" style={{ background: '#1a1a1a' }} />

          {/* Key map */}
          <div className="w-full">
            <span
              className="uppercase tracking-[0.2em] block mb-3"
              style={{ color: '#444', fontSize: '0.5rem' }}
            >
              Keyboard Map
            </span>

            <div className="flex flex-col gap-2">
              <KeyMapRow label="SCREAM" keys={['Q', 'W', 'E', 'R']} color={COLORS.scream.glow} />
              <KeyMapRow label="NOISE" keys={['A', 'S', 'D', 'F']} color={COLORS.noise.glow} />
              <KeyMapRow label="DRUMS" keys={['Z', 'X', 'C', 'V']} color={COLORS.drums.glow} />
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded"
                  style={{
                    background: '#ffffff08',
                    border: '1px solid #ffffff15',
                    color: '#555',
                    fontSize: '0.5rem',
                  }}
                >
                  SPACE
                </span>
                <span style={{ color: '#333', fontSize: '0.45rem', letterSpacing: '0.1em' }}>
                  KILL ALL
                </span>
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="w-full h-px" style={{ background: '#1a1a1a' }} />

          {/* Info */}
          <div className="w-full">
            <span
              className="uppercase tracking-[0.2em] block mb-2"
              style={{ color: '#444', fontSize: '0.5rem' }}
            >
              Signal Path
            </span>
            <div
              className="flex flex-col gap-1"
              style={{ color: '#333', fontSize: '0.45rem', letterSpacing: '0.1em', lineHeight: 1.8 }}
            >
              <span>WHITE NOISE → BANDPASS</span>
              <span style={{ color: '#222' }}>↓</span>
              <span>DUAL STAGE DISTORTION</span>
              <span style={{ color: '#222' }}>↓</span>
              <span>MASTER FILTER (MACRO)</span>
              <span style={{ color: '#222' }}>↓</span>
              <span>MASTER DISTORTION</span>
              <span style={{ color: '#222' }}>↓</span>
              <span>COMPRESSOR</span>
              <span style={{ color: '#222' }}>↓</span>
              <span>CATHEDRAL REVERB</span>
              <span style={{ color: '#222' }}>↓</span>
              <span style={{ color: '#ff222266' }}>OUTPUT</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="px-6 py-3 flex items-center justify-between border-t border-[#1a1a1a]"
      >
        <span style={{ color: '#222', fontSize: '0.5rem', letterSpacing: '0.15em' }}>
          INSPIRED BY AUTHOR &amp; PUNISHER
        </span>
        <span style={{ color: '#222', fontSize: '0.5rem', letterSpacing: '0.15em' }}>
          WEB AUDIO API // ALL SYNTHESIS REAL-TIME
        </span>
      </footer>
    </div>
  );
}

function KeyMapRow({ label, keys, color }: { label: string; keys: string[]; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-14 uppercase tracking-[0.1em]"
        style={{ color: `${color}66`, fontSize: '0.45rem' }}
      >
        {label}
      </span>
      <div className="flex gap-1">
        {keys.map(k => (
          <span
            key={k}
            className="w-5 h-5 flex items-center justify-center rounded"
            style={{
              background: `${color}10`,
              border: `1px solid ${color}25`,
              color: `${color}66`,
              fontSize: '0.5rem',
            }}
          >
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}
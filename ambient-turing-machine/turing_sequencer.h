// turing_sequencer.h
// Turing Sequencer — Platform-Independent Sequencer Logic
// All note computation, gate patterns, follower rules, and state management.
// No audio or hardware dependencies — pure logic.
// Used by both the Daisy firmware and the HTML/Web Audio test harness.

#ifndef TURING_SEQUENCER_H
#define TURING_SEQUENCER_H

#include <cmath>
#include <cstdint>

namespace turing {

// =============================================
// MUSIC THEORY CONSTANTS
// =============================================

// Chromatic note names (for display/debug only)
static const char* NOTE_NAMES[] = {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
};

// Major scale intervals in semitones from root
static const int MAJOR_SCALE[] = {0, 2, 4, 5, 7, 9, 11};

// Circle of fifths as chromatic indices (C=0, G=7, D=2, A=9, ...)
static const int CIRCLE_OF_FIFTHS[] = {0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5};

// =============================================
// VOICE STRUCTURE
// =============================================

struct Voice {
    float freq;         // Current frequency in Hz
    int   midi_note;    // Current MIDI note number
    int   degree;       // Scale degree (can drift beyond 0-6 for followers)
    int   octave;       // Base octave
    bool  gate;         // Is this voice gated ON this cycle?
    bool  prev_gate;    // Was this voice gated ON last cycle?
    bool  active;       // Is sound currently being produced? (for LED display)

    // For display/debug
    int   note_index;   // Chromatic note index 0-11
    int   final_octave; // Actual octave after degree overflow
};

// =============================================
// SEQUENCER STATE
// =============================================

struct SequencerState {
    uint32_t cycle;             // Global cycle counter
    Voice    voices[6];         // All 6 voices

    // Frozen follower degrees — only update on trigger
    int frozen_v2_degree;       // Voice 2 (Mirror)
    int frozen_v4_degree;       // Voice 4 (Wanderer)
    int frozen_v6_degree;       // Voice 6 (Echo)
    int prev_v4_degree_for_echo; // V4's degree before update, for V6

    // Voice 5 history
    int v5_history[2];          // [current, previous] scale degrees

    // Tracking
    int last_v2_trigger_cycle;  // When V2 last fired

    // Current root
    int root_chromatic;         // 0-11 chromatic index of current root
    int root_cycle_index;       // Position in circle of fifths (0-11)
};

// =============================================
// HELPER: Degree + Root + Octave → MIDI note
// =============================================

inline int degree_to_midi(int root_chromatic, int degree, int base_octave, int min_octave = -1) {
    // Normalize degree with octave overflow
    int oct_offset = 0;
    int norm_degree;

    if (degree >= 0) {
        oct_offset = degree / 7;
        norm_degree = degree % 7;
    } else {
        // Handle negative degrees: -1 → degree 6 one octave down
        oct_offset = (degree - 6) / 7; // floor division for negatives
        norm_degree = ((degree % 7) + 7) % 7;
    }

    int semitone_offset = MAJOR_SCALE[norm_degree];
    int midi = (base_octave + oct_offset) * 12 + root_chromatic + semitone_offset;

    // Clamp to min octave if specified
    if (min_octave >= 0) {
        int min_midi = min_octave * 12;
        while (midi < min_midi) {
            midi += 12;
        }
    }

    return midi;
}

// MIDI note to frequency
inline float midi_to_freq(int midi_note) {
    return 440.0f * powf(2.0f, (midi_note - 69) / 12.0f);
}

// Extract chromatic index and octave from MIDI note
inline void midi_to_note_info(int midi, int& note_index, int& octave) {
    octave = midi / 12;
    note_index = midi % 12;
    if (note_index < 0) { note_index += 12; octave--; }
}

// =============================================
// SEQUENCER INIT
// =============================================

inline void sequencer_init(SequencerState& s) {
    s.cycle = 0;
    s.frozen_v2_degree = 4;   // 5th scale degree
    s.frozen_v4_degree = 5;   // 6th scale degree
    s.frozen_v6_degree = 3;   // 4th scale degree
    s.prev_v4_degree_for_echo = 5;
    s.v5_history[0] = 0;
    s.v5_history[1] = 0;
    s.last_v2_trigger_cycle = -100;
    s.root_chromatic = 0;     // C
    s.root_cycle_index = 0;

    for (int i = 0; i < 6; i++) {
        s.voices[i].gate = false;
        s.voices[i].prev_gate = false;
        s.voices[i].active = false;
        s.voices[i].degree = 0;
        s.voices[i].octave = 3;
    }

    // Set initial notes
    s.voices[0].midi_note = degree_to_midi(0, 0, 3);  // C3
    s.voices[1].midi_note = degree_to_midi(0, 4, 3, 4); // G4 (clamped min oct 4)
    s.voices[2].midi_note = degree_to_midi(0, 2, 3);  // E3
    s.voices[3].midi_note = degree_to_midi(0, 5, 3, 4); // A4 (clamped min oct 4)
    s.voices[4].midi_note = degree_to_midi(0, 0, 4);  // C4
    s.voices[5].midi_note = degree_to_midi(0, 3, 4, 4); // F4 (clamped min oct 4)

    for (int i = 0; i < 6; i++) {
        s.voices[i].freq = midi_to_freq(s.voices[i].midi_note);
    }
}

// =============================================
// SEQUENCER TICK — Call once per cycle
// Returns: nothing. Updates all state in-place.
// The caller is responsible for reading voice states
// and triggering audio accordingly.
// =============================================

inline void sequencer_tick(SequencerState& s) {
    uint32_t cycle = s.cycle;

    // --- Save previous gates ---
    for (int i = 0; i < 6; i++) {
        s.voices[i].prev_gate = s.voices[i].gate;
    }

    // --- Compute current root ---
    s.root_cycle_index = (cycle / 12) % 12;
    s.root_chromatic = CIRCLE_OF_FIFTHS[s.root_cycle_index];

    int root = s.root_chromatic;

    // =============================================
    // COMPUTE GATES
    // =============================================

    bool gates[6] = {false, false, false, false, false, false};

    // Voice 1 (Root): 12-cycle period, ON for 0-9, OFF for 10-11
    gates[0] = (cycle % 12) < 10;

    // Voice 3 (Third): 7-cycle period, ON for 0-4, OFF for 5-6
    gates[2] = (cycle % 7) < 5;

    // Voice 5 (Scale Walker): 5-cycle period, ON for 0-3, OFF for 4
    gates[4] = (cycle % 5) < 4;

    // Voice 2 (Mirror): Every 3 cycles IF V5 was ON last cycle
    if (cycle % 3 == 0 && s.voices[4].prev_gate) {
        gates[1] = true;
        s.last_v2_trigger_cycle = cycle;
    }

    // Voice 4 (Wanderer): Every 5 cycles IF V2 triggered within last 2 cycles
    if (cycle % 5 == 0 && ((int)cycle - s.last_v2_trigger_cycle) <= 2) {
        gates[3] = true;
    }

    // Voice 6 (Echo): Every 4 cycles, always fires
    gates[5] = (cycle % 4) == 0;

    for (int i = 0; i < 6; i++) {
        s.voices[i].gate = gates[i];
    }

    // =============================================
    // COMPUTE DRONE NOTES
    // =============================================

    // Voice 1 (Root): Always degree 0, octave 3
    s.voices[0].degree = 0;
    s.voices[0].octave = 3;
    s.voices[0].midi_note = degree_to_midi(root, 0, 3);
    s.voices[0].freq = midi_to_freq(s.voices[0].midi_note);

    // Voice 3 (Third): Always degree 2 (major 3rd), octave 3
    s.voices[2].degree = 2;
    s.voices[2].octave = 3;
    s.voices[2].midi_note = degree_to_midi(root, 2, 3);
    s.voices[2].freq = midi_to_freq(s.voices[2].midi_note);

    // Voice 5 (Scale Walker): Walks degrees 0-6, changes every 3 cycles
    int v5_step = (cycle / 3) % 7;
    s.voices[4].degree = v5_step;
    // Octave rule: V3 ON → oct 4, V3 OFF → oct 3
    s.voices[4].octave = gates[2] ? 4 : 3;
    s.voices[4].midi_note = degree_to_midi(root, v5_step, s.voices[4].octave, 3);
    // Clamp max to octave 4 (MIDI 72 = C5)
    if (s.voices[4].midi_note >= 72) {
        s.voices[4].midi_note -= 12;
    }
    s.voices[4].freq = midi_to_freq(s.voices[4].midi_note);

    // V5 history
    int prev_v5 = s.v5_history[0];
    s.v5_history[1] = prev_v5;
    s.v5_history[0] = v5_step;

    // =============================================
    // COMPUTE FOLLOWER NOTES (only on trigger)
    // =============================================

    // --- Voice 2 (Mirror) ---
    if (gates[1]) {
        int v2_change = 0;
        if (v5_step > prev_v5)      v2_change = -1; // V5 up → V2 down
        else if (v5_step < prev_v5) v2_change = 1;  // V5 down → V2 up
        // else same → no change

        s.frozen_v2_degree += v2_change;
    }
    s.voices[1].degree = s.frozen_v2_degree;
    s.voices[1].octave = 3;
    s.voices[1].midi_note = degree_to_midi(root, s.frozen_v2_degree, 3, 4); // min octave 4
    s.voices[1].freq = midi_to_freq(s.voices[1].midi_note);

    // --- Voice 4 (Wanderer) ---
    s.prev_v4_degree_for_echo = s.frozen_v4_degree; // Save BEFORE update

    if (gates[3]) {
        bool v3_was_on = s.voices[2].prev_gate;
        bool v2_was_on = s.voices[1].prev_gate;

        int v4_change = 0;
        if (v3_was_on && v2_was_on)        v4_change = 1;   // Both on: +1
        else if (v3_was_on && !v2_was_on)   v4_change = -2;  // 3rd on, mirror off: -2
        else if (!v3_was_on && v2_was_on)   v4_change = 0;   // 3rd off, mirror on: hold
        else                                v4_change = 3;   // Both off: +3 (rare)

        s.frozen_v4_degree += v4_change;
    }
    s.voices[3].degree = s.frozen_v4_degree;
    s.voices[3].octave = 3;
    s.voices[3].midi_note = degree_to_midi(root, s.frozen_v4_degree, 3, 4); // min octave 4
    s.voices[3].freq = midi_to_freq(s.voices[3].midi_note);

    // --- Voice 6 (Echo) ---
    if (gates[5]) {
        s.frozen_v6_degree = s.prev_v4_degree_for_echo;
    }
    // Octave rule: V1 was ON → oct 4, V1 was OFF → oct 5
    bool v1_was_on = s.voices[0].prev_gate;
    int v6_octave = v1_was_on ? 4 : 5;
    // Clamp: don't exceed octave 5
    s.voices[5].degree = s.frozen_v6_degree;
    s.voices[5].octave = v6_octave;
    s.voices[5].midi_note = degree_to_midi(root, s.frozen_v6_degree, v6_octave, 4);
    if (s.voices[5].midi_note >= 84) { // C6 = too high
        s.voices[5].midi_note -= 12;
    }
    s.voices[5].freq = midi_to_freq(s.voices[5].midi_note);

    // --- Fill note info for all voices ---
    for (int i = 0; i < 6; i++) {
        midi_to_note_info(s.voices[i].midi_note, s.voices[i].note_index, s.voices[i].final_octave);
    }

    // --- Increment cycle ---
    s.cycle++;
}

// Utility: force root to next position (nudge button)
inline void sequencer_nudge_root(SequencerState& s) {
    uint32_t next = ((s.cycle / 12) + 1) * 12;
    s.cycle = next;
}

} // namespace turing

#endif // TURING_SEQUENCER_H

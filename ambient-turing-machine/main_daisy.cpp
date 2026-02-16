#include <cmath>
#include <cstdint>

#include "daisy_seed.h"
#include "daisysp.h"
#include "sample_data.h"
#include "turing_sequencer.h"

using namespace daisy;
using namespace daisysp;

DaisySeed hw;

struct DroneVoice {
    Oscillator osc1;
    Oscillator osc2;
    Svf        filter;
    Adsr       env;
    Oscillator filter_lfo;
    bool       env_gate;
    float      target_freq;
    float      current_freq;
    float      detune_cents;
    float      volume;
    float      base_filter_freq;
    float      lfo_depth;
};

struct SparkleVoice {
    StringVoice string;
    Oscillator  brightness_lfo;
    float       base_brightness;
    float       brightness_lfo_depth;
    float       volume;
    bool        triggered;
};

struct PadVoice {
    Oscillator osc1;
    Oscillator osc2;
    WhiteNoise noise;
    Svf        filter;
    Svf        noise_filter;
    Adsr       env;
    Oscillator vibrato_lfo;
    Oscillator decay_lfo;
    bool       env_gate;
    float      target_freq;
    float      current_freq;
    float      volume;
    float      noise_mix;
    float      vibrato_depth_cents;
    float      detune_cents;
};

struct SamplePlayer {
    float      phase;
    float      playback_rate;
    Svf        filter;
    Oscillator filter_lfo;
    float      base_filter_freq;
    float      lfo_depth;
    float      volume;
    float      fade_length;
};

struct DroneParams {
    float attack;
    float decay;
    float sustain;
    float release;
    float filter_freq;
    float filter_res;
    float detune_cents;
    float volume;
    float lfo_rate;
    float lfo_depth;
};

struct SparkleParams {
    float brightness;
    float brightness_lfo_rate;
    float brightness_lfo_depth;
    float structure;
    float damping;
    float accent;
    float volume;
};

static DroneVoice   drones[3];
static SparkleVoice sparkles[2];
static PadVoice     pad;
static SamplePlayer sampler;

static ReverbSc                 reverb;
static DelayLine<float, 96000> DSY_SDRAM_BSS delay_l;
static DelayLine<float, 96000> DSY_SDRAM_BSS delay_r;
static turing::SequencerState   seq;
static Led                      voice_leds[6];
static Switch                   root_button;

static float    sample_rate        = 48000.0f;
static float    cycle_duration_sec = 0.0f;
static uint32_t samples_per_cycle  = 0;
static uint32_t sample_counter     = 0;
static float    bpm                = 50.0f;
static float    bpm_smoothed       = 50.0f;

// Seed pin assignments:
// LEDs: D0-D5 (GPIO outputs, software PWM via daisy::Led)
// BPM pot: D21 (ADC12_INP4 / A6)
// Root-advance button (momentary): D14
// Audio out jacks use the dedicated Daisy Seed audio pins:
// pin 18 = AUDIO OUT L, pin 19 = AUDIO OUT R.
static const int LED_PIN_INDEX[6] = {0, 1, 2, 3, 4, 5};
static const int BPM_POT_PIN      = 21;
static const int ROOT_BUTTON_PIN  = 14;

static volatile bool  root_nudge_request = false;
static volatile float led_levels[6]      = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};

static const float FOLLOWER_TRIGGER_POINTS[3] = {0.4f, 0.1f, 0.7f};
static bool        follower_triggered_this_cycle[3] = {false, false, false};

static const DroneParams DRONE_PARAMS[3] = {
    {2.5f, 0.5f, 1.0f, 4.0f, 900.0f, 0.18f, 8.0f, 0.25f, 0.06f, 80.0f},
    {2.5f, 0.5f, 1.0f, 4.0f, 850.0f, 0.15f, 6.0f, 0.20f, 0.045f, 60.0f},
    {2.5f, 0.5f, 1.0f, 4.0f, 800.0f, 0.12f, 5.0f, 0.13f, 0.08f, 50.0f},
};

static const SparkleParams SPARKLE_PARAMS[2] = {
    {0.45f, 0.07f, 0.15f, 0.40f, 0.35f, 0.6f, 0.22f},
    {0.35f, 0.05f, 0.12f, 0.35f, 0.28f, 0.5f, 0.18f},
};

static const struct {
    float attack;
    float min_decay;
    float max_decay;
    float sustain;
    float release;
    float filter_freq;
    float filter_res;
    float noise_filter_freq;
    float noise_mix;
    float detune_cents;
    float vibrato_rate;
    float vibrato_depth;
    float decay_lfo_rate;
    float volume;
} PAD_PARAMS = {
    1.2f,
    1.0f,
    4.0f,
    0.4f,
    6.0f,
    700.0f,
    0.12f,
    2200.0f,
    0.10f,
    18.0f,
    5.2f,
    4.0f,
    0.03f,
    0.15f,
};

static const float SAMPLE_FILTER_FREQ      = 1200.0f;
static const float SAMPLE_FILTER_LFO_RATE  = 0.012f;
static const float SAMPLE_FILTER_LFO_DEPTH = 180.0f;
static const float SAMPLE_VOLUME           = 0.08f;
static const float SAMPLE_FADE_SAMPLES     = 2400.0f;

static float reverb_feedback = 0.90f;
static float reverb_lpfreq   = 6500.0f;
static float delay_time_sec  = 0.85f;
static float delay_feedback  = 0.25f;

static const float DRONE_DRY      = 1.0f;
static const float DRONE_DELAY    = 0.05f;
static const float DRONE_REVERB   = 0.08f;
static const float SPARKLE_DRY    = 0.60f;
static const float SPARKLE_DELAY  = 0.35f;
static const float SPARKLE_REVERB = 0.50f;
static const float PAD_DRY        = 0.80f;
static const float PAD_DELAY      = 0.15f;
static const float PAD_REVERB     = 0.30f;

static inline float Clampf(float x, float lo, float hi) {
    return fmaxf(lo, fminf(hi, x));
}

void InitSynth() {
    sample_rate = hw.AudioSampleRate();

    for (int i = 0; i < 3; i++) {
        auto& d = drones[i];
        auto& p = DRONE_PARAMS[i];

        d.osc1.Init(sample_rate);
        d.osc1.SetWaveform(Oscillator::WAVE_POLYBLEP_SAW);
        d.osc1.SetAmp(1.0f);

        d.osc2.Init(sample_rate);
        d.osc2.SetWaveform(Oscillator::WAVE_POLYBLEP_SAW);
        d.osc2.SetAmp(1.0f);

        d.filter.Init(sample_rate);
        d.filter.SetFreq(p.filter_freq);
        d.filter.SetRes(p.filter_res);

        d.env.Init(sample_rate);
        d.env.SetTime(ADSR_SEG_ATTACK, p.attack);
        d.env.SetTime(ADSR_SEG_DECAY, p.decay);
        d.env.SetSustainLevel(p.sustain);
        d.env.SetTime(ADSR_SEG_RELEASE, p.release);

        d.filter_lfo.Init(sample_rate);
        d.filter_lfo.SetWaveform(Oscillator::WAVE_TRI);
        d.filter_lfo.SetFreq(p.lfo_rate);
        d.filter_lfo.SetAmp(1.0f);

        d.env_gate         = false;
        d.target_freq      = 130.81f;
        d.current_freq     = 130.81f;
        d.detune_cents     = p.detune_cents;
        d.volume           = p.volume;
        d.base_filter_freq = p.filter_freq;
        d.lfo_depth        = p.lfo_depth;
    }

    for (int i = 0; i < 2; i++) {
        auto& sp = sparkles[i];
        auto& p  = SPARKLE_PARAMS[i];

        sp.string.Init(sample_rate);
        sp.string.SetFreq(440.0f);
        sp.string.SetStructure(p.structure);
        sp.string.SetBrightness(p.brightness);
        sp.string.SetDamping(p.damping);
        sp.string.SetAccent(p.accent);
        sp.string.SetSustain(false);

        sp.brightness_lfo.Init(sample_rate);
        sp.brightness_lfo.SetWaveform(Oscillator::WAVE_TRI);
        sp.brightness_lfo.SetFreq(p.brightness_lfo_rate);
        sp.brightness_lfo.SetAmp(1.0f);

        sp.base_brightness      = p.brightness;
        sp.brightness_lfo_depth = p.brightness_lfo_depth;
        sp.volume               = p.volume;
        sp.triggered            = false;
    }

    pad.osc1.Init(sample_rate);
    pad.osc1.SetWaveform(Oscillator::WAVE_TRI);
    pad.osc1.SetAmp(1.0f);

    pad.osc2.Init(sample_rate);
    pad.osc2.SetWaveform(Oscillator::WAVE_TRI);
    pad.osc2.SetAmp(1.0f);

    pad.noise.Init();

    pad.noise_filter.Init(sample_rate);
    pad.noise_filter.SetFreq(PAD_PARAMS.noise_filter_freq);
    pad.noise_filter.SetRes(0.3f);

    pad.filter.Init(sample_rate);
    pad.filter.SetFreq(PAD_PARAMS.filter_freq);
    pad.filter.SetRes(PAD_PARAMS.filter_res);

    pad.env.Init(sample_rate);
    pad.env.SetTime(ADSR_SEG_ATTACK, PAD_PARAMS.attack);
    pad.env.SetTime(ADSR_SEG_DECAY, PAD_PARAMS.min_decay);
    pad.env.SetSustainLevel(PAD_PARAMS.sustain);
    pad.env.SetTime(ADSR_SEG_RELEASE, PAD_PARAMS.release);

    pad.vibrato_lfo.Init(sample_rate);
    pad.vibrato_lfo.SetWaveform(Oscillator::WAVE_SIN);
    pad.vibrato_lfo.SetFreq(PAD_PARAMS.vibrato_rate);
    pad.vibrato_lfo.SetAmp(1.0f);

    pad.decay_lfo.Init(sample_rate);
    pad.decay_lfo.SetWaveform(Oscillator::WAVE_TRI);
    pad.decay_lfo.SetFreq(PAD_PARAMS.decay_lfo_rate);
    pad.decay_lfo.SetAmp(1.0f);

    pad.env_gate           = false;
    pad.target_freq        = 349.23f;
    pad.current_freq       = 349.23f;
    pad.volume             = PAD_PARAMS.volume;
    pad.noise_mix          = PAD_PARAMS.noise_mix;
    pad.vibrato_depth_cents = PAD_PARAMS.vibrato_depth;
    pad.detune_cents       = PAD_PARAMS.detune_cents;

    sampler.phase         = 0.0f;
    sampler.playback_rate = 1.0f;
    sampler.filter.Init(sample_rate);
    sampler.filter.SetFreq(SAMPLE_FILTER_FREQ);
    sampler.filter.SetRes(0.08f);
    sampler.filter_lfo.Init(sample_rate);
    sampler.filter_lfo.SetWaveform(Oscillator::WAVE_TRI);
    sampler.filter_lfo.SetFreq(SAMPLE_FILTER_LFO_RATE);
    sampler.filter_lfo.SetAmp(1.0f);
    sampler.base_filter_freq = SAMPLE_FILTER_FREQ;
    sampler.lfo_depth        = SAMPLE_FILTER_LFO_DEPTH;
    sampler.volume           = SAMPLE_VOLUME;
    sampler.fade_length      = SAMPLE_FADE_SAMPLES;

    reverb.Init(sample_rate);
    reverb.SetFeedback(reverb_feedback);
    reverb.SetLpFreq(reverb_lpfreq);

    delay_l.Init();
    delay_r.Init();
    delay_l.SetDelay(delay_time_sec * sample_rate);
    delay_r.SetDelay((delay_time_sec + 0.018f) * sample_rate);

    turing::sequencer_init(seq);

    cycle_duration_sec = 60.0f / bpm * 4.0f;
    samples_per_cycle  = static_cast<uint32_t>(cycle_duration_sec * sample_rate);
    sample_counter     = 0;

    for(int i = 0; i < 3; i++) {
        follower_triggered_this_cycle[i] = false;
    }
}

void ProcessCycleTick() {
    if(root_nudge_request) {
        turing::sequencer_nudge_root(seq);
        root_nudge_request = false;
    }

    turing::sequencer_tick(seq);

    const int drone_voice_map[3] = {0, 2, 4};
    for(int di = 0; di < 3; di++) {
        auto& voice = seq.voices[drone_voice_map[di]];
        auto& drone = drones[di];

        if(voice.gate) {
            if(!voice.prev_gate) {
                drone.target_freq  = voice.freq;
                drone.current_freq = voice.freq;
                drone.env_gate     = true;
            } else if(fabsf(voice.freq - drone.current_freq) > 0.1f) {
                drone.target_freq  = voice.freq;
                drone.current_freq = voice.freq;
            }
        } else if(voice.prev_gate) {
            drone.env_gate = false;
        }
    }

    for(int i = 0; i < 3; i++) {
        follower_triggered_this_cycle[i] = false;
    }

    sparkles[0].triggered = false;
    sparkles[1].triggered = false;
}

void CheckFollowerTriggers(uint32_t sample_in_cycle) {
    const float progress = static_cast<float>(sample_in_cycle) / static_cast<float>(samples_per_cycle);
    const int   follower_voice_map[3] = {1, 3, 5};

    for(int fi = 0; fi < 3; fi++) {
        if(follower_triggered_this_cycle[fi]) {
            continue;
        }

        if(progress >= FOLLOWER_TRIGGER_POINTS[fi]) {
            auto& voice = seq.voices[follower_voice_map[fi]];

            if(voice.gate) {
                if(fi < 2) {
                    auto& sp = sparkles[fi];
                    sp.string.SetFreq(voice.freq);

                    float lfo_val = sp.brightness_lfo.Process();
                    float brightness = sp.base_brightness + (lfo_val * sp.brightness_lfo_depth);
                    brightness = Clampf(brightness, 0.1f, 0.8f);
                    sp.string.SetBrightness(brightness);

                    float rand = static_cast<float>(hw.system.GetNow() % 1000) / 1000.0f;
                    sp.volume = SPARKLE_PARAMS[fi].volume * (0.6f + 0.8f * rand);

                    sp.string.Trig();
                    sp.triggered = true;
                } else {
                    pad.target_freq  = voice.freq;
                    pad.current_freq = voice.freq;

                    float decay_lfo_val  = pad.decay_lfo.Process();
                    float decay_norm     = (decay_lfo_val + 1.0f) * 0.5f;
                    float decay_time     = PAD_PARAMS.min_decay + decay_norm * (PAD_PARAMS.max_decay - PAD_PARAMS.min_decay);
                    pad.env.SetTime(ADSR_SEG_DECAY, decay_time);

                    pad.env_gate = true;
                }
            }

            follower_triggered_this_cycle[fi] = true;
        }
    }
}

void AudioCallback(AudioHandle::InterleavingInputBuffer in,
                   AudioHandle::InterleavingOutputBuffer out,
                   size_t size) {
    static const float led_trail_weight[6] = {0.22f, 0.80f, 0.18f, 0.80f, 0.16f, 0.48f};
    (void)in;

    for(size_t i = 0; i < size; i += 2) {
        if(sample_counter >= samples_per_cycle) {
            sample_counter = 0;
            ProcessCycleTick();
        }

        CheckFollowerTriggers(sample_counter);

        const uint32_t pad_gate_samples = static_cast<uint32_t>(0.3f * sample_rate);
        if(pad.env_gate && follower_triggered_this_cycle[2]) {
            const uint32_t trigger_sample = static_cast<uint32_t>(FOLLOWER_TRIGGER_POINTS[2] * samples_per_cycle);
            if(sample_counter > trigger_sample + pad_gate_samples) {
                pad.env_gate = false;
            }
        }

        float drone_bus_l = 0.0f;
        float drone_bus_r = 0.0f;
        float sparkle_bus_l = 0.0f;
        float sparkle_bus_r = 0.0f;
        float pad_bus_l = 0.0f;
        float pad_bus_r = 0.0f;
        float voice_level[6] = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};

        for(int di = 0; di < 3; di++) {
            auto& d = drones[di];
            const int voice_idx = (di == 0) ? 0 : (di == 1) ? 2 : 4;

            float lfo_val = d.filter_lfo.Process();
            float cutoff  = d.base_filter_freq + (lfo_val * d.lfo_depth);
            cutoff = Clampf(cutoff, 200.0f, 2000.0f);
            d.filter.SetFreq(cutoff);

            d.osc1.SetFreq(d.current_freq);
            const float detune_ratio = powf(2.0f, d.detune_cents / 1200.0f);
            d.osc2.SetFreq(d.current_freq * detune_ratio);

            float sig = (d.osc1.Process() + d.osc2.Process()) * 0.5f;
            d.filter.Process(sig);
            sig = d.filter.Low();

            const float amp = d.env.Process(d.env_gate);
            sig *= amp * d.volume;
            voice_level[voice_idx] += fabsf(sig);

            drone_bus_l += sig;
            drone_bus_r += sig;
        }

        for(int si = 0; si < 2; si++) {
            auto& sp = sparkles[si];
            const int voice_idx = (si == 0) ? 1 : 3;
            sp.brightness_lfo.Process();

            float sig = sp.string.Process();
            sig *= sp.volume;
            voice_level[voice_idx] += fabsf(sig);

            sparkle_bus_l += sig;
            sparkle_bus_r += sig;
        }

        {
            auto& p = pad;
            p.decay_lfo.Process();

            const float vib = p.vibrato_lfo.Process();
            const float vib_ratio = powf(2.0f, (vib * p.vibrato_depth_cents) / 1200.0f);
            const float freq_with_vibrato = p.current_freq * vib_ratio;

            p.osc1.SetFreq(freq_with_vibrato);
            const float detune_ratio = powf(2.0f, p.detune_cents / 1200.0f);
            p.osc2.SetFreq(freq_with_vibrato * detune_ratio);

            const float osc_sig = (p.osc1.Process() + p.osc2.Process()) * 0.5f;

            const float raw_noise = p.noise.Process();
            p.noise_filter.Process(raw_noise);
            const float shaped_noise = p.noise_filter.Band();

            float sig = osc_sig * (1.0f - p.noise_mix) + shaped_noise * p.noise_mix;

            p.filter.Process(sig);
            sig = p.filter.Low();

            const float amp = p.env.Process(p.env_gate);
            sig *= amp * p.volume;
            voice_level[5] += fabsf(sig);

            pad_bus_l += sig;
            pad_bus_r += sig;
        }

        {
            const uint32_t sample_len = sample_data_length;
            if(sample_len > 1u) {
                const uint32_t idx = static_cast<uint32_t>(sampler.phase);
                const float frac   = sampler.phase - static_cast<float>(idx);

                const uint32_t idx0 = idx % sample_len;
                const uint32_t idx1 = (idx + 1u) % sample_len;

                const float s0 = static_cast<float>(sample_data[idx0]) / 32768.0f;
                const float s1 = static_cast<float>(sample_data[idx1]) / 32768.0f;
                float raw      = s0 + frac * (s1 - s0);

                const float dist_to_end    = static_cast<float>(sample_len - idx0);
                const float dist_from_start = static_cast<float>(idx0);
                float fade = 1.0f;

                if(dist_to_end < sampler.fade_length) {
                    fade = dist_to_end / sampler.fade_length;
                }
                if(dist_from_start < sampler.fade_length) {
                    const float fade_in = dist_from_start / sampler.fade_length;
                    if(fade_in < fade) {
                        fade = fade_in;
                    }
                }

                raw *= fade;

                const float lfo_val = sampler.filter_lfo.Process();
                float cutoff = sampler.base_filter_freq + (lfo_val * sampler.lfo_depth);
                cutoff = Clampf(cutoff, 300.0f, 2500.0f);
                sampler.filter.SetFreq(cutoff);

                sampler.filter.Process(raw);
                const float sample_sig = sampler.filter.Low() * sampler.volume;

                drone_bus_l += sample_sig;
                drone_bus_r += sample_sig;

                sampler.phase += sampler.playback_rate;
                if(sampler.phase >= static_cast<float>(sample_len)) {
                    sampler.phase -= static_cast<float>(sample_len);
                }
            }
        }

        const float dry_l = drone_bus_l * DRONE_DRY + sparkle_bus_l * SPARKLE_DRY + pad_bus_l * PAD_DRY;
        const float dry_r = drone_bus_r * DRONE_DRY + sparkle_bus_r * SPARKLE_DRY + pad_bus_r * PAD_DRY;

        const float delay_input_l = drone_bus_l * DRONE_DELAY + sparkle_bus_l * SPARKLE_DELAY + pad_bus_l * PAD_DELAY;
        const float delay_input_r = drone_bus_r * DRONE_DELAY + sparkle_bus_r * SPARKLE_DELAY + pad_bus_r * PAD_DELAY;

        const float delay_read_l = delay_l.Read();
        const float delay_read_r = delay_r.Read();

        delay_l.Write(delay_input_l + delay_read_l * delay_feedback);
        delay_r.Write(delay_input_r + delay_read_r * delay_feedback);

        const float reverb_input_l = drone_bus_l * DRONE_REVERB + sparkle_bus_l * SPARKLE_REVERB
                                   + pad_bus_l * PAD_REVERB + delay_read_l * 0.3f;
        const float reverb_input_r = drone_bus_r * DRONE_REVERB + sparkle_bus_r * SPARKLE_REVERB
                                   + pad_bus_r * PAD_REVERB + delay_read_r * 0.3f;

        float rev_l = 0.0f;
        float rev_r = 0.0f;
        reverb.Process(reverb_input_l, reverb_input_r, &rev_l, &rev_r);

        const float final_l = dry_l + delay_read_l + rev_l;
        const float final_r = dry_r + delay_read_r + rev_r;

        const float trail = Clampf((fabsf(delay_read_l) + fabsf(delay_read_r) + fabsf(rev_l) + fabsf(rev_r)) * 0.20f, 0.0f, 1.0f);
        for(int vi = 0; vi < 6; vi++) {
            const float gate_boost = seq.voices[vi].gate ? 0.18f : 0.0f;
            const float target = Clampf(voice_level[vi] * 4.0f + gate_boost + trail * led_trail_weight[vi], 0.0f, 1.0f);
            const float current = led_levels[vi];
            const float coeff = (target > current) ? 0.08f : 0.0025f;
            led_levels[vi] = current + (target - current) * coeff;
        }

        out[i]     = Clampf(final_l, -1.0f, 1.0f);
        out[i + 1] = Clampf(final_r, -1.0f, 1.0f);

        sample_counter++;
    }
}

int main(void) {
    hw.Configure();
    hw.Init();
    hw.SetAudioBlockSize(48);
    hw.SetAudioSampleRate(SaiHandle::Config::SampleRate::SAI_48KHZ);

    InitSynth();

    for(int i = 0; i < 6; i++) {
        voice_leds[i].Init(hw.GetPin(LED_PIN_INDEX[i]), false, 1000.0f);
    }

    AdcChannelConfig adc_cfg;
    adc_cfg.InitSingle(hw.GetPin(BPM_POT_PIN));
    hw.adc.Init(&adc_cfg, 1);
    hw.adc.Start();

    root_button.Init(hw.GetPin(ROOT_BUTTON_PIN), 1000.0f);

    hw.StartAudio(AudioCallback);

    while(1) {
        root_button.Debounce();
        if(root_button.RisingEdge()) {
            root_nudge_request = true;
        }

        const float pot = hw.adc.GetFloat(0);
        const float bpm_target = 30.0f + pot * 90.0f;
        bpm_smoothed += (bpm_target - bpm_smoothed) * 0.02f;

        if(fabsf(bpm_smoothed - bpm) > 0.02f) {
            bpm = bpm_smoothed;
            cycle_duration_sec = 60.0f / bpm * 4.0f;
            samples_per_cycle = static_cast<uint32_t>(cycle_duration_sec * sample_rate);
        }

        for(int i = 0; i < 6; i++) {
            voice_leds[i].Set(Clampf(led_levels[i], 0.0f, 1.0f));
            voice_leds[i].Update();
        }

        hw.DelayMs(1);
    }
}

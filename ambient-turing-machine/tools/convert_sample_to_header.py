import argparse
import pathlib
import wave
import math


def read_wav_to_mono_float(path: pathlib.Path):
    with wave.open(str(path), "rb") as w:
        channels = w.getnchannels()
        sample_width = w.getsampwidth()
        sample_rate = w.getframerate()
        frame_count = w.getnframes()
        raw = w.readframes(frame_count)

    if sample_width not in (1, 2):
        raise ValueError(f"Unsupported sample width: {sample_width} bytes")

    samples_per_frame = channels
    total_samples = frame_count * samples_per_frame

    mono = [0.0] * frame_count

    if sample_width == 1:
        # 8-bit PCM is unsigned
        for i in range(frame_count):
            acc = 0.0
            base = i * samples_per_frame
            for ch in range(channels):
                u = raw[base + ch]
                acc += (u - 128.0) / 128.0
            mono[i] = acc / channels
    else:
        # 16-bit PCM is signed little endian
        for i in range(frame_count):
            acc = 0.0
            base = i * samples_per_frame * 2
            for ch in range(channels):
                lo = raw[base + ch * 2]
                hi = raw[base + ch * 2 + 1]
                v = int.from_bytes(bytes((lo, hi)), byteorder="little", signed=True)
                acc += v / 32768.0
            mono[i] = acc / channels

    # Remove DC offset
    mean = sum(mono) / len(mono)
    mono = [x - mean for x in mono]

    return mono, sample_rate, channels, sample_width


def linear_resample(data, src_rate, dst_rate):
    if src_rate == dst_rate:
        return data

    dst_len = int(round(len(data) * dst_rate / src_rate))
    out = [0.0] * dst_len
    ratio = src_rate / dst_rate

    for i in range(dst_len):
        src_pos = i * ratio
        i0 = int(src_pos)
        i1 = min(i0 + 1, len(data) - 1)
        frac = src_pos - i0
        out[i] = data[i0] + frac * (data[i1] - data[i0])

    return out


def float_to_int16(data):
    out = []
    peak = max(abs(x) for x in data) if data else 1.0
    norm = 1.0 / peak if peak > 1.0 else 1.0

    for x in data:
        v = max(-1.0, min(1.0, x * norm))
        out.append(int(round(v * 32767.0)))
    return out


def write_header(header_path: pathlib.Path, symbol: str):
    guard = f"{symbol.upper()}_H"
    text = f'''#ifndef {guard}
#define {guard}

#include <cstdint>

#define SAMPLE_LENGTH {symbol.upper()}_LENGTH

extern const uint32_t {symbol}_length;
extern const int16_t {symbol}[];

#endif // {guard}
'''
    header_path.write_text(text, encoding="ascii")


def write_cpp(cpp_path: pathlib.Path, header_name: str, symbol: str, samples):
    lines = []
    lines.append(f'#include "{header_name}"')
    lines.append("")
    lines.append(f"const uint32_t {symbol}_length = {len(samples)}u;")
    lines.append(f"const int16_t {symbol}[{len(samples)}] = {{")

    row = []
    for i, s in enumerate(samples, start=1):
        row.append(str(s))
        if len(row) == 16:
            lines.append("    " + ", ".join(row) + ",")
            row = []
    if row:
        lines.append("    " + ", ".join(row))

    lines.append("};")
    lines.append("")

    cpp_path.write_text("\n".join(lines), encoding="ascii")


def main():
    parser = argparse.ArgumentParser(description="Convert WAV to mono 48k int16 C array")
    parser.add_argument("--input", required=True)
    parser.add_argument("--header", default="sample_data.h")
    parser.add_argument("--cpp", default="sample_data.cpp")
    parser.add_argument("--symbol", default="sample_data")
    parser.add_argument("--rate", type=int, default=48000)
    args = parser.parse_args()

    input_path = pathlib.Path(args.input)
    header_path = pathlib.Path(args.header)
    cpp_path = pathlib.Path(args.cpp)

    mono, src_rate, channels, sample_width = read_wav_to_mono_float(input_path)
    resampled = linear_resample(mono, src_rate, args.rate)
    int16 = float_to_int16(resampled)

    write_header(header_path, args.symbol)
    write_cpp(cpp_path, header_path.name, args.symbol, int16)

    print(f"input={input_path}")
    print(f"source_channels={channels}")
    print(f"source_width_bytes={sample_width}")
    print(f"source_rate={src_rate}")
    print(f"target_rate={args.rate}")
    print(f"output_samples={len(int16)}")
    print(f"duration_sec={len(int16) / args.rate:.3f}")
    print(f"header={header_path}")
    print(f"cpp={cpp_path}")


if __name__ == "__main__":
    main()

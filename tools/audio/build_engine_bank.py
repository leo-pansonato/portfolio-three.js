"""
Gera o banco de camadas de motor (P2-11, ADR-0007) a partir de uma gravação com rampas de rpm.

1. Rastreia a frequência de ignição (Hz) por soma de harmônicos + Viterbi (continuidade em log-frequência).
2. Para cada rpm-alvo, acha nos trechos marcados (com/sem carga, lenta) a janela mais longa perto do alvo.
3. Achata a rotação por reamostragem com fase: a janela passa a ter frequência de ignição constante no alvo.
4. Faz o laço com número inteiro de ciclos do motor e crossfade de potência constante na emenda.
5. Normaliza o RMS de cada camada e grava um sprite com cada laço repetido 3 vezes; os pontos de laço
   apontam para a cópia do meio, então um atraso do codificador AAC menor que o laço não quebra a emenda.

Uso: python build_engine_bank.py <config.json> <entrada (wav/mp3)> <diretório de saída>
Requer numpy, scipy e imageio-ffmpeg (ferramenta de autoria; não entra no bundle).
"""

import json
import os
import subprocess
import sys
import tempfile

import imageio_ffmpeg
import numpy as np
from scipy.io import wavfile

SAMPLE_RATE = 44100
HOP = 0.01
FFT_SIZE = 8192
HARMONICS = 8
TRANSITION_WEIGHT = 60.0
MAX_STEP = 0.12
CROSSFADE = 0.04
TARGET_RMS_DB = -18.0


def ffmpeg(*args):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def load(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "src.wav")
        ffmpeg("-i", path, "-ac", "1", "-ar", str(SAMPLE_RATE), wav)
        _, data = wavfile.read(wav)
    return data.astype(np.float64) / 32768.0


def track_firing_frequency(x, low, high):
    """Frequência de ignição (Hz) a cada HOP s"""
    freqs = np.fft.rfftfreq(FFT_SIZE, 1 / SAMPLE_RATE)
    window = np.hanning(FFT_SIZE)
    candidates = np.arange(low, high, 0.25)
    log_c = np.log(candidates)
    times = np.arange(0, len(x) / SAMPLE_RATE, HOP)
    scores = np.empty((len(times), len(candidates)))
    for k, t in enumerate(times):
        i = int(t * SAMPLE_RATE)
        seg = x[max(0, i - FFT_SIZE // 2) : i + FFT_SIZE // 2]
        seg = np.pad(seg, (0, FFT_SIZE - len(seg)))
        mag = np.log(np.abs(np.fft.rfft(seg * window)) + 1e-7)
        scores[k] = sum(np.interp(candidates * h, freqs, mag) for h in range(1, HARMONICS + 1))
    lo = np.searchsorted(log_c, log_c - MAX_STEP)
    hi = np.searchsorted(log_c, log_c + MAX_STEP)
    best = scores[0].copy()
    back = np.zeros(scores.shape, dtype=np.int32)
    for k in range(1, len(times)):
        new = np.empty_like(best)
        for j in range(len(candidates)):
            cand = best[lo[j] : hi[j]] - TRANSITION_WEIGHT * np.abs(log_c[lo[j] : hi[j]] - log_c[j])
            a = int(np.argmax(cand))
            new[j] = cand[a] + scores[k, j]
            back[k, j] = lo[j] + a
        best = new
    path = np.empty(len(times), dtype=np.int32)
    path[-1] = int(np.argmax(best))
    for k in range(len(times) - 1, 0, -1):
        path[k - 1] = back[k, path[k]]
    return times, candidates[path]


def find_window(times, rpm, segments, target, tolerance, min_length, max_length):
    """
    Janela (início, fim) centrada no trecho mais longo com rpm a ±tolerância do alvo, entre min_length e
    max_length (mais o crossfade); se o trecho for curto (rampa rápida), cresce dentro do segmento (o
    achatamento corrige a rotação)
    """
    best = None
    best_segment = None
    for start, end in segments:
        inside = (times >= start) & (times <= end) & (np.abs(rpm - target) <= tolerance * target)
        k = 0
        while k < len(times):
            if not inside[k]:
                k += 1
                continue
            j = k
            while j + 1 < len(times) and inside[j + 1]:
                j += 1
            if best is None or times[j] - times[k] > best[1] - best[0]:
                best = (times[k], times[j])
                best_segment = (start, end)
            k = j + 1
    if best is None:
        raise SystemExit(f"sem trecho perto de {target} rpm")
    center = (best[0] + best[1]) / 2
    half = min(max((best[1] - best[0]) / 2, min_length / 2), max_length / 2) + CROSSFADE / 2
    start = max(best_segment[0], center - half)
    end = min(best_segment[1], start + 2 * half)
    return max(best_segment[0], end - 2 * half), end


def flatten(x, times, firing, start, end, target_firing):
    """Reamostra [start, end] para que a frequência de ignição fique constante (fase preservada)"""
    t = np.arange(start, end, 1 / SAMPLE_RATE)
    phase = np.cumsum(np.interp(t, times, firing)) / SAMPLE_RATE
    out_phase = np.arange(0, phase[-1], target_firing / SAMPLE_RATE)
    source_time = np.interp(out_phase, phase, t)
    return np.interp(source_time * SAMPLE_RATE, np.arange(len(x)), x)


def make_loop(y, cycle_frequency):
    """Laço com número inteiro de ciclos do motor e emenda em crossfade de potência constante"""
    fade = int(CROSSFADE * SAMPLE_RATE)
    available = (len(y) - fade) / SAMPLE_RATE
    cycles = max(1, int(available * cycle_frequency))
    length = int(round(cycles / cycle_frequency * SAMPLE_RATE))
    loop = y[:length].copy()
    ramp = np.linspace(0, np.pi / 2, fade)
    loop[:fade] = y[:fade] * np.sin(ramp) + y[length : length + fade] * np.cos(ramp)
    return loop


def main():
    config_path, input_path, out_dir = sys.argv[1:4]
    with open(config_path, encoding="utf-8") as fp:
        config = json.load(fp)
    order = config["cylinders"] / 2
    x = load(input_path)
    times, firing = track_firing_frequency(x, *config["firingRangeHz"])
    rpm = firing * 60 / order

    pieces, layers, offset = [], [], 0.0
    for layer in config["layers"]:
        target = layer["rpm"]
        segments = [tuple(s) for s in config["segments"][layer["source"]]]
        start, end = find_window(
            times, rpm, segments, target, config["tolerance"], config["minLoopSeconds"], config["maxLoopSeconds"]
        )
        y = flatten(x, times, firing, start, end, target / 60 * order)
        loop = make_loop(y, target / 120)
        loop *= 10 ** (TARGET_RMS_DB / 20) / np.sqrt(np.mean(loop**2))
        length = len(loop) / SAMPLE_RATE
        pieces.append(np.tile(loop, 3))
        layers.append(
            {
                "rpm": target,
                "load": layer["load"],
                "loopStart": round(offset + length, 6),
                "loopEnd": round(offset + 2 * length, 6),
            }
        )
        offset += 3 * length
        print(f"{layer['load']:>4} {target:5d} rpm  janela {start:6.2f}-{end:6.2f} s  loop {length * 1000:4.0f} ms")

    sprite = np.concatenate(pieces)
    peak = np.max(np.abs(sprite))
    if peak > 0.99:
        sprite *= 0.99 / peak
    os.makedirs(out_dir, exist_ok=True)
    name = config["name"]
    audio_path = os.path.join(out_dir, f"{name}.m4a")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "sprite.wav")
        wavfile.write(wav, SAMPLE_RATE, (sprite * 32767).astype(np.int16))
        ffmpeg("-i", wav, "-c:a", "aac", "-b:a", config["bitrate"], audio_path)
    manifest = {"audio": f"{name}.m4a", "layers": layers}
    with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent="\t")
        fp.write("\n")
    print(f"sprite {len(sprite) / SAMPLE_RATE:.1f} s, {os.path.getsize(audio_path) / 1024:.0f} KiB")


if __name__ == "__main__":
    main()

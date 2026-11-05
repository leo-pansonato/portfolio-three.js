"""
Gera o banco de áudio do motor (P2-11, ADR-0007) a partir de gravações curtas marcadas no JSON de configuração.

Camadas em laço (lenta, com carga, sem carga):
1. Rotação por trecho: pico mais forte da ordem rastreada (rpm/60 · ordem) numa faixa de ±25% em volta da rampa
   aproximada dada no JSON, com interpolação parabólica e mediana móvel.
2. Para cada rpm-alvo, a janela mais longa, nos trechos do conjunto, com rotação a ±tolerância do alvo (até
   maxLoopSeconds, que o trecho pode sobrepor; a lenta usa laço longo para não soar repetida).
3. Achatamento por reamostragem com fase: a janela passa a ter rotação constante no alvo.
4. Laço com número inteiro de ciclos do motor (2 voltas) e emenda em crossfade de potência constante.
5. Sprite com cada laço repetido 3 vezes; os pontos de laço apontam para a cópia do meio, então um atraso do
   codificador AAC menor que o laço não quebra a emenda.

Eventos (partida, troca, redução, estalos): trechos copiados como estão (sem `end`, até o fim do arquivo), com a rotação de referência (a do início
do evento, onde ele encontra o laço que já toca).
O nível relativo entre camadas e eventos é o da gravação (um ganho só para o banco todo).

Uso: python build_engine_bank.py <config.json> <diretório das gravações> <diretório de saída>
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
from scipy.ndimage import median_filter

SAMPLE_RATE = 44100
HOP = 0.01
FFT_SIZE = 8192
SEARCH_RANGE = 1.25
MAX_SEAM = 0.08
EVENT_PADDING = 0.1
PEAK = 0.95


def ffmpeg(*args):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def load(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "src.wav")
        ffmpeg("-i", path, "-ac", "1", "-ar", str(SAMPLE_RATE), wav)
        _, data = wavfile.read(wav)
    return data.astype(np.float64) / 32768.0


def track_rpm(x, segment, order):
    """Rotação (rpm) a cada HOP s dentro do trecho, guiada pela curva aproximada `guide` ([[s, rpm], ...])"""
    freqs = np.fft.rfftfreq(FFT_SIZE, 1 / SAMPLE_RATE)
    window = np.hanning(FFT_SIZE)
    start, end = segment["start"], segment["end"]
    times = np.arange(start, end, HOP)
    guide = np.array(segment["guide"], dtype=float)
    guess = np.interp(times, guide[:, 0], guide[:, 1])
    rpm = np.empty_like(times)
    for k, t in enumerate(times):
        i = int(t * SAMPLE_RATE)
        seg = x[max(0, i - FFT_SIZE // 2) : i + FFT_SIZE // 2]
        mag = np.abs(np.fft.rfft(np.pad(seg, (0, FFT_SIZE - len(seg))) * window))
        center = guess[k] / 60 * order
        band = (freqs >= center / SEARCH_RANGE) & (freqs <= center * SEARCH_RANGE)
        j = int(np.argmax(np.where(band, mag, 0)))
        a, b, c = np.log(mag[j - 1 : j + 2] + 1e-12)
        offset = 0.5 * (a - c) / (a - 2 * b + c) if a - 2 * b + c < 0 else 0.0
        rpm[k] = (j + offset) * SAMPLE_RATE / FFT_SIZE * 60 / order
    return times, median_filter(rpm, size=7, mode="nearest")


def find_window(tracks, target, tolerance, min_length, max_length):
    """(trilha, início, fim): janela centrada no trecho mais longo com rotação a ±tolerância do alvo"""
    best = None
    for track in tracks:
        times, rpm, start, end = track["times"], track["rpm"], track["start"], track["end"]
        inside = np.abs(rpm - target) <= tolerance * target
        k = 0
        while k < len(times):
            if not inside[k]:
                k += 1
                continue
            j = k
            while j + 1 < len(times) and inside[j + 1]:
                j += 1
            if best is None or times[j] - times[k] > best[2] - best[1]:
                best = (track, times[k], times[j])
            k = j + 1
    if best is None:
        raise SystemExit(f"sem trecho perto de {target} rpm")
    track, a, b = best
    length = min(max(b - a, min_length), track.get("maxLoopSeconds", max_length)) + MAX_SEAM
    begin = max(track["start"], (a + b) / 2 - length / 2)
    finish = min(track["end"], begin + length)
    return track, max(track["start"], finish - length), finish


def flatten(x, times, rpm, start, end, target):
    """Reamostra [start, end] para rotação constante no alvo (fase preservada)"""
    t = np.arange(start, end, 1 / SAMPLE_RATE)
    phase = np.cumsum(np.interp(t, times, rpm)) / SAMPLE_RATE
    out_phase = np.arange(0, phase[-1], target / SAMPLE_RATE)
    source_time = np.interp(out_phase, phase, t)
    return np.interp(source_time * SAMPLE_RATE, np.arange(len(x)), x)


def make_loop(y, rpm):
    """Laço com número inteiro de ciclos (2 voltas) e emenda de até MAX_SEAM s em potência constante"""
    cycle = 120 / rpm
    seam = min(MAX_SEAM, 0.25 * len(y) / SAMPLE_RATE)
    fade = int(seam * SAMPLE_RATE)
    cycles = max(1, int((len(y) - fade) / SAMPLE_RATE / cycle))
    length = int(round(cycles * cycle * SAMPLE_RATE))
    loop = y[:length].copy()
    ramp = np.linspace(0, np.pi / 2, fade)
    loop[:fade] = y[:fade] * np.sin(ramp) + y[length : length + fade] * np.cos(ramp)
    return loop


def main():
    config_path, source_dir, out_dir = sys.argv[1:4]
    with open(config_path, encoding="utf-8") as fp:
        config = json.load(fp)
    order = config["trackedOrder"]
    files = {}

    def audio(name):
        if name not in files:
            files[name] = load(os.path.join(source_dir, name))
        return files[name]

    tracks = {"idle": [], "on": [], "off": []}
    for segment in config["segments"]:
        times, rpm = track_rpm(audio(segment["file"]), segment, order)
        tracks[segment["load"]].append({**segment, "times": times, "rpm": rpm})
        print(f"{segment['load']:>4} {segment['file']} {segment['start']:.2f}-{segment['end']:.2f} s: "
              f"{rpm[0]:.0f} -> {rpm[-1]:.0f} rpm")

    pieces, layers, events, offset = [], [], [], 0.0
    for kind, targets in config["layers"].items():
        for target in targets:
            track, start, end = find_window(
                tracks[kind], target, config["tolerance"], config["minLoopSeconds"], config["maxLoopSeconds"]
            )
            x = audio(track["file"])
            loop = make_loop(flatten(x, track["times"], track["rpm"], start, end, target), target)
            length = len(loop) / SAMPLE_RATE
            pieces.append(np.tile(loop, 3))
            layers.append({"rpm": target, "load": kind, "loopStart": offset + length, "loopEnd": offset + 2 * length})
            offset += 3 * length
            print(f"{kind:>4} {target:5d} rpm  {track['file']} {start:.2f}-{end:.2f} s  laco {length * 1000:4.0f} ms")

    padding = np.zeros(int(EVENT_PADDING * SAMPLE_RATE))
    for event in config["events"]:
        x = audio(event["file"])
        end = event.get("end", len(x) / SAMPLE_RATE)
        clip = x[int(event["start"] * SAMPLE_RATE) : int(end * SAMPLE_RATE)].copy()
        fade = int(0.005 * SAMPLE_RATE)
        clip[:fade] *= np.linspace(0, 1, fade)
        clip[-fade:] *= np.linspace(1, 0, fade)
        pieces += [padding, clip, padding]
        start = offset + EVENT_PADDING
        events.append(
            {"name": event["name"], "start": start, "end": start + len(clip) / SAMPLE_RATE, "rpm": event["rpm"]}
        )
        offset += 2 * EVENT_PADDING + len(clip) / SAMPLE_RATE

    sprite = np.concatenate(pieces)
    sprite *= PEAK / np.max(np.abs(sprite))
    os.makedirs(out_dir, exist_ok=True)
    name = config["name"]
    audio_path = os.path.join(out_dir, f"{name}.m4a")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "sprite.wav")
        wavfile.write(wav, SAMPLE_RATE, (sprite * 32767).astype(np.int16))
        ffmpeg("-i", wav, "-c:a", "aac", "-b:a", config["bitrate"], audio_path)

    def rounded(items):
        return [{k: round(v, 6) if isinstance(v, float) else v for k, v in item.items()} for item in items]

    manifest = {"audio": f"{name}.m4a", "layers": rounded(layers), "events": rounded(events)}
    with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent="\t")
        fp.write("\n")
    print(f"sprite {len(sprite) / SAMPLE_RATE:.1f} s, {os.path.getsize(audio_path) / 1024:.0f} KiB")


if __name__ == "__main__":
    main()

import { EngineEventName } from "./EngineEventDetector";
import EngineLayerMixer, { EngineBank, EngineEventClip, parseEngineBank } from "./EngineLayerMixer";

interface LoadedBank {
	bank: EngineBank;
	buffer: AudioBuffer;
}

/**
 * Mixagem de cada evento: nível dos laços durante o evento (0–1) e tempo final em que os laços voltam (s).
 * Partida, trocas e redução trazem o próprio motor e calam (ou quase) os laços: dois motores audíveis soam
 * dobrados; estalos somam por cima.
 */
const EVENT_MIX: Record<EngineEventName | "start", { duck: number; release: number }> = {
	start: { duck: 0, release: 0.7 },
	upshift: { duck: 0, release: 0.15 },
	downshift: { duck: 0.1, release: 0.35 },
	lift: { duck: 0.35, release: 0.35 },
	pops: { duck: 0.9, release: 0.2 },
};
/** Faixa de playbackRate dos eventos: fora dela o timbre gravado se desfaz */
const MIN_EVENT_RATE = 0.8;
const MAX_EVENT_RATE = 1.25;
/** Ataque e saída do envelope dos eventos e constante de tempo do abafamento dos laços (s) */
const EVENT_FADE = 0.015;
const DUCK_TIME = 0.03;
/** Variantes com rotação até 10% da mais próxima são sorteadas */
const VARIANT_SPREAD = 1.1;

/** Busca o manifesto e o áudio do banco (relativo ao manifesto) e decodifica */
async function loadBank(context: AudioContext, url: string): Promise<LoadedBank> {
	const manifestUrl = new URL(url, document.baseURI);
	const response = await fetch(manifestUrl);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const bank = parseEngineBank(await response.json());
	const audio = await fetch(new URL(bank.audio, manifestUrl));
	if (!audio.ok) throw new Error(`HTTP ${audio.status} em ${bank.audio}`);
	const buffer = await context.decodeAudioData(await audio.arrayBuffer());
	return { bank, buffer };
}

/** Variante do evento mais próxima da rotação (sorteada entre as próximas); null se o banco não tem o evento */
export function pickEventClip(
	events: readonly EngineEventClip[],
	name: string,
	rpm: number,
	random: () => number = Math.random,
): EngineEventClip | null {
	let nearest = Infinity;
	for (const event of events) {
		if (event.name === name) nearest = Math.min(nearest, Math.abs(Math.log(rpm / event.rpm)));
	}
	if (nearest === Infinity) return null;
	let count = 0;
	for (const event of events) {
		if (event.name === name && Math.abs(Math.log(rpm / event.rpm)) <= nearest + Math.log(VARIANT_SPREAD)) count++;
	}
	let choice = Math.floor(random() * count);
	for (const event of events) {
		if (event.name !== name || Math.abs(Math.log(rpm / event.rpm)) > nearest + Math.log(VARIANT_SPREAD)) continue;
		if (choice-- === 0) return event;
	}
	return null;
}

/**
 * Motor por amostras (ADR-0007): um laço por camada tocando sempre (playbackRate e ganho do EngineLayerMixer) e
 * eventos tocados uma vez por cima, com os laços abafados enquanto o evento traz o próprio motor. Carrega cada
 * banco uma vez sob demanda; enquanto não há banco pronto, `active` é falso e o chamador usa o motor procedural.
 * Todas as mudanças de nível são rampas (setTargetAtTime / rampas lineares), sem degraus.
 */
export default class SampledEngine {
	private readonly loaded = new Map<string, LoadedBank>();
	private readonly requested = new Set<string>();
	private readonly output: GainNode;
	/** Abafamento dos laços pelos eventos */
	private readonly loops: GainNode;
	private activeUrl: string | null = null;
	private current: LoadedBank | null = null;
	private mixer: EngineLayerMixer | null = null;
	private sources: AudioBufferSourceNode[] = [];
	private gains: GainNode[] = [];

	constructor(
		private readonly context: AudioContext,
		destination: AudioNode,
	) {
		this.output = context.createGain();
		this.output.gain.value = 0;
		this.output.connect(destination);
		this.loops = context.createGain();
		this.loops.connect(this.output);
	}

	/** Há um banco tocando */
	get active(): boolean {
		return this.mixer !== null;
	}

	/**
	 * Banco a tocar (null: nenhum), chamado por quadro: carrega na primeira vez e, quando pronto, começa pela partida
	 * @returns true no quadro em que o banco passou a tocar
	 */
	select(url: string | null): boolean {
		if (url !== this.activeUrl) {
			this.stopLayers();
			this.activeUrl = url;
		}
		if (!url || this.mixer) return false;
		const loaded = this.loaded.get(url);
		if (!loaded) {
			this.request(url);
			return false;
		}
		this.startLayers(loaded);
		this.play("start", 0);
		return true;
	}

	/**
	 * @param rpm rotação do motor (rpm)
	 * @param load carga do motor (0–1)
	 * @param gain nível do motor (0–1)
	 * @param rateTime constante de tempo das rampas de playbackRate (s)
	 * @param gainTime constante de tempo das rampas de ganho das camadas (s)
	 */
	update(rpm: number, load: number, gain: number, rateTime: number, gainTime: number): void {
		const mixer = this.mixer;
		const now = this.context.currentTime;
		this.output.gain.setTargetAtTime(mixer ? gain : 0, now, gainTime);
		if (!mixer) return;
		mixer.update(rpm, load);
		for (let i = 0; i < this.sources.length; i++) {
			this.sources[i].playbackRate.setTargetAtTime(mixer.rates[i], now, rateTime);
			this.gains[i].gain.setTargetAtTime(mixer.gains[i], now, gainTime);
		}
	}

	/** Toca o evento na rotação dada (a partida, na rotação gravada) e abafa os laços enquanto ele dura */
	play(name: EngineEventName | "start", rpm: number): void {
		const current = this.current;
		if (!current) return;
		const clip = pickEventClip(current.bank.events, name, rpm || 1);
		if (!clip) return;
		const context = this.context;
		const now = context.currentTime;
		const rate = name === "start" ? 1 : Math.min(MAX_EVENT_RATE, Math.max(MIN_EVENT_RATE, rpm / clip.rpm));
		const duration = (clip.end - clip.start) / rate;

		const envelope = context.createGain();
		envelope.gain.setValueAtTime(0, now);
		envelope.gain.linearRampToValueAtTime(1, now + EVENT_FADE);
		envelope.gain.setValueAtTime(1, now + duration - EVENT_FADE);
		envelope.gain.linearRampToValueAtTime(0, now + duration);
		envelope.connect(this.output);
		const source = context.createBufferSource();
		source.buffer = current.buffer;
		source.playbackRate.value = rate;
		source.connect(envelope);
		source.start(now, clip.start, clip.end - clip.start);
		source.onended = () => {
			source.disconnect();
			envelope.disconnect();
		};

		const mix = EVENT_MIX[name];
		const loops = this.loops.gain;
		loops.cancelScheduledValues(now);
		loops.setTargetAtTime(mix.duck, now, name === "start" ? 0.001 : DUCK_TIME);
		const release = Math.min(mix.release, duration);
		loops.setTargetAtTime(1, now + duration - release, release / 3);
	}

	dispose(): void {
		this.stopLayers();
		this.loops.disconnect();
		this.output.disconnect();
	}

	private request(url: string): void {
		if (this.requested.has(url)) return;
		this.requested.add(url);
		loadBank(this.context, url)
			.then((loaded) => this.loaded.set(url, loaded))
			.catch((error: unknown) => {
				console.warn(`Banco de motor ${url} indisponível; usando o motor procedural`, error);
			});
	}

	private startLayers(loaded: LoadedBank): void {
		const context = this.context;
		for (const layer of loaded.bank.layers) {
			const gain = context.createGain();
			gain.gain.value = 0;
			gain.connect(this.loops);
			const source = context.createBufferSource();
			source.buffer = loaded.buffer;
			source.loop = true;
			source.loopStart = layer.loopStart;
			source.loopEnd = layer.loopEnd;
			source.connect(gain);
			source.start(0, layer.loopStart);
			this.sources.push(source);
			this.gains.push(gain);
		}
		this.current = loaded;
		this.mixer = new EngineLayerMixer(loaded.bank.layers);
	}

	private stopLayers(): void {
		for (const source of this.sources) {
			source.stop();
			source.disconnect();
		}
		for (const gain of this.gains) gain.disconnect();
		this.sources = [];
		this.gains = [];
		this.current = null;
		this.mixer = null;
	}
}

import EngineLayerMixer, { EngineBank, parseEngineBank } from "./EngineLayerMixer";

interface LoadedBank {
	bank: EngineBank;
	buffer: AudioBuffer;
}

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

/**
 * Motor por camadas gravadas (ADR-0007): um laço por camada tocando sempre, com playbackRate e ganho do
 * EngineLayerMixer. Carrega cada banco uma vez sob demanda; enquanto não há banco pronto, `active` é falso e o
 * chamador usa o motor procedural.
 */
export default class SampledEngine {
	private readonly loaded = new Map<string, LoadedBank>();
	private readonly requested = new Set<string>();
	private readonly output: GainNode;
	private activeUrl: string | null = null;
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
	}

	/** Há um banco tocando */
	get active(): boolean {
		return this.mixer !== null;
	}

	/** Banco a tocar (null: nenhum), chamado por quadro: carrega na primeira vez e passa a tocar quando pronto */
	select(url: string | null): void {
		if (url !== this.activeUrl) {
			this.stopLayers();
			this.activeUrl = url;
		}
		if (!url || this.mixer) return;
		const loaded = this.loaded.get(url);
		if (loaded) this.startLayers(loaded);
		else this.request(url);
	}

	/**
	 * @param rpm rotação do motor (rpm)
	 * @param load carga do motor (0–1)
	 * @param gain nível do motor (0–1)
	 * @param rampTime constante de tempo das rampas (s)
	 */
	update(rpm: number, load: number, gain: number, rampTime: number): void {
		const mixer = this.mixer;
		const now = this.context.currentTime;
		this.output.gain.setTargetAtTime(mixer ? gain : 0, now, rampTime);
		if (!mixer) return;
		mixer.update(rpm, load);
		for (let i = 0; i < this.sources.length; i++) {
			this.sources[i].playbackRate.setTargetAtTime(mixer.rates[i], now, rampTime);
			this.gains[i].gain.setTargetAtTime(mixer.gains[i], now, rampTime);
		}
	}

	dispose(): void {
		this.stopLayers();
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

	private startLayers({ bank, buffer }: LoadedBank): void {
		const context = this.context;
		for (const layer of bank.layers) {
			const gain = context.createGain();
			gain.gain.value = 0;
			gain.connect(this.output);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.loop = true;
			source.loopStart = layer.loopStart;
			source.loopEnd = layer.loopEnd;
			source.connect(gain);
			source.start(0, layer.loopStart);
			this.sources.push(source);
			this.gains.push(gain);
		}
		this.mixer = new EngineLayerMixer(bank.layers);
	}

	private stopLayers(): void {
		for (const source of this.sources) {
			source.stop();
			source.disconnect();
		}
		for (const gain of this.gains) gain.disconnect();
		this.sources = [];
		this.gains = [];
		this.mixer = null;
	}
}

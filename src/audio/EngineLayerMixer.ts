/** Conjunto de uma camada: lenta (entra nos dois), com carga ou sem carga */
export type EngineLayerLoad = "idle" | "on" | "off";

/** Laço gravado numa rotação fixa (tempos em s dentro do áudio do banco) */
export interface EngineLayer {
	/** Rotação da gravação (rpm) */
	rpm: number;
	load: EngineLayerLoad;
	loopStart: number;
	loopEnd: number;
}

/** Som de evento (partida, troca, redução, estalos) tocado uma vez sobre os laços (tempos em s no áudio do banco) */
export interface EngineEventClip {
	name: string;
	start: number;
	end: number;
	/** Rotação no início do evento (rpm): referência do playbackRate */
	rpm: number;
}

/** Banco de áudio do motor: manifesto JSON gerado por tools/audio/build_engine_bank.py */
export interface EngineBank {
	/** Áudio com camadas e eventos, relativo ao manifesto */
	audio: string;
	layers: EngineLayer[];
	events: EngineEventClip[];
}

const LOADS: readonly EngineLayerLoad[] = ["idle", "on", "off"];
/** Faixa de playbackRate aceita: fora dela o timbre se desfaz (s/ s) */
const MIN_RATE = 0.5;
const MAX_RATE = 2.5;

/** Valida o manifesto; erro com mensagem se faltar algo */
export function parseEngineBank(data: unknown): EngineBank {
	const bank = data as Partial<EngineBank> | null;
	if (!bank || typeof bank.audio !== "string" || !Array.isArray(bank.layers))
		throw new Error("Banco de motor inválido: faltam audio ou layers");
	for (const layer of bank.layers) {
		const valid =
			layer &&
			LOADS.includes(layer.load) &&
			layer.rpm > 0 &&
			layer.loopStart >= 0 &&
			layer.loopEnd > layer.loopStart;
		if (!valid) throw new Error(`Camada de motor inválida: ${JSON.stringify(layer)}`);
	}
	if (!bank.layers.some((l) => l.load === "on") || !bank.layers.some((l) => l.load === "off"))
		throw new Error("Banco de motor precisa de camadas com e sem carga");
	const events = bank.events ?? [];
	for (const event of events) {
		const valid = event && typeof event.name === "string" && event.rpm > 0 && event.end > event.start;
		if (!valid) throw new Error(`Evento de motor inválido: ${JSON.stringify(event)}`);
	}
	return { audio: bank.audio, layers: bank.layers, events };
}

/**
 * Mistura das camadas por rpm e carga (ADR-0007, prática 1): em cada conjunto (com carga, sem carga; a lenta é a
 * camada mais baixa dos dois) as duas camadas vizinhas da rpm fazem crossfade de potência constante em log-rpm;
 * os conjuntos fazem crossfade de potência constante pela carga. Cada camada toca na rpm atual (playbackRate =
 * rpm / rpm da gravação). Abaixo da primeira e acima da última, só a extrema; abaixo da primeira o tom fica o
 * gravado (a lenta do jogo pode ser mais baixa que a da gravação e descer de tom soa artificial). Sem alocação por chamada.
 */
export default class EngineLayerMixer {
	/** Ganho de cada camada, na ordem do banco (0–1) */
	readonly gains: Float64Array;
	/** playbackRate de cada camada */
	readonly rates: Float64Array;
	private readonly onSet: number[];
	private readonly offSet: number[];
	/** Rotação da camada mais baixa (rpm): abaixo dela as camadas não descem de tom */
	private readonly lowestRpm: number;
	/** Ganho de cada camada vindo de cada conjunto */
	private readonly onGains: Float64Array;
	private readonly offGains: Float64Array;

	constructor(private readonly layers: readonly EngineLayer[]) {
		this.gains = new Float64Array(layers.length);
		this.rates = new Float64Array(layers.length);
		this.onGains = new Float64Array(layers.length);
		this.offGains = new Float64Array(layers.length);
		const set = (load: EngineLayerLoad) =>
			layers
				.map((layer, index) => ({ layer, index }))
				.filter(({ layer }) => layer.load === load || layer.load === "idle")
				.sort((a, b) => a.layer.rpm - b.layer.rpm)
				.map(({ index }) => index);
		this.onSet = set("on");
		this.offSet = set("off");
		this.lowestRpm = Math.min(...layers.map((layer) => layer.rpm));
	}

	/**
	 * @param rpm rotação do motor (rpm)
	 * @param load carga do motor (0–1)
	 */
	update(rpm: number, load: number): void {
		const l = Math.min(1, Math.max(0, load));
		this.mixSet(this.onSet, rpm, Math.sin((l * Math.PI) / 2), this.onGains);
		this.mixSet(this.offSet, rpm, Math.cos((l * Math.PI) / 2), this.offGains);
		for (let i = 0; i < this.layers.length; i++) {
			// a lenta recebe dos dois conjuntos: soma em potência, como as demais camadas entre si
			this.gains[i] = Math.hypot(this.onGains[i], this.offGains[i]);
			const pitchRpm = Math.max(rpm, this.lowestRpm);
			this.rates[i] = Math.min(MAX_RATE, Math.max(MIN_RATE, pitchRpm / this.layers[i].rpm));
		}
	}

	private mixSet(set: readonly number[], rpm: number, weight: number, out: Float64Array): void {
		out.fill(0);
		const layers = this.layers;
		if (rpm <= layers[set[0]].rpm) {
			out[set[0]] = weight;
			return;
		}
		const last = set[set.length - 1];
		if (rpm >= layers[last].rpm) {
			out[last] = weight;
			return;
		}
		let upper = 1;
		while (layers[set[upper]].rpm <= rpm) upper++;
		const low = layers[set[upper - 1]].rpm;
		const t = Math.log(rpm / low) / Math.log(layers[set[upper]].rpm / low);
		out[set[upper - 1]] = weight * Math.cos((t * Math.PI) / 2);
		out[set[upper]] = weight * Math.sin((t * Math.PI) / 2);
	}
}

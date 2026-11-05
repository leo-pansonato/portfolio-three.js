import { VehicleDefinition } from "../data/vehicles/types";
import { VehicleTelemetry } from "../vehicle/VehicleTelemetry";
import { computeVehicleSound, createVehicleSoundParams, impactIntensity } from "./vehicleSound";

/** O que o áudio lê do veículo */
export interface VehicleAudioSource {
	getTelemetry(): Readonly<VehicleTelemetry>;
	getDefinition(): Readonly<VehicleDefinition>;
}

/** Constante de tempo das rampas de parâmetro (s): suaviza a leitura por quadro de um sinal por passo */
const RAMP_TIME = 0.03;
const MASTER_GAIN = 0.5;
const IMPACT_COOLDOWN = 0.3;

/**
 * Áudio procedural do veículo (Web Audio, sem assets): motor por rpm e carga, chiado dos pneus por escorregamento,
 * vento e rolamento por velocidade, impacto por pico de aceleração. O `AudioContext` só nasce no primeiro gesto do
 * usuário (política de autoplay).
 */
export default class VehicleAudio {
	private context: AudioContext | null = null;
	private muted = false;
	private master!: GainNode;
	private engineGain!: GainNode;
	private engineFilter!: BiquadFilterNode;
	private engineOscillators: OscillatorNode[] = [];
	private subharmonicGain!: GainNode;
	private tireGain!: GainNode;
	private tireFilter!: BiquadFilterNode;
	private windGain!: GainNode;
	private roadGain!: GainNode;
	private noiseBuffer!: AudioBuffer;
	private sources: AudioScheduledSourceNode[] = [];

	private readonly params = createVehicleSoundParams();
	private definition: Readonly<VehicleDefinition> | null = null;
	private previousImpact = 0;
	private lastImpactTime = -Infinity;

	private readonly startBound = () => this.start();
	private readonly visibilityBound = () => this.applySuspension();

	constructor(private readonly vehicle: VehicleAudioSource) {
		window.addEventListener("keydown", this.startBound);
		window.addEventListener("pointerdown", this.startBound);
		document.addEventListener("visibilitychange", this.visibilityBound);
	}

	toggleMute(): void {
		this.muted = !this.muted;
		this.applySuspension();
	}

	update(_deltaTime: number): void {
		const context = this.context;
		if (!context || context.state !== "running") return;

		const definition = this.vehicle.getDefinition();
		if (definition !== this.definition) {
			this.definition = definition;
			this.subharmonicGain.gain.setTargetAtTime(definition.sound.subharmonicGain, context.currentTime, RAMP_TIME);
		}

		const telemetry = this.vehicle.getTelemetry();
		const params = computeVehicleSound(telemetry, definition, this.params);
		const now = context.currentTime;
		const frequency = params.engineFrequencyHz;
		this.engineOscillators[0].frequency.setTargetAtTime(frequency, now, RAMP_TIME);
		this.engineOscillators[1].frequency.setTargetAtTime(frequency * 2, now, RAMP_TIME);
		this.engineOscillators[2].frequency.setTargetAtTime(frequency / 2, now, RAMP_TIME);
		this.engineGain.gain.setTargetAtTime(params.engineGain * 0.6, now, RAMP_TIME);
		this.engineFilter.frequency.setTargetAtTime(params.engineCutoffHz, now, RAMP_TIME);
		this.tireGain.gain.setTargetAtTime(params.tireGain * 0.5, now, RAMP_TIME);
		this.tireFilter.frequency.setTargetAtTime(params.tireFrequencyHz, now, RAMP_TIME);
		this.windGain.gain.setTargetAtTime(params.windGain * 0.35, now, RAMP_TIME);
		this.roadGain.gain.setTargetAtTime(params.roadGain * 0.25, now, RAMP_TIME);

		const impact = impactIntensity(telemetry);
		if (impact > 0 && this.previousImpact === 0 && now - this.lastImpactTime > IMPACT_COOLDOWN) {
			this.lastImpactTime = now;
			this.playImpact(impact);
		}
		this.previousImpact = impact;
	}

	dispose(): void {
		window.removeEventListener("keydown", this.startBound);
		window.removeEventListener("pointerdown", this.startBound);
		document.removeEventListener("visibilitychange", this.visibilityBound);
		for (const source of this.sources) source.stop();
		this.sources = [];
		this.engineOscillators = [];
		void this.context?.close();
		this.context = null;
	}

	private start(): void {
		if (this.context) {
			this.applySuspension();
			return;
		}
		const context = new AudioContext();
		this.context = context;
		window.removeEventListener("pointerdown", this.startBound);
		this.build(context);
		this.applySuspension();
	}

	private applySuspension(): void {
		const context = this.context;
		if (!context) return;
		if (this.muted || document.hidden) void context.suspend();
		else void context.resume();
	}

	private build(context: AudioContext): void {
		const compressor = context.createDynamicsCompressor();
		compressor.connect(context.destination);
		this.master = this.gain(context, MASTER_GAIN, compressor);

		// ruído branco de 2 s, compartilhado pelos pneus, vento, rolamento e impactos
		const length = context.sampleRate * 2;
		this.noiseBuffer = context.createBuffer(1, length, context.sampleRate);
		const samples = this.noiseBuffer.getChannelData(0);
		for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;

		// motor: ignição (dente de serra), segunda ordem (quadrada) e meia ordem, saturados e filtrados pela carga
		this.engineGain = this.gain(context, 0, this.master);
		this.engineFilter = context.createBiquadFilter();
		this.engineFilter.type = "lowpass";
		this.engineFilter.Q.value = 1.5;
		this.engineFilter.connect(this.engineGain);
		const shaper = context.createWaveShaper();
		shaper.curve = softClipCurve(3);
		shaper.connect(this.engineFilter);
		const fundamental = this.oscillator(context, "sawtooth", this.gain(context, 0.5, shaper));
		const second = this.oscillator(context, "square", this.gain(context, 0.12, shaper));
		this.subharmonicGain = this.gain(context, 0, shaper);
		const subharmonic = this.oscillator(context, "sawtooth", this.subharmonicGain);
		this.engineOscillators = [fundamental, second, subharmonic];

		this.tireFilter = context.createBiquadFilter();
		this.tireFilter.type = "bandpass";
		this.tireFilter.Q.value = 6;
		this.tireGain = this.gain(context, 0, this.master);
		this.tireFilter.connect(this.tireGain);
		this.noise(context, this.tireFilter);

		this.windGain = this.gain(context, 0, this.master);
		this.noise(context, this.filter(context, "lowpass", 700, this.windGain));
		this.roadGain = this.gain(context, 0, this.master);
		this.noise(context, this.filter(context, "lowpass", 180, this.roadGain));
	}

	private playImpact(intensity: number): void {
		const context = this.context!;
		const now = context.currentTime;
		const envelope = this.gain(context, intensity, this.master);
		envelope.gain.setTargetAtTime(0, now, 0.08);
		const source = context.createBufferSource();
		source.buffer = this.noiseBuffer;
		source.connect(this.filter(context, "lowpass", 300 + 900 * intensity, envelope));
		source.start(now);
		source.stop(now + 0.6);
		source.onended = () => {
			source.disconnect();
			envelope.disconnect();
		};
	}

	private gain(context: AudioContext, value: number, destination: AudioNode): GainNode {
		const node = context.createGain();
		node.gain.value = value;
		node.connect(destination);
		return node;
	}

	private filter(context: AudioContext, type: BiquadFilterType, frequency: number, destination: AudioNode) {
		const node = context.createBiquadFilter();
		node.type = type;
		node.frequency.value = frequency;
		node.connect(destination);
		return node;
	}

	private oscillator(context: AudioContext, type: OscillatorType, destination: AudioNode): OscillatorNode {
		const node = context.createOscillator();
		node.type = type;
		node.frequency.value = 0;
		node.connect(destination);
		node.start();
		this.sources.push(node);
		return node;
	}

	private noise(context: AudioContext, destination: AudioNode): void {
		const source = context.createBufferSource();
		source.buffer = this.noiseBuffer;
		source.loop = true;
		// início aleatório para que as fontes do mesmo buffer não fiquem correlacionadas
		source.connect(destination);
		source.start(0, Math.random() * this.noiseBuffer.duration);
		this.sources.push(source);
	}
}

/** Curva de saturação suave tanh(k·x), normalizada */
function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
	const size = 1024;
	const curve = new Float32Array(size);
	const norm = Math.tanh(drive);
	for (let i = 0; i < size; i++) {
		const x = (i / (size - 1)) * 2 - 1;
		curve[i] = Math.tanh(drive * x) / norm;
	}
	return curve;
}

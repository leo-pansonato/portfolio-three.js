import { DifferentialConfig, VehicleDefinition } from "../data/vehicles/types";
import Engine, { RAD_PER_SECOND_TO_RPM } from "./Engine";
import TorqueConverter from "./TorqueConverter";
import WheelDynamics, { WheelState, WheelStep } from "./WheelDynamics";

/** Comandos do trem de força para um passo (vindos do controle, VehicleCommands) */
export interface DrivelineCommands {
	/** Acelerador pedido ao motor (0–1), já com corte de troca, aceleração na redução e limitador de velocidade */
	throttle: number;
	/** Multiplicador do torque a plena carga (boost; 1 sem) */
	torqueMultiplier: number;
	/** Relação total da marcha engatada com o diferencial (adimensional; negativa em ré, 0 em ponto morto) */
	gearRatio: number;
	/** Capacidade da embreagem de partida ou de travamento do conversor (N·m no virabrequim) */
	clutchTorque: number;
	/** Acoplamento do conversor (0–1; 0 desacopla o motor parado sem acelerador, sem conversor é ignorado) */
	converterCoupling: number;
}

/** Nó da árvore: roda (folha) ou diferencial com saídas A e B */
interface DriveNode {
	/** Índice da roda na folha; −1 no diferencial */
	wheel: number;
	config: Readonly<DifferentialConfig> | null;
	a: DriveNode | null;
	b: DriveNode | null;
	/** Torque de entrada da iteração atual (N·m); também o ponto de partida do passo seguinte */
	torque: number;
	/** Velocidade no fim do passo com esse torque, no modelo linearizado (rad/s, unidades de roda) */
	speed: number;
	/** dω/dT no ponto (rad/s por N·m, ≥ 0) */
	response: number;
	/** Velocidade no início do passo (rad/s) */
	initialSpeed: number;
	/** Torque transferido de A para B (N·m) */
	transfer: number;
	/** Embreagem do diferencial travada (saídas na mesma velocidade) */
	locked: boolean;
}

function createNode(
	wheel: number,
	config: Readonly<DifferentialConfig> | null,
	a: DriveNode | null,
	b: DriveNode | null,
) {
	const node: DriveNode = {
		wheel,
		config,
		a,
		b,
		torque: 0,
		speed: 0,
		response: 0,
		initialSpeed: 0,
		transfer: 0,
		locked: false,
	};
	return node;
}

/** Iterações de Newton entre o trem de força linearizado e as rodas, e tolerância da velocidade prevista (rad/s) */
const MAX_DRIVELINE_ITERATIONS = 4;
const SPEED_TOLERANCE = 1e-4;
/** Iterações máximas e tolerância relativa das buscas de raiz unidimensionais */
const MAX_ROOT_ITERATIONS = 60;
const ROOT_TOLERANCE = 1e-10;
const MIN_RESPONSE = 1e-12;

/**
 * Trem de força acoplado às rodas (ADR-0003, etapa 4): motor com inércia e rotação própria, embreagem de atrito
 * (com conversor de torque em paralelo, se houver), câmbio e árvore de diferenciais com embreagem de bloqueio.
 * Euler implícito no passo de 1/60 s, sem subpassos: cada roda motriz é linearizada (ω no fim do passo em função do
 * torque, pela WheelDynamics); com as rodas lineares, cada diferencial tem solução fechada (travado ou escorregando,
 * como atrito de Coulomb) e o motor com a embreagem/conversor é uma equação monótona numa variável (velocidade da
 * entrada do câmbio), resolvida por falsa posição. Os torques resultantes vão às rodas, que são resolvidas de novo
 * sem linearizar; repete (Newton) até a velocidade prevista bater com a resolvida. Sem alocação por passo.
 */
export default class Driveline {
	readonly engine: Engine;
	readonly converter: TorqueConverter | null;
	/** Rotação do motor (rad/s) */
	engineSpeed: number;
	/** Embreagem travada no último passo */
	clutchLocked = false;
	/** Torque na entrada do câmbio no último passo (N·m) */
	clutchOutputTorque = 0;

	private readonly root: DriveNode;
	private readonly leaves: DriveNode[] = [];
	private readonly engineInertia: number;
	private readonly efficiency: number;
	private readonly idleSpeed: number;
	/** Limite de torque do motor para delimitar as buscas (N·m) */
	private readonly torqueBound: number;

	private dt = 1 / 60;
	private initialEngineSpeed = 0;
	private commands: Readonly<DrivelineCommands> | null = null;
	private rootIntercept = 0;
	private rootResponse = 0;
	private solvedEngineSpeed = 0;
	private solvedLocked = false;
	private transferSlope = 0;

	constructor(
		definition: Readonly<VehicleDefinition>,
		private readonly wheelDynamics: WheelDynamics,
		/** Passo de cada roda, na ordem das rodas (0/1 dianteiras, 2/3 traseiras) */
		private readonly steps: WheelStep[],
	) {
		const powertrain = definition.powertrain;
		this.engine = new Engine(powertrain);
		this.converter = powertrain.torqueConverter
			? new TorqueConverter(
					powertrain.torqueConverter,
					this.engine.fullLoadTorque(powertrain.torqueConverter.stallRpm),
				)
			: null;
		this.engineInertia = powertrain.engineInertia;
		this.efficiency = powertrain.efficiency;
		this.idleSpeed = powertrain.idleRpm / RAD_PER_SECOND_TO_RPM;
		this.engineSpeed = this.idleSpeed;
		this.torqueBound = this.engine.peakTorque * Math.max(1.5, powertrain.boostTorqueMultiplier) + 1000;

		const differentials = powertrain.differentials;
		const axle = (side: "front" | "rear"): DriveNode => {
			const config = differentials[side];
			if (!config) throw new Error(`Diferencial ${side} ausente no trem de força`);
			const first = side === "front" ? 0 : 2;
			const left = createNode(first, null, null, null);
			const right = createNode(first + 1, null, null, null);
			this.leaves.push(left, right);
			return createNode(-1, config, left, right);
		};
		const traction = definition.configs.tractionDisplacement;
		if (traction === "all") {
			if (!differentials.center) throw new Error("Diferencial central ausente na tração integral");
			const front = axle("front");
			const rear = axle("rear");
			this.root = createNode(-1, differentials.center, front, rear);
		} else {
			this.root = axle(traction);
		}
	}

	/** A roda recebe torque do motor */
	isDriven(wheel: number): boolean {
		for (const leaf of this.leaves) if (leaf.wheel === wheel) return true;
		return false;
	}

	/** Velocidade da saída do câmbio em unidades de roda (rad/s), pela cinemática dos diferenciais */
	outputSpeed(wheels: readonly Readonly<WheelState>[]): number {
		return this.kinematicSpeed(this.root, wheels, null);
	}

	/** Rotação do motor (rpm) */
	engineRpm(): number {
		return this.engineSpeed * RAD_PER_SECOND_TO_RPM;
	}

	/**
	 * Depois de escrever o estado do chassi: motor na rotação da marcha dada (nunca abaixo da lenta) e o ponto de
	 * partida das iterações zerado, para o resultado só depender do estado escrito
	 */
	synchronize(wheels: readonly Readonly<WheelState>[], gearRatio: number): void {
		this.engineSpeed = Math.max(this.idleSpeed, Math.abs(gearRatio * this.outputSpeed(wheels)));
		this.resetIterationStart();
	}

	/** Zera o ponto de partida das iterações (torques de entrada de cada nó) */
	resetIterationStart(): void {
		this.resetNode(this.root);
	}

	/**
	 * Resolve o trem de força e as rodas motrizes no passo; as rodas já preparadas (WheelDynamics.prepare) e as não
	 * motrizes já resolvidas. Ao fim, cada passo de roda motriz tem a solução final (falta só `commit`).
	 * @param dt passo de física (s)
	 */
	step(commands: Readonly<DrivelineCommands>, dt: number): void {
		this.dt = dt;
		this.commands = commands;
		this.initialEngineSpeed = this.engineSpeed;
		const leaves = this.leaves;
		for (let i = 0; i < leaves.length; i++) {
			this.wheelDynamics.solve(this.steps[leaves[i].wheel], leaves[i].torque, true);
		}

		for (let iteration = 0; iteration < MAX_DRIVELINE_ITERATIONS; iteration++) {
			this.linearize(this.root);
			this.rootResponse = this.root.response;
			this.rootIntercept = this.root.speed - this.root.response * this.root.torque;
			const outputTorque = this.solveCoupling();
			this.distribute(this.root, outputTorque);

			let error = 0;
			for (let i = 0; i < leaves.length; i++) {
				const leaf = leaves[i];
				const step = this.steps[leaf.wheel];
				const predicted = leaf.speed + leaf.response * (leaf.torque - step.driveTorque);
				this.wheelDynamics.solve(step, leaf.torque, true);
				error = Math.max(error, Math.abs(step.angularVelocity - predicted));
			}
			if (error < SPEED_TOLERANCE) break;
		}

		const ratio = commands.gearRatio;
		if (this.solvedLocked && ratio !== 0) {
			this.engineSpeed = Math.max(0, ratio * this.kinematicSpeed(this.root, null, this.steps));
		} else {
			this.engineSpeed = Math.max(0, this.solvedEngineSpeed);
		}
		this.clutchLocked = this.solvedLocked;
		this.commands = null;
	}

	/** Linearização de baixo para cima no torque atual de cada nó: velocidade, resposta e transferência */
	private linearize(node: DriveNode): void {
		if (node.wheel >= 0) {
			const step = this.steps[node.wheel];
			node.torque = step.driveTorque;
			node.speed = step.angularVelocity;
			node.response = Math.max(MIN_RESPONSE, step.torqueResponse);
			node.initialSpeed = step.initialAngularVelocity;
			return;
		}
		const a = node.a!;
		const b = node.b!;
		this.linearize(a);
		this.linearize(b);
		const split = node.config!.torqueSplit;
		node.initialSpeed = split * a.initialSpeed + (1 - split) * b.initialSpeed;
		const transfer = this.computeTransfer(node, node.torque);
		const slope = this.transferSlope;
		const torqueA = split * node.torque - transfer;
		const torqueB = (1 - split) * node.torque + transfer;
		node.transfer = transfer;
		node.speed =
			split * (a.speed + a.response * (torqueA - a.torque)) +
			(1 - split) * (b.speed + b.response * (torqueB - b.torque));
		node.response = Math.max(
			MIN_RESPONSE,
			split * a.response * (split - slope) + (1 - split) * b.response * (1 - split + slope),
		);
	}

	/** Reparte o torque de entrada de cima para baixo, com a transferência de cada diferencial */
	private distribute(node: DriveNode, torque: number): void {
		node.torque = torque;
		if (node.wheel >= 0) return;
		const split = node.config!.torqueSplit;
		const transfer = this.computeTransfer(node, torque);
		node.transfer = transfer;
		this.distribute(node.a!, split * torque - transfer);
		this.distribute(node.b!, (1 - split) * torque + transfer);
	}

	/**
	 * Torque transferido de A para B (N·m) com as saídas lineares: travado se o torque que iguala as velocidades no
	 * fim do passo couber na capacidade, senão a capacidade (Coulomb) mais o viscoso. Grava dτ/dT em transferSlope.
	 */
	private computeTransfer(node: DriveNode, torque: number): number {
		const config = node.config!;
		const a = node.a!;
		const b = node.b!;
		const split = config.torqueSplit;
		const interceptA = a.speed - a.response * a.torque;
		const interceptB = b.speed - b.response * b.torque;
		const differenceSlope = a.response * split - b.response * (1 - split);
		const difference = interceptA - interceptB + differenceSlope * torque;
		const combined = a.response + b.response;
		const coast = torque * node.initialSpeed < 0;
		const locking = coast ? config.coastLocking : config.powerLocking;
		const capacity = config.preloadTorque + locking * Math.abs(torque);
		const capacitySlope = locking * Math.sign(torque);
		const viscous = config.viscousCoupling;

		const lockTransfer = difference / combined;
		if (Math.abs(lockTransfer) <= capacity) {
			node.locked = true;
			this.transferSlope = differenceSlope / combined;
			return lockTransfer;
		}
		node.locked = false;
		const sign = Math.sign(lockTransfer);
		this.transferSlope = (sign * capacitySlope + viscous * differenceSlope) / (1 + viscous * combined);
		return (sign * capacity + viscous * difference) / (1 + viscous * combined);
	}

	/**
	 * Motor + embreagem/conversor contra a saída linearizada: acha a velocidade x da entrada do câmbio no fim do
	 * passo com x = G·(c + b·G·η·Tc(x)); Tc decresce com x, então a equação é monótona. Devolve o torque na saída do
	 * câmbio (N·m, unidades de roda).
	 */
	private solveCoupling(): number {
		const commands = this.commands!;
		const ratio = commands.gearRatio;
		const coupled =
			ratio !== 0 && (commands.clutchTorque > 0 || (this.converter !== null && commands.converterCoupling > 0));
		if (!coupled) {
			this.solvedLocked = false;
			this.solvedEngineSpeed = this.solveEngineSpeed(0, 0, false);
			this.clutchOutputTorque = 0;
			return 0;
		}

		const gain = ratio * ratio * this.efficiency * this.rootResponse;
		let low = ratio * this.rootIntercept;
		let lowTorque = this.couplingTorque(low);
		let high = low + gain * lowTorque;
		if (high < low) {
			const swap = low;
			low = high;
			high = swap;
		}
		let lowValue = low - ratio * this.rootIntercept - gain * this.couplingTorque(low);
		let highValue = high - ratio * this.rootIntercept - gain * this.couplingTorque(high);
		let x = lowValue >= 0 ? low : high;
		if (lowValue < 0 && highValue > 0) {
			let side = 0;
			for (let i = 0; i < MAX_ROOT_ITERATIONS; i++) {
				x = (low * highValue - high * lowValue) / (highValue - lowValue);
				const value = x - ratio * this.rootIntercept - gain * this.couplingTorque(x);
				if (Math.abs(value) <= ROOT_TOLERANCE * (1 + Math.abs(x))) break;
				if (value < 0) {
					low = x;
					lowValue = value;
					if (side === -1) highValue /= 2;
					side = -1;
				} else {
					high = x;
					highValue = value;
					if (side === 1) lowValue /= 2;
					side = 1;
				}
			}
		}
		lowTorque = this.couplingTorque(x);
		this.clutchOutputTorque = lowTorque;
		return ratio * this.efficiency * lowTorque;
	}

	/**
	 * Torque na entrada do câmbio (N·m) com ela a `inputSpeed` (rad/s) no fim do passo; grava a rotação do motor e
	 * se a embreagem trava. Travada se o torque que leva o motor à mesma rotação couber na capacidade.
	 */
	private couplingTorque(inputSpeed: number): number {
		const commands = this.commands!;
		const capacity = Math.max(0, commands.clutchTorque);
		if (inputSpeed > 0) {
			const lockTorque =
				this.engine.torque(inputSpeed, commands.throttle, commands.torqueMultiplier) -
				(this.engineInertia * (inputSpeed - this.initialEngineSpeed)) / this.dt;
			if (Math.abs(lockTorque) <= capacity) {
				this.solvedLocked = true;
				this.solvedEngineSpeed = inputSpeed;
				return lockTorque;
			}
			const sign = lockTorque > 0 ? 1 : -1;
			this.solvedLocked = false;
			this.solvedEngineSpeed = this.solveEngineSpeed(inputSpeed, sign * capacity, true);
		} else {
			this.solvedLocked = false;
			this.solvedEngineSpeed = this.solveEngineSpeed(inputSpeed, capacity, true);
		}
		const engineSpeed = this.solvedEngineSpeed;
		const friction = engineSpeed > inputSpeed ? capacity : -capacity;
		return this.fluidTorque(engineSpeed, inputSpeed, true) + (engineSpeed === inputSpeed ? 0 : friction);
	}

	/**
	 * Rotação do motor no fim do passo (rad/s, ≥ 0) com o torque da embreagem fixo e o do conversor com a entrada a
	 * `inputSpeed`: J·(ω − ω0)/dt = Tmotor(ω) − Tbomba(ω) − Tembreagem, decrescente em ω
	 * @param clutchTorque torque da embreagem no motor (N·m; positivo freia o motor)
	 */
	private solveEngineSpeed(inputSpeed: number, clutchTorque: number, coupled: boolean): number {
		const start = this.initialEngineSpeed;
		const reach = (this.dt * (this.torqueBound + Math.abs(clutchTorque))) / this.engineInertia + 1;
		let low: number;
		let high: number;
		if (coupled && clutchTorque < 0) {
			low = 0;
			high = Math.max(0, inputSpeed);
		} else if (coupled && clutchTorque > 0) {
			low = Math.max(0, inputSpeed);
			high = Math.max(low, start) + reach;
		} else {
			low = 0;
			high = start + reach;
		}
		let lowValue = this.engineBalance(low, inputSpeed, clutchTorque, coupled);
		if (lowValue <= 0) return low;
		let highValue = this.engineBalance(high, inputSpeed, clutchTorque, coupled);
		if (highValue >= 0) return high;
		let side = 0;
		let x = low;
		for (let i = 0; i < MAX_ROOT_ITERATIONS; i++) {
			x = (low * highValue - high * lowValue) / (highValue - lowValue);
			const value = this.engineBalance(x, inputSpeed, clutchTorque, coupled);
			if (Math.abs(value) <= ROOT_TOLERANCE * this.torqueBound) break;
			if (value > 0) {
				low = x;
				lowValue = value;
				if (side === -1) highValue /= 2;
				side = -1;
			} else {
				high = x;
				highValue = value;
				if (side === 1) lowValue /= 2;
				side = 1;
			}
		}
		return x;
	}

	/** Resíduo da equação do motor (N·m): torque líquido menos o que a inércia absorve no passo */
	private engineBalance(engineSpeed: number, inputSpeed: number, clutchTorque: number, coupled: boolean): number {
		const commands = this.commands!;
		let torque = this.engine.torque(engineSpeed, commands.throttle, commands.torqueMultiplier);
		torque -= (this.engineInertia * (engineSpeed - this.initialEngineSpeed)) / this.dt;
		if (coupled) torque -= this.fluidTorque(engineSpeed, inputSpeed, false) + clutchTorque;
		return torque;
	}

	/** Torque do conversor (N·m): na turbina (`turbine`) ou na bomba; 0 sem conversor ou desacoplado */
	private fluidTorque(engineSpeed: number, inputSpeed: number, turbine: boolean): number {
		const converter = this.converter;
		const coupling = this.commands!.converterCoupling;
		if (!converter || coupling <= 0) return 0;
		return (
			coupling *
			(turbine ? converter.turbineTorque(engineSpeed, inputSpeed) : converter.pumpTorque(engineSpeed, inputSpeed))
		);
	}

	/** Velocidade cinemática do nó (rad/s): da roda (estado ou passo resolvido) ou f·ωA + (1 − f)·ωB */
	private kinematicSpeed(
		node: DriveNode,
		wheels: readonly Readonly<WheelState>[] | null,
		steps: readonly Readonly<WheelStep>[] | null,
	): number {
		if (node.wheel >= 0) return wheels ? wheels[node.wheel].angularVelocity : steps![node.wheel].angularVelocity;
		const split = node.config!.torqueSplit;
		return (
			split * this.kinematicSpeed(node.a!, wheels, steps) +
			(1 - split) * this.kinematicSpeed(node.b!, wheels, steps)
		);
	}

	private resetNode(node: DriveNode): void {
		node.torque = 0;
		node.transfer = 0;
		if (node.a) this.resetNode(node.a);
		if (node.b) this.resetNode(node.b);
	}
}

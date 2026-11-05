import * as THREE from "three";
import { VehicleDefinition } from "../data/vehicles/types";
import { createRaycastHit, PhysicsBody, PhysicsWorld, QuatLike, RaycastHit, Vec3Like } from "../physics/PhysicsWorld";
import { aerodynamicDragImpulse } from "./aerodynamics";
import Driveline, { DrivelineCommands } from "./Driveline";
import { RAD_PER_SECOND_TO_RPM } from "./Engine";
import { gearRatio } from "./Powertrain";
import Suspension from "./Suspension";
import Tire from "./Tire";
import { VehicleCommands } from "./VehicleControl";
import { VehicleState } from "./VehicleState";
import { createVehicleTelemetry, createWheelTelemetry, STANDARD_GRAVITY, VehicleTelemetry } from "./VehicleTelemetry";
import WheelDynamics, {
	createWheelState,
	createWheelStep,
	WheelState,
	WheelStep,
	WheelStepInput,
} from "./WheelDynamics";

/** Valores de uma roda no passo anterior, para a interpolação visual */
export interface WheelStepState {
	/** Comprimento da suspensão (m) */
	previousSuspensionLength: number;
	/** Esterço (rad) */
	previousSteering: number;
	/** Giro acumulado (rad) */
	previousRotation: number;
}

/** Estado dinâmico do chassi no mundo (m, m/s, rad/s) */
export interface ChassisState {
	position: Vec3Like;
	rotation: QuatLike;
	linearVelocity: Vec3Like;
	angularVelocity: Vec3Like;
}

/**
 * Física de um veículo sobre o corpo rígido (ADR-0003): chassi (corpo dinâmico + cuboid), suspensão por roda
 * (raio pelo PhysicsWorld, impulso no ponto de fixação) e pneus próprios (WheelDynamics: roda com inércia e
 * curva de Pacejka, impulso no ponto de contato, nos eixos da roda projetados no plano de contato) acoplados ao trem
 * de força (Driveline: motor, embreagem ou conversor, câmbio e diferenciais).
 * Rodas 0/1 dianteiras (esterçam), 2/3 traseiras. Dono do chassi; `destroy()` o remove do mundo.
 * Eixos do chassi (ADR-0002): frente +X, cima +Y, direita +Z; THREE só para matemática.
 */
export default class VehiclePhysics {
	readonly chassisBody: PhysicsBody;
	readonly wheels: WheelStepState[] = [];
	readonly telemetry: VehicleTelemetry = createVehicleTelemetry();
	readonly suspension: Suspension;
	readonly tire: Tire;
	/** Estado de cada roda (velocidade angular, giro, escorregamento, forças do pneu) */
	readonly wheelStates: WheelState[] = [];
	readonly driveline: Driveline;

	private readonly wheelDynamics: WheelDynamics;
	/** Passo de cada roda (preparado e resolvido a cada passo de física) */
	private readonly wheelSteps: WheelStep[] = [];
	private readonly suspensionRestLength: number;
	/** Pontos de fixação da suspensão (m, eixos locais do chassi) */
	private readonly connectionPoints: THREE.Vector3[] = [];
	private readonly hits: RaycastHit[] = [];
	/** Rodas que recebem o torque do motor */
	private readonly driven: boolean[] = [];
	/** Esterço por roda (rad) */
	private readonly steering: number[] = [];
	/** Torque máximo de freio por roda (N·m) */
	private readonly brakeTorques: number[] = [];
	/** Comandos do trem de força do passo */
	private readonly drivelineCommands: DrivelineCommands = {
		throttle: 0,
		torqueMultiplier: 1,
		gearRatio: 0,
		clutchTorque: 0,
		converterCoupling: 0,
	};
	/** Inércias do chassi em rolagem (eixo X) e arfagem (eixo Z), as da caixa uniforme do collider (kg·m²) */
	private readonly rollInertia: number;
	private readonly pitchInertia: number;
	/** Comprimentos da suspensão do último passo valem para o estado atual (falso após escrever o estado do chassi) */
	private suspensionLengthsValid = false;
	private readonly stepInput: WheelStepInput = {
		longitudinalSpeed: 0,
		lateralSpeed: 0,
		normalLoad: 0,
		driveTorque: 0,
		brakeTorque: 0,
		inertia: 0,
		longitudinalContactMass: 0,
		lateralContactMass: 0,
	};
	private tempVector3 = new THREE.Vector3();
	private tempVelocity = new THREE.Vector3();
	private tempQuaternion = new THREE.Quaternion();
	private tempRight = new THREE.Vector3();
	private tempImpulse = new THREE.Vector3();
	private tempPosition = new THREE.Vector3();
	private tempHardPoint = new THREE.Vector3();
	private tempDirection = new THREE.Vector3();
	private tempPointVelocity = new THREE.Vector3();
	private tempGroundVelocity = new THREE.Vector3();
	private tempNormal = new THREE.Vector3();
	/** Frente e direita de cada roda no plano de contato, no último passo (unitárias, mundo) */
	private readonly wheelForward: THREE.Vector3[] = [];
	private readonly wheelRight: THREE.Vector3[] = [];
	private previousVelocity = new THREE.Vector3();
	private hasPreviousVelocity = false;

	static readonly LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
	static readonly LOCAL_DOWN = new THREE.Vector3(0, -1, 0);
	static readonly LOCAL_RIGHT = new THREE.Vector3(0, 0, 1);

	constructor(
		private readonly physicsWorld: PhysicsWorld,
		private readonly definition: VehicleDefinition,
	) {
		const physicsData = definition.physics;
		const chassisSize = physicsData.size;
		this.suspensionRestLength = physicsData.suspensionRestLength;
		this.suspension = new Suspension(
			definition.suspension,
			physicsData.suspensionRestLength,
			definition.wheels.adjustments.length,
		);
		this.tire = new Tire(definition.tire);
		const half = { x: chassisSize.x / 2, y: chassisSize.y / 2, z: chassisSize.z / 2 };
		this.rollInertia = (physicsData.mass / 3) * (half.y * half.y + half.z * half.z);
		this.pitchInertia = (physicsData.mass / 3) * (half.x * half.x + half.y * half.y);
		this.wheelDynamics = new WheelDynamics(this.tire, physicsData.wheelRadius);
		for (let i = 0; i < definition.wheels.adjustments.length; i++) this.wheelSteps.push(createWheelStep());
		this.driveline = new Driveline(definition, this.wheelDynamics, this.wheelSteps);

		this.chassisBody = physicsWorld.createRigidBody({
			type: "dynamic",
			position: { x: 0, y: 1, z: 3 },
			linearDamping: 0.01,
			angularDamping: 0.01,
			canSleep: false,
			ccdEnabled: true,
		});

		physicsWorld.createCollider(
			{
				shape: "cuboid",
				halfExtents: {
					x: chassisSize.x / 2,
					y: chassisSize.y / 2,
					z: chassisSize.z / 2,
				},
				friction: 0.5,
				restitution: 0.1,
				density: physicsData.mass / (chassisSize.x * chassisSize.y * chassisSize.z),
				centerOfMass: physicsData.centerOfMass,
			},
			this.chassisBody,
		);

		definition.wheels.adjustments.forEach((wheel, index) => {
			this.connectionPoints.push(new THREE.Vector3(wheel.position.x, wheel.position.y, wheel.position.z));
			this.hits.push(createRaycastHit());
			this.wheelForward.push(new THREE.Vector3(1, 0, 0));
			this.wheelRight.push(new THREE.Vector3(0, 0, 1));
			this.wheelStates.push(createWheelState());
			this.driven.push(this.driveline.isDriven(index));
			this.steering.push(0);
			this.brakeTorques.push(0);
			this.wheels.push({
				previousSuspensionLength: physicsData.suspensionRestLength,
				previousSteering: 0,
				previousRotation: 0,
			});
			this.telemetry.wheels.push(createWheelTelemetry(physicsData.suspensionRestLength));
		});
	}

	/** Guarda os valores das rodas antes do passo (início do pré-passo) */
	savePreviousWheelStates(): void {
		for (let i = 0; i < this.wheels.length; i++) {
			const wheel = this.wheels[i];
			wheel.previousSuspensionLength = this.wheelSuspensionLength(i);
			wheel.previousSteering = this.wheelSteering(i);
			wheel.previousRotation = this.wheelRotation(i);
		}
	}

	/**
	 * Guarda os comandos para as rodas (esterço nas dianteiras, freio de mão substitui o freio nas traseiras) e para
	 * o trem de força, e aplica o arrasto ao chassi
	 * @param dt passo de física (s): o arrasto vira impulso por passo (N·s)
	 */
	applyCommands(commands: VehicleCommands, dt: number): void {
		const rearBrake = commands.handbrakeTorque > 0 ? commands.handbrakeTorque : commands.rearBrakeTorque;
		for (let i = 0; i < this.steering.length; i++) {
			const front = i < 2;
			this.steering[i] = front ? commands.steeringAngle : 0;
			this.brakeTorques[i] = front ? commands.frontBrakeTorque : rearBrake;
		}
		const driveline = this.drivelineCommands;
		driveline.throttle = commands.throttle;
		driveline.torqueMultiplier = commands.torqueMultiplier;
		driveline.gearRatio = commands.gearRatio;
		driveline.clutchTorque = commands.clutchTorque;
		driveline.converterCoupling = commands.converterCoupling;
		this.applyAerodynamicDrag(dt);
	}

	/** Arrasto aerodinâmico oposto à velocidade do chassi, como impulso no centro de massa (N·s) */
	private applyAerodynamicDrag(dt: number): void {
		const velocity = this.chassisBody.getLinearVelocity(this.tempVelocity);
		this.chassisBody.applyImpulse(
			aerodynamicDragImpulse(this.definition.aerodynamics, velocity, dt, this.tempImpulse),
		);
	}

	/**
	 * Suspensão, pneus e depois os impulsos de todas as rodas; chamar no pré-passo, antes de `world.step()`.
	 * Todas as forças vêm do mesmo estado do chassi (nenhuma roda vê o impulso de outra), então o resultado não
	 * depende da ordem das rodas e um carro simétrico continua simétrico.
	 */
	updateVehicle(dt: number): void {
		this.updateSuspension(dt);
		this.updateTires(dt);
		this.applyWheelImpulses(dt);
	}

	/**
	 * Mede cada roda com um raio da fixação ao longo da suspensão (ignorando o chassi) e calcula as forças.
	 * Velocidade de compressão pela variação do comprimento no último passo (roda sem contato conta como estendida):
	 * a velocidade do corpo ao fim do passo não é a média do passo (subpassos do motor) e daria força de amortecimento
	 * em repouso. Logo após escrever o estado do chassi, vem da velocidade do corpo.
	 */
	private updateSuspension(dt: number): void {
		const chassis = this.chassisBody;
		const position = chassis.getPosition(this.tempPosition);
		const rotation = chassis.getRotation(this.tempQuaternion);
		const direction = this.tempDirection.copy(VehiclePhysics.LOCAL_DOWN).applyQuaternion(rotation);
		const radius = this.definition.physics.wheelRadius;
		const rayLength = this.suspensionRestLength + radius;

		for (let i = 0; i < this.connectionPoints.length; i++) {
			const hardPoint = this.tempHardPoint.copy(this.connectionPoints[i]).applyQuaternion(rotation).add(position);
			const hit = this.hits[i];
			if (this.physicsWorld.castRayWithNormal(hardPoint, direction, rayLength, hit, chassis)) {
				const length = Math.min(this.suspensionRestLength, Math.max(0, hit.distance - radius));
				const compressionRate = this.suspensionLengthsValid
					? (this.suspension.wheels[i].length - length) / dt
					: this.compressionRateFromVelocity(hardPoint, direction, hit);
				this.suspension.setContact(i, true, length, compressionRate);
			} else {
				this.suspension.setContact(i, false, this.suspensionRestLength, 0);
			}
		}
		this.suspensionLengthsValid = true;

		this.suspension.computeForces();
	}

	/**
	 * Impulsos (N·s) de cada roda em contato: suspensão ao longo da normal no ponto de fixação, pneu nos eixos da roda
	 * no ponto de contato
	 */
	private applyWheelImpulses(dt: number): void {
		const chassis = this.chassisBody;
		const position = chassis.getPosition(this.tempPosition);
		const rotation = chassis.getRotation(this.tempQuaternion);
		for (let i = 0; i < this.connectionPoints.length; i++) {
			const wheel = this.suspension.wheels[i];
			if (!wheel.inContact) continue;
			const hit = this.hits[i];
			const normal = hit.normal;
			const impulse = wheel.force * dt;
			this.tempImpulse.set(normal.x * impulse, normal.y * impulse, normal.z * impulse);
			const hardPoint = this.tempHardPoint.copy(this.connectionPoints[i]).applyQuaternion(rotation).add(position);
			chassis.applyImpulseAtPoint(this.tempImpulse, hardPoint);

			const state = this.wheelStates[i];
			this.tempImpulse
				.copy(this.wheelForward[i])
				.multiplyScalar(state.longitudinalForce * dt)
				.addScaledVector(this.wheelRight[i], state.lateralForce * dt);
			chassis.applyImpulseAtPoint(this.tempImpulse, hit.point);
		}
	}

	/**
	 * Velocidade de compressão (m/s) pela velocidade relativa ao longo da normal / cos(normal, suspensão):
	 * deslizar sobre o chão não comprime; com a suspensão quase paralela ao chão (cos > −0,1) é zero
	 */
	private compressionRateFromVelocity(hardPoint: THREE.Vector3, direction: THREE.Vector3, hit: RaycastHit): number {
		const velocity = this.chassisBody.getVelocityAtPoint(hardPoint, this.tempPointVelocity);
		if (hit.body) velocity.sub(hit.body.getVelocityAtPoint(hit.point, this.tempGroundVelocity));
		const normal = hit.normal;
		const normalDotDirection = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
		const normalSpeed = normal.x * velocity.x + normal.y * velocity.y + normal.z * velocity.z;
		return normalDotDirection < -0.1 ? normalSpeed / normalDotDirection : 0;
	}

	/**
	 * Pneus: velocidade do contato nos eixos da roda (frente esterçada e direita, projetadas no plano de contato),
	 * carga da suspensão deste passo e freio → WheelDynamics.prepare; as rodas livres são resolvidas sem torque e as
	 * motrizes pelo trem de força (Driveline); forças aplicadas depois.
	 * A massa do contato é a fração, pela carga da roda, da massa efetiva do chassi para um impulso horizontal no
	 * chão: 1 / (1/m + h²/I), com h a altura do centro de massa sobre o contato e I a inércia de rolagem (lateral)
	 * ou de arfagem (longitudinal). Sem isso o pneu, que em baixa velocidade zera o escorregamento no passo,
	 * passaria do ponto (o impulso no chão também gira o chassi). Roda sem contato só gira.
	 */
	private updateTires(dt: number): void {
		const chassis = this.chassisBody;
		const rotation = chassis.getRotation(this.tempQuaternion);
		const mass = this.definition.physics.mass;
		const centerOfMass = this.tempVector3
			.copy(this.definition.physics.centerOfMass)
			.applyQuaternion(rotation)
			.add(chassis.getPosition(this.tempPosition));
		const up = this.tempDirection.set(0, 1, 0).applyQuaternion(rotation);
		const wheelInertia = this.definition.physics.wheelInertia;
		const input = this.stepInput;

		let totalLoad = 0;
		for (let i = 0; i < this.suspension.wheels.length; i++) totalLoad += this.suspension.wheels[i].force;

		for (let i = 0; i < this.wheelStates.length; i++) {
			const suspension = this.suspension.wheels[i];
			const load = suspension.inContact ? suspension.force : 0;
			input.driveTorque = 0;
			input.brakeTorque = this.brakeTorques[i];
			input.inertia = wheelInertia;
			input.normalLoad = load;
			input.longitudinalContactMass = 0;
			input.lateralContactMass = 0;
			input.longitudinalSpeed = 0;
			input.lateralSpeed = 0;

			if (load <= 0) {
				this.prepareWheel(i, input, dt);
				continue;
			}

			const hit = this.hits[i];
			const height =
				(centerOfMass.x - hit.point.x) * up.x +
				(centerOfMass.y - hit.point.y) * up.y +
				(centerOfMass.z - hit.point.z) * up.z;
			const share = load / totalLoad;
			input.longitudinalContactMass = share / (1 / mass + (height * height) / this.pitchInertia);
			input.lateralContactMass = share / (1 / mass + (height * height) / this.rollInertia);
			const normal = this.tempNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
			const steer = this.steering[i];
			const forward = this.wheelForward[i].set(Math.cos(steer), 0, -Math.sin(steer)).applyQuaternion(rotation);
			forward.addScaledVector(normal, -forward.dot(normal)).normalize();
			const right = this.wheelRight[i].crossVectors(forward, normal);

			const velocity = chassis.getVelocityAtPoint(hit.point, this.tempPointVelocity);
			if (hit.body) velocity.sub(hit.body.getVelocityAtPoint(hit.point, this.tempGroundVelocity));
			input.longitudinalSpeed = velocity.dot(forward);
			input.lateralSpeed = velocity.dot(right);

			this.prepareWheel(i, input, dt);
		}

		this.driveline.step(this.drivelineCommands, dt);
		for (let i = 0; i < this.wheelStates.length; i++)
			this.wheelDynamics.commit(this.wheelStates[i], this.wheelSteps[i]);
	}

	private prepareWheel(index: number, input: Readonly<WheelStepInput>, dt: number): void {
		const step = this.wheelSteps[index];
		this.wheelDynamics.prepare(this.wheelStates[index], input, dt, step);
		if (!this.driven[index]) this.wheelDynamics.solve(step, 0, false);
	}

	/**
	 * Atualiza a telemetria com o resultado do último passo; chamar no início do pré-passo
	 * @param dt passo de física (s)
	 * @param state estado do veículo no último passo (rotação e marcha)
	 */
	updateTelemetry(dt: number, state: Readonly<VehicleState>): void {
		const telemetry = this.telemetry;
		const driveline = this.driveline;
		telemetry.engineRpm = driveline.engineRpm();
		telemetry.gear = state.gear;
		telemetry.clutchSlipRpm =
			(driveline.engineSpeed - this.drivelineCommands.gearRatio * driveline.outputSpeed(this.wheelStates)) *
			RAD_PER_SECOND_TO_RPM;
		telemetry.clutchLocked = driveline.clutchLocked;
		const throttle = this.drivelineCommands.throttle;
		telemetry.engineLoad = driveline.engine.effectiveThrottle(telemetry.engineRpm, throttle);
		telemetry.revLimiterActive = throttle > 0 && driveline.engine.revLimiterCut(telemetry.engineRpm) > 0;
		const velocity = this.chassisBody.getLinearVelocity(this.tempVelocity);
		this.chassisBody.getRotation(this.tempQuaternion);
		const forward = this.tempVector3.copy(VehiclePhysics.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);
		const right = this.tempRight.copy(VehiclePhysics.LOCAL_RIGHT).applyQuaternion(this.tempQuaternion);

		telemetry.timeStep = dt;
		telemetry.speed = velocity.length();
		telemetry.forwardSpeed = velocity.dot(forward);
		telemetry.lateralSpeed = velocity.dot(right);

		if (this.hasPreviousVelocity && dt > 0) {
			const previous = this.previousVelocity;
			const ax = (velocity.x - previous.x) / dt;
			const ay = (velocity.y - previous.y) / dt;
			const az = (velocity.z - previous.z) / dt;
			telemetry.longitudinalAccelerationG = (ax * forward.x + ay * forward.y + az * forward.z) / STANDARD_GRAVITY;
			telemetry.lateralAccelerationG = (ax * right.x + ay * right.y + az * right.z) / STANDARD_GRAVITY;
		} else {
			telemetry.longitudinalAccelerationG = 0;
			telemetry.lateralAccelerationG = 0;
		}
		this.previousVelocity.copy(velocity);
		this.hasPreviousVelocity = true;

		telemetry.steeringAngle = this.wheelSteering(0);
		for (let i = 0; i < telemetry.wheels.length; i++) {
			const wheel = telemetry.wheels[i];
			const suspension = this.suspension.wheels[i];
			const tire = this.wheelStates[i];
			wheel.inContact = suspension.inContact;
			wheel.suspensionLength = suspension.length;
			wheel.compression = suspension.compression;
			wheel.suspensionForce = suspension.force;
			wheel.forwardImpulse = tire.longitudinalForce * dt;
			wheel.sideImpulse = tire.lateralForce * dt;
			wheel.steering = this.wheelSteering(i);
			wheel.angularVelocity = tire.angularVelocity;
			wheel.slipRatio = tire.slipRatio;
			wheel.slipAngle = tire.slipAngle;
			wheel.longitudinalForce = tire.longitudinalForce;
			wheel.lateralForce = tire.lateralForce;
			wheel.driveTorque = this.driven[i] ? this.wheelSteps[i].driveTorque : 0;
			wheel.normalizedSlip = Math.hypot(
				tire.slipRatio / this.tire.peakSlipRatio,
				tire.slipAngle / this.tire.peakSlipAngle,
			);
		}
	}

	/** Velocidade do chassi ao longo de +X local (m/s; negativa em ré) */
	forwardSpeed(): number {
		const velocity = this.chassisBody.getLinearVelocity(this.tempVelocity);
		this.chassisBody.getRotation(this.tempQuaternion);
		const forward = this.tempVector3.copy(VehiclePhysics.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);
		return velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
	}

	/**
	 * Velocidade da saída do câmbio em unidades de banda de rodagem ω·r (m/s; negativa em ré): média das rodas
	 * motrizes pela cinemática dos diferenciais (no central, ponderada pela repartição de torque)
	 */
	drivenWheelSpeed(): number {
		return this.driveline.outputSpeed(this.wheelStates) * this.definition.physics.wheelRadius;
	}

	/** Rotação do motor (rpm) */
	engineRpm(): number {
		return this.driveline.engineRpm();
	}

	/** Comprimento atual da suspensão (m) */
	wheelSuspensionLength(index: number): number {
		return this.suspension.wheels[index]?.length ?? this.suspensionRestLength;
	}

	/** Esterço atual (rad) */
	wheelSteering(index: number): number {
		return this.steering[index] ?? 0;
	}

	/** Giro acumulado (rad) */
	wheelRotation(index: number): number {
		return this.wheelStates[index]?.rotation ?? 0;
	}

	wheelIsInContact(index: number): boolean {
		return this.suspension.wheels[index]?.inContact ?? false;
	}

	/** Teleporta 1 m acima, nivelado e parado, com as rodas paradas */
	reset(): void {
		const currentPos = this.chassisBody.getPosition(this.tempVector3);
		this.chassisBody.setPosition({ x: currentPos.x, y: currentPos.y + 1, z: currentPos.z });
		this.chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 });
		this.chassisBody.setLinearVelocity({ x: 0, y: 0, z: 0 });
		this.chassisBody.setAngularVelocity({ x: 0, y: 0, z: 0 });
		this.physicsWorld.resetInterpolation(this.chassisBody);
		this.hasPreviousVelocity = false;
		this.suspensionLengthsValid = false;
		for (const wheel of this.wheelStates) wheel.angularVelocity = 0;
		this.driveline.resetIterationStart();
	}

	captureChassisState<T extends ChassisState>(out: T): T {
		this.chassisBody.getPosition(out.position);
		this.chassisBody.getRotation(out.rotation);
		this.chassisBody.getLinearVelocity(out.linearVelocity);
		this.chassisBody.getAngularVelocity(out.angularVelocity);
		return out;
	}

	/**
	 * Escreve o estado no chassi; o motor pode normalizar a rotação, então aplicar o mesmo estado dá o mesmo resultado.
	 * As rodas passam a rolar sem escorregar na velocidade do chassi no ponto de fixação e o motor gira na rotação da
	 * marcha `gear` (se dada; senão a do último comando): só depende do estado escrito.
	 */
	applyChassisState(state: Readonly<ChassisState & { gear?: number }>): void {
		this.chassisBody.setPosition(state.position);
		this.chassisBody.setRotation(state.rotation);
		this.chassisBody.setLinearVelocity(state.linearVelocity);
		this.chassisBody.setAngularVelocity(state.angularVelocity);
		this.suspensionLengthsValid = false;
		this.syncWheelSpeeds();
		const ratio =
			state.gear === undefined
				? this.drivelineCommands.gearRatio
				: gearRatio(this.definition.powertrain, state.gear);
		this.driveline.synchronize(this.wheelStates, ratio);
	}

	/** Velocidade angular de cada roda = velocidade do chassi no ponto de fixação, ao longo da frente, / raio */
	private syncWheelSpeeds(): void {
		const chassis = this.chassisBody;
		const position = chassis.getPosition(this.tempPosition);
		const rotation = chassis.getRotation(this.tempQuaternion);
		const forward = this.tempVector3.copy(VehiclePhysics.LOCAL_FORWARD).applyQuaternion(rotation);
		const radius = this.definition.physics.wheelRadius;
		for (let i = 0; i < this.wheelStates.length; i++) {
			const hardPoint = this.tempHardPoint.copy(this.connectionPoints[i]).applyQuaternion(rotation).add(position);
			const velocity = chassis.getVelocityAtPoint(hardPoint, this.tempPointVelocity);
			this.wheelStates[i].angularVelocity = velocity.dot(forward) / radius;
		}
	}

	/** Teleporta o chassi para o estado dado, sem interpolar a partir da pose anterior */
	restoreChassisState(state: Readonly<ChassisState & { gear?: number }>): void {
		this.applyChassisState(state);
		this.physicsWorld.resetInterpolation(this.chassisBody);
		this.hasPreviousVelocity = false;
	}

	/** Remove o chassi (corpo e colisor) do mundo */
	destroy(): void {
		this.physicsWorld.removeRigidBody(this.chassisBody);
	}
}

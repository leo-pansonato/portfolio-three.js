import * as THREE from "three";

/**
 * Contrato da física (ARCHITECTURE §5). Só o adaptador (RapierPhysicsWorld) conhece o motor.
 * Unidades SI e eixos do ADR-0002: m, kg, s, N, rad; mundo destro com +Y para cima, gravidade em −Y.
 * Corpos, colisores e controladores pertencem ao mundo que os criou; quem cria remove.
 */

export interface Vec3Like {
	x: number;
	y: number;
	z: number;
}

export interface QuatLike {
	x: number;
	y: number;
	z: number;
	w: number;
}

export type RigidBodyType = "dynamic" | "static" | "kinematicPositionBased" | "kinematicVelocityBased";

export interface RigidBodyConfig {
	type: RigidBodyType;
	/** Posição inicial no mundo (m) */
	position: Vec3Like;
	rotation?: QuatLike;
	/** Amortecimento linear (1/s) */
	linearDamping?: number;
	/** Amortecimento angular (1/s) */
	angularDamping?: number;
	canSleep?: boolean;
	ccdEnabled?: boolean;
}

export interface ColliderConfig {
	shape: "box" | "cuboid" | "ball" | "capsule" | "cylinder";
	/** Meias-dimensões de box/cuboid (m) */
	halfExtents?: Vec3Like;
	/** Raio de ball/capsule/cylinder (m) */
	radius?: number;
	/** Meia-altura de capsule/cylinder (m) */
	halfHeight?: number;
	friction?: number;
	restitution?: number;
	/** Densidade (kg/m³): define a massa do corpo */
	density?: number;
	/**
	 * Centro de massa em eixos locais do colisor (m); sem ele, o centro geométrico (densidade uniforme).
	 * Só box/cuboid com densidade: a massa continua densidade × volume e a inércia é a da caixa uniforme.
	 */
	centerOfMass?: Vec3Like;
	/** Offset local em relação ao corpo (m) */
	translation?: Vec3Like;
	rotation?: QuatLike;
	/**
	 * Soma dos módulos das forças de contato (N) a partir da qual um contato deste colisor gera ContactForceEvent;
	 * sem ela, não gera
	 */
	contactForceThreshold?: number;
}

/** Corpo rígido. Leituras escrevem em `out` e o devolvem; escritas acordam o corpo. */
export interface PhysicsBody {
	/** Posição do centro no mundo (m) */
	getPosition<T extends Vec3Like>(out: T): T;
	getRotation<T extends QuatLike>(out: T): T;
	/** Velocidade linear no mundo (m/s) */
	getLinearVelocity<T extends Vec3Like>(out: T): T;
	/** Velocidade angular no mundo (rad/s) */
	getAngularVelocity<T extends Vec3Like>(out: T): T;
	setPosition(position: Vec3Like): void;
	setRotation(rotation: QuatLike): void;
	setLinearVelocity(velocity: Vec3Like): void;
	/** Velocidade angular no mundo (rad/s) */
	setAngularVelocity(velocity: Vec3Like): void;
	/** Impulso no centro de massa, em eixos do mundo (N·s): muda a velocidade linear em impulso/massa na hora */
	applyImpulse(impulse: Vec3Like): void;
	/** Impulso (N·s) aplicado num ponto do mundo (m): muda as velocidades linear e angular na hora */
	applyImpulseAtPoint(impulse: Vec3Like, point: Vec3Like): void;
	/** Velocidade (m/s) do ponto do mundo (m) solidário ao corpo */
	getVelocityAtPoint<T extends Vec3Like>(point: Vec3Like, out: T): T;
}

/** Resultado de um raio; reescrito no lugar por castRayWithNormal */
export interface RaycastHit {
	/** Distância ao longo do raio (m, com direção unitária) */
	distance: number;
	/** Ponto atingido no mundo (m) */
	point: Vec3Like;
	/** Normal da superfície atingida, unitária, em eixos do mundo */
	normal: Vec3Like;
	/** Corpo dono do colisor atingido; null se o colisor não tem corpo */
	body: PhysicsBody | null;
}

export function createRaycastHit(): RaycastHit {
	return { distance: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, body: null };
}

/** Contato que passou do limiar de força num passo; reescrito no lugar a cada update */
export interface ContactForceEvent {
	/** Corpos donos dos dois colisores; null se o colisor não tem corpo */
	bodyA: PhysicsBody | null;
	bodyB: PhysicsBody | null;
	/** Soma dos módulos dos impulsos de contato entre os dois colisores no passo (N·s) */
	impulse: number;
	/** Média dos pontos de contato no mundo (m) */
	point: Vec3Like;
}

export function createContactForceEvent(): ContactForceEvent {
	return { bodyA: null, bodyB: null, impulse: 0, point: { x: 0, y: 0, z: 0 } };
}

/** Alvo da pose interpolada (ex.: THREE.Object3D) */
export interface PoseTarget {
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
}

export interface PhysicsObjectCounts {
	bodies: number;
	colliders: number;
}

/**
 * Mundo físico em passo fixo com interpolação da pose dos corpos registrados.
 */
export interface PhysicsWorld {
	/** Passo fixo da simulação (s) */
	readonly fixedTimeStep: number;

	/** Avança por passos fixos o tempo acumulado (s) e aplica as poses interpoladas aos alvos registrados */
	update(deltaTime: number): void;
	/** Chamado antes de cada passo com o passo fixo (s) */
	addPreStepCallback(callback: (dt: number) => void): void;
	removePreStepCallback(callback: (dt: number) => void): void;

	createRigidBody(config: RigidBodyConfig): PhysicsBody;
	/** Remove o corpo, seus colisores e o registro de interpolação */
	removeRigidBody(body: PhysicsBody): void;
	createCollider(config: ColliderConfig, body: PhysicsBody): void;
	/** Chão: cuboid fino com a superfície em y = 0, de −halfSize a +halfSize (m) em X e Z */
	createGroundCollider(body: PhysicsBody, friction?: number, halfSize?: number): void;

	/** Registra o corpo para interpolação; corpos não estáticos têm a pose aplicada ao alvo a cada update */
	addEntity(body: PhysicsBody, target: PoseTarget): void;
	/** Fração do passo ainda não simulada (0–1) */
	getInterpolationAlpha(): number;
	/** Pose entre os dois últimos passos; false se o corpo não foi registrado com addEntity */
	getInterpolatedPose(body: PhysicsBody, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): boolean;
	/** Descarta a pose anterior após teleporte */
	resetInterpolation(body: PhysicsBody): void;

	/**
	 * Primeiro colisor atingido por um raio (corpos sólidos: distância 0 se a origem está dentro)
	 * @param direction direção no mundo; com vetor unitário, a distância devolvida é em m
	 * @returns distância ao longo do raio, ou null
	 */
	castRay(origin: Vec3Like, direction: Vec3Like, maxDistance: number): number | null;

	/**
	 * Primeiro colisor atingido por um raio, com ponto, normal e corpo; corpos sólidos (distância 0 se a origem está dentro).
	 * Vê os colisores como estavam no fim do último passo.
	 * @param direction direção no mundo, unitária
	 * @param maxDistance comprimento do raio (m)
	 * @param out reescrito só quando há acerto
	 * @param excludeBody corpo cujos colisores o raio ignora (ex.: o próprio chassi)
	 * @returns true se atingiu algo
	 */
	castRayWithNormal(
		origin: Vec3Like,
		direction: Vec3Like,
		maxDistance: number,
		out: RaycastHit,
		excludeBody?: PhysicsBody,
	): boolean;

	/**
	 * Eventos de força de contato dos passos do último update, na ordem (até um limite por update; o excesso é
	 * descartado). Válidos até o próximo update.
	 */
	contactEventCount(): number;
	getContactEvent(index: number): Readonly<ContactForceEvent>;

	countObjects(): PhysicsObjectCounts;
	dispose(): void;
}

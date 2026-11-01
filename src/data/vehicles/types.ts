/**
 * Contrato `VehicleDefinition` (ARCHITECTURE §5): dados imutáveis de um modelo de veículo.
 * Unidades SI e eixos do chassi conforme o ADR-0002 (frente +X, cima +Y, direita +Z).
 * Estado de runtime fica em `VehicleState` (src/vehicle), nunca aqui.
 */

export enum CameraMode {
	THIRD_PERSON = "THIRD_PERSON",
	HOOD = "HOOD",
	FIRST_PERSON = "FIRST_PERSON",
}

export interface CameraConfig {
	distance: number; // Distancia atrás do carro
	height: number; // Altura relativa ao chão/carro
	fov: number; // Campo de visão
	lerpSpeed: number; // Quão rápido a camera segue (1 = instantaneo, 0.05 = pesado)
	lookAtOffset: { y: number; x?: number; z?: number }; // Para olhar um pouco acima do centro do carro
	offset?: { x: number; y: number; z: number }; // Ajuste fino para câmera de capô/interior
}

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/**
 * Configuração de física do veículo para Rapier DynamicRayCastVehicleController
 */
export interface VehiclePhysicsConfig {
	/** Massa do chassi (kg) */
	mass: number;
	/** Collider do chassi (m): x comprimento (frente +X), y altura, z largura */
	size: Vec3;
	/** Raio das rodas (m) */
	wheelRadius: number;
	/** Rigidez da suspensão por kg de chassi (N/m/kg = 1/s²), modelo Bullet */
	suspensionStiffness: number;
	/** Comprimento de repouso da suspensão (m) */
	suspensionRestLength: number;
	/** Curso máximo a partir do repouso (m) */
	maxSuspensionTravel: number;
	/** Força máxima da suspensão por roda (N) */
	maxSuspensionForce: number;
	/** Amortecimento na compressão por kg de chassi (1/s) */
	suspensionCompression: number;
	/** Amortecimento na extensão por kg de chassi (1/s) */
	suspensionRelaxation: number;
	/** Limite de atrito do pneu (adimensional, multiplica a carga normal) */
	frictionSlip: number;
	/** Multiplicador do impulso lateral (adimensional) */
	sideFrictionStiffness: number;
}

export type TractionDisplacement = "rear" | "front" | "all";

/** Parâmetros de condução */
export interface VehicleDrivingConfig {
	/** Sem uso (não há limitador de velocidade) */
	maxSpeed: number;
	/** Força do motor por roda motriz (N) */
	maxForce: number;
	/** Multiplicador da força do motor com boost (adimensional) */
	maxBoostForce: number;
	/** Freio por roda (N) */
	brakeForce: number;
	/** Freio sem acelerador nem freio, por roda (N) */
	rollingResistance: number;
	/** Freio de mão por roda traseira (N) */
	eBrakeForce: number;
	/** Esterço máximo (rad) */
	maxSteerVal: number;
	/** Velocidade do volante em direção ao alvo (rad/s) */
	steerSpeed: number;
	/** Velocidade de retorno ao centro (rad/s) */
	steerReturn: number;
	tractionDisplacement: TractionDisplacement;
}

export interface WheelDefinition {
	/** Conexão da suspensão no chassi (m, eixos locais) */
	position: Vec3;
	/** Ajuste de rotação do modelo visual (rad) */
	rotation: Vec3;
	frictionSlip?: number;
	sideFrictionStiffness?: number;
}

export interface VehicleDefinition {
	body: {
		modelPath: string;
		scale: Vec3;
		/** Ajuste do modelo visual em relação ao chassi (m, eixos locais) */
		position: Vec3;
		/** Ajuste de rotação do modelo visual (rad) */
		rotation: Vec3;
		materials: Record<string, { castShadow: boolean; receiveShadow: boolean }>;
	};
	physics: VehiclePhysicsConfig;
	cameraSettings: Record<CameraMode, CameraConfig>;
	configs: VehicleDrivingConfig;
	wheels: {
		modelPath: string;
		scale: Vec3;
		/** Por roda: 0/1 dianteiras esquerda (-Z)/direita (+Z), 2/3 traseiras */
		adjustments: WheelDefinition[];
	};
}

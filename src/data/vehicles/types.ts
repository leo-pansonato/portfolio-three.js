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

/** Chassi e rodas (ADR-0003); pneus em VehicleTireConfig */
export interface VehiclePhysicsConfig {
	/** Massa do chassi (kg) */
	mass: number;
	/** Collider do chassi (m): x comprimento (frente +X), y altura, z largura */
	size: Vec3;
	/** Centro de massa em relação ao centro do collider do chassi (m, eixos locais) */
	centerOfMass: Vec3;
	/** Raio das rodas (m) */
	wheelRadius: number;
	/** Inércia de cada roda com pneu, disco e cubo, em torno do eixo (kg·m²) */
	wheelInertia: number;
	/** Comprimento livre da suspensão, da fixação ao centro da roda; também a extensão máxima (m) */
	suspensionRestLength: number;
}

/**
 * Suspensão por roda (ADR-0003, etapa 2), em unidades absolutas.
 * Compressão medida a partir do comprimento livre (`physics.suspensionRestLength`), que é também a extensão máxima.
 */
export interface VehicleSuspensionConfig {
	/** Rigidez da mola linear por roda (N/m) */
	springRate: number;
	/** Amortecimento na compressão por roda (N·s/m) */
	compressionDamping: number;
	/** Amortecimento na extensão por roda (N·s/m) */
	reboundDamping: number;
	/** Fim de curso: compressão máxima a partir do comprimento livre (m) */
	maxCompression: number;
	/** Batente: começa a atuar a esta distância do fim de curso (m) */
	bumpStopLength: number;
	/** Batente progressivo: força = rigidez × penetração² (N/m²) */
	bumpStopStiffness: number;
	/** Barra estabilizadora por eixo: força por diferença de compressão entre as rodas do eixo (N/m) */
	antiRollStiffness: { front: number; rear: number };
}

/**
 * Curva de Pacejka simplificada: F = D·sin(C·atan(B·x − E·(B·x − atan(B·x)))), com D = μ·Fz.
 * x é o escorregamento longitudinal (adimensional) ou o ângulo de deriva (rad), conforme a curva.
 */
export interface PacejkaCurve {
	/** B: rigidez (1/unidade de x) */
	stiffness: number;
	/** C: forma (adimensional, 1–2); a força com escorregamento grande tende a D·sin(C·π/2) */
	shape: number;
	/** μ: atrito de pico (adimensional), D = μ·Fz */
	peakFriction: number;
	/** E: curvatura (adimensional, ≤ 1) */
	curvature: number;
}

/** Pneu (ADR-0003, etapa 3): curvas longitudinal e lateral, atrito combinado por escorregamento normalizado */
export interface VehicleTireConfig {
	/** x = escorregamento longitudinal (ω·r − vx) / |vx| */
	longitudinal: PacejkaCurve;
	/** x = ângulo de deriva (rad) */
	lateral: PacejkaCurve;
	/** Velocidade mínima no denominador do escorregamento (m/s): evita a singularidade parado */
	lowSpeedThreshold: number;
}

export type TractionDisplacement = "rear" | "front" | "all";

/** Ponto da curva de torque a plena carga */
export interface TorqueCurvePoint {
	/** Rotação do motor (rpm) */
	rpm: number;
	/** Torque no virabrequim (N·m) */
	torque: number;
}

/** Atrito interno e bombeamento do motor sem acelerador (freio-motor), interpolado linearmente na rotação */
export interface EngineFrictionConfig {
	/** Torque de arrasto na marcha lenta (N·m, ≥ 0) */
	idleTorque: number;
	/** Torque de arrasto no corte de giro (N·m, ≥ 0) */
	revLimitTorque: number;
}

/**
 * Embreagem de atrito entre o motor e o câmbio (ADR-0003, etapa 4): a de partida do câmbio de dupla embreagem
 * ou a de travamento do conversor. Trava quando o torque que iguala as rotações cabe na capacidade.
 */
export interface VehicleClutchConfig {
	/** Capacidade com a embreagem fechada (N·m no virabrequim) */
	maxTorque: number;
	/**
	 * Começa a fechar nesta rotação e fecha de todo em `engagementRpm` (rpm): pela entrada do câmbio rodando e, sem
	 * conversor, também pelo motor com acelerador (arrancada)
	 */
	engagementStartRpm: number;
	/** Rotação em que a embreagem fica toda fechada (rpm) */
	engagementRpm: number;
}

/** Conversor de torque hidrodinâmico (ADR-0003, etapa 4) */
export interface TorqueConverterConfig {
	/** Rotação de estol (rpm): com a turbina parada, o motor a plena carga para nela; define a capacidade */
	stallRpm: number;
	/** Multiplicação de torque com a turbina parada (adimensional, ≥ 1) */
	stallTorqueRatio: number;
	/** Relação turbina/bomba em que a multiplicação acaba (ponto de acoplamento, 0–1) */
	couplingSpeedRatio: number;
}

/**
 * Diferencial com embreagem de bloqueio (ADR-0003, etapa 4). Saídas A (dianteira no central, esquerda no de eixo)
 * e B; τ é o torque transferido de A para B, limitado em |τ| ≤ pré-carga + bloqueio × |torque de entrada|.
 * Com bloqueio, pré-carga e acoplamento viscoso nulos é um diferencial aberto.
 */
export interface DifferentialConfig {
	/** Fração do torque de entrada para a saída A com o diferencial livre (0–1; 0,5 nos de eixo) */
	torqueSplit: number;
	/** τ máximo sem torque de entrada (N·m) */
	preloadTorque: number;
	/** Bloqueio por torque tracionando: τ máximo por |torque de entrada| (adimensional) */
	powerLocking: number;
	/** Bloqueio por torque em desaceleração (freio-motor) (adimensional) */
	coastLocking: number;
	/** Bloqueio por diferença de velocidade: τ = c·(ωA − ωB) (N·m·s/rad) */
	viscousCoupling: number;
}

/** Diferenciais usados conforme a tração: eixo traseiro e/ou dianteiro e, na integral, o central */
export interface VehicleDifferentialsConfig {
	front?: DifferentialConfig;
	rear?: DifferentialConfig;
	/** Saída A = eixo dianteiro, B = traseiro */
	center?: DifferentialConfig;
}

/** Trem de força: motor, embreagem ou conversor, câmbio automático e diferenciais (ADR-0003, etapas 1 e 4) */
export interface VehiclePowertrainConfig {
	/** Curva de torque a plena carga, em rpm crescente; interpolação linear */
	torqueCurve: TorqueCurvePoint[];
	/** Marcha lenta (rpm) */
	idleRpm: number;
	/** Corte de giro: sem torque a partir desta rotação (rpm) */
	revLimitRpm: number;
	/** Sobe de marcha a partir desta rotação (rpm) */
	upshiftRpm: number;
	/** Desce de marcha abaixo desta rotação, se a marcha de baixo ficar abaixo de upshiftRpm (rpm) */
	downshiftRpm: number;
	/** Relações das marchas à frente, da 1ª à última (adimensional) */
	gearRatios: number[];
	/** Relação da ré (adimensional, positiva) */
	reverseRatio: number;
	/** Relação do diferencial (adimensional) */
	finalDriveRatio: number;
	/** Eficiência da transmissão, do virabrequim às rodas (0–1) */
	efficiency: number;
	/** Inércia rotacional do motor, volante e embreagem no virabrequim (kg·m²) */
	engineInertia: number;
	/** Troca de marcha: torque cortado e intervalo mínimo entre trocas (s) */
	shiftTime: number;
	/** Limitador eletrônico de velocidade (m/s) */
	topSpeed: number;
	/** Multiplicador do torque com boost (adimensional, 1–1,5) */
	boostTorqueMultiplier: number;
	/** Freio-motor */
	friction: EngineFrictionConfig;
	/** Embreagem de partida ou de travamento do conversor */
	clutch: VehicleClutchConfig;
	/** Conversor de torque; ausente no câmbio de dupla embreagem */
	torqueConverter?: TorqueConverterConfig;
	differentials: VehicleDifferentialsConfig;
}

/** Aerodinâmica: arrasto 0,5·ρ·Cd·A·v² oposto à velocidade */
export interface VehicleAerodynamicsConfig {
	/** Coeficiente de arrasto Cd (adimensional) */
	dragCoefficient: number;
	/** Área frontal A (m²) */
	frontalArea: number;
}

/** Parâmetros de condução */
export interface VehicleDrivingConfig {
	/** Torque de freio por roda com o pedal no fundo, por eixo (N·m) */
	brakeTorque: { front: number; rear: number };
	/** Torque de freio sem acelerador nem freio, por roda (N·m) */
	rollingResistanceTorque: number;
	/** Torque do freio de mão por roda traseira (N·m) */
	handbrakeTorque: number;
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
}

/** Som do motor por amostras (P2-11, ADR-0007) */
export interface VehicleSoundConfig {
	/** Manifesto do banco de áudio do motor (URL relativa à página, gerado por tools/audio) */
	engineBank: string;
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
	suspension: VehicleSuspensionConfig;
	tire: VehicleTireConfig;
	powertrain: VehiclePowertrainConfig;
	aerodynamics: VehicleAerodynamicsConfig;
	sound: VehicleSoundConfig;
	cameraSettings: Record<CameraMode, CameraConfig>;
	configs: VehicleDrivingConfig;
	wheels: {
		modelPath: string;
		scale: Vec3;
		/** Por roda: 0/1 dianteiras esquerda (-Z)/direita (+Z), 2/3 traseiras */
		adjustments: WheelDefinition[];
	};
}

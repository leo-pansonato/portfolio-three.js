import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { devMode } from "./DevModeManager";
import PhysicsDebugRenderer from "./PhysicsDebugRenderer";

/**
 * Configuração para criar um RigidBody
 */
export interface RigidBodyConfig {
	type: "dynamic" | "static" | "kinematicPositionBased" | "kinematicVelocityBased";
	position: { x: number; y: number; z: number };
	rotation?: { x: number; y: number; z: number; w: number };
	mass?: number;
	linearDamping?: number;
	angularDamping?: number;
	canSleep?: boolean;
	ccdEnabled?: boolean;
}

/**
 * Configuração para criar um Collider
 */
export interface ColliderConfig {
	shape: "box" | "ball" | "capsule" | "cylinder" | "cuboid" | "trimesh" | "heightfield";
	// Para box/cuboid
	halfExtents?: { x: number; y: number; z: number };
	// Para ball
	radius?: number;
	// Para capsule/cylinder
	halfHeight?: number;
	// Propriedades físicas
	friction?: number;
	restitution?: number;
	density?: number;
	// Offset local
	translation?: { x: number; y: number; z: number };
	rotation?: { x: number; y: number; z: number; w: number };
}

/**
 * Par de RigidBody e Mesh para sincronização
 */
interface PhysicsEntity {
	rigidBody: RAPIER.RigidBody;
	mesh: THREE.Object3D;
}

/**
 * Gerenciador de física usando Rapier (WASM)
 * 
 * IMPORTANTE: Deve ser inicializado de forma assíncrona antes de usar.
 * Use PhysicsManager.create(scene) ao invés do construtor.
 */
export default class PhysicsManager {
	private scene: THREE.Scene;
	public world!: RAPIER.World;
	private debugRenderer: PhysicsDebugRenderer | null = null;

	private entities: PhysicsEntity[] = [];

	private readonly fixedTimeStep: number = 1 / 60.0;
	private accumulator: number = 0;

	// Callbacks para serem chamados antes de cada step da física
	private preStepCallbacks: Array<(dt: number) => void> = [];

	// Grupos de colisão
	public static readonly COLLISION_GROUP_GROUND = 0x0001;
	public static readonly COLLISION_GROUP_VEHICLE = 0x0002;
	public static readonly COLLISION_GROUP_OBSTACLE = 0x0004;
	public static readonly COLLISION_GROUP_ALL = 0xFFFF;

	/**
	 * Construtor privado - use PhysicsManager.create() para instanciar
	 */
	private constructor(scene: THREE.Scene) {
		this.scene = scene;
	}

	/**
	 * Factory method assíncrono para criar o PhysicsManager
	 * Inicializa o WASM do Rapier antes de criar o mundo
	 */
	public static async create(scene: THREE.Scene): Promise<PhysicsManager> {
		// Inicializar o WASM do Rapier (OBRIGATÓRIO antes de qualquer operação)
		await RAPIER.init();

		const manager = new PhysicsManager(scene);
		manager.initWorld();

		// Inscrever no dev mode para debug
		devMode.subscribe("physics-manager", (enabled) => manager.onChangeDevMode(enabled));

		return manager;
	}

	/**
	 * Inicializa o mundo físico do Rapier
	 */
	private initWorld(): void {
		// Criar o mundo com gravidade
		const gravity = new RAPIER.Vector3(0, -9.81, 0);
		this.world = new RAPIER.World(gravity);
	}

	/**
	 * Atualiza o mundo físico e sincroniza com o visual
	 * @param deltaTime Tempo decorrido desde o último frame (segundos)
	 */
	update(deltaTime: number): void {
		// Acumular tempo
		this.accumulator += deltaTime;

		// Executar passos fixos da física
		while (this.accumulator >= this.fixedTimeStep) {
			// Executar callbacks pré-step (ex: atualizar vehicle controllers)
			for (const callback of this.preStepCallbacks) {
				callback(this.fixedTimeStep);
			}

			this.world.step();
			this.accumulator -= this.fixedTimeStep;
		}

		// Sincronizar visuais com a física
		this.syncMeshes();

		// Atualizar debugger se ativo
		this.updateDebugger();
	}

	/**
	 * Registra um callback para ser chamado antes de cada step da física
	 * Útil para atualizar vehicle controllers com timestep fixo
	 */
	addPreStepCallback(callback: (dt: number) => void): void {
		this.preStepCallbacks.push(callback);
	}

	/**
	 * Remove um callback de pré-step
	 */
	removePreStepCallback(callback: (dt: number) => void): void {
		const index = this.preStepCallbacks.indexOf(callback);
		if (index !== -1) {
			this.preStepCallbacks.splice(index, 1);
		}
	}

	/**
	 * Retorna o timestep fixo usado pela física
	 */
	getFixedTimeStep(): number {
		return this.fixedTimeStep;
	}

	/**
	 * Sincroniza as meshes visuais com os corpos físicos
	 */
	private syncMeshes(): void {
		for (const entity of this.entities) {
			const { rigidBody, mesh } = entity;

			// Pular corpos estáticos (não se movem)
			if (rigidBody.bodyType() === RAPIER.RigidBodyType.Fixed) {
				continue;
			}

			// Obter posição e rotação do Rapier
			const position = rigidBody.translation();
			const rotation = rigidBody.rotation();

			// Aplicar ao mesh
			mesh.position.set(position.x, position.y, position.z);
			mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
		}
	}

	/**
	 * Cria um RigidBody no mundo físico
	 */
	createRigidBody(config: RigidBodyConfig): RAPIER.RigidBody {
		let rigidBodyDesc: RAPIER.RigidBodyDesc;

		// Criar descritor baseado no tipo
		switch (config.type) {
			case "dynamic":
				rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
				break;
			case "static":
				rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
				break;
			case "kinematicPositionBased":
				rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
				break;
			case "kinematicVelocityBased":
				rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
				break;
			default:
				rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
		}

		// Configurar posição
		rigidBodyDesc.setTranslation(config.position.x, config.position.y, config.position.z);

		// Configurar rotação se fornecida
		if (config.rotation) {
			rigidBodyDesc.setRotation({
				x: config.rotation.x,
				y: config.rotation.y,
				z: config.rotation.z,
				w: config.rotation.w,
			});
		}

		// Configurar damping
		if (config.linearDamping !== undefined) {
			rigidBodyDesc.setLinearDamping(config.linearDamping);
		}
		if (config.angularDamping !== undefined) {
			rigidBodyDesc.setAngularDamping(config.angularDamping);
		}

		// Configurar sleep
		if (config.canSleep !== undefined) {
			rigidBodyDesc.setCanSleep(config.canSleep);
		}

		// Configurar CCD (Continuous Collision Detection)
		if (config.ccdEnabled) {
			rigidBodyDesc.setCcdEnabled(true);
		}

		// Criar e retornar o RigidBody
		return this.world.createRigidBody(rigidBodyDesc);
	}

	/**
	 * Cria um Collider e o associa a um RigidBody
	 */
	createCollider(config: ColliderConfig, rigidBody: RAPIER.RigidBody): RAPIER.Collider {
		let colliderDesc: RAPIER.ColliderDesc;

		// Criar descritor baseado na forma
		switch (config.shape) {
			case "box":
			case "cuboid":
				if (!config.halfExtents) {
					throw new Error("halfExtents é obrigatório para shape box/cuboid");
				}
				colliderDesc = RAPIER.ColliderDesc.cuboid(
					config.halfExtents.x,
					config.halfExtents.y,
					config.halfExtents.z
				);
				break;

			case "ball":
				if (config.radius === undefined) {
					throw new Error("radius é obrigatório para shape ball");
				}
				colliderDesc = RAPIER.ColliderDesc.ball(config.radius);
				break;

			case "capsule":
				if (config.halfHeight === undefined || config.radius === undefined) {
					throw new Error("halfHeight e radius são obrigatórios para shape capsule");
				}
				colliderDesc = RAPIER.ColliderDesc.capsule(config.halfHeight, config.radius);
				break;

			case "cylinder":
				if (config.halfHeight === undefined || config.radius === undefined) {
					throw new Error("halfHeight e radius são obrigatórios para shape cylinder");
				}
				colliderDesc = RAPIER.ColliderDesc.cylinder(config.halfHeight, config.radius);
				break;

			default:
				throw new Error(`Shape não suportada: ${config.shape}`);
		}

		// Configurar propriedades físicas
		if (config.friction !== undefined) {
			colliderDesc.setFriction(config.friction);
		}
		if (config.restitution !== undefined) {
			colliderDesc.setRestitution(config.restitution);
		}
		if (config.density !== undefined) {
			colliderDesc.setDensity(config.density);
		}

		// Configurar offset local
		if (config.translation) {
			colliderDesc.setTranslation(config.translation.x, config.translation.y, config.translation.z);
		}
		if (config.rotation) {
			colliderDesc.setRotation({
				x: config.rotation.x,
				y: config.rotation.y,
				z: config.rotation.z,
				w: config.rotation.w,
			});
		}

		// Criar e retornar o Collider associado ao RigidBody
		return this.world.createCollider(colliderDesc, rigidBody);
	}

	/**
	 * Cria um collider de plano infinito (ground)
	 * No Rapier, usamos um cuboid muito grande e fino para simular um plano
	 */
	createGroundCollider(rigidBody: RAPIER.RigidBody, friction: number = 0.8): RAPIER.Collider {
		const colliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100)
			.setFriction(friction)
			.setRestitution(0.0)
			.setTranslation(0, -0.1, 0); // Posicionar a superfície no y=0

		return this.world.createCollider(colliderDesc, rigidBody);
	}

	/**
	 * Adiciona um par RigidBody-Mesh para sincronização automática
	 */
	addEntity(rigidBody: RAPIER.RigidBody, mesh: THREE.Object3D): void {
		this.entities.push({ rigidBody, mesh });
	}

	/**
	 * Remove uma entidade da sincronização e do mundo físico
	 */
	removeEntity(rigidBody: RAPIER.RigidBody): void {
		const index = this.entities.findIndex((e) => e.rigidBody === rigidBody);
		if (index !== -1) {
			this.entities.splice(index, 1);
			this.world.removeRigidBody(rigidBody);
		}
	}

	/**
	 * Obtém o RigidBody associado a uma mesh
	 */
	getRigidBodyForMesh(mesh: THREE.Object3D): RAPIER.RigidBody | null {
		const entity = this.entities.find((e) => e.mesh === mesh);
		return entity ? entity.rigidBody : null;
	}

	/**
	 * Ativa o debug renderer
	 */
	addDebugger(): void {
		if (!this.debugRenderer && this.scene) {
			this.debugRenderer = new PhysicsDebugRenderer(this.scene, this.world);
		}
	}

	/**
	 * Atualiza o debug renderer
	 */
	updateDebugger(): void {
		if (this.debugRenderer) {
			this.debugRenderer.update();
		}
	}

	/**
	 * Remove o debug renderer
	 */
	removeDebugger(): void {
		if (this.debugRenderer) {
			this.debugRenderer.dispose();
			this.debugRenderer = null;
		}
	}

	/**
	 * Callback para mudança do modo de desenvolvimento
	 */
	onChangeDevMode(enabled: boolean): void {
		if (enabled) {
			this.addDebugger();
		} else {
			this.removeDebugger();
		}
	}

	/**
	 * Realiza um raycast no mundo físico
	 */
	castRay(
		origin: { x: number; y: number; z: number },
		direction: { x: number; y: number; z: number },
		maxDistance: number
	): RAPIER.RayColliderHit | null {
		const ray = new RAPIER.Ray(
			new RAPIER.Vector3(origin.x, origin.y, origin.z),
			new RAPIER.Vector3(direction.x, direction.y, direction.z)
		);

		return this.world.castRay(ray, maxDistance, true);
	}

	/**
	 * Obtém a instância do Rapier para uso externo
	 */
	getRapier(): typeof RAPIER {
		return RAPIER;
	}

	/**
	 * Limpa todos os recursos
	 */
	dispose(): void {
		this.removeDebugger();
		this.entities = [];
		// O mundo do Rapier é gerenciado pelo WASM, não precisa de dispose manual
	}
}

import * as CANNON from "cannon-es";
import CannonDebugger from "cannon-es-debugger";
import * as THREE from "three";
import { devMode } from "./DevModeManager";

interface IDebugger {
	update: () => void;
	destroy: () => void;
}

/**
 * Gerenciador de física usando Cannon.js
 */
export default class PhysicsManager {
	private scene: THREE.Scene;
	public world: CANNON.World;
	private debugger: IDebugger | null;

	private groundMaterial: CANNON.Material;
	private wheelMaterial: CANNON.Material;

	private bodies: CANNON.Body[];
	private meshes: THREE.Object3D[];

	private readonly fixedTimeStep: number = 1 / 120.0; // fisica roda a 120Hz
	private readonly maxSubSteps: number = 20; // limite de passos por frame

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.world = new CANNON.World();
		this.world.gravity.set(0, -9.82, 0);
		this.world.defaultContactMaterial.friction = 0.002;

		this.world.broadphase = new CANNON.SAPBroadphase(this.world);
		this.world.allowSleep = true;

		this.debugger = null;

		this.groundMaterial = new CANNON.Material("ground");
		this.wheelMaterial = new CANNON.Material("wheel");

		const wheelGroundContact = new CANNON.ContactMaterial(this.wheelMaterial, this.groundMaterial, {
			friction: 0.005,
			restitution: 0.3,
			contactEquationStiffness: 1000,
		});
		this.world.addContactMaterial(wheelGroundContact);

		this.bodies = [];
		this.meshes = [];

		devMode.subscribe("physics-manager", (enabled) => this.onChangeDevMode(enabled));
	}

	/**
	 * Atualiza o mundo físico e sincroniza com o visual
	 * @param deltaTime Tempo decorrido desde o último frame
	 */
	update(deltaTime: number): void {
		// passo da física
		this.world.step(this.fixedTimeStep, deltaTime, this.maxSubSteps);

		// sincronizar visuais
		for (let i = 0; i < this.bodies.length; i++) {
			const body = this.bodies[i];
			const mesh = this.meshes[i];

			// Copia posição e rotação do corpo físico para o mesh visual
			mesh.position.set(body.position.x, body.position.y, body.position.z);
			mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		}

		// atualizar Debugger
		this.updateDebugger();
	}

	addDebugger(): void {
		if (!this.debugger && this.scene) {
			// @ts-ignore
			this.debugger = new CannonDebugger(this.scene, this.world, {
				color: 0x00ff00,
				scale: 1,
			});
		}
	}

	updateDebugger(): void {
		if (this.debugger) {
			this.debugger.update();
		}
	}

	removeDebugger(): void {
		if (this.debugger) {
			this.scene.remove(this.debugger as unknown as THREE.Object3D); // Não funciona
			// this.debugger.disable(); // Não implementado ainda
			this.debugger = null;
		}
	}

	onChangeDevMode(enabled: boolean): void {
		if (enabled) {
			this.addDebugger();
		} else {
			this.removeDebugger();
		}
	}

	addBody(body: CANNON.Body, mesh: THREE.Object3D): void {
		this.world.addBody(body);
		this.bodies.push(body);
		this.meshes.push(mesh);
	}

	removeBody(body: CANNON.Body): void {
		const index = this.bodies.indexOf(body);
		if (index !== -1) {
			this.world.removeBody(body);
			this.bodies.splice(index, 1);
			this.meshes.splice(index, 1);
		}
	}

	getGroundMaterial(): CANNON.Material {
		return this.groundMaterial;
	}

	getWheelMaterial(): CANNON.Material {
		return this.wheelMaterial;
	}
}

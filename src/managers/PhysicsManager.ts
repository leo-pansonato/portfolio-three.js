import * as THREE from "three";
import * as CANNON from "cannon-es";
import CannonDebugger from "cannon-es-debugger";

// Interface auxiliar para o debugger (que muitas vezes não tem tipos)
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

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.world = new CANNON.World();
		this.world.gravity.set(0, -9.82, 0); // Gravidade padrão
		this.world.defaultContactMaterial.friction = 0.002;
		// @ts-ignore: SAPBroadphase pode ter tipos conflitantes dependendo da versão, mas funciona
		this.world.broadphase = new CANNON.SAPBroadphase(this.world);
		this.world.allowSleep = true;

		this.debugger = null;

		// Materiais para interação entre rodas e solo
		this.groundMaterial = new CANNON.Material("ground");
		this.wheelMaterial = new CANNON.Material("wheel");

		// Configurar contato entre materiais
		const wheelGroundContact = new CANNON.ContactMaterial(this.wheelMaterial, this.groundMaterial, {
			friction: 0.005,
			restitution: 0.3,
			contactEquationStiffness: 1000,
		});
		this.world.addContactMaterial(wheelGroundContact);

		this.bodies = [];
		this.meshes = [];
	}

	update(deltaTime: number): void {
		// Limitando o delta time para evitar problemas
		const timeStep = Math.min(deltaTime, 1 / 30);

		// Atualizar as posições dos meshes baseado nos corpos físicos
		for (let i = 0; i < this.bodies.length; i++) {
			const body = this.bodies[i];
			const mesh = this.meshes[i];

			mesh.position.set(body.position.x, body.position.y, body.position.z);
			mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		}

		// Atualizar o mundo físico
		this.world.step(timeStep);
	}

	addDebugger(): void {
		if (!this.debugger && this.scene) {
			// @ts-ignore: CannonDebugger types compatibility check
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
			this.debugger.destroy();
			this.debugger = null;
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

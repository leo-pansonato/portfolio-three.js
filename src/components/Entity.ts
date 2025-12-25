import * as THREE from "three";
import GameComponent from "./GameComponent";

/**
 * Classe base para entidades de jogo
 */
export default class Entity extends GameComponent {
	protected scene: THREE.Scene;
	public mesh: THREE.Object3D | THREE.Group | null;

	constructor(scene: THREE.Scene) {
		super();
		this.scene = scene;
		this.mesh = null;
	}

	addToScene(): void {
		if (this.mesh && this.scene) {
			this.scene.add(this.mesh);
		}
	}

	removeFromScene(mesh: THREE.Object3D | null = this.mesh): void {
		if (mesh && this.scene) {
			this.scene.remove(mesh);
		}
	}

	getPosition(): THREE.Vector3 | null {
		return this.mesh ? this.mesh.position : null;
	}

	getRotation(): THREE.Euler | null {
		return this.mesh ? this.mesh.rotation : null;
	}

   getQuaternion(): THREE.Quaternion | null {
      return this.mesh ? this.mesh.quaternion : null;
   }
}

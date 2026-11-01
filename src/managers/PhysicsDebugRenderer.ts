import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

/**
 * Renderizador de debug para visualizar colliders do Rapier usando Three.js
 * Desenha wireframes dos colliders para facilitar o debug da física
 */
export default class PhysicsDebugRenderer {
	private scene: THREE.Scene;
	private world: RAPIER.World;
	private mesh: THREE.LineSegments;
	private geometry: THREE.BufferGeometry;
	private material: THREE.LineBasicMaterial;

	constructor(scene: THREE.Scene, world: RAPIER.World) {
		this.scene = scene;
		this.world = world;

		// Criar geometria vazia
		this.geometry = new THREE.BufferGeometry();

		// Material para as linhas de debug
		this.material = new THREE.LineBasicMaterial({
			color: 0x00ff00,
			vertexColors: true,
		});

		// Criar o mesh de linhas
		this.mesh = new THREE.LineSegments(this.geometry, this.material);
		this.mesh.frustumCulled = false; // Sempre renderizar

		// Adicionar à cena
		this.scene.add(this.mesh);
	}

	/**
	 * Atualiza a visualização dos colliders
	 */
	update(): void {
		// Obter buffers de debug do Rapier
		const { vertices, colors } = this.world.debugRender();

		// Atualizar geometria
		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(vertices, 3)
		);
		this.geometry.setAttribute(
			"color",
			new THREE.BufferAttribute(colors, 4)
		);

		// Forçar atualização
		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.color.needsUpdate = true;
	}

	/**
	 * Remove o renderer da cena e limpa recursos
	 */
	dispose(): void {
		this.scene.remove(this.mesh);
		this.geometry.dispose();
		this.material.dispose();
	}

	/**
	 * Altera a cor das linhas de debug
	 */
	setColor(color: number): void {
		this.material.color.setHex(color);
	}

	/**
	 * Mostra/esconde o debug renderer
	 */
	setVisible(visible: boolean): void {
		this.mesh.visible = visible;
	}
}

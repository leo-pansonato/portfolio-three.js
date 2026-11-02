import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

/** Escreve a pose a desenhar para o corpo (interpolada para corpos registrados) */
export type DebugPoseSource = (
	body: RAPIER.RigidBody,
	outPosition: THREE.Vector3,
	outQuaternion: THREE.Quaternion,
) => void;

/**
 * Wireframe dos colisores da Rapier no modo dev. A geometria de cada colisor é criada uma vez
 * no espaço do corpo; por quadro só a pose do grupo do corpo muda, na mesma interpolação das meshes.
 */
export default class PhysicsDebugRenderer {
	private root = new THREE.Group();
	private material = new THREE.LineBasicMaterial({ color: 0x00ff00 });
	private bodyGroups = new Map<number, { body: RAPIER.RigidBody; group: THREE.Group }>();
	private geometries: THREE.BufferGeometry[] = [];
	private dirty = true;

	constructor(
		private readonly scene: THREE.Scene,
		private readonly world: RAPIER.World,
		private readonly poseOf: DebugPoseSource,
	) {
		this.root.name = "physics-debug";
		this.scene.add(this.root);
	}

	/** Marca as geometrias para reconstrução (colisor criado ou corpo removido) */
	invalidate(): void {
		this.dirty = true;
	}

	/** Atualiza a pose de cada corpo; reconstrói as geometrias se o mundo mudou */
	update(): void {
		if (this.dirty) this.rebuild();
		for (const { body, group } of this.bodyGroups.values()) {
			this.poseOf(body, group.position, group.quaternion);
		}
	}

	private rebuild(): void {
		this.clear();
		this.world.forEachCollider((collider) => {
			const geometry = PhysicsDebugRenderer.shapeGeometry(collider);
			if (!geometry) return;
			this.geometries.push(geometry);
			const lines = new THREE.LineSegments(geometry, this.material);
			lines.frustumCulled = false;
			const parent = collider.parent();
			const localPosition = parent ? collider.translationWrtParent() : collider.translation();
			const localRotation = parent ? collider.rotationWrtParent() : collider.rotation();
			if (localPosition) lines.position.set(localPosition.x, localPosition.y, localPosition.z);
			if (localRotation) lines.quaternion.set(localRotation.x, localRotation.y, localRotation.z, localRotation.w);
			(parent ? this.groupFor(parent) : this.root).add(lines);
		});
		this.dirty = false;
	}

	private groupFor(body: RAPIER.RigidBody): THREE.Group {
		let entry = this.bodyGroups.get(body.handle);
		if (!entry) {
			entry = { body, group: new THREE.Group() };
			this.bodyGroups.set(body.handle, entry);
			this.root.add(entry.group);
		}
		return entry.group;
	}

	private static shapeGeometry(collider: RAPIER.Collider): THREE.BufferGeometry | null {
		let solid: THREE.BufferGeometry;
		switch (collider.shapeType()) {
			case RAPIER.ShapeType.Cuboid: {
				const h = collider.halfExtents();
				solid = new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
				break;
			}
			case RAPIER.ShapeType.Ball:
				solid = new THREE.SphereGeometry(collider.radius(), 12, 8);
				break;
			case RAPIER.ShapeType.Cylinder:
				solid = new THREE.CylinderGeometry(collider.radius(), collider.radius(), collider.halfHeight() * 2, 16);
				break;
			case RAPIER.ShapeType.Capsule:
				solid = new THREE.CapsuleGeometry(collider.radius(), collider.halfHeight() * 2, 4, 12);
				break;
			default:
				return null;
		}
		const edges = new THREE.EdgesGeometry(solid, 1);
		solid.dispose();
		return edges;
	}

	private clear(): void {
		for (const geometry of this.geometries) geometry.dispose();
		this.geometries = [];
		this.bodyGroups.clear();
		this.root.clear();
	}

	/** Remove o renderer da cena e libera a GPU */
	dispose(): void {
		this.clear();
		this.scene.remove(this.root);
		this.material.dispose();
	}
}

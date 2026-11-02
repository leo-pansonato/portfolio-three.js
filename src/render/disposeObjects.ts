import * as THREE from "three";

/** Recurso de GPU com `dispose()`: geometria, material ou textura */
export type GpuResource = THREE.BufferGeometry | THREE.Material | THREE.Texture;

/** Geometrias, materiais e texturas usados pelas meshes, linhas e pontos sob as raízes, sem repetição */
export function collectGpuResources(roots: Iterable<THREE.Object3D>, out: Set<GpuResource> = new Set()): Set<GpuResource> {
	for (const root of roots) {
		root.traverse((object) => {
			const renderable = object as Partial<THREE.Mesh>;
			if (renderable.geometry instanceof THREE.BufferGeometry) out.add(renderable.geometry);
			if (!renderable.material) return;
			const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
			for (const material of materials) {
				out.add(material);
				collectTextures(material, out);
			}
		});
	}
	return out;
}

function collectTextures(material: THREE.Material, out: Set<GpuResource>): void {
	for (const value of Object.values(material)) {
		if (value instanceof THREE.Texture) out.add(value);
	}
	const uniforms = (material as Partial<THREE.ShaderMaterial>).uniforms;
	if (!uniforms) return;
	for (const uniform of Object.values(uniforms)) {
		if (uniform?.value instanceof THREE.Texture) out.add(uniform.value);
	}
}

/**
 * Remove as raízes dos pais e libera na GPU seus recursos, exceto os compartilhados
 * @param isShared recursos de outro dono (ex.: cache do ModelLoader) que não devem ser liberados
 */
export function disposeObjects(roots: THREE.Object3D[], isShared: (resource: GpuResource) => boolean = () => false): void {
	for (const root of roots) root.removeFromParent();
	for (const resource of collectGpuResources(roots)) {
		if (!isShared(resource)) resource.dispose();
	}
}

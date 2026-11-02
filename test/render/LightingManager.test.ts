import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { devMode } from "../../src/managers/DevModeManager";
import LightingManager from "../../src/managers/LightingManager";

function createLighting() {
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
	return { scene, lighting: new LightingManager(scene, camera) };
}

afterEach(() => devMode.setEnabled(false));

describe("LightingManager", () => {
	it("alternar o modo dev duas vezes antes do primeiro quadro não lança erro", () => {
		devMode.setEnabled(false);
		const { scene, lighting } = createLighting();

		expect(() => {
			devMode.toggle();
			devMode.toggle();
			devMode.toggle();
		}).not.toThrow();
		expect(scene.children.filter((child) => child.type === "Group")).toHaveLength(1);

		lighting.update(1 / 60);
		devMode.toggle();
		expect(scene.children.filter((child) => child.type === "Group")).toHaveLength(0);
		lighting.dispose();
	});

	it("dispose remove luzes e helper da cena, libera os shadow maps e para de configurar materiais", () => {
		devMode.setEnabled(true);
		const { scene, lighting } = createLighting();
		lighting.update(1 / 60);
		const lights = scene.children.filter(
			(child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight,
		);
		const shadowMap = new THREE.WebGLRenderTarget(1, 1);
		let shadowMapsDisposed = 0;
		shadowMap.addEventListener("dispose", () => shadowMapsDisposed++);
		lights[0].shadow.map = shadowMap;

		lighting.dispose();

		expect(lights).toHaveLength(4);
		expect(scene.children).toHaveLength(0);
		expect(shadowMapsDisposed).toBe(1);

		const material = new THREE.MeshStandardMaterial();
		scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
		expect(material.defines?.USE_CSM).toBeUndefined();

		devMode.toggle();
		expect(scene.children).toHaveLength(1);
	});
});

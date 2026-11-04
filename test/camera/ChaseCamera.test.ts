import * as THREE from "three";
import { describe, expect, it } from "vitest";
import ChaseCamera, { CameraRaycast, ChaseFraming } from "../../src/camera/ChaseCamera";
import { SpringState, stepCriticalSpring, wrapAngle } from "../../src/camera/criticalSpring";
import { createRaycastHit } from "../../src/physics/PhysicsWorld";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";

const FRAMING: ChaseFraming = { distance: 5, height: 1.6, lookAtHeight: 1, fov: 60 };
const UP = new THREE.Vector3(0, 1, 0);

interface CarPose {
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	velocity: THREE.Vector3;
	angularVelocity: THREE.Vector3;
}

function createPose(): CarPose {
	return {
		position: new THREE.Vector3(),
		quaternion: new THREE.Quaternion(),
		velocity: new THREE.Vector3(),
		angularVelocity: new THREE.Vector3(),
	};
}

/** Rumo h (rad) com frente (cos h, 0, sin h): guinada para a direita é rotação negativa em +Y */
function setHeading(pose: CarPose, heading: number): void {
	pose.quaternion.setFromAxisAngle(UP, -heading);
}

/** Carro em linha reta no rumo 0, com velocidade v(t) e posição x(t) dadas */
function straight(x: number, v: number) {
	return (pose: CarPose) => {
		pose.position.set(x, 0, 0);
		pose.velocity.set(v, 0, 0);
		pose.angularVelocity.set(0, 0, 0);
		setHeading(pose, 0);
	};
}

/** Círculo de raio R (m) a ω (rad/s) para a direita, partindo da origem no rumo 0 */
function circle(t: number, radius: number, omega: number, pose: CarPose): void {
	const h = omega * t;
	pose.position.set(radius * Math.sin(h), 0, radius * (1 - Math.cos(h)));
	pose.velocity.set(radius * omega * Math.cos(h), 0, radius * omega * Math.sin(h));
	pose.angularVelocity.set(0, -omega, 0);
	setHeading(pose, h);
}

function run(
	fps: number,
	duration: number,
	poseAt: (t: number, pose: CarPose) => void,
	camera = new ChaseCamera(),
	raycast?: CameraRaycast,
): ChaseCamera {
	const pose = createPose();
	const frames = Math.round(duration * fps);
	const dt = 1 / fps;
	poseAt(0, pose);
	camera.update(dt, pose, FRAMING, 0, 0, raycast);
	for (let i = 1; i <= frames; i++) {
		poseAt(i * dt, pose);
		camera.update(dt, pose, FRAMING, 0, 0, raycast);
	}
	return camera;
}

describe("mola crítica", () => {
	it("alvo constante: mesmo valor e taxa a 30, 60 e 144 FPS", () => {
		const results = [30, 60, 144].map((fps) => {
			const state: SpringState = { value: 0, velocity: 2 };
			for (let i = 0; i < 2 * fps; i++) stepCriticalSpring(state, 10, 0, 1 / fps, 0.2);
			return state;
		});
		for (const state of results) {
			expect(state.value).toBeCloseTo(results[0].value, 10);
			expect(state.velocity).toBeCloseTo(results[0].velocity, 10);
		}
		expect(results[0].value).toBeGreaterThan(9.99);
	});

	it("alvo em rampa: atraso 2·τ·taxa sem antecipação e nenhum com antecipação total", () => {
		const lagging: SpringState = { value: 0, velocity: 0 };
		const leading: SpringState = { value: 0, velocity: 0 };
		const dt = 1 / 60;
		for (let i = 1; i <= 600; i++) {
			stepCriticalSpring(lagging, 3 * i * dt, 3, dt, 0.25, 0);
			stepCriticalSpring(leading, 3 * i * dt, 3, dt, 0.25, 1);
		}
		expect(30 - lagging.value).toBeCloseTo(2 * 0.25 * 3, 6);
		expect(30 - leading.value).toBeCloseTo(0, 6);
	});

	it("wrapAngle fica em [−π, π)", () => {
		expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
		expect(wrapAngle(-0.5 - 4 * Math.PI)).toBeCloseTo(-0.5, 12);
	});
});

describe("ChaseCamera", () => {
	it("converge igual a 30, 60 e 144 FPS numa curva", () => {
		const cameras = [30, 60, 144].map((fps) => run(fps, 3, (t, pose) => circle(t, 50, 0.4, pose)));
		for (const camera of cameras) {
			expect(camera.position.distanceTo(cameras[0].position)).toBeLessThan(0.01);
			expect(camera.lookAt.distanceTo(cameras[0].lookAt)).toBeLessThan(0.01);
		}
	});

	it("parado: atrás do carro na distância e altura do enquadramento", () => {
		const camera = run(60, 1, (_t, pose) => straight(0, 0)(pose));
		expect(camera.position.x).toBeCloseTo(-5, 6);
		expect(camera.position.y).toBeCloseTo(1.6, 6);
		expect(camera.position.z).toBeCloseTo(0, 6);
		expect(camera.lookAt.x).toBeCloseTo(0, 6);
		expect(camera.fov).toBeCloseTo(60, 6);
	});

	it("em velocidade, distância, altura e FOV ficam fixos: o carro não sai do centro", () => {
		for (const v of [10, 40, 80]) {
			const camera = run(60, 3, (t, pose) => straight(v * t, v)(pose));
			expect(camera.position.x - v * 3).toBeCloseTo(-5, 6);
			expect(camera.position.y).toBeCloseTo(1.6, 6);
			expect(camera.lookAt.x).toBeCloseTo(v * 3, 6);
			expect(camera.fov).toBe(60);
		}
	});

	it("em curva constante, a câmera fica para fora da curva (lateral de fora visível), sem atraso da mola", () => {
		const omega = 0.5;
		const camera = run(60, 4, (t, pose) => circle(t, 40, omega, pose));
		const pose = createPose();
		circle(4, 40, omega, pose);
		const direction = new THREE.Vector3().subVectors(pose.position, camera.position);
		expect(Math.atan2(direction.z, direction.x) - omega * 4).toBeCloseTo(-0.5 * 0.25, 3);
	});

	it("o desvio na curva tem limite e não depende do escorregamento", () => {
		const spin = (pose: CarPose) => {
			straight(0, 20)(pose);
			pose.velocity.set(20 * Math.cos(-0.5), 0, 20 * Math.sin(-0.5));
			pose.angularVelocity.set(0, -3, 0);
		};
		const camera = new ChaseCamera();
		const pose = createPose();
		spin(pose);
		camera.update(1 / 60, pose, FRAMING, 0, 0);
		expect(Math.atan2(-camera.position.z, -camera.position.x)).toBeCloseTo(-0.3, 6);
	});

	it("parado e em ré, segue a frente do chassi (não vira para a frente do carro)", () => {
		const reverse = (pose: CarPose) => {
			straight(0, -8)(pose);
			setHeading(pose, 0.3);
			pose.velocity.set(-8 * Math.cos(0.3), 0, -8 * Math.sin(0.3));
		};
		const camera = run(60, 1, (_t, pose) => reverse(pose));
		expect(Math.atan2(-camera.position.z, -camera.position.x)).toBeCloseTo(0.3, 6);
	});

	it("mudança brusca de rumo é suavizada pela mola e converge", () => {
		const camera = new ChaseCamera();
		const pose = createPose();
		straight(0, 0)(pose);
		camera.update(1 / 60, pose, FRAMING, 0, 0);
		setHeading(pose, 1);
		camera.update(1 / 60, pose, FRAMING, 0, 0);
		const first = Math.atan2(-camera.position.z, -camera.position.x);
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThan(0.1);
		for (let i = 0; i < 120; i++) camera.update(1 / 60, pose, FRAMING, 0, 0);
		expect(Math.atan2(-camera.position.z, -camera.position.x)).toBeCloseTo(1, 4);
	});

	it("obstáculo entre o carro e a câmera a aproxima, sem atravessar, e ela volta depois", async () => {
		const world = await RapierPhysicsWorld.create(new THREE.Scene());
		const wall = world.createRigidBody({ type: "static", position: { x: -3, y: 2, z: 0 } });
		world.createCollider({ shape: "cuboid", halfExtents: { x: 0.25, y: 2, z: 2 } }, wall);
		world.update(world.fixedTimeStep);

		const hit = createRaycastHit();
		let blocked = true;
		const raycast: CameraRaycast = (origin, direction, maxDistance) =>
			blocked && world.castRayWithNormal(origin, direction, maxDistance, hit) ? hit.distance : null;

		const camera = new ChaseCamera();
		const pose = createPose();
		straight(0, 0)(pose);
		for (let i = 0; i < 60; i++) {
			camera.update(1 / 60, pose, FRAMING, 0, 0, raycast);
			expect(camera.position.x).toBeGreaterThan(-2.75);
		}
		expect(camera.position.x).toBeCloseTo(-2.5, 1);
		expect(camera.position.y).toBeGreaterThan(1);
		expect(camera.obstructedDistance).toBeLessThan(3);

		blocked = false;
		camera.update(1 / 60, pose, FRAMING, 0, 0, raycast);
		expect(camera.position.x).toBeGreaterThan(-2.75);
		for (let i = 0; i < 240; i++) camera.update(1 / 60, pose, FRAMING, 0, 0, raycast);
		expect(camera.position.x).toBeCloseTo(-5, 2);
		world.dispose();
	});

	it("olhar do jogador gira a câmera em volta do carro", () => {
		const camera = new ChaseCamera();
		const pose = createPose();
		straight(0, 0)(pose);
		camera.update(1 / 60, pose, FRAMING, Math.PI / 2, 0);
		expect(camera.position.z).toBeCloseTo(-5, 6);
		expect(camera.position.x).toBeCloseTo(0, 6);
	});
});

describe("módulo de câmera desacoplado", () => {
	it("src/camera não depende de DOM, cena, Player nem física", async () => {
		const { readdirSync, readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const dir = join(__dirname, "../../src/camera");
		for (const file of readdirSync(dir)) {
			const source = readFileSync(join(dir, file), "utf8");
			expect(source, file).not.toMatch(/from\s+"[^"]*(components\/|physics\/|main|render\/)[^"]*"/);
			expect(source, file).not.toMatch(/document|window|requestAnimationFrame|THREE\.Scene/);
		}
	});
});

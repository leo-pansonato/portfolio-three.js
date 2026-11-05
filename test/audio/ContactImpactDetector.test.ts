import { describe, expect, it, vi } from "vitest";
import ContactImpactDetector, {
	ContactEventSource,
	impactIntensityFromImpulse,
} from "../../src/audio/ContactImpactDetector";
import { ContactForceEvent, createContactForceEvent, PhysicsBody } from "../../src/physics/PhysicsWorld";
import { createRapierSim } from "../support/rapierSim";

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		clearCache(): void {}
	},
}));

const FRAME = 1 / 60;
const chassis = {} as PhysicsBody;
const box = {} as PhysicsBody;
const wall = {} as PhysicsBody;

/** Eventos do quadro: [outro corpo, impulso (N·s)] */
function frameEvents(...pairs: Array<[PhysicsBody | null, number, PhysicsBody?]>): ContactEventSource {
	const events: ContactForceEvent[] = pairs.map(([other, impulse, self]) => ({
		...createContactForceEvent(),
		bodyA: other,
		bodyB: self ?? chassis,
		impulse,
	}));
	return { contactEventCount: () => events.length, getContactEvent: (i) => events[i] };
}

const none = frameEvents();

describe("impactos por eventos de contato", () => {
	it("intensidade: zero abaixo do mínimo, cresce em escala log e satura", () => {
		expect(impactIntensityFromImpulse(10)).toBe(0);
		const box72 = impactIntensityFromImpulse(118);
		const box144 = impactIntensityFromImpulse(218);
		const heavy = impactIntensityFromImpulse(10000);
		expect(box72).toBeGreaterThan(0.4);
		expect(box144).toBeGreaterThan(box72);
		expect(heavy).toBeGreaterThan(0.9);
		expect(impactIntensityFromImpulse(50000)).toBe(1);
	});

	it("soa no início do contato e não repete enquanto o contato continua", () => {
		const detector = new ContactImpactDetector();
		expect(detector.update(frameEvents([box, 118]), chassis, FRAME)).toBeCloseTo(
			impactIntensityFromImpulse(118),
			12,
		);
		for (let i = 0; i < 30; i++) expect(detector.update(frameEvents([box, 5000]), chassis, FRAME)).toBe(0);
	});

	it("quadros sem passo de física (alta taxa de quadros) não quebram o contato", () => {
		const detector = new ContactImpactDetector();
		const fast = 1 / 240;
		expect(detector.update(frameEvents([box, 200]), chassis, fast)).toBeGreaterThan(0);
		for (let i = 0; i < 20; i++) {
			const events = i % 4 === 3 ? frameEvents([box, 200]) : none;
			expect(detector.update(events, chassis, fast)).toBe(0);
		}
	});

	it("contato novo depois de uma pausa soa de novo, respeitando o intervalo mínimo por par", () => {
		const detector = new ContactImpactDetector();
		expect(detector.update(frameEvents([box, 200]), chassis, FRAME)).toBeGreaterThan(0);
		for (let i = 0; i < 7; i++) detector.update(none, chassis, FRAME);
		expect(detector.update(frameEvents([box, 200]), chassis, FRAME)).toBe(0);
		for (let i = 0; i < 12; i++) detector.update(none, chassis, FRAME);
		expect(detector.update(frameEvents([box, 200]), chassis, FRAME)).toBeGreaterThan(0);
	});

	it("pares independentes; soma os eventos do par no quadro; ignora contatos de outros corpos", () => {
		const detector = new ContactImpactDetector();
		expect(detector.update(frameEvents([box, 200]), chassis, FRAME)).toBeGreaterThan(0);
		expect(detector.update(frameEvents([box, 200], [wall, 6000], [wall, 6000]), chassis, FRAME)).toBeCloseTo(
			impactIntensityFromImpulse(12000),
			12,
		);
		const other = new ContactImpactDetector();
		expect(other.update(frameEvents([box, 9000, wall]), chassis, FRAME)).toBe(0);
	});

	it.each(["bmw_f82", "mercedes_g63"])(
		"%s batendo a 72 km/h numa caixa do cenário (5 kg): um impacto audível",
		async (id) => {
			const sim = await createRapierSim(id);
			const world = sim.physicsWorld;
			for (let i = 0; i < 60; i++) sim.frame(FRAME);
			sim.input.throttle = true;
			while (sim.player.getTelemetry().forwardSpeed < 20) sim.frame(FRAME);
			sim.input.throttle = false;
			const position = sim.player.physics.chassisBody.getPosition({ x: 0, y: 0, z: 0 });
			const crate = world.createRigidBody({
				type: "dynamic",
				position: { x: position.x + 10, y: 1.5, z: position.z },
			});
			world.createCollider({ shape: "cuboid", halfExtents: { x: 1.5, y: 1.5, z: 1.5 }, density: 5 / 27 }, crate);

			const detector = new ContactImpactDetector();
			const impacts: number[] = [];
			for (let i = 0; i < 90; i++) {
				sim.frame(FRAME);
				const intensity = detector.update(world, sim.player.physics.chassisBody, FRAME);
				if (intensity > 0) impacts.push(intensity);
			}
			expect(impacts).toHaveLength(1);
			expect(impacts[0]).toBeGreaterThan(0.4);
		},
	);
});

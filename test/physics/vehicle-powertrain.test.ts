import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";
import { AIR_DENSITY, aerodynamicDragForce, aerodynamicDragImpulse } from "../../src/vehicle/aerodynamics";
import { NEUTRAL_GEAR, REVERSE_GEAR } from "../../src/vehicle/VehicleState";
import { createRapierSim, RapierSimHandle } from "../support/rapierSim";
import { SETTLE_TIME, zeroToHundredScenario } from "../support/scenarios";
import { createVehicleRig } from "../support/vehicleRig";

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		releaseModel(): void {}
		isCached(): boolean {
			return false;
		}
		clearCache(): void {}
	},
}));

/**
 * Trem de força e arrasto (ADR-0003, etapa 1) no veículo real sobre o harness.
 * Referências de fábrica: M4 F82 0–100 em 4,1 s e 250 km/h limitado (280 com M Driver's Package);
 * G63 W463A 0–100 em 4,5 s e 220 km/h limitado.
 */

const FRAME_DT = 1 / 60; // s
/** Amortecimento linear do chassi em VehiclePhysics (1/s): desacelera c·v */
const CHASSIS_LINEAR_DAMPING = 0.01;
/** Meia-largura do chão (m): a velocidade máxima leva ~5 km */
const LONG_GROUND = 8000;

const LIMITS: Record<string, { zeroToHundred: [number, number]; topSpeedKmh: [number, number] }> = {
	bmw_f82: { zeroToHundred: [3.8, 5], topSpeedKmh: [250, 300] },
	mercedes_g63: { zeroToHundred: [4.0, 6], topSpeedKmh: [210, 240] },
};

interface FullThrottleRun {
	gears: number[];
	minRpm: number;
	/** Rotação a cada quadro nos últimos 10 s (rpm) */
	finalRpm: number[];
	maxRpm: number;
	/** Velocidade do HUD a cada 10 s (km/h) */
	speedEvery10s: number[];
}

function settle(sim: RapierSimHandle): void {
	for (let i = 0; i < Math.round(SETTLE_TIME / FRAME_DT); i++) sim.frame(FRAME_DT);
}

/** Acelerador pleno por `seconds`, registrando a marcha e a rotação de cada quadro */
function fullThrottle(sim: RapierSimHandle, seconds: number): FullThrottleRun {
	const run: FullThrottleRun = {
		gears: [],
		minRpm: Infinity,
		maxRpm: -Infinity,
		finalRpm: [],
		speedEvery10s: [],
	};
	sim.input.throttle = true;
	const frames = Math.round(seconds / FRAME_DT);
	for (let i = 1; i <= frames; i++) {
		sim.frame(FRAME_DT);
		const telemetry = sim.player.getTelemetry();
		run.gears.push(telemetry.gear);
		run.minRpm = Math.min(run.minRpm, telemetry.engineRpm);
		run.maxRpm = Math.max(run.maxRpm, telemetry.engineRpm);
		if (i > frames - Math.round(10 / FRAME_DT)) run.finalRpm.push(telemetry.engineRpm);
		if (i % Math.round(10 / FRAME_DT) === 0) run.speedEvery10s.push(sim.player.getCurrentSpeed());
	}
	sim.input.throttle = false;
	return run;
}

describe.each(Object.keys(LIMITS))("veículo %s — trem de força", (vehicleId) => {
	const limits = LIMITS[vehicleId];
	const powertrain = getVehicleDefinition(vehicleId)!.powertrain;

	it("0–100 km/h dentro da faixa do carro real", async () => {
		const result = zeroToHundredScenario(await createRapierSim(vehicleId), FRAME_DT);
		const [min, max] = limits.zeroToHundred;

		expect(result.nonFinite).toBe(false);
		expect(result.time).toBeGreaterThan(min);
		expect(result.time).toBeLessThan(max);
	});

	it("velocidade máxima limitada; marchas sobem em ordem; rotação entre a lenta e o corte", async () => {
		const sim = await createRapierSim(vehicleId, undefined, LONG_GROUND);
		settle(sim);
		const run = fullThrottle(sim, 90);
		const [min, max] = limits.topSpeedKmh;
		const final = run.speedEvery10s[run.speedEvery10s.length - 1];
		const tenSecondsBefore = run.speedEvery10s[run.speedEvery10s.length - 2];

		expect(final).toBeGreaterThan(min);
		expect(final).toBeLessThan(max);
		// regime: menos de 1 km/h em 10 s
		expect(Math.abs(final - tenSecondsBefore)).toBeLessThan(1);

		for (let i = 1; i < run.gears.length; i++) expect(run.gears[i]).toBeGreaterThanOrEqual(run.gears[i - 1]);
		expect(run.gears[0]).toBe(1);
		expect(run.gears[run.gears.length - 1]).toBeGreaterThanOrEqual(5);

		expect(run.minRpm).toBeGreaterThanOrEqual(powertrain.idleRpm);
		expect(run.maxRpm).toBeLessThanOrEqual(powertrain.revLimitRpm);
		// em regime na velocidade máxima a rotação fica parada: sem oscilação de passo a passo
		const steps = run.finalRpm.slice(1).map((rpm, i) => rpm - run.finalRpm[i]);
		expect(Math.max(...run.finalRpm) - Math.min(...run.finalRpm)).toBeLessThan(15);
		expect(Math.max(...steps.map(Math.abs))).toBeLessThan(1);
	});

	it("rotação entre a lenta e o corte também freando até parar e em ré", async () => {
		const sim = await createRapierSim(vehicleId);
		settle(sim);
		fullThrottle(sim, 8);
		sim.input.brake = true;
		let minRpm = Infinity;
		let maxRpm = -Infinity;
		let reverseSeen = false;
		for (let i = 0; i < Math.round(12 / FRAME_DT); i++) {
			sim.frame(FRAME_DT);
			const telemetry = sim.player.getTelemetry();
			minRpm = Math.min(minRpm, telemetry.engineRpm);
			maxRpm = Math.max(maxRpm, telemetry.engineRpm);
			reverseSeen ||= telemetry.gear === REVERSE_GEAR;
		}

		expect(reverseSeen).toBe(true);
		expect(sim.player.getCurrentSpeed()).toBeLessThan(-10);
		expect(minRpm).toBeGreaterThanOrEqual(powertrain.idleRpm);
		expect(maxRpm).toBeLessThanOrEqual(powertrain.revLimitRpm);
	});

	it("de ré no máximo, acelerar para a frente fica na 1ª até andar para a frente e sobe em ordem", async () => {
		const sim = await createRapierSim(vehicleId);
		settle(sim);
		sim.input.brake = true;
		for (let i = 0; i < Math.round(8 / FRAME_DT); i++) sim.frame(FRAME_DT);
		expect(sim.player.getTelemetry().forwardSpeed).toBeLessThan(-10);
		sim.input.brake = false;
		sim.input.throttle = true;
		// a telemetria é a do passo anterior: um quadro para o pedido chegar ao câmbio
		sim.frame(FRAME_DT);

		const gears: number[] = [];
		for (let i = 0; i < Math.round(12 / FRAME_DT); i++) {
			sim.frame(FRAME_DT);
			const telemetry = sim.player.getTelemetry();
			if (telemetry.forwardSpeed < 0) expect(telemetry.gear).toBe(1);
			if (gears[gears.length - 1] !== telemetry.gear) gears.push(telemetry.gear);
		}
		expect(gears[0]).toBe(1);
		expect(gears.length).toBeGreaterThan(2);
		for (let i = 1; i < gears.length; i++) expect(gears[i]).toBe(gears[i - 1] + 1);
	});
});

describe("arrasto aerodinâmico", () => {
	const aero = { dragCoefficient: 0.34, frontalArea: 2.2 }; // —, m²

	it("força = 0,5·ρ·Cd·A·v², impulso oposto à velocidade", () => {
		const speed = 30; // m/s
		const expected = 0.5 * 1.225 * 0.34 * 2.2 * speed * speed; // N

		expect(AIR_DENSITY).toBe(1.225);
		expect(aerodynamicDragForce(aero, speed)).toBeCloseTo(expected, 9);
		expect(aerodynamicDragForce(aero, 2 * speed)).toBeCloseTo(4 * expected, 9);

		const dt = 1 / 60;
		const impulse = aerodynamicDragImpulse(aero, { x: 18, y: 0, z: -24 }, dt, { x: 0, y: 0, z: 0 });
		expect(Math.hypot(impulse.x, impulse.y, impulse.z)).toBeCloseTo(expected * dt, 9);
		expect(impulse.x / impulse.z).toBeCloseTo(18 / -24, 12);
		expect(impulse.x).toBeLessThan(0);
		expect(aerodynamicDragImpulse(aero, { x: 0, y: 0, z: 0 }, dt, { x: 1, y: 1, z: 1 })).toEqual({
			x: 0,
			y: 0,
			z: 0,
		});
	});

	it("aplicado como impulso pelo PhysicsWorld: Δv no passo = F·dt/m", async () => {
		const world = await RapierPhysicsWorld.create(new THREE.Scene());
		const mass = 1000; // kg
		const body = world.createRigidBody({ type: "dynamic", position: { x: 0, y: 100, z: 0 } });
		world.createCollider({ shape: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, density: mass }, body);
		const speed = 40; // m/s
		body.setLinearVelocity({ x: speed, y: 0, z: 0 });
		const impulse = { x: 0, y: 0, z: 0 };
		world.addPreStepCallback((dt) => {
			body.applyImpulse(aerodynamicDragImpulse(aero, body.getLinearVelocity({ x: 0, y: 0, z: 0 }), dt, impulse));
		});

		world.update(world.fixedTimeStep);
		const velocity = body.getLinearVelocity({ x: 0, y: 0, z: 0 });
		const expectedDeltaV = (aerodynamicDragForce(aero, speed) * world.fixedTimeStep) / mass;

		expect(speed - velocity.x).toBeCloseTo(expectedDeltaV, 4);
		expect(velocity.z).toBe(0);
		world.dispose();
	});

	it("no veículo em ponto morto: a diferença de desaceleração entre 60 e 180 km/h é a do arrasto", async () => {
		const definition = getVehicleDefinition("mercedes_g63")!;
		const rig = await createVehicleRig(definition, FRAME_DT, LONG_GROUND);
		rig.steps(Math.round(SETTLE_TIME / FRAME_DT));
		const decelerationAt = (targetKmh: number): { speed: number; decel: number } => {
			rig.input.throttle = true;
			while (rig.physics.forwardSpeed() * 3.6 < targetKmh) rig.steps(1);
			rig.input.throttle = false;
			rig.state.gear = NEUTRAL_GEAR;
			rig.steps(Math.round(1 / FRAME_DT));
			const before = rig.physics.forwardSpeed();
			rig.steps(Math.round(1 / FRAME_DT));
			const after = rig.physics.forwardSpeed();
			return { speed: (before + after) / 2, decel: before - after };
		};
		const slow = decelerationAt(60);
		const fast = decelerationAt(180);
		const dragDifference =
			(aerodynamicDragForce(definition.aerodynamics, fast.speed) -
				aerodynamicDragForce(definition.aerodynamics, slow.speed)) /
			definition.physics.mass;
		const dampingDifference = CHASSIS_LINEAR_DAMPING * (fast.speed - slow.speed);

		expect(fast.decel - slow.decel).toBeCloseTo(dragDifference + dampingDifference, 1);
		rig.dispose();
	});
});

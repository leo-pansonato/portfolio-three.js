import { describe, expect, it } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { VehicleDefinition } from "../../src/data/vehicles/types";
import { cloneDefinition, createVehicleRig, VehicleRig } from "../support/vehicleRig";

/**
 * Suspensão própria (ADR-0003, etapa 2) contra resultados analíticos, no mundo Rapier real.
 * g = 9,82 m/s² (RapierPhysicsWorld); CG no centro do chassi (x = 0).
 */

const G = 9.82;
const DT = 1 / 60;
const VEHICLES = ["bmw_f82", "mercedes_g63"];

function definition(id: string, edit?: (d: VehicleDefinition) => void): VehicleDefinition {
	const d = cloneDefinition(getVehicleDefinition(id)!);
	edit?.(d);
	return d;
}

function chassisY(rig: VehicleRig): number {
	return rig.physics.chassisBody.getPosition({ x: 0, y: 0, z: 0 }).y;
}

/** Levanta o chassi `height` m, parado e nivelado */
function lift(rig: VehicleRig, height: number): void {
	place(rig, chassisY(rig) + height);
}

/** Põe o chassi na altura `y` (m), parado e nivelado */
function place(rig: VehicleRig, y: number): void {
	const p = rig.physics.chassisBody.getPosition({ x: 0, y: 0, z: 0 });
	rig.physics.restoreChassisState({
		position: { x: p.x, y, z: p.z },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		linearVelocity: { x: 0, y: 0, z: 0 },
		angularVelocity: { x: 0, y: 0, z: 0 },
	});
}

/** Altura do chassi a cada passo durante `steps` passos */
function recordHeights(rig: VehicleRig, steps: number): number[] {
	const heights: number[] = [];
	rig.steps(steps, () => heights.push(chassisY(rig)));
	return heights;
}

/** Rolagem do chassi (rad; positiva em torno de +X): inclinação do +Z local em relação ao plano horizontal */
function roll(rig: VehicleRig): number {
	const q = rig.physics.chassisBody.getRotation({ x: 0, y: 0, z: 0, w: 1 });
	const rightY = 2 * (q.y * q.z - q.w * q.x);
	return Math.asin(Math.max(-1, Math.min(1, -rightY)));
}

describe.each(VEHICLES)("suspensão própria — %s", (id) => {
	const catalog = getVehicleDefinition(id)!;
	const mass = catalog.physics.mass;
	const k = catalog.suspension.springRate;
	const cornerMass = mass / 4;

	it("carga estática por roda = m·g distribuída pela posição do CG", async () => {
		const rig = await createVehicleRig(definition(id));
		rig.steps(180);
		const frontX = catalog.wheels.adjustments[0].position.x;
		const rearX = -catalog.wheels.adjustments[2].position.x;
		const wheelbase = frontX + rearX;
		const expectedFront = (mass * G * (rearX / wheelbase)) / 2;
		const expectedRear = (mass * G * (frontX / wheelbase)) / 2;
		const wheels = rig.physics.suspension.wheels;

		expect(wheels.every((w) => w.inContact)).toBe(true);
		for (const i of [0, 1]) expect(wheels[i].force / expectedFront).toBeCloseTo(1, 2);
		for (const i of [2, 3]) expect(wheels[i].force / expectedRear).toBeCloseTo(1, 2);
		for (let i = 0; i < 4; i++) {
			expect(wheels[i].compression).toBeCloseTo(wheels[i].force / k, 4);
		}
		rig.dispose();
	});

	it("altura de repouso: comprimento livre − carga/k, mais o raio da roda", async () => {
		const rig = await createVehicleRig(definition(id));
		rig.steps(180);
		const meanCompression = (mass * G) / 4 / k;
		const expected = catalog.physics.suspensionRestLength - meanCompression + catalog.physics.wheelRadius;

		expect(chassisY(rig)).toBeCloseTo(expected, 2);
		rig.dispose();
	});

	it("frequência natural de um pulo de queda ≈ √(k/m_canto)/2π (±10%)", async () => {
		const rig = await createVehicleRig(
			definition(id, (d) => {
				d.suspension.compressionDamping = 0;
				d.suspension.reboundDamping = 0;
			}),
		);
		const equilibrium = catalog.physics.suspensionRestLength - (mass * G) / 4 / k + catalog.physics.wheelRadius;
		place(rig, equilibrium + 0.02);
		const seconds = 4;
		const heights = recordHeights(rig, seconds / DT);
		const mean = heights.reduce((s, h) => s + h, 0) / heights.length;
		let crossings = 0;
		for (let i = 1; i < heights.length; i++) {
			if (heights[i - 1] - mean < 0 !== heights[i] - mean < 0) crossings++;
		}
		const measured = crossings / 2 / seconds;
		const expected = Math.sqrt(k / cornerMass) / (2 * Math.PI);

		expect(Math.abs(measured / expected - 1)).toBeLessThan(0.1);
		rig.dispose();
	});

	it("razão de amortecimento medida pelo decremento logarítmico = c / 2√(k·m_canto)", async () => {
		const zeta = 0.1;
		const c = 2 * zeta * Math.sqrt(k * cornerMass);
		// eixos simétricos ao CG: só arfagem vertical; o acoplamento com o arfar faz o pneu dissipar energia
		const rig = await createVehicleRig(
			definition(id, (d) => {
				d.suspension.compressionDamping = c;
				d.suspension.reboundDamping = c;
				for (const wheel of d.wheels.adjustments) wheel.position.x = Math.sign(wheel.position.x) * 1.4;
			}),
		);
		rig.steps(480);
		const equilibrium = chassisY(rig);
		lift(rig, 0.02);
		const offsets = recordHeights(rig, 3 / DT).map((h) => h - equilibrium);
		const extremes: number[] = [];
		for (let i = 1; i < offsets.length - 1; i++) {
			const a = Math.abs(offsets[i]);
			if (a > Math.abs(offsets[i - 1]) && a >= Math.abs(offsets[i + 1])) extremes.push(a);
		}
		expect(extremes.length).toBeGreaterThanOrEqual(4);
		const halfCycleDecrement = Math.log(extremes[0] / extremes[3]) / 3;
		const measured = halfCycleDecrement / Math.sqrt(Math.PI * Math.PI + halfCycleDecrement * halfCycleDecrement);

		expect(Math.abs(measured / zeta - 1)).toBeLessThan(0.15);
		rig.dispose();
	});

	it("amortecimento do catálogo coerente: subamortecido, extensão mais macia que compressão, assenta em 1,5 s", async () => {
		const critical = 2 * Math.sqrt(k * cornerMass);
		const compression = catalog.suspension.compressionDamping / critical;
		const rebound = catalog.suspension.reboundDamping / critical;
		expect(compression).toBeGreaterThan(0.2);
		expect(compression).toBeLessThan(1);
		expect(rebound).toBeGreaterThan(0.1);
		expect(rebound).toBeLessThan(compression);

		const rig = await createVehicleRig(definition(id));
		rig.steps(180);
		const equilibrium = chassisY(rig);
		lift(rig, 0.05);
		rig.steps(1.5 / DT);
		const residual = recordHeights(rig, 0.5 / DT).map((h) => Math.abs(h - equilibrium));

		expect(Math.max(...residual)).toBeLessThan(0.0025);
		rig.dispose();
	});

	it("queda de 1 m: o batente segura antes do fim de curso e o chassi não toca o chão", async () => {
		const run = async (bumpStopStiffness: number) => {
			const rig = await createVehicleRig(
				definition(id, (d) => (d.suspension.bumpStopStiffness = bumpStopStiffness)),
			);
			rig.steps(180);
			lift(rig, 1);
			let maxCompression = 0;
			let minHeight = Infinity;
			rig.steps(4 / DT, () => {
				for (const w of rig.physics.suspension.wheels) maxCompression = Math.max(maxCompression, w.compression);
				minHeight = Math.min(minHeight, chassisY(rig));
			});
			rig.dispose();
			return { maxCompression, minHeight };
		};
		const withBumpStop = await run(catalog.suspension.bumpStopStiffness);

		expect(withBumpStop.maxCompression).toBeGreaterThan(
			catalog.suspension.maxCompression - catalog.suspension.bumpStopLength,
		);
		expect(withBumpStop.maxCompression).toBeLessThanOrEqual(catalog.suspension.maxCompression);
		expect(withBumpStop.minHeight).toBeGreaterThan(catalog.physics.size.y / 2);

		const withoutBumpStop = await run(0);
		expect(withoutBumpStop.maxCompression).toBeGreaterThan(withBumpStop.maxCompression);
	});

	it("rigidez de rolagem sob torque constante: molas k·t²/2 por eixo, barra soma k_barra·t² por eixo", async () => {
		const torque = 2000; // N·m em torno de +X
		const lever = 0.5; // m
		const track = (i: number) => 2 * Math.abs(catalog.wheels.adjustments[i].position.z);
		const springRoll = (k * (track(0) ** 2 + track(2) ** 2)) / 2;
		const steadyRoll = async (antiRoll: number) => {
			const rig = await createVehicleRig(
				definition(id, (d) => (d.suspension.antiRollStiffness = { front: antiRoll, rear: antiRoll })),
			);
			rig.steps(240);
			const body = rig.physics.chassisBody;
			const point = { x: 0, y: 0, z: 0 };
			const impulse = { x: 0, y: 0, z: 0 };
			rig.physicsWorld.addPreStepCallback((dt) => {
				const p = body.getPosition({ x: 0, y: 0, z: 0 });
				const force = torque / (2 * lever);
				for (const side of [-1, 1]) {
					point.x = p.x;
					point.y = p.y;
					point.z = p.z + side * lever;
					impulse.y = side * force * dt;
					body.applyImpulseAtPoint(impulse, point);
				}
			});
			rig.steps(240);
			const result = roll(rig);
			rig.dispose();
			return result;
		};

		const antiRoll = k / 2;
		const barRoll = antiRoll * (track(0) ** 2 + track(2) ** 2);
		expect(Math.abs(await steadyRoll(0)) / (torque / springRoll)).toBeCloseTo(1, 1);
		expect(Math.abs(await steadyRoll(antiRoll)) / (torque / (springRoll + barRoll))).toBeCloseTo(1, 1);
	});

	/**
	 * Pneu no contato (h = altura do CG ao chão) e suspensão no ponto de fixação, d acima do CG: o peso nas
	 * fixações estabiliza (m·g·d) em vez de desestabilizar como no contato
	 */
	it("curva em regime: rolagem por aceleração lateral = m·h / (K + m·g·d), com e sem barra (±2%)", async () => {
		const track = (i: number) => 2 * Math.abs(catalog.wheels.adjustments[i].position.z);
		const springRoll = (k * (track(0) ** 2 + track(2) ** 2)) / 2;
		const restHeight = catalog.physics.suspensionRestLength - (mass * G) / 4 / k + catalog.physics.wheelRadius;
		const cgHeight = restHeight + catalog.physics.centerOfMass.y;
		const hardPointAboveCg = catalog.wheels.adjustments[0].position.y - catalog.physics.centerOfMass.y;
		const rollGradient = async (front: number, rear: number) => {
			const rig = await createVehicleRig(
				definition(id, (d) => (d.suspension.antiRollStiffness = { front, rear })),
			);
			rig.steps(120);
			rig.analog.steer = -0.2;
			const speed = () => {
				const v = rig.physics.chassisBody.getLinearVelocity({ x: 0, y: 0, z: 0 });
				return Math.hypot(v.x, v.z);
			};
			let time = 0;
			const holdSpeed = () => {
				time += DT;
				const target = Math.min(12, 2 + 1.5 * time);
				rig.analog.throttle = Math.min(1, Math.max(0, 0.3 * (target - speed())));
			};
			rig.steps(12 / DT, holdSpeed);
			let rollSum = 0;
			let lateralSum = 0;
			const steps = 2 / DT;
			rig.steps(steps, () => {
				holdSpeed();
				rollSum += roll(rig);
				lateralSum += speed() * rig.physics.chassisBody.getAngularVelocity({ x: 0, y: 0, z: 0 }).y;
			});
			rig.dispose();
			return { gradient: rollSum / lateralSum, lateral: lateralSum / steps };
		};
		const expected = (barRoll: number) => (mass * cgHeight) / (springRoll + barRoll + mass * G * hardPointAboveCg);
		const bars = catalog.suspension.antiRollStiffness;
		const catalogBarRoll = bars.front * track(0) ** 2 + bars.rear * track(2) ** 2;

		const without = await rollGradient(0, 0);
		const withBars = await rollGradient(bars.front, bars.rear);

		expect(without.lateral).toBeGreaterThan(3);
		// curva à esquerda: o chassi inclina para fora (+Z), rolagem positiva em torno de +X
		expect(without.gradient).toBeGreaterThan(0);
		expect(Math.abs(without.gradient / expected(0) - 1)).toBeLessThan(0.02);
		expect(Math.abs(withBars.gradient / expected(catalogBarRoll) - 1)).toBeLessThan(0.02);
	});
});

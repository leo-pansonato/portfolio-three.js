import { describe, expect, it } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { VehicleDefinition, VehicleDrivingConfig } from "../../src/data/vehicles/types";
import { createInputFrame, InputFrame } from "../../src/input/InputFrame";
import VehicleControl from "../../src/vehicle/VehicleControl";
import { createVehicleState, REVERSE_GEAR } from "../../src/vehicle/VehicleState";

const DT = 1 / 60; // s

const CONFIG: VehicleDrivingConfig = Object.freeze({
	brakeTorque: { front: 1000, rear: 600 }, // N·m
	rollingResistanceTorque: 25, // N·m
	handbrakeTorque: 800, // N·m
	maxSteerVal: 0.5, // rad
	steerSpeed: 1, // rad/s
	steerReturn: 2, // rad/s
	tractionDisplacement: "rear",
});

const DEFINITION: VehicleDefinition = { ...getVehicleDefinition("bmw_f82")!, configs: CONFIG };
const POWERTRAIN = DEFINITION.powertrain;
const WHEEL_RADIUS = DEFINITION.physics.wheelRadius; // m

function setup() {
	const state = createVehicleState();
	const control = new VehicleControl(DEFINITION, state);
	const input = createInputFrame();
	const run = (steps: number, forwardSpeed = 0) => {
		for (let i = 0; i < steps; i++) control.step(input, forwardSpeed, DT);
		return control.commands;
	};
	return { state, control, input, run };
}

function inputOf(values: Partial<InputFrame>): InputFrame {
	return Object.assign(createInputFrame(), values);
}

describe("VehicleControl — volante", () => {
	it("rampa até o esterço máximo na velocidade do volante; esquerda é ângulo positivo", () => {
		const { input, run } = setup();
		input.steer = -1;

		expect(run(15).steeringAngle).toBeCloseTo(CONFIG.steerSpeed * 15 * DT, 10);
		expect(run(60).steeringAngle).toBe(CONFIG.maxSteerVal);

		input.steer = 1;
		expect(run(120).steeringAngle).toBe(-CONFIG.maxSteerVal);
	});

	it("rampa mais lenta em velocidade (50 m/s → 75%)", () => {
		const { input, run } = setup();
		input.steer = -1;

		expect(run(15, 50).steeringAngle).toBeCloseTo(0.75 * CONFIG.steerSpeed * 15 * DT, 10);
	});

	it("volta ao centro sem passar do zero", () => {
		const { state, input, run } = setup();
		input.steer = -1;
		run(60);
		input.steer = 0;

		expect(run(6).steeringAngle).toBeCloseTo(CONFIG.maxSteerVal - CONFIG.steerReturn * 6 * DT, 10);
		expect(run(60).steeringAngle).toBe(0);
		expect(state.steeringAngle).toBe(0);
	});
});

describe("VehicleControl — motor e freio", () => {
	it("acelerador proporcional; boost multiplica o torque e volta a 1 ao soltar", () => {
		const control = new VehicleControl(DEFINITION, createVehicleState(POWERTRAIN.idleRpm));
		const speed = 10; // m/s, 1ª marcha
		const rpm = (speed / WHEEL_RADIUS) * control.powertrain.overallRatio(1) * (60 / (2 * Math.PI));
		const ratio = control.powertrain.overallRatio(1);
		const fullTorque = (control.powertrain.torqueAt(rpm) * ratio * POWERTRAIN.efficiency) / 2;

		expect(control.step(inputOf({ throttle: 0.5 }), speed, DT).driveTorque).toBeCloseTo(fullTorque / 2, 6);
		expect(control.step(inputOf({ throttle: 1, boost: true }), speed, DT).driveTorque).toBeCloseTo(
			fullTorque * POWERTRAIN.boostTorqueMultiplier,
			6,
		);
		expect(control.step(inputOf({ throttle: 1 }), speed, DT).driveTorque).toBeCloseTo(fullTorque, 6);
	});

	it("freio quase parado e sem acelerador engata a ré", () => {
		const state = createVehicleState(POWERTRAIN.idleRpm);
		const control = new VehicleControl(DEFINITION, state);

		const stopped = control.step(inputOf({ brake: 1 }), 1.9, DT);
		expect(state.gear).toBe(REVERSE_GEAR);
		expect(stopped.driveTorque).toBeLessThan(0);
		expect(stopped.frontBrakeTorque).toBe(0);
		expect(stopped.rearBrakeTorque).toBe(0);

		// já em ré (velocidade negativa) continua acelerando para trás, proporcional ao pedal
		const full = control.step(inputOf({ brake: 1 }), -5, DT).driveTorque;
		expect(control.step(inputOf({ brake: 0.5 }), -5, DT).driveTorque).toBeCloseTo(full * 0.5, 6);

		// acelerador volta para a 1ª
		expect(control.step(inputOf({ throttle: 1 }), -1, DT).driveTorque).toBeGreaterThan(0);
		expect(state.gear).toBe(1);
	});

	it("freio em movimento freia, sem ré", () => {
		const control = new VehicleControl(DEFINITION, createVehicleState());

		const moving = control.step(inputOf({ brake: 1 }), 2, DT);
		expect(moving.driveTorque).toBe(0);
		expect(moving.frontBrakeTorque).toBe(CONFIG.brakeTorque.front);
		expect(moving.rearBrakeTorque).toBe(CONFIG.brakeTorque.rear);

		// acelerador junto com freio também não engata a ré
		const both = control.step(inputOf({ throttle: 1, brake: 1 }), 0, DT);
		expect(both.driveTorque).toBeGreaterThan(0);
		expect(both.frontBrakeTorque).toBe(CONFIG.brakeTorque.front);
	});

	it("sem acelerador nem freio aplica a resistência ao rolamento", () => {
		const control = new VehicleControl(DEFINITION, createVehicleState());

		const idle = control.step(createInputFrame(), 15, DT);
		expect(idle.driveTorque).toBe(0);
		expect(idle.frontBrakeTorque).toBe(CONFIG.rollingResistanceTorque);
		expect(idle.rearBrakeTorque).toBe(CONFIG.rollingResistanceTorque);
		expect(idle.handbrakeTorque).toBe(0);
	});

	it("freio de mão independe do freio", () => {
		const control = new VehicleControl(DEFINITION, createVehicleState());

		const handbrake = control.step(inputOf({ throttle: 1, handbrake: true }), 15, DT);
		expect(handbrake.handbrakeTorque).toBe(CONFIG.handbrakeTorque);
		expect(handbrake.frontBrakeTorque).toBe(0);
		expect(handbrake.rearBrakeTorque).toBe(0);
	});

	it("inércia do motor refletida nas rodas motrizes só com acelerador e fora de troca", () => {
		const state = createVehicleState(POWERTRAIN.idleRpm);
		const control = new VehicleControl(DEFINITION, state);
		const reflected = control.powertrain.reflectedInertia() / 2;

		expect(control.step(inputOf({ throttle: 1 }), 5, DT).drivelineInertia).toBeCloseTo(reflected, 9);
		expect(control.step(inputOf({ brake: 1 }), 5, DT).drivelineInertia).toBe(0);
		expect(control.step(createInputFrame(), 5, DT).drivelineInertia).toBe(0);
		state.shiftTimeRemaining = 0.05;
		expect(control.step(inputOf({ throttle: 1 }), 5, DT).drivelineInertia).toBe(0);
	});
});

describe("VehicleControl — estado por instância", () => {
	it("duas instâncias com a mesma definição não compartilham estado", () => {
		const a = setup();
		const b = new VehicleControl(DEFINITION, createVehicleState());
		a.input.steer = -1;
		a.run(30, 12);

		expect(a.state.steeringAngle).toBeGreaterThan(0);
		expect(a.state.forwardSpeed).toBe(12);
		expect(b.step(createInputFrame(), 0, DT).steeringAngle).toBe(0);
	});
});

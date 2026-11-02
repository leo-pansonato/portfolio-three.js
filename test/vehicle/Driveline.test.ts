import { describe, expect, it } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { DifferentialConfig, VehicleDefinition } from "../../src/data/vehicles/types";
import Driveline, { DrivelineCommands } from "../../src/vehicle/Driveline";
import Tire from "../../src/vehicle/Tire";
import WheelDynamics, {
	createWheelState,
	createWheelStep,
	WheelState,
	WheelStep,
	WheelStepInput,
} from "../../src/vehicle/WheelDynamics";
import { cloneDefinition } from "../support/vehicleRig";

const DT = 1 / 60; // s
const RPM_PER_RAD_S = 60 / (2 * Math.PI);
const OPEN: DifferentialConfig = {
	torqueSplit: 0.5,
	preloadTorque: 0,
	powerLocking: 0,
	coastLocking: 0,
	viscousCoupling: 0,
};

interface WheelCase {
	/** Velocidade do contato (m/s) */
	speed?: number;
	/** Velocidade angular inicial (rad/s); padrão rolando sem escorregar */
	angularVelocity?: number;
	/** Carga normal (N) */
	load?: number;
	/** Torque máximo do freio (N·m) */
	brake?: number;
}

/** Trem de força isolado (sem chassi): rodas com contato de massa fixa, um passo por chamada */
function setup(definition: VehicleDefinition) {
	const radius = definition.physics.wheelRadius;
	const dynamics = new WheelDynamics(new Tire(definition.tire), radius);
	const steps: WheelStep[] = [0, 1, 2, 3].map(() => createWheelStep());
	const wheels: WheelState[] = [0, 1, 2, 3].map(() => createWheelState());
	const driveline = new Driveline(definition, dynamics, steps);
	const commands: DrivelineCommands = {
		throttle: 0,
		torqueMultiplier: 1,
		gearRatio: definition.powertrain.gearRatios[0] * definition.powertrain.finalDriveRatio,
		clutchTorque: definition.powertrain.clutch.maxTorque,
		converterCoupling: 1,
	};
	const input: WheelStepInput = {
		longitudinalSpeed: 0,
		lateralSpeed: 0,
		normalLoad: 0,
		driveTorque: 0,
		brakeTorque: 0,
		inertia: definition.physics.wheelInertia,
		longitudinalContactMass: 400,
		lateralContactMass: 400,
	};
	const cases: WheelCase[] = [{}, {}, {}, {}];
	const place = (values: WheelCase[]) => {
		for (let i = 0; i < 4; i++) {
			cases[i] = values[i];
			const speed = values[i].speed ?? 10;
			wheels[i].angularVelocity = values[i].angularVelocity ?? speed / radius;
		}
	};
	const step = () => {
		for (let i = 0; i < 4; i++) {
			input.longitudinalSpeed = cases[i].speed ?? 10;
			input.normalLoad = cases[i].load ?? 4000;
			input.brakeTorque = cases[i].brake ?? 0;
			dynamics.prepare(wheels[i], input, DT, steps[i]);
			if (!driveline.isDriven(i)) dynamics.solve(steps[i], 0, false);
		}
		driveline.step(commands, DT);
		for (let i = 0; i < 4; i++) dynamics.commit(wheels[i], steps[i]);
	};
	return { driveline, commands, steps, wheels, place, step, radius };
}

function bmwWith(rear: DifferentialConfig): VehicleDefinition {
	const definition = cloneDefinition(getVehicleDefinition("bmw_f82")!);
	definition.powertrain.differentials.rear = rear;
	return definition;
}

describe("Driveline — diferenciais", () => {
	it("aberto: mesmo torque nas duas saídas, a roda no ar dispara", () => {
		const rig = setup(bmwWith(OPEN));
		rig.place([{}, {}, { load: 0 }, {}]);
		rig.commands.throttle = 1;
		rig.driveline.synchronize(rig.wheels, rig.commands.gearRatio);
		rig.step();

		expect(rig.steps[2].driveTorque).toBeCloseTo(rig.steps[3].driveTorque, 6);
		expect(rig.steps[2].driveTorque).toBeGreaterThan(0);
		expect(rig.wheels[2].angularVelocity).toBeGreaterThan(rig.wheels[3].angularVelocity + 1);
	});

	it("autoblocante escorregando: diferença de torque = 2·(pré-carga + bloqueio·|T|), para a roda mais lenta", () => {
		const lsd: DifferentialConfig = { ...OPEN, preloadTorque: 50, powerLocking: 0.25 };
		const rig = setup(bmwWith(lsd));
		rig.place([{}, {}, { load: 0 }, {}]);
		rig.commands.throttle = 1;
		rig.driveline.synchronize(rig.wheels, rig.commands.gearRatio);
		rig.step();

		const left = rig.steps[2].driveTorque;
		const right = rig.steps[3].driveTorque;
		const total = left + right;
		expect(right - left).toBeCloseTo(2 * (50 + 0.25 * total), 6);
		expect(rig.wheels[2].angularVelocity).toBeGreaterThan(rig.wheels[3].angularVelocity);
	});

	it("autoblocante com capacidade de sobra: as saídas terminam o passo na mesma velocidade", () => {
		const rig = setup(bmwWith({ ...OPEN, preloadTorque: 5000, powerLocking: 1 }));
		rig.place([{}, {}, { angularVelocity: 32 }, { angularVelocity: 30 }]);
		rig.commands.throttle = 0.5;
		rig.driveline.synchronize(rig.wheels, rig.commands.gearRatio);
		rig.step();

		expect(Math.abs(rig.wheels[2].angularVelocity - rig.wheels[3].angularVelocity)).toBeLessThan(1e-3);
		expect(rig.steps[3].driveTorque).toBeGreaterThan(rig.steps[2].driveTorque);
	});

	it("viscoso: transferência proporcional à diferença de velocidade no fim do passo", () => {
		const viscous = 40; // N·m·s/rad
		const rig = setup(bmwWith({ ...OPEN, viscousCoupling: viscous }));
		rig.place([{}, {}, { load: 0 }, {}]);
		rig.commands.throttle = 1;
		rig.driveline.synchronize(rig.wheels, rig.commands.gearRatio);
		rig.step();

		const transfer = (rig.steps[3].driveTorque - rig.steps[2].driveTorque) / 2;
		const difference = rig.wheels[2].angularVelocity - rig.wheels[3].angularVelocity;
		expect(transfer).toBeCloseTo(viscous * difference, 0);
	});

	it("central 40/60 livre com as quatro rodas iguais: 40% do torque no eixo dianteiro", () => {
		const definition = cloneDefinition(getVehicleDefinition("mercedes_g63")!);
		definition.powertrain.differentials.center = { ...OPEN, torqueSplit: 0.4 };
		const rig = setup(definition);
		rig.place([{}, {}, {}, {}]);
		rig.commands.throttle = 0.5;
		rig.commands.converterCoupling = 0;
		rig.driveline.synchronize(rig.wheels, rig.commands.gearRatio);
		rig.step();

		const front = rig.steps[0].driveTorque + rig.steps[1].driveTorque;
		const rear = rig.steps[2].driveTorque + rig.steps[3].driveTorque;
		expect(front / (front + rear)).toBeCloseTo(0.4, 6);
		expect(rig.steps[0].driveTorque).toBeCloseTo(rig.steps[1].driveTorque, 6);
	});
});

describe("Driveline — motor e embreagem", () => {
	it("embreagem travada: rotação do motor = relação × velocidade da saída no fim do passo", () => {
		const rig = setup(getVehicleDefinition("bmw_f82")!);
		rig.place([{}, {}, {}, {}]);
		rig.commands.throttle = 0.7;
		rig.driveline.synchronize(rig.wheels, rig.commands.gearRatio);
		for (let i = 0; i < 5; i++) rig.step();

		expect(rig.driveline.clutchLocked).toBe(true);
		expect(rig.driveline.engineSpeed).toBeCloseTo(
			rig.commands.gearRatio * rig.driveline.outputSpeed(rig.wheels),
			9,
		);
		expect(rig.steps[2].driveTorque).toBeGreaterThan(0);
	});

	it("embreagem escorregando: transmite a capacidade e o motor gira acima da entrada", () => {
		const rig = setup(getVehicleDefinition("bmw_f82")!);
		rig.place([{}, {}, { speed: 0 }, { speed: 0 }]);
		rig.commands.throttle = 1;
		rig.commands.clutchTorque = 150;
		rig.driveline.engineSpeed = 3000 / RPM_PER_RAD_S;
		rig.step();

		const efficiency = getVehicleDefinition("bmw_f82")!.powertrain.efficiency;
		expect(rig.driveline.clutchLocked).toBe(false);
		expect(rig.steps[2].driveTorque + rig.steps[3].driveTorque).toBeCloseTo(
			150 * rig.commands.gearRatio * efficiency,
			6,
		);
		expect(rig.driveline.engineSpeed).toBeGreaterThan(
			rig.commands.gearRatio * rig.driveline.outputSpeed(rig.wheels),
		);
	});

	it("ponto morto: sem acelerador cai para a lenta sem passar dela; acelerador pleno sobe até o corte sem passar", () => {
		const definition = getVehicleDefinition("bmw_f82")!;
		const rig = setup(definition);
		rig.place([{}, {}, {}, {}]);
		rig.commands.gearRatio = 0;
		rig.driveline.engineSpeed = 5000 / RPM_PER_RAD_S;
		const idle = definition.powertrain.idleRpm;
		const limit = definition.powertrain.revLimitRpm;
		let previous = rig.driveline.engineRpm();
		for (let i = 0; i < 600; i++) {
			rig.step();
			const rpm = rig.driveline.engineRpm();
			expect(rpm).toBeLessThanOrEqual(previous + 1e-9);
			expect(rpm).toBeGreaterThanOrEqual(idle);
			previous = rpm;
		}
		expect(previous).toBeLessThan(idle + 25);

		rig.commands.throttle = 1;
		previous = rig.driveline.engineRpm();
		for (let i = 0; i < 300; i++) {
			rig.step();
			const rpm = rig.driveline.engineRpm();
			expect(rpm).toBeGreaterThanOrEqual(previous - 1e-9);
			expect(rpm).toBeLessThanOrEqual(limit);
			previous = rpm;
		}
		expect(previous).toBeGreaterThan(limit - 200);
		expect(rig.steps[2].driveTorque).toBe(0);
	});

	it("conversor: com a turbina parada o motor sobe até perto do estol e a turbina recebe torque multiplicado", () => {
		const definition = getVehicleDefinition("mercedes_g63")!;
		const converter = definition.powertrain.torqueConverter!;
		const rig = setup(definition);
		const held = { speed: 0, angularVelocity: 0, brake: 1e6 };
		rig.place([held, held, held, held]);
		rig.commands.throttle = 1;
		rig.commands.clutchTorque = 0;
		rig.driveline.engineSpeed = definition.powertrain.idleRpm / RPM_PER_RAD_S;
		for (let i = 0; i < 60; i++) rig.step();
		const engineRpm = rig.driveline.engineRpm();
		expect(engineRpm).toBeGreaterThan(converter.stallRpm * 0.9);
		expect(engineRpm).toBeLessThan(converter.stallRpm * 1.1);
		expect(rig.driveline.clutchOutputTorque).toBeCloseTo(converter.stallTorqueRatio * 850, -1);
		expect(rig.wheels[0].angularVelocity).toBe(0);
	});
});

import { bmwF82 } from "./bmwF82";
import { mercedesG63 } from "./mercedesG63";
import { VehicleDefinition } from "./types";

export * from "./types";

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/** Catálogo de veículos (congelado: estado de runtime vai em VehicleState) */
export const VEHICLE_DEFINITIONS: Readonly<Record<string, VehicleDefinition>> = deepFreeze({
	mercedes_g63: mercedesG63,
	bmw_f82: bmwF82,
});

export function getVehicleDefinition(vehicleId: string): VehicleDefinition | null {
	return Object.hasOwn(VEHICLE_DEFINITIONS, vehicleId) ? VEHICLE_DEFINITIONS[vehicleId] : null;
}

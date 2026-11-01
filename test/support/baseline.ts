import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Linhas de base dos cenários de referência em JSON.
 *
 * `UPDATE_BASELINE=1 npm test` regrava o arquivo com os valores medidos.
 * Regravar só é aceitável quando a mudança de comportamento é intencional
 * e foi registrada no commit (ver CLAUDE.md).
 */

export const UPDATE_BASELINE = process.env.UPDATE_BASELINE === "1";

/** Tolerância relativa padrão: absorve diferenças de ponto flutuante entre máquinas */
export const DEFAULT_REL_TOL = 0.02;
export const DEFAULT_ABS_TOL = 0.01;

type Json = number | boolean | string | null | Json[] | { [key: string]: Json };

/** Converte Infinity/NaN (inválidos em JSON) para strings estáveis */
export function toJson(value: unknown): Json {
	if (typeof value === "number") {
		if (Number.isNaN(value)) return "NaN";
		if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
		return value;
	}
	if (Array.isArray(value)) return value.map(toJson);
	if (value && typeof value === "object") {
		const out: { [key: string]: Json } = {};
		for (const [k, v] of Object.entries(value)) out[k] = toJson(v);
		return out;
	}
	return value as Json;
}

export class BaselineFile {
	private data: Record<string, Json>;
	private readonly measured: Record<string, Json> = {};

	constructor(private readonly path: string | URL) {
		this.data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
	}

	/** Retorna as divergências entre o valor medido e a linha de base (vazio = ok) */
	check(key: string, actual: unknown, relTol = DEFAULT_REL_TOL, absTol = DEFAULT_ABS_TOL): string[] {
		const value = toJson(actual);
		this.measured[key] = value;
		if (UPDATE_BASELINE) return [];
		if (!(key in this.data)) return [`${key}: sem linha de base (rode com UPDATE_BASELINE=1)`];
		const diffs: string[] = [];
		compare(key, this.data[key], value, relTol, absTol, diffs);
		return diffs;
	}

	save(): void {
		if (!UPDATE_BASELINE) return;
		const merged = { ...this.data, ...this.measured };
		const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
		writeFileSync(this.path, JSON.stringify(sorted, null, "\t") + "\n");
	}
}

function compare(path: string, expected: Json, actual: Json, relTol: number, absTol: number, diffs: string[]): void {
	if (typeof expected === "number" && typeof actual === "number") {
		const tolerance = Math.max(absTol, Math.abs(expected) * relTol);
		if (Math.abs(actual - expected) > tolerance) {
			diffs.push(`${path}: esperado ${expected} ± ${tolerance.toFixed(4)}, medido ${actual}`);
		}
		return;
	}
	if (Array.isArray(expected) && Array.isArray(actual)) {
		if (expected.length !== actual.length) {
			diffs.push(`${path}: tamanho esperado ${expected.length}, medido ${actual.length}`);
			return;
		}
		expected.forEach((e, i) => compare(`${path}[${i}]`, e, actual[i], relTol, absTol, diffs));
		return;
	}
	if (expected && actual && typeof expected === "object" && typeof actual === "object" && !Array.isArray(expected)) {
		for (const key of Object.keys(expected)) {
			compare(`${path}.${key}`, expected[key], (actual as { [key: string]: Json })[key], relTol, absTol, diffs);
		}
		return;
	}
	if (expected !== actual) {
		diffs.push(`${path}: esperado ${JSON.stringify(expected)}, medido ${JSON.stringify(actual)}`);
	}
}

import { PhysicsBody, PhysicsWorld } from "../physics/PhysicsWorld";

/** O que o detector lê do mundo físico */
export type ContactEventSource = Pick<PhysicsWorld, "contactEventCount" | "getContactEvent">;

/** Impulso de contato mínimo que soa (N·s) e o de impacto pleno (N·s); entre eles, escala logarítmica */
const MIN_IMPULSE = 20;
const FULL_IMPULSE = 20000;
/** Nível do impacto mais fraco que soa (0–1) */
const MIN_INTENSITY = 0.25;
/** Sem eventos do par por mais que isto (s), o contato terminou e o próximo é um impacto novo */
const CONTACT_GAP = 0.1;
/** Intervalo mínimo entre impactos do mesmo par (s) */
const MIN_INTERVAL = 0.15;
const MAX_PAIRS = 8;

interface PairSlot {
	used: boolean;
	other: PhysicsBody | null;
	/** Último instante com evento do par (s) */
	lastSeen: number;
	lastTrigger: number;
	/** Impulso somado do par no quadro (N·s) */
	impulse: number;
	/** Quadro em que o par teve evento */
	frame: number;
	/** O contato já estava em curso no quadro anterior */
	continuing: boolean;
}

/** Intensidade (0–1) de um impulso de contato (N·s); 0 abaixo do mínimo */
export function impactIntensityFromImpulse(impulse: number): number {
	if (impulse < MIN_IMPULSE) return 0;
	const t = Math.log(impulse / MIN_IMPULSE) / Math.log(FULL_IMPULSE / MIN_IMPULSE);
	return Math.min(1, MIN_INTENSITY + (1 - MIN_INTENSITY) * t);
}

/**
 * Impactos de um corpo pelos eventos de força de contato do PhysicsWorld: soa só o início de cada contato
 * (contato contínuo, como empurrar uma caixa, não repete), com intervalo mínimo por par de corpos.
 * Estado fixo por par, sem alocação por quadro.
 */
export default class ContactImpactDetector {
	private readonly slots: PairSlot[] = [];
	private time = 0;
	private frame = 0;

	constructor() {
		for (let i = 0; i < MAX_PAIRS; i++) {
			this.slots.push({
				used: false,
				other: null,
				lastSeen: -Infinity,
				lastTrigger: -Infinity,
				impulse: 0,
				frame: -1,
				continuing: false,
			});
		}
	}

	/**
	 * Lê os eventos do último update da física
	 * @param deltaTime tempo do quadro (s)
	 * @returns intensidade (0–1) do impacto novo mais forte do quadro; 0 se não houve
	 */
	update(events: ContactEventSource, body: PhysicsBody, deltaTime: number): number {
		this.time += deltaTime;
		this.frame++;
		const count = events.contactEventCount();
		for (let i = 0; i < count; i++) {
			const event = events.getContactEvent(i);
			let other: PhysicsBody | null;
			if (event.bodyA === body) other = event.bodyB;
			else if (event.bodyB === body) other = event.bodyA;
			else continue;
			const slot = this.slotFor(other);
			if (slot.frame !== this.frame) {
				slot.frame = this.frame;
				slot.continuing = this.time - slot.lastSeen <= CONTACT_GAP;
				slot.lastSeen = this.time;
				slot.impulse = 0;
			}
			slot.impulse += event.impulse;
		}

		let intensity = 0;
		for (const slot of this.slots) {
			if (slot.frame !== this.frame) continue;
			if (slot.continuing || this.time - slot.lastTrigger < MIN_INTERVAL) continue;
			const level = impactIntensityFromImpulse(slot.impulse);
			if (level === 0) continue;
			slot.lastTrigger = this.time;
			intensity = Math.max(intensity, level);
		}
		return intensity;
	}

	/** Par do corpo dado; sem par, reaproveita o visto há mais tempo */
	private slotFor(other: PhysicsBody | null): PairSlot {
		let oldest = this.slots[0];
		for (const slot of this.slots) {
			if (slot.used && slot.other === other) return slot;
			if (slot.lastSeen < oldest.lastSeen) oldest = slot;
		}
		oldest.used = true;
		oldest.other = other;
		oldest.lastSeen = -Infinity;
		oldest.lastTrigger = -Infinity;
		return oldest;
	}
}

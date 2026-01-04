type DevModeListener = (enabled: boolean) => void;

/**
 * Gerenciador global de Dev Mode
 */
class DevModeManager {
	private static instance: DevModeManager;
	private enabled: boolean = false;
	private listeners: Map<string, DevModeListener> = new Map();

	private constructor() {
		const saved = localStorage.getItem("devMode");
		this.enabled = saved == "true";
	}

	/**
	 * Obtém a instância única do DevModeManager
	 */
	static getInstance(): DevModeManager {
		if (!DevModeManager.instance) {
			DevModeManager.instance = new DevModeManager();
		}
		return DevModeManager.instance;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;

		this.enabled = enabled;
		localStorage.setItem("devMode", String(enabled));

		console.log(`[DevMode] ${enabled}`);

		// Notificar todos os listeners
		this.listeners.forEach((callback) => {
			callback(enabled);
		});
	}


	toggle(): void {
		this.setEnabled(!this.enabled);
	}

	/**
	 * Registra um listener para mudanças no dev mode
	 * @param id Identificador único do listener
	 * @param callback Função chamada quando o dev mode muda
	 * @param immediate Chama o callback imediatamente com o estado atual
	 */
	subscribe(id: string, callback: DevModeListener, immediate: boolean = true): void {
		this.listeners.set(id, callback);

		// Chamar imediatamente com o estado atual
		if (immediate) {
			callback(this.enabled);
		}
	}

	/**
	 * Remove um listener
	 * @param id Identificador do listener a remover
	 */
	unsubscribe(id: string): void {
		this.listeners.delete(id);
	}

	/**
	 * Remove todos os listeners
	 */
	unsubscribeAll(): void {
		this.listeners.clear();
	}
}

// Exportar instância única para uso global
export const devMode = DevModeManager.getInstance();
export default DevModeManager;

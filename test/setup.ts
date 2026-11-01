/**
 * Ambiente mínimo para importar o código do jogo em Node.
 * DevModeManager lê localStorage ao ser importado.
 */
if (!("localStorage" in globalThis)) {
	const store = new Map<string, string>();
	(globalThis as any).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, String(value)),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
	};
}

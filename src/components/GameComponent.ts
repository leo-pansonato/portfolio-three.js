/**
 * Interface básica para componentes de jogo
 */
export default class GameComponent {
	constructor() {}

	initialize(): void {}
	update(deltaTime: number, ...args: any[]): void {}
	render(): void {}
}

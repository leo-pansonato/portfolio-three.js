/**
 * Interface básica para componentes de jogo
 */
export default class GameComponent {
	constructor() {}

	initialize(): void {}
	update(_deltaTime: number, ..._args: any[]): void {}
   onChangeDevMode(_enabled: boolean): void {}
	render(): void {}
}
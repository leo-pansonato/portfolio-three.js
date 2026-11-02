# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-02)

- `master` = `origin/master`. P0 completo (P0-1…P0-6), P1-8 (CI) e P2-7 (pipeline de cor) concluídos.
- Mundo em SI (ADR-0002): BMW 1.550 kg, G63 2.500 kg, plano de 2 km. 27 testes (cenários, independência de FPS/passo, interpolação, plausibilidade, ciclo de vida).
- Usuário pediu autonomia total: seguir o ROADMAP em ordem, commits `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco chat, poucos comentários; integrar por fast-forward + push após build e testes verdes.
- Trabalho delegado a subagentes em worktree (`isolation: "worktree"`); ao integrar: rebase sobre a `master` dentro do worktree, ff na `master`, remover worktree e branches.

## Em andamento

- P1-6 na branch `feat/telemetry-replay` (telemetria por passo + HUD F2, `src/replay/`, teste de replay bit a bit). Aguardando integração.
- P1-1 a P1-4 integrados (input em `src/input`, `InputFrame`, ações tipadas no `main.ts`; física atrás de `PhysicsWorld`).

## Próximos itens (ordem)

1. P1-6 telemetria/replay, P1-7 lint.
2. P2-1 dinâmica própria (arrasto, câmbio, pneu, CG baixo), P2-5 câmeras, P2-3 mundo, P2-4 renderização.

## Pendências conhecidas

- P1-5 feito na branch `feat/resource-lifecycle`. `Game` (main.ts) não chama `Environment.dispose`/`LightingManager.dispose` nem tem `dispose` próprio; o placeholder do chassi continua registrado no `PhysicsWorld` após o modelo carregar.
- Medir `renderer.info` com a janela oculta: o rAF para; servir uma cópia temporária do `index.html` que troca `requestAnimationFrame` por `setTimeout` e captura o renderer em `Scene.prototype.onBeforeRender`.

- `computeBoundingSphere(): Computed radius is NaN` (geometria indexada) só ao carregar com modo dev ligado; não ocorre ao ligar F2 depois. Não reproduz em Node (CSMHelper, poses iniciais sem NaN). Criar o helper do CSM depois do primeiro `update` piorou (2 erros); revertido. Investigar no navegador.

- CG no centro do collider (margem de capotamento ~1 g, perto da aderência lateral).
- Sem arrasto/câmbio: velocidade sem teto; `configs.maxSpeed` sem uso; boost ×3 chega a ~2 g.
- CSM `maxFar 50` e intensidade das luzes não revistos para escala real/AgX.
- Pasta `.claude/worktrees/` pode sobrar no disco (ignorada pelo Git).

## Fatos técnicos que não estão óbvios no código

- `RigidBody.linvel()` do chassi apoiado no controlador Rapier ≈ g·dt em repouso; medir movimento por deslocamento.
- O controlador Rapier recebe freio como impulso por passo; `configs.brakeForce`/`eBrakeForce`/`rollingResistance` estão em N e o `Player` multiplica por `dt`.
- Controle do veículo roda no pré-passo (`Player.updateControl` → `VehicleControl.step` → `VehiclePhysics.applyCommands`); `Player.update` só chama `VehicleView.update`. Meshes ficam até 1 passo atrás (interpolação); `PhysicsWorld.resetInterpolation` após teleporte.
- Física: só `src/physics/` importa a Rapier; código novo usa `PhysicsWorld` (`physics/PhysicsWorld.ts`) e só `main.ts`/testes criam `RapierPhysicsWorld`. Leituras de `PhysicsBody` escrevem em `out`.
- Passo de 1/120 s avaliado e não adotado: curva do G63 −3% de velocidade/+3,5% de guinada, resto < 1% (ARCHITECTURE §3.1).
- `linearDamping` do chassi afeta muito a aceleração (0,2 → −35%).
- Rigidez/amortecimento da suspensão do controlador são por unidade de massa do chassi (modelo Bullet).
- Replay só é exato se gravação e reprodução partirem do estado reaplicado (`applyChassisState` no início da gravação): `setRotation` da Rapier normaliza o quaternion.
- `rapierSim` expõe `player` e `physicsWorld` para testes que precisam de telemetria ou pré-passo próprio.
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.
- Console no modo dev: `computeBoundingSphere(): Computed radius is NaN` ao carregar a página, já presente antes do P1-2 (provável `PhysicsDebugRenderer` no primeiro quadro); não investigado.

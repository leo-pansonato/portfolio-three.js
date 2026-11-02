# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-02)

- `master` = `origin/master`. P0 completo, P1 completo (P1-1…P1-8, lint/format no CI) e P2-7 concluídos.
- Mundo em SI (ADR-0002): BMW 1.550 kg, G63 2.500 kg, plano de 2 km. 93 testes (cenários, trem de força, independência de FPS/passo, interpolação, plausibilidade, ciclo de vida).
- Usuário pediu autonomia total: seguir o ROADMAP em ordem, commits `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco chat, poucos comentários; integrar por fast-forward + push após build e testes verdes.
- Trabalho delegado a subagentes em worktree (`isolation: "worktree"`); ao integrar: rebase sobre a `master` dentro do worktree, ff na `master`, remover worktree e branches.

## Em andamento

- P2-1 etapa 1 integrada (9b42cb7); ADR-0003 `Proposta` aguarda aceite do usuário antes da etapa 2 (suspensão própria; antes `castShape` e força em ponto no `PhysicsWorld`). P2-9 (debug físico interpolado) concluído; P2-10 (worker) planejado.

## Próximos itens (ordem)

1. P2-1 etapas 2–4 (suspensão própria, pneu com escorregamento, inércia de roda/diferencial, CG baixo), validadas por telemetria e replay.
2. P2-5 câmeras (perseguição com inércia), P2-3 mundo (heightfield, superfícies), P2-4 renderização (pós, reflexos), P2-8 áudio.
3. Pendências menores: `Game.dispose()` chamando `environment/lightingManager/physicsManager/renderer.dispose`; placeholder do chassi ainda registrado no `PhysicsWorld`; `clearCache()` nunca chamado.

## Pendências conhecidas

- `Game` (main.ts) não chama `Environment.dispose`/`LightingManager.dispose` nem tem `dispose` próprio; o placeholder do chassi continua registrado no `PhysicsWorld` após o modelo carregar.
- Medir `renderer.info` com a janela oculta: o rAF para; servir uma cópia temporária do `index.html` que troca `requestAnimationFrame` por `setTimeout` e captura o renderer em `Scene.prototype.onBeforeRender`.


- CG no centro do collider (margem de capotamento ~1 g, perto da aderência lateral).
- G63 0–100 em 5,4 s (real 4,5): falta conversor de torque e escorregamento (etapas 3–4), não ajustar por tuning.
- Sem freio-motor; `linearDamping` 0,01 do chassi agora redundante com o arrasto (removê-lo muda a linha de base).
- `tractionFriction` é provisório (limite de tração porque o controlador Rapier não limita o motor em linha reta); sai na etapa 3.
- CSM `maxFar 50` e intensidade das luzes não revistos para escala real/AgX.
- Pasta `.claude/worktrees/` pode sobrar no disco (ignorada pelo Git).
- Lint: 4 avisos de `no-explicit-any` em `src/` (`GameComponent.update`, `PerformanceManager.update`, `traverse` em `VehicleManager`); promover a erro quando corrigidos.

## Fatos técnicos que não estão óbvios no código

- `RigidBody.linvel()` do chassi apoiado no controlador Rapier ≈ g·dt em repouso; medir movimento por deslocamento.
- O controlador Rapier recebe freio como impulso por passo; `configs.brakeForce`/`eBrakeForce`/`rollingResistance` estão em N e o `Player` multiplica por `dt`.
- Controle do veículo roda no pré-passo (`Player.updateControl` → `VehicleControl.step` → `VehiclePhysics.applyCommands`); `Player.update` só chama `VehicleView.update`. Meshes ficam até 1 passo atrás (interpolação); `PhysicsWorld.resetInterpolation` após teleporte.
- Física: só `src/physics/` importa a Rapier; código novo usa `PhysicsWorld` (`physics/PhysicsWorld.ts`) e só `main.ts`/testes criam `RapierPhysicsWorld`. Leituras de `PhysicsBody` escrevem em `out`.
- Passo de 1/120 s avaliado e não adotado: curva do G63 −3% de velocidade/+3,5% de guinada, resto < 1% (ARCHITECTURE §3.1).
- `linearDamping` do chassi afeta muito a aceleração (0,2 → −35%).
- Rigidez/amortecimento da suspensão do controlador são por unidade de massa do chassi (modelo Bullet).
- Replay só é exato se gravação e reprodução partirem do estado reaplicado (`applyChassisState` no início da gravação): `setRotation` da Rapier normaliza o quaternion.
- `rapierSim` expõe `player` e `physicsWorld` para testes que precisam de telemetria ou pré-passo próprio; terceiro argumento = meia-largura do chão (velocidade máxima precisa de 8 km).
- O controlador Rapier só limita o impulso do motor por `frictionSlip` quando há impulso lateral; o limite de tração em `VehiclePhysics` usa a força de suspensão do passo anterior e é desligado no passo seguinte a uma escrita de estado (replay determinístico).
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.

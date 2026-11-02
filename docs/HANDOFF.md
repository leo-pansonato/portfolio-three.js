# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-02)

- `master` = `origin/master`. P0 completo, P1 completo (P1-1…P1-8, lint/format no CI) e P2-7 concluídos.
- Mundo em SI (ADR-0002): BMW 1.550 kg, G63 2.500 kg, plano de 2 km. 128 testes (cenários, trem de força, suspensão, independência de FPS/passo, interpolação, plausibilidade, ciclo de vida).
- Usuário pediu autonomia total: seguir o ROADMAP em ordem, commits `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco chat, poucos comentários; integrar por fast-forward + push após build e testes verdes.
- Trabalho delegado a subagentes em worktree (`isolation: "worktree"`); ao integrar: rebase sobre a `master` dentro do worktree, ff na `master`, remover worktree e branches.

## Em andamento

- P2-1 etapa 3 (pneu próprio, controlador Rapier removido) quase pronta na branch `worktree-agent-a5cff13bd981ccb14` (worktree `.claude/worktrees/agent-a5cff13bd981ccb14`, 16 commits sobre c0e5231). Agente parado ao atualizar docs: conferir ARCHITECTURE/HANDOFF da branch, rodar lint/format/test/build, testar no navegador e integrar.

- P2-1 etapa 1 integrada (9b42cb7); ADR-0003 aceito; etapa 2 (suspensão própria) feita na branch do subagente, a integrar; próxima: etapa 3 (pneu, sai o controlador Rapier). P2-9 (debug físico interpolado) concluído; P2-10 (worker) planejado.

## Próximos itens (ordem)

1. P2-1 etapas 3–4 (pneu com escorregamento, inércia de roda/diferencial, CG baixo), validadas por telemetria e replay.
2. P2-5 câmeras (perseguição com inércia), P2-3 mundo (heightfield, superfícies), P2-4 renderização (pós, reflexos), P2-8 áudio.
3. Pendências menores: `Game.dispose()` chamando `environment/lightingManager/physicsManager/renderer.dispose`; placeholder do chassi ainda registrado no `PhysicsWorld`; `clearCache()` nunca chamado.

## Pendências conhecidas

- `Game` (main.ts) não chama `Environment.dispose`/`LightingManager.dispose` nem tem `dispose` próprio; o placeholder do chassi continua registrado no `PhysicsWorld` após o modelo carregar.
- Medir `renderer.info` com a janela oculta: o rAF para; servir uma cópia temporária do `index.html` que troca `requestAnimationFrame` por `setTimeout` e captura o renderer em `Scene.prototype.onBeforeRender`.


- CG no centro do collider (margem de capotamento ~1 g, perto da aderência lateral).
- G63 0–100 em 5,4 s (real 4,5): falta conversor de torque e escorregamento (etapas 3–4), não ajustar por tuning.
- Sem freio-motor; `linearDamping` 0,01 do chassi agora redundante com o arrasto (removê-lo muda a linha de base).
- `tractionFriction` é provisório (limite de tração porque o controlador Rapier não limita o motor em linha reta); sai na etapa 3.
- Rolagem em curva pequena (BMW < 1° a ~1 g) e a barra a reduz menos que a rigidez de rolagem indica; hipótese: impulso lateral do controlador perto da altura do CG (`roll_influence`). Sem massa não suspensa; reação da suspensão não vai ao corpo atingido.
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
- Suspensão própria (`vehicle/Suspension`) em N/m e N·s/m; o controlador Rapier ficou só com pneus: força máxima de suspensão 0 e, a cada passo, rigidez escolhida para a força interna (que limita o atrito) ser a carga da suspensão própria (`RapierVehicle.setWheelTireLoad`).
- A Rapier integra em 4 subpassos: `linvel()` ao fim do passo difere da velocidade média em g·dt·3/8; por isso a suspensão mede a velocidade de compressão pela variação de comprimento (e pela velocidade do corpo só no passo seguinte a uma escrita de estado).
- Consultas de raio veem os colisores do fim do último passo (o broad phase só atualiza no `step`).
- Testes que precisam de outra `VehicleDefinition` usam `test/support/vehicleRig.ts` (sem `Player`); teleporte nesses testes por `VehiclePhysics.restoreChassisState`, não `setPosition`, para invalidar o comprimento anterior da suspensão.
- Replay só é exato se gravação e reprodução partirem do estado reaplicado (`applyChassisState` no início da gravação): `setRotation` da Rapier normaliza o quaternion.
- `rapierSim` expõe `player` e `physicsWorld` para testes que precisam de telemetria ou pré-passo próprio; terceiro argumento = meia-largura do chão (velocidade máxima precisa de 8 km).
- O controlador Rapier só limita o impulso do motor por `frictionSlip` quando há impulso lateral; o limite de tração em `VehiclePhysics` usa a força de suspensão do passo anterior e é desligado no passo seguinte a uma escrita de estado (replay determinístico).
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.

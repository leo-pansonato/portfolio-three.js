# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-02)

- `master` = `origin/master`. P0 completo, P1 completo (P1-1…P1-8, lint/format no CI) e P2-7 e P2-9 concluídos.
- Mundo em SI (ADR-0002): BMW 1.550 kg, G63 2.500 kg, plano de 2 km. 166 testes (cenários, trem de força, suspensão, pneu e roda, skidpad, freio de mão, independência de FPS/passo, interpolação, plausibilidade, ciclo de vida).
- Usuário pediu autonomia total: seguir o ROADMAP em ordem, commits `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco chat, poucos comentários; integrar por fast-forward + push após build e testes verdes.
- Trabalho delegado a subagentes em worktree (`isolation: "worktree"`); ao integrar: rebase sobre a `master` dentro do worktree, ff na `master`, remover worktree e branches.

## Em andamento

- P2-1 etapas 1 e 2 integradas; etapa 3 (pneu e roda próprios, controlador Rapier removido) integrada (6093be9); próxima: etapa 4 (diferencial, embreagem/conversor, freio-motor). P2-9 (debug físico interpolado) concluído; P2-10 (worker) planejado.

## Próximos itens (ordem)

1. P2-1 etapa 4 (diferencial central 40/60 com bloqueio no G63, embreagem/conversor, freio-motor), depois P2-2 (controle de tração e ESC: o BMW roda com acelerador pleno em curva).
2. P2-5 câmeras (perseguição com inércia), P2-3 mundo (heightfield, superfícies), P2-4 renderização (pós, reflexos), P2-8 áudio.
3. Pendências menores: `Game.dispose()` chamando `environment/lightingManager/physicsManager/renderer.dispose`; placeholder do chassi ainda registrado no `PhysicsWorld`; `clearCache()` nunca chamado.

## Pendências conhecidas

- `Game` (main.ts) não chama `Environment.dispose`/`LightingManager.dispose` nem tem `dispose` próprio; o placeholder do chassi continua registrado no `PhysicsWorld` após o modelo carregar.
- Medir `renderer.info` com a janela oculta: o rAF para; servir uma cópia temporária do `index.html` que troca `requestAnimationFrame` por `setTimeout` e captura o renderer em `Scene.prototype.onBeforeRender`.


- G63 0–100 em 5,87 s (real 4,5): dianteiras patinam com diferenciais abertos e levam o motor ao corte; resolver com o diferencial da etapa 4, não com tuning.
- Sem controle de tração: BMW roda com acelerador pleno em curva fechada e patina na 2ª (P2-2).
- Pneu sem estado de deformação: parado em rampa deve deslizar ~g·sinθ·dt por passo, mesmo freado (não medido, sem cenário de rampa).
- Sem freio-motor; `linearDamping` 0,01 do chassi agora redundante com o arrasto (removê-lo muda a linha de base).
- Sem massa não suspensa nem sensibilidade do pneu à carga; reação da suspensão e do pneu não vai ao corpo atingido.
- CSM `maxFar 50` e intensidade das luzes não revistos para escala real/AgX.
- Pasta `.claude/worktrees/` pode sobrar no disco (ignorada pelo Git).
- Lint: 4 avisos de `no-explicit-any` em `src/` (`GameComponent.update`, `PerformanceManager.update`, `traverse` em `VehicleManager`); promover a erro quando corrigidos.

## Fatos técnicos que não estão óbvios no código

- `RigidBody.linvel()` do chassi apoiado no controlador Rapier ≈ g·dt em repouso; medir movimento por deslocamento.
- Freios em N·m por roda (`configs.brakeTorque.front/rear`, `handbrakeTorque`, `rollingResistanceTorque`); o freio de mão substitui o traseiro.
- Controle do veículo roda no pré-passo (`Player.updateControl` → `VehicleControl.step` → `VehiclePhysics.applyCommands`); `Player.update` só chama `VehicleView.update`. Meshes ficam até 1 passo atrás (interpolação); `PhysicsWorld.resetInterpolation` após teleporte.
- Física: só `src/physics/` importa a Rapier; código novo usa `PhysicsWorld` (`physics/PhysicsWorld.ts`) e só `main.ts`/testes criam `RapierPhysicsWorld`. Leituras de `PhysicsBody` escrevem em `out`.
- Passo de 1/120 s avaliado e não adotado: curva do G63 −3% de velocidade/+3,5% de guinada, resto < 1% (ARCHITECTURE §3.1).
- `linearDamping` do chassi afeta muito a aceleração (0,2 → −35%).
- Suspensão própria (`vehicle/Suspension`) em N/m e N·s/m; pneu e roda próprios (`vehicle/Tire`, `vehicle/WheelDynamics`); não há mais controlador Rapier.
- As forças das quatro rodas são calculadas no mesmo estado do chassi e aplicadas depois (aplicar uma a uma criava assimetria e o carro desviava em reta).
- A massa do contato no pneu inclui a rolagem/arfagem do chassi (1/(1/m + h²/I)); com só a massa pela carga, o pneu lateral passava do ponto parado.
- Embreagem provisória: a inércia do motor só entra nas rodas com acelerador e fora de troca (senão consumia o freio traseiro em 1ª).
- Ao escrever o estado do chassi, as rodas são sincronizadas com a velocidade do chassi no ponto de fixação (replay bit a bit).
- Rolagem em teste: medir pelo +Z local contra o plano horizontal (`2(qw·qx − qy·qz)`); a fórmula antiga variava com o rumo.
- A Rapier integra em 4 subpassos: `linvel()` ao fim do passo difere da velocidade média em g·dt·3/8; por isso a suspensão mede a velocidade de compressão pela variação de comprimento (e pela velocidade do corpo só no passo seguinte a uma escrita de estado).
- Consultas de raio veem os colisores do fim do último passo (o broad phase só atualiza no `step`).
- Testes que precisam de outra `VehicleDefinition` usam `test/support/vehicleRig.ts` (sem `Player`); teleporte nesses testes por `VehiclePhysics.restoreChassisState`, não `setPosition`, para invalidar o comprimento anterior da suspensão.
- Replay só é exato se gravação e reprodução partirem do estado reaplicado (`applyChassisState` no início da gravação): `setRotation` da Rapier normaliza o quaternion.
- `rapierSim` expõe `player` e `physicsWorld` para testes que precisam de telemetria ou pré-passo próprio; terceiro argumento = meia-largura do chão (velocidade máxima precisa de 8 km). `sim.analog.throttle/steer` dão acelerador e volante analógicos (skidpad, curva em regime).
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.

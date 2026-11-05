# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-04)

- `master` = `origin/master`. P0 completo, P1 completo (P1-1…P1-8, lint/format no CI); P2-1, P2-5, P2-7, P2-8 (protótipo) e P2-9 concluídos.
- Mundo em SI (ADR-0002): BMW 1.550 kg, G63 2.500 kg, plano de 2 km. 263 testes (cenários, eventos de contato, impactos, camadas e eventos do motor, mapeamento de áudio, trem de força acoplado, diferenciais, freio-motor, suspensão, pneu e roda, skidpad, freio de mão, independência de FPS/passo, interpolação, plausibilidade, ciclo de vida).
- Usuário pediu autonomia total: seguir o ROADMAP em ordem, commits `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco chat, poucos comentários; integrar por fast-forward + push após build e testes verdes.
- Usuário proibiu multiagentes (2026-11-04): trabalhar direto na `master`, sem subagentes nem worktrees.

## Em andamento

- P2-5 câmeras concluído (perseguição rígida, fica para fora da curva pela guinada; analógico direito). Sensação ainda em ajuste com o usuário: `turnLeadTime`/`maxTurnLead`/`headingTimeConstant` em `camera/ChaseCamera`.
- P2-4 parcial (ADR-0006): pós WebGL2 com MSAA 4× + bloom só no sol; céu HDR mantido (céu procedural rejeitado pelo usuário).
- P2-6 parcial (ADR-0004): HUD de corrida em React (`src/ui/`); faltam menus e seleção de veículo.
- Zoom pela roda em todas as câmeras, clique da roda reseta a câmera ativa, órbita sem auto-centro (feito).

- P2-8 concluído como protótipo procedural (`src/audio/`, tecla M); usuário reprovou o timbre (agudo, artificial, derrapagem irreconhecível, impacto inaudível). Refatoração nos padrões da indústria registrada como P2-11; ADR-0007 aceito com a opção A (motor próprio por amostras); falta a origem das gravações.
- P2-1 concluído: etapa 4 (trem de força acoplado: motor com rotação própria, embreagem/conversor, diferenciais com bloqueio, freio-motor) integrada (409f384); ré chega a ~65 km/h no corte (rever relação de ré). P2-9 (debug físico interpolado) concluído; P2-10 (worker) planejado.

## Retomar: P2-11 — áudio veicular nos padrões da indústria

Ler antes: [ADR-0007](decisions/ADR-0007-audio-veicular.md), ROADMAP P2-11, ARCHITECTURE §3.6.1.

- **Feito (2026-11-04):** etapa 2 completa — telemetria com `engineLoad` (acelerador efetivo), `revLimiterActive` e `normalizedSlip` por roda; `PhysicsWorld` com eventos de força de contato (`ColliderConfig.contactForceThreshold`, `contactEventCount`/`getContactEvent`, buffer de 64 por update). Áudio lê carga e escorregamento da telemetria (não do input; vale no replay). Impactos por `audio/ContactImpactDetector` (chassi com limiar 1 kN): verificado no navegador, uma batida por contato a 57 e 160 km/h. **[Investigar]** resolvido: caixas de 5 kg davam < 1 g; o impacto nunca disparava.
- **Feito (2026-11-04, noite):** motor por amostras com gravação livre do M4 F82 em `C:\Users\leopa\Downloads\sounds` (11 mp3 curtos nomeados pelo usuário). Rotação pela 1,5ª ordem (rpm = Hz × 40; `idle_to_7500` termina em 188 Hz); a versão anterior usava a 3ª e tocava 2× agudo. Banco `bmw_s55` versionado (24 laços: lenta 1090 de `idle.mp3`, sem descer de tom abaixo dela; com carga 1300–7500, sem carga 1700–2900 e 4100–5800; eventos partida, trocas 1–2/3–4, reduções com blip, corte, estalos). No navegador: partida ao carregar, troca, corte e redução disparam; tom segue a rpm. Usuário ouviu: pediu cortar o motor antes da ação nas trocas/reduções (sensação de dois motores) e lenta nova; feito (eventos começam na ação, laços a 10% durante eles). Depois: troca para cima só com a troca gravada e laços mudos; redução sem som acelerando; câmbio escolhe as marchas à frente pela velocidade para a frente (de ré a 65 km/h, acelerar fica na 1ª até andar para a frente). Trocas com os cortes do usuário (`*_gear_change.mp3` inteiros). Motor procedural removido a pedido: só o banco (mudo até carregar); `VehicleSoundConfig` tem só `engineBank`.
- **Regerar o banco:** venv com `numpy scipy imageio-ffmpeg` e `python tools/audio/build_engine_bank.py tools/audio/bmw_s55.json <pasta das gravações> public/audio/engines`. Trechos, curvas-guia de rpm, alvos e eventos em `tools/audio/bmw_s55.json`.
- **Bloqueios do usuário:** gravação do M177 (G63 usa a do S55), sem carga entre 2900 e 4100 rpm (hoje crossfade com ±19% de tom), amostras de pneus/impactos CC0 (baixar com conta do Freesound). Ajustes de escuta: `EVENT_MIX` (abafamento e retorno por evento), `ENGINE_GAIN_TIME`, `POPS_CHANCE`, limites de playbackRate.
- **Sem bloqueio, próximos:** som do corte de giro (o BMW fica ~1,5 s no corte em 1ª; hoje só a camada de 7500 com carga parcial); etapa 6 sem amostras — barramentos (motor, pneus, impactos, ambiente) e *snapshots* interno × externo por modo de câmera; `PannerNode` com ouvinte na câmera. Raspagem contínua pelos eventos (velocidade tangencial no ponto via `getVelocityAtPoint`). Batente de suspensão pela telemetria (pouso de salto).
- **Reaproveitar:** `vehicleSound.ts` e `ContactImpactDetector.ts` (puros, testes em `test/audio/`), partida do `AudioContext` no primeiro gesto, tecla M, suspensão com a aba oculta.
- **Verificação no navegador com o painel oculto:** o rAF para e `document.hidden` suspende o áudio. Servir uma cópia temporária do `index.html` (ex.: `audio-check.html` na raiz, apagar depois) com script inline antes do `main.ts` trocando `requestAnimationFrame` por `setTimeout`, forçando `document.hidden = false` e envolvendo `AudioContext`/`createBufferSource` para contar vozes; teclas sintéticas em `document`. Para posicionar caixas, expor o `Game` em `window` temporariamente (não commitar). Há um volante G29 conectado no navegador do usuário.

## Próximos itens (ordem)

1. P2-2 (controle de tração e ESC): o BMW roda com acelerador pleno em curva e patina a traseira na arrancada; o G63 patina as quatro.
2. P2-3 mundo (heightfield, superfícies; ligar ao áudio dos pneus), P2-4 renderização (reflexos, CSM), P2-6 menus.
3. Pendências menores: `Game.dispose()` chamando `environment/lightingManager/physicsManager/renderer.dispose`; placeholder do chassi ainda registrado no `PhysicsWorld`; `clearCache()` nunca chamado.

## Pendências conhecidas

- `Game` (main.ts) não chama `Environment.dispose`/`LightingManager.dispose` nem tem `dispose` próprio; o placeholder do chassi continua registrado no `PhysicsWorld` após o modelo carregar.
- Medir `renderer.info` com a janela oculta: o rAF para; servir uma cópia temporária do `index.html` que troca `requestAnimationFrame` por `setTimeout` e captura o renderer em `Scene.prototype.onBeforeRender`.


- G63 0–100 em 4,27 s e BMW 4,40 s, sem controle de tração; μx do G63 em 1,0 por decisão do usuário (faixa do teste 4,0–6 s).
- Sem controle de tração: BMW roda com acelerador pleno em curva fechada e patina na 2ª (P2-2).
- Pneu sem estado de deformação: parado em rampa deve deslizar ~g·sinθ·dt por passo, mesmo freado (não medido, sem cenário de rampa).
- `linearDamping` 0,01 do chassi redundante com o arrasto (removê-lo muda a linha de base). Ponto morto existe no estado, mas o jogador não o seleciona.
- Sem massa não suspensa nem sensibilidade do pneu à carga; reação da suspensão e do pneu não vai ao corpo atingido.
- CSM `maxFar 50` e intensidade das luzes não revistos para escala real/AgX.
- Pasta `.claude/worktrees/` pode sobrar no disco (ignorada pelo Git).
- Caixas do cenário com 5 kg num cubo de 3 m (mais leves que o ar); rever no P2-3.
- BMW fica ~2 s no corte de giro em 1ª na arrancada com as traseiras patinando (escorregamento normalizado ~50): P2-2.
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
- Rotação do motor é estado do `Driveline` (física); `VehicleState.engineRpm` é cópia lida pelo controle no início do passo (`VehicleControl.step(..., engineRpm)`).
- Trem de força: rodas motrizes linearizadas (dω/dT da `WheelDynamics`), diferenciais em forma fechada, motor + embreagem por falsa posição, até 4 iterações de Newton; sem subpassos. Na troca, embreagem e conversor reacoplam ao longo de `shiftTime` e o acelerador é proporcional ao erro de rotação (liga-desliga oscilava).
- Conversor do G63 desacopla parado sem acelerador (sem *creep*); a embreagem do BMW fecha pela rotação do motor na arrancada.
- Ao escrever o estado do chassi, as rodas são sincronizadas com a velocidade do chassi no ponto de fixação e o motor com a rotação da marcha do estado (`gear` de `ReplayInitialState`); o ponto de partida das iterações do trem de força é zerado (replay bit a bit).
- Rolagem em teste: medir pelo +Z local contra o plano horizontal (`2(qw·qx − qy·qz)`); a fórmula antiga variava com o rumo.
- A Rapier integra em 4 subpassos: `linvel()` ao fim do passo difere da velocidade média em g·dt·3/8; por isso a suspensão mede a velocidade de compressão pela variação de comprimento (e pela velocidade do corpo só no passo seguinte a uma escrita de estado).
- Consultas de raio veem os colisores do fim do último passo (o broad phase só atualiza no `step`).
- Testes que precisam de outra `VehicleDefinition` usam `test/support/vehicleRig.ts` (sem `Player`); teleporte nesses testes por `VehiclePhysics.restoreChassisState`, não `setPosition`, para invalidar o comprimento anterior da suspensão.
- Replay só é exato se gravação e reprodução partirem do estado reaplicado (`applyChassisState` no início da gravação): `setRotation` da Rapier normaliza o quaternion.
- `rapierSim` expõe `player` e `physicsWorld` para testes que precisam de telemetria ou pré-passo próprio; terceiro argumento = meia-largura do chão (velocidade máxima precisa de 8 km). `sim.analog.throttle/steer` dão acelerador e volante analógicos (skidpad, curva em regime).
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.

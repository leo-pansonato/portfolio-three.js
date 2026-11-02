# ADR-0003 — Dinâmica veicular própria, em etapas

- **Status:** Aceita (2026-11-02)
- **Data:** 2026-11-02
- **Escopo:** como substituir o `DynamicRayCastVehicleController` da Rapier por um modelo de veículo próprio sobre o corpo rígido (ROADMAP P2-1).

## Contexto

O veículo usa o controlador *raycast* da Rapier (modelo Bullet, ADR-0001). Ele resolve suspensão e atrito numa caixa-preta em WASM e tem limites conhecidos (ARCHITECTURE §3.2, R5):

- não há trem de força: `configs.maxForce` era uma força constante por roda motriz, sem rotação, marchas nem potência; sem arrasto, a velocidade crescia sem teto (BMW ~113 km/h em 5 s e subindo; ADR-0002, Consequências);
- o atrito é um limite de impulso: em linha reta o impulso do motor **não** é limitado por `frictionSlip` (o teste de escorregamento combinado só atua quando há impulso lateral), então a tração não tem limite de aderência;
- sem modelo de pneu (escorregamento longitudinal/lateral, atrito combinado), sem inércia de roda, sem diferencial;
- `suspensionStiffness`/amortecimento por kg de chassi, sem *bump stop* nem barra estabilizadora.

Trocar tudo de uma vez repetiria o erro da `refact/rapier3d` (motor, tuning e comportamento num só passo, sem como atribuir regressões). O projeto já tem a rede de proteção para fazer em etapas: harness em Node, cenários de referência com linha de base, limites de plausibilidade, telemetria por roda (P1-6) e replay determinístico (P1-8).

## Opções

| | A — trocar tudo de uma vez | B — migrar em etapas sobre o controlador atual | C — manter o controlador e só ajustar |
|---|---|---|---|
| Risco | alto: regressões sem causa isolável | baixo: cada etapa tem teste próprio | baixo |
| Teto de qualidade | modelo próprio | modelo próprio | o do Bullet (R5) |
| Custo até o primeiro ganho | alto | baixo (etapa 1 já limita velocidade e dá câmbio) | baixo |
| Validação | só no fim | por etapa, contra analítico + cenários | cenários |

## Decisão

**B — migrar em etapas, cada uma validada (testes analíticos, cenários de referência, plausibilidade, roteiro manual) antes de começar a próxima.** Uma etapa por PR; mudança de motor, de comportamento e de parâmetros em commits separados.

1. **Trem de força e aerodinâmica sobre o controlador atual.** O controlador continua resolvendo suspensão e atrito; o código próprio calcula a força nas rodas motrizes e o arrasto.
2. **Suspensão própria por roda** com raycast/shape cast pelo `PhysicsWorld` (mola, amortecedor, *bump stop*, barra estabilizadora), forças aplicadas em ponto no chassi. Exige `castShape` e força/impulso em ponto no contrato (ARCHITECTURE §5).
3. **Modelo de pneu** com escorregamento longitudinal e lateral e atrito combinado (curva tipo Pacejka simplificada ou *brush*), substituindo `frictionSlip`/`sideFrictionStiffness`. Aqui o controlador da Rapier sai.
4. **Inércia de roda e diferencial** (aberto/autoblocante), com a rotação do motor vinda das rodas, embreagem/conversor e freio por torque.

Cada etapa mantém `VehicleCommands`/`VehicleTelemetry` como fronteira entre controle, dinâmica e apresentação; a telemetria ganha os campos novos de cada etapa.

## Etapa 1 — implementada

- `vehicle/Powertrain`: curva de torque por rpm (interpolação linear), marcha lenta, corte de giro (torque cai a zero nos últimos 200 rpm), câmbio automático com troca por rpm e histerese (desce só se a marcha de baixo ficar abaixo do giro de troca), corte de torque e intervalo mínimo durante a troca, diferencial, eficiência, ré com relação própria, limitador eletrônico de velocidade (rampa de 1 m/s) e boost como multiplicador de torque limitado (≤ 1,5).
- Força total nas rodas motrizes = torque × relação × diferencial × eficiência / raio × m/(m + J·G²·η/r²); o último fator é a inércia do motor refletida nas rodas (massa equivalente por marcha). Dividida igualmente entre as rodas motrizes.
- Rotação do motor = velocidade do chassi / raio × relação total, nunca abaixo da marcha lenta (sem escorregamento de pneu nem embreagem até a etapa 4).
- Limite de tração por roda motriz: `tractionFriction` × carga normal (força de suspensão do passo anterior), porque o controlador não limita o impulso do motor em linha reta. `frictionSlip` continua governando o atrito lateral e não foi alterado. No passo seguinte a uma escrita de estado do chassi (reset, início de gravação, replay) o limite não se aplica, para o replay não depender do passo anterior.
- `vehicle/aerodynamics`: arrasto 0,5·ρ·Cd·A·v² oposto à velocidade (ρ = 1,225 kg/m³), aplicado ao chassi como impulso por passo (`PhysicsBody.applyImpulse`, novo no contrato).
- `VehicleState`/`VehicleTelemetry` ganham `engineRpm` e `gear` (−1 = ré); HUD de dev mostra os dois; o replay grava marcha e troca em curso.
- Removidos `configs.maxForce`, `configs.maxBoostForce` (substituídos) e `configs.maxSpeed` (sem uso).

### Dados adotados

Valores aproximados de fichas técnicas públicas; os não publicados (inércia, eficiência, Cd·A do G63, diferencial do G63) são estimativas de ordem de grandeza.

| | BMW M4 F82 (S55, DCT 7) | Mercedes-AMG G63 W463A (M177, 9G) |
|---|---|---|
| Potência / torque | 317 kW (431 cv) a 5.500–7.300 rpm; 550 N·m a 1.850–5.500 rpm | 430 kW (585 cv) a 6.000 rpm; 850 N·m a 2.500–3.500 rpm |
| Curva (rpm: N·m) | 750: 320, 1000: 400, 1850: 550, 5500: 550, 7300: 415, 7600: 380 | 650: 450, 1000: 550, 2500: 850, 3500: 850, 6000: 684, 6500: 600 |
| Lenta / troca acima / reduz abaixo / corte (rpm) | 750 / 7.300 / 3.000 / 7.600 | 650 / 6.200 / 2.200 / 6.500 |
| Relações | 4,806 · 2,593 · 1,701 · 1,277 · 1,000 · 0,844 · 0,671; ré 4,172 | 5,35 · 3,24 · 2,25 · 1,64 · 1,21 · 1,00 · 0,87 · 0,72 · 0,60; ré 4,80 |
| Diferencial | 3,462 | 3,27 (estimado) |
| Tração / eficiência | traseira / 0,90 | integral / 0,85 |
| Inércia do motor | 0,20 kg·m² | 0,25 kg·m² |
| Tempo de troca | 0,10 s | 0,20 s |
| Limitador | 280 km/h (M Driver's Package; de série 250) | 220 km/h |
| Boost | × 1,3 no torque | × 1,3 no torque |
| Cd / área frontal | 0,34 / 2,2 m² | 0,54 / 3,3 m² |
| `tractionFriction` | 1,0 | 1,0 |

### Resultado medido (harness em Node, 60 Hz)

| Cenário | Antes (força constante) | Depois | Alvo (fábrica) |
|---|---|---|---|
| BMW 0–100 km/h | 4,43 s | 4,15 s | 3,8–5 s (4,1 s) |
| G63 0–100 km/h | 5,12 s | 5,43 s | 4,3–6 s (4,5 s) |
| BMW velocidade máxima (90 s de acelerador pleno) | sem teto | 272,7 km/h, limitada pelo arrasto em 6ª | 250–300 km/h |
| G63 velocidade máxima | sem teto | 216,7 km/h, limitador | 210–240 km/h |
| BMW trocas (0 → máx.) | — | 2ª a 55, 3ª a 101, 4ª a 154, 5ª a 205, 6ª a 262 km/h | — |
| G63 trocas | — | 2ª a 51, 3ª a 84, 4ª a 121, 5ª a 165 km/h | — |
| BMW / G63 frenagem de 100 km/h | 9,0 / 8,6 m/s² | 8,6 / 8,7 m/s² | 7–12 m/s² |
| BMW / G63 curva (acelerador + esquerda) | 1,07 / 0,92 g | 1,06 / 0,83 g | < 1,3 g |

Testes: `test/vehicle/Powertrain.test.ts` (fórmulas, troca, histerese, corte, limitador, ré, boost, coerência do catálogo), `test/physics/vehicle-powertrain.test.ts` (0–100, velocidade máxima, marchas monotônicas, rpm entre a lenta e o corte, arrasto analítico e no `PhysicsWorld`), replay iniciado em marcha alta.

## Etapa 2 — implementada

- `PhysicsWorld.castRayWithNormal` (distância, ponto, normal e corpo atingido, com corpo excluído, escreve em `out`), `PhysicsBody.applyImpulseAtPoint` e `PhysicsBody.getVelocityAtPoint`. A consulta vê os colisores como no fim do último passo.
- `vehicle/Suspension` (sem THREE nem motor): mola linear (N/m), amortecedor com coeficientes de compressão e extensão (N·s/m), batente progressivo (força = rigidez × penetração², N/m², a partir de `maxCompression − bumpStopLength`) e barra estabilizadora por eixo (N/m de diferença de compressão entre esquerda e direita). Força total ≥ 0; roda sem contato fica estendida e sem força.
- `VehiclePhysics.updateSuspension`, no pré-passo, antes do controlador: um raio por roda da fixação ao longo do −Y do chassi, com comprimento `repouso + raio`, ignorando o chassi; força aplicada como impulso (força × dt) ao longo da normal de contato, **no ponto de fixação**.
- Velocidade de compressão pela variação do comprimento no último passo (roda sem contato conta como estendida); logo depois de escrever o estado do chassi (reset, gravação, replay) vem da velocidade do corpo (velocidade relativa na normal / cos(normal, suspensão)), para o replay não depender do passo anterior. Motivo: a Rapier integra em 4 subpassos e a velocidade ao fim do passo difere da média em g·dt·3/8 (0,061 m/s a 60 Hz); usada no amortecedor, dava 8% da carga estática no amortecedor e o carro 6–8 mm mais alto (o modelo Bullet tinha o mesmo efeito).
- **Ligação com o controlador (saída “suspensão neutralizada”).** A Rapier não permite desligar só a suspensão do `DynamicRayCastVehicleController`. Ele continua com as rodas para esterço, motor, freio e atrito, mas com força máxima de suspensão 0 (não aplica impulso) e amortecimento 0. O atrito do controlador é limitado por `forçaDeSuspensão × dt × frictionSlip`, com a força calculada antes do limite de força máxima como `rigidez × massa × (repouso − comprimento) / cos`; a cada passo `RaycastVehicle.setWheelTireLoad` escolhe a rigidez para essa força ser a carga normal da suspensão própria (comprimento e cosseno vêm do mesmo raio; compressão mínima de 1 mm na conversão). Teste: a carga lida do controlador é a da suspensão (±0,1%). O limite de tração da etapa 1 usa a mesma carga.
- Telemetria (contato, comprimento, compressão e força por roda) e `VehicleView` passam a ler a suspensão própria; o replay continua bit a bit.

### Conversão dos parâmetros

O modelo Bullet dá, por roda, `F = massa × (k′·x − c′·v)`, com `k′` (1/s²) e `c′` (1/s) por kg de chassi. Rigidez e amortecimento absolutos por roda: `k = k′·m`, `c = c′·m`. A rigidez por roda é igual nas quatro, como antes, então a carga estática segue a posição do CG e a altura de repouso e a frequência natural ficam as do modelo anterior.

| | BMW (m = 1.550 kg) | G63 (m = 2.500 kg) |
|---|---|---|
| Rigidez k′ → k | 30 1/s² → 46.500 N/m | 25 1/s² → 62.500 N/m |
| Compressão c′ → c | 3,2 1/s → 4.960 N·s/m | 3,2 1/s → 8.000 N·s/m |
| Extensão c′ → c | 1,6 1/s → 2.480 N·s/m | 1,6 1/s → 4.000 N·s/m |
| Frequência natural √(k/(m/4))/2π | 1,74 Hz | 1,59 Hz |
| Razão de amortecimento compressão / extensão | 0,58 / 0,29 | 0,64 / 0,32 |
| Compressão estática média m·g/4k | 8,2 cm | 9,8 cm |
| Fim de curso / zona do batente / rigidez | 0,20 m / 0,08 m / 10⁷ N/m² | 0,25 m / 0,08 m / 10⁷ N/m² |
| Barra dianteira / traseira | 25.000 / 12.000 N/m | 30.000 / 15.000 N/m |

`maxSuspensionTravel` (0,4 / 0,8 m, sem efeito: o chassi tocava o chão antes) e `maxSuspensionForce` (100 kN) saíram; o fim de curso novo fica antes de o colisor do chassi (meia altura 0,6 m) tocar o chão. Batente e barras são valores novos (estimativas), não conversão.

### Resultado medido (harness em Node, 60 Hz)

| Cenário | Antes (etapa 1) | Depois |
|---|---|---|
| BMW / G63 0–100 km/h | 4,15 / 5,43 s | 4,22 / 5,37 s |
| BMW / G63 frenagem de 100 km/h | 8,64 / 8,73 m/s² | 8,71 / 8,74 m/s² |
| BMW / G63 curva (acelerador + esquerda), aceleração lateral | 1,064 / 0,829 g | 1,080 / 0,863 g |
| BMW / G63 guinada na curva | 0,416 / 0,499 rad/s | 0,431 / 0,520 rad/s |
| BMW / G63 velocidade máxima | 272,7 / 216,7 km/h | 272,7 / 216,7 km/h |
| BMW / G63 altura de repouso do chassi | 0,7744 / 1,0892 m | 0,7679 / 1,0813 m |
| Custo da física por passo (Node, BMW em curva) | ~12 µs | ~17 µs |

Atribuição: com a força no ponto de contato e a velocidade do corpo no amortecedor o resultado era igual ao do controlador (linha de base inalterada, tolerância de 2%); a compressão pela variação de comprimento baixou o repouso; a força no ponto de fixação tirou o momento desestabilizador `m·g·L·φ` (L = comprimento da suspensão, φ = rolagem) e aumentou a guinada da curva em ~4,5%; as barras mudaram a guinada em −1,1% (BMW) e −0,2% (G63).

Testes: `test/physics/physics-world-queries.test.ts` (contrato), `test/vehicle/Suspension.test.ts` (leis de força), `test/physics/vehicle-suspension.test.ts` (carga estática por roda pelo CG e no controlador, altura de repouso, frequência natural ±10%, razão de amortecimento por decremento logarítmico ±15% com eixos simétricos, amortecimento do catálogo, queda de 1 m dentro do fim de curso e sem tocar o chassi, rigidez de rolagem sob torque constante igual a k·t²/2 por eixo mais k_barra·t² por eixo, barra reduz a rolagem na curva).

Limitações: sem massa não suspensa (a roda não tem inércia nem salta); a reação da suspensão não é aplicada ao corpo atingido (como no controlador); um raio por roda (sem shape cast: degraus e bordas finas passam entre raios); a carga para o atrito ainda passa pelo truque de rigidez enquanto o pneu for do controlador (sai na etapa 3); a rolagem em curva é pequena (BMW < 1° a ~1 g, braço de rolagem efetivo ~0,13 m) e a barra a reduz menos do que a rigidez de rolagem indicaria (BMW −24%, G63 −53% com barras de k/2); a hipótese é o controlador aplicar o impulso lateral perto da altura do CG (`roll_influence` da Rapier, sem acesso pela API JS) — não verificado, resolve-se com o pneu próprio da etapa 3.

## Consequências

- Velocidade máxima e aceleração passam a depender de potência, relações e arrasto, como num carro real; a velocidade máxima leva ~5 km para ser atingida (o plano do jogo tem 200 m; P2-3).
- O G63 fica mais lento que o real na largada (5,4 × 4,5 s): falta a multiplicação de torque do conversor e o escorregamento do pneu; resolver nas etapas 3–4, não com tuning.
- Sem freio-motor nem resistência ao rolamento com acelerador: só o arrasto, o `linearDamping` 0,01 do chassi e a `rollingResistance` sem pedal. O `linearDamping` vira redundante com o arrasto; removê-lo é mudança de comportamento para outra tarefa.
- `tractionFriction` é provisório: some na etapa 3, quando o pneu modelar a aderência longitudinal e lateral juntas.
- Contrato `PhysicsWorld` ganha `PhysicsBody.applyImpulse`; `VehicleDefinition` ganha `powertrain`, `aerodynamics` e `physics.tractionFriction`; `VehicleState`/`VehicleTelemetry`/`ReplayInitialState` ganham marcha (e rpm/troca, conforme o caso).
- Etapa 2 feita (seção acima). Próximo passo: etapa 3 (modelo de pneu), quando o controlador da Rapier sai.

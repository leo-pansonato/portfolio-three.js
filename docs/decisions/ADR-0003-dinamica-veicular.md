# ADR-0003 — Dinâmica veicular própria, em etapas

- **Status:** Aceita (2026-11-02); implementada (etapas 1 a 4, 2026-11-02)
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

## Etapa 3 — implementada

O `DynamicRayCastVehicleController` saiu do veículo e do contrato (`RaycastVehicle`, `createVehicleController`, `RapierVehicle`, `frictionSlip`, `sideFrictionStiffness`, `tractionFriction` removidos). Nada dele foi mantido.

- `vehicle/Tire` (sem THREE nem motor): escorregamento longitudinal κ = (ω·r − vx)/max(|vx|, vMín) e deriva α = atan(vy/max(|vx|, vMín)), com vMín = 1 m/s (`tire.lowSpeedThreshold`): parado κ = α = 0, sem singularidade. Curva de Pacejka simplificada F = μ·Fz·sin(C·atan(B·x − E·(B·x − atan(B·x)))) por direção (`tire.longitudinal`, `tire.lateral`; o pico é achado por bisseção para qualquer E ≤ 1, C > 1). Atrito combinado por escorregamento normalizado: sx = κ/κpico, sy = α/αpico, s = |(sx, sy)|; cada força usa a sua curva em s e a fração sx/s ou sy/s, o que mantém a força dentro da elipse (μx·Fz, μy·Fz).
- `vehicle/WheelDynamics`: velocidade angular (rad/s) com inércia `physics.wheelInertia` mais a do motor refletida (J·G²·η dividida pelas rodas motrizes). Euler implícito no passo de 1/60 s, sem subpassos: a força de cada direção é a do escorregamento no fim do passo, com a roda acelerada pelos torques e o contato pela massa do chassi que ele carrega. Cada direção vira F = Fpneu(escorregamento(F)), monótona, resolvida por falsa posição (Illinois) entre ±μ·Fz: lateral primeiro (com κ do início do passo), longitudinal depois. Freio de Coulomb: se o torque que segura a roda parada cabe no freio, ela trava; senão o freio se opõe ao giro, sem inverter. Elipse de atrito no fim.
- A primeira versão linearizava a curva no início do passo (inclinação ≥ 0). Passado o pico, o passo virava explícito e saltava a região linear: ciclo-limite parado (G63 com ±5 kN alternando a cada passo). A raiz da equação implícita resolve isso.
- `VehiclePhysics`: mede as quatro rodas, calcula suspensão e pneus no mesmo estado do chassi e só então aplica os impulsos. Aplicar o impulso de cada roda antes de medir a próxima criava assimetria: BMW 4,3 m de desvio em 80 m de reta. Frente da roda = frente do chassi girada pelo esterço e projetada no plano de contato; direita = frente × normal. Impulso (Fx·frente + Fy·direita)·dt no ponto de contato (`applyImpulseAtPoint`). Esterço como antes, sem Ackermann.
- Massa do contato = fração (carga da roda / soma das cargas) da massa efetiva do chassi para um impulso no chão: 1/(1/m + h²/I), com h a altura do CG sobre o contato e I a inércia de rolagem (lateral) ou de arfagem (longitudinal) da caixa uniforme do collider. Com a massa só pela carga, o pneu lateral passava do ponto em baixa velocidade (o impulso no chão também rola o chassi): o G63 oscilava parado e derivava 1,8 cm.
- Torque: `Powertrain.step` devolve torque nas rodas (N·m), `reflectedInertia()` a inércia do motor nas rodas; `VehicleCommands` passou a `driveTorque`, `frontBrakeTorque`, `rearBrakeTorque`, `handbrakeTorque` (N·m por roda) e `drivelineInertia`. Rotação do motor = média de ω·r das rodas motrizes × relação total, nunca abaixo da lenta. A troca de marcha usa a velocidade do veículo (como a central do câmbio), para não caçar marcha com a roda patinando; o limitador de velocidade também.
- **Provisório até a etapa 4:** diferencial aberto com o mesmo torque em cada roda motriz (o G63 reparte igual entre as quatro: centro e eixos abertos); a inércia do motor entra em cada roda motriz como J·G²·η/n, exata só com as rodas na mesma velocidade; embreagem fechada só com acelerador e fora de troca. Freando em 1ª com a embreagem sempre fechada, a inércia refletida (25 kg·m² por roda no BMW) consumia quase todo o freio traseiro. Sem conversor nem freio-motor.
- Freios em N·m: os valores em N do catálogo foram convertidos por r (BMW 3.600 N → 1.188 N·m; G63 5.700 N → 2.166 N·m), depois repartidos por eixo (tabela abaixo). A resistência ao rolamento sem pedal virou torque (30,7 e 28,5 N·m).
- **Centro de massa** (`ColliderConfig.centerOfMass`, novo no contrato; `physics.centerOfMass`): com o pneu no contato, o CG no centro do collider (BMW 0,77 m, G63 1,08 m do chão) capotava o G63 a ~0,74 g de aceleração lateral. Passou para 0,27 m (BMW) e 0,28 m (G63) abaixo do centro: ~0,50 m e ~0,80 m do chão. A massa continua densidade × volume e a inércia é a da caixa uniforme. Esse item estava previsto para a etapa 4 e veio antes porque bloqueava a etapa 3.
- Telemetria: por roda, velocidade angular, escorregamento, deriva e forças (N), além dos impulsos (N·s) que o HUD já mostrava. O HUD de dev ganhou escorregamento (%) e deriva (°). `VehicleView` lê esterço e giro da física própria. Replay: ao escrever o estado do chassi (gravação, reprodução, reset), as rodas passam a rolar na velocidade do chassi no ponto de fixação. Isso só depende do estado escrito e mantém a reprodução bit a bit.

### Dados adotados

Estimativas de ordem de grandeza: pneu de rua esportivo (BMW) e SUV com roda 22" (G63). Os freios são a conversão acima com divisão por eixo.

| | BMW | G63 |
|---|---|---|
| Longitudinal B / C / μ / E (pico κ) | 24 / 1,3 / 1,15 / 0 (0,11) | 20 / 1,3 / 1,0 / 0 (0,13) |
| Lateral B / C / μ / E (pico α) | 19 / 1,3 / 1,05 / 0 (7,9°) | 15 / 1,3 / 0,9 / 0 (10°) |
| vMín | 1 m/s | 1 m/s |
| Inércia da roda | 1,3 kg·m² | 2,3 kg·m² |
| Freio por roda dianteira / traseira | 1.616 / 760 N·m (68/32, total igual ao anterior) | 2.900 / 1.200 N·m (71/29, total −5%) |
| Freio de mão por roda traseira | 2.000 N·m (antes 1.089) | 2.900 N·m (antes 1.482) |
| Centro de massa (y local) | −0,27 m | −0,28 m |

O freio de mão convertido não travava a roda (abaixo de r·μ·Fz da traseira). Com os freios iguais nos dois eixos, a traseira travava antes da dianteira e o carro rodava em frenagem reta. μx do G63 foi de 0,95 para 1,0 (com 0,95: 0–100 em 6,02 s).

### Resultado medido (harness em Node, 60 Hz)

| Cenário | Antes (etapa 2) | Depois |
|---|---|---|
| BMW / G63 0–100 km/h | 4,22 / 5,37 s | 4,37 / 5,87 s |
| BMW / G63 velocidade máxima | 272,7 / 216,7 km/h | 272,2 / 216,7 km/h |
| BMW / G63 frenagem de 100 km/h (média até parar) | 8,71 / 8,74 m/s² | 8,59 / 8,31 m/s² |
| BMW / G63 skidpad, aceleração lateral máxima (cenário novo) | — | 0,976 / 0,810 g |
| BMW / G63 curva com acelerador pleno e volante todo (aceleração lateral) | 1,08 / 0,86 g | 0,56 / 0,70 g (o BMW roda: 3,6 m/s, 1,55 rad/s) |
| BMW / G63 altura de repouso | 0,7679 / 1,0813 m | 0,7679 / 1,0813 m |
| BMW / G63 desvio lateral em 5 s de reta | 0 / 0 m | 6·10⁻¹⁰ / 1·10⁻⁸ m |
| BMW / G63 rolagem por aceleração lateral, sem barra → com barra | 0,00099 → 0,00055 / 0,00174 → 0,00101 rad/(m/s²) | 0,00619 → 0,00351 / 0,01199 → 0,00710 rad/(m/s²) |
| Custo da física por passo (Node, BMW em curva) | ~12,7 µs | ~20 µs |

Rolagem: a 1 g, BMW 2,0° (3,5° sem barra) e G63 4,0° (6,7° sem barra); antes, 0,3° e 0,6°. A barra reduz a rolagem em 43% (BMW) e 41% (G63), igual à razão de rigidez. A medida bate com m·h/(K + m·g·d) em ±0,3%: h é a altura do CG, K = Σ eixo (k·t²/2 + k_barra·t²) e d a altura da fixação da suspensão acima do CG (o peso nas fixações estabiliza). Antes a medida também acompanhava a barra (−44% e −42%), mas com braço de rolagem ~6 vezes menor. A observação da etapa 2 de que a barra reduzia menos do que a rigidez indicava vinha do teste, não da física: a fórmula de rolagem usava o +Y local no plano do mundo e variava com o rumo do carro em curva. O teste foi corrigido.

Freio de mão a 60 km/h com volante à esquerda: as rodas traseiras travam (κ = −1), a deriva traseira passa do pico do pneu e a deriva do chassi passa de 2 vezes a da mesma curva sem freio de mão (teste).

Testes: `test/vehicle/Tire.test.ts` (pico analítico e numérico, simetria, força lateral zero com α = 0, rigidez inicial B·C·μ·Fz, saturação, proporcional à carga, elipse em grade nos três pneus, regularização parado), `test/vehicle/WheelDynamics.test.ts` (rolamento livre, convergência sem oscilar abaixo da aderência, roda que dispara acima dela, travamento sem inverter, freio abaixo do travamento, roda no ar, quarto de carro: deriva lateral a zero sem trocar de sinal, arrancada monotônica, aceleração igual a 1/60 e 1/240 s com até 1% de diferença, parada sem tremer), `test/physics/physics-world-queries.test.ts` (centro de massa), `test/physics/vehicle-plausibility.test.ts` (faixas acima, skidpad, freio de mão), `test/physics/vehicle-suspension.test.ts` (rolagem contra o analítico), `test/vehicle/VehicleTelemetry.test.ts` (forças e escorregamentos por roda).

Limitações:

- Acelerador pleno em curva fechada faz o BMW rodar (tração traseira de 317 kW sem controle de tração); na 2ª a 60–100 km/h a traseira patina. É plausível para o carro sem assistências; o controle de tração é do P2-2.
- G63 0–100 em 5,87 s (real 4,5): com diferenciais abertos as rodas dianteiras, aliviadas na arrancada, patinam e levam o motor ao corte. Resolve-se com o diferencial da etapa 4 (central com repartição 40/60 e bloqueio), não com tuning.
- Parado em rampa, o pneu é viscoso, sem estado de deformação: espera-se deslizamento lento de ~g·sinθ·dt por passo, mesmo freado. Não foi medido, porque não há cenário de rampa; resolve-se com comprimento de relaxação.
- A roda livre fica um passo atrás do chassi, porque cada roda é resolvida sem ver a aceleração vinda das outras. Na telemetria isso aparece como escorregamento de −a·dt/v no início do passo; a força média está certa.
- Custo: ~60% a mais por passo (a busca de raiz roda até 3 vezes por roda). Ainda muito abaixo do orçamento (P3-1).

## Etapa 4 — implementada

Trem de força acoplado às rodas (`vehicle/Driveline`, `vehicle/Engine`, `vehicle/TorqueConverter`); o que a etapa 3 deixou como provisório (torque igual por roda motriz, inércia do motor refletida J·G²·η/n, embreagem fechada só com acelerador) saiu.

- **Motor** (`Engine`, sem estado): torque líquido = a·Tplena·multiplicador − (1 − a)·Tarrasto, com a o acelerador efetivo. Arrasto (freio-motor) linear entre a lenta e o corte (`powertrain.friction`). Controle de lenta: acelerador todo na lenta, nenhum 20 rpm acima. Corte de giro: o acelerador efetivo cai a zero nos últimos 200 rpm (no corte só arrasta).
- **Rotação do motor é estado próprio** (`Driveline.engineSpeed`, rad/s), com a inércia `engineInertia`; o `VehicleState.engineRpm` passou a ser cópia lida no início do passo. A embreagem é atrito de Coulomb: trava se o torque que iguala motor e entrada do câmbio no fim do passo couber na capacidade, senão transmite a capacidade.
- **Conversor** (G63, em paralelo com a embreagem de travamento): bomba (ω/K)² com K pela rotação de estol, caindo a zero entre o ponto de acoplamento e SR = 1; turbina com multiplicação TR caindo de TRestol a 1 no ponto de acoplamento; turbina mais rápida arrasta o motor sem multiplicação. Parado sem acelerador o conversor desacopla (sem *creep*: o repouso continua parado).
- **Diferenciais** (`powertrain.differentials`): árvore com saídas A/B, repartição de torque (0,5 nos de eixo, 0,4 no central do G63) e embreagem de bloqueio: |τ| ≤ pré-carga + bloqueio × |torque de entrada| (bloqueio diferente tracionando e em desaceleração), mais acoplamento viscoso c·Δω. Cinemática: ω da entrada = f·ωA + (1 − f)·ωB.
- **Solução no passo de 1/60 s, sem subpassos.** `WheelDynamics` foi separada em `prepare`/`solve`/`commit` e devolve dω/dT (resposta da velocidade no fim do passo ao torque, pela derivada da curva do pneu no escorregamento final; refatoração sem mudança de resultado, testada contra diferença finita). Com as rodas motrizes linearizadas, cada diferencial tem solução fechada (travado se o τ que iguala as saídas couber na capacidade; senão capacidade + viscoso), e motor + embreagem/conversor viram uma equação monótona numa variável (velocidade da entrada do câmbio no fim do passo), resolvida por falsa posição com o torque do motor avaliado na rotação final (implícito: o controle de lenta e o corte são rígidos). Os torques vão às rodas, resolvidas de novo sem linearizar; até 4 iterações de Newton, até a velocidade prevista bater com a resolvida (1e-4 rad/s). Com a embreagem travada a rotação final do motor é a da cinemática das rodas resolvidas. O ponto de partida das iterações (torque de cada nó no passo anterior) é zerado ao escrever o estado do chassi; o motor vai para a rotação da marcha do estado escrito (`ReplayInitialState.gear`), então o replay continua bit a bit.
- **Central do câmbio** (`Powertrain`): embreagem fecha entre `engagementStartRpm` e `engagementRpm` pela rotação da entrada do câmbio e, sem conversor e com acelerador, também pela do motor (arrancada com escorregamento). Na troca, embreagem e conversor voltam a acoplar ao longo de `shiftTime` e o acelerador leva o motor à rotação nova: proporcional, fecha com o motor 500 rpm acima, abre com ele abaixo (aceleração na redução). Uma primeira versão liga-desliga oscilava a cada passo na troca do G63. Ponto morto (marcha 0) existe no estado (sai com acelerador ou ré); nada do jogo o seleciona, só testes.
- `VehicleCommands` trocou `driveTorque`/`drivelineInertia` por `throttle`, `torqueMultiplier`, `gearRatio` (negativa em ré, 0 em ponto morto), `clutchTorque` e `converterCoupling` (`DrivelineCommands`). `VehicleControl.step` recebe a rotação do motor (`VehiclePhysics.engineRpm()`); `drivenWheelSpeed()` passou a ser a velocidade da saída do câmbio pela cinemática dos diferenciais. Telemetria: `clutchSlipRpm`, `clutchLocked` e `driveTorque` por roda.

### Dados adotados

Estimativas de ordem de grandeza (nenhum valor é ficha técnica):

| | BMW (DCT) | G63 (9G, conversor) |
|---|---|---|
| Arrasto do motor na lenta / no corte | 25 / 80 N·m | 30 / 100 N·m |
| Embreagem: capacidade / começa / fecha (rpm) | 1.000 N·m / 750 / 3.000 | travamento 1.300 N·m / 1.800 / 2.500 (entrada do câmbio) |
| Conversor: estol / TR no estol / ponto de acoplamento | — | 2.500 rpm / 1,9 / 0,85 |
| Diferencial traseiro | autoblocante: pré-carga 40 N·m, bloqueio 0,2 tracionando / 0,1 em desaceleração (diferença de torque até 40% / 20% da entrada) | aberto |
| Diferencial dianteiro | — | aberto |
| Diferencial central | — | 40/60, pré-carga 100 N·m, bloqueio 0,3 / 0,15 |

**Parâmetro existente alterado:** μx do G63 voltou de 1,0 para 0,95 (commit próprio). A etapa 3 o subira para compensar os diferenciais abertos; com o central bloqueando, o 0–100 caía para 4,27 s, abaixo da faixa (4,3–6 s, real 4,5). Bloqueio menor no central deixava o tempo na faixa, mas as dianteiras patinavam mais que na etapa 3 (bloqueio 0,15: 4,42 s e escorregamento médio 0,94).

### Resultado medido (harness em Node, 60 Hz)

| Cenário | Antes (etapa 3) | Depois |
|---|---|---|
| BMW / G63 0–100 km/h | 4,37 / 5,87 s | 4,40 / 4,35 s |
| BMW / G63 velocidade máxima | 272,2 / 216,7 km/h | 272,2 / 216,7 km/h |
| BMW / G63 frenagem de 100 km/h | 8,59 / 8,31 m/s² | 8,48 / 8,52 m/s² |
| BMW / G63 skidpad | 0,976 / 0,810 g | 0,985 / 0,825 g |
| G63 escorregamento médio das dianteiras no 0–100 | 0,674 | 0,471 (central livre 40/60: 1,62) |
| BMW curva com acelerador 0,35 (40 km/h, volante 0,3): média de \|ωTE − ωTD\| | — | 0,13 rad/s (aberto: 2,23) |
| Sem pedais a 80 km/h, desaceleração em marcha / em ponto morto | 0,57 / 0,52 m/s² (sem freio-motor) | BMW 1,38 / 0,57, G63 1,22 / 0,52 m/s² |
| BMW / G63 rotação parado | 750 / 650 rpm (piso da lenta) | 769 / 669 rpm, variação < 0,01 rpm por passo |
| Linha de base: G63 / BMW em 5 s de reta | 87,2 / 108,7 km/h | 109,2 / 109,9 km/h |
| Linha de base: curva com acelerador pleno, G63 | 0,91 rad/s, r 8,3 m | 0,50 rad/s, r 24,5 m (central bloqueado sai de frente) |
| Linha de base: curva, BMW | 1,55 rad/s | 2,12 rad/s (roda; o autoblocante leva torque à roda de fora) |
| Custo da física por passo (Node, curva, mediana de 5 × 3.000 passos) | 19,4 / 19,3 µs | 23,3 / 24,2 µs (+20% / +26%) |

Testes: `test/vehicle/Driveline.test.ts` (aberto reparte igual e a roda no ar dispara; autoblocante escorregando transfere 2·(pré-carga + bloqueio·|T|) para a roda lenta; com capacidade de sobra as saídas terminam o passo juntas; viscoso; central 40/60; embreagem travada dá rotação = relação × saída; escorregando transmite a capacidade; ponto morto cai para a lenta e sobe até o corte, monotônico; conversor no estol), `test/vehicle/Powertrain.test.ts` (motor, conversor, central do câmbio), `test/vehicle/WheelDynamics.test.ts` (prepare/solve igual a step; dω/dT), `test/physics/vehicle-driveline.test.ts` (freio-motor contra ponto morto; desaceleração até parar reduzindo uma marcha por vez com rotação entre a lenta e o corte; lenta parada sem oscilar; autoblocante contra aberto; central contra a etapa 3 e contra livre), velocidade máxima com rotação parada nos últimos 10 s, arrasto medido em ponto morto.

Limitações:

- Sem controle de tração: o G63 patina as quatro rodas na arrancada (escorregamento até ~3) e o BMW patina a traseira (médio 1,0 no 0–100, antes 0,45, porque o autoblocante não deixa uma roda só aliviar). É do P2-2.
- O pneu sem sensibilidade à carga deixa as traseiras do G63 (10 kN cada na arrancada) com μ cheio; por isso o 0–100 sem controle de tração ainda é mais rápido que o real.
- O conversor é rígido em rotação alta (bomba ∝ ω²); a troca só fica suave porque o acoplamento volta ao longo de `shiftTime`.
- Rotação na lenta fica até 20 rpm acima de `idleRpm` (equilíbrio do controle de lenta).
- Sem embreagem do G63 parado em marcha (o conversor desacopla sem acelerador) e sem seleção de ponto morto pelo jogador.

## Consequências

- Velocidade máxima e aceleração passam a depender de potência, relações e arrasto, como num carro real; a velocidade máxima leva ~5 km para ser atingida (o plano do jogo tem 200 m; P2-3).
- Depois da etapa 4 o G63 faz 0–100 em 4,35 s (real 4,5) e o BMW em 4,40 s (real 4,1), os dois sem controle de tração.
- Freio-motor desde a etapa 4. Sem resistência ao rolamento com acelerador: só o arrasto, o `linearDamping` 0,01 do chassi e a `rollingResistance` sem pedal. O `linearDamping` é redundante com o arrasto; removê-lo é mudança de comportamento para outra tarefa.
- `tractionFriction` saiu na etapa 3 com o controlador da Rapier; o pneu limita tração e atrito lateral juntos.
- Contrato `PhysicsWorld` ganha `PhysicsBody.applyImpulse`; `VehicleDefinition` ganha `powertrain`, `aerodynamics` e `physics.tractionFriction`; `VehicleState`/`VehicleTelemetry`/`ReplayInitialState` ganham marcha (e rpm/troca, conforme o caso).
- Etapas 2 e 3 feitas (seções acima). Contrato: `PhysicsWorld` perdeu `RaycastVehicle`/`createVehicleController` e ganhou `ColliderConfig.centerOfMass`; `VehicleDefinition` ganhou `tire`, `physics.wheelInertia`, `physics.centerOfMass` e freio por eixo em N·m; `VehicleCommands` passou a torques. Etapa 4: `VehicleCommands` passou a comandos do trem de força (`DrivelineCommands`), `VehicleDefinition.powertrain` ganhou `friction`, `clutch`, `torqueConverter` e `differentials`, e a rotação do motor passou a ser estado da física. Próximo item: controle de tração e ESC (P2-2).

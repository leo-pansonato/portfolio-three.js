# ADR-0002 — Unidades SI e convenção de eixos

- **Status:** Aceita (2026-11-01)
- **Data:** 2026-11-01
- **Escopo:** unidades de toda grandeza física e sistema de coordenadas do mundo e do veículo (ROADMAP P0-6).

## Contexto

Até o P0-6, os modelos eram carregados com `scale 0.5`, o chassi media 2,3 × 0,6 × 0,9 e as massas eram 200 kg (BMW) e 400 kg (G63). A gravidade já era real (−9,82 m/s²), então os carros se comportavam como miniaturas de 2,3 m e 200 kg. Nenhum parâmetro tinha significado físico, e as velocidades do HUD não eram velocidades reais.

A “frente” do chassi era +X na prática (o controlador da Rapier usa o eixo 0 como frente), mas o `Player` calculava a velocidade contra `(-1, 0, 0)` e invertia o sinal na exibição.

## Decisão

### Unidades

SI em todo código de simulação: **1 unidade do mundo = 1 m**, kg, s, N, rad. Velocidades internas em m/s; km/h só na apresentação (`Player.getCurrentSpeed`). Grandezas novas declaram a unidade no nome ou no comentário.

Particularidades do `DynamicRayCastVehicleController` (modelo Bullet), registradas em `VehiclePhysicsConfig`:

| Parâmetro | Unidade |
|---|---|
| `suspensionStiffness` | N/m por kg de chassi (1/s²); a força é multiplicada pela massa do chassi |
| `suspensionCompression`, `suspensionRelaxation` | N·s/m por kg de chassi (1/s) |
| `maxSuspensionForce` | N por roda |
| `frictionSlip`, `sideFrictionStiffness` | adimensionais |
| `configs.maxForce` | N por roda motriz |
| `configs.brakeForce`, `eBrakeForce`, `rollingResistance` | impulso por roda **a cada passo** (N·s, passo de 1/60 s) |

O freio como impulso por passo é herança do controlador: mudar o passo exige reescalar esses valores (P1-1).

### Eixos

- **Mundo:** destro, +Y para cima (padrão do Three.js e da Rapier), gravidade em −Y.
- **Chassi (local):** frente **+X**, cima **+Y**, direita **+Z**.
- **Direção:** ângulo de esterço positivo gira em torno de +Y, isto é, **vira à esquerda**; `getSteer()` (−1 esquerda, +1 direita) é invertido ao virar ângulo.
- **Rodas:** índices 0/1 dianteiras esquerda (−Z)/direita (+Z), 2/3 traseiras esquerda/direita; suspensão em −Y local, eixo da roda em +Z local.
- Os modelos glTF continuam com sua orientação própria; `body.rotation` no catálogo os alinha ao chassi.

### Valores adotados

| | BMW M4 F82 | Mercedes G63 |
|---|---|---|
| Escala do modelo | 1 (comprimento 4,70 m pelo glTF) | 1 (4,72 m) |
| Collider do chassi | 4,6 × 1,2 × 1,8 m | 4,6 × 1,2 × 1,8 m |
| Massa | 1.550 kg | 2.500 kg |
| Raio da roda | 0,33 m | 0,38 m |
| Entre-eixos / bitola | 2,82 m / 1,60–1,62 m | 2,77 m / 1,60 m |
| Suspensão: repouso / curso | 0,52 / 0,40 m | 0,80 / 0,80 m |
| Rigidez (por kg) → frequência, deflexão estática | 30 → 1,7 Hz, 8 cm | 25 → 1,6 Hz, 10 cm |
| `frictionSlip` | 2,0 | 1,4 |
| Força do motor | 5.000 N × 2 rodas (traseira) | 3.500 N × 4 rodas |
| Freio | 60 N·s/passo por roda | 95 N·s/passo por roda |

Dimensões, posições de roda, offsets de câmera e do corpo visual foram multiplicados por 2. A rigidez caiu à metade para manter a deflexão estática proporcional à geometria; o amortecimento mantém a razão de amortecimento anterior (`c/√k`).

## Resultado medido (`npm test`, harness em Node, 60 Hz)

| Cenário | Antes (escala 0,5) | Depois (SI) | Alvo |
|---|---|---|---|
| BMW 0–100 km/h | não chega em 5 s (52 km/h) | 4,43 s | 3,5–6 s |
| G63 0–100 km/h | não chega em 5 s (70 km/h) | 5,12 s | 4–7 s |
| BMW frenagem de 100 km/h | — | 9,0 m/s², 41,6 m | 7–12 m/s² |
| G63 frenagem de 100 km/h | — | 8,6 m/s², 44,3 m | 7–12 m/s² |
| BMW curva (acelerador + esquerda) | 1,80 g, raio 4,3 m | 1,07 g, raio 51 m | < 1,3 g |
| G63 curva | 1,27 g, raio 5,3 m | 0,92 g, raio 17 m | < 1,3 g |
| Repouso (deriva em 8 s) | < 1e-6 m | < 2e-6 m | < 1 cm |

Limites em `test/physics/vehicle-plausibility.test.ts`; linha de base em `test/baselines/rapier.json`.

## Consequências

- O tuning anterior não vale mais; os parâmetros passam a ser comparáveis a carros reais.
- Sem arrasto aerodinâmico nem câmbio, a velocidade cresce sem limite com acelerador pleno (BMW ~113 km/h em 5 s, sem teto). O plano do jogo (200 m) acaba em poucos segundos a velocidades reais.
- O centro de massa fica no centro do collider (~0,77 m do chão no BMW), mais alto que num carro real; a margem de capotamento depende disso.
- Os cenários do harness usam um chão de 1 km: a 100 km/h a frenagem já passava dos 100 m do plano do jogo.
- Código de simulação novo (P1-2, P2-1) herda esta convenção; contratos `VehicleDefinition`/`VehicleState` devem citá-la.

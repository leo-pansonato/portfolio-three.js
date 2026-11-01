# Arquitetura

Este documento descreve a arquitetura **como ela está no código** e, separadamente, a arquitetura para onde ela deve evoluir. Cada afirmação usa uma das três marcações:

- **[Implementado]** — verificado no código da `master` (e, quando dito, na `refact/rapier3d`).
- **[Planejado]** — evolução recomendada, ainda inexistente.
- **[Investigar]** — questão em aberto que exige análise antes de decidir.

Referência de base: branch `stabilize/rapier` (Rapier, ROADMAP P0-5). A implementação anterior com cannon-es e a `refact/rapier3d` são comparadas no [ADR-0001](docs/decisions/ADR-0001-motor-de-fisica.md).

---

## 1. Visão geral [Implementado]

Aplicação de navegador, sem servidor. Um único bundle Vite carrega `src/main.ts`, que instancia a classe `Game`. `Game` cria todos os subsistemas no construtor, guarda cada um em um campo público e roda um loop com `requestAnimationFrame`.

Não há ECS, injeção de dependência, barramento de eventos nem estado serializável. Os subsistemas recebem referências diretas uns dos outros pelo construtor. O único mecanismo de publicação/assinatura é `DevModeManager` (singleton `devMode`).

Tamanho: ~2,4 mil linhas de TypeScript em 15 arquivos de jogo. Testes: Vitest em Node (`test/`), com cenários de referência do veículo (§3.8).

```mermaid
flowchart TD
    main["main.ts — Game"]
    subgraph managers
        PM["PhysicsManager<br/>(Rapier World)"]
        IM["InputManager"]
        LM["LightingManager<br/>(CSM)"]
        UI["UIManager<br/>(DOM)"]
        PerfM["PerformanceManager<br/>(Stats)"]
        VM["VehicleManager<br/>(catálogo + carregamento)"]
        DM(["devMode<br/>(singleton pub/sub)"])
    end
    subgraph components
        P["Player<br/>(veículo)"]
        CC["CameraController"]
        Env["Environment"]
    end
    ML["ModelLoader<br/>(GLTFLoader + cache)"]

    main --> PM & IM & LM & UI & PerfM & Env & P & CC
    P --> PM
    P --> IM
    P --> VM --> ML
    CC --> P
    CC --> IM
    Env --> PM
    UI -. lê .-> P
    IM -- "game: any → player.changeVehicle,<br/>cameraController.cycleCameraMode" --> main
    PM -.-> DM
    LM -.-> DM
    UI -.-> DM
    IM -- F2 --> DM
```

## 2. Ciclo de execução [Implementado]

`Game.gameLoop` (`src/main.ts`), por quadro:

1. `deltaTime` = tempo real desde o último quadro, limitado a 0,1 s.
2. `inputManager.update()` lê teclado e gamepad.
3. `physicsManager.update(dt)` → acumulador com passo fixo de 1/60 s; antes de cada passo, os *pre-step callbacks* (`vehicleController.updateVehicle`); depois, copia transformações dos corpos registrados para os meshes e atualiza o debug renderer.
4. `update(dt)` em `[environment, lightingManager, player, cameraController, performanceManager]`:
   - `Player.update`: lê o input analógico, integra o volante com `dt` de quadro (limitado a 1/30), define força de motor/freio no controlador (efeito nos **próximos** passos), copia transformações do chassi e das rodas para os meshes.
   - `CameraController.update`: posiciona a câmera conforme o modo.
   - `LightingManager.update`: `csm.update()`.
5. `ui.updatePlayerInfo` (só no modo dev).
6. `renderer.render(scene, camera)`.

Consequências:

- Forças são definidas depois dos passos do quadro — **1 quadro de latência** entre input e física.
- Sem interpolação, o visual mostra o último passo concluído; a 60 Hz há *judder* em monitores de 120/144 Hz.
- O volante é integrado por quadro; nos cenários, a aceleração é idêntica a 60 e 144 FPS e ~0,3% menor a 30 FPS.

Inicialização assíncrona: `Game.initialize()` aguarda `PhysicsManager.create()` (`RAPIER.init()`, WASM).

## 3. Subsistemas

### 3.1 Física — `src/managers/PhysicsManager.ts` [Implementado]

- `RAPIER.World` (`@dimforge/rapier3d-compat` 0.19.3, WASM embutido no bundle), gravidade −9,82, criado por `PhysicsManager.create()` (assíncrono).
- Passo fixo de 1/60 s por acumulador (`world.timestep` igual); *pre-step callbacks* para lógica que precisa rodar a cada passo. O freio do controlador é impulso por passo: mudar o passo muda a frenagem.
- Criação tipada: `createRigidBody(RigidBodyConfig)`, `createCollider(ColliderConfig)`, `createGroundCollider`; `castRay`.
- Lista `entities` (corpo + mesh) para sincronização visual; `removeEntity` remove o corpo do mundo.
- `PhysicsDebugRenderer`: `world.debugRender()` em `LineSegments` no modo dev (aloca buffers a cada quadro; só em dev).
- Atenção: `RigidBody.linvel()` do chassi apoiado no controlador de veículo não é zero em repouso (~g·dt); meça movimento por deslocamento.

Escala do mundo: **não é SI**. Os modelos são carregados com `scale 0.5`, o chassi mede 2,3 × 0,6 × 0,9 unidades (um M4 real mede ~4,7 m), as massas são 200 kg (BMW) e 400 kg (G63). Velocidades exibidas em “km/h” são `m/s × 3,6` sobre essas unidades e não correspondem a velocidades reais.

### 3.2 Veículo — `src/components/Player.ts`, `src/managers/VehicleManager.ts` [Implementado]

`Player` concentra:

- criação do chassi (corpo dinâmico + cuboid) e do `DynamicRayCastVehicleController` com 4 rodas;
- leitura do input analógico (`getThrottle/getBrake/getSteer`);
- modelo de direção (rampa do volante, retorno ao centro, redução com a velocidade);
- motor/freio/freio de mão/boost, tração `rear`/`front`/`all`, resistência ao rolamento (`configs.rollingResistance`) sem acelerador nem freio;
- sincronização visual do chassi e das rodas (com ajustes de alinhamento por roda);
- troca de veículo, *reset*, consultas para câmera e UI.

`VehicleManager` contém o **catálogo em código** (`bmw_f82`, `mercedes_g63`): modelo, escala, física, câmeras, parâmetros de condução e posições das rodas; e carrega os glTF com *fallback* para primitivas.

Problemas estruturais:

- **Estado de runtime dentro do catálogo**: `configs.currentSteering`, `currentSpeed` e `boostForce` são gravados no objeto de configuração compartilhado.
- **Eixo “frente” inconsistente**: a velocidade é calculada contra `(-1,0,0)` e invertida (`* -1`) para exibição.
- Índices de roda fixos (0–1 dianteiras, 2–3 traseiras; ímpares espelhadas) sem tipo que os represente.
- Recursos GPU: trocar de veículo libera geometrias e materiais (`Player.releaseObjects`); texturas e o cache do `ModelLoader` não são liberados.
- `loadVehicle` ignora resultados de carregamentos obsoletos (`loadRequestId`).
- O mesh de *placeholder* continua registrado no `PhysicsManager` depois que o modelo real é carregado.

Modelo físico do veículo: *raycast vehicle* (Bullet, via Rapier). Suspensão linear com amortecimento de compressão/relaxamento, atrito por limite de impulso (`frictionSlip`, `sideFrictionStiffness`). Não há equivalente ao `rollInfluence` da cannon-es (o G63 vira com raio maior que antes; ver ADR-0001). Não há modelo de pneu, inércia de roda, trem de força, câmbio, diferencial nem aerodinâmica.

### 3.3 Input — `src/managers/InputManager.ts` [Implementado]

- Mapa ação → teclas; ações imediatas (`TOGGLE_DEV_MODE`, `CYCLE_CAMERA_MODE`, `SELECT_VEHICLE_*`, `RESET_CAR`) chamam métodos de `game` (tipado como `any`).
- Ações contínuas: valores analógicos 0–1 (`getThrottle`, `getBrake`, `getSteer`) de teclado ou gamepad (gatilhos e analógico com *deadzone*), atualizados por `update()` no início do quadro; `isActionActive` para botões.
- Mouse: delta acumulado, pointer lock no clique, tempo desde o último movimento.

### 3.4 Câmera — `src/components/CameraController.ts` [Implementado]

Três modos por veículo (`cameraSettings`): `FIRST_PERSON` (padrão) e `HOOD` presos ao chassi com olhar livre e auto-centralização; `THIRD_PERSON` orbital com mouse. O auto-centro do modo orbital está comentado — a câmera não acompanha a guinada do carro. Ajusta `fov` e chama `updateProjectionMatrix()` todo quadro.

### 3.5 Renderização e iluminação — `src/main.ts`, `src/managers/LightingManager.ts`, `src/components/Environment.ts` [Implementado]

- `WebGLRenderer` com antialias, `shadowMap.type = VSMShadowMap`, `pixelRatio = min(devicePixelRatio, 2)`.
- Pipeline de cor (`RENDER_CONFIG` em `main.ts`): `outputColorSpace = SRGBColorSpace`, *tone mapping* AgX, exposição 1,3 (sobrescrevível com `?exposure=<n>` na URL). AgX foi escolhido em vez de ACES Filmic porque, com `dawn_4k.hdr`, o ACES desloca o azul saturado da pintura para violeta; o AgX preserva o matiz e suaviza o céu, ao custo de um pouco de saturação.
- Câmera perspectiva `near 0.1`, `far 1000` (razão 1e4). Conferido sem recorte no interior dos dois veículos em primeira pessoa na escala atual (~0,5); com a escala SI (P0-6) a folga aumenta. `logarithmicDepthBuffer` não é necessário.
- Céu e `scene.environment`: `dawn_4k.hdr` via `HDRLoader`, `EquirectangularReflectionMapping`. O renderer já converte `scene.environment` equiretangular em PMREM; um `PMREMGenerator` explícito não mudaria o resultado.
- `LightingManager`: CSM do Three (3 cascatas, `maxFar 50`, shadow map 4096). `setupCSMMaterials()` é chamado **uma vez**, em `Game.initialize`, antes de os modelos dos veículos terminarem de carregar — os materiais dos veículos não passam por `csm.setupMaterial`. O efeito visual exato está **[Investigar]**.
- `Environment`: plano 200×200, skybox HDR, 3 caixas dinâmicas.
- Sem pós-processamento, sem reflexos além do mapa de ambiente, sem LOD, sem instancing, sem compressão de texturas (glTF com PNG; `assets` ~49 MB, `textures` ~52 MB).

### 3.6 UI, dev mode, desempenho [Implementado]

- `UIManager`: escreve velocidade/posição/rotação/ângulo de roda no DOM quando o modo dev está ativo. Os botões “BMW M4 / MERCEDES G63” do HTML não têm handler.
- `DevModeManager`: singleton com `localStorage` e assinantes por id.
- `PerformanceManager`: painel `Stats` (FPS).

### 3.7 Código morto [Implementado]

- `src/components/Material.ts` (`MaterialLibrary`): não importado; referencia texturas inexistentes.
- `Player.getMovimentDirection()`: não usado.

### 3.8 Testes — `test/` [Implementado]

- `test/support/sim.ts`: contrato `SimHandle` (quadro, snapshot) e `ScriptedInput`, que substitui o `InputManager` (API binária e analógica).
- `test/support/rapierSim.ts`: `PhysicsManager` + `Player` reais sobre um plano, mesma ordem do `Game.gameLoop`; `ModelLoader` é mockado no teste.
- `test/support/scenarios.ts`: repouso, aceleração, frenagem, curva; métricas puras sobre snapshots.
- `test/support/baseline.ts` + `test/baselines/rapier.json`: comparação com tolerância (2% relativo, 0,01 absoluto); `UPDATE_BASELINE=1` regrava.
- `test/baselines/cannon-master.json`: medições da implementação anterior (cannon-es), mantidas como referência histórica; não usadas nos testes.
- `test/physics/vehicle-lifecycle.test.ts`: trocar de veículo 20 vezes não acumula corpos, colisores, controladores nem objetos na cena e libera geometrias; carregamento obsoleto não substitui o veículo atual.
- Os cenários medem o comportamento atual para detectar regressões; não validam realismo físico.

### 3.9 Concorrência

Não há workers nem paralelismo. Tudo roda na thread principal. Carregamento de modelos é assíncrono (Promise) e não sincronizado com o estado do jogador.

---

## 4. Riscos e limitações que bloqueiam a evolução

| # | Problema | Consequência | Antes de… |
|---|---|---|---|
| R1 | Testes cobrem só o veículo em plano; sem lint | Regressões de câmera, render e input só aparecem jogando | refatorar esses subsistemas |
| R2 | Escala ~0,5 e massas arbitrárias | Parâmetros sem significado físico; tuning se perde ao corrigir a escala | trabalhar em dinâmica veicular |
| R3 | `Player` com 5 responsabilidades; `main.ts` cria tudo | Dois agentes não conseguem trabalhar em física e input/câmera sem editar o mesmo arquivo | paralelizar trabalho |
| R4 | Input e controle por quadro, sem interpolação | Comportamento muda com o FPS; *judder* em monitores > 60 Hz | ajuste fino de direção |
| R5 | Controlador de veículo embutido (raycast, caixa-preta em WASM) | Teto de qualidade da direção | P2-1 (dinâmica própria) |
| R6 | Estado no catálogo de configuração | Bugs ao trocar/instanciar veículos | múltiplos veículos |
| R7 | Sem ciclo de vida de recursos | Vazamento de GPU/WASM ao trocar veículo | streaming de mundo |
| R8 | ~~Renderizador sem pipeline de cor/tone mapping definidos~~ — resolvido em P2-7 (§3.5) | — | — |

---

## 5. Arquitetura desejada [Planejado]

Princípio: **a simulação é independente da renderização e do DOM**. Ela roda em passos fixos, recebe comandos e produz estado; a renderização apenas lê esse estado (interpolado).

```mermaid
flowchart LR
    subgraph Plataforma
        Input["input/<br/>dispositivos → InputFrame"]
        Loop["core/GameLoop<br/>passo fixo + interpolação"]
    end
    subgraph Simulação ["Simulação (sem THREE, sem DOM; testável em Node)"]
        Ctrl["vehicle/VehicleControl<br/>InputFrame → comandos"]
        Dyn["vehicle/VehicleDynamics<br/>suspensão, pneu, trem de força"]
        Phys["physics/PhysicsWorld (interface)<br/>RapierPhysicsWorld (adaptador)"]
        World["world/ colisores, superfícies"]
    end
    subgraph Apresentação
        View["render/VehicleView, EnvironmentView"]
        Cam["camera/CameraRig"]
        Light["render/Lighting, PostFX"]
        HUD["ui/ HUD e menus"]
    end
    Data[("data/vehicles/*.ts<br/>definições imutáveis")]

    Input --> Loop --> Ctrl --> Dyn --> Phys
    World --> Phys
    Data --> Dyn & View
    Loop -- "estado + alpha" --> View & Cam & HUD
```

Contratos-chave (a definir no P1, ver ROADMAP):

- `PhysicsWorld`: criar/remover corpos e colisores, `castRay`/`castShape` com filtro, aplicar força/impulso em ponto, ler transformações, `step(dt)`, snapshot. Só o adaptador importa `@dimforge/rapier3d-compat`.
- `VehicleDefinition` (dados, imutável) × `VehicleState` (runtime, por instância).
- `InputFrame`: valores normalizados por passo de simulação (`throttle`, `brake`, `steer`, `handbrake`, …), independentes de dispositivo.
- `SimulationSnapshot` legível pela apresentação: transformações atual e anterior para interpolação, telemetria por roda.
- Unidades SI (metro, quilograma, segundo, radiano, newton) e convenção de eixos única, documentadas no código.

Organização de diretórios proposta (por domínio, não por “manager/component”): `src/core`, `src/physics`, `src/vehicle`, `src/world`, `src/render`, `src/camera`, `src/input`, `src/ui`, `src/data`, `src/debug`. A migração deve ser incremental — mover um subsistema por vez, sem reescrever o que já funciona.

---

## 6. Decisões

| Id | Decisão | Status |
|---|---|---|
| [ADR-0001](docs/decisions/ADR-0001-motor-de-fisica.md) | Motor de física: adotar Rapier por integração curada da `refact/rapier3d` | **Aceita** (2026-11-01) |
| ADR-0002 | Unidades SI e convenção de eixos | A redigir (ROADMAP P0-6) |
| ADR-0003 | Dinâmica veicular própria sobre a física (substituir o controlador *raycast* embutido) | A redigir (P2) |
| ADR-0004 | Tecnologia de UI (DOM puro × React/Preact sobre o canvas) | A redigir (P2) |

Decisão já implícita no código e mantida: **Three.js imperativo** como camada de renderização, sem React Three Fiber. O loop de simulação em passo fixo e a física não devem depender de um reconciliador de UI. Se a interface (HUD, menus) crescer, React pode ser usado **apenas na camada de UI em DOM**, lendo um snapshot do estado do jogo — ver ADR-0004.

## 7. Questões pendentes [Investigar]

1. Efeito visual de os materiais dos veículos não passarem por `csm.setupMaterial`.
2. WebGL × `WebGPURenderer` (Three r182) para a meta gráfica: custo de migração do CSM/shaders, suporte de navegadores-alvo.
3. Tamanho do bundle com Rapier: pacote não-`compat` com `.wasm` separado.
4. Orçamentos de desempenho (FPS-alvo, hardware-alvo, memória) — não existem medições.
5. Pipeline de assets: compressão (KTX2/Basis, Draco/Meshopt), limites por veículo; os modelos atuais somam ~49 MB.
6. Terreno: `heightfield` × `trimesh` na Rapier para direção (arestas internas, desempenho de consulta).
7. Necessidade de determinismo entre plataformas (replays, fantasmas, rede) — define se usar `rapier3d-deterministic-compat`.
8. Áudio: não existe nenhum sistema de áudio.

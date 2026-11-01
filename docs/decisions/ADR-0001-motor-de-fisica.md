# ADR-0001 — Motor de física: `master` (cannon-es) × `refact/rapier3d` (Rapier)

- **Status:** Aceita (2026-11-01) — opção B, integração curada.
- **Data:** 2026-11-01
- **Escopo:** qual implementação serve de base para a evolução da física e dos veículos.

## Contexto

O repositório tem duas alternativas:

| | `master` (HEAD `390b921`) | `refact/rapier3d` (`4d2422a`) |
|---|---|---|
| Motor | cannon-es 0.20.0 + cannon-es-debugger | @dimforge/rapier3d-compat 0.19.3 (WASM) |
| Veículo | `CANNON.RaycastVehicle` | `RAPIER.DynamicRayCastVehicleController` |
| Histórico | evolução incremental | **um único commit** sobre `390b921` (merge-base = HEAD da `master`) |
| Tamanho da mudança | — | 13 arquivos de código, +1.6k/−0.4k linhas de TS; +~40 MB de assets |

A `refact/rapier3d` é, na prática, a `master` com: (1) troca do motor de física, (2) input por gamepad com valores analógicos, (3) terreno procedural (`ProceduralTerrain` + `SimplexNoise`), (4) retuning dos parâmetros dos veículos, (5) dois modelos novos (`mclaren_f1_2021`, `mercedes_amg_one`) que **não são referenciados** no código.

## Evidências coletadas

### Compilação e build (ambas em cópias isoladas, `npm ci` limpo)

| Verificação | `master` | `refact/rapier3d` |
|---|---|---|
| `tsc --noEmit` | **falhava**: 4 erros TS6133 (símbolos não usados) em `CameraController.ts`, `Player.ts`, `VehicleManager.ts` — corrigidos na working copy desta análise, com as mesmas mudanças que a branch Rapier já fazia | passa |
| `vite build` | passa — bundle JS 742 kB (197 kB gzip) | passa — bundle JS 2.895 kB (1.005 kB gzip): o pacote `-compat` embute o WASM em base64 |

### Execução (Vite dev, navegador, teclado simulado, modo dev ligado)

| Cenário | `master` | `refact/rapier3d` |
|---|---|---|
| Carrega, sem erros de runtime | sim | sim (único erro: pointer lock em contexto de automação) |
| Acelerar (W) por 5 s — velocidade exibida no HUD | 0 → 10,8 → 21,4 → 32,0 → 42,5 → 52,8 | 0 → 19,7 → 35,6 → 43,4 → 53,9 → 63,5 |
| Frear (S) após 5 s | 52,8 → 30,8 → 9,0 → ré | 63,5 → 33,8 → 7,5 → ré |
| Trocar veículo 1↔2 três vezes e voltar a dirigir | — | funciona |
| Três modos de câmera | funcionam | funcionam |

Os números **não comparam motores**: a branch Rapier alterou ao mesmo tempo motor, parâmetros (ex.: BMW `maxForce` 300→600, `frictionSlip` por roda 1,0/0,6, `sideFrictionStiffness` 0,3) e terreno. Não existe linha de base que permita separar regressão de motor de mudança de tuning. Essa é, por si só, uma das principais falhas da refatoração.

### Revisão de código — o que a refatoração melhorou

- **Ciclo de simulação explícito:** `PhysicsManager.update` usa acumulador com passo fixo e *pre-step callbacks*, chamando `vehicleController.updateVehicle(dt)` dentro de cada passo. É o lugar correto para a dinâmica do veículo.
- **API de criação tipada** (`RigidBodyConfig`, `ColliderConfig`) em vez de objetos do motor espalhados.
- **Debug de colisores funcional:** `PhysicsDebugRenderer` usa `world.debugRender()` e é descartado corretamente. Na `master`, `removeDebugger()` não remove nada (o próprio código comenta “Não funciona”).
- **Input analógico + gamepad** (`getThrottle/getBrake/getSteer`), base necessária para qualquer direção com gatilhos.
- `changeVehicle` remove o corpo rígido antigo e o callback de física.

### Revisão de código — problemas introduzidos ou mantidos pela refatoração

Introduzidos:

1. **Vazamento do controlador de veículo:** `changeVehicle` cria um novo `DynamicRayCastVehicleController` sem chamar `world.removeVehicleController` no anterior (objeto WASM órfão a cada troca).
2. **Passo de física caiu de 120 Hz para 60 Hz**, com comentário incorreto (“igual ao Cannon”). Sem interpolação visual, 60 Hz produz *judder* em monitores de 120/144 Hz.
3. **Latência extra de input:** `InputManager.update()` foi adicionado à lista de componentes **depois** de `Player`, então o Player lê os valores analógicos do quadro anterior.
4. **~40 MB de assets sem uso** no commit (`mclaren_f1_2021`, `mercedes_amg_one`). Uma vez integrados à `master`, ficam no histórico do Git para sempre.
5. **Tuning misturado com a migração** (ver acima).
6. **Terreno procedural** como `TriMesh` de 1000×1000 com células não quadradas (128×182 segmentos), cores com `Math.random()` (não determinístico) e o `createPlane` antigo mantido como código morto. Para terreno de direção, `heightfield` é a forma natural no Rapier; a escolha por trimesh não foi justificada.
7. **Alocações por quadro** no cálculo de transformação das rodas (`new THREE.Vector3/Quaternion` dentro de loops) e no debug renderer (`new BufferAttribute` a cada quadro).
8. `console.log` de diagnóstico deixado no setup das rodas.

Mantidos da `master` (existem nas duas):

- Mundo em **escala ~0,5**: modelos com `scale: 0.5`, chassi de 2,3 × 0,6 × 0,9 unidades, massas de 200–450 kg, gravidade real. Nenhum parâmetro físico é fisicamente interpretável.
- Convenção de eixos confusa: “frente” é declarada como `(-1,0,0)` e a velocidade é invertida com `* -1` para exibição.
- `Player` concentra física, interpretação de input, sincronização visual, carregamento de modelos e troca de veículo.
- Estado de runtime (`currentSteering`, `currentSpeed`, `boostForce`) gravado dentro do objeto de catálogo do veículo.
- Input lido uma vez por quadro, depois do passo de física (≥ 1 quadro de latência); direção integrada com `dt` de quadro, não de simulação.
- Sem interpolação entre o estado físico e o visual.

## Avaliação da Rapier para o objetivo do projeto

### O que a Rapier oferece nativamente

- Solver moderno, CCD, sleeping, grupos de colisão e filtros de consulta.
- Consultas espaciais completas: `castRay`, `castShape`, `intersectionsWithShape` — base para suspensão por *shape cast* (roda como cilindro/esfera), mais robusta que raio único em meio-fio e degraus.
- `applyImpulseAtPoint`/`addForceAtPoint`: suficiente para aplicar forças de pneu calculadas por nós.
- Colisores `heightfield`, `trimesh`, compostos; eventos de contato e de força.
- `world.takeSnapshot()` / `World.restoreSnapshot()`: estado reprodutível para testes de regressão e *replays*.
- Variante determinística publicada (`@dimforge/rapier3d-deterministic-compat`), útil se replays/rede exigirem determinismo entre plataformas.
- Roda em Node (pacote `-compat`), o que permite testes de física headless.
- Manutenção ativa: versão 0.21.0 publicada em 2026-09-25 (a branch usa 0.19.3).

### O que a Rapier **não** oferece (e precisa ser nosso)

`DynamicRayCastVehicleController` é uma adaptação do *raycast vehicle* do Bullet — a mesma família do `CANNON.RaycastVehicle`. Ambos têm atrito de pneu por limite de impulso (`frictionSlip`, `sideFrictionStiffness`), sem curva de força × escorregamento, sem atrito combinado longitudinal/lateral, sem inércia de roda, sem trem de força. **Trocar o motor não melhora a qualidade da direção por si só.**

Para algo próximo de Forza Horizon, a camada de jogo precisa de um módulo próprio de dinâmica veicular:

- Suspensão por roda (mola-amortecedor, *bump stops*, barra estabilizadora) com contato por raio/shape cast.
- Modelo de pneu (ex.: Pacejka simplificado ou *brush*), escorregamento longitudinal e lateral, atrito combinado, carga normal por roda (transferência de peso emergente).
- Trem de força: curva de torque, embreagem, câmbio, diferencial, inércia das rodas.
- Freios, freio de mão, aerodinâmica (arrasto, *downforce*), geometria de direção (Ackermann), assistências (ABS/TCS/ESC) opcionais.
- Materiais de superfície ligados aos colisores.
- Ferramentas: telemetria por roda, gráficos, gravação/reprodução de entradas.

A Rapier entra como **integrador de corpo rígido, detecção de colisão e consultas**. O controlador embutido serve apenas como etapa intermediária — é uma caixa-preta em WASM com poucas saídas (`wheelForwardImpulse`, `wheelSideImpulse`, `wheelSuspensionForce`), insuficiente para validar um modelo de pneu.

### Riscos e custos da Rapier

- Bundle +2,1 MB (WASM em base64 no `-compat`). Mitigável com o pacote não-compat e carregamento do `.wasm` como asset — **pendente de investigação**.
- Inicialização assíncrona (`await RAPIER.init()`) — já tratada na branch.
- Objetos WASM exigem liberação explícita (`free`, `remove*`); vazamentos não aparecem no GC do JS.
- API JS segue a crate Rust; versões 0.x podem quebrar compatibilidade — fixar versão e atualizar de forma deliberada.

### cannon-es

Última versão publicada: 0.20.0, em 2022-08-12. Sem consultas por *shape cast* na API pública do veículo, sem snapshot, sem WASM. Permanecer nele significa assumir a manutenção de um motor parado ou migrar mais tarde — com mais código dependente dele.

## Comparação

Avaliação qualitativa; cada linha cita a evidência. Não há pontuação numérica porque as amostras (um protótipo de ~2,4 mil linhas) não sustentam números.

| Critério | Vantagem | Evidência |
|---|---|---|
| Qualidade arquitetural | **Empate (ambas fracas)** | Mesma estrutura: `Game` monolítico, `Player` com 5 responsabilidades, `InputManager` com `game: any`. A refatoração trocou a implementação, não os limites. |
| Qualidade da simulação | **Rapier (potencial), empate (estado atual)** | Mesmo modelo de veículo em ambas; Rapier oferece primitivas (shape cast, heightfield, snapshot) para o modelo próprio. |
| Desempenho | **Rapier, com ressalva** | Solver WASM; porém 60 Hz sem interpolação, alocações por quadro e +2,1 MB de bundle. Nenhum perfil foi medido — pendente. |
| Manutenibilidade | **Rapier** | Dependência mantida × parada desde 2022; debug renderer correto; mas commit único mistura cinco mudanças. |
| Testabilidade | **Rapier** | Snapshot/restore, variante determinística, roda em Node. Nenhuma das duas tem testes. |
| Desenvolvimento com agentes | **Empate hoje** | `Player.ts` e `main.ts` são pontos de conflito em ambas. Depende da etapa P1 do roadmap, não do motor. |
| Custo de evolução | **Rapier** | Ficar no cannon-es implica migrar depois, com mais código acoplado. |
| Risco técnico | **`master` no curto prazo, Rapier no longo** | A `master` é conhecida e estável; a branch tem regressões listadas acima, todas localizadas e corrigíveis. |
| Sustentabilidade | **Rapier** | Motor ativo e com recursos que o objetivo exige. |

## Decisão recomendada: **B — adotar a `refact/rapier3d` como base, por integração curada**

**Não** integrar o commit como está. Trazer o conteúdo dele para uma nova branch a partir da `master`, em commits separados e revisáveis, corrigindo os problemas no caminho.

Por que não **A** (manter cannon-es): a arquitetura da `master` não é melhor — é a mesma. A única diferença estrutural relevante é o motor, e o cannon-es não tem futuro como base. Manter significaria refazer a migração mais tarde, com mais código acoplado.

Por que não **C** (híbrido ou terceira via): não existe componente da `master` que precise ser preservado em paralelo à Rapier; manter os dois motores duplicaria adaptadores sem benefício. Reescrever do zero desperdiçaria a parte boa da branch (adaptador, debug renderer, input analógico), que é pequena e correta.

### O que preservar da `refact/rapier3d`

- `PhysicsManager` (acumulador, *pre-step callbacks*, criação tipada, `castRay`), `PhysicsDebugRenderer`, inicialização assíncrona em `main.ts`.
- Mudanças do `Player`/`VehicleManager` que desacoplam o carregamento visual do objeto de física (`loadVehicle(vehicleId, wheelCount)`).
- `InputManager` com valores analógicos e gamepad.

### O que corrigir antes de construir em cima

1. Remover o controlador antigo em `changeVehicle` (`world.removeVehicleController`).
2. Restaurar 120 Hz (ou documentar a escolha) e corrigir o comentário.
3. `InputManager.update()` antes do `Player` (idealmente fora da lista genérica de componentes).
4. Retirar `console.log` de diagnóstico e as alocações por quadro.
5. **Não** trazer `mclaren_f1_2021` nem `mercedes_amg_one` até haver uso e um processo de assets (compressão).
6. Separar o retuning: primeiro portar com os parâmetros da `master` e registrar a linha de base; depois ajustar em commit próprio.
7. Terreno procedural: trazer como experimento opcional (o plano continua padrão) ou adiar; avaliar `heightfield` antes de adotá-lo.

### Sequência sugerida (detalhada no ROADMAP, P0)

1. Decidir este ADR.
2. Criar o harness de testes (Vitest) e os cenários de referência — eles precisam existir antes da migração, para medir a `master`.
3. Branch `stabilize/rapier` a partir da `master`; trazer arquivos com `git checkout refact/rapier3d -- <caminhos>` em commits por tema: motor → input → correções → terreno (opcional).
4. Rodar os cenários de referência nas duas versões e comparar.
5. Integrar na `master`; manter `refact/rapier3d` como referência até a estabilização ser aceita.

### Critérios para considerar a migração estabilizada

- `npm run build` e `npm test` verdes.
- Cenários de referência (repouso, aceleração em linha reta, frenagem, curva em regime) passam com tolerâncias definidas e sem NaN.
- Trocar de veículo 20 vezes não aumenta o número de corpos/colisores/controladores no mundo.
- O veículo em repouso sobre o plano não deriva mais que uma tolerância definida em 10 s simulados.
- Nenhum asset sem referência no código.

## Consequências

- A dinâmica veicular passa a ser um módulo próprio (P2) que conversa com a física por uma interface estreita; o `DynamicRayCastVehicleController` é temporário.
- Os parâmetros físicos só se tornam significativos depois da conversão para escala SI (ROADMAP P0-6); até lá, tuning é provisório.

# Three.js Car Game

Protótipo de jogo de direção 3D para navegador, escrito em TypeScript com Three.js (renderização) e um motor de física rígida em JavaScript/WASM. O jogador dirige um veículo (BMW M4 F82 ou Mercedes G63) em um cenário com obstáculos físicos, com três modos de câmera e um modo de desenvolvimento com telemetria e visualização de colisores.

![Three.js Car Game](textures/print.png)

## Objetivo e proposta técnica

A direção de longo prazo é um jogo de direção cuja qualidade percebida — gráfica e de simulação — tenha como referência a série Forza Horizon. Isso é uma **meta de produto**, não uma descrição do estado atual: hoje o projeto é um protótipo com um modelo de veículo do tipo *raycast vehicle* (herdado do Bullet), cenário mínimo e renderização WebGL padrão do Three.js.

A estratégia técnica, as limitações conhecidas e o caminho de evolução estão documentados em:

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura real (implementado / planejado / pendente), fluxos, riscos |
| [ROADMAP.md](ROADMAP.md) | Etapas P0–P3, critérios de conclusão, dependências |
| [docs/decisions/ADR-0001-motor-de-fisica.md](docs/decisions/ADR-0001-motor-de-fisica.md) | Comparação `master` (cannon-es) × `refact/rapier3d` (Rapier) e recomendação |
| [CLAUDE.md](CLAUDE.md) | Regras operacionais para o Claude Code |
| [AGENTS.md](AGENTS.md) | Coordenação de múltiplos agentes |

## Tecnologias

| Item | Versão (package.json) | Uso |
|---|---|---|
| [Three.js](https://threejs.org/) | ^0.182.0 | Renderização WebGL, GLTFLoader, RGBELoader, CSM (sombras em cascata), Stats |
| [cannon-es](https://github.com/pmndrs/cannon-es) | ^0.20.0 | Física na branch `master` (`RaycastVehicle`) |
| [@dimforge/rapier3d-compat](https://rapier.rs/) | ^0.19.3 | Física na branch `refact/rapier3d` (`DynamicRayCastVehicleController`) |
| TypeScript | ^5.9.3 | `strict`, `noUnusedLocals`, `noUnusedParameters` |
| Vite | ^7.3.0 | Servidor de desenvolvimento e build |

Modelos 3D em glTF (`assets/models`), skyboxes HDR e cúbicos (`textures`).

## Pré-requisitos

- Node.js com npm (o projeto usa `package-lock.json`; Vite 7 exige Node 20.19+ ou 22.12+).
- Navegador com WebGL 2.

## Instalação e execução

```bash
npm ci
```

```bash
npm run dev
```

O Vite serve em `http://localhost:5173`. Clique na tela para capturar o mouse (pointer lock).

> **Ao trocar entre `master` e `refact/rapier3d`, rode `npm ci` de novo.** As branches têm dependências diferentes (cannon-es × Rapier) e um `node_modules` de uma branch não compila a outra.

### Controles

| Ação | Teclado | Gamepad (só em `refact/rapier3d`) |
|---|---|---|
| Acelerar / frear e ré | W, ↑ / S, ↓ | RT / LT (analógico) |
| Direção | A, ← / D, → | Analógico esquerdo |
| Freio de mão | Espaço | A / X |
| Boost | Shift | RB / R1 |
| Trocar câmera (1ª pessoa → 3ª pessoa → capô) | C, V | Y / Triângulo |
| BMW M4 / Mercedes G63 | 1 / 2 | D-pad ← / → |
| Reposicionar carro | R | Back / Share |
| Modo dev (telemetria, colisores, cascatas de sombra) | F2 | — |

## Build e verificações

| Comando | O que faz |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (verificação estática) |
| `npm run build` | `tsc` + `vite build` → `dist/` |
| `npm run preview` | Serve o build de produção |

Ainda **não há testes automatizados, lint nem CI**. Criá-los é o primeiro bloco do [ROADMAP](ROADMAP.md) (P0). Até lá, a validação mínima de qualquer alteração é `npm run build` sem erros e um teste manual de direção (ver [CLAUDE.md](CLAUDE.md#validação)).

## Estrutura

```
├── index.html               # Página e overlays (HUD de dev, ícones de controle)
├── css/main.css
├── src/
│   ├── main.ts              # Classe Game: cria subsistemas e roda o loop
│   ├── components/          # Objetos de jogo (GameComponent/Entity)
│   │   ├── Player.ts        # Veículo do jogador: física, direção, sincronização visual
│   │   ├── CameraController.ts
│   │   ├── Environment.ts   # Chão, skybox HDR, obstáculos
│   │   ├── Entity.ts, GameComponent.ts
│   │   └── Material.ts      # Não utilizado (ver ARCHITECTURE.md)
│   ├── managers/            # Serviços: física, input, iluminação, UI, desempenho, dev mode
│   └── loaders/ModelLoader.ts
├── assets/models/           # glTF dos veículos e rodas
├── textures/                # Skyboxes, ícones, screenshot
└── docs/decisions/          # Registros de decisão arquitetural (ADR)
```

## Estado atual

- **`master`** — física com cannon-es. Funcional: carro dirigível, dois veículos, três câmeras, obstáculos dinâmicos, CSM, modo dev.
- **`refact/rapier3d`** — um único commit sobre a `master` que troca o motor por Rapier e adiciona terreno procedural, input por gamepad e dois modelos de carro ainda não usados. Compila e roda. **Ainda não integrada**: o [ADR-0001](docs/decisions/ADR-0001-motor-de-fisica.md) adotou a Rapier, mas por integração curada (ROADMAP P0-5), não por merge direto.

Limitações principais (detalhes em [ARCHITECTURE.md](ARCHITECTURE.md)): o mundo está em escala ~0,5 (carro de 2,3 unidades de comprimento), o modelo de pneu é o atrito simplificado do *raycast vehicle*, não há interpolação entre passos de física, e não há testes.

## Licença

MIT.

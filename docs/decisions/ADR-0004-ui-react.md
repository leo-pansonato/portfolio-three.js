# ADR-0004 — UI do jogo em React sobre o canvas

- **Status:** Aceita (2026-11-03)
- **Data:** 2026-11-03
- **Escopo:** tecnologia do HUD de corrida, menus e seleção de veículo (ROADMAP P2-6).

## Contexto

A UI atual é HTML estático em `index.html` mais `UIManager` escrevendo `textContent` (HUD de dev). O P2-6 pede HUD de corrida (conta-giros, velocidade, marcha), menus e seleção de veículo. O HUD atualiza a cada quadro; menus são estado discreto com composição de componentes.

## Opções

| | A — DOM puro | B — Preact | C — React 19 |
|---|---|---|---|
| Bundle (min/gzip) | 0 | ~10/4 kB | ~190/60 kB |
| Menus e composição | à mão | componentes | componentes |
| Ecossistema e tipos | — | compatível via `preact/compat` | padrão |

## Decisão

**C — React 19 + `react-dom`**, numa camada DOM (`#hud`) sobre o canvas, em `src/ui/`. Medido: o bundle passou de 3.021 kB (1.062 kB gzip) para 3.254 kB (1.135 kB gzip), +233/+74 kB incluindo o HUD; menor que um modelo de veículo.

Regra de desempenho: o React só renderiza estrutura e mudanças discretas (veículo, marcha, visibilidade) via `useSyncExternalStore` no `HudStore`. Valores contínuos (rpm, velocidade) chegam por `HudStore.onFrame` e são escritos direto no DOM/SVG (atributo, estilo, texto), sem render por quadro. O jogo escreve `store.frame` e chama `publish(dt)` uma vez por quadro (`UIManager.updateRaceHud`). Animação independente do FPS (mola crítica no ponteiro, amortecimento exponencial na velocidade) e `prefers-reduced-motion` respeitado.

## Consequências

- Preact fica como troca barata se o bundle virar problema (P3-1): o código só usa a API do React compatível com `preact/compat`.
- `src/ui` não importa `Player`, `Game` nem física; `UIManager` é a ponte.
- Menus e seleção de veículo ainda não feitos; o HUD de dev continua em DOM puro.

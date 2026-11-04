# ADR-0006 — Renderização: WebGL2 com pós-processamento e céu HDR

- **Status:** Aceita (2026-11-03)
- **Data:** 2026-11-03
- **Escopo:** renderizador e pós-processamento do ROADMAP P2-4 (ARCHITECTURE §7, item 2).

## Contexto

O jogo renderiza direto na tela com `WebGLRenderer` (MSAA do canvas), AgX e céu/ambiente do `dawn_4k.hdr` (P2-7). O P2-4 pede pós-processamento e decide WebGL × `WebGPURenderer`. Um céu procedural (`Sky`, Preetham) com neblina foi testado e rejeitado pelo usuário: cena clara e lavada, sem as montanhas e as cores alaranjadas do HDR.

## Opções

| | A — WebGL2 + `EffectComposer` | B — `WebGPURenderer` + TSL |
|---|---|---|
| Migração | nenhuma: CSM, materiais e loaders atuais | CSM e materiais com shader próprio a portar |
| Navegadores | todos os alvos | sem WebGPU, cai no backend WebGL2 |
| Pós disponível | bloom, SMAA/FXAA, OutputPass (addons) | nós de pós TSL, ainda mudando a cada versão |

## Decisão

**A.** WebGL2 com `render/PostProcessing`: cena em alvo HalfFloat linear → bloom (`UnrealBloomPass`, limiar 10, força 0,08, só o sol e brilhos fortes) → `OutputPass` (tone mapping e espaço de cor do renderer) → SMAA (ou FXAA na qualidade baixa). `?post=0` desliga; `?quality=baixa|media|alta` escolhe o preset (MSAA 4× no alvo só em `alta`). Com pós ligado, o canvas é criado sem MSAA.

Céu e reflexos continuam no HDR. Um céu procedural fica para quando houver hora do dia (sol móvel), com tuning contra o HDR como referência de cor.

## Consequências

- O visual com `?post=0` é o mesmo de antes do P2-4; o pós só acrescenta AA de tela e brilho do sol.
- WebGPU volta à mesa se TSL estabilizar e o CSM tiver equivalente; reavaliar no P3-1 com medições.
- Não feitos no P2-4: reflexos por área/*probes*, AA temporal, *motion blur*, LOD e instancing.

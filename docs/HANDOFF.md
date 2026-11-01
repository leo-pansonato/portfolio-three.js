# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-01)

- `master` = `origin/master` em `bfb7847`. Física em Rapier (P0-5 concluído, falta só marcar no ROADMAP após o P0-6).
- `npm run build` e `npm test` (13 testes) verdes.
- Branches residuais: `stabilize/rapier` local e `origin/stabilize/rapier` (ambas já contidas na `master`); `refact/rapier3d` é só referência. Não apagar sem pedido.
- Usuário pediu autonomia total ("quero tudo"): seguir o ROADMAP em ordem, commits no formato `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco texto no chat, poucos comentários no código.
- Merge na `master` e push: o usuário aprovou nas últimas rodadas; para trabalho autônomo, integrar por fast-forward após build + testes verdes.

## Em andamento

- P0-6 (escala SI e eixos) — delegado ao subagente `physics-vehicle` em worktree; resultado chega como branch.
- P1-8 (CI) — coordenador, branch `ci/github-actions`.

## Próximos itens (ordem)

1. Integrar P0-6, atualizar ROADMAP (P0-5 e P0-6 `[x]`), ADR-0002.
2. P1-1 loop com passo fixo: input/forças por passo, interpolação visual, freio do controlador como força (impulso por passo hoje).
3. P1-2 decompor `Player` (ver AGENTS.md §4), P1-3 `PhysicsWorld`, P1-4 input desacoplado, P1-5 ciclo de vida (texturas, cache do ModelLoader).
4. P1-6 telemetria/replay, P1-7 lint.
5. P2: dinâmica veicular própria (P2-1), pipeline de cor (P2-7), renderização (P2-4), câmeras (P2-5).

## Fatos técnicos que não estão óbvios no código

- `RigidBody.linvel()` do chassi apoiado no controlador Rapier ≈ g·dt em repouso; medir movimento por deslocamento.
- Freio do `DynamicRayCastVehicleController` é impulso por passo: mudar `fixedTimeStep` muda a frenagem.
- `linearDamping` do chassi afeta muito a aceleração (0,2 → −35%).
- Rigidez/amortecimento da suspensão do controlador são por unidade de massa do chassi (modelo Bullet).
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.

# Handoff

Estado para retomar o trabalho sem depender do histórico da conversa. Atualizar ao fim de cada bloco de trabalho.

## Estado (2026-11-01)

- `master` = `origin/master`. P0 completo (P0-1…P0-6), P1-8 (CI) e P2-7 (pipeline de cor) concluídos.
- Mundo em SI (ADR-0002): BMW 1.550 kg, G63 2.500 kg, plano de 2 km. 22 testes (cenários, plausibilidade, ciclo de vida).
- Usuário pediu autonomia total: seguir o ROADMAP em ordem, commits `tipo(escopo): ...` (máx. 3 linhas, sem coautoria), pouco chat, poucos comentários; integrar por fast-forward + push após build e testes verdes.
- Trabalho delegado a subagentes em worktree (`isolation: "worktree"`); ao integrar: rebase sobre a `master` dentro do worktree, ff na `master`, remover worktree e branches.

## Em andamento

- P1-1 (loop com passo fixo, input/forças por passo, interpolação, freio como força) — subagente `physics-vehicle`.

## Próximos itens (ordem)

1. P1-2 decompor `Player` (AGENTS.md §4), P1-3 `PhysicsWorld`, P1-4 input desacoplado, P1-5 ciclo de vida (texturas, cache do ModelLoader, CSM em materiais carregados).
2. P1-6 telemetria/replay, P1-7 lint.
3. P2: dinâmica própria (P2-1: arrasto, câmbio, pneu, CG baixo), renderização (P2-4), câmeras (P2-5), mundo (P2-3).

## Pendências conhecidas

- CG no centro do collider (margem de capotamento ~1 g, perto da aderência lateral).
- Sem arrasto/câmbio: velocidade sem teto; `configs.maxSpeed` sem uso; boost ×3 chega a ~2 g.
- CSM `maxFar 50` e intensidade das luzes não revistos para escala real/AgX.
- Pasta `.claude/worktrees/` pode sobrar no disco (ignorada pelo Git).

## Fatos técnicos que não estão óbvios no código

- `RigidBody.linvel()` do chassi apoiado no controlador Rapier ≈ g·dt em repouso; medir movimento por deslocamento.
- Freio do `DynamicRayCastVehicleController` é impulso por passo: mudar `fixedTimeStep` muda a frenagem.
- `linearDamping` do chassi afeta muito a aceleração (0,2 → −35%).
- Rigidez/amortecimento da suspensão do controlador são por unidade de massa do chassi (modelo Bullet).
- Testes: harness em `test/support/` (`rapierSim.ts`, `scenarios.ts`, `baseline.ts`); `UPDATE_BASELINE=1 npm test` regrava `test/baselines/rapier.json`.

# CLAUDE.md

Guia operacional para o Claude Code e seus subagentes neste repositório. Leia inteiro antes de alterar código.

## Contexto

Jogo de direção 3D para navegador (TypeScript + Three.js + física rígida). Meta de longo prazo: qualidade de simulação e gráfica com Forza Horizon como **referência**, não como especificação. Estado atual: protótipo de ~2,4 mil linhas, sem testes.

Documentos de referência — consulte o relevante em vez de deduzir:

- [ARCHITECTURE.md](ARCHITECTURE.md) — arquitetura real, riscos, arquitetura-alvo, questões em aberto.
- [ROADMAP.md](ROADMAP.md) — itens P0–P3 com ids, dependências e critérios de conclusão.
- [AGENTS.md](AGENTS.md) — **obrigatório** ao delegar trabalho ou ao atuar como subagente.
- [docs/decisions/](docs/decisions/) — ADRs.

## Situação atual que todo agente deve saber

- A física usa Rapier ([ADR-0001](docs/decisions/ADR-0001-motor-de-fisica.md)). A branch `refact/rapier3d` é só referência: **nunca faça merge dela**; traga trechos de forma curada. Não troque de branch na checkout do usuário sem pedido.
- O mundo está em escala ~0,5 e as massas não são reais (ROADMAP P0-6). Não “corrija” isso localmente: muda o comportamento de tudo.
- `src/components/Player.ts`, `src/main.ts` e `src/managers/VehicleManager.ts` concentram responsabilidades e são pontos de conflito. Edite-os só com escopo explícito.

## Comandos

```bash
npm ci                # instalar (refazer ao trocar de branch: dependências diferem)
npm run dev           # Vite em http://localhost:5173
npm run typecheck     # tsc --noEmit
npm run build         # tsc + vite build
npm test              # Vitest em Node: cenários de referência da física (test/)
```

`UPDATE_BASELINE=1 npm test` regrava `test/baselines/*.json`. Só faça isso quando a mudança de comportamento for intencional, e diga no commit quais números mudaram e por quê. CI (`.github/workflows/ci.yml`) roda typecheck, testes e build em push na `master` e em PRs. Ainda não há lint (ROADMAP P1-7).

## Princípios obrigatórios

1. **Evidência antes de mudança.** Leia o código do subsistema e seus consumidores (`grep` pelos símbolos) antes de editar. Não presuma que algo existe porque é comum em jogos.
2. **Preserve comportamento.** Refatoração não muda resultado. Mudança de comportamento é intencional, declarada e validada separadamente. Nunca misture refatoração, mudança de motor e retuning no mesmo commit — foi o principal problema da `refact/rapier3d`.
3. **Simulação separada de apresentação** (direção-alvo, ARCHITECTURE §5): código novo de física/veículo não deve depender de `THREE.Scene`, DOM ou `requestAnimationFrame`.
4. **Passo fixo para tudo que é físico.** Forças, volante e controle rodam por passo de simulação, não por quadro.
5. **Dados × estado.** Configuração de veículo é imutável; estado de runtime fica na instância. Não grave estado em objetos de catálogo.
6. **Unidades e eixos explícitos.** Toda grandeza física nova tem unidade no nome ou no comentário.
7. **Sem abstração especulativa.** Crie interface quando houver dois usos reais ou quando ela for um contrato do ROADMAP.
8. **Uma dependência nova exige justificativa** (problema, alternativas, custo de bundle) no PR ou em ADR.

## Convenções do código existente

- TypeScript `strict` com `noUnusedLocals`/`noUnusedParameters`; parâmetro intencionalmente não usado leva prefixo `_`.
- Uma classe por arquivo, `export default class`, arquivo em PascalCase igual à classe. Tipos auxiliares exportados nomeados.
- Indentação com tabs (alguns arquivos ainda têm espaços — não reformate arquivos inteiros fora de um commit de formatação).
- Aspas duplas, ponto e vírgula, `import * as THREE from "three"`.
- Comentários e mensagens de log em português; JSDoc `/** */` curto acima de classes e métodos públicos.
- Campos privados com `private`; inicialização tardia com `!` só quando a ordem do construtor garante.
- Vetores temporários reutilizados como campos (`private _offset = new THREE.Vector3()`) em código executado por quadro — não aloque dentro de `update`.
- Commits: `type(scope): descrição` (`feat`, `fix`, `refact`, `chore`, `style`, `docs`, `test`), em português, **no máximo 3 linhas**, sem `Co-Authored-By` nem outra atribuição.

## Arquivos

- Criar arquivo: só quando a responsabilidade não cabe em um existente sem misturar domínios. Código novo segue a organização por domínio de ARCHITECTURE §5 (`src/physics`, `src/vehicle`, …); não crie novos `*Manager` genéricos.
- Remover arquivo ou código: só se `grep` confirmar ausência de uso e o item estiver no escopo da tarefa (ex.: `Material.ts` está listado como morto, mas a remoção é P3-5).
- Assets: não adicione modelos/texturas sem uso no código. Assets entram no histórico do Git para sempre.
- Nunca commite `dist/` nem `node_modules/`.

## Antes de modificar um subsistema

1. Ler a seção correspondente de ARCHITECTURE.md e o item do ROADMAP.
2. Ler o código do subsistema e todos os pontos que o chamam.
3. Registrar o comportamento atual que será preservado (teste, cenário de referência ou roteiro manual).
4. Declarar escopo: arquivos que serão tocados e os que não serão.

## Validação

Antes de declarar uma tarefa concluída:

1. `npm run build` sem erros (inclui `tsc`, que também verifica `test/`).
2. `npm test` verde; testes novos para comportamento novo de simulação. Teste de física monta o mundo pelo harness de `test/support/`, não pela classe `Game`.
3. Mudança que afeta física, veículo, câmera ou input: rodar o jogo (`npm run dev`), dirigir — acelerar, frear, ré, curvar, freio de mão, trocar veículo (1/2), trocar câmera (C), reset (R), modo dev (F2) — e verificar o console sem erros novos.
4. Mudança de renderização: comparar visualmente antes/depois (screenshot) nos três modos de câmera.
5. Relatar o que foi verificado e o que **não** foi. Nunca declare “funciona” sem ter executado.

## Refatorações seguras

- Só com rede de proteção: teste ou cenário de referência cobrindo o comportamento tocado.
- Passos pequenos que compilam e rodam a cada commit.
- Mover antes de mudar: primeiro extrair/mover sem alterar lógica, depois alterar em commit separado.
- Interfaces públicas (métodos usados por outros módulos) mudam com todos os chamadores atualizados no mesmo commit.

## Desempenho e memória

- Nada de alocação em `update`/passo de física (vetores, arrays, closures).
- Recursos GPU (`geometry`, `material`, `texture`) e objetos WASM da física têm dono e `dispose`/`free` explícitos.
- Não otimize sem medir; registre a medição (antes/depois) no PR.

## Incertezas e decisões

- Dúvida de comportamento esperado ou conflito com ARCHITECTURE/ADR: pare e pergunte ao coordenador/usuário. Não decida por conta própria uma questão marcada **[Investigar]**.
- Decisão com impacto em mais de um subsistema, nova dependência, mudança de contrato ou de convenção: proponha um ADR em `docs/decisions/ADR-XXXX-titulo.md` (contexto, opções, decisão, consequências) com status `Proposta`.
- Problema grave fora do escopo: documente (ARCHITECTURE §4 ou ROADMAP) e informe; não amplie o escopo silenciosamente.

## Documentação

- Mudou arquitetura, contrato ou fluxo → atualize ARCHITECTURE.md (mantendo as marcações Implementado/Planejado/Investigar) no mesmo PR.
- Concluiu ou bloqueou item do roadmap → atualize o estado no ROADMAP.md.
- Comando novo → README.md e a seção “Comandos” acima.
- Documentação não substitui teste.

## Delegação a subagentes

Siga [AGENTS.md](AGENTS.md). Resumo:

- Delegue tarefas com escopo de arquivos explícito e critério de conclusão verificável; não delegue decisões arquiteturais.
- Dois agentes nunca editam o mesmo arquivo ao mesmo tempo; trabalho paralelo de escrita usa `isolation: "worktree"`.
- Subagentes especializados disponíveis em `.claude/agents/`: `physics-vehicle`, `rendering`, `architecture-reviewer`.
- Todo subagente devolve o relatório de entrega definido em AGENTS.md.

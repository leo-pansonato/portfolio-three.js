# AGENTS.md — Trabalho com múltiplos agentes

Guia para dividir o desenvolvimento entre agentes do Claude Code sem conflitos e sem perder consistência arquitetural. Complementa o [CLAUDE.md](CLAUDE.md), que continua valendo para todos.

> O Claude Code carrega o `CLAUDE.md` automaticamente, mas **não** este arquivo. O `CLAUDE.md` exige sua leitura antes de delegar ou atuar como subagente, e cada definição em `.claude/agents/` o referencia.

## 1. Realidade atual: pouco paralelismo seguro

O código tem ~2,4 mil linhas e três arquivos que quase toda mudança relevante toca: `src/main.ts`, `src/components/Player.ts`, `src/managers/VehicleManager.ts`. Enquanto o ROADMAP P1-2 não decompuser o `Player`, trabalho paralelo em física, input e câmera **vai** gerar conflito.

Paralelizar agora apenas:

- investigações somente leitura (itens **[Investigar]** de ARCHITECTURE.md §7);
- testes novos em arquivos novos;
- renderização que não toque `main.ts` nem `Player.ts` (ex.: `LightingManager`, `Environment` visual);
- documentação.

Os critérios para liberar paralelismo amplo estão no fim do [ROADMAP.md](ROADMAP.md).

## 2. Papéis

Os papéis existem porque há trabalho real em cada área. Não crie novos sem um item de roadmap que os justifique.

| Papel | Onde | Escopo de arquivos (hoje → alvo) | Não pode |
|---|---|---|---|
| **Coordenador** | sessão principal | todos; dono exclusivo de `main.ts`, `package.json`, `tsconfig.json`, docs raiz e ADRs | delegar decisões de arquitetura |
| **physics-vehicle** | `.claude/agents/physics-vehicle.md` | `PhysicsManager.ts`, partes físicas de `Player.ts`/`VehicleManager.ts`, `Environment.ts` (colisores) → `src/physics/`, `src/vehicle/`, `src/data/vehicles/` | tocar renderização, câmera, UI |
| **rendering** | `.claude/agents/rendering.md` | `LightingManager.ts`, parte visual de `Environment.ts`, materiais, `ModelLoader.ts` → `src/render/`, `src/world/` (visual) | alterar física ou ordem do loop |
| **architecture-reviewer** | `.claude/agents/architecture-reviewer.md` | somente leitura | editar arquivos |
| **Agente de propósito geral** | `general-purpose` com escopo definido | input/câmera/UI (`InputManager.ts`, `CameraController.ts`, `UIManager.ts`), testes, tooling | sair do escopo dado |

Input, câmera, UI e ferramentas não têm agente dedicado: o volume de trabalho não justifica. Use um agente de propósito geral com escopo explícito. Reavalie quando P1-4, P2-5 ou P2-6 começarem.

## 3. Quando delegar

Delegue quando **todas** forem verdade:

- a tarefa tem item no ROADMAP (ou é uma investigação somente leitura);
- os arquivos a tocar estão listados e não estão em uso por outro agente;
- o critério de conclusão é verificável (comando, teste, cenário);
- não há decisão arquitetural aberta dentro dela.

Não delegue: decisões de ADR, mudanças em contratos compartilhados, tarefas de poucas edições que o coordenador faz mais rápido, nem a revisão de algo cuja conclusão você já tem (o revisor deve receber o código, não a sua hipótese).

## 4. Decomposição de tarefas

1. Partir do item do ROADMAP e de seus critérios de conclusão.
2. Separar em tarefas que (a) compilam e passam nos testes sozinhas, (b) tocam um conjunto de arquivos disjunto, (c) têm um único tipo de mudança: **mover**, **mudar comportamento**, **ajustar parâmetros** ou **adicionar teste**.
3. Ordenar por dependência; contratos (tipos, interfaces) vêm antes das implementações que os usam.
4. Uma tarefa que precisa editar um arquivo do coordenador (`main.ts`, `package.json`) devolve a alteração proposta no relatório em vez de editar.

Exemplo — P1-2 (decompor `Player`):

| Ordem | Tarefa | Agente | Arquivos |
|---|---|---|---|
| 1 | Definir `VehicleDefinition`/`VehicleState` e mover catálogo para `src/data/vehicles/` sem mudar valores | physics-vehicle | `VehicleManager.ts`, `src/data/vehicles/*` |
| 2 | Extrair `VehicleView` (sincronização visual) | rendering | `Player.ts` (trecho visual), `src/render/VehicleView.ts` |
| 3 | Extrair `VehicleControl` (volante, comandos) | physics-vehicle | `Player.ts` (trecho de controle), `src/vehicle/VehicleControl.ts` |
| 4 | Ligar as peças no `Game` | coordenador | `main.ts` |

2 e 3 tocam o mesmo arquivo → **sequenciais**, não paralelas.

## 5. Evitar edições concorrentes

- Antes de delegar, o coordenador registra no pedido os arquivos que o agente pode editar. Fora da lista, o agente só lê.
- Dois agentes de escrita simultâneos usam `isolation: "worktree"`; cada um entrega em sua branch.
- Arquivos de propriedade do coordenador: `src/main.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite-env.d.ts`, `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `AGENTS.md`, `ROADMAP.md`, `docs/decisions/*`.
- Arquivos de alto conflito (`Player.ts`, `VehicleManager.ts`): um agente por vez, sempre.
- Nunca reformate, renomeie ou mova arquivos fora do escopo — isso gera conflito com todos os outros.

## 6. Contratos entre agentes

Quando subsistemas dependem um do outro, o contrato é um **tipo TypeScript** num arquivo dedicado, criado pelo coordenador (ou por um agente com essa tarefa específica) e integrado **antes** das implementações. Contratos previstos (ARCHITECTURE §5): `PhysicsWorld`, `VehicleDefinition`, `VehicleState`, `InputFrame`, `SimulationSnapshot`.

Regras:

- Implementação não altera contrato. Se precisar, para e propõe a mudança no relatório.
- Contrato documenta unidades, sistema de coordenadas, quem é dono do dado e quem pode mutá-lo.
- Mudança de contrato atualiza todos os consumidores no mesmo commit.

## 7. Relatório de entrega (obrigatório para todo subagente)

```
## Resultado
<o que foi feito, em 2–4 frases>

## Arquivos alterados
- caminho — o que mudou

## Interfaces / contratos
<assinaturas públicas novas ou alteradas; "nenhuma" se for o caso>

## Dependências
<pacotes adicionados/removidos; "nenhuma">

## Comportamento
<o que muda para o jogador; "nenhum" para refatoração pura>

## Validação
- comando/teste/roteiro executado → resultado
- o que NÃO foi verificado e por quê

## Pendências e riscos
<itens fora do escopo encontrados, dúvidas>
```

## 8. Integração

1. O coordenador lê o diff (não só o relatório) e roda a validação do CLAUDE.md.
2. Integra uma entrega por vez, na ordem de dependência; depois de cada uma, `npm run build` (e `npm test` quando existir).
3. Conflito de merge é resolvido pelo coordenador, nunca descartando o trabalho de outro agente sem análise.
4. Atualiza ROADMAP.md (estado do item) e ARCHITECTURE.md (se a arquitetura mudou).

## 9. Revisão técnica

Peça ao `architecture-reviewer` para mudanças que tocam contratos, loop, física ou mais de um subsistema. Critérios:

- respeita os limites e marcações de ARCHITECTURE.md e o escopo de arquivos dado;
- não mistura tipos de mudança (mover/comportamento/parâmetros);
- sem duplicação de responsabilidade com módulo existente;
- sem alocação por quadro, sem recurso sem dono;
- unidades e eixos explícitos em código físico;
- validação relatada é suficiente para o risco.

## 10. Conflitos arquiteturais

Quando dois agentes (ou um agente e a documentação) divergem sobre a solução:

1. Ambos param a parte em disputa.
2. O coordenador escreve as opções em um ADR `Proposta`, com evidências (arquivos, testes, medições).
3. Decisões que mudam direção do produto ou dependências vão ao usuário.
4. Até a decisão, nada que dependa dela é integrado.

## 11. Exigem aprovação do coordenador antes de prosseguir

- Editar arquivo fora do escopo dado ou de propriedade do coordenador.
- Adicionar/remover dependência ou asset.
- Alterar contrato, convenção de unidades/eixos, ordem do loop ou passo de simulação.
- Alterar parâmetros de veículo (tuning).
- Remover código ou arquivo.
- Qualquer operação Git além de commit na própria branch/worktree (merge, rebase, push, troca de branch na checkout principal).
- Qualquer coisa ligada a ADR com status `Proposta`.

# ADR-0007 — Áudio veicular por amostras, parâmetros e eventos de contato

- **Status:** Aceita (2026-11-03) — opção A; gravações CC0 (2026-11-04), seleção pendente
- **Data:** 2026-11-03
- **Escopo:** som de motor, pneus, impactos e mixagem (ROADMAP P2-11, substitui o protótipo do P2-8).

## Contexto

O P2-8 entregou um protótipo procedural (`src/audio/`, ARCHITECTURE §3.6.1): osciladores dente de serra/quadrada saturados para o motor e ruído branco filtrado para pneus, vento e impactos. Avaliação do usuário (2026-11-03):

- motor agudo demais e artificial;
- derrapagem é um chiado irreconhecível;
- impacto não se ouve.

Diagnóstico:

- **Motor:** síntese de forma de onda não reproduz o espectro de um motor real (ordens de combustão moduladas, ressonâncias de admissão e escape, ruído mecânico). Saturação + segunda ordem quadrada + corte até 4,2 kHz deixam os harmônicos altos dominarem.
- **Pneus:** o guincho real é tonal (stick-slip da borracha, ~1–3 kHz com modulação); ruído de banda larga em um passa-banda não soa como pneu.
- **Impacto (investigado em 2026-11-04):** batidas nas caixas do cenário (5 kg) dão 0,6–1,0 g no chassi a 72–144 km/h, abaixo do limiar de 3 g do `impactIntensity`: o som nunca disparava. Detectar impacto pela aceleração do chassi é indireto; o impulso de contato (110–220 N·s nas caixas, dezenas de kN·s numa parede) é o sinal certo.

Jogos de corrida comerciais não sintetizam o motor do zero: usam gravações do carro real (em dinamômetro, em várias rotações e cargas) tocadas por um motor de áudio dirigido por parâmetros da simulação.

## Práticas da indústria consideradas

1. **Motor por camadas de rpm (*loop crossfading*):** loops gravados em rotações fixas (ex.: a cada 500–1000 rpm), em dois conjuntos — **com carga** (acelerando) e **sem carga** (desacelerando). Cada camada sofre *pitch-shift* só em torno da sua rotação de gravação (±10–15%) e as vizinhas fazem *crossfade* de potência constante pela rpm; a carga faz o *crossfade* entre os conjuntos. É o modelo das ferramentas FMOD/Wwise (parâmetros RTPC, eventos, barramentos).
2. **Motor granular:** uma gravação de rampa de rpm fatiada em grãos de um ciclo, escolhidos e emendados pela rpm e pela carga (abordagem de produtos como o REV, da Crankcase Audio). Transições mais naturais que (1), maior custo de implementação e de CPU.
3. **Fontes separadas por componente:** escape, admissão, mecânica do motor, transmissão (*whine* por rotação da saída), turbo (assovio pela pressão, *blow-off* ao soltar), corte de giro, estalos/*backfire* ao tirar o pé. Cada uma com seus parâmetros.
4. **Mix interno × externo:** *snapshot* de mixagem por modo de câmera (cabine abafada e mais motor/transmissão; externa com mais escape), atenuação e filtragem por ângulo do ouvinte em relação ao escape.
5. **Pneus por amostras e superfície:** loops de *scrub* (escorregamento baixo), guincho (acima do pico) e travamento/burnout; volume e pitch pelo escorregamento normalizado ao pico e pela velocidade do contato; por roda ou por eixo; conjunto por material de superfície (asfalto, zebra, terra, grama — P2-3); rolamento por superfície.
6. **Impactos e raspagens por eventos de contato da física:** a Rapier emite eventos de força de contato (`ActiveEvents.CONTACT_FORCE_EVENTS`, limiar por colisor). Impulso → nível (leve/médio/forte) → amostra sorteada entre variações, com pitch/volume aleatórios pequenos e intervalo mínimo por par de corpos; raspagem como loop contínuo pela velocidade de deslizamento do contato; par de materiais (metal × concreto, metal × metal). Batente de suspensão pela telemetria.
7. **Espacialização:** `PannerNode` (HRTF para fontes próximas), modelo de distância, ouvinte na câmera, efeito Doppler calculado à mão (a Web Audio não tem mais `dopplerFactor`), necessário quando houver outros carros.
8. **Dados × estado:** definição de áudio por veículo (amostras, rpm e carga de cada uma, ganhos, curvas) imutável no catálogo; estado de reprodução na instância. Parâmetros vêm do estado da simulação (carga real do motor, pressão do turbo), não do input — vale também no replay.

## Opções

| | A — Motor próprio em Web Audio (amostras) | B — FMOD Studio HTML5 (WASM) | C — Granular próprio |
|---|---|---|---|
| Dependência | nenhuma | runtime FMOD (licença, MBs de WASM) | nenhuma (talvez `AudioWorklet`) |
| Autoria | dados em TS/JSON | ferramenta FMOD Studio (designer de som) | dados + ferramenta de fatiar grãos |
| Qualidade do motor | boa com camadas bem gravadas | boa (mesmo modelo de camadas, com ferramenta) | a melhor nas transições |
| Escala (vários carros, superfícies) | barramentos e vozes por conta própria | pronta (vozes, prioridade, *snapshots*) | igual a A |
| Testes em Node | mapeamento de parâmetros testável | só no navegador | mapeamento testável |

Recomendação inicial: **A**, com contrato espelhando os conceitos de middleware (eventos, parâmetros, barramentos, *snapshots*) para permitir migrar a B ou acrescentar C ao motor sem mudar os chamadores. **Decisão pendente do usuário**, assim como a origem das gravações.

## Decisão

**A** (escolhida pelo usuário em 2026-11-03): motor de áudio próprio em Web Audio, por amostras, sem dependência nova. O contrato segue os conceitos de middleware (eventos, parâmetros, barramentos, *snapshots*) para que o granular (C) possa entrar depois como outra fonte de motor sem mudar os chamadores. A origem, a licença e o formato das gravações continuam em aberto.

## Pré-requisitos e questões abertas

- **Assets — origem decidida (2026-11-04): CC0.** Levantamento no Freesound com filtro CC0:
  - **Motor:** não há conjunto CC0 com camadas por rpm com/sem carga. Há rotações livres e acelerações de carros parecidos: "S63 AMG V8 Engine Revs" (marcelweiss, 505321; V8 biturbo da família do G63), "Car, BMW M6, Start, Idle, Accelerate" (Kinoton, 478597), "Import car revs on Chassis Dyno with Turbo" (editboy23, 496171; Supra em dinamômetro, com carga), "RFX_Aceleration Inside the Car" (willybilly1984, 345329; interno). Nenhum é um seis em linha S55. Consequência: as camadas saem fatiadas dessas gravações (trechos de um ciclo, como na opção C/granular), com rpm medida pela frequência de ignição; o conjunto sem carga vem das rotações livres e o com carga do dinamômetro/aceleração.
  - **Pneus:** poucos guinchos limpos; quase todos têm motor junto. Candidatos: "Tire.ogg" (egomassive, 536769), "Car peels off" (therisingorder, 271337); "screeching tyres" (johnnydekk, 614627) é bolsa de água em azulejo, mas limpo.
  - **Impactos:** "Metal Hit 2" (dslrguide, 321482) e "Car_Door_Hit.wav" (mickyman5000, 340539) leves; "Fast Collision" e "Collision" (qubodup, 332056/332058) médios; "Car Crash" (squareal, 237375) forte, em camadas.
  - O Freesound exige conta para baixar o original; as prévias (mp3/ogg com perda) não servem de fonte. Os originais ficam fora do Git; só entram os cortes finais.
- **Formato:** Safari ainda tem suporte irregular a Opus em `decodeAudioData` (Ogg e WebM). Proposta: AAC-LC em `.m4a` como formato único (decodificado por Chrome, Firefox e Safari), com pontos de laço explícitos nos dados para descartar o preenchimento do codificador. Opus só se a medição de tamanho justificar dois formatos.
- **Orçamento:** meta de até 1 MB por veículo (~8 camadas × 2 cargas × 2–3 s a 96–128 kbps) e 0,5 MB compartilhado (pneus, impactos), carregados sob demanda (P3-2).
- **Sinais da simulação:** telemetria precisa de carga do motor (torque pedido ÷ disponível), torque no corte, pressão do turbo e escorregamento por roda já normalizado; contrato `PhysicsWorld` precisa de eventos de contato (impulso, ponto, par de colisores, materiais) — muda `src/physics/` (ARCHITECTURE §5).
- **Superfícies:** material por colisor vem do P2-3.
- **Verificação:** além dos testes de mapeamento em Node, roteiro de escuta com o usuário e gravação de referência (ex.: acelerada 0–100 e redução) comparada lado a lado.

## Consequências

- O protótipo procedural do P2-8 fica até a nova implementação substituí-lo, e os testes de mapeamento são reaproveitados.
- Gravações de áudio entram no histórico do Git para sempre: escolher formato e orçamento antes de commitar qualquer amostra.
- Mudança no contrato `PhysicsWorld` (eventos de contato) entra em commit próprio, antes do áudio de impacto.

# Toninho: acompanhamento de pedidos por IA (pós-vendas T&M)

Toninho é o agente de IA que acompanha o cliente **depois que o pedido foi aprovado**: acolhe, informa o
andamento da produção na cadência combinada, avisa que ficou pronto, confirma a entrega, colhe feedback e NPS, e
entrega o cliente para a régua de recompra. Tudo pelo WhatsApp principal (Chatwoot), sem passar por humano, com
escalada para o Vinícius (pós-vendas) só nas exceções.

Ele é o irmão da Júlia (pré-vendas): mesma stack (Chatwoot + n8n + Claude), mesmas convenções do repositório
`tm-chatwoot`, mas com outra persona, outro funil e outro objetivo.

```
Força de Vendas ──(Pedido Aprovado)──► PipeRun: funil Produção (40828) + funil Customer Success (105219)
                                              │                       │
                        Vexta ERP (produção) ─┘ (fase 2: API)         │ Toninho lê a cada 30 min
                                                                      ▼
                       n8n "Toninho - Régua"  ──► Chatwoot (WhatsApp T&M, inbox 3) ──► cliente
                       n8n "Toninho - Conversa" ◄── Chatwoot webhook (cliente respondeu) ──► Claude ──► resposta/ação
                                                                      │
                                              PipeRun (etapa, nota, NPS) + Chatwoot (atributos, etiquetas, time)
```

## O que tem aqui

| Caminho | O que é |
|---|---|
| `docs/01-levantamento.md` | O que existe hoje (funis, etapas, campos, templates, workflows, volumes) e os buracos encontrados. Tudo com ID. |
| `docs/02-arquitetura.md` | O desenho do fluxo: gatilhos, estados, cadências, mensagens, guardas, escalada, NPS, recompra, fases. |
| `docs/03-pendencias-decisoes.md` | O que precisa de decisão ou acesso do Humberto antes de ligar (PipeRun, Chatwoot, Meta, Vexta, Força de Vendas). |
| `docs/04-contrato-eventos-pedido.md` | Contrato do webhook que o Força de Vendas (e o Vexta, na fase 2) podem chamar para avisar o Toninho. |
| `base/toninho-pos-vendas.txt` | Base viva do Toninho (persona, regras, scripts por etapa). Publicar em `/opt/base` do VPS como a da Júlia. |
| `n8n/src/comum.js` | Lógica pura (cadências, status, decisão do próximo toque). Sem rede, testável. |
| `n8n/src/regua.node.js` | Nó do workflow **Toninho - Régua** (agendado): acolhimento, toques de produção, pronto, entrega, NPS. |
| `n8n/src/conversa.node.js` | Nós do workflow **Toninho - Conversa** (webhook): contexto, chamada à IA, execução das ações. |
| `n8n/src/pedido-eventos.node.js` | Nó do workflow **Toninho - Eventos do Pedido** (webhook do Força de Vendas / Vexta). |
| `n8n/build.js` | Monta os JSONs em `n8n/dist/` e, com `--publish`, cria/atualiza no n8n pela API. |
| `n8n/test/comum.test.js` | Testes da lógica pura. |
| `n8n/test/simular.js` | Simulador local: roda os nós montados fora do n8n com leituras reais e escritas bloqueadas. |
| `n8n/dist/` | JSON gerado pelo build (tokens como placeholder). |

## Como rodar

```sh
node --test n8n/test/*.test.js  # testes da lógica pura
node n8n/test/simular.js regua  # roda a Régua montada contra as APIs reais, só leitura (escritas bloqueadas)
node n8n/build.js               # gera n8n/dist/*.json (tokens ficam como __PLACEHOLDER__)
CHATWOOT_TOKEN=... TONINHO_TOKEN=... PIPERUN_TOKEN=... N8N_API_KEY=... node n8n/build.js --publish
```

Os workflows nascem com `SIMULACAO: true`: leem tudo de verdade e **não escrevem nada** (nem Chatwoot, nem
PipeRun, nem mensagem ao cliente). O que seria feito volta na saída do nó. Só se liga `SIMULACAO: false` depois
das aprovações listadas em `docs/03-pendencias-decisoes.md`.

## Regras herdadas do tm-chatwoot que valem aqui

- NUNCA alterar o PipeRun (funis, etapas, automações) sem o Humberto aprovar. O Toninho escreve no PipeRun só o
  que está listado e aprovado (ver pendências), e nasce em simulação.
- Credenciais nunca vão para o repositório: o `build.js` injeta por variável de ambiente.
- Tom por segmento: empresa/B2B é profissional-cordial, sem gíria; terceirão/faculdade/pessoa física é
  descontraído. Na dúvida, profissional.
- Opt-out é absoluto e imediato. Etiquetas `opt-out` e `sem-followup` param tudo.
- Conversa `open` com humano falando por último = Toninho em silêncio.

# 02. Arquitetura do fluxo (proposta para aprovação)

Objetivo: do **Pedido Aprovado** até o **NPS coletado**, o cliente é acompanhado pelo Toninho sem que ninguém
do time precise lembrar de mandar mensagem. O humano (Vinícius) entra só quando o Toninho escala.

## 1. Princípios

1. **Fonte da verdade do processo = funil Customer Success do PipeRun.** A etapa do negócio no CS é o estado
   do acompanhamento. O Toninho lê e move. Isso mantém o painel que o Vinícius e o Marcelo já olham.
2. **Fonte da verdade do status do pedido = funil Produção do PipeRun** (fase 1) e **Vexta** (fase 2, quando
   houver API). O Toninho nunca inventa status: se não encontra o negócio de Produção, fala "em andamento" e
   escala quando o cliente insiste.
3. **Nada é escrito sem simulação antes.** Toda escrita (mensagem, atributo, etapa, nota) passa por
   `SIMULACAO`. Ligar é decisão do Humberto.
4. **O cliente sempre tem um humano a um "quero falar com alguém" de distância.**
5. **Custo**: toque dentro da janela de 24h é texto livre (grátis); fora da janela é template, de preferência
   UTILITY. O Toninho nunca manda dois toques com menos de 20h de intervalo e nunca fora do horário comercial.

## 2. Componentes

| Componente | Tipo | Gatilho | Faz |
|---|---|---|---|
| **Toninho - Régua** | n8n agendado, a cada 30 min, seg-sex 8h-18h (SP) | tempo | Lê o funil CS. Para cada negócio aberto decide o próximo passo (acolher, toque de produção, avisar pronto, confirmar entrega, pedir NPS, lembrar NPS, encerrar) e executa: mensagem no Chatwoot (texto ou template), atributos, etapa/nota no PipeRun. |
| **Toninho - Conversa** | n8n webhook `/webhook/toninho` | Chatwoot webhook de conta (`message_created`, incoming, conversa atribuída ao agente Toninho) | Espera 10 s (rajada), monta contexto (contato, negócio CS, status de Produção, histórico), chama o Claude com a tool `responder`, envia a resposta como Toninho e executa a decisão (registrar prazo do cliente, feedback, NPS, escalar, opt-out, encerrar). |
| **Toninho - Eventos do Pedido** | n8n webhook `/webhook/toninho-pedido` | Força de Vendas (hoje) e Vexta (fase 2) chamam com eventos do pedido | Grava no contato e no negócio o que chegou (telefone, prazo, NF, rastreio, entregue) e dispara o toque correspondente fora do ciclo de 30 min. Contrato em `04-contrato-eventos-pedido.md`. |
| **Agente "Toninho (IA)"** no Chatwoot | usuário agente com token | | Remetente das mensagens. Conversa dele fica `open`, time `pós-vendas`, etiqueta `pos-vendas`. |
| **Base viva** `base/toninho-pos-vendas.txt` | txt servido pelo Caddy em `/base/` | | Persona, regras, scripts. Editar aqui, publicar com o mesmo `publicar-base.ps1` da Júlia. |

## 3. Máquina de estados (etapa do CS = estado)

```
                 ┌──────────────────────────────────────────────────────────────────────────┐
                 │ Pedido Aprovado (Força de Vendas cria negócio no CS em Acolhimento)      │
                 └──────────────────────────────┬───────────────────────────────────────────┘
                                                ▼
  [Acolhimento 679087] ── Toninho manda a 1ª mensagem (apresenta, confirma pedido, pergunta data limite)
        │ ao enviar: move para a etapa do prazo (campo Prazo CS; sem campo: deriva de Data Prometida; sem nada: 45 dias + nota)
        ▼
  [Em produção - 15 | 25 | 45 | 60 | Especial] ── toques nos dias da cadência, com o status real do funil Produção
        │ quando o negócio de Produção chega em PEDIDOS PRONTOS (ou além): avisa "ficou pronto" e move
        ▼
  [Pedido pronto 683839] ── D10 / D20 / D30: "já chegou?"; expedição/rastreio quando houver
        │ quando Produção chega em PEDIDO ENTREGUE / PÓS-VENDA, ou o cliente confirma que recebeu:
        │ mensagem de entrega + pergunta de NPS (0 a 10) e move
        ▼
  [Coleta de feedback 683840] ── lembrete de NPS em D+3 e D+7; cliente respondeu nota → registra
        │ NPS 9-10: agradece e convida para depoimento (campanha existente) · NPS 7-8: agradece, pergunta o que faltou
        │ NPS 0-6: pede desculpas, escala para Vinícius + Marcelo (template do gerente), etiqueta `nps-detrator`
        ▼
  encerrado: nota final no negócio, atributo entregue_em no contato → Régua 2 (recompra, só empresa) assume
```

Exceções em qualquer estado:
- Cliente pergunta algo que o Toninho não sabe (arte, pagamento, alteração do pedido, atraso): responde o que
  o status permite e **escala** (atribui ao Vinícius, etiqueta `responder`, nota privada com resumo).
- Cliente reclama ou demonstra insatisfação: escala na hora, sem tentar resolver sozinho.
- Negócio de Produção em COBRANÇA PGTO FINAL / INADIMPLENTES: o Toninho informa que está pronto e que o
  financeiro vai alinhar a parcela final; **não cobra** (decisão a confirmar, pendência 7).
- Negócio de Produção em AGUARDANDO ALTERAÇÕES ou AGUARD. APROV. AMOSTRAS por mais de 2 dias: o Toninho avisa
  que a produção depende de uma confirmação do cliente e escala para o Vinícius conduzir.
- Opt-out: para tudo, etiqueta `opt-out`, nota no negócio, Vinícius assume o acompanhamento manual.
- Devolução: depois de uma escalada, o humano devolve a conversa ao Toninho atribuindo-a ao agente "Toninho (IA)"
  (ou resolvendo-a). No ciclo seguinte a Régua limpa a escalada e retoma de onde parou. Sugestão: macro
  "Devolver pro Toninho" no Chatwoot (atribuir + tirar `responder`).

## 4. Cadências (dias contados a partir da entrada na etapa)

| Etapa | Toques | Fonte |
|---|---|---|
| Em produção - 15 dias | 3, 7, 11, 15 | descrição da etapa |
| Em produção - 25 dias | 5, 10, 18, 22 | descrição da etapa |
| Em produção - 45 dias | 15, 25, 35, 40 | descrição da etapa |
| Em produção - 60 dias | 15, 30, 45, 55 | **proposta** (etapa sem regra) |
| Em produção - Prazo especial | 7, 14, 21, 28, 35, 42 | **proposta**: semanal, e o Vinícius recebe nota a cada toque |
| Pedido pronto | 10, 20, 30 | descrição da etapa |
| Coleta de feedback | 3, 7 (lembretes de NPS) | **proposta** |

O conteúdo de cada toque não é fixo: o Toninho lê a etapa atual do funil Produção e escolhe o texto da base
(ex.: "na fila de impressão", "em produção", "em revisão de qualidade", "pronto, aguardando expedição", "a
caminho"). Se a etapa de Produção não mudou desde o toque anterior, o toque diz isso com honestidade ("segue
em produção, dentro do prazo combinado") em vez de repetir um status.

Mapa etapa do funil Produção → status dito ao cliente está em `n8n/src/comum.js` (`STATUS_PRODUCAO`).

## 5. Como o Toninho acha o cliente (telefone)

Ordem de busca, parando na primeira que der telefone BR válido:
1. `contact_phones` da pessoa do negócio do CS.
2. Telefone/celular da empresa do negócio.
3. Contato no Chatwoot cujo atributo `piperun_deal_id` aponte para um negócio de **orçamento ganho** da mesma
   empresa (o handoff da Júlia grava esse atributo; validado na simulação: "7018 - CAMED" achou a Flávia por aí).
4. Contato cujo nome termina com " - <número do pedido>" (convenção que o Vinícius já usa: "Flávia Nascimento - 7018").
5. Telefone da pessoa ou da empresa no PipeRun (`contact_phones`, celular, telefone).
6. Evento do Força de Vendas (`04-contrato-eventos-pedido.md`) com `cliente.telefone`.

Sem telefone: o negócio ganha a nota "TONINHO: sem telefone do cliente; acolher manualmente" e uma atividade
para o Vinícius, uma vez só (controle em `staticData.semTelefone`). É a pendência 3 (Força de Vendas mandar o
telefone) que zera esse caso.

## 6. Dados que o Toninho grava

### Chatwoot (atributos do contato, criar as chaves novas)

| Chave | Tipo | Conteúdo |
|---|---|---|
| `toninho_cs_deal_id` | texto | id do negócio no funil CS |
| `toninho_pedido` | texto | número do pedido (prefixo do título) |
| `toninho_regua` | texto | estado: `acolhimento`, `producao:15`, `pronto`, `nps`, `encerrado`, `optout` |
| `toninho_passo_em` | texto | ISO do último toque |
| `toninho_toques` | texto | passos já feitos, ex. `p1,p2` |
| `prazo_cliente` | texto | data limite dita pelo cliente (AAAA-MM-DD) |
| `nps_nota` | número | 0 a 10 |
| `nps_comentario` | texto | o que o cliente disse junto |
| `nps_em` | texto | ISO |
| `entregue_em` | texto | ISO da confirmação de entrega (gatilho da Régua 2 de recompra) |

Etiquetas novas: `nps-promotor`, `nps-neutro`, `nps-detrator`, `toninho` (conversa sob acompanhamento IA).

### PipeRun (todas as escritas abaixo dependem da aprovação da pendência 1)

- Mover o negócio do CS entre etapas (Acolhimento → prazo → Pedido pronto → Coleta de feedback).
- Nota no negócio a cada toque e a cada resposta relevante do cliente (resumo de 1 a 3 linhas).
- `nps_score` na **empresa** (campo nativo do PipeRun, hoje vazio) e nota com o comentário.
- Campo `Prazo CS` (793911) quando o Toninho deduzir a cadência, para o painel ficar coerente.
- Marcar ganho ao encerrar (`FECHAR_GANHO`, desligado por padrão; a decisão é do Humberto).

Nunca: criar ou apagar etapas, mexer em automações, tocar no funil Produção, dar perdido.

## 7. A conversa (Toninho - Conversa)

Entrada: webhook de conta do Chatwoot (`message_created`). Filtro duro em código: `incoming`, não privada,
inbox 3 (ou 2 para teste), conversa atribuída ao agente Toninho **ou** contato com `toninho_regua` ativo e
conversa sem responsável humano. Etiquetas `opt-out`/`sem-followup` → sai.

Rajada: espera 10 s e só segue se a mensagem ainda for a última do cliente (como a Júlia).

Contexto para a IA (bloco dinâmico, fora do cache): nome, empresa, segmento/tipo (define o tom), número do
pedido, etapa do CS, status de Produção em texto, data prometida, prazo dito pelo cliente, toques já feitos,
últimas 20 mensagens.

Tool `responder` (forçada), campos:

| Campo | Valores |
|---|---|
| `resposta` | texto ao cliente (1 balão, sem colchetes, sem travessão) |
| `decisao` | `continuar` · `prazo_cliente` · `feedback` · `nps` · `entregue` · `escalar` · `optout` · `encerrar` |
| `prazo_cliente` | AAAA-MM-DD quando o cliente disse até quando precisa |
| `nps_nota` | 0-10 |
| `feedback` | resumo do que o cliente achou |
| `motivo_escalada` | uma linha para o Vinícius |

Guardas em código (não em prompt): nota de NPS só vale se for inteiro 0-10 escrito pelo cliente; `escalar`
é forçado se a mensagem tiver reclamação explícita (lista de termos) ou pedido de humano; `optout` é forçado
pelos termos de parada; depois de 6 turnos do Toninho sem decisão terminal, escala.

Modelo: `claude-haiku-4-5` (mesmo da Júlia, custo conhecido ~US$0,02/msg). `claude-haiku-5-5` já é usado na
inbox de teste e pode ser a opção quando o Humberto quiser comparar.

## 8. Entrega para a recompra

Ao registrar a entrega (`entregue_em`) o Toninho não manda nada de venda. A Régua 2 (recompra, só empresa,
45 dias e 12 meses) lê `entregue_em` e `tipo_cliente`/segmento, como já desenhado no `reguas-automacao.txt`.
O funil Recompra do PipeRun continua recebendo o negócio pelas automações nativas que já existem.

## 9. Fases de entrega

| Fase | Entrega | Depende de |
|---|---|---|
| **0. Simulação** (este repositório) | Workflows publicados com `SIMULACAO: true`; relatório do que fariam a cada ciclo; base publicada; agente Toninho criado no Chatwoot. | Pendências 2 e 4 |
| **1. Piloto** | `SIMULACAO: false` só para negócios criados a partir de `ATIVAR_DESDE`, `MAX_POR_CICLO: 10`, só pedidos com telefone. Acolhimento + toques + pronto + entrega + NPS. Templates marketing existentes. | Pendências 1, 3, 5 |
| **2. Templates próprios e Força de Vendas** | Templates UTILITY do Toninho aprovados; Força de Vendas manda telefone, prazo e eventos no webhook. Backlog antigo de Acolhimento tratado em lote com o Vinícius. | Pendências 3, 6 |
| **3. Vexta** | Status, NF e rastreio direto do ERP; aviso de coleta com rastreio; detecção de atraso real (data prometida × previsão de produção) com escalada preventiva. | Pendência 8 |

## 10. O que o Humberto e o Marcelo veem

- Painel do CS no PipeRun continua o mesmo, só que as etapas andam sozinhas e cada negócio tem notas do Toninho.
- Conversa no Chatwoot mostra tudo que o Toninho disse, com assinatura `*Toninho (IA)*`.
- Relatório semanal (sexta, na conversa de alertas do Humberto, como o Gerente IA): acolhidos, toques, prontos,
  entregues, NPS médio e distribuição, escaladas e motivos, sem telefone, erros. Fica para a fase 1.

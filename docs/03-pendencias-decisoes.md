# 03. Pendências e decisões (antes de ligar)

Numeração usada nos outros documentos. Cada item diz quem resolve e o que destrava.

| # | O quê | Quem | Destrava |
|---|---|---|---|
| 1 | **Autorizar as escritas do Toninho no PipeRun**: mover etapas do funil CS (105219), nota nos negócios, `nps_score` na empresa, campo Prazo CS, (opcional) marcar ganho ao encerrar. Regra dura do tm-chatwoot: nada no PipeRun sem o seu ok. | Humberto | Fase 1 |
| 2 | **Criar o agente "Toninho (IA)"** no Chatwoot (usuário agente, e-mail ex. `toninho@temgrupo.com.br`, membro da inbox 3 e da inbox 2, time pós-vendas, assinatura `*Toninho (IA)*`), gerar o token de acesso e criar a credencial `Chatwoot Toninho` no n8n. Criar o webhook de conta → `https://n8n.temgrupo.com.br/webhook/toninho` (`message_created`). Criar os atributos de contato e etiquetas listados em `02-arquitetura.md` §6 e a macro "Devolver pro Toninho" (atribuir ao Toninho + tirar `responder`). | Humberto (10 min no painel) | Fase 0 |
| 3 | **Força de Vendas passar o telefone do cliente** (e e-mail) ao criar o negócio do CS: pessoa vinculada com `contact_phones`. Sem isso 22 dos 30 últimos pedidos B2B ficam sem WhatsApp. Idealmente também preencher `Prazo CS` (793911), `Data Prometida` (793910) e `Endereço Entrega` (793915), e chamar o webhook de eventos (`04-contrato-eventos-pedido.md`). | Nathan (Wayup) | Fase 1 para B2B; fase 2 para eventos |
| 4 | **Confirmar a persona**: nome "Toninho", masculino, tom profissional-cordial para empresa e descontraído para terceirão/faculdade (igual à regra da Júlia). Validar os scripts da base (`base/toninho-pos-vendas.txt`). | Humberto + Vinícius | Fase 0 |
| 5 | **Cadências que o PipeRun não define**: 60 dias (proposto 15/30/45/55), Prazo especial (proposto semanal + nota ao Vinícius), lembretes de NPS (proposto D+3 e D+7). E o que fazer com o **backlog**: 126 em Acolhimento e 68 em Coleta de feedback. Proposta: `ATIVAR_DESDE` = data do go-live (só pedidos novos) e o backlog tratado em lote pelo Vinícius com ajuda do Toninho em modo manual. | Humberto + Vinícius | Fase 1 |
| 6 | **Templates UTILITY do Toninho** para cadastrar na Meta (texto sugerido em `base/toninho-pos-vendas.txt`, seção 9): `tm_cs_acolhimento` ({{1}} nome, {{2}} pedido, {{3}} prazo), `tm_cs_status` ({{1}} nome, {{2}} pedido, {{3}} status), `tm_cs_pronto` ({{1}} nome, {{2}} pedido), `tm_cs_entregue_nps` ({{1}} nome, {{2}} pedido), `tm_cs_nps_lembrete` ({{1}} nome). Até aprovar, os marketing existentes são usados (mapa `TEMPLATES` no CONFIG). | Humberto (Meta) | Fase 2 (fase 1 roda com os existentes) |
| 7 | **Cobrança da parcela final**: o Toninho avisa que ficou pronto e que o financeiro alinha o pagamento, sem cobrar valor. Confirmar se é isso ou se ele deve mandar o template `tp_confirmando_pedido_pronto__cobrana__47` (que já cobra). | Humberto + Fabiana (financeiro) | Fase 1 |
| 8 | **Vexta**: abrir chamado no suporte (cimsuporte.vexta.com.br) pedindo a documentação da "API de Integração" (portas 5000/5443), credencial de leitura e os campos: status da ordem de produção, data prevista, NF-e emitida, código de rastreio. Alternativa se não houver API: exportação agendada (CSV/consulta no banco) lida pelo n8n. | Humberto / TI | Fase 3 |
| 9 | **Detrator (NPS 0-6)**: proposta é escalar para o Vinícius e avisar o Marcelo pelo template `atendimento_pedido_gerente`. Confirmar quem assume e em quanto tempo. | Humberto + Marcelo | Fase 1 |
| 10 | **Promotor (NPS 9-10)**: convidar na hora para a campanha de depoimento (template `tp_campanha_depoimento_do_cliente_836`, voucher R$ 100) ou só agradecer e deixar para o marketing? | Humberto + Jacques (marketing) | Fase 1 |
| 11 | **Rastreio**: hoje não existe campo. Até o Vexta, o Toninho não cita código de rastreio; se o cliente pedir, escala. Alternativa rápida: o time de expedição colar o rastreio numa nota do negócio de Produção com o prefixo `RASTREIO:` e o Toninho lê. | Humberto + expedição | Fase 1 (opcional) |
| 12 | **Webhook do PipeRun** (opcional): criar via `POST /v1/webhooks` um aviso de mudança de etapa para `/webhook/toninho-pedido` reduziria a latência de 30 min para segundos. Não é necessário para começar. | Humberto | Fase 2 |

## Checklist de go-live (fase 1)

1. Pendências 1, 2, 4, 5, 7, 9, 10 respondidas.
2. `node --test n8n/test` verde; `node n8n/build.js --publish` com os tokens no ambiente.
3. Rodar 3 ciclos da Régua em `SIMULACAO: true` e ler a saída (o que faria, para quem, com qual template).
4. Teste de conversa na inbox 2 (Teste API): contato de teste com `toninho_cs_deal_id` de um negócio de teste,
   cenários: "qual o status?", "preciso até dia X", "chegou, ficou ótimo", "nota 9", "nota 4", "quero falar
   com alguém", "para de mandar mensagem".
5. Ligar `SIMULACAO: false` com `MAX_POR_CICLO: 10` e `ATIVAR_DESDE` = hoje. Acompanhar 1 semana no Vigia e
   no relatório.

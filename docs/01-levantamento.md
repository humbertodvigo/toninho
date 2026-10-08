# 01. Levantamento: o que existe hoje (08/10/2026)

Tudo abaixo foi lido pelas APIs (PipeRun, Chatwoot, n8n) e pelo repositório `tm-chatwoot`. Nada foi alterado.

## 1. Os quatro sistemas e o papel de cada um

| Sistema | Papel no acompanhamento | Acesso que o Toninho tem hoje |
|---|---|---|
| **Força de Vendas** (app interno, repositório da Wayup: `api/src/services/PipeService.ts`) | Quando o negócio chega em **Pedido Aprovado** no funil Etapas de Orçamento, cada proposta vira um pedido. Ele cria o negócio nos funis **Produção** e **Customer Success** do PipeRun (um para cada) com o número do pedido no título. Pedidos da plataforma B2B (Wizard, PSG, Rede Âncora, Amaggi) nascem direto nele. | Só o reflexo no PipeRun. Não há API nem webhook dele conhecido. |
| **Vexta ERP** (produção, NF, expedição) | É onde a fábrica controla ordem de produção, NF-e e envio. | Nenhum. Não há documentação pública da "API de Integração" (portas 5000/5443 citadas no suporte). O que o Toninho enxerga da produção é o que o time de pedidos espelha no funil Produção do PipeRun. |
| **PipeRun** (CRM) | Funil **Produção 40828** (27 etapas, movido pelo time de pedidos/produção) e funil **Customer Success 105219** (8 etapas, dono Vinícius 37828). Automações nativas criam as atividades "CUSTOMER SUCCESS [45 DIAS] ATIVIDADE N - DIA X" ao entrar na etapa. | Leitura e escrita por token (header `token`). Nenhum webhook configurado (`GET /webhooks` vazio). |
| **Chatwoot** | WhatsApp T&M (inbox 3, +55 47 9176-6799, Cloud API), time `pós-vendas` (id 3), agente Vinícius (id 9), etiqueta `pos-vendas` (99 conversas), 141 templates aprovados na Meta. Robôs: Júlia (id 1) e SDR Wizard (id 2). | Admin token e token de robô. Webhooks de conta já existem para `etapas-auto` e `perdido-comando`. |

## 2. Funil Customer Success (105219): etapas, regras e volume

| Ordem | ID | Etapa | Limite (dias) | Regra escrita na etapa | Abertos hoje |
|---|---|---|---|---|---|
| 0 | 679087 | Acolhimento | 2 | Primeiro contato do pós-vendas: apresenta-se, confirma dados do pedido, alinha prazo, captura a data limite do cliente. Depois move para a etapa do prazo. | **126** |
| 1 | 679095 | Em produção - 15 dias | 13 | 4 toques: dia 3, 7, 11, 15 | 11 |
| 2 | 679096 | Em produção - 25 dias | 28 | 4 toques: dia 5, 10, 18, 22 | 23 |
| 3 | 679088 | Em produção - 45 dias | 43 | 4 toques: dia 15, 25, 35, 40 | 49 |
| 4 | 683854 | Em produção - 60 dias | 0 | (sem cadência definida) | 4 |
| 5 | 679097 | Em produção - Prazo especial | 0 | "Pedidos que não podem atrasar de jeito nenhum" | 12 |
| 6 | 683839 | Pedido pronto | 0 | 3 disparos: 10, 20, 30 dias. Monitorar se foi entregue e coletar depoimento. | 2 |
| 7 | 683840 | Coleta de feedback | 0 | (sem regra escrita) | **68** |

Total aberto: 306. O backlog de Acolhimento (126) e de Coleta de feedback (68) é o primeiro sinal de que a
régua manual não dá conta.

Campos customizados do negócio criados para este processo (22/09/2026):

| ID | Campo | Tipo | Uso |
|---|---|---|---|
| 793911 | Prazo CS (dias) | lista: 15, 25, 45, 60, Especial | Define a etapa "Em produção - N dias" |
| 793910 | Data Prometida | data | Prazo prometido ao cliente |
| 793915 | Endereço Entrega | texto longo | Endereço completo com referência, horário e responsável |
| 793914 | Responsável Comercial | texto | Pessoa de contato no cliente |
| 793912 | Briefing Ok | Sim/Não | Etapa 06 |
| 793913 | Link da Proposta | link | |

Atividade tipo `272217 Acolhimento CS` já existe.

Nenhum dos negócios lidos tem esses campos preenchidos (`customFields: []`). O Força de Vendas não os grava.

## 3. Funil Produção (40828): o "status do pedido" que dá para ler

| Ordem | ID | Etapa | Abertos |
|---|---|---|---|
| 0 | 227818 | PEDIDO IMPORTADO (aguardando pagamento) | 201 |
| 1 | 701570 | PEDIDOS B2B | |
| 2 | 276168 | AGUARDANDO ALTERAÇÕES | |
| 3 | 378333 | ARTE P/ SUBLIMAÇÃO | |
| 4 | 276169 | PEDIDO CONFIRMADO | |
| 5 | 227821 | CRIAÇÃO PEDIDO TERCEIRIZADO | |
| 6 | 276170 | ARTES FEITAS P/ SISTEMA | |
| 7 | 614424 | AGUARD. APROV. AMOSTRAS | |
| 8 | 276209 | FILA PCP | |
| 9 | 287825 | ARTE PARA ESTAMPARIA | |
| 10 | 378332 | ARTE P/ BORDADO | |
| 11 | 565805 | ARTE P/ DTF | |
| 12 | 607611 | FILA IMPRESSÃO DTF | |
| 13 | 607573 | FECHAMENTO SUBLIMAÇÃO | |
| 14 | 607574 | FILA DE IMPRESSÃO SUBLI | |
| 15 | 227822 | EM PRODUÇÃO | 44 |
| 16 | 525029 | ACOMP. - PRAZOS ESPECIAIS | |
| 17 | 550095 | COBRAR FICANDO PRONTO | |
| 18 | 550096 | PAGO FICANDO PRONTO | |
| 19 | 542375 | PEDIDOS PRONTOS | 1 |
| 20 | 227824 | COBRANÇA PGTO FINAL | |
| 21 | 512622 | INADIMPLENTES 2ª PARCELA | |
| 22 | 410921 | EXPEDIÇÃO | |
| 23 | 614169 | ENVIADO PARCIAL | |
| 24 | 410415 | PROCESSO ENTREGA | 85 |
| 25 | 227825 | PEDIDO ENTREGUE | 103 |
| 26 | 410416 | PÓS-VENDA (cobrança de feedback) | 27 |

Total aberto: 4.177 (muito histórico parado). O negócio do funil Produção e o do funil CS do mesmo pedido têm
o **mesmo título** (`497 - B2B - TBF ACADEMIA... - B2B-20261008-YLXSQC`, `7018 - CAMED CORRETORA DE SEGUROS`):
o número na frente é o número do pedido no Força de Vendas. É por ele que o Toninho casa os dois.

## 4. Funil Recompra (40829): para onde o cliente vai depois

Etapa 0 `271386 Entrou no processo de recompra` (90 dias de espera) e depois contatos mensais do 1º (45 dias)
ao 12º mês. A régua de recompra por WhatsApp já está desenhada em `tm-chatwoot/reguas-automacao.txt` (Régua 2:
só empresa, 45 dias e 12 meses após a **entrega**). Gatilho previsto lá: negócio chegou em PEDIDO ENTREGUE ou
PÓS-VENDA do funil Produção. O Toninho é quem vai produzir esse gatilho de forma confiável.

## 5. Chatwoot: o que o Toninho reaproveita

- Inbox 3 (WhatsApp T&M). Inbox 2 (Teste API) para testar sem WhatsApp.
- Time `pós-vendas` id 3 (auto-atribuição desligada). Agente Vinícius id 9. Gerente Marcelo id 11.
- Etiquetas: `pos-vendas` (12), `responder` (18, entra e sai sozinha), `opt-out` (13), `sem-followup` (14).
- Atributos de contato já existentes: `piperun_deal_id`, `piperun_link`, `vendedor`, `regua`, `regua_passo_em`,
  `tipo_cliente`, `segmento`, `empresa`, `nome`.
- Automações nativas: "Cliente falou com vendedor: etiqueta responder" e "Respondemos: tira a etiqueta".
- Macro "Passar pro pós-vendas" e resposta pronta `/pedido` ("Vou verificar o status do seu pedido! Me
  confirma o nome completo ou CNPJ..."): hoje a consulta de status é manual.
- Regra de ouro: `pending` = robô (Júlia), `open` = humano. Uma inbox só aceita um robô, e o da inbox 3 é a
  Júlia. Por isso o Toninho **não** será um "agent bot": será um **agente** (usuário) do Chatwoot com token
  próprio, e as conversas dele ficam `open` atribuídas a ele. A Júlia nunca age em `open`.

### Templates aprovados na Meta que servem ao pós-vendas (já existem)

| Nome | Categoria | Para quê |
|---|---|---|
| `tp_ganho__mensagem_quando_o_pedido__enviado_para_produo_567` | UTILITY, sem variável | "Seu pedido já foi confirmado e enviado para produção" |
| `tp_video_sua_jornada___inicio_da_produo_433` | UTILITY, {{1}} nome | "entrou oficialmente em produção" + vídeo |
| `tp_status_produo__pedido_em_produo_420` | MARKETING, {{1}} atendente {{2}} nome | Entrou em produção |
| `tp_status_produo__pedido_em_reviso_610` | MARKETING, {{1}} nome | Entrou no setor de qualidade |
| `tp_confirmando_pedido_pronto__cobrana__47` | UTILITY, {{1}} atendente {{2}} nome | Pronto + cobrança da parcela final |
| `tp_status_produo__pedido_coletado_671` | MARKETING, {{1}} nome {{2}} rastreio | Coletado pela transportadora |
| `tp_video_pedido_a_caminho__envio_do_pedido_813` | MARKETING, {{1}} nome | A caminho + vídeo de recebimento |
| `tp__contato__psentrega_628` | MARKETING, {{1}} nome | "O rastreio nos avisou que foi entregue", pede opinião |
| `tp__contato__psentrega_8` | MARKETING, {{1}} nome | Lembrete de feedback |
| `tp__contato__psentrega_822` | MARKETING, {{1}} nome | Encerramento do pós-venda |
| `tp_video_garantia__depois_do_recebimento_901` | MARKETING, {{1}} nome | Garantia após o recebimento |
| `tp_campanha_depoimento_do_cliente_836` | MARKETING, {{1}} nome | Convite para depoimento (voucher R$ 100) |
| `tp_contato_urgente_sobre_o_pedido_77` | UTILITY, {{1}} atendente {{2}} nome | Contato urgente |
| `tp_parada_tcnica__urgncia_pedido_512` | MARKETING, {{1}} nome | Produção pausada, precisa de confirmação |
| `atendimento_pedido_gerente` | UTILITY, {{nome_cliente}} | Marcelo (gerente) assume um problema |

Faltam templates **UTILITY** próprios do Toninho (acolhimento, status, pronto, entregue + NPS, lembrete de
NPS): lista em `03-pendencias-decisoes.md`. Até lá os marketing acima servem, a custo maior.

## 6. n8n: padrões que o Toninho copia

- 35 workflows, quase todos "Webhook/Schedule → nó Code" com `CONFIG` no topo, montados por scripts de build
  ("NÃO editar no n8n"), com `SIMULACAO`/`ATIVO`, `MAX_POR_CICLO`, dias úteis e feriados.
- Chatwoot de dentro do n8n: `http://rails:3000` com header `api_access_token`.
- Templates pela API do Chatwoot: `POST /conversations/{id}/messages` com
  `template_params: { name, category, language, processed_params: {'1': ..., '2': ...} }` (Régua 1 e Email Lead).
- IA: nó HTTP Request para `https://api.anthropic.com/v1/messages` com a credencial `Anthropic T&M`
  (id `bR8bB8RcI5EAEbQf`), `claude-haiku-4-5`, system em dois blocos (estático com cache + dinâmico), tool
  `responder` forçada (`tool_choice`). A base viva vem de `https://chat.temgrupo.com.br/base/*.txt`.
- Casamento Chatwoot ↔ PipeRun: atributo `piperun_deal_id` no contato; busca de contato pelos 8 últimos dígitos
  do telefone (`/contacts/search?q=`).
- Vigia do Atendimento (15 min) alerta conversa `open` com cliente esperando há 45 min: o Toninho responde em
  menos de 1 min, então não dispara; em escalada o Vinícius assume e o vigia passa a cobrá-lo normalmente.

## 7. Buracos encontrados (o que trava o "100% sem humano")

1. **Telefone do cliente nos pedidos B2B.** Os negócios que o Força de Vendas cria para pedidos da plataforma
   B2B vêm **sem pessoa** (`person_id: null`) e a empresa sem telefone. Dos 30 mais recentes em Acolhimento,
   22 são assim. Sem telefone não há WhatsApp. Os pedidos tirados pelos vendedores (`70xx - NOME`) vêm com
   pessoa, mas `contact_phones` vem vazio no negócio; o telefone está no contato do Chatwoot (atributo
   `piperun_deal_id` do negócio de **orçamento**, não do CS).
2. **Campos do CS vazios.** Prazo CS, Data Prometida e Endereço de Entrega não são preenchidos por ninguém
   automaticamente. O Toninho precisa deles para escolher a cadência e falar de prazo.
3. **Status real da produção está no Vexta**, sem API conhecida. O espelho no funil Produção depende de o time
   de pedidos mover a etapa. 201 pedidos em "PEDIDO IMPORTADO" e 103 em "PEDIDO ENTREGUE" mostram atraso de
   movimentação, não necessariamente atraso de produção.
4. **Código de rastreio** não existe em campo nenhum do PipeRun (só no Vexta/Correios).
5. **PipeRun não tem webhook configurado**: detecção de mudança de etapa é por leitura periódica (como já
   fazem Régua 1, Email Lead e Gerente IA).
6. **Janela de 24h fechada no acolhimento.** O cliente conversou com o vendedor dias antes do Pedido Aprovado; na
   hora do acolhimento a janela gratuita já fechou (simulado com o pedido 7014). Templates UTILITY são pré-requisito.
7. **Regra dura**: o Toninho precisa escrever no PipeRun (mover etapa do CS, nota, NPS) e isso exige aprovação
   explícita do Humberto (ver pendências).

# 04. Contrato do webhook de eventos do pedido

`POST https://n8n.temgrupo.com.br/webhook/toninho-pedido`
Header `x-toninho-segredo: <segredo>` (o mesmo valor em `CONFIG.SEGREDO` do workflow; definido na publicação).
Resposta: `200 {ok:true, recebido:<evento>}` ou `401/422 {ok:false, erros:[...]}`. Reenvio do mesmo
`evento_id` é ignorado (idempotente).

Quem chama: o **Força de Vendas** (Pedido Aprovado, dados do cliente, alterações) e, na fase 3, o **Vexta**
(ordem de produção, NF, expedição, entrega). Nenhum campo além de `evento`, `evento_id` e `pedido.numero` é
obrigatório; o Toninho usa o que vier.

```json
{
  "versao": 1,
  "evento": "pedido_aprovado | dados_cliente | prazo_definido | em_producao | pronto | nf_emitida | coletado | entregue | problema",
  "evento_id": "fv-2026-10-08-000497-aprovado",
  "ocorrido_em": "2026-10-08T14:56:19-03:00",
  "pedido": {
    "numero": 497,
    "codigo": "B2B-20261008-YLXSQC",
    "piperun_deal_cs_id": 64861908,
    "piperun_deal_producao_id": 64861906,
    "valor": 439.6,
    "itens": [{ "descricao": "Camiseta algodão personalizada", "quantidade": 40 }],
    "prazo_dias": 45,
    "data_prometida": "2026-11-22",
    "endereco_entrega": "Rua ..., Brusque/SC. Receber: Daniela, 8h-17h"
  },
  "cliente": {
    "nome": "Daniela Pereira",
    "empresa": "TBF ACADEMIA DE FUTEBOL LTDA",
    "cnpj": "53.564.992/0001-46",
    "telefone": "+5547999990000",
    "email": "daniela@exemplo.com",
    "tipo": "empresa | escola | terceirao | faculdade | evento | pessoa_fisica | wizard",
    "vendedor_email": "iracema.fialho@temgrupo.com.br"
  },
  "producao": {
    "status": "fila | em_producao | revisao | pronto | expedicao | a_caminho | entregue",
    "previsao": "2026-11-20",
    "nf_numero": "12345",
    "rastreio": "AA123456789BR",
    "transportadora": "Correios"
  },
  "problema": { "tipo": "atraso | falta_material | arte | pagamento", "descricao": "..." }
}
```

O que o Toninho faz com cada evento:

| Evento | Ação |
|---|---|
| `pedido_aprovado` / `dados_cliente` | Acha ou cria o contato no Chatwoot pelo telefone, grava `toninho_cs_deal_id`, `toninho_pedido`, tipo e vendedor; se o negócio do CS está em Acolhimento, dispara o acolhimento sem esperar o ciclo. |
| `prazo_definido` | Grava `Prazo CS` e `Data Prometida` no negócio (pendência 1) e escolhe a etapa de cadência. |
| `em_producao` / `pronto` / `coletado` / `entregue` | Nota no negócio do CS e toque imediato correspondente (com rastreio quando vier). `entregue` abre a coleta de NPS. |
| `nf_emitida` | Guarda no contato (`nf_numero`) para o Toninho responder "a nota fiscal já foi emitida" sem escalar. |
| `problema` | Não fala com o cliente: nota privada na conversa, atribui ao Vinícius, etiqueta `responder`. Humano decide o que dizer. |

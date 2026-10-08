// Nó "Receber evento" do workflow "Toninho - Eventos do Pedido" (montado por n8n/build.js; NÃO editar no n8n).
// Contrato: docs/04-contrato-eventos-pedido.md. Quem chama: Força de Vendas (hoje) e Vexta (fase 3).
// Confere o segredo, valida o mínimo, ignora evento repetido, grava o que veio no contato do Chatwoot e no negócio do CS, e
// pede à Régua que olhe esse negócio agora (POST interno /webhook/toninho-regua-teste {so_deal, oficial:true}).
// `problema` nunca fala com o cliente: nota privada + Vinícius + etiqueta responder.
const CONFIG = __CONFIG__;
__COMUM__
const req = $json || {};
const headers = req.headers || {};
const b = req.body || {};
const responder = (status, resposta) => [{ json: { status, resposta } }];
if (!CONFIG.SEGREDO || String(headers['x-toninho-segredo'] || '') !== String(CONFIG.SEGREDO)) return responder(401, { ok: false, erros: ['segredo inválido'] });
const erros = [];
const EVENTOS = ['pedido_aprovado', 'dados_cliente', 'prazo_definido', 'em_producao', 'pronto', 'nf_emitida', 'coletado', 'entregue', 'problema'];
if (!EVENTOS.includes(String(b.evento))) erros.push('evento inválido: ' + b.evento);
if (!b.evento_id) erros.push('evento_id obrigatório');
const pedido = b.pedido || {}, cliente = b.cliente || {}, producao = b.producao || {};
if (!pedido.numero && !pedido.piperun_deal_cs_id) erros.push('pedido.numero ou pedido.piperun_deal_cs_id obrigatório');
if (erros.length) return responder(422, { ok: false, erros });
const st = $getWorkflowStaticData('global'); st.eventos = st.eventos || {};
if (st.eventos[b.evento_id]) return responder(200, { ok: true, recebido: b.evento, repetido: true });
const H = { api_access_token: CONFIG.ADMIN_TOKEN }, HP = { token: CONFIG.PIPERUN_TOKEN };
const cw = async (m, p, body) => this.helpers.httpRequest({ method: m, url: `${CONFIG.CW}/api/v1/accounts/${CONFIG.ACC}` + p, headers: H, body, json: true, timeout: 15000 });
const pr = async (m, p, body) => this.helpers.httpRequest({ method: m, url: CONFIG.PIPERUN + p, headers: HP, body, json: true, timeout: 20000 });
const escritas = []; const dry = CONFIG.SIMULACAO;
const escrever = async (d, fn) => { escritas.push(d); if (dry) return { simulado: true }; try { return await fn(); } catch (x) { escritas.push('ERRO: ' + String(x.message).slice(0, 160)); return null; } };
// negócio do CS
let deal = null;
try {
  if (pedido.piperun_deal_cs_id) deal = (await pr('GET', `/deals/${pedido.piperun_deal_cs_id}`)).data;
  else { const r = await pr('GET', `/deals?pipeline_id=${TN.PIPELINE_CS}&title=${pedido.numero}&show=10`); deal = (r.data || []).find(x => TN.numeroDoPedido(x.title) === Number(pedido.numero)) || null; }
} catch (x) {}
const numero = Number(pedido.numero) || (deal ? TN.numeroDoPedido(deal.title) : null);
// contato
let contato = null;
const fone = TN.foneBR(cliente.telefone);
if (deal) { try { const r = await cw('POST', '/contacts/filter', { payload: [{ attribute_key: 'toninho_cs_deal_id', filter_operator: 'equal_to', values: [String(deal.id)], attribute_model: 'custom_attributes', query_operator: null }] }); contato = (r.payload || [])[0] || null; } catch (x) {} }
if (!contato && fone) { try { const r = await cw('GET', '/contacts/search?q=' + TN.oitoFinais(fone)); contato = ((r && r.payload) || []).find(c => TN.soDigitos(c.phone_number).endsWith(fone.slice(-10))) || null; } catch (x) {} }
if (!contato && fone) {
  const r = await escrever(`criar contato ${cliente.nome || cliente.empresa || 'Cliente'} +${fone}`, () => cw('POST', '/contacts', { name: cliente.nome || cliente.empresa || 'Cliente', phone_number: '+' + fone, email: cliente.email || undefined }));
  contato = (r && r.payload && (r.payload.contact || r.payload)) || null;
}
const novos = {};
if (deal) { novos.toninho_cs_deal_id = String(deal.id); }
if (numero) novos.toninho_pedido = String(numero);
if (cliente.nome) novos.nome = cliente.nome;
if (cliente.empresa) novos.empresa = cliente.empresa;
if (cliente.tipo) novos.tipo_cliente = cliente.tipo;
if (cliente.vendedor_email) novos.vendedor = cliente.vendedor_email.split('@')[0];
if (producao.nf_numero) novos.nf_numero = String(producao.nf_numero);
if (producao.rastreio) novos.rastreio = String(producao.rastreio);
if (pedido.data_prometida) novos.data_prometida = String(pedido.data_prometida);
if (contato && Object.keys(novos).length) await escrever(`atributos do contato ${contato.id}: ${JSON.stringify(novos)}`, () => cw('PUT', `/contacts/${contato.id}`, { custom_attributes: Object.assign({}, contato.custom_attributes || {}, novos) }));
// negócio: campos de prazo e nota
if (deal) {
  const campos = [];
  if (pedido.prazo_dias) campos.push({ id: TN.CAMPO.PRAZO_CS, value: [15, 25, 45, 60].includes(Number(pedido.prazo_dias)) ? String(pedido.prazo_dias) : 'Especial' });
  if (pedido.data_prometida) campos.push({ id: TN.CAMPO.DATA_PROMETIDA, value: pedido.data_prometida });
  if (pedido.endereco_entrega) campos.push({ id: TN.CAMPO.ENDERECO_ENTREGA, value: pedido.endereco_entrega });
  if (campos.length) { if (!CONFIG.ESCREVER_PIPERUN) escritas.push(`[PipeRun bloqueado, pendência 1] campos do negócio ${deal.id}: ${JSON.stringify(campos)}`); else await escrever(`campos do negócio ${deal.id}`, () => pr('PUT', `/deals/${deal.id}`, { custom_fields: campos })); }
  const nota = `evento ${b.evento} (${b.evento_id})` + (producao.status ? ` | produção: ${producao.status}` : '') + (producao.rastreio ? ` | rastreio ${producao.rastreio}` : '') + (producao.nf_numero ? ` | NF ${producao.nf_numero}` : '') + (b.problema ? ` | PROBLEMA ${b.problema.tipo}: ${String(b.problema.descricao || '').slice(0, 200)}` : '');
  if (!CONFIG.ESCREVER_PIPERUN) escritas.push(`[PipeRun bloqueado, pendência 1] nota no negócio ${deal.id}: ${nota}`); else await escrever(`nota no negócio ${deal.id}: ${nota}`, () => pr('POST', '/notes', { deal_id: deal.id, text: 'TONINHO (evento): ' + nota }));
}
// problema: humano decide
if (b.evento === 'problema' && contato) {
  try {
    const r = await cw('GET', `/contacts/${contato.id}/conversations`);
    const conv = ((r && r.payload) || []).find(c => Number(c.inbox_id) === CONFIG.INBOX);
    if (conv) {
      await escrever(`conversa ${conv.id}: nota privada do problema, responsável Vinícius, etiqueta responder`, async () => {
        await cw('POST', `/conversations/${conv.id}/messages`, { content: `⚠️ PROBLEMA NO PEDIDO ${numero || ''} (${b.problema.tipo}): ${b.problema.descricao || ''}\nO Toninho NÃO falou com o cliente. Decida o que dizer e, quando resolver, devolva a conversa ao Toninho.`, message_type: 'outgoing', private: true });
        await cw('POST', `/conversations/${conv.id}/assignments`, { assignee_id: CONFIG.VINICIUS_AGENT_ID });
        await cw('POST', `/conversations/${conv.id}/labels`, { labels: Array.from(new Set([...(conv.labels || []), 'responder'])) });
      });
      if (contato) await escrever(`atributo toninho_regua=escalado no contato ${contato.id}`, () => cw('PUT', `/contacts/${contato.id}`, { custom_attributes: Object.assign({}, contato.custom_attributes || {}, novos, { toninho_regua: 'escalado', toninho_escalada_motivo: 'problema: ' + b.problema.tipo }) }));
    }
  } catch (x) {}
} else if (deal && CONFIG.ACORDAR_REGUA) {
  // pede à Régua que olhe este negócio agora (ela respeita SIMULACAO e janela)
  await escrever(`acordar a Régua para o negócio ${deal.id}`, () => this.helpers.httpRequest({ method: 'POST', url: CONFIG.REGUA_URL, body: { so_deal: deal.id, oficial: true }, json: true, timeout: 60000 }));
}
st.eventos[b.evento_id] = Date.now();
return responder(200, { ok: true, recebido: b.evento, pedido: numero, deal_cs: deal ? deal.id : null, contato: contato ? contato.id : null, simulacao: dry, escritas });

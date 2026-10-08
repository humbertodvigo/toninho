// Nós do workflow "Toninho - Conversa" (montado por n8n/build.js a partir de n8n/src/conversa.node.js; NÃO editar no n8n).
// Webhook de conta do Chatwoot (message_created) -> Filtro -> Esperar 10 s -> Contexto -> IA (Anthropic) -> Executar.
// Só entra conversa de contato que o Toninho acompanha (atributo toninho_cs_deal_id) e que esteja com o Toninho ou sem
// responsável. Guardas duras (opt-out, humano, reclamação, alteração, NPS) são código, não prompt (TN.guardas / TN.notaNps).
// SIMULACAO: lê tudo, chama a IA, e devolve o que faria sem enviar nem gravar.

// ===== NÓ: Filtro =====
const CONFIG = __CONFIG__;
__COMUM__
const b = ($json && $json.body) || $json || {};
if (b.event !== 'message_created') return [];
if (!(b.message_type === 'incoming' || Number(b.message_type) === 0)) return [];
if (b.private === true || b.private === 'true') return [];
const conv = b.conversation || {};
const inbox = Number(b.inbox_id || conv.inbox_id);
if (!CONFIG.INBOXES.includes(inbox)) return [];
const contactId = (conv.meta && conv.meta.sender && conv.meta.sender.id) || (b.sender && b.sender.id);
const convId = conv.id || conv.display_id;
if (!contactId || !convId) return [];
const H = { api_access_token: CONFIG.ADMIN_TOKEN };
let contato;
try { const c = await this.helpers.httpRequest({ method: 'GET', url: `${CONFIG.CW}/api/v1/accounts/${CONFIG.ACC}/contacts/${contactId}`, headers: H, json: true }); contato = c.payload || c; } catch (e) { return []; }
const attrs = contato.custom_attributes || {};
if (!attrs.toninho_cs_deal_id) return [];
const regua = String(attrs.toninho_regua || '');
if (regua === 'optout') return [];
const labels = conv.labels || [];
if (labels.some(l => CONFIG.ETIQUETAS_BLOQUEIO.includes(l))) return [];
const ass = conv.meta && conv.meta.assignee;
if (ass && Number(ass.id) !== Number(CONFIG.TONINHO_AGENT_ID)) return []; // humano é dono: Toninho cala
if (regua === 'escalado' && ass) return [];
return [{ json: { conversation_id: convId, contact_id: contactId, inbox_id: inbox, message_id: b.id, content: String(b.content || ''), attachments: (b.attachments || []).length, attrs, nome_contato: contato.name, phone: contato.phone_number, labels, status: conv.status } }];

// ===== NÓ: Contexto =====
const CONFIG = __CONFIG__;
__COMUM__
const e = $('Filtro').first().json;
const H = { api_access_token: CONFIG.ADMIN_TOKEN };
const HT = { api_access_token: CONFIG.TONINHO_TOKEN || CONFIG.ADMIN_TOKEN };
const HP = { token: CONFIG.PIPERUN_TOKEN };
const cw = async (m, p, body, h) => this.helpers.httpRequest({ method: m, url: `${CONFIG.CW}/api/v1/accounts/${CONFIG.ACC}` + p, headers: h || H, body, json: true, timeout: 15000 });
const pr = async (p) => this.helpers.httpRequest({ method: 'GET', url: CONFIG.PIPERUN + p, headers: HP, json: true, timeout: 20000 });
// rajada: só segue se esta ainda é a última mensagem do cliente
const ms = await cw('GET', `/conversations/${e.conversation_id}/messages`);
const pub = ((ms && ms.payload) || []).filter(m => !m.private && (m.message_type === 0 || m.message_type === 1 || m.message_type === 3) && (m.content || (m.attachments && m.attachments.length))).sort((a, c) => (a.id || 0) - (c.id || 0));
const ultIn = pub.filter(m => m.message_type === 0).slice(-1)[0];
if (!ultIn || Number(ultIn.id) !== Number(e.message_id)) return [];
try { await cw('POST', `/conversations/${e.conversation_id}/toggle_typing_status`, { typing_status: 'on' }, HT); } catch (x) {}
// dados do pedido
let deal = null, prod = { status: TN.statusProducao(null), deal: null };
try { deal = (await pr(`/deals/${e.attrs.toninho_cs_deal_id}?with=company,person,customFields`)).data; } catch (x) {}
const numero = deal ? TN.numeroDoPedido(deal.title) : Number(e.attrs.toninho_pedido) || null;
if (numero) { try { const r = await pr(`/deals?pipeline_id=${TN.PIPELINE_PRODUCAO}&title=${numero}&show=10`); const d = (r.data || []).find(x => TN.numeroDoPedido(x.title) === numero) || null; prod = { status: TN.statusProducao(d ? d.stage_id : null), deal: d }; } catch (x) {} }
const campo = (id) => { for (const f of ((deal && (deal.customFields || deal.custom_fields)) || [])) { const fid = Number(f.id || (f.pivot && f.pivot.custom_field_id)); if (fid === id) { const v = f.value !== undefined ? f.value : (f.pivot && f.pivot.value); return Array.isArray(v) ? v[0] : v; } } return null; };
const agora = Date.now();
const exp = TN.expediente(agora);
const tipo = String(e.attrs.tipo_cliente || '').toLowerCase();
const dataPrometida = campo(TN.CAMPO.DATA_PROMETIDA);
const atrasado = dataPrometida && String(dataPrometida) < TN.local(agora).ymd && prod.status.ordem < 6;
const dados = [
  'DADOS DO PEDIDO (fonte: PipeRun; o que não está aqui não existe):',
  `- Hoje: ${TN.local(agora).ymd} ${TN.pad(TN.local(agora).h)}h${TN.pad(TN.local(agora).mi)} (${exp.dentro ? 'horário comercial' : 'FORA do horário comercial: ' + exp.motivo})`,
  `- Cliente: ${e.attrs.nome || String(e.nome_contato || '').replace(/\s*[-–]\s*\d{2,7}(\/\d{2,7})?\s*$/, '') || '(sem nome)'}${e.attrs.empresa || (deal && deal.company && deal.company.name) ? ' | empresa: ' + (e.attrs.empresa || deal.company.name) : ''} | tipo: ${tipo || 'não informado (use o registro profissional)'}${e.attrs.vendedor ? ' | vendedor da conta: ' + e.attrs.vendedor : ''}`,
  `- Pedido: ${numero || '(número não identificado)'}${deal ? ' | ' + TN.resumoDoPedido(deal.title) : ''}${deal && deal.value ? ' | valor R$ ' + Number(deal.value).toFixed(2).replace('.', ',') : ''}`,
  `- Etapa do acompanhamento: ${deal ? (TN.NOME_ETAPA[deal.stage_id] || deal.stage_id) : 'desconhecida'}${deal ? ' há ' + TN.diasDesde(deal.last_stage_updated_at || deal.updated_at, agora) + ' dias' : ''} | régua: ${e.attrs.toninho_regua || '-'} | toques: ${e.attrs.toninho_toques || 'nenhum'}`,
  `- STATUS DA PRODUÇÃO: ${prod.status.chave} ("${prod.status.texto}")${prod.status.financeiro ? ' | pendência financeira (não cobre, só diga que o financeiro alinha)' : ''}${prod.deal ? '' : ' | negócio de Produção não encontrado'}`,
  `- Prazo combinado: ${(() => { const p = campo(TN.CAMPO.PRAZO_CS) || String(e.attrs.toninho_regua || '').replace(/^producao:/, '').replace(/^(pronto|nps|encerrado|escalado|optout|acolhimento)$/, ''); return p ? p + ' dias' : 'não informado'; })()}${dataPrometida ? ' | data prometida: ' + dataPrometida : ''}${atrasado ? ' | ATENÇÃO: data prometida já passou e o pedido não está pronto: trate como possível atraso e ESCALE' : ''}`,
  `- Data limite dita pelo cliente: ${e.attrs.prazo_cliente || 'não informada'}`,
  `- NF: ${e.attrs.nf_numero || 'sem dado'} | rastreio: ${e.attrs.rastreio || 'sem dado'} | entrega confirmada: ${e.attrs.entregue_em || 'não'} | NPS: ${e.attrs.nps_nota !== undefined && e.attrs.nps_nota !== '' ? e.attrs.nps_nota : 'não coletado'}`,
].join('\n');
// base viva
let base = '';
try { base = await this.helpers.httpRequest({ method: 'GET', url: CONFIG.BASE_URL, json: false, timeout: 10000 }); } catch (x) {}
if (!base || String(base).length < 500) base = CONFIG.BASE_FALLBACK;
// histórico (últimas 20, alternando papéis)
const ultimas = pub.slice(-20).map(m => ({ role: m.message_type === 0 ? 'user' : 'assistant', content: String(m.content || (m.attachments && m.attachments.length ? '[cliente enviou um anexo]' : '(vazio)')).replace(/\n\n\*Toninho \(IA\)\*$/, '') }));
const merged = [];
for (const m of ultimas) { const l = merged[merged.length - 1]; if (l && l.role === m.role) l.content += '\n' + m.content; else merged.push({ ...m }); }
while (merged.length && merged[0].role !== 'user') merged.shift();
if (!merged.length || merged[merged.length - 1].role !== 'user') merged.push({ role: 'user', content: e.content || '(mensagem sem texto)' });
const turnosToninho = pub.filter(m => m.message_type === 1 && m.sender && Number(m.sender.id) === Number(CONFIG.TONINHO_AGENT_ID)).length;
const tools = [{
  name: 'responder', description: 'Resposta ao cliente e decisão do Toninho.',
  input_schema: { type: 'object', properties: {
    resposta: { type: 'string', description: 'Texto exato para o cliente, um balão. Sem colchetes, sem travessão.' },
    decisao: { type: 'string', enum: ['continuar', 'prazo_cliente', 'feedback', 'nps', 'entregue', 'escalar', 'optout', 'encerrar'] },
    prazo_cliente: { type: 'string', description: 'AAAA-MM-DD quando o cliente disse até quando precisa receber' },
    nps_nota: { type: 'integer', minimum: 0, maximum: 10 },
    feedback: { type: 'string', description: 'Resumo do que o cliente achou (quando houver)' },
    motivo_escalada: { type: 'string', description: 'Uma linha para o Vinícius (quando decisao=escalar)' },
  }, required: ['resposta', 'decisao'] },
}];
return [{ json: {
  ...e, numero, deal_cs: deal ? { id: deal.id, stage_id: deal.stage_id, company_id: deal.company_id, title: deal.title } : null, producao: prod.status, producao_deal_id: prod.deal ? prod.deal.id : null,
  guarda: TN.guardas(e.content), nota_lida: TN.notaNps(e.content), turnos_toninho: turnosToninho, dentro_expediente: exp.dentro, tipo,
  system_estatico: base, system_dinamico: dados, messages: merged, tools, modelo: CONFIG.MODELO, max_tokens: CONFIG.MAX_TOKENS,
} }];

// ===== NÓ: Executar =====
const CONFIG = __CONFIG__;
__COMUM__
const ctx = $('Contexto').first().json;
const ia = $json;
const dry = CONFIG.SIMULACAO;
const H = { api_access_token: CONFIG.ADMIN_TOKEN };
const HT = { api_access_token: CONFIG.TONINHO_TOKEN || CONFIG.ADMIN_TOKEN };
const HP = { token: CONFIG.PIPERUN_TOKEN };
const escritas = [];
const cw = async (m, p, body, h) => this.helpers.httpRequest({ method: m, url: `${CONFIG.CW}/api/v1/accounts/${CONFIG.ACC}` + p, headers: h || H, body, json: true, timeout: 15000 });
const prTry = async (m, p, body) => { try { const r = await this.helpers.httpRequest({ method: m, url: CONFIG.PIPERUN + p, headers: HP, body, json: true, timeout: 20000, returnFullResponse: true, ignoreHttpStatusErrors: true }); const code = Number(r.statusCode || 200); return { ok: code < 300, status: code, body: r.body }; } catch (x) { return { ok: false, status: 0, body: String(x.message).slice(0, 200) }; } };
const escrever = async (d, fn) => { escritas.push(d); if (dry) return { simulado: true }; return fn(); };
const convId = ctx.conversation_id;
// 1. ler a tool
let out = {};
try { const tu = ((ia.content) || []).find(c => c.type === 'tool_use'); out = (tu && tu.input) || {}; } catch (x) {}
if (!out.decisao) out = { resposta: '', decisao: 'escalar', motivo_escalada: 'a IA não devolveu decisão' };
let decisao = String(out.decisao);
let resposta = String(out.resposta || '').replace(/—/g, ',').replace(/\[[^\]]*\]/g, '').trim();
const motivos = [];
// 2. guardas (código vence prompt)
if (ctx.guarda === 'optout') { decisao = 'optout'; motivos.push('guarda: termos de opt-out'); if (!resposta) resposta = 'Tranquilo, não te mando mais nada por aqui. Qualquer coisa do pedido é só chamar.'; }
else if (ctx.guarda === 'escalar' && !['escalar', 'optout'].includes(decisao)) { decisao = 'escalar'; motivos.push('guarda: termos de humano/reclamação/alteração'); out.motivo_escalada = out.motivo_escalada || 'cliente pediu humano, reclamou ou pediu alteração: ' + ctx.content.slice(0, 120); }
if (decisao === 'nps') {
  const n = Number.isInteger(out.nps_nota) && out.nps_nota >= 0 && out.nps_nota <= 10 ? out.nps_nota : ctx.nota_lida;
  if (n === null || n === undefined) { decisao = 'feedback'; motivos.push('nps sem nota válida: vira feedback'); } else out.nps_nota = n;
}
if (decisao === 'continuar' && ctx.turnos_toninho >= CONFIG.MAX_TURNOS) { decisao = 'escalar'; out.motivo_escalada = 'assunto não resolvido em ' + ctx.turnos_toninho + ' respostas'; motivos.push('guarda: máximo de turnos'); }
if (decisao === 'escalar' && !resposta) resposta = TN.informal(ctx.tipo) ? 'Entendi! Vou chamar o Vinícius, do pós-vendas, que resolve isso contigo por aqui ' + (ctx.dentro_expediente ? 'ainda hoje.' : 'no próximo horário de atendimento, a partir das 8h.') : 'Entendi. Vou passar isso para o Vinícius, do nosso pós-vendas, que assume por aqui e te retorna ' + (ctx.dentro_expediente ? 'ainda hoje.' : 'no próximo horário de atendimento, a partir das 8h.') + ' Já deixei o resumo com ele.';
// 3. responder
try { await cw('POST', `/conversations/${convId}/toggle_typing_status`, { typing_status: 'off' }, HT); } catch (x) {}
if (resposta) await escrever(`resposta -> conversa ${convId}: ${resposta}`, () => cw('POST', `/conversations/${convId}/messages`, { content: CONFIG.ASSINATURA ? resposta + '\n\n' + CONFIG.ASSINATURA : resposta, message_type: 'outgoing', private: false }, HT));
// 4. ações
const attrs = Object.assign({}, ctx.attrs);
const novos = {};
const agoraIso = new Date().toISOString();
const dealId = ctx.deal_cs && ctx.deal_cs.id;
const notaPipe = async (t) => { if (!dealId) return; if (!CONFIG.ESCREVER_PIPERUN) { escritas.push(`[PipeRun bloqueado, pendência 1] nota no negócio ${dealId}: ${t}`); return; } await escrever(`nota no negócio ${dealId}: ${t}`, () => prTry('POST', '/notes', { deal_id: dealId, text: 'TONINHO: ' + t })); };
const moverPipe = async (etapa) => { if (!dealId || !etapa || Number(ctx.deal_cs.stage_id) === etapa) return; if (!CONFIG.ESCREVER_PIPERUN) { escritas.push(`[PipeRun bloqueado, pendência 1] mover negócio ${dealId} para ${TN.NOME_ETAPA[etapa]}`); return; } await escrever(`mover negócio ${dealId} -> ${TN.NOME_ETAPA[etapa]}`, () => prTry('PUT', `/deals/${dealId}`, { stage_id: etapa })); };
const notaPrivada = async (t) => escrever(`nota privada na conversa ${convId}: ${t}`, () => cw('POST', `/conversations/${convId}/messages`, { content: t, message_type: 'outgoing', private: true }));
const etiquetar = async (novas) => { const labels = Array.from(new Set([...(ctx.labels || []), ...novas])); await escrever(`etiquetas da conversa ${convId}: ${labels.join(',')}`, () => cw('POST', `/conversations/${convId}/labels`, { labels })); };
const escalarPara = async (agenteId, motivo) => {
  novos.toninho_regua = 'escalado'; novos.toninho_escalada_em = agoraIso; novos.toninho_escalada_motivo = String(motivo).slice(0, 200);
  await escrever(`conversa ${convId}: responsável ${agenteId}, etiqueta responder`, async () => { await cw('POST', `/conversations/${convId}/assignments`, { assignee_id: agenteId }); await cw('POST', `/conversations/${convId}/assignments`, { team_id: CONFIG.TEAM_POSVENDAS }); });
  await etiquetar(['responder']);
  await notaPrivada(`⚠️ TONINHO ESCALOU: ${motivo}\nPedido ${ctx.numero || '?'} | produção: ${ctx.producao.chave} | etapa CS: ${ctx.deal_cs ? TN.NOME_ETAPA[ctx.deal_cs.stage_id] : '?'}\nÚltima mensagem do cliente: "${ctx.content.slice(0, 300)}"\nQuando resolver, devolva a conversa ao Toninho (responsável "Toninho (IA)") para a régua continuar.`);
  await notaPipe(`escalado ao humano: ${motivo}`);
};
switch (decisao) {
  case 'prazo_cliente': {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(out.prazo_cliente || ''))) { novos.prazo_cliente = out.prazo_cliente; await notaPipe(`cliente informou data limite ${out.prazo_cliente}.`); }
    break; }
  case 'feedback': { if (out.feedback) { novos.feedback_texto = String(out.feedback).slice(0, 500); await notaPipe(`feedback do cliente: ${String(out.feedback).slice(0, 300)}`); } break; }
  case 'entregue': { novos.entregue_em = agoraIso; await notaPipe('cliente confirmou a entrega.'); await moverPipe(TN.ETAPA.FEEDBACK); break; }
  case 'nps': {
    const n = out.nps_nota, classe = TN.classeNps(n);
    Object.assign(novos, { nps_nota: n, nps_comentario: String(out.feedback || ctx.content).slice(0, 500), nps_em: agoraIso, toninho_regua: 'nps' });
    if (!attrs.entregue_em) novos.entregue_em = agoraIso;
    await etiquetar(['nps-' + classe]);
    await notaPipe(`NPS ${n} (${classe})${out.feedback ? ': ' + String(out.feedback).slice(0, 300) : ''}`);
    await moverPipe(TN.ETAPA.FEEDBACK);
    if (ctx.deal_cs && ctx.deal_cs.company_id) { if (!CONFIG.ESCREVER_PIPERUN) escritas.push(`[PipeRun bloqueado, pendência 1] nps_score=${n} na empresa ${ctx.deal_cs.company_id}`); else await escrever(`nps_score=${n} na empresa ${ctx.deal_cs.company_id}`, () => prTry('PUT', `/companies/${ctx.deal_cs.company_id}`, { nps_score: n })); }
    if (classe === 'detrator') { await escalarPara(CONFIG.VINICIUS_AGENT_ID, `NPS detrator (${n}). Marcelo deve ser avisado (pendência 9).`); await notaPrivada(`@Marcelo NPS ${n} no pedido ${ctx.numero || '?'}: cliente insatisfeito, Vinícius assumiu.`); }
    break; }
  case 'escalar': { const recompra = /recompra|novo pedido|outro pedido/i.test(String(out.motivo_escalada || '')); await escalarPara(recompra && CONFIG.ESCALAR_RECOMPRA_PARA_VENDEDOR ? CONFIG.VINICIUS_AGENT_ID : CONFIG.VINICIUS_AGENT_ID, out.motivo_escalada || 'sem motivo informado'); break; }
  case 'optout': { novos.toninho_regua = 'optout'; await etiquetar(['opt-out']); await notaPipe('cliente pediu para não receber mais mensagens (opt-out). Acompanhamento manual.'); await notaPrivada('🚫 Opt-out registrado pelo Toninho. Nenhuma régua toca mais neste contato.'); break; }
  case 'encerrar': { novos.toninho_regua = 'encerrado'; novos.toninho_toques = TN.marcarToque(attrs, 'encerrar'); await notaPipe('acompanhamento encerrado na conversa.'); if (CONFIG.RESOLVER_AO_ENCERRAR) await escrever(`resolver conversa ${convId}`, () => cw('POST', `/conversations/${convId}/toggle_status`, { status: 'resolved' })); break; }
  default: break;
}
if (Object.keys(novos).length) await escrever(`atributos do contato ${ctx.contact_id}: ${JSON.stringify(novos)}`, () => cw('PUT', `/contacts/${ctx.contact_id}`, { custom_attributes: Object.assign(attrs, novos) }));
return [{ json: { ok: true, simulacao: dry, decisao, decisao_ia: out.decisao, motivos, resposta, escritas, uso: ia.usage || null } }];

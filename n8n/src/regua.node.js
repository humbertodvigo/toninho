// Nó "Régua" do workflow "Toninho - Régua" (montado por n8n/build.js a partir de n8n/src/regua.node.js; NÃO editar no n8n).
// A cada 30 min (seg-sex, 8h-18h SP) lê o funil Customer Success do PipeRun e, para cada negócio aberto, decide UM passo:
// acolher, toque de produção, avisar pronto, confirmar entrega + NPS, lembrar NPS ou encerrar. A decisão é a função pura
// TN.decidir (n8n/src/comum.js, testada em n8n/test). Aqui só mora a rede: Chatwoot, PipeRun e o relatório.
// SIMULACAO (CONFIG.SIMULACAO=true, padrão): as LEITURAS são de verdade e NENHUMA escrita sai (nem mensagem, nem atributo,
// nem etapa, nem nota). O que seria escrito volta na saída do nó, em `escritas`.
// ESCREVER_PIPERUN=false (pendência 1): mesmo fora da simulação, nada é escrito no PipeRun até o Humberto autorizar.
// Webhook de teste (POST /webhook/toninho-regua-teste): {"teste":true} ignora horário; {"so_deal":ID} só um negócio;
// {"dry":false} grava de verdade (só com SIMULACAO=false no CONFIG ou "forcar":true); {"oficial":true} roda como o agendamento.
const CONFIG = __CONFIG__;
__COMUM__
const body = ($json && $json.body) || {};
const teste = !!body.teste || !!body.so_deal;
const soDeal = Number(body.so_deal) || 0;
const dry = CONFIG.SIMULACAO ? body.forcar !== true : (teste ? body.dry !== false : false);
const agora = Date.now();
const H = { api_access_token: CONFIG.ADMIN_TOKEN };
const HT = { api_access_token: CONFIG.TONINHO_TOKEN || CONFIG.ADMIN_TOKEN };
const HP = { token: CONFIG.PIPERUN_TOKEN };
const relatorio = { ciclo: new Date(agora).toISOString(), simulacao: dry, escreverPipeRun: CONFIG.ESCREVER_PIPERUN && !dry, acoes: [], pulados: [], erros: [], escritas: [] };
const st = $getWorkflowStaticData('global');
st.semTelefone = st.semTelefone || {}; st.contatoPorDeal = st.contatoPorDeal || {};

if (!teste && !body.oficial) {
  const exp = TN.expediente(agora);
  if (!exp.dentro) return [{ json: { ok: true, motivo: exp.motivo + ': nada sai' } }];
}

// ---------- rede ----------
const cw = async (m, p, b, h) => this.helpers.httpRequest({ method: m, url: `${CONFIG.CW}/api/v1/accounts/${CONFIG.ACC}` + p, headers: h || H, body: b, json: true, timeout: 15000 });
const pr = async (m, p, b) => this.helpers.httpRequest({ method: m, url: CONFIG.PIPERUN + p, headers: HP, body: b, json: true, timeout: 20000 });
const prTry = async (m, p, b) => {
  try {
    const r = await this.helpers.httpRequest({ method: m, url: CONFIG.PIPERUN + p, headers: HP, body: b, json: true, timeout: 20000, returnFullResponse: true, ignoreHttpStatusErrors: true });
    const code = Number((r && (r.statusCode || r.status)) || 200);
    return { ok: code >= 200 && code < 300, status: code, body: r && r.body !== undefined ? r.body : r };
  } catch (e) { return { ok: false, status: 0, body: String(e && e.message).slice(0, 200) }; }
};
// escrita com simulação: registra e só executa fora do dry
const escrever = async (descricao, fn) => {
  relatorio.escritas.push(descricao);
  if (dry) return { simulado: true };
  return fn();
};
const campo = (deal, id) => {
  for (const f of (deal.customFields || deal.custom_fields || [])) {
    const fid = Number(f.id || (f.pivot && f.pivot.custom_field_id));
    if (fid === id) { const v = f.value !== undefined ? f.value : (f.pivot && f.pivot.value); return Array.isArray(v) ? v[0] : v; }
  }
  return null;
};

// ---------- 1. negócios do CS ----------
let deals = [];
try {
  if (soDeal) {
    deals = [(await pr('GET', `/deals/${soDeal}?with=person,company,customFields`)).data].filter(Boolean);
  } else {
    for (let page = 1; page <= 5; page++) {
      const r = await pr('GET', `/deals?pipeline_id=${TN.PIPELINE_CS}&status=0&show=200&page=${page}&created_at_start=${CONFIG.ATIVAR_DESDE}&with=person,company,customFields`);
      deals = deals.concat(r.data || []);
      if (!r.meta || page >= Number(r.meta.total_pages || 1)) break;
    }
  }
} catch (e) { return [{ json: { ok: false, erro: 'PipeRun não respondeu ao listar o CS: ' + String(e.message).slice(0, 160) } }]; }
deals = deals.filter(d => Number(d.pipeline_id) === TN.PIPELINE_CS && Number(d.status) === 0 && !Number(d.deleted));
relatorio.lidos = deals.length;

// ---------- 2. achar o contato do cliente no Chatwoot ----------
const filtrarContatos = async (chave, valores) => {
  const r = await cw('POST', '/contacts/filter', { payload: [{ attribute_key: chave, filter_operator: 'equal_to', values: valores.map(String), attribute_model: 'custom_attributes', query_operator: null }] });
  return (r && r.payload) || [];
};
const buscarPorFone = async (fone) => {
  const f = TN.foneBR(fone); if (!f) return null;
  const r = await cw('GET', '/contacts/search?q=' + TN.oitoFinais(f));
  const lista = (r && r.payload) || [];
  return lista.find(c => TN.soDigitos(c.phone_number).endsWith(f.slice(-10))) || null;
};
const acharContato = async (deal, numero) => {
  // a) já casado antes
  if (st.contatoPorDeal[deal.id]) { try { const c = await cw('GET', `/contacts/${st.contatoPorDeal[deal.id]}`); return { contato: c.payload || c, como: 'memória' }; } catch (e) {} }
  // b) atributo toninho_cs_deal_id (gravado pelo próprio Toninho ou pelo webhook de eventos)
  try { const l = await filtrarContatos('toninho_cs_deal_id', [deal.id]); if (l.length) return { contato: l[0], como: 'atributo toninho_cs_deal_id' }; } catch (e) {}
  // c) negócio de orçamento GANHO da mesma empresa -> contato com piperun_deal_id (o handoff da Júlia grava)
  if (deal.company_id) {
    try {
      const g = await pr('GET', `/deals?pipeline_id=1547&company_id=${deal.company_id}&status=1&show=5`);
      const ids = (g.data || []).map(d => d.id);
      if (ids.length) { const l = await filtrarContatos('piperun_deal_id', ids); if (l.length) return { contato: l[0], como: 'piperun_deal_id do orçamento ganho ' + l[0].custom_attributes.piperun_deal_id }; }
    } catch (e) {}
  }
  // d) nome do contato com " - <número do pedido>" (convenção do Vinícius)
  if (numero) {
    try {
      const r = await cw('GET', '/contacts/search?q=' + numero);
      const re = new RegExp('[-–]\\s*' + numero + '(\\b|/)');
      const c = ((r && r.payload) || []).find(x => re.test(String(x.name || '')));
      if (c) return { contato: c, como: 'nome com o número do pedido' };
    } catch (e) {}
  }
  // e) telefone da pessoa / da empresa no PipeRun
  const fones = [];
  if (deal.person_id) { try { const p = (await pr('GET', `/persons/${deal.person_id}?with=contact_phones`)).data || {}; for (const t of (p.contact_phones || [])) fones.push(t.phone || t.number || t); if (p.external_code) fones.push(p.external_code); } catch (e) {} }
  const emp = deal.company || {}; for (const t of [emp.cellphone, emp.phone]) if (t) fones.push(t);
  for (const f of fones) { const c = await buscarPorFone(f); if (c) return { contato: c, como: 'telefone do PipeRun' }; }
  const fone = fones.map(TN.foneBR).find(Boolean);
  if (fone) return { contato: null, criar: { fone, nome: (deal.person && deal.person.name) || emp.name || 'Cliente' }, como: 'telefone do PipeRun sem contato no Chatwoot' };
  return { contato: null, como: 'sem telefone' };
};

// ---------- 3. estado da conversa ----------
const inboxAlvo = teste && body.inbox ? Number(body.inbox) : CONFIG.INBOX;
const lerConversa = async (contato) => {
  const r = await cw('GET', `/contacts/${contato.id}/conversations`);
  const todas = (r && r.payload) || [];
  const conv = todas.filter(c => Number(c.inbox_id) === inboxAlvo).sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0))[0] || null;
  const estado = { conv, optout: false, humanoFalando: '', escalada: false, clienteEsperando: false, janelaAbertaH: Infinity };
  const labels = conv ? (conv.labels || []) : [];
  estado.optout = labels.some(l => CONFIG.ETIQUETAS_BLOQUEIO.includes(l));
  if (!conv) return estado;
  const ass = conv.meta && conv.meta.assignee;
  const ult = conv.last_non_activity_message || {};
  const ehToninho = ass && Number(ass.id) === Number(CONFIG.TONINHO_AGENT_ID);
  try {
    const ms = await cw('GET', `/conversations/${conv.id}/messages`);
    const pub = ((ms && ms.payload) || []).filter(m => !m.private && (m.message_type === 0 || m.message_type === 1 || m.message_type === 3));
    const ultIn = pub.filter(m => m.message_type === 0).slice(-1)[0];
    if (ultIn) estado.janelaAbertaH = (agora / 1000 - ultIn.created_at) / 3600;
    const ultOut = pub.filter(m => m.message_type !== 0).slice(-1)[0];
    const ultOutHumano = ultOut && ultOut.sender && String(ultOut.sender.type || '').toLowerCase() === 'user' && Number(ultOut.sender.id) !== Number(CONFIG.TONINHO_AGENT_ID);
    if (conv.status === 'open' && ass && !ehToninho && ultOutHumano && (agora / 1000 - ultOut.created_at) / 3600 < CONFIG.HUMANO_SILENCIO_H) estado.humanoFalando = ass.name || ('agente ' + ass.id);
  } catch (e) {}
  if (conv.status === 'open' && ehToninho && ult.message_type === 0) estado.clienteEsperando = true;
  return estado;
};

// ---------- 4. status da produção ----------
const lerProducao = async (numero) => {
  if (!numero) return { deal: null, status: TN.statusProducao(null), rastreio: '' };
  try {
    const r = await pr('GET', `/deals?pipeline_id=${TN.PIPELINE_PRODUCAO}&title=${numero}&show=10`);
    const d = (r.data || []).find(x => TN.numeroDoPedido(x.title) === numero) || null;
    let rastreio = '';
    if (d && CONFIG.LER_RASTREIO_DAS_NOTAS) {
      try { const n = await pr('GET', `/notes?deal_id=${d.id}&show=20`); for (const x of (n.data || [])) { const m = String(x.text || x.content || '').match(/RASTREIO:\s*([A-Z0-9]{8,20})/i); if (m) rastreio = m[1].toUpperCase(); } } catch (e) {}
    }
    return { deal: d, status: TN.statusProducao(d ? d.stage_id : null), rastreio };
  } catch (e) { return { deal: null, status: TN.statusProducao(null), rastreio: '' }; }
};

// ---------- 5. envio (texto na janela, template fora) ----------
const assinar = (t) => CONFIG.ASSINATURA ? t + '\n\n' + CONFIG.ASSINATURA : t;
const enviar = async (conv, contato, acao, vars, janelaH) => {
  const texto = TN.texto(acao, vars);
  const tpl = CONFIG.TEMPLATES[acao === 'toque' && vars.perguntaEntrega ? 'chegou' : acao];
  if (janelaH < 24) {
    await escrever(`mensagem (texto) -> conversa ${conv.id}: ${texto}`, () => cw('POST', `/conversations/${conv.id}/messages`, { content: assinar(texto), message_type: 'outgoing', private: false }, HT));
    return { via: 'texto', texto };
  }
  if (!tpl) return { via: 'nenhum', aguarda: 'sem template para ' + acao };
  if (!CONFIG.TEMPLATES_ATIVOS) return { via: 'nenhum', aguarda: 'janela fechada e TEMPLATES_ATIVOS=false (template ' + tpl.name + ')' };
  const params = {}; tpl.params.forEach((k, i) => { params[String(i + 1)] = String(vars[k] || ''); });
  await escrever(`mensagem (template ${tpl.name}) -> conversa ${conv.id}: ${JSON.stringify(params)}`, () => cw('POST', `/conversations/${conv.id}/messages`, { content: texto, message_type: 'outgoing', template_params: { name: tpl.name, category: tpl.category, language: tpl.language || 'pt_BR', processed_params: params } }, HT));
  return { via: 'template ' + tpl.name, texto };
};
const notaPipe = async (deal, texto) => {
  if (!CONFIG.ESCREVER_PIPERUN) { relatorio.escritas.push(`[PipeRun bloqueado, pendência 1] nota no negócio ${deal.id}: ${texto}`); return; }
  await escrever(`nota no negócio ${deal.id}: ${texto}`, () => prTry('POST', '/notes', { deal_id: deal.id, text: 'TONINHO: ' + texto }));
};
const moverPipe = async (deal, etapa) => {
  if (!etapa || Number(deal.stage_id) === Number(etapa)) return;
  if (!CONFIG.ESCREVER_PIPERUN) { relatorio.escritas.push(`[PipeRun bloqueado, pendência 1] mover negócio ${deal.id} para ${TN.NOME_ETAPA[etapa] || etapa}`); return; }
  const r = await escrever(`mover negócio ${deal.id} -> ${TN.NOME_ETAPA[etapa] || etapa}`, () => prTry('PUT', `/deals/${deal.id}`, { stage_id: etapa }));
  if (r && r.ok === false) relatorio.erros.push(`PipeRun recusou mover ${deal.id}: ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
};
const gravarAttrs = async (contato, novos) => {
  const attrs = Object.assign({}, contato.custom_attributes || {}, novos);
  await escrever(`atributos do contato ${contato.id}: ${JSON.stringify(novos)}`, () => cw('PUT', `/contacts/${contato.id}`, { custom_attributes: attrs }));
  contato.custom_attributes = attrs;
};
const assumirConversa = async (conv, labelsAtuais) => {
  const labels = Array.from(new Set([...(labelsAtuais || []), 'pos-vendas', 'toninho']));
  await escrever(`conversa ${conv.id}: responsável Toninho (${CONFIG.TONINHO_AGENT_ID}), time pós-vendas, etiquetas ${labels.join(',')}, open`, async () => {
    await cw('POST', `/conversations/${conv.id}/assignments`, { assignee_id: CONFIG.TONINHO_AGENT_ID });
    await cw('POST', `/conversations/${conv.id}/assignments`, { team_id: CONFIG.TEAM_POSVENDAS });
    await cw('POST', `/conversations/${conv.id}/labels`, { labels });
    if (conv.status !== 'open') await cw('POST', `/conversations/${conv.id}/toggle_status`, { status: 'open' });
  });
};
const notaPrivada = async (conv, texto) => escrever(`nota privada na conversa ${conv.id}: ${texto}`, () => cw('POST', `/conversations/${conv.id}/messages`, { content: texto, message_type: 'outgoing', private: true }));

// ---------- 6. laço ----------
let feitas = 0;
for (const deal of deals) {
  if (feitas >= CONFIG.MAX_POR_CICLO) { relatorio.pulados.push({ deal: deal.id, motivo: 'MAX_POR_CICLO atingido' }); continue; }
  const numero = TN.numeroDoPedido(deal.title);
  const item = { deal: deal.id, pedido: numero, titulo: String(deal.title || '').slice(0, 70), etapa: TN.NOME_ETAPA[deal.stage_id] || deal.stage_id };
  try {
    const ach = await acharContato(deal, numero);
    item.contato_como = ach.como;
    if (!ach.contato && !ach.criar) {
      if (!st.semTelefone[deal.id]) {
        st.semTelefone[deal.id] = agora;
        await notaPipe(deal, 'sem telefone do cliente no PipeRun nem contato no Chatwoot. Acolher manualmente ou pedir ao Força de Vendas o telefone (pendência 3).');
      }
      relatorio.pulados.push({ ...item, motivo: 'sem telefone (nota deixada uma vez)' });
      continue;
    }
    let contato = ach.contato;
    if (!contato) {
      // contato novo: nasce com os atributos do Toninho; a conversa nasce no envio
      const r = await escrever(`criar contato ${ach.criar.nome} +${ach.criar.fone}`, () => cw('POST', '/contacts', { name: ach.criar.nome, phone_number: '+' + ach.criar.fone, custom_attributes: { toninho_cs_deal_id: String(deal.id), toninho_pedido: String(numero || '') } }));
      contato = (r && (r.payload && r.payload.contact)) || (r && r.payload) || { id: 0, name: ach.criar.nome, phone_number: '+' + ach.criar.fone, custom_attributes: { toninho_cs_deal_id: String(deal.id) }, simulado: true };
    }
    st.contatoPorDeal[deal.id] = contato.id;
    const attrs = contato.custom_attributes || {};
    const estado = contato.simulado ? { conv: null, optout: false, humanoFalando: '', escalada: false, clienteEsperando: false, janelaAbertaH: Infinity } : await lerConversa(contato);
    // escalada devolvida: o humano reatribuiu ao Toninho (ou resolveu) -> volta ao estado da etapa
    if (String(attrs.toninho_regua || '') === 'escalado') {
      const ass = estado.conv && estado.conv.meta && estado.conv.meta.assignee;
      const devolvida = !estado.conv || estado.conv.status === 'resolved' || (ass && Number(ass.id) === Number(CONFIG.TONINHO_AGENT_ID));
      if (!devolvida) { estado.escalada = true; }
      else { await gravarAttrs(contato, { toninho_regua: 'producao' }); }
    }
    const prod = await lerProducao(numero);
    item.producao = prod.status.chave + (prod.deal ? ' (negócio ' + prod.deal.id + ')' : ' (negócio de Produção não encontrado)');
    const decisao = TN.decidir({ deal, producao: prod.status, attrs: contato.custom_attributes || {}, conversa: estado, agoraMs: agora, cfg: CONFIG });
    item.decisao = decisao;
    if (decisao.acao === 'nada') { relatorio.pulados.push(item); continue; }

    // conversa: usa a existente ou cria (template obrigatório, janela fechada)
    let conv = estado.conv;
    if (!conv) {
      const fone = TN.foneBR(contato.phone_number);
      const r = await escrever(`criar conversa na inbox ${inboxAlvo} para o contato ${contato.id}`, () => cw('POST', '/conversations', { inbox_id: inboxAlvo, contact_id: contato.id, source_id: fone, status: 'open', assignee_id: CONFIG.TONINHO_AGENT_ID, team_id: CONFIG.TEAM_POSVENDAS }));
      conv = (r && r.id) ? r : { id: 0, status: 'open', labels: [], simulado: true };
    }
    const tipo = String(attrs.tipo_cliente || '').toLowerCase();
    const vars = { nome: TN.primeiroNome(attrs.nome || contato.name), pedido: numero, resumo: TN.resumoDoPedido(deal.title), tipo, status: prod.status.texto, rastreio: prod.rastreio, financeiro: prod.status.financeiro, vendedor: attrs.vendedor || '' };
    const prazoInfo = TN.etapaDoPrazo(campo(deal, TN.CAMPO.PRAZO_CS), campo(deal, TN.CAMPO.DATA_PROMETIDA), deal.created_at, agora);
    if (decisao.acao === 'acolher') vars.prazo = prazoInfo.prazo === 'Especial' ? '' : prazoInfo.prazo;
    if (decisao.acao === 'toque') { vars.perguntaEntrega = !!decisao.perguntaEntrega; vars.statusExtra = !!decisao.statusExtra; vars.semMudanca = !decisao.perguntaEntrega && !decisao.statusExtra && String(attrs.toninho_ultimo_status || '') === prod.status.chave; }
    if (decisao.acao === 'encerrar') vars.semNps = !!decisao.semNps;

    const envio = await enviar(conv, contato, decisao.acao, vars, estado.janelaAbertaH);
    item.envio = envio;
    if (envio.via === 'nenhum') { relatorio.pulados.push({ ...item, motivo: envio.aguarda }); continue; }
    feitas++;

    // pós-envio: atributos, conversa, PipeRun
    const novos = { toninho_cs_deal_id: String(deal.id), toninho_pedido: String(numero || ''), toninho_toques: TN.marcarToque(attrs, decisao.passo), toninho_passo_em: new Date(agora).toISOString(), toninho_ultimo_status: prod.status.chave };
    if (decisao.acao === 'acolher') { novos.toninho_regua = 'producao:' + prazoInfo.prazo; }
    if (decisao.acao === 'pronto') novos.toninho_regua = 'pronto';
    if (decisao.acao === 'entregue_nps') { novos.toninho_regua = 'nps'; if (prod.status.chave === 'entregue') novos.entregue_sistema_em = new Date(agora).toISOString(); }
    if (decisao.acao === 'encerrar') novos.toninho_regua = 'encerrado';
    await gravarAttrs(contato, novos);
    if (!conv.simulado && (decisao.acao === 'acolher' || !(conv.meta && conv.meta.assignee))) await assumirConversa(conv, conv.labels);
    if (decisao.acao === 'acolher') {
      await notaPipe(deal, `acolhimento enviado (${envio.via}) para ${contato.name} (${contato.phone_number}). Cadência: ${prazoInfo.prazo} dias, origem: ${prazoInfo.origem}.`);
      await moverPipe(deal, prazoInfo.etapa);
    } else if (decisao.acao === 'toque') {
      await notaPipe(deal, `toque ${decisao.passo} (${envio.via}): ${prod.status.chave}${vars.semMudanca ? ' (sem mudança)' : ''}.`);
      if (decisao.especial && !conv.simulado) await notaPrivada(conv, `@Vinícius prazo especial: toque ${decisao.passo} enviado ao cliente (status ${prod.status.chave}). Confere se a produção está no ritmo.`);
    } else if (decisao.acao === 'pronto') {
      await notaPipe(deal, `aviso de pedido pronto (${envio.via})${prod.status.financeiro ? '; produção aponta pendência financeira' : ''}.`);
      await moverPipe(deal, decisao.moverPara);
    } else if (decisao.acao === 'entregue_nps') {
      await notaPipe(deal, `entrega + pergunta de NPS (${envio.via}). Produção: ${prod.status.chave}.`);
      await moverPipe(deal, decisao.moverPara);
    } else if (decisao.acao === 'lembrete_nps') {
      await notaPipe(deal, `lembrete de NPS ${decisao.passo} (${envio.via}).`);
    } else if (decisao.acao === 'encerrar') {
      await notaPipe(deal, decisao.semNps ? 'acompanhamento encerrado SEM NPS (2 lembretes sem resposta).' : `acompanhamento encerrado. NPS ${attrs.nps_nota}${attrs.nps_comentario ? ': ' + String(attrs.nps_comentario).slice(0, 200) : ''}.`);
      if (CONFIG.FECHAR_GANHO && CONFIG.ESCREVER_PIPERUN) await escrever(`marcar ganho o negócio ${deal.id}`, () => prTry('PUT', `/deals/${deal.id}`, { status: 1 }));
      if (CONFIG.RESOLVER_AO_ENCERRAR && !conv.simulado) await escrever(`resolver conversa ${conv.id}`, () => cw('POST', `/conversations/${conv.id}/toggle_status`, { status: 'resolved' }));
    }
    relatorio.acoes.push(item);
  } catch (e) {
    relatorio.erros.push({ ...item, erro: String(e && e.message).slice(0, 200) });
  }
}
relatorio.resumo = `${relatorio.lidos} negócios lidos, ${relatorio.acoes.length} ações, ${relatorio.pulados.length} pulados, ${relatorio.erros.length} erros` + (dry ? ' (SIMULAÇÃO: nada foi enviado)' : '');
return [{ json: relatorio }];

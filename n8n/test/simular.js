#!/usr/bin/env node
// Simulador local dos nós do Toninho: roda o código montado pelo build.js fora do n8n, com LEITURAS reais e escritas
// BLOQUEADAS (qualquer método que não seja GET é só registrado). Serve para provar a Régua antes de publicar.
//   node n8n/test/simular.js regua                 ciclo inteiro (CONFIG.MAX_POR_CICLO) em simulação
//   node n8n/test/simular.js regua --so-deal 123   só um negócio do CS
//   node n8n/test/simular.js contexto --conversa 394 --contato 1103   monta o contexto da Conversa para um contato real
// Chatwoot é lido pela URL pública (CHATWOOT_URL, padrão https://chat.temgrupo.com.br) com o header api-access-token (hífen);
// tokens vêm de CHATWOOT_TOKEN / PIPERUN_TOKEN, ou do proxy da sessão quando ele injeta.
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const args = process.argv.slice(2); const qual = args[0] || 'regua';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CW_PUB = process.env.CHATWOOT_URL || 'https://chat.temgrupo.com.br';
const escritasBloqueadas = [];
const httpRequest = async (o) => {
  let url = String(o.url).replace('http://rails:3000', CW_PUB);
  const h = Object.assign({}, o.headers || {});
  if (h.api_access_token) { if (process.env.CHATWOOT_TOKEN) h['api-access-token'] = process.env.CHATWOOT_TOKEN; delete h.api_access_token; }
  if (h.token && process.env.PIPERUN_TOKEN) h.token = process.env.PIPERUN_TOKEN;
  if (!h.token) delete h.token;
  const m = (o.method || 'GET').toUpperCase();
  if (m !== 'GET' && !/\/contacts\/filter$/.test(url)) { escritasBloqueadas.push(m + ' ' + url + ' ' + JSON.stringify(o.body || {}).slice(0, 200)); return o.returnFullResponse ? { statusCode: 200, body: { simulado: true } } : { simulado: true }; }
  const cmd = ['-sS', '--max-time', String(Math.ceil((o.timeout || 20000) / 1000)), '-X', m, url, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}'];
  for (const [k, v] of Object.entries(h)) cmd.push('-H', k + ': ' + v);
  if (o.body) cmd.push('--data', JSON.stringify(o.body));
  const saida = execFileSync('curl', cmd, { encoding: 'utf8', maxBuffer: 50e6 });
  const nl = saida.lastIndexOf('\n'); const code = Number(saida.slice(nl + 1)); const txt = saida.slice(0, nl);
  let body = txt; if (o.json !== false) { try { body = JSON.parse(txt); } catch (e) {} }
  if (o.returnFullResponse) return { statusCode: code, body };
  if (code >= 400 && !o.ignoreHttpStatusErrors) { const e = new Error('HTTP ' + code + ' ' + url); e.response = { statusCode: code, body }; throw e; }
  return body;
};
const noDoDist = (arquivo, nome) => { const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', arquivo), 'utf8')); return wf.nodes.find(n => n.name === nome).parameters.jsCode; };
const rodar = async (codigo, $json, $) => {
  const estatico = {};
  const fn = new Function('$json', '$', '$getWorkflowStaticData', 'console', 'return (async function(){' + codigo + '\n}).call(this)');
  return fn.call({ helpers: { httpRequest } }, $json, $ || (() => ({ first: () => ({ json: {} }) })), () => estatico, console);
};
(async () => {
  if (qual === 'regua') {
    let codigo = noDoDist('toninho-regua.json', 'Régua');
    const max = Number(opt('--max', 5));
    codigo = codigo.replace(/"MAX_POR_CICLO": \d+/, '"MAX_POR_CICLO": ' + max).replace(/"SIMULACAO": (true|false)/, '"SIMULACAO": true');
    const body = { teste: true, oficial: true }; if (opt('--so-deal')) body.so_deal = Number(opt('--so-deal'));
    const r = await rodar(codigo, { body });
    console.log(JSON.stringify(r[0].json, null, 2));
  } else if (qual === 'contexto') {
    const filtro = { conversation_id: Number(opt('--conversa')), contact_id: Number(opt('--contato')), inbox_id: 3, message_id: 0, content: opt('--msg', 'oi, como está o pedido?'), attrs: {}, labels: [], status: 'open' };
    const c = await httpRequest({ method: 'GET', url: CW_PUB + '/api/v1/accounts/1/contacts/' + filtro.contact_id, headers: { api_access_token: 'x' }, json: true });
    filtro.attrs = (c.payload || c).custom_attributes || {}; filtro.nome_contato = (c.payload || c).name;
    if (opt('--deal')) filtro.attrs.toninho_cs_deal_id = opt('--deal');
    const ms = await httpRequest({ method: 'GET', url: CW_PUB + '/api/v1/accounts/1/conversations/' + filtro.conversation_id + '/messages', headers: { api_access_token: 'x' }, json: true });
    const ult = (ms.payload || []).filter(m => m.message_type === 0 && !m.private).sort((a, b) => a.id - b.id).slice(-1)[0];
    filtro.message_id = ult ? ult.id : 0;
    let codigo = noDoDist('toninho-conversa.json', 'Contexto').replace(/"SIMULACAO": (true|false)/, '"SIMULACAO": true');
    const r = await rodar(codigo, {}, () => ({ first: () => ({ json: filtro }) }));
    if (!r.length) { console.log('Contexto devolveu [] (a última mensagem não é a esperada)'); }
    else { const j = r[0].json; console.log('--- system_dinamico ---\n' + j.system_dinamico); console.log('--- guarda:', j.guarda, '| nota:', j.nota_lida, '| turnos:', j.turnos_toninho); console.log('--- últimas mensagens:', j.messages.length, '| base chars:', j.system_estatico.length); }
  }
  if (escritasBloqueadas.length) console.log('\nESCRITAS BLOQUEADAS PELO SIMULADOR (' + escritasBloqueadas.length + '):\n' + escritasBloqueadas.map(s => '  ' + s).join('\n'));
})().catch(e => { console.error('ERRO', e.stack || e.message); process.exit(1); });

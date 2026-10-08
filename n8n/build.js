#!/usr/bin/env node
// Monta os workflows do Toninho em n8n/dist/*.json a partir de n8n/src e, com --publish, cria/atualiza no n8n pela API.
//   node n8n/build.js                 gera os JSON (tokens como __PLACEHOLDER__ quando a variável de ambiente não existe)
//   node n8n/build.js --check         só confere a sintaxe dos nós
//   node n8n/build.js --publish       PUT/POST em $N8N_URL (padrão https://n8n.temgrupo.com.br) com X-N8N-API-KEY=$N8N_API_KEY
//   node n8n/build.js --publish --activate   também ativa (a Régua agendada e os webhooks)
// Variáveis: CHATWOOT_TOKEN (admin), TONINHO_TOKEN (agente Toninho), PIPERUN_TOKEN, TONINHO_SEGREDO (webhook de eventos),
//            TONINHO_AGENT_ID (id do agente no Chatwoot), N8N_API_KEY, N8N_URL. Nada disso vai para o git.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const SRC = path.join(__dirname, 'src'), DIST = path.join(__dirname, 'dist');
const env = (k, padrao) => process.env[k] || padrao || ('__' + k + '__');

const comum = fs.readFileSync(path.join(SRC, 'comum.js'), 'utf8');
const bloco = comum.slice(comum.indexOf('// >>> TONINHO COMUM (inicio)'), comum.indexOf('// <<< TONINHO COMUM (fim)') + '// <<< TONINHO COMUM (fim)'.length);
const base = fs.readFileSync(path.join(__dirname, '..', 'base', 'toninho-pos-vendas.txt'), 'utf8');

const BASE_CFG = {
  SIMULACAO: !flag('--real'),
  ESCREVER_PIPERUN: flag('--escrever-piperun'),   // pendência 1
  CW: 'http://rails:3000', ACC: 1,
  ADMIN_TOKEN: env('CHATWOOT_TOKEN'), TONINHO_TOKEN: env('TONINHO_TOKEN'),
  TONINHO_AGENT_ID: Number(process.env.TONINHO_AGENT_ID || 0),   // pendência 2
  VINICIUS_AGENT_ID: 9, MARCELO_AGENT_ID: 11, TEAM_POSVENDAS: 3,
  INBOX: 3, INBOX_TESTE: 2,
  PIPERUN: 'https://api.pipe.run/v1', PIPERUN_TOKEN: env('PIPERUN_TOKEN'),
  ETIQUETAS_BLOQUEIO: ['opt-out', 'sem-followup', 'spam'],
  ASSINATURA: '*Toninho (IA)*',
};
const CFG_REGUA = Object.assign({}, BASE_CFG, {
  ATIVAR_DESDE: process.env.TONINHO_ATIVAR_DESDE || '2026-10-08',   // só negócios do CS criados daqui em diante (pendência 5)
  MAX_POR_CICLO: 10, GAP_MIN_H: 20, HUMANO_SILENCIO_H: 24,
  TEMPLATES_ATIVOS: false,   // ligar quando os templates abaixo existirem na Meta (pendência 6); até lá, só texto na janela
  // fora da janela de 24h. Os nomes tm_cs_* são os sugeridos (base, seção 9); os tp_* são os que já existem (marketing).
  TEMPLATES: {
    acolher:      { name: 'tm_cs_acolhimento',   category: 'UTILITY', params: ['nome', 'pedido', 'prazo'] },
    toque:        { name: 'tm_cs_status',        category: 'UTILITY', params: ['nome', 'pedido', 'status'] },
    pronto:       { name: 'tm_cs_pronto',        category: 'UTILITY', params: ['nome', 'pedido'] },
    chegou:       { name: 'tm_cs_entregue_nps',  category: 'UTILITY', params: ['nome', 'pedido'] },
    entregue_nps: { name: 'tm_cs_entregue_nps',  category: 'UTILITY', params: ['nome', 'pedido'] },
    lembrete_nps: { name: 'tm_cs_nps_lembrete',  category: 'UTILITY', params: ['nome'] },
    encerrar:     null,   // encerramento só em texto livre (ou tp__contato__psentrega_822, marketing)
  },
  LER_RASTREIO_DAS_NOTAS: true,   // nota "RASTREIO: XXX" no negócio de Produção (pendência 11)
  FECHAR_GANHO: false,            // marcar o negócio do CS como ganho ao encerrar (decisão do Humberto)
  RESOLVER_AO_ENCERRAR: true,
});
const CFG_CONVERSA = Object.assign({}, BASE_CFG, {
  INBOXES: [3, 2], MAX_TURNOS: 6, RESOLVER_AO_ENCERRAR: true, ESCALAR_RECOMPRA_PARA_VENDEDOR: false,
  MODELO: process.env.TONINHO_MODELO || 'claude-haiku-4-5', MAX_TOKENS: 1200,
  BASE_URL: 'https://chat.temgrupo.com.br/base/toninho-pos-vendas.txt',
  BASE_FALLBACK: base,
});
const CFG_EVENTOS = Object.assign({}, BASE_CFG, {
  SEGREDO: env('TONINHO_SEGREDO'), ACORDAR_REGUA: true, REGUA_URL: 'http://localhost:5678/webhook/toninho-regua-teste',
});

const montar = (codigo, cfg) => codigo.replace('__CONFIG__', JSON.stringify(cfg, null, 2)).replace('__COMUM__', bloco);
const cortarNos = (arquivo) => {
  const s = fs.readFileSync(path.join(SRC, arquivo), 'utf8');
  const partes = s.split(/\/\/ ===== NÓ: ([^=]+?) =====\n/);
  const nos = {}; for (let i = 1; i < partes.length; i += 2) nos[partes[i].trim()] = partes[i + 1];
  return nos;
};
const checar = (nome, codigo) => {
  try { new vm.Script('(async function(){' + codigo + '\n})', { filename: nome }); return true; }
  catch (e) { console.error('SINTAXE ' + nome + ': ' + e.message); return false; }
};
const code = (name, jsCode, pos) => ({ name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode } });

// ---------- workflows ----------
const regua = montar(fs.readFileSync(path.join(SRC, 'regua.node.js'), 'utf8'), CFG_REGUA);
const WF_REGUA = {
  name: 'Toninho - Régua',
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo' },
  nodes: [
    { name: 'A cada 30 min, seg a sex', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: 'cronExpression', expression: '*/30 8-18 * * 1-5' }] } } },
    { name: 'Teste manual', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 200], parameters: { httpMethod: 'POST', path: 'toninho-regua-teste', responseMode: 'lastNode', options: {} } },
    code('Régua', regua, [260, 100]),
  ],
  connections: { 'A cada 30 min, seg a sex': { main: [[{ node: 'Régua', type: 'main', index: 0 }]] }, 'Teste manual': { main: [[{ node: 'Régua', type: 'main', index: 0 }]] } },
};

const nosConv = cortarNos('conversa.node.js');
const WF_CONVERSA = {
  name: 'Toninho - Conversa',
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo' },
  nodes: [
    { name: 'Webhook Chatwoot', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { httpMethod: 'POST', path: 'toninho', responseMode: 'onReceived', options: {} } },
    code('Filtro', montar(nosConv['Filtro'], CFG_CONVERSA), [220, 0]),
    { name: 'Esperar cliente', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [440, 0], parameters: { amount: 10, unit: 'seconds' }, webhookId: 'toninho-espera' },
    code('Contexto', montar(nosConv['Contexto'], CFG_CONVERSA), [660, 0]),
    { name: 'IA (Anthropic)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [880, 0],
      parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ model: $json.modelo, max_tokens: $json.max_tokens, temperature: 0.3, system: [{ type: 'text', text: $json.system_estatico, cache_control: { type: 'ephemeral' } }, { type: 'text', text: $json.system_dinamico }], messages: $json.messages, tools: $json.tools, tool_choice: { type: 'tool', name: 'responder' } }) }}",
        options: {} },
      credentials: { anthropicApi: { id: 'bR8bB8RcI5EAEbQf', name: 'Anthropic T&M' } } },
    code('Executar', montar(nosConv['Executar'], CFG_CONVERSA), [1100, 0]),
  ],
  connections: {
    'Webhook Chatwoot': { main: [[{ node: 'Filtro', type: 'main', index: 0 }]] },
    'Filtro': { main: [[{ node: 'Esperar cliente', type: 'main', index: 0 }]] },
    'Esperar cliente': { main: [[{ node: 'Contexto', type: 'main', index: 0 }]] },
    'Contexto': { main: [[{ node: 'IA (Anthropic)', type: 'main', index: 0 }]] },
    'IA (Anthropic)': { main: [[{ node: 'Executar', type: 'main', index: 0 }]] },
  },
};

const eventos = montar(fs.readFileSync(path.join(SRC, 'pedido-eventos.node.js'), 'utf8'), CFG_EVENTOS);
const WF_EVENTOS = {
  name: 'Toninho - Eventos do Pedido',
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo' },
  nodes: [
    { name: 'Evento do pedido', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { httpMethod: 'POST', path: 'toninho-pedido', responseMode: 'responseNode', options: {} } },
    code('Receber evento', eventos, [220, 0]),
    { name: 'Responder', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [440, 0], parameters: { respondWith: 'json', responseBody: '={{ $json.resposta }}', options: { responseCode: '={{ $json.status }}' } } },
  ],
  connections: { 'Evento do pedido': { main: [[{ node: 'Receber evento', type: 'main', index: 0 }]] }, 'Receber evento': { main: [[{ node: 'Responder', type: 'main', index: 0 }]] } },
};

const todos = [['toninho-regua.json', WF_REGUA], ['toninho-conversa.json', WF_CONVERSA], ['toninho-eventos-pedido.json', WF_EVENTOS]];
let ok = true;
for (const [, wf] of todos) for (const n of wf.nodes) if (n.type === 'n8n-nodes-base.code') ok = checar(wf.name + ' › ' + n.name, n.parameters.jsCode) && ok;
if (!ok) process.exit(1);
if (flag('--check')) { console.log('sintaxe ok'); process.exit(0); }
fs.mkdirSync(DIST, { recursive: true });
for (const [arq, wf] of todos) { fs.writeFileSync(path.join(DIST, arq), JSON.stringify(wf, null, 2)); console.log('gerado', path.relative(process.cwd(), path.join(DIST, arq)), '(' + wf.nodes.length + ' nós)'); }
const placeholders = todos.flatMap(([, wf]) => wf.nodes.filter(n => n.parameters.jsCode).flatMap(n => (n.parameters.jsCode.match(/__[A-Z_]+__/g) || [])));
if (placeholders.length) console.log('aviso: tokens não informados, ficaram como placeholder:', Array.from(new Set(placeholders)).join(', '));

if (flag('--publish')) {
  (async () => {
    const url = process.env.N8N_URL || 'https://n8n.temgrupo.com.br';
    const key = process.env.N8N_API_KEY; if (!key) { console.error('N8N_API_KEY ausente'); process.exit(1); }
    const api = async (m, p, body) => { const r = await fetch(url + '/api/v1' + p, { method: m, headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(m + ' ' + p + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 300)); return r.json(); };
    const lista = (await api('GET', '/workflows?limit=200')).data || [];
    for (const [, wf] of todos) {
      const existente = lista.find(w => w.name === wf.name);
      const corpo = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
      const r = existente ? await api('PUT', '/workflows/' + existente.id, corpo) : await api('POST', '/workflows', corpo);
      console.log((existente ? 'atualizado' : 'criado'), wf.name, r.id);
      if (flag('--activate')) { await api('POST', '/workflows/' + r.id + '/activate'); console.log('ativado', wf.name); }
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const TN = require('../src/comum.js');

const E = TN.ETAPA;
const ms = (iso) => Date.parse(iso);
const cfg = { GAP_MIN_H: 20 };

test('numero e resumo do pedido a partir do título', () => {
  assert.equal(TN.numeroDoPedido('497 - B2B - TBF ACADEMIA DE FUTEBOL LTDA - B2B-20261008-YLXSQC'), 497);
  assert.equal(TN.numeroDoPedido('7018 - CAMED CORRETORA DE SEGUROS'), 7018);
  assert.equal(TN.numeroDoPedido('CAMED SEM NUMERO'), null);
  assert.equal(TN.codigoB2B('497 - B2B - X - B2B-20261008-YLXSQC'), 'B2B-20261008-YLXSQC');
  assert.equal(TN.resumoDoPedido('497 - B2B - TBF ACADEMIA DE FUTEBOL LTDA - B2B-20261008-YLXSQC'), 'TBF ACADEMIA DE FUTEBOL LTDA');
  assert.equal(TN.resumoDoPedido('7018 - CAMED CORRETORA DE SEGUROS'), 'CAMED CORRETORA DE SEGUROS');
});

test('telefone BR', () => {
  assert.equal(TN.foneBR('+55 (47) 99166-0777'), '5547991660777');
  assert.equal(TN.foneBR('47991660777'), '5547991660777');
  assert.equal(TN.foneBR('554791766799'), '554791766799');
  assert.equal(TN.foneBR('123'), null);
  assert.equal(TN.foneBR(''), null);
  assert.equal(TN.oitoFinais('+5547991660777'), '91660777');
});

test('primeiro nome ignora razão social e departamentos', () => {
  assert.equal(TN.primeiroNome('Flávia Nascimento - 7018'), 'Flávia');
  assert.equal(TN.primeiroNome('Compras Cavazzani'), '');
  assert.equal(TN.primeiroNome('LTDA X'), '');
});

test('expediente: seg-qui 8-18, sex 8-17, feriado e fim de semana', () => {
  assert.equal(TN.expediente(ms('2026-10-08T10:00:00-03:00')).dentro, true);   // quinta 10h
  assert.equal(TN.expediente(ms('2026-10-08T18:00:00-03:00')).dentro, false);  // quinta 18h
  assert.equal(TN.expediente(ms('2026-10-09T17:30:00-03:00')).dentro, false);  // sexta 17h30
  assert.equal(TN.expediente(ms('2026-10-09T16:59:00-03:00')).dentro, true);   // sexta 16h59
  assert.equal(TN.expediente(ms('2026-10-10T10:00:00-03:00')).dentro, false);  // sábado
  assert.equal(TN.expediente(ms('2026-10-12T10:00:00-03:00')).dentro, false);  // feriado 12/10
});

test('dias desde data do PipeRun', () => {
  assert.equal(TN.diasDesde('2026-10-01 09:00:00', ms('2026-10-08T15:00:00-03:00')), 7);
  assert.equal(TN.diasDesde('2026-10-08 23:59:00', ms('2026-10-08T15:00:00-03:00')), 0);
  assert.equal(TN.diasDesde(null, Date.now()), null);
});

test('etapa pelo prazo: campo, data prometida, padrão', () => {
  assert.equal(TN.etapaDoPrazo('25', null, null, 0).etapa, E.P25);
  assert.equal(TN.etapaDoPrazo('Especial', null, null, 0).etapa, E.ESPECIAL);
  assert.equal(TN.etapaDoPrazo(null, '2026-10-20', '2026-10-08 10:00:00', 0).etapa, E.P15);
  assert.equal(TN.etapaDoPrazo(null, '2026-11-20', '2026-10-08 10:00:00', 0).etapa, E.P45);
  assert.equal(TN.etapaDoPrazo(null, '2026-12-20', '2026-10-08 10:00:00', 0).etapa, E.P60);
  const pad = TN.etapaDoPrazo(null, null, null, 0);
  assert.equal(pad.etapa, E.P45); assert.match(pad.origem, /padrão/);
});

test('status de produção por etapa', () => {
  assert.equal(TN.statusProducao(227822).chave, 'em_producao');
  assert.equal(TN.statusProducao(410415).chave, 'a_caminho');
  assert.equal(TN.statusProducao(227825).chave, 'entregue');
  assert.equal(TN.statusProducao(227824).financeiro, true);
  assert.equal(TN.statusProducao(227824).chave, 'pronto');
  assert.equal(TN.statusProducao(999).chave, 'desconhecido');
});

test('decidir: acolhimento uma vez só', () => {
  const agora = ms('2026-10-08T10:00:00-03:00');
  const deal = { stage_id: E.ACOLHIMENTO, created_at: '2026-10-08 09:00:00', last_stage_updated_at: '2026-10-08 09:00:00' };
  assert.equal(TN.decidir({ deal, attrs: {}, agoraMs: agora, cfg }).acao, 'acolher');
  assert.equal(TN.decidir({ deal, attrs: { toninho_toques: 'acolhimento' }, agoraMs: agora, cfg }).acao, 'nada');
});

test('decidir: cadência de 15 dias, gap de 20h e passos já feitos', () => {
  const base = { stage_id: E.P15, last_stage_updated_at: '2026-10-01 09:00:00' };
  const dia2 = ms('2026-10-03T10:00:00-03:00'), dia3 = ms('2026-10-04T10:00:00-03:00'), dia8 = ms('2026-10-09T10:00:00-03:00');
  const prod = TN.statusProducao(227822);
  assert.equal(TN.decidir({ deal: base, producao: prod, attrs: {}, agoraMs: dia2, cfg }).acao, 'nada');
  const d3 = TN.decidir({ deal: base, producao: prod, attrs: {}, agoraMs: dia3, cfg });
  assert.equal(d3.acao, 'toque'); assert.equal(d3.passo, 'p1');
  // p1 feito há 2h: gap bloqueia o p2 mesmo que devido
  const d8gap = TN.decidir({ deal: base, producao: prod, attrs: { toninho_toques: 'p1', toninho_passo_em: new Date(dia8 - 2 * 36e5).toISOString() }, agoraMs: dia8, cfg });
  assert.equal(d8gap.acao, 'nada'); assert.match(d8gap.motivo, /gap/);
  const d8 = TN.decidir({ deal: base, producao: prod, attrs: { toninho_toques: 'p1', toninho_passo_em: '2026-10-04T13:00:00.000Z' }, agoraMs: dia8, cfg });
  assert.equal(d8.acao, 'toque'); assert.equal(d8.passo, 'p2');
});

test('decidir: produção pronta ou entregue vence a cadência', () => {
  const deal = { stage_id: E.P45, last_stage_updated_at: '2026-10-01 09:00:00' };
  const agora = ms('2026-10-05T10:00:00-03:00');
  const pronto = TN.decidir({ deal, producao: TN.statusProducao(542375), attrs: {}, agoraMs: agora, cfg });
  assert.equal(pronto.acao, 'pronto'); assert.equal(pronto.moverPara, E.PRONTO);
  const entregue = TN.decidir({ deal, producao: TN.statusProducao(227825), attrs: {}, agoraMs: agora, cfg });
  assert.equal(entregue.acao, 'entregue_nps'); assert.equal(entregue.moverPara, E.FEEDBACK);
});

test('decidir: pedido pronto pergunta entrega em D10/D20/D30 e avisa a caminho', () => {
  const deal = { stage_id: E.PRONTO, last_stage_updated_at: '2026-10-01 09:00:00' };
  const d5 = ms('2026-10-06T10:00:00-03:00'), d10 = ms('2026-10-11T10:00:00-03:00');
  assert.equal(TN.decidir({ deal, producao: TN.statusProducao(410921), attrs: {}, agoraMs: d5, cfg }).acao, 'nada');
  const ac = TN.decidir({ deal, producao: TN.statusProducao(410415), attrs: {}, agoraMs: d5, cfg });
  assert.equal(ac.acao, 'toque'); assert.equal(ac.passo, 'a_caminho');
  const c1 = TN.decidir({ deal, producao: TN.statusProducao(410415), attrs: { toninho_toques: 'a_caminho', toninho_passo_em: '2026-10-06T13:00:00.000Z' }, agoraMs: d10, cfg });
  assert.equal(c1.acao, 'toque'); assert.equal(c1.passo, 'chegou1'); assert.equal(c1.perguntaEntrega, true);
});

test('decidir: coleta de feedback: NPS, lembretes, encerramento', () => {
  const deal = { stage_id: E.FEEDBACK, last_stage_updated_at: '2026-10-01 09:00:00' };
  const d0 = ms('2026-10-01T12:00:00-03:00'), d3 = ms('2026-10-04T12:00:00-03:00'), d8 = ms('2026-10-09T12:00:00-03:00');
  assert.equal(TN.decidir({ deal, attrs: {}, agoraMs: d0, cfg }).acao, 'entregue_nps');
  const l1 = TN.decidir({ deal, attrs: { toninho_toques: 'entregue', toninho_passo_em: '2026-10-01T15:00:00.000Z' }, agoraMs: d3, cfg });
  assert.equal(l1.acao, 'lembrete_nps'); assert.equal(l1.passo, 'nps1');
  const fim = TN.decidir({ deal, attrs: { toninho_toques: 'entregue,nps1,nps2', toninho_passo_em: '2026-10-05T15:00:00.000Z' }, agoraMs: d8, cfg });
  assert.equal(fim.acao, 'encerrar'); assert.equal(fim.semNps, true);
  const comNota = TN.decidir({ deal, attrs: { toninho_toques: 'entregue', nps_nota: 9 }, agoraMs: d3, cfg });
  assert.equal(comNota.acao, 'encerrar'); assert.equal(comNota.semNps, undefined);
});

test('decidir: silêncio quando humano fala, escalada aberta, opt-out ou cliente esperando', () => {
  const deal = { stage_id: E.P25, last_stage_updated_at: '2026-09-01 09:00:00' };
  const agora = ms('2026-10-08T10:00:00-03:00');
  assert.match(TN.decidir({ deal, attrs: {}, conversa: { humanoFalando: 'Vinícius' }, agoraMs: agora, cfg }).motivo, /humano/);
  assert.match(TN.decidir({ deal, attrs: {}, conversa: { escalada: true }, agoraMs: agora, cfg }).motivo, /escalada/);
  assert.match(TN.decidir({ deal, attrs: {}, conversa: { optout: true }, agoraMs: agora, cfg }).motivo, /opt-out/);
  assert.match(TN.decidir({ deal, attrs: {}, conversa: { clienteEsperando: true }, agoraMs: agora, cfg }).motivo, /Conversa/);
  assert.match(TN.decidir({ deal, attrs: { toninho_regua: 'optout' }, agoraMs: agora, cfg }).motivo, /optout/);
});

test('textos: tom por segmento, sem travessão, sem colchetes, um balão', () => {
  const v = { nome: 'Flávia', pedido: 7018, resumo: 'CAMED', prazo: 45, status: 'em produção', tipo: 'empresa' };
  for (const a of ['acolher', 'toque', 'pronto', 'entregue_nps', 'lembrete_nps', 'encerrar']) {
    for (const tipo of ['empresa', 'terceirao']) {
      const t = TN.texto(a, { ...v, tipo });
      assert.ok(t.length > 20, a + '/' + tipo);
      assert.doesNotMatch(t, /—|\[|\]/, a + '/' + tipo);
      assert.doesNotMatch(t, /\n\n/, a + '/' + tipo);
    }
  }
  assert.match(TN.texto('acolher', v), /^Olá Flávia, aqui é o Toninho/);
  assert.match(TN.texto('acolher', { ...v, tipo: 'terceirao' }), /^Oi Flávia! Toninho aqui/);
  assert.doesNotMatch(TN.texto('toque', v), /foi mal|tá /);
  assert.match(TN.texto('toque', { ...v, perguntaEntrega: true }), /chegou/i);
  assert.match(TN.texto('toque', { ...v, statusExtra: true, rastreio: 'AA1BR' }), /Rastreio: AA1BR/);
  assert.match(TN.texto('toque', { ...v, semMudanca: true }), /sem novidade/);
  assert.match(TN.texto('pronto', { ...v, financeiro: true }), /financeiro/);
});

test('guardas: opt-out, humano, reclamação, alteração; nota de NPS', () => {
  assert.equal(TN.guardas('para de me mandar mensagem'), 'optout');
  assert.equal(TN.guardas('quero falar com um atendente'), 'escalar');
  assert.equal(TN.guardas('o pedido veio errado, faltou 3 camisetas'), 'escalar');
  assert.equal(TN.guardas('posso mudar o tamanho de 2 peças do pedido?'), 'escalar');
  assert.equal(TN.guardas('preciso da segunda via do boleto'), 'escalar');
  assert.equal(TN.guardas('e aí, como está o pedido?'), null);
  assert.equal(TN.notaNps('9'), 9);
  assert.equal(TN.notaNps('nota 10'), 10);
  assert.equal(TN.notaNps('dou um 8, ficou bom'), 8);
  assert.equal(TN.notaNps('9/10'), 9);
  assert.equal(TN.notaNps('chegou as 40 camisetas'), null);
  assert.equal(TN.notaNps('pedido 7018 chegou'), null);
  assert.equal(TN.notaNps('ficou ótimo'), null);
  assert.equal(TN.classeNps(9), 'promotor'); assert.equal(TN.classeNps(7), 'neutro'); assert.equal(TN.classeNps(6), 'detrator');
});

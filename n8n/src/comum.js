// >>> TONINHO COMUM (inicio)
// Lógica PURA do Toninho: sem rede, sem `this`, sem n8n. O build.js cola este bloco inteiro dentro dos nós Code
// e os testes em n8n/test rodam estas mesmas linhas. Tudo que é regra de negócio (cadência, status, decisão do
// próximo toque, janela, horário) mora aqui; o que é rede (Chatwoot, PipeRun, Anthropic) mora nos *.node.js.

const TN = {};

// ----- feriados e horário comercial (mesma lista da Júlia; renovar os móveis a cada ano) -----
TN.FERIADOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25',
  '2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27'];

TN.pad = (n) => String(n).padStart(2, '0');

// Partes da data/hora em America/Sao_Paulo para um instante (ms). Sem Intl quebrado no n8n: usa formatToParts.
TN.local = (ms) => {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  const y = +p.year, mo = +p.month, d = +p.day, h = (+p.hour) % 24, mi = +p.minute;
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { y, mo, d, h, mi, dow, ymd: y + '-' + TN.pad(mo) + '-' + TN.pad(d) };
};

TN.ehUtilYmd = (ymd, dow) => {
  if (dow === 0 || dow === 6) return false;
  return !TN.FERIADOS.includes(ymd) && !TN.FERIADOS.includes(ymd.slice(5));
};

// Janela de envio: seg-qui 8h-18h, sex 8h-17h, sem feriado. Devolve {dentro, motivo}.
TN.expediente = (ms) => {
  const l = TN.local(ms);
  if (!TN.ehUtilYmd(l.ymd, l.dow)) return { dentro: false, motivo: (l.dow === 0 || l.dow === 6) ? 'fim de semana' : 'feriado nacional (' + l.ymd + ')' };
  const min = l.h * 60 + l.mi, fim = l.dow === 5 ? 17 * 60 : 18 * 60;
  if (min < 8 * 60 || min >= fim) return { dentro: false, motivo: 'fora do horário comercial (' + TN.pad(l.h) + 'h' + TN.pad(l.mi) + ')' };
  return { dentro: true, motivo: '' };
};

// Dias corridos inteiros entre um "AAAA-MM-DD HH:MM:SS" do PipeRun (hora de SP) e agora.
TN.diasDesde = (dataPipe, agoraMs) => {
  const m = String(dataPipe || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const l = TN.local(agoraMs);
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const b = Date.UTC(l.y, l.mo - 1, l.d);
  return Math.floor((b - a) / 864e5);
};

TN.horasDesdeIso = (iso, agoraMs) => {
  const t = Date.parse(iso || '');
  if (!t) return Infinity;
  return (agoraMs - t) / 36e5;
};

// ----- telefone -----
TN.soDigitos = (s) => String(s || '').replace(/\D+/g, '');
// Telefone BR válido em formato E.164 sem o "+": 55 + DDD + 8/9 dígitos. Aceita com/sem 55, com/sem nono dígito.
TN.foneBR = (s) => {
  let d = TN.soDigitos(s);
  if (!d) return null;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (!d.startsWith('55')) d = '55' + d;
  if (d.length < 12 || d.length > 13) return null;
  const ddd = +d.slice(2, 4);
  if (ddd < 11 || ddd > 99) return null;
  return d;
};
TN.oitoFinais = (fone) => TN.soDigitos(fone).slice(-8);

// ----- pedido -----
// "497 - B2B - TBF ACADEMIA... - B2B-20261008-YLXSQC" -> 497 ; "7018 - CAMED" -> 7018
TN.numeroDoPedido = (titulo) => { const m = String(titulo || '').trim().match(/^(\d{2,7})\s*[-–]/); return m ? +m[1] : null; };
TN.codigoB2B = (titulo) => { const m = String(titulo || '').match(/\b(B2B-\d{8}-[A-Z0-9]{4,8})\b/); return m ? m[1] : null; };
TN.resumoDoPedido = (titulo) => String(titulo || '').replace(/^\d+\s*[-–]\s*/, '').replace(/\s*[-–]\s*B2B-\d{8}-[A-Z0-9]+$/, '').replace(/^B2B\s*[-–]\s*/, '').trim();
TN.primeiroNome = (s) => {
  const n = String(s || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÀ-ÿ]{2,}$/.test(n) && !/^(ltda|me|eireli|sa|s\.a|compras|financeiro|comercial|empresa)$/i.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};

// ----- funil Customer Success (105219) -----
TN.PIPELINE_CS = 105219;
TN.ETAPA = { ACOLHIMENTO: 679087, P15: 679095, P25: 679096, P45: 679088, P60: 683854, ESPECIAL: 679097, PRONTO: 683839, FEEDBACK: 683840 };
TN.ETAPAS_PRODUCAO_CS = [TN.ETAPA.P15, TN.ETAPA.P25, TN.ETAPA.P45, TN.ETAPA.P60, TN.ETAPA.ESPECIAL];
TN.ETAPA_POR_PRAZO = { '15': TN.ETAPA.P15, '25': TN.ETAPA.P25, '45': TN.ETAPA.P45, '60': TN.ETAPA.P60, 'Especial': TN.ETAPA.ESPECIAL, 'especial': TN.ETAPA.ESPECIAL };
TN.PRAZO_DA_ETAPA = { [TN.ETAPA.P15]: 15, [TN.ETAPA.P25]: 25, [TN.ETAPA.P45]: 45, [TN.ETAPA.P60]: 60, [TN.ETAPA.ESPECIAL]: null };
TN.NOME_ETAPA = { 679087: 'Acolhimento', 679095: 'Em produção - 15 dias', 679096: 'Em produção - 25 dias', 679088: 'Em produção - 45 dias', 683854: 'Em produção - 60 dias', 679097: 'Em produção - Prazo especial', 683839: 'Pedido pronto', 683840: 'Coleta de feedback' };
// Campos customizados do negócio (22/09/2026)
TN.CAMPO = { PRAZO_CS: 793911, DATA_PROMETIDA: 793910, ENDERECO_ENTREGA: 793915, RESPONSAVEL: 793914, BRIEFING_OK: 793912 };

// Cadência: dia (contado da entrada na etapa) de cada toque. 15/25/45/pronto vêm da descrição das etapas no PipeRun;
// 60, especial e feedback são PROPOSTA (pendência 5).
TN.CADENCIA = {
  [TN.ETAPA.P15]: [3, 7, 11, 15],
  [TN.ETAPA.P25]: [5, 10, 18, 22],
  [TN.ETAPA.P45]: [15, 25, 35, 40],
  [TN.ETAPA.P60]: [15, 30, 45, 55],
  [TN.ETAPA.ESPECIAL]: [7, 14, 21, 28, 35, 42],
  [TN.ETAPA.PRONTO]: [10, 20, 30],
  [TN.ETAPA.FEEDBACK]: [3, 7],
};

// Prazo em dias -> etapa de cadência. Sem campo Prazo CS, usa a Data Prometida (dias até ela, contados da criação).
TN.etapaDoPrazo = (prazoCs, dataPrometida, criadoEm, agoraMs) => {
  const v = String(prazoCs || '').trim();
  if (v && TN.ETAPA_POR_PRAZO[v]) return { etapa: TN.ETAPA_POR_PRAZO[v], prazo: v, origem: 'campo Prazo CS' };
  const m = String(dataPrometida || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const c = String(criadoEm || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && c) {
    const dias = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+c[1], +c[2] - 1, +c[3])) / 864e5);
    const faixa = dias <= 18 ? '15' : dias <= 33 ? '25' : dias <= 50 ? '45' : '60';
    return { etapa: TN.ETAPA_POR_PRAZO[faixa], prazo: faixa, origem: 'Data Prometida (' + dias + ' dias)' };
  }
  return { etapa: TN.ETAPA.P45, prazo: '45', origem: 'padrão (sem Prazo CS nem Data Prometida)' };
};

// ----- funil Produção (40828): etapa -> status dito ao cliente -----
TN.PIPELINE_PRODUCAO = 40828;
TN.STATUS_PRODUCAO = [
  { chave: 'confirmado', ordem: 1, etapas: [227818, 701570, 276169, 227821], texto: 'pedido confirmado, entrando na fila de preparação' },
  { chave: 'aguardando_cliente', ordem: 1, etapas: [276168, 614424], texto: 'aguardando uma confirmação sua para seguir' },
  { chave: 'arte', ordem: 2, etapas: [378333, 276170, 287825, 378332, 565805], texto: 'com a equipe de criação, preparando a arte e a ficha técnica' },
  { chave: 'fila', ordem: 3, etapas: [276209, 607611, 607573, 607574], texto: 'na fila de produção, dentro do prazo' },
  { chave: 'em_producao', ordem: 4, etapas: [227822, 525029], texto: 'em produção' },
  { chave: 'finalizando', ordem: 5, etapas: [550095, 550096], texto: 'finalizando, falta pouco' },
  { chave: 'pronto', ordem: 6, etapas: [542375, 227824, 512622], texto: 'pronto' },
  { chave: 'expedicao', ordem: 7, etapas: [410921, 614169], texto: 'na expedição, sendo embalado' },
  { chave: 'a_caminho', ordem: 8, etapas: [410415], texto: 'a caminho' },
  { chave: 'entregue', ordem: 9, etapas: [227825, 410416], texto: 'entregue' },
];
TN.PENDENCIA_FINANCEIRA = [227824, 512622]; // COBRANÇA PGTO FINAL, INADIMPLENTES 2ª PARCELA
TN.statusProducao = (stageId) => {
  const id = Number(stageId);
  for (const s of TN.STATUS_PRODUCAO) if (s.etapas.includes(id)) return { chave: s.chave, ordem: s.ordem, texto: s.texto, financeiro: TN.PENDENCIA_FINANCEIRA.includes(id) };
  return { chave: 'desconhecido', ordem: 0, texto: 'em andamento, dentro do que foi combinado', financeiro: false };
};

// ----- estado do contato (atributos do Chatwoot) -----
TN.lerToques = (attrs) => String((attrs && attrs.toninho_toques) || '').split(',').map(s => s.trim()).filter(Boolean);
TN.marcarToque = (attrs, passo) => { const t = TN.lerToques(attrs); if (!t.includes(passo)) t.push(passo); return t.join(','); };

// ----- decisão do próximo passo (coração da régua) -----
// Entrada (tudo já lido pelo nó): deal do CS, status de Produção, atributos do contato, estado da conversa, agora.
// Saída: { acao, ... } ou { acao: 'nada', motivo }. NUNCA manda duas coisas no mesmo ciclo para o mesmo negócio.
//   acao: 'acolher' | 'toque' | 'pronto' | 'entregue_nps' | 'lembrete_nps' | 'encerrar' | 'nada'
TN.decidir = (ctx) => {
  const { deal, producao, attrs, conversa, agoraMs, cfg } = ctx;
  const etapa = Number(deal.stage_id);
  const regua = String((attrs && attrs.toninho_regua) || '');
  if (regua === 'optout' || regua === 'encerrado') return { acao: 'nada', motivo: 'régua ' + regua };
  if (conversa && conversa.optout) return { acao: 'nada', motivo: 'etiqueta opt-out/sem-followup' };
  if (conversa && conversa.humanoFalando) return { acao: 'nada', motivo: 'conversa aberta com humano (' + conversa.humanoFalando + ')' };
  if (conversa && conversa.escalada) return { acao: 'nada', motivo: 'escalada ao humano em aberto' };
  if (conversa && conversa.clienteEsperando) return { acao: 'nada', motivo: 'cliente falou por último: a Conversa responde, não a Régua' };
  const gapOk = TN.horasDesdeIso(attrs && attrs.toninho_passo_em, agoraMs) >= (cfg.GAP_MIN_H || 20);
  const toques = TN.lerToques(attrs);
  const st = producao || TN.statusProducao(null);

  // 1. Acolhimento: primeira mensagem, uma vez só.
  if (etapa === TN.ETAPA.ACOLHIMENTO) {
    if (toques.includes('acolhimento')) return { acao: 'nada', motivo: 'acolhido, aguardando mover (campo de prazo ausente?)' };
    return { acao: 'acolher', passo: 'acolhimento' };
  }

  // 2. Produção chegou em pronto/expedição/a caminho enquanto o CS ainda está "Em produção": avisa e move.
  if (TN.ETAPAS_PRODUCAO_CS.includes(etapa)) {
    if (st.ordem >= 9) return gapOk ? { acao: 'entregue_nps', passo: 'entregue', moverPara: TN.ETAPA.FEEDBACK } : { acao: 'nada', motivo: 'entregue, mas gap < 20h' };
    if (st.ordem >= 6) return gapOk ? { acao: 'pronto', passo: 'pronto', moverPara: TN.ETAPA.PRONTO } : { acao: 'nada', motivo: 'pronto, mas gap < 20h' };
    const dias = TN.diasDesde(deal.last_stage_updated_at || deal.stage_changed_at || deal.updated_at, agoraMs);
    const cad = TN.CADENCIA[etapa] || [];
    for (let i = 0; i < cad.length; i++) {
      const passo = 'p' + (i + 1);
      if (toques.includes(passo)) continue;
      if (dias !== null && dias >= cad[i]) return gapOk ? { acao: 'toque', passo, dia: cad[i], diasNaEtapa: dias, especial: etapa === TN.ETAPA.ESPECIAL } : { acao: 'nada', motivo: 'toque ' + passo + ' devido, mas gap < 20h' };
      return { acao: 'nada', motivo: 'próximo toque ' + passo + ' no dia ' + cad[i] + ' (hoje é dia ' + dias + ')' };
    }
    return { acao: 'nada', motivo: 'cadência completa; aguardando produção ficar pronta (' + st.chave + ')' };
  }

  // 3. Pedido pronto: expedição/a caminho são avisos extras; entregue abre o NPS; senão D10/D20/D30 "já chegou?".
  if (etapa === TN.ETAPA.PRONTO) {
    if (st.ordem >= 9) return gapOk ? { acao: 'entregue_nps', passo: 'entregue', moverPara: TN.ETAPA.FEEDBACK } : { acao: 'nada', motivo: 'entregue, mas gap < 20h' };
    if (st.chave === 'a_caminho' && !toques.includes('a_caminho')) return gapOk ? { acao: 'toque', passo: 'a_caminho', statusExtra: true } : { acao: 'nada', motivo: 'a caminho, mas gap < 20h' };
    const dias = TN.diasDesde(deal.last_stage_updated_at || deal.stage_changed_at || deal.updated_at, agoraMs);
    const cad = TN.CADENCIA[etapa];
    for (let i = 0; i < cad.length; i++) {
      const passo = 'chegou' + (i + 1);
      if (toques.includes(passo)) continue;
      if (dias !== null && dias >= cad[i]) return gapOk ? { acao: 'toque', passo, dia: cad[i], diasNaEtapa: dias, perguntaEntrega: true } : { acao: 'nada', motivo: passo + ' devido, mas gap < 20h' };
      return { acao: 'nada', motivo: 'próximo "já chegou?" no dia ' + cad[i] + ' (hoje é dia ' + dias + ')' };
    }
    return { acao: 'nada', motivo: '3 perguntas de entrega sem resposta; Vinícius decide (nota já deixada)' };
  }

  // 4. Coleta de feedback: NPS pedido; lembretes D+3 e D+7; depois encerra.
  if (etapa === TN.ETAPA.FEEDBACK) {
    if (attrs && attrs.nps_nota !== undefined && attrs.nps_nota !== null && attrs.nps_nota !== '') {
      return toques.includes('encerrar') ? { acao: 'nada', motivo: 'encerrado' } : { acao: 'encerrar', passo: 'encerrar' };
    }
    if (!toques.includes('entregue')) return gapOk ? { acao: 'entregue_nps', passo: 'entregue' } : { acao: 'nada', motivo: 'NPS inicial, mas gap < 20h' };
    const dias = TN.diasDesde(deal.last_stage_updated_at || deal.stage_changed_at || deal.updated_at, agoraMs);
    const cad = TN.CADENCIA[etapa];
    for (let i = 0; i < cad.length; i++) {
      const passo = 'nps' + (i + 1);
      if (toques.includes(passo)) continue;
      if (dias !== null && dias >= cad[i]) return gapOk ? { acao: 'lembrete_nps', passo, dia: cad[i] } : { acao: 'nada', motivo: passo + ' devido, mas gap < 20h' };
      return { acao: 'nada', motivo: 'próximo lembrete de NPS no dia ' + cad[i] + ' (hoje é dia ' + dias + ')' };
    }
    return toques.includes('encerrar') ? { acao: 'nada', motivo: 'encerrado sem NPS' } : { acao: 'encerrar', passo: 'encerrar', semNps: true };
  }
  return { acao: 'nada', motivo: 'etapa fora do fluxo (' + etapa + ')' };
};

// ----- textos dos toques (texto livre, dentro da janela). Tom por tipo de cliente. -----
TN.informal = (tipo) => ['terceirao', 'faculdade', 'pessoa_fisica'].includes(String(tipo || '').toLowerCase());
TN.texto = (acao, v) => {
  const inf = TN.informal(v.tipo);
  const nome = v.nome ? (inf ? 'Oi ' + v.nome + '!' : 'Olá ' + v.nome + ',') : (inf ? 'Oi!' : 'Olá,');
  const ped = v.pedido ? ' ' + v.pedido : '';
  const resumo = v.resumo ? ' (' + v.resumo + ')' : '';
  const prazo = v.prazo ? (inf ? ' O prazo combinado é de ' + v.prazo + ' dias.' : ' O prazo combinado é de ' + v.prazo + ' dias corridos a partir da aprovação.') : '';
  const rast = v.rastreio ? ' Rastreio: ' + v.rastreio + '.' : '';
  switch (acao) {
    case 'acolher':
      return inf
        ? nome + ' Toninho aqui, da T&M 👋 Vou acompanhar o pedido' + ped + resumo + ' da turma com você até chegar.' + prazo + ' Tem alguma data que vocês precisam ter em mãos? Me conta que eu já anoto.'
        : nome + ' aqui é o Toninho, da T&M. Eu vou acompanhar o pedido' + ped + resumo + ' com você até a entrega, direto por aqui.' + prazo + ' Vocês têm alguma data limite para receber? Se tiver, me avisa que já deixo registrado.';
    case 'toque':
      if (v.perguntaEntrega) return inf
        ? nome + ' O pedido' + ped + ' já saiu daqui. Chegou aí? Me conta como ficou!'
        : nome + ' o pedido' + ped + ' já saiu da nossa expedição. Ele chegou? Se puder, me conta como ficou o resultado.';
      if (v.statusExtra) return inf
        ? nome + ' O pedido' + ped + ' foi coletado e tá a caminho.' + rast + ' Quando chegar, pede pra quem receber conferir o volume e, se der, gravar um vídeo abrindo a caixa.'
        : nome + ' o pedido' + ped + ' foi coletado e está a caminho.' + rast + ' Quando chegar, peça para quem receber conferir o volume e, se possível, gravar um vídeo abrindo a caixa: é a garantia de vocês para qualquer imprevisto.';
      if (v.semMudanca) return inf
        ? nome + ' O pedido' + ped + ' segue ' + v.status + ', sem novidade e dentro do prazo. Te aviso quando mudar de fase.'
        : nome + ' o pedido' + ped + ' segue ' + v.status + ', sem novidade e dentro do prazo. Te aviso assim que mudar de fase.';
      return inf
        ? nome + ' Posição do pedido' + ped + ': ' + v.status + '. Tá dentro do prazo. Se precisar de algo é só chamar.'
        : nome + ' passando com a posição do pedido' + ped + ': ' + v.status + '. Segue dentro do prazo combinado. Qualquer dúvida é só responder aqui.';
    case 'pronto':
      return (inf ? nome + ' Boa notícia: ' : nome + ' boa notícia: ') + 'o pedido' + ped + ' está pronto! Agora ele segue para a expedição e te aviso quando sair.' + (v.financeiro ? ' O financeiro vai alinhar a parcela final com vocês por aqui.' : '');
    case 'entregue_nps':
      return inf
        ? nome + ' Consta aqui que o pedido' + ped + ' foi entregue. Chegou tudo certo? E, pra fechar: de 0 a 10, o quanto você recomendaria a T&M pra outra turma? Pode mandar também o que achou das peças.'
        : nome + ' consta aqui que o pedido' + ped + ' foi entregue. Chegou tudo certo? Para fechar o acompanhamento: de 0 a 10, o quanto você recomendaria a T&M para outra empresa? Se quiser, me diz também o que foi melhor e o que podia melhorar.';
    case 'lembrete_nps':
      return inf
        ? nome + ' Ainda não recebi sua nota do pedido' + ped + '. É rapidinho: de 0 a 10, o quanto você recomendaria a T&M?'
        : nome + ' ainda não recebi a sua avaliação do pedido' + ped + '. Responder leva 10 segundos: de 0 a 10, o quanto você recomendaria a T&M?';
    case 'encerrar':
      return v.semNps
        ? (inf ? nome + ' Vou encerrar o acompanhamento do pedido' + ped + ' por aqui. Qualquer coisa sobre ele é só responder esta conversa que eu retomo.' : nome + ' encerro o acompanhamento do pedido' + ped + ' por aqui. Qualquer coisa sobre ele, é só responder esta conversa que eu retomo. Obrigado pela confiança.')
        : (inf ? 'Obrigado, ' + (v.nome || 'pessoal') + '! Encerro o acompanhamento do pedido' + ped + ' por aqui. Qualquer coisa é só responder esta conversa que eu retomo. Foi um prazer acompanhar vocês.' : 'Obrigado, ' + (v.nome || 'e até a próxima') + '. Encerro o acompanhamento do pedido' + ped + ' por aqui. Qualquer coisa sobre ele, é só responder esta conversa que eu retomo. Foi um prazer acompanhar vocês.');
    default:
      return '';
  }
};

// ----- guardas da conversa (regra dura = código) -----
TN.RE_OPTOUT = /\b(para|pare|parem|parar)\s+de\s+(me\s+)?(mandar|enviar)|n[aã]o\s+quero\s+mais\s+(receber|mensagem|mensagens)|me\s+tira\s+da\s+lista|descadastr|sair\s+da\s+lista|cancela\s+(as\s+)?mensagens|\bremov(a|e)\s+meu\s+n[uú]mero/i;
TN.RE_HUMANO = /\b(falar|conversar)\s+com\s+(um\s+|uma\s+|o\s+|a\s+|algu[eé]m|atendente|pessoa|humano|vendedor|vendedora|gerente|vin[ií]cius)|\batendente\b|\bhumano\b|\bgerente\b/i;
TN.RE_RECLAMACAO = /\b(p[eé]ssim|absurd|atrasad|atraso|errad|faltou|faltando|defeit|rasgad|manchad|veio diferente|n[aã]o chegou|n[aã]o recebi|cancelar|reembolso|estorno|procon|reclama|decepcion|horr[ií]vel|vergonha)/i;
TN.RE_ALTERACAO = /\b(mudar|alterar|trocar|troca|acrescentar|adicionar|tirar|remover)\b.*\b(pedido|tamanho|quantidade|cor|arte|logo|endere[çc]o)|\b(boleto|segunda via|pix|pagamento|parcela|nota fiscal|\bnf\b)/i;
TN.notaNps = (texto) => {
  const t = String(texto || '').trim();
  const m = t.match(/(?:^|\D)(10|[0-9])(?:\D|$)/);
  if (!m) return null;
  const n = +m[1];
  // "nota 9", "9", "dou um 10", "9/10": aceita; evita pegar número de pedido/quantidade ("40 camisetas")
  if (/\d{3,}/.test(t) && !/\b(nota|avalia|recomend|dou|daria)\b/i.test(t) && !/^\s*(10|[0-9])\s*(\/\s*10)?\s*$/.test(t)) return null;
  return n;
};
TN.guardas = (msg) => {
  const t = String(msg || '');
  if (TN.RE_OPTOUT.test(t)) return 'optout';
  if (TN.RE_HUMANO.test(t) || TN.RE_RECLAMACAO.test(t) || TN.RE_ALTERACAO.test(t)) return 'escalar';
  return null;
};
TN.classeNps = (n) => (n >= 9 ? 'promotor' : n >= 7 ? 'neutro' : 'detrator');
// <<< TONINHO COMUM (fim)

if (typeof module !== 'undefined') module.exports = TN;

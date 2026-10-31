// Linhas do Excel da Capacidade COM FÓRMULAS — contas puras (sem DOM), testadas em tests/capacidade-excel.test.js.
//
// Cada mês ocupa 5 colunas: Serviços (h), I&D (h), Total (h), Capacidade (h) e Ocupação. As horas por consultor e as horas projetadas das
// oportunidades e da folga são VALORES (vêm de contas feitas na app: agenda, CRM, reprevisão); tudo o que se deriva delas é uma FÓRMULA do
// Excel — os totais, a ocupação, o total + projeção e a harmonização (o que excede a capacidade transita para o mês seguinte) — para
// poder ser conferido e alterado no próprio Excel. Cada célula de fórmula leva também o valor calculado ("v"), para quem abre o ficheiro
// sem recalcular; o Excel recalcula tudo ao abrir. As contas das fórmulas são as mesmas de CapacidadeComercial.harmonizar.
const CapacidadeExcel = {
  NUM: '#,##0.0;-#,##0.0;"–"',
  X() { return typeof XlsxEstilo !== 'undefined' ? XlsxEstilo : require('./xlsx-estilo.js'); },
  col(mi, k) { return 2 + mi * 5 + k; },   // k: 0 Serviços, 1 I&D, 2 Total, 3 Capacidade, 4 Ocupação (as colunas A e B são o nome e a equipa)

  // dados: { consultores: [{ nome, equipa, meses: [{ s, i, t, cap }] }], nMeses, projecao: null | { op: [h] | null, folga: [h] | null, desde } }
  //   desde = índice do primeiro mês a harmonizar (os anteriores já passaram), ou null se não há linha harmonizada.
  // opcoes: { primeiraLinha (1-based, a do primeiro consultor), classe(pct) → 'critico' | 'aviso' | …, COR: { classe: [fundo, cor] } }
  // Devolve { linhas, notas }.
  construir(dados, opcoes) {
    const X = this.X(), NUM = this.NUM, COR = opcoes.COR, M = dados.nMeses, n = dados.consultores.length;
    const r1 = (v) => Math.round(v * 10) / 10, c6 = (v) => Math.round(v * 1e6) / 1e6;
    const R = (linha, mi, k) => X.ref(linha, this.col(mi, k));
    const pctDe = (t, cap) => cap > 0 ? t / cap : (t > 0 ? Infinity : 0);
    const primeira = opcoes.primeiraLinha, rTotal = primeira + n;
    const FUNDO_T = 'DCE8F3', FUNDO_P = 'EEF3F8', COR_P = '2A6A9A', CINZA = '6B7280';
    const linhas = [], notas = [];

    const h = (v, f, e) => ({ v, f, e: Object.assign({ formato: NUM, alinha: 'right' }, e) });
    const vazio = (e) => ({ v: '', e });
    // Ocupação = Total ÷ Capacidade (fórmula), colorida pela classe de ocupação quando "cor" é verdadeiro.
    const ocupacao = (linha, mi, t, cap, borda, fundo, cor, extra) => {
      const T = R(linha, mi, 2), C = R(linha, mi, 3);
      const semDados = cap <= 0 && t <= 0, pct = pctDe(t, cap);
      const e = { alinha: 'center', borda, fundo: fundo || null };
      if (semDados) Object.assign(e, { cor: CINZA });
      else if (cor) { const cls = opcoes.classe(pct); Object.assign(e, { formato: '0%', negrito: true, fundo: COR[cls][0], cor: COR[cls][1] }); }
      else Object.assign(e, { formato: '0%' }, extra || {});
      return { f: `IF(AND(${C}<=0,${T}<=0),"–",IF(${C}>0,${T}/${C},"n/d"))`, v: semDados ? '–' : (isFinite(pct) ? c6(pct) : 'n/d'), e };
    };

    // ---- valores de entrada (arredondados a 0,1 h, tal como aparecem) e totais ----
    const dado = dados.consultores.map(c => c.meses.map(m => ({ s: r1(m.s), i: r1(m.i), t: r1(m.t), cap: r1(m.cap) })));
    const tot = Array.from({ length: M }, (_, mi) => {
      const o = {};
      ['s', 'i', 't', 'cap'].forEach(k => { o[k] = c6(dado.reduce((a, c) => a + c[mi][k], 0)); });
      return o;
    });

    // ---- consultores ----
    dados.consultores.forEach((c, idx) => {
      const r = primeira + idx, zebra = idx % 2 ? 'F7F9FC' : null, base = { borda: 'fina', fundo: zebra };
      const cel = [{ v: c.nome, e: { negrito: true, borda: 'fina', fundo: zebra } }, { v: c.equipa, e: { borda: 'fina', fundo: zebra } }];
      for (let mi = 0; mi < M; mi++) {
        const d = dado[idx][mi];
        cel.push(h(d.s, null, base), h(d.i, null, base), h(d.t, null, Object.assign({ negrito: true }, base)), h(d.cap, null, base), ocupacao(r, mi, d.t, d.cap, 'fina', zebra, true));
      }
      linhas.push({ altura: 18, celulas: cel });
    });

    // ---- total: somas das linhas dos consultores ----
    {
      const cel = [{ v: `Total (${n} consultor${n === 1 ? '' : 'es'})`, e: { negrito: true, fundo: FUNDO_T, borda: 'topo' }, colspan: 2 }];
      for (let mi = 0; mi < M; mi++) {
        ['s', 'i', 't', 'cap'].forEach((key, k) => cel.push(h(tot[mi][key], `SUM(${R(primeira, mi, k)}:${R(primeira + n - 1, mi, k)})`, { borda: 'topo', negrito: true, fundo: FUNDO_T })));
        cel.push(ocupacao(rTotal, mi, tot[mi].t, tot[mi].cap, 'topo', FUNDO_T, false, { negrito: true }));
      }
      linhas.push({ altura: 20, celulas: cel });
    }

    const proj = dados.projecao;
    if (proj) {
      let proxima = rTotal + 1, rOp = null, rFolga = null;
      const op = proj.op ? proj.op.map(r1) : null, folga = proj.folga ? proj.folga.map(r1) : null;

      // ---- linhas de projeção: horas (valores) que contam como Serviços; a capacidade é a do total ----
      const linhaProjecao = (rotulo, horas) => {
        const r = proxima++;
        const base = { borda: 'fina', italico: true, cor: COR_P, fundo: FUNDO_P };
        const cel = [{ v: rotulo, e: { negrito: true, italico: true, cor: COR_P, fundo: FUNDO_P, borda: 'fina' }, colspan: 2 }];
        for (let mi = 0; mi < M; mi++) {
          cel.push(h(horas[mi], null, base), vazio({ borda: 'fina', fundo: FUNDO_P }), h(horas[mi], R(r, mi, 0), base), h(tot[mi].cap, R(rTotal, mi, 3), base),
            ocupacao(r, mi, horas[mi], tot[mi].cap, 'fina', FUNDO_P, false, { italico: true, cor: COR_P }));
        }
        linhas.push({ altura: 18, celulas: cel });
        return r;
      };
      if (op) rOp = linhaProjecao('Oportunidades de Serviços (projeção)', op);
      if (folga) rFolga = linhaProjecao('Folga de Serviços adjudicados (projeção)', folga);

      // ---- total + projeção: o total mais as linhas de projeção ----
      const rTP = proxima++;
      const extra = (mi) => (op ? op[mi] : 0) + (folga ? folga[mi] : 0);
      const soma = (mi, k) => [rTotal, rOp, rFolga].filter(x => x !== null).map(r => R(r, mi, k)).join('+');
      const procura = tot.map((t, mi) => c6(t.t + extra(mi)));
      {
        const cel = [{ v: 'Total + projeção', e: { negrito: true, fundo: FUNDO_T, borda: 'topo' }, colspan: 2 }];
        for (let mi = 0; mi < M; mi++) {
          const e = { borda: 'topo', negrito: true, fundo: FUNDO_T };
          cel.push(h(c6(tot[mi].s + extra(mi)), soma(mi, 0), e), h(tot[mi].i, R(rTotal, mi, 1), e), h(procura[mi], soma(mi, 2), e), h(tot[mi].cap, R(rTotal, mi, 3), e),
            ocupacao(rTP, mi, procura[mi], tot[mi].cap, 'topo', FUNDO_T, true));
        }
        linhas.push({ altura: 20, celulas: cel });
      }

      // ---- harmonizado: o que excede a capacidade da equipa transita para o mês seguinte ----
      if (proj.desde !== null && proj.desde !== undefined) {
        const rEnt = proxima++, rHar = proxima++, rTra = proxima++;
        const desde = proj.desde;
        const ent = [], har = [], tra = [];
        for (let mi = 0; mi < M; mi++) {
          if (mi < desde) { ent.push(null); tra.push(null); har.push(procura[mi]); continue; }
          const entra = mi === desde ? 0 : tra[mi - 1];
          const fica = Math.min(procura[mi] + entra, tot[mi].cap);
          ent.push(c6(entra)); har.push(c6(fica)); tra.push(c6(Math.max(0, procura[mi] + entra - fica)));
        }
        const rotulo = (texto, extraE) => ({ v: texto, e: Object.assign({ borda: 'fina', italico: true, cor: '374151' }, extraE), colspan: 2 });
        const trans = (r, mi, v, f) => v === null ? { v: '–', e: { alinha: 'center', borda: 'fina', italico: true, cor: CINZA } } : h(v, f, { borda: 'fina', italico: true, cor: '374151' });
        const lEnt = [rotulo('↳ Transitadas do mês anterior')], lHar = [rotulo('Total + projeção (harmonizado)', { negrito: true, italico: false, cor: null, fundo: FUNDO_T })], lTra = [rotulo('↴ A transitar para o mês seguinte')];
        for (let mi = 0; mi < M; mi++) {
          const T = (r) => R(r, mi, 2), anteriorTra = mi > 0 ? R(rTra, mi - 1, 2) : null;
          const vazioN = () => [vazio({ borda: 'fina' }), vazio({ borda: 'fina' })];
          lEnt.push(...vazioN(), trans(rEnt, mi, ent[mi], mi === desde ? null : `${anteriorTra}`), vazio({ borda: 'fina' }), vazio({ borda: 'fina' }));
          lHar.push(vazio({ borda: 'fina', fundo: FUNDO_T }), vazio({ borda: 'fina', fundo: FUNDO_T }),
            h(har[mi], mi < desde ? `${T(rTP)}` : `MIN(${T(rTP)}+${T(rEnt)},${R(rTP, mi, 3)})`, { borda: 'fina', negrito: true, fundo: FUNDO_T }),
            h(tot[mi].cap, R(rTotal, mi, 3), { borda: 'fina', negrito: true, fundo: FUNDO_T }), ocupacao(rHar, mi, har[mi], tot[mi].cap, 'fina', FUNDO_T, true));
          lTra.push(...vazioN(), trans(rTra, mi, tra[mi], `MAX(0,${T(rTP)}+${T(rEnt)}-${T(rHar)})`), vazio({ borda: 'fina' }), vazio({ borda: 'fina' }));
        }
        linhas.push({ altura: 18, celulas: lEnt }, { altura: 20, celulas: lHar }, { altura: 18, celulas: lTra });
      }

      // ---- notas ----
      notas.push('PROJEÇÃO, SUJEITA A ERROS: as linhas de projeção são estimativas, não horas já alocadas; contam como horas de Serviços, com a capacidade da equipa.');
      if (op) notas.push('Oportunidades de Serviços = valor da oportunidade ÷ valor/hora médio dos consultores × probabilidade de sucesso, repartido pela duração prevista; só as das equipas escolhidas (área responsável) e que ainda não são projetos. Valores calculados na aplicação.');
      if (folga) notas.push('Folga de Serviços adjudicados = horas vendidas − reprevisão (já gasto + planeado por realizar) dos projetos de Serviços, repartida pelos dias úteis que faltam e atribuída à equipa do projeto; assume que será usada. Valores calculados na aplicação.');
      notas.push('Total + projeção = Total + oportunidades + folga (fórmulas do Excel).');
      if (proj.desde !== null && proj.desde !== undefined) notas.push('Harmonizado: fica no mês = MÍNIMO(Total + projeção + transitadas do mês anterior; Capacidade); a transitar = Total + projeção + transitadas − o que fica. Só a partir do mês atual e só na Totalidade das horas (fórmulas do Excel).');
    }
    notas.push('Fórmulas: os totais, a ocupação e as linhas de projeção são fórmulas do Excel; as horas por consultor, das oportunidades e da folga são valores calculados na aplicação.');
    return { linhas, notas };
  }
};
if (typeof module !== 'undefined') module.exports = CapacidadeExcel;

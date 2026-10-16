// Agregações puras (sem DOM, sem estado da app) do separador Horas → Análise: recebe uma lista de
// itens { data, horas, pessoa, dept, equipa, projeto, tipo, emProjeto } já filtrada e devolve os
// números/séries que os gráficos desenham. Testado em tests/analise-horas.test.js.
const AnaliseHoras = {
  // Categóricas, ordenadas por contraste entre vizinhas; "Outros" é sempre cinzento (não compete).
  PALETA: ['#2a6ea6', '#e07b39', '#3a9d6b', '#8e5aa8', '#c8951f', '#d0526f', '#2b9fa8', '#7a8b3c'],
  COR_OUTROS: '#9aa7b3',
  MAX_CATEGORIAS: 7,

  _utc(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  _iso(dt) { return dt.toISOString().slice(0, 10); },

  // Segunda-feira da semana a que "iso" pertence.
  segunda(iso) {
    const dt = this._utc(iso);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return this._iso(dt);
  },
  chavePeriodo(iso, gran) { return gran === 'mes' ? iso.slice(0, 7) : this.segunda(iso); },
  rotuloPeriodo(chave, gran) {
    return gran === 'mes' ? `${chave.slice(5)}/${chave.slice(2, 4)}` : `${chave.slice(8)}/${chave.slice(5, 7)}`;
  },
  // Todos os períodos (semanas ou meses) de "de" a "ate", incluindo os sem horas — para o eixo
  // mostrar buracos como buracos em vez de os esconder.
  periodosEntre(de, ate, gran) {
    const out = [];
    let cursor = this._utc(this.chavePeriodo(de, gran) + (gran === 'mes' ? '-01' : ''));
    const fim = this._utc(ate);
    for (let guarda = 0; cursor <= fim && guarda < 800; guarda++) {
      const iso = this._iso(cursor);
      out.push(this.chavePeriodo(iso, gran));
      if (gran === 'mes') cursor.setUTCMonth(cursor.getUTCMonth() + 1); else cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return out;
  },

  // Intervalos predefinidos do seletor de período (datas ISO inclusivas).
  intervaloPreset(preset, hojeISO) {
    const [ano, mes] = hojeISO.split('-').map(Number);
    const ultimo = (a, m) => this._iso(new Date(Date.UTC(a, m, 0)));
    const dia1 = (a, m) => this._iso(new Date(Date.UTC(a, m - 1, 1)));
    if (preset === 'mes') return { de: dia1(ano, mes), ate: ultimo(ano, mes) };
    if (preset === 'mesAnt') { const a = mes === 1 ? ano - 1 : ano, m = mes === 1 ? 12 : mes - 1; return { de: dia1(a, m), ate: ultimo(a, m) }; }
    if (preset === 'trimestre') { const t0 = Math.floor((mes - 1) / 3) * 3 + 1; return { de: dia1(ano, t0), ate: ultimo(ano, t0 + 2) }; }
    if (preset === 'ano') return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
    return null;
  },

  // [{chave, horas}] por ordem decrescente de horas.
  totaisPor(itens, chaveFn) {
    const m = new Map();
    itens.forEach(i => { const k = chaveFn(i); m.set(k, (m.get(k) || 0) + i.horas); });
    return [...m.entries()].map(([chave, horas]) => ({ chave, horas })).sort((a, b) => b.horas - a.horas || String(a.chave).localeCompare(String(b.chave), 'pt'));
  },

  kpis(itens) {
    const horas = itens.reduce((s, i) => s + i.horas, 0);
    const horasProjeto = itens.filter(i => i.emProjeto).reduce((s, i) => s + i.horas, 0);
    return {
      horas,
      pessoas: new Set(itens.map(i => i.pessoa)).size,
      projetos: new Set(itens.filter(i => i.emProjeto).map(i => i.projeto)).size,
      horasProjeto,
      pctProjeto: horas ? horasProjeto / horas : 0,
    };
  },

  // Série temporal empilhada: as MAX_CATEGORIAS categorias com mais horas ficam com cor própria; o
  // resto junta-se em "Outros". {periodos:[chave], categorias:[{chave,cor,total}], valores:{periodo:{cat:h}}, totais:{periodo:h}}
  seriePorCategoria(itens, gran, chaveCatFn, de, ate) {
    const ranking = this.totaisPor(itens, chaveCatFn);
    const topo = ranking.slice(0, this.MAX_CATEGORIAS);
    const nomesTopo = new Set(topo.map(t => t.chave));
    const categorias = topo.map((t, idx) => ({ chave: t.chave, cor: this.PALETA[idx % this.PALETA.length], total: t.horas }));
    const resto = ranking.slice(this.MAX_CATEGORIAS).reduce((s, t) => s + t.horas, 0);
    if (resto > 0) categorias.push({ chave: 'Outros', cor: this.COR_OUTROS, total: resto });
    const periodos = this.periodosEntre(de, ate, gran);
    const valores = {}, totais = {};
    periodos.forEach(p => { valores[p] = {}; totais[p] = 0; });
    itens.forEach(i => {
      const p = this.chavePeriodo(i.data, gran);
      if (!(p in valores)) return;
      const cat = nomesTopo.has(chaveCatFn(i)) ? chaveCatFn(i) : 'Outros';
      valores[p][cat] = (valores[p][cat] || 0) + i.horas;
      totais[p] += i.horas;
    });
    return { periodos, categorias, valores, totais };
  },
  // Composição do total: as "max" categorias com mais horas ficam com cor própria (mesma paleta das barras), o
  // resto junta-se em "Outros" (cinzento). [{chave, horas, pct, cor}] por ordem decrescente, "Outros" no fim.
  composicao(itens, chaveFn, max) {
    const total = itens.reduce((s, i) => s + i.horas, 0);
    const n = max || this.MAX_CATEGORIAS;
    const ranking = this.totaisPor(itens, chaveFn);
    const fatias = ranking.slice(0, n).map((t, idx) => ({ chave: t.chave, horas: t.horas, cor: this.PALETA[idx % this.PALETA.length] }));
    const resto = ranking.slice(n).reduce((s, t) => s + t.horas, 0);
    if (resto > 0) fatias.push({ chave: 'Outros', horas: resto, cor: this.COR_OUTROS });
    return fatias.map(f => Object.assign(f, { pct: total ? f.horas / total : 0 }));
  },

  // Por pessoa: horas em projeto vs. outras atividades (formação, comercial, interno…). As "max" pessoas com mais
  // horas; "restantes" diz quantas ficaram de fora.
  projetoVsOutras(itens, max) {
    const n = max || 12;
    const m = new Map();
    itens.forEach(i => {
      const o = m.get(i.pessoa) || { pessoa: i.pessoa, projeto: 0, outras: 0 };
      if (i.emProjeto) o.projeto += i.horas; else o.outras += i.horas;
      m.set(i.pessoa, o);
    });
    const todas = [...m.values()].map(o => Object.assign(o, { total: o.projeto + o.outras }))
      .sort((a, b) => b.total - a.total || a.pessoa.localeCompare(b.pessoa, 'pt'));
    return { linhas: todas.slice(0, n), restantes: Math.max(0, todas.length - n) };
  },

  // Horas por cliente (só registos em projeto; projetos sem cliente juntam-se em "Sem cliente").
  porCliente(itens, max) {
    return this.composicao(itens.filter(i => i.emProjeto), i => i.cliente || 'Sem cliente', max || 8);
  },

  // Fatias de um gráfico circular: para cada categoria, onde começa e quanto ocupa (frações de 0 a 1).
  fatiasCirculares(fatias) {
    let acumulado = 0;
    return fatias.filter(f => f.pct > 0).map(f => { const r = { chave: f.chave, cor: f.cor, inicio: acumulado, pct: f.pct }; acumulado += f.pct; return r; });
  },
  // ---------- Mais gráficos: preenchimento, real vs previsto, mapa de calor, dia da semana, acumulado ----------

  // pessoas: [{nome, esperado, registado}] (horas esperadas = dias úteis × 8h, sem férias/feriados). Devolve as "max" com
  // menor preenchimento primeiro; pct = registado/esperado (pode passar de 1). Pessoas sem horas esperadas ficam de fora.
  preenchimento(pessoas, max) {
    const n = max || 12;
    const todas = pessoas.filter(p => p.esperado > 0)
      .map(p => Object.assign({}, p, { pct: p.registado / p.esperado }))
      .sort((a, b) => a.pct - b.pct || a.nome.localeCompare(b.nome, 'pt'));
    const esperado = todas.reduce((s, p) => s + p.esperado, 0), registado = todas.reduce((s, p) => s + p.registado, 0);
    return { linhas: todas.slice(0, n), restantes: Math.max(0, todas.length - n), pctGlobal: esperado ? registado / esperado : 0, esperado, registado };
  },

  // projetos: [{chave, rotulo, real, previsto, vendido|null}] → os "max" com mais horas reais; pct = real/previsto (null sem previsto).
  previstoVsReal(projetos, max) {
    const n = max || 8;
    const todos = projetos.map(p => Object.assign({}, p, { pct: p.previsto > 0 ? p.real / p.previsto : null }))
      .sort((a, b) => b.real - a.real || String(a.rotulo).localeCompare(String(b.rotulo), 'pt'));
    return { linhas: todos.slice(0, n), restantes: Math.max(0, todos.length - n) };
  },

  // Matriz pessoa × período (horas): as "max" pessoas com mais horas. {periodos, linhas:[{pessoa,total,valores:[h…]}], restantes}
  matrizPessoaSemana(itens, de, ate, gran, max) {
    const n = max || 15;
    const periodos = this.periodosEntre(de, ate, gran);
    const idx = new Map(periodos.map((p, i) => [p, i]));
    const m = new Map();
    itens.forEach(i => {
      const k = idx.get(this.chavePeriodo(i.data, gran));
      if (k === undefined) return;
      const o = m.get(i.pessoa) || { pessoa: i.pessoa, total: 0, valores: periodos.map(() => 0) };
      o.valores[k] += i.horas; o.total += i.horas;
      m.set(i.pessoa, o);
    });
    const todas = [...m.values()].sort((a, b) => b.total - a.total || a.pessoa.localeCompare(b.pessoa, 'pt'));
    return { periodos, linhas: todas.slice(0, n), restantes: Math.max(0, todas.length - n) };
  },

  // Horas por dia da semana (segunda = 0 … domingo = 6).
  porDiaSemana(itens) {
    const rotulos = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const horas = [0, 0, 0, 0, 0, 0, 0];
    itens.forEach(i => { horas[(this._utc(i.data).getUTCDay() + 6) % 7] += i.horas; });
    return horas.map((h, d) => ({ dia: d, rotulo: rotulos[d], horas: h }));
  },

  // Horas acumuladas por semana: reais (registos) vs previstas (cada tarefa reparte as suas horas igualmente pelos dias úteis
  // do prazo). registos: [{data, horas}]; tarefas: [{inicio, fim, horas}]. A linha real pára na semana de "hojeISO" (null depois).
  acumuladoSemanal({ registos, tarefas, hojeISO }) {
    const datas = [...registos.map(r => r.data), ...tarefas.flatMap(t => [t.inicio, t.fim])].filter(Boolean).sort();
    if (!datas.length) return { semanas: [], real: [], previsto: [], semanaHoje: null };
    const semanas = this.periodosEntre(this.segunda(datas[0]), this.segunda(datas[datas.length - 1]), 'semana');
    const idx = new Map(semanas.map((s, i) => [s, i]));
    const real = semanas.map(() => 0), previsto = semanas.map(() => 0);
    registos.forEach(r => { const k = idx.get(this.segunda(r.data)); if (k !== undefined) real[k] += r.horas; });
    tarefas.forEach(t => {
      if (!t.inicio || !t.fim || !(t.horas > 0) || t.fim < t.inicio) return;
      const dias = [];
      for (let d = this._utc(t.inicio), fim = this._utc(t.fim), guarda = 0; d <= fim && guarda < 3000; d.setUTCDate(d.getUTCDate() + 1), guarda++) {
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) dias.push(this._iso(d));
      }
      if (!dias.length) return;
      dias.forEach(iso => { const k = idx.get(this.segunda(iso)); if (k !== undefined) previsto[k] += t.horas / dias.length; });
    });
    const semanaHoje = hojeISO ? this.segunda(hojeISO) : null;
    let ar = 0, ap = 0;
    return {
      semanas, semanaHoje,
      real: real.map((h, i) => { ar += h; return semanaHoje && semanas[i] > semanaHoje ? null : ar; }),
      previsto: previsto.map(h => { ap += h; return ap; })
    };
  },
};
if (typeof module !== 'undefined') module.exports = AnaliseHoras;

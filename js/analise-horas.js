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
};
if (typeof module !== 'undefined') module.exports = AnaliseHoras;

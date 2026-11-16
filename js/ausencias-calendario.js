// Calendário de Ausências (Equipa → Ausências): regras puras, sem DOM, testadas em tests/ausencias-calendario.test.js.
// O ecrã está em App (renderCalendarioFerias e vizinhas — os nomes "Ferias" ficaram de quando o calendário só marcava férias).
//
// Ideias:
//  - no ecrã, cada dia tem no máximo um tipo de ausência: a "seleção" é um Map dia(ISO) → tipo;
//  - nada se grava ao clicar: ao Submeter compara-se a seleção com o que está gravado e só segue a DIFERENÇA;
//  - a diferença mexe o MENOS possível: só se eliminam os registos que contêm um dia alterado, e só se criam períodos para
//    os dias que ficaram sem registo. Um período já aprovado em que ninguém tocou fica como está (não volta a aprovação);
//  - fins de semana e feriados ("bloqueados") não se marcam nem contam, mas também não partem um período ao meio.
const AusenciasCal = {
  // Os tipos que se podem marcar no calendário. Os registos podem ter outros nomes (vêm dos tipos de trabalho que criam
  // ausência, ex.: "Baixa Médica", "Ausência justificada"): mantêm o nome e caem numa destas categorias para a cor e o resumo.
  TIPOS: ['Férias', 'Baixa', 'Formação', 'Outro'],
  _n(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
  categoria(tipo) {
    const t = this._n(tipo);
    if (t.includes('feria')) return 'Férias';
    if (t.includes('baixa')) return 'Baixa';
    if (t.includes('forma')) return 'Formação';
    return 'Outro';
  },
  // Sufixo de classe CSS da categoria (ver .dia-ferias.t-… em css/style.css).
  classe(tipo) { return { 'Férias': 'ferias', 'Baixa': 'baixa', 'Formação': 'formacao', 'Outro': 'outro' }[this.categoria(tipo)]; },

  // ---------- datas (ISO "AAAA-MM-DD", em UTC para não haver saltos de hora de verão) ----------
  _data(iso) { const [a, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); },
  _iso(dt) { return dt.toISOString().slice(0, 10); },
  somarDias(iso, n) { const dt = this._data(iso); dt.setUTCDate(dt.getUTCDate() + n); return this._iso(dt); },
  // Todos os dias de um registo (dataInicio a dataFim, inclusive). Protegido contra datas trocadas ou absurdas.
  diasDe(a) {
    const out = [];
    if (!a || !a.dataInicio || !a.dataFim || a.dataFim < a.dataInicio) return out;
    for (let d = a.dataInicio, g = 0; d <= a.dataFim && g < 800; d = this.somarDias(d, 1), g++) out.push(d);
    return out;
  },
  validas(ausencias) { return (ausencias || []).filter(a => a && a.estado !== 'rejeitada'); },

  // Mapa dia → { tipo, estado, id } do que está GRAVADO (pendente ou aprovada; as rejeitadas não contam). Se dois registos
  // se sobrepõem, vale o que começa mais tarde.
  mapaDias(ausencias) {
    const m = new Map();
    this.validas(ausencias).slice().sort((a, b) => String(a.dataInicio).localeCompare(String(b.dataInicio)))
      .forEach(a => this.diasDe(a).forEach(d => m.set(d, { tipo: a.tipo || 'Outro', estado: a.estado, id: a.id })));
    return m;
  },
  // A seleção inicial do ecrã: dia → tipo, a partir do que está gravado.
  selecaoDeAusencias(ausencias) {
    const s = new Map();
    this.mapaDias(ausencias).forEach((v, d) => s.set(d, v.tipo));
    return s;
  },

  // Agrupa dias (Map dia → tipo) em períodos contínuos do mesmo tipo. Um dia bloqueado (fim de semana/feriado) no meio não
  // parte o período nem o estende: os períodos começam e acabam sempre em dias úteis. Um dia útil sem marca, ou de outro
  // tipo, parte o período.
  intervalos(dias, bloqueado) {
    const datas = [...dias.keys()].filter(d => !bloqueado(d)).sort();
    if (!datas.length) return [];
    const out = [];
    let atual = null;
    for (let d = datas[0], g = 0; d <= datas[datas.length - 1] && g < 4000; d = this.somarDias(d, 1), g++) {
      if (bloqueado(d)) continue;
      const t = dias.get(d);
      if (t && atual && atual.tipo === t) atual.dataFim = d;
      else {
        if (atual) out.push(atual);
        atual = t ? { tipo: t, dataInicio: d, dataFim: d } : null;
      }
    }
    if (atual) out.push(atual);
    return out;
  },

  // A diferença entre o gravado e a seleção do ecrã: { aCriar: [{tipo, dataInicio, dataFim}], aEliminar: [registos] }.
  diff(ausencias, selecao, bloqueado) {
    const base = this.validas(ausencias);
    const gravado = this.selecaoDeAusencias(base);
    const mudou = new Set();
    new Set([...gravado.keys(), ...selecao.keys()]).forEach(d => {
      if (!bloqueado(d) && gravado.get(d) !== selecao.get(d)) mudou.add(d);
    });
    if (!mudou.size) return { aCriar: [], aEliminar: [] };
    const aEliminar = base.filter(a => this.diasDe(a).some(d => mudou.has(d)));
    const idsFora = new Set(aEliminar.map(a => a.id));
    const cobertos = new Set();
    base.filter(a => !idsFora.has(a.id)).forEach(a => this.diasDe(a).forEach(d => cobertos.add(d)));
    const porCriar = new Map();
    selecao.forEach((tipo, d) => { if (!bloqueado(d) && !cobertos.has(d)) porCriar.set(d, tipo); });
    return { aCriar: this.intervalos(porCriar, bloqueado), aEliminar };
  },

  // Resumo de um ano, em DIAS ÚTEIS, do que está gravado: por categoria, quantos dias aprovados e quantos em aprovação.
  // Devolve { linhas: [{ categoria, aprovados, pendentes }] (pela ordem de TIPOS; Férias aparece sempre), periodos: [...] }.
  resumo(ausencias, ano, bloqueado) {
    const prefixo = String(ano) + '-';
    const conta = {};
    this.TIPOS.forEach(t => { conta[t] = { categoria: t, aprovados: 0, pendentes: 0 }; });
    this.mapaDias(ausencias).forEach((v, d) => {
      if (!d.startsWith(prefixo) || bloqueado(d)) return;
      const c = conta[this.categoria(v.tipo)];
      if (v.estado === 'pendente') c.pendentes++; else c.aprovados++;
    });
    const linhas = this.TIPOS.map(t => conta[t]).filter(c => c.categoria === 'Férias' || c.aprovados || c.pendentes);
    const periodos = this.validas(ausencias)
      .filter(a => String(a.dataInicio).slice(0, 4) === String(ano) || String(a.dataFim).slice(0, 4) === String(ano))
      .sort((a, b) => String(a.dataInicio).localeCompare(String(b.dataInicio)))
      .map(a => ({ tipo: a.tipo || 'Outro', dataInicio: a.dataInicio, dataFim: a.dataFim, estado: a.estado }));
    return { linhas, periodos };
  }
};

if (typeof module !== 'undefined') module.exports = AusenciasCal;

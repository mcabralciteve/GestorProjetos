// Agendamento das tarefas pelas dependências (predecessoras): regras puras, sem DOM nem rede — testadas em
// tests/agendamento-logica.test.js. Todas as datas são 'AAAA-MM-DD'.
//
// Cada tarefa-folha com predecessoras tem um "modo de data" (tarefa.modoData):
//   'auto'  — SEGUE as predecessoras: fica no dia útil seguinte (fim→início), para a frente e para trás, mantendo a
//             duração em dias úteis; salta fins de semana e feriados.
//   'fixa'  — DATA FIXA: as ligações nunca a movem; se a predecessora acabar depois, só se assinala o conflito.
//   vazio   — "como até aqui" (tarefas anteriores a esta funcionalidade): só é empurrada para a frente, em dias de
//             calendário, nunca puxada para trás. Mantém-se até a pessoa escolher outro modo (nenhuma data muda sozinha).
const Agendamento = {
  _d(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); },
  _iso(dt) { return dt.toISOString().slice(0, 10); },
  _mais(iso, n) { const dt = this._d(iso); dt.setUTCDate(dt.getUTCDate() + n); return this._iso(dt); },
  _dif(a, b) { return Math.round((this._d(b) - this._d(a)) / 86400000); },

  fimDeSemana(iso) { const w = this._d(iso).getUTCDay(); return w === 0 || w === 6; },
  // "feriados": Set de 'AAAA-MM-DD' (opcional).
  naoUtil(iso, feriados) { return this.fimDeSemana(iso) || !!(feriados && feriados.has(iso)); },
  proximoDiaUtil(iso, feriados) { let d = iso; while (this.naoUtil(d, feriados)) d = this._mais(d, 1); return d; },
  diaUtilAnterior(iso, feriados) { let d = iso; while (this.naoUtil(d, feriados)) d = this._mais(d, -1); return d; },
  // Anda "n" dias úteis (negativo = para trás), a partir de um dia útil.
  somarDiasUteis(iso, n, feriados) {
    let d = iso;
    const passo = n < 0 ? -1 : 1;
    for (let i = 0; i < Math.abs(n); i++) { do { d = this._mais(d, passo); } while (this.naoUtil(d, feriados)); }
    return d;
  },

  // Duração de uma tarefa em dias úteis (seg-sex, como App.diasUteisEntre): a que se mantém ao reagendar. Mínimo 1.
  diasUteisDaTarefa(inicio, fim) {
    let n = 0;
    for (let d = inicio; d <= fim; d = this._mais(d, 1)) if (!this.fimDeSemana(d)) n++;
    return Math.max(1, n);
  },
  fimPorDiasUteis(inicio, n) {
    let d = inicio;
    for (let i = 0; i < n - 1; i++) { do { d = this._mais(d, 1); } while (this.fimDeSemana(d)); }
    return d;
  },
  inicioPorFim(fim, n) {
    let d = fim;
    for (let i = 0; i < n - 1; i++) { do { d = this._mais(d, -1); } while (this.fimDeSemana(d)); }
    return d;
  },

  // Início mínimo que a ligação "pr" impõe, em dias de calendário (regra "como até aqui").
  candidatoLegacy(pr, pred, duracaoCal) {
    const atraso = pr.atraso || 0;
    if (pr.tipo === 'FS') return this._mais(pred.fim, 1 + atraso);
    if (pr.tipo === 'SS') return this._mais(pred.inicio, atraso);
    if (pr.tipo === 'FF') return this._mais(pred.fim, atraso - duracaoCal);
    if (pr.tipo === 'SF') return this._mais(pred.inicio, atraso - duracaoCal);
    return null;
  },
  // Início que a ligação "pr" dá à tarefa em modo automático: sempre um dia útil; o atraso conta em dias úteis.
  candidatoAuto(pr, pred, nDiasUteis, feriados) {
    const atraso = pr.atraso || 0;
    let ini = null;
    if (pr.tipo === 'FS') ini = this.somarDiasUteis(this.proximoDiaUtil(this._mais(pred.fim, 1), feriados), atraso, feriados);
    else if (pr.tipo === 'SS') ini = this.somarDiasUteis(this.proximoDiaUtil(pred.inicio, feriados), atraso, feriados);
    else if (pr.tipo === 'FF') ini = this.inicioPorFim(this.somarDiasUteis(this.diaUtilAnterior(pred.fim, feriados), atraso, feriados), nDiasUteis);
    else if (pr.tipo === 'SF') ini = this.inicioPorFim(this.somarDiasUteis(this.diaUtilAnterior(pred.inicio, feriados), atraso, feriados), nDiasUteis);
    return ini ? this.proximoDiaUtil(ini, feriados) : null;
  },
  // Onde ficaria "t" em modo automático, com as predecessoras que tem (ou as de "predecessores", se dadas, para
  // pré-visualizar uma ligação nova). null se nenhuma predecessora existir em "mapa" (id -> tarefa).
  alvoAuto(t, mapa, feriados, predecessores) {
    const n = this.diasUteisDaTarefa(t.inicio, t.fim);
    let alvo = null;
    (predecessores || t.predecessores || []).forEach(pr => {
      const pred = mapa.get(pr.id);
      if (!pred) return;
      const c = this.candidatoAuto(pr, pred, n, feriados);
      if (c && (alvo === null || c > alvo)) alvo = c;
    });
    return alvo ? { inicio: alvo, fim: this.fimPorDiasUteis(alvo, n) } : null;
  },

  // A ligação "pr" de uma tarefa de DATA FIXA está em conflito quando a predecessora obriga a começar mais tarde.
  linkEmConflito(t, pr, mapa) {
    if (t.modoData !== 'fixa') return false;
    const pred = mapa.get(pr.id);
    if (!pred) return false;
    const c = this.candidatoLegacy(pr, pred, this._dif(t.inicio, t.fim));
    return !!c && c > t.inicio;
  },
  conflitos(folhas, mapa) {
    const lista = [];
    folhas.forEach(t => (t.predecessores || []).forEach(pr => {
      if (this.linkEmConflito(t, pr, mapa)) lista.push({ tarefaId: t.id, predId: pr.id, tipo: pr.tipo });
    }));
    return lista;
  },

  // Reagenda as tarefas-folha pelas predecessoras (altera "folhas" no lugar). "mapa": id -> tarefa (todas, também as
  // tarefas-resumo, que podem ser predecessoras). Repete até estabilizar (cadeias). Devolve os conflitos das datas fixas.
  relaxar(folhas, mapa, opts) {
    const feriados = (opts && opts.feriados) || null;
    for (let pass = 0; pass < folhas.length + 1; pass++) {
      let mudou = false;
      folhas.forEach(t => {
        if (!t.predecessores || !t.predecessores.length || t.modoData === 'fixa') return;
        if (t.modoData === 'auto') {
          const alvo = this.alvoAuto(t, mapa, feriados);
          if (alvo && (alvo.inicio !== t.inicio || alvo.fim !== t.fim)) { t.inicio = alvo.inicio; t.fim = alvo.fim; mudou = true; }
          return;
        }
        // "Como até aqui": só empurra para a frente (dias de calendário).
        const duracaoCal = this._dif(t.inicio, t.fim);
        let minInicio = null;
        t.predecessores.forEach(pr => {
          const pred = mapa.get(pr.id);
          if (!pred) return;
          const c = this.candidatoLegacy(pr, pred, duracaoCal);
          if (c && (minInicio === null || c > minInicio)) minInicio = c;
        });
        if (minInicio && minInicio > t.inicio) { t.inicio = minInicio; t.fim = this._mais(minInicio, duracaoCal); mudou = true; }
      });
      if (!mudou) break;
    }
    return this.conflitos(folhas, mapa);
  }
};
if (typeof module !== 'undefined') module.exports = Agendamento;

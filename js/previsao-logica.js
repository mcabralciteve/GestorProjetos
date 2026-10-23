// Previsão de reconhecimento e faturação — contas puras (sem DOM nem estado da app), testadas em tests/previsao-logica.test.js.
//
// Fase A: só o que já está CONTRATADO (projetos):
//   Reconhecimento = o valor por reconhecer (valor vendido − o que as horas já feitas reconheceram, pelo mesmo método do
//                    Acompanhamento Financeiro: valorVendido × horas registadas ÷ horas vendidas) repartido pelos meses conforme
//                    as horas que faltam no plano (Gantt), a €/h = valor vendido ÷ horas vendidas;
//   Faturação      = as faturas por emitir, no mês previsto (as em atraso passam para o mês atual).
// A mesma estrutura serve, na Fase B, para as oportunidades ponderadas.
const PrevisaoLogica = {
  _utc(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  _iso(dt) { return dt.toISOString().slice(0, 10); },
  r2(n) { return Math.round(n * 100) / 100; },

  // 'AAAA-MM' do mês de "hojeISO" e dos n-1 seguintes.
  mesesHorizonte(hojeISO, n) {
    const out = [];
    const c = this._utc(hojeISO.slice(0, 7) + '-01');
    for (let i = 0; i < n; i++) { out.push(this._iso(c).slice(0, 7)); c.setUTCMonth(c.getUTCMonth() + 1); }
    return out;
  },
  vazio(meses) { const o = {}; meses.forEach(m => { o[m] = 0; }); return o; },

  // Reparte "horas" de uma tarefa pelos meses, em partes iguais por dia útil de max(inicio, hoje) a fim. Uma tarefa que já
  // devia ter acabado (fim antes de hoje) mas ainda tem horas por fazer põe-nas no mês atual. Devolve { 'AAAA-MM': horas }.
  distribuirHorasPorMes(inicio, fim, horas, hojeISO) {
    const out = {};
    if (!(horas > 0)) return out;
    const mesHoje = hojeISO.slice(0, 7);
    if (!fim || fim < hojeISO) { out[mesHoje] = horas; return out; }
    const ini = inicio && inicio > hojeISO ? inicio : hojeISO;
    const dias = [];
    for (let d = this._utc(ini), f = this._utc(fim), g = 0; d <= f && g < 4000; d.setUTCDate(d.getUTCDate() + 1), g++) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) dias.push(this._iso(d).slice(0, 7));
    }
    if (!dias.length) { out[ini.slice(0, 7)] = horas; return out; }      // só fins de semana: vai para o mês de início
    dias.forEach(m => { out[m] = (out[m] || 0) + horas / dias.length; });
    return out;
  },

  // Reconhecimento do backlog de UM projeto. tarefas: [{ inicio, fim, horasPorFazer }] (já descontado o que foi registado).
  // Devolve null se o projeto não tem valor e horas vendidas (sem isso não há nada para reconhecer).
  reconhecimentoBacklog({ valorVendido, horasVendidas, horasRegistadas, tarefas, hojeISO, meses }) {
    if (!(valorVendido > 0) || !(horasVendidas > 0)) return null;
    const euroHora = valorVendido / horasVendidas;
    const reconhecidoHoje = valorVendido * Math.min(1, (horasRegistadas || 0) / horasVendidas);
    const porReconhecer = Math.max(0, valorVendido - reconhecidoHoje);
    const horasPorMes = {};
    (tarefas || []).forEach(t => {
      const d = this.distribuirHorasPorMes(t.inicio, t.fim, t.horasPorFazer, hojeISO);
      Object.entries(d).forEach(([m, h]) => { horasPorMes[m] = (horasPorMes[m] || 0) + h; });
    });
    const valorPlano = Object.values(horasPorMes).reduce((s, h) => s + h, 0) * euroHora;
    // O plano nunca pode reconhecer mais do que o valor que falta: se as horas por fazer excedem o backlog, reduz-se proporcionalmente.
    const fator = valorPlano > porReconhecer && valorPlano > 0 ? porReconhecer / valorPlano : 1;
    const porMes = this.vazio(meses);
    let dentro = 0;
    Object.entries(horasPorMes).forEach(([m, h]) => {
      const v = h * euroHora * fator;
      if (m in porMes) { porMes[m] += v; dentro += v; }
    });
    const calendarizado = Math.min(valorPlano, porReconhecer);
    return {
      euroHora, reconhecidoHoje, porReconhecer, porMes,
      dentroDoHorizonte: dentro, calendarizado,
      naoCalendarizado: Math.max(0, porReconhecer - calendarizado),                 // backlog sem horas previstas no plano
      cobertura: porReconhecer > 0 ? calendarizado / porReconhecer : 1
    };
  },

  // Faturas por emitir de UM projeto, por mês. faturas: [{ dataPrevista, valor, emitida }]. As com data anterior ao mês atual
  // ficam no mês atual ("em atraso"); as depois do horizonte ficam de fora ("foraDoHorizonte"); as sem data são "semData".
  faturacaoContratada({ faturas, hojeISO, meses }) {
    const porMes = this.vazio(meses);
    const mesHoje = hojeISO.slice(0, 7);
    const r = { porMes, emAtraso: 0, nEmAtraso: 0, foraDoHorizonte: 0, semData: 0, total: 0 };
    (faturas || []).forEach(f => {
      if (f.emitida || !(f.valor > 0)) return;
      r.total += f.valor;
      if (!f.dataPrevista) { r.semData += f.valor; return; }
      let m = f.dataPrevista.slice(0, 7);
      if (m < mesHoje) { m = mesHoje; r.emAtraso += f.valor; r.nEmAtraso++; }
      if (m in porMes) porMes[m] += f.valor; else r.foraDoHorizonte += f.valor;
    });
    return r;
  },

  // Soma séries mensais ({ 'AAAA-MM': valor }) de várias linhas.
  somar(series, meses) {
    const out = this.vazio(meses);
    series.forEach(s => meses.forEach(m => { out[m] += (s && s[m]) || 0; }));
    return out;
  },
  acumular(serie, meses) { let a = 0; const out = {}; meses.forEach(m => { a += serie[m] || 0; out[m] = a; }); return out; },
  total(serie, meses) { return meses.reduce((s, m) => s + (serie[m] || 0), 0); }
};
if (typeof module !== 'undefined') module.exports = PrevisaoLogica;

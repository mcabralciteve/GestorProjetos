// Intervalo de horas (das 14:00 às 16:30) para as horas de ausência — lógica pura, sem DOM nem rede.
// As horas do registo passam a ser calculadas a partir do intervalo, que fica guardado no registo (hora_inicio/hora_fim,
// "HH:MM") para se ver e editar depois. Um registo só de horas (sem intervalo) continua a funcionar como sempre.
const IntervaloHoras = {
  // "HH:MM" → minutos desde as 00:00; null se não for uma hora válida (00:00 a 24:00).
  paraMinutos(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
    return h * 60 + mi;
  },
  // Horas (com 2 casas decimais) entre o início e o fim; null se alguma hora for inválida ou o fim não for depois do início.
  horas(ini, fim) {
    const a = this.paraMinutos(ini), b = this.paraMinutos(fim);
    if (a === null || b === null || b <= a) return null;
    return Math.round((b - a) / 60 * 100) / 100;
  },
  valido(ini, fim) { return this.horas(ini, fim) !== null; },
  // "14:00–16:30", ou '' se não houver intervalo válido.
  rotulo(ini, fim) { return this.valido(ini, fim) ? `${String(ini).trim()}–${String(fim).trim()}` : ''; },
  // Dois intervalos do mesmo dia sobrepõem-se se um começar antes de o outro acabar (encostados — fim = início — não).
  sobrepoe(ini1, fim1, ini2, fim2) {
    const a1 = this.paraMinutos(ini1), b1 = this.paraMinutos(fim1), a2 = this.paraMinutos(ini2), b2 = this.paraMinutos(fim2);
    if ([a1, b1, a2, b2].includes(null)) return false;
    return a1 < b2 && a2 < b1;
  },
  // Outro registo (com intervalo) da mesma pessoa e dia que se sobreponha a este; null se não houver.
  conflito(registos, { pessoa, data, ini, fim, ignorarId }) {
    return (registos || []).find(r =>
      r.pessoa === pessoa && r.data === data && r.id !== ignorarId && r.horaInicio && r.horaFim && this.sobrepoe(ini, fim, r.horaInicio, r.horaFim)
    ) || null;
  }
};

if (typeof module !== 'undefined') module.exports = IntervaloHoras;

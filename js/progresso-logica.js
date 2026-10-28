// % de conclusão automática das tarefas (horas reais ÷ horas previstas): regras puras, sem DOM nem rede — testadas em
// tests/progresso-logica.test.js.
//
// Cada tarefa-folha tem um modo de % de conclusão (tarefa.progAuto):
//   falso (por omissão) — MANUAL: o valor é o que a pessoa escreve.
//   verdadeiro          — AUTOMÁTICO: reais ÷ previstas, arredondado e com teto de 99%. O 100% é sempre um ato
//                         deliberado ("terminei"), nunca um efeito das horas: por isso só se põe à mão.
const ProgressoLogica = {
  TETO_AUTO: 99,
  // null quando não há horas previstas para comparar (não há fórmula possível).
  auto(reais, previstas) {
    const r = parseFloat(reais) || 0, p = parseFloat(previstas) || 0;
    if (p <= 0) return null;
    return Math.max(0, Math.min(this.TETO_AUTO, Math.round((r / p) * 100)));
  },
  // Horas totais previstas de uma tarefa para a Reprevisão (EAC). Em automático, o ritmo já está contido na %: reais ÷ %
  // devolveria sempre as previstas, por isso usa-se o maior de previstas e reais (estourou o orçamento → conta o real).
  eacAuto(reais, previstas) {
    return Math.max(parseFloat(reais) || 0, parseFloat(previstas) || 0);
  }
};
if (typeof module !== 'undefined') module.exports = ProgressoLogica;

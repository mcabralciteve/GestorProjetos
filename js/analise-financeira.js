// Agregações puras (sem DOM, sem estado da app) do separador Financeiro: reconhecimento de
// proveito pelo método da percentagem de acabamento (POC), a partir de horas reais. Testado em
// tests/analise-financeira.test.js. Ver a conversa de desenho no histórico da app para o porquê do
// modelo (horas, não % de execução manual — dá histórico completo e automático; três curvas, não
// duas, porque "faturas" já distinguem planeado de emitido).
//
// Vocabulário (todos acumulados desde o início do projeto até ao FIM de cada mês):
//   Planeado    = soma das faturas com dataPrevista até esse mês (emitidas ou não)
//   Reconhecido = valorVendido × min(1, horas reais acumuladas ÷ horas vendidas)   — o proveito
//   Faturado    = soma das faturas emitida=true com dataEmissao até esse mês
//
// A repartição por equipa usa sempre a MESMA chave nas três curvas — a quota de horas de cada
// equipa no total de horas reais do projeto até esse mês — para os desvios continuarem a fazer
// sentido também ao nível da equipa/departamento, não só do projeto inteiro (ver a nota grande em
// App.dadosFinanceiros). Antes de haver qualquer hora lançada (horasTotal = 0), atribui-se tudo à
// equipa própria do projeto (equipaIdProjeto) — é a única pista que existe nessa fase.
const AnaliseFinanceira = {
  SEM_EQUIPA: '__sem_equipa__',

  _utc(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  _iso(dt) { return dt.toISOString().slice(0, 10); },

  // Todos os "AAAA-MM" de "de" a "ate" (strings ISO), inclusive, por ordem cronológica.
  mesesEntre(de, ate) {
    const out = [];
    const cursor = this._utc(de.slice(0, 7) + '-01');
    const fim = this._utc(ate);
    for (let guarda = 0; cursor <= fim && guarda < 1200; guarda++) {
      out.push(this._iso(cursor).slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
  },
  // Último dia (ISO) do mês "AAAA-MM".
  fimDoMes(mesChave) {
    const [ano, mes] = mesChave.split('-').map(Number);
    return this._iso(new Date(Date.UTC(ano, mes, 0)));
  },

  // Curva mensal de UM projeto. Devolve null se não tiver orçamento de horas definido (mesmo
  // critério já usado em Portefólio/avaliarOrcamentoProjeto — "Sem orçamento de horas definido").
  //   valorVendido, horasVendidas: number
  //   equipaIdProjeto: id da equipa "dona" do projeto (fallback antes de haver horas lançadas)
  //   horas: [{ data: 'AAAA-MM-DD', equipaId, valor: horas }]
  //   faturas: [{ dataPrevista, valor, emitida, dataEmissao }]
  //   meses: ['AAAA-MM', ...] por ordem cronológica (ver mesesEntre)
  // Devolve: { porMes: { 'AAAA-MM': { horasTotal, reconhecido, planeado, faturado, porEquipa: { equipaId: { horas, share, reconhecido, planeado, faturado } } } } }
  curvaProjeto({ valorVendido, horasVendidas, equipaIdProjeto, horas, faturas, meses }) {
    if (!horasVendidas) return null;
    valorVendido = valorVendido || 0;
    horas = horas || [];
    faturas = faturas || [];
    const porMes = {};
    meses.forEach(mesChave => {
      const fimM = this.fimDoMes(mesChave);
      const horasAteM = horas.filter(h => h.data <= fimM);
      const horasTotal = horasAteM.reduce((s, h) => s + (h.valor || 0), 0);
      const reconhecido = valorVendido * Math.min(1, horasTotal / horasVendidas);
      const planeado = faturas.filter(f => f.dataPrevista && f.dataPrevista <= fimM).reduce((s, f) => s + (f.valor || 0), 0);
      const faturado = faturas.filter(f => f.emitida && f.dataEmissao && f.dataEmissao <= fimM).reduce((s, f) => s + (f.valor || 0), 0);
      const porEquipa = {};
      if (horasTotal > 0) {
        const horasPorEquipa = new Map();
        horasAteM.forEach(h => {
          const chave = h.equipaId || this.SEM_EQUIPA;
          horasPorEquipa.set(chave, (horasPorEquipa.get(chave) || 0) + (h.valor || 0));
        });
        horasPorEquipa.forEach((horasEq, equipaId) => {
          const share = horasEq / horasTotal;
          porEquipa[equipaId] = { horas: horasEq, share, reconhecido: reconhecido * share, planeado: planeado * share, faturado: faturado * share };
        });
      } else if (planeado || faturado) {
        // Ainda sem nenhuma hora lançada, mas já há faturas planeadas/emitidas (ex.: adiantamento
        // no arranque) — atribui-se à equipa própria do projeto, a única pista que existe nesta fase.
        const chave = equipaIdProjeto || this.SEM_EQUIPA;
        porEquipa[chave] = { horas: 0, share: 1, reconhecido: 0, planeado, faturado };
      }
      porMes[mesChave] = { horasTotal, reconhecido, planeado, faturado, porEquipa };
    });
    return { porMes };
  }
};
if (typeof module !== 'undefined') module.exports = AnaliseFinanceira;

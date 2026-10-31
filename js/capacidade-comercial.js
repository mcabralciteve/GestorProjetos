// Projeção de horas das oportunidades comerciais para a Capacidade — contas puras (sem DOM nem estado da app), testadas em
// tests/capacidade-comercial.test.js.
//
// A ideia: as oportunidades que ainda NÃO são projetos vão pedir horas à equipa se forem ganhas. Convertem-se em horas assim:
//   horas = valor da oportunidade ÷ valor/hora médio de um consultor,
// multiplicam-se pela probabilidade de sucesso (as ganhas sem projeto valem 100%) e repartem-se, em partes iguais por mês, pela
// duração prevista do trabalho (o mesmo calendário do mapa de Previsão: início previsto, ou N meses depois do fecho; duração da
// oportunidade ou o defeito do seu tipo). É uma PROJEÇÃO, sujeita a erros — por isso a Capacidade a mostra sempre assinalada.
const CapacidadeComercial = {
  P() { return typeof PrevisaoLogica !== 'undefined' ? PrevisaoLogica : require('./previsao-logica.js'); },

  // Valor/hora de referência: média simples do preço de venda (€/h) dos consultores que têm preço definido.
  valorHoraMedio(recursos) {
    const v = (recursos || []).map(r => Number(r.precoVenda) || 0).filter(x => x > 0);
    return { valor: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, n: v.length };
  },

  // ops: oportunidades do CRM. ctx:
  //   categoriaDe(op) → 'aberta' | 'ganha' | 'perdida';   probabilidade(op) → 0..1 (das abertas);
  //   valorDe(op) → valor em €;   defeitosDoTipo(tipoId) → { apos, duracao };   temProjeto(op) → já é um projeto da app?
  //   incluir(op) → (opcional) só entram as oportunidades que cumprem (ex.: só as de Serviços);
  //   equipasIds: Set de ids das equipas no ecrã, ou null para todas;   valorHora: € por hora;
  //   meses: ['AAAA-MM', …] do horizonte;   hojeISO: 'AAAA-MM-DD'.
  // Só entram as oportunidades da(s) equipa(s) pedida(s) (campo "área responsável" da oportunidade). Devolve
  //   { porMes: { 'AAAA-MM': horas }, total, foraDoHorizonte, linhas: [{ op, valor, peso, horas, inicio, duracao }], semArea, semValor }
  // semArea = oportunidades sem área responsável (não se sabe de que equipa são, por isso não entram quando se filtra por equipa).
  projetar(ops, ctx) {
    const P = this.P();
    const porMes = P.vazio(ctx.meses);
    const r = { porMes, total: 0, foraDoHorizonte: 0, linhas: [], semArea: 0, semValor: 0 };
    if (!(ctx.valorHora > 0)) return r;
    (ops || []).forEach(op => {
      const cat = ctx.categoriaDe(op);
      if (ctx.incluir && !ctx.incluir(op)) return;
      if (cat === 'perdida' || ctx.temProjeto(op)) return;                       // já é projeto: conta pelas tarefas do projeto
      const peso = cat === 'ganha' ? 1 : ctx.probabilidade(op);
      if (!(peso > 0)) return;
      if (ctx.equipasIds) {
        if (!op.equipa_id) { r.semArea++; return; }
        if (!ctx.equipasIds.has(String(op.equipa_id))) return;
      }
      const valor = Number(ctx.valorDe(op)) || 0;
      if (!(valor > 0)) { r.semValor++; return; }
      const def = ctx.defeitosDoTipo(op.tipo_id);
      const ini = P.inicioDaOportunidade({ inicioPrevisto: op.inicio_previsto, dataFecho: op.data_prevista_fecho, aposFecho: def.apos, hojeISO: ctx.hojeISO });
      const duracao = op.duracao_meses || def.duracao;
      const horas = valor / ctx.valorHora;
      const m = P.oportunidadeNoMapa({ valor: horas, peso, inicioMes: ini.mes, duracao, plano: [], hojeISO: ctx.hojeISO, meses: ctx.meses });
      ctx.meses.forEach(mes => { porMes[mes] += m.rec[mes] || 0; });
      r.total += m.total; r.foraDoHorizonte += m.recFora;
      r.linhas.push({ op, valor, peso, horas: m.total, inicio: m.inicio, duracao });
    });
    return r;
  },

  // Folga dos projetos de Serviços adjudicados: a diferença entre as horas VENDIDAS e a reprevisão (o que já foi gasto mais o que ainda
  // está planeado por realizar). Não se sabe se vai ser usada nem por quem, por isso junta-se num "bolo" por mês — repartido pelos dias
  // úteis que faltam até ao fim do projeto — e atribui-se à equipa do projeto. Só folgas positivas (um projeto a derrapar não tira horas).
  // projetos: [{ id, nome, tipoCodigo ('servicos' | 'id' | '' sem tipo), ativo, estado, horasVendidas, equipaId, eac, fim ('AAAA-MM-DD') }]
  // ctx: { equipasIds (Set ou null = todas), meses: ['AAAA-MM', …], hojeISO }.
  // Devolve { porMes, total, foraDoHorizonte, linhas: [{ projeto, folga }], semEquipa, semTipo }; semEquipa = projetos com folga mas sem equipa
  // definida (não entram quando se filtra por equipa); semTipo = projetos com folga cujo tipo (Serviços/I&D) ainda não está definido.
  folgaProjetos(projetos, ctx) {
    const P = this.P();
    const porMes = P.vazio(ctx.meses);
    const r = { porMes, total: 0, foraDoHorizonte: 0, linhas: [], semEquipa: 0, semTipo: 0 };
    (projetos || []).forEach(p => {
      if (!p.ativo || p.estado === 'Concluído' || p.estado === 'Cancelado') return;
      if (p.tipoCodigo !== 'servicos' && p.tipoCodigo !== '') return;                 // I&D e outros tipos: fora
      if (!(p.horasVendidas > 0)) return;
      const folga = p.horasVendidas - (Number(p.eac) || 0);
      if (!(folga > 0)) return;
      if (ctx.equipasIds) {
        if (!p.equipaId) { r.semEquipa++; return; }
        if (!ctx.equipasIds.has(String(p.equipaId))) return;
      }
      if (p.tipoCodigo === '') { r.semTipo++; return; }
      const d = P.distribuirHorasPorMes(ctx.hojeISO, p.fim || ctx.hojeISO, folga, ctx.hojeISO);
      Object.entries(d).forEach(([mes, h]) => { if (mes in porMes) porMes[mes] += h; else r.foraDoHorizonte += h; });
      r.total += folga;
      r.linhas.push({ projeto: p, folga });
    });
    return r;
  }
};
if (typeof module !== 'undefined') module.exports = CapacidadeComercial;

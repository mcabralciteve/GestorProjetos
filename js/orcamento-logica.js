// Regras de cálculo da Orçamentação — puras (sem DOM nem base de dados), testadas em tests/orcamento-logica.test.js.
// Espelham a "Folha de Orçamentação — DTD" (Excel): 5 secções por área (departamento/equipa) e o "Resumo do
// Orçamento". Convenção da folha, mantida aqui: o valor/hora de cada consultor JÁ inclui custos indiretos e margem
// (por isso o preço final NÃO volta a aplicar overhead nem margem — só soma); a margem é só informativa.
//
// Um orçamento, em memória:
//   { id, proposta_id, versao, titulo, estado, validade_dias, aluguer_saida, custo_km, notas,
//     areas: [ { id, equipa_id, nome, ordem, custos_especificos, linhas: [ { id, seccao, ordem, descricao, recurso_id, dados } ] } ] }
// "dados" por secção:
//   consultoria: { horas, valor_hora, custo_hora }
//   formacao:    { horas_sessao, horas_prep, valor_hora, custo_hora }
//   deslocacao:  { saidas, km, portagens, refeicoes, estadias, outros, horas, valor_hora, custo_hora }
//   consumivel:  { valor }
//   produto:     { quantidade, preco_custo, preco_venda, desconto }   (desconto em %)
const OrcLogica = {
  SECCOES: [
    { k: 'consultoria', rotulo: 'Horas de consultoria / trabalho' },
    { k: 'formacao', rotulo: 'Horas de formação (com preparação)' },
    { k: 'deslocacao', rotulo: 'Deslocações' },
    { k: 'consumivel', rotulo: 'Consumíveis' },
    { k: 'produto', rotulo: 'Produtos' }
  ],
  ESTADOS: { rascunho: 'Rascunho', enviado: 'Enviado', validado: 'Validado', rejeitado: 'Rejeitado' },
  // Áreas de serviço da vista do cliente (as 5 linhas do "Âmbito e Investimento"); são também as rubricas
  // sobre as quais se preverá faturar.
  RUBRICAS: [
    { k: 'consultoria', rotulo: 'Consultoria e Diagnóstico', descricao: 'Horas de consultoria técnica dedicadas ao projeto' },
    { k: 'formacao', rotulo: 'Formação', descricao: 'Ações de formação e capacitação da equipa' },
    { k: 'deslocacoes', rotulo: 'Deslocações e Logística', descricao: 'Deslocações, viagens e logística associada à execução' },
    { k: 'consumiveis', rotulo: 'Consumíveis e Materiais', descricao: 'Materiais e consumíveis necessários à execução' },
    { k: 'produtos', rotulo: 'Produtos e Equipamentos', descricao: 'Fornecimento de produtos e equipamentos associados ao projeto' }
  ],

  n(v) { const x = Number(String(v === null || v === undefined ? '' : v).replace(',', '.')); return Number.isFinite(x) ? x : 0; },
  arred(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; },

  // ---------- Uma linha ----------
  // params: { aluguer_saida, custo_km } do orçamento.
  calcLinha(linha, params) {
    const d = linha.dados || {}, n = v => this.n(v), p = params || {};
    switch (linha.seccao) {
      case 'consultoria': {
        const horas = n(d.horas), vh = n(d.valor_hora), ch = n(d.custo_hora);
        return { valor: horas * vh, margem: horas * (vh - ch) };
      }
      case 'formacao': {
        // (sessão + preparação) × valor/hora é o custo total; o valor/hora efetivo é esse total por hora de SESSÃO.
        const s = n(d.horas_sessao), pr = n(d.horas_prep), vh = n(d.valor_hora), ch = n(d.custo_hora);
        const custoTotal = (s + pr) * vh;
        const vhEfetivo = s > 0 ? custoTotal / s : 0;
        return { custoTotal, vhEfetivo, valor: s * vhEfetivo, margem: (s + pr) * (vh - ch) };
      }
      case 'deslocacao': {
        const despesas = n(d.saidas) * n(p.aluguer_saida) + n(d.km) * n(p.custo_km) + n(d.portagens) + n(d.refeicoes) + n(d.estadias) + n(d.outros);
        const horas = n(d.horas), vh = n(d.valor_hora), ch = n(d.custo_hora);
        return { despesas, valorHoras: horas * vh, margemHoras: horas * (vh - ch), valor: despesas + horas * vh, margem: horas * (vh - ch) };
      }
      case 'consumivel':
        return { valor: n(d.valor), margem: 0 };
      case 'produto': {
        const q = n(d.quantidade), pc = n(d.preco_custo), pv = n(d.preco_venda), desc = n(d.desconto);
        const pvFinal = pv * (1 - desc / 100);
        const custo = q * pc, venda = q * pvFinal;
        return { pvFinal, custo, valor: venda, margem: venda - custo, margemPct: venda ? (venda - custo) / venda : 0, margemNominalPct: pv ? (pv - pc) / pv : 0 };
      }
      default: return { valor: 0, margem: 0 };
    }
  },

  // ---------- Uma área (um "separador" da folha) ----------
  calcArea(area, params) {
    const t = { consultoria: 0, formacao: 0, deslocacaoHoras: 0, despesas: 0, consumiveis: 0, produtos: 0, margemHoras: 0, margemProdutos: 0 };
    (area.linhas || []).forEach(l => {
      const c = this.calcLinha(l, params);
      if (l.seccao === 'consultoria') { t.consultoria += c.valor; t.margemHoras += c.margem; }
      else if (l.seccao === 'formacao') { t.formacao += c.valor; t.margemHoras += c.margem; }
      else if (l.seccao === 'deslocacao') { t.deslocacaoHoras += c.valorHoras; t.despesas += c.despesas; t.margemHoras += c.margemHoras; }
      else if (l.seccao === 'consumivel') t.consumiveis += c.valor;
      else if (l.seccao === 'produto') { t.produtos += c.valor; t.margemProdutos += c.margem; }
    });
    const custosEspecificos = this.n(area.custos_especificos);
    const horasVendaveis = t.consultoria + t.formacao + t.deslocacaoHoras;
    const precoFinal = horasVendaveis + t.produtos + t.despesas + t.consumiveis + custosEspecificos;
    const margem = t.margemHoras + t.margemProdutos;
    const baseMargem = horasVendaveis + t.produtos;
    return {
      ...t, custosEspecificos, horasVendaveis, precoFinal, margem, margemPct: baseMargem ? margem / baseMargem : 0,
      margemHorasPct: horasVendaveis ? t.margemHoras / horasVendaveis : 0, margemProdutosPct: t.produtos ? t.margemProdutos / t.produtos : 0,
      // Bases por rubrica ANTES de repartir os custos específicos (ver propostaCliente).
      bases: { consultoria: t.consultoria, formacao: t.formacao, deslocacoes: t.deslocacaoHoras + t.despesas, consumiveis: t.consumiveis, produtos: t.produtos }
    };
  },

  // ---------- O orçamento todo ("Resumo Geral") ----------
  calcOrcamento(orc) {
    const params = { aluguer_saida: orc.aluguer_saida, custo_km: orc.custo_km };
    const areas = (orc.areas || []).map(a => ({ area: a, ...this.calcArea(a, params) }));
    const soma = k => areas.reduce((s, a) => s + a[k], 0);
    const horasVendaveis = soma('horasVendaveis'), produtos = soma('produtos'), margem = soma('margem');
    return {
      areas, horasVendaveis, produtos, despesas: soma('despesas'), consumiveis: soma('consumiveis'), custosEspecificos: soma('custosEspecificos'),
      margem, margemPct: (horasVendaveis + produtos) ? margem / (horasVendaveis + produtos) : 0, total: soma('precoFinal')
    };
  },

  // ---------- Vista do cliente ("Proposta Cliente") ----------
  // Sem overhead, custos específicos, margem nem valores/hora. Os custos específicos de cada área ficam repartidos pelas
  // rubricas em proporção ao seu peso (fator de imputação = preço final ÷ soma das bases diretas) — como na folha.
  propostaCliente(orc) {
    const calc = this.calcOrcamento(orc);
    const inv = { consultoria: 0, formacao: 0, deslocacoes: 0, consumiveis: 0, produtos: 0 };
    calc.areas.forEach(a => {
      const diretos = Object.values(a.bases).reduce((s, v) => s + v, 0);
      if (diretos > 0) { const f = a.precoFinal / diretos; Object.keys(inv).forEach(k => { inv[k] += a.bases[k] * f; }); }
      else inv.consultoria += a.precoFinal;                      // área só com custos específicos: não há onde os repartir
    });
    const investimento = {};
    this.RUBRICAS.forEach(r => { investimento[r.k] = this.arred(inv[r.k]); });
    const total = this.arred(Object.values(investimento).reduce((s, v) => s + v, 0));
    const lista = (seccao) => (orc.areas || []).flatMap(a => (a.linhas || []).filter(l => l.seccao === seccao && String(l.descricao || '').trim()).map(l => String(l.descricao).trim()));
    return {
      investimento, total,
      porArea: calc.areas.map(a => ({ nome: a.area.nome || '—', total: this.arred(a.precoFinal) })),
      escopo: { consultoria: lista('consultoria'), formacao: lista('formacao'), produtos: lista('produto') }
    };
  },

  // ---------- Linhas novas / valores por omissão ----------
  // consultor: recurso { id, nome, precoVenda, precoCusto } — o valor/hora fica COPIADO para a linha.
  dadosNovos(seccao) {
    return {
      consultoria: { horas: 0, valor_hora: 0, custo_hora: 0 }, formacao: { horas_sessao: 0, horas_prep: 0, valor_hora: 0, custo_hora: 0 },
      deslocacao: { saidas: 0, km: 0, portagens: 0, refeicoes: 0, estadias: 0, outros: 0, horas: 0, valor_hora: 0, custo_hora: 0 },
      consumivel: { valor: 0 }, produto: { quantidade: 1, preco_custo: 0, preco_venda: 0, desconto: 0 }
    }[seccao] || {};
  },
  aplicarConsultor(linha, recurso) {
    linha.recurso_id = recurso ? recurso.id : null;
    if (['consultoria', 'formacao', 'deslocacao'].includes(linha.seccao)) {
      linha.dados.valor_hora = recurso ? this.n(recurso.precoVenda) : 0;
      linha.dados.custo_hora = recurso ? this.n(recurso.precoCusto) : 0;
    }
    return linha;
  },

  // ---------- Estados ----------
  // rascunho -> enviado | validado ; enviado -> validado | rejeitado ; rejeitado -> enviado ; validado -> enviado (só Admin)
  // Só um validado por proposta (a base de dados também o garante).
  podeTransitar(de, para, ctx) {
    ctx = ctx || {};
    if (para === 'validado' && ctx.outroValidado) return false;
    const mapa = { rascunho: ['enviado', 'validado'], enviado: ['validado', 'rejeitado'], rejeitado: ['enviado'], validado: ctx.souAdmin ? ['enviado'] : [] };
    return (mapa[de] || []).includes(para);
  },
  // O valor de uma proposta é o reflexo dos seus orçamentos — sem orçamento, não tem valor. Conta o validado (adjudicado);
  // enquanto nenhum for validado, o da versão mais recente que não esteja rejeitada. resumos: [{ versao, estado, total }].
  valorDaProposta(resumos) {
    const v = (resumos || []).find(o => o.estado === 'validado');
    if (v) return { valor: this.n(v.total), versao: v.versao, estado: 'validado' };
    const vivos = (resumos || []).filter(o => o.estado !== 'rejeitado').sort((a, b) => b.versao - a.versao);
    return vivos.length ? { valor: this.n(vivos[0].total), versao: vivos[0].versao, estado: vivos[0].estado } : { valor: 0, versao: null, estado: null };
  },
  // Só o rascunho se edita; os restantes são registos fechados (para alterar, nova versão).
  editavel(orc) { return orc.estado === 'rascunho'; },
  proximaVersao(orcamentos, propostaId) {
    return orcamentos.filter(o => o.proposta_id === propostaId).reduce((m, o) => Math.max(m, Number(o.versao) || 0), 0) + 1;
  },
  // Problemas que impedem enviar/validar (erros) e coisas a rever (avisos).
  verificar(orc) {
    const erros = [], avisos = [];
    if (!(orc.areas || []).length) erros.push('Acrescenta pelo menos uma área (departamento).');
    const calc = this.calcOrcamento(orc);
    if (!(calc.total > 0)) erros.push('O orçamento tem preço final 0 €.');
    (orc.areas || []).forEach(a => (a.linhas || []).forEach(l => {
      const d = l.dados || {};
      if (['consultoria', 'formacao'].includes(l.seccao) && !this.n(d.valor_hora)) avisos.push(`${a.nome}: "${l.descricao || this.rotuloSeccao(l.seccao)}" sem valor/hora.`);
      if (l.seccao === 'consultoria' && !this.n(d.horas)) avisos.push(`${a.nome}: "${l.descricao || 'consultoria'}" sem horas.`);
      if (l.seccao === 'produto' && this.n(d.preco_venda) < this.n(d.preco_custo)) avisos.push(`${a.nome}: "${l.descricao || 'produto'}" vende abaixo do custo.`);
    }));
    return { erros, avisos };
  },
  rotuloSeccao(k) { return (this.SECCOES.find(s => s.k === k) || {}).rotulo || k; },

  // Cópia para uma nova versão (rascunho): novos ids, mesmos valores (os valores/hora congelados mantêm-se).
  duplicar(orc, gerarId, versao) {
    return {
      ...orc, id: gerarId(), versao, estado: 'rascunho', validado_em: null, criado_em: null, atualizado_em: null,
      areas: (orc.areas || []).map(a => ({ ...a, id: gerarId(), linhas: (a.linhas || []).map(l => ({ ...l, id: gerarId(), dados: { ...(l.dados || {}) } })) }))
    };
  },

  // ---------- Formatação ----------
  euro(v) { return (Number(v) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }); },
  pct(v) { return `${(Math.round((Number(v) || 0) * 1000) / 10).toLocaleString('pt-PT')}%`; }
};
if (typeof module !== 'undefined') module.exports = OrcLogica;

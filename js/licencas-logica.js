// Módulo "Ativos → Licenças": regras puras, sem DOM nem rede — testadas em tests/licencas-logica.test.js.
//
// Uma licença (linha da tabela "licencas", snake_case como vem da base de dados — ver supabase/licencas.sql):
//   { id, nome, fornecedor, tipo ('subscricao'|'perpetua'), periodicidade ('mensal'|'anual'|'unica'), n_licencas, valor,
//     responsavel_id, departamento_id, data_inicio, data_renovacao, renovacao_automatica, projeto_id, projeto_nome,
//     taxa_financiamento (0–100), estado ('por_aprovar'|'em_aquisicao'|'ativa'|'cancelada'|'expirada'|'recusada'), ligacao, notas, ... }
//   "valor" é o total de cada período (subscrição) ou de aquisição (perpétua), em € sem IVA.
//   Valor "base" = o que conta para custos: o anual equivalente (subscrição) ou o valor de aquisição (perpétua).
//   Financiado = base × taxa / 100 (parte paga pelo projeto); líquido = base − financiado (parte do departamento).
const LicencasLogica = {
  TIPOS: { subscricao: 'Subscrição', perpetua: 'Perpétua (aquisição única)' },
  PERIODICIDADES: { mensal: 'Mensal', anual: 'Anual', unica: 'Única' },
  // Ciclo de uma licença nova: por_aprovar (pedida; aguarda o Diretor do departamento) → em_aquisicao (aprovada; a ser comprada)
  // → ativa (adquirida). "recusada" = o Diretor não aprovou. Só as "ativa" contam para os custos; as outras duas entram à parte, como previsão.
  ESTADOS: { por_aprovar: 'Por aprovar', em_aquisicao: 'Em processo de aquisição', ativa: 'Ativa', cancelada: 'Cancelada', expirada: 'Expirada', recusada: 'Recusada' },
  ESTADOS_PREVISTOS: ['por_aprovar', 'em_aquisicao'],
  ehPrevista(l) { return !!l && this.ESTADOS_PREVISTOS.includes(l.estado); },
  MESES_POR_PERIODO: { mensal: 1, anual: 12 },

  // Sem acentos e em minúsculas — para procurar.
  norm(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); },
  novoId() { return globalThis.crypto.randomUUID(); },
  r2(n) { return Math.round((Number(n) || 0) * 100) / 100; },

  // Linha da base de dados → licença com números sempre números.
  normalizar(l) {
    return Object.assign({}, l, {
      valor: Number(l.valor) || 0, taxa_financiamento: Number(l.taxa_financiamento) || 0,
      n_licencas: l.n_licencas == null || l.n_licencas === '' ? null : Number(l.n_licencas),
      renovacao_automatica: l.renovacao_automatica !== false,
      fornecedor: l.fornecedor || '', projeto_nome: l.projeto_nome || '', ligacao: l.ligacao || '', notas: l.notas || ''
    });
  },
  // Licença em branco; "departamentoId"/"responsavelId" opcionais (a app sugere o departamento do responsável).
  nova(inicial) {
    return Object.assign({
      id: null, nome: '', fornecedor: '', tipo: 'subscricao', periodicidade: 'anual', n_licencas: null, valor: 0,
      responsavel_id: null, departamento_id: null, data_inicio: null, data_renovacao: null, renovacao_automatica: true,
      projeto_id: null, projeto_nome: '', taxa_financiamento: 0, estado: 'ativa', ligacao: '', notas: ''
    }, inicial || {});
  },
  ehSubscricao(l) { return l.tipo !== 'perpetua'; },

  // ---------- Valores ----------
  // Valor anual equivalente de uma subscrição (mensal × 12); 0 para uma perpétua (não se repete).
  valorAnual(l) {
    if (!this.ehSubscricao(l)) return 0;
    const meses = this.MESES_POR_PERIODO[l.periodicidade] || 12;
    return this.r2((Number(l.valor) || 0) * 12 / meses);
  },
  // O que conta para custos: anual (subscrição) ou aquisição (perpétua).
  valorBase(l) { return this.ehSubscricao(l) ? this.valorAnual(l) : this.r2(l.valor); },
  taxa(l) { return Math.min(100, Math.max(0, Number(l.taxa_financiamento) || 0)); },
  valorFinanciado(l) { return this.r2(this.valorBase(l) * this.taxa(l) / 100); },
  valorLiquido(l) { return this.r2(this.valorBase(l) - this.valorFinanciado(l)); },

  // ---------- Datas (texto "AAAA-MM-DD", sem fusos horários) ----------
  _partes(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; },
  _iso(a, m, d) { return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; },
  _diasNoMes(a, m) { return new Date(Date.UTC(a, m, 0)).getUTCDate(); },
  // Soma meses a uma data; se o dia não existir no mês de chegada, fica no último dia (31 jan + 1 mês = 28/29 fev).
  somarMeses(iso, n) {
    const p = this._partes(iso);
    if (!p) return null;
    const total = p[0] * 12 + (p[1] - 1) + n;
    const a = Math.floor(total / 12), m = total % 12 + 1;
    return this._iso(a, m, Math.min(p[2], this._diasNoMes(a, m)));
  },
  diasEntre(deIso, ateIso) {
    const a = this._partes(deIso), b = this._partes(ateIso);
    if (!a || !b) return null;
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  },
  // Próxima renovação a contar de "hoje". Com renovação automática (mensal/anual), a data guardada que já passou avança sozinha
  // para a próxima ocorrência — senão uma subscrição que renova sempre ficava "atrasada" até alguém lhe mudar a data à mão.
  proximaRenovacao(l, hoje) {
    if (!this._partes(l.data_renovacao)) return null;
    const meses = this.MESES_POR_PERIODO[l.periodicidade];
    if (!l.renovacao_automatica || !meses || !this.ehSubscricao(l)) return l.data_renovacao;
    let d = l.data_renovacao, k = 0;
    while (d < hoje && k < 600) { k++; d = this.somarMeses(l.data_renovacao, k * meses); } // a partir da data original (não acumula o recuo de fim de mês)
    return d;
  },
  // Só conta para alertas uma licença ativa com data de renovação.
  diasParaRenovacao(l, hoje) {
    if (l.estado !== 'ativa') return null;
    const d = this.proximaRenovacao(l, hoje);
    return d ? this.diasEntre(hoje, d) : null;
  },
  // 'sem' (sem data / não ativa) | 'atrasada' (a data já passou e não renova sozinha) | 'proxima' (até "janela" dias) | 'ok'
  situacaoRenovacao(l, hoje, janela) {
    const dias = this.diasParaRenovacao(l, hoje);
    if (dias == null) return 'sem';
    if (dias < 0) return 'atrasada';
    return dias <= (janela == null ? 30 : janela) ? 'proxima' : 'ok';
  },

  // ---------- Listas ----------
  // f: { texto, departamento, responsavel, projeto, estado, renovacao: '' | 'atrasadas' | '30' | '60' | '90', tipo }
  // ctx: { hoje, nomeResponsavel(l), nomeDepartamento(l) } — para a pesquisa por texto.
  filtrar(lista, f, ctx) {
    f = f || {}; ctx = ctx || {};
    const q = this.norm(f.texto);
    return (lista || []).filter(l => {
      if (f.departamento && l.departamento_id !== f.departamento) return false;
      if (f.responsavel && l.responsavel_id !== f.responsavel) return false;
      if (f.projeto === '_sem') { if (l.projeto_id || l.projeto_nome) return false; }
      else if (f.projeto && l.projeto_id !== f.projeto) return false;
      if (f.estado === 'abertas') { if (l.estado !== 'ativa' && !this.ehPrevista(l)) return false; } // ativas + por aprovar + em aquisição
      else if (f.estado && l.estado !== f.estado) return false;
      if (f.tipo && l.tipo !== f.tipo) return false;
      if (f.renovacao) {
        const dias = this.diasParaRenovacao(l, ctx.hoje);
        if (dias == null) return false;
        if (f.renovacao === 'atrasadas') { if (dias >= 0) return false; }
        else if (dias < 0 || dias > Number(f.renovacao)) return false;
      }
      if (q) {
        const alvo = this.norm([l.nome, l.fornecedor, l.projeto_nome, l.notas, ctx.nomeResponsavel ? ctx.nomeResponsavel(l) : '', ctx.nomeDepartamento ? ctx.nomeDepartamento(l) : ''].join(' '));
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  },
  // Ordem da lista: as que aguardam aprovação, depois as em aquisição; depois renovação mais próxima (as sem data, no fim), depois por nome.
  ordenar(lista, hoje) {
    const chave = l => { const d = this.diasParaRenovacao(l, hoje); return d == null ? Infinity : d; };
    const grupo = l => l.estado === 'por_aprovar' ? 0 : l.estado === 'em_aquisicao' ? 1 : 2;
    return (lista || []).slice().sort((a, b) => {
      const pa = grupo(a), pb = grupo(b);
      if (pa !== pb) return pa - pb;
      const ca = chave(a), cb = chave(b);
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.nome).localeCompare(String(b.nome), 'pt');
    });
  },
  // Só as licenças ATIVAS entram nos totais (uma cancelada/expirada já não custa).
  resumo(lista, hoje) {
    const ativas = (lista || []).filter(l => l.estado === 'ativa');
    const r = { n: ativas.length, anual: 0, aquisicoes: 0, financiado: 0, liquido: 0, atrasadas: { n: 0, valor: 0 }, ate30: { n: 0, valor: 0 }, ate60: { n: 0, valor: 0 }, ate90: { n: 0, valor: 0 } };
    ativas.forEach(l => {
      if (this.ehSubscricao(l)) r.anual += this.valorAnual(l); else r.aquisicoes += this.r2(l.valor);
      r.financiado += this.valorFinanciado(l);
      r.liquido += this.valorLiquido(l);
      const dias = this.diasParaRenovacao(l, hoje);
      if (dias == null) return;
      const v = this.r2(l.valor); // o que se paga NESTA renovação (um período)
      const soma = (k) => { r[k].n++; r[k].valor += v; };
      if (dias < 0) soma('atrasadas');
      else { if (dias <= 30) soma('ate30'); if (dias <= 60) soma('ate60'); if (dias <= 90) soma('ate90'); }
    });
    ['anual', 'aquisicoes', 'financiado', 'liquido'].forEach(k => { r[k] = this.r2(r[k]); });
    ['atrasadas', 'ate30', 'ate60', 'ate90'].forEach(k => { r[k].valor = this.r2(r[k].valor); });
    // Previsão: o que passa a custar quando o que está por aprovar / em aquisição ficar ativo (não entra nos totais acima).
    r.previsto = this.resumoPendentes(lista);
    r.porAprovar = this.resumoPendentes(lista, 'por_aprovar');
    r.emAquisicao = this.resumoPendentes(lista, 'em_aquisicao');
    return r;
  },
  // Licenças ainda não ativas (por aprovar e/ou em aquisição): quantas e quanto custariam (anual/aquisição, financiado e a cargo do
  // departamento). "estado" opcional restringe a um só estado; sem ele somam-se os dois.
  resumoPendentes(lista, estado) {
    const p = (lista || []).filter(l => estado ? l.estado === estado : this.ehPrevista(l));
    const r = { n: p.length, base: 0, financiado: 0, liquido: 0 };
    p.forEach(l => { r.base += this.valorBase(l); r.financiado += this.valorFinanciado(l); r.liquido += this.valorLiquido(l); });
    ['base', 'financiado', 'liquido'].forEach(k => { r[k] = this.r2(r[k]); });
    return r;
  },
  // Totais por departamento ou por projeto (licenças ativas; as em aquisição somam à parte em nPend/basePend). chave: 'departamento' | 'projeto'.
  // nomeDe(id, licenca) devolve o rótulo da chave; as licenças sem chave juntam-se em "(sem …)".
  agrupar(lista, chave, nomeDe) {
    const campo = chave === 'projeto' ? 'projeto_id' : 'departamento_id';
    const sem = chave === 'projeto' ? '(sem projeto)' : '(sem departamento)';
    const mapa = new Map();
    (lista || []).filter(l => l.estado === 'ativa' || this.ehPrevista(l)).forEach(l => {
      // um projeto fora da app (só texto) agrupa pelo texto
      const k = l[campo] || (chave === 'projeto' && l.projeto_nome ? 'txt:' + this.norm(l.projeto_nome) : '');
      if (!mapa.has(k)) mapa.set(k, { chave: k, nome: k ? (l[campo] ? nomeDe(l[campo], l) : l.projeto_nome) : sem, n: 0, base: 0, financiado: 0, liquido: 0, nPend: 0, basePend: 0 });
      const g = mapa.get(k);
      if (this.ehPrevista(l)) { g.nPend++; g.basePend += this.valorBase(l); return; }
      g.n++; g.base += this.valorBase(l); g.financiado += this.valorFinanciado(l); g.liquido += this.valorLiquido(l);
    });
    return [...mapa.values()].map(g => Object.assign(g, { base: this.r2(g.base), financiado: this.r2(g.financiado), liquido: this.r2(g.liquido), basePend: this.r2(g.basePend) }))
      .sort((a, b) => b.base - a.base || b.basePend - a.basePend || String(a.nome).localeCompare(String(b.nome), 'pt'));
  },

  // ---------- Aprovação e aquisição ----------
  paraAprovar(lista) { return (lista || []).filter(l => l.estado === 'por_aprovar'); },
  paraAdquirir(lista) { return (lista || []).filter(l => l.estado === 'em_aquisicao'); },
  // Campos a gravar quando o Diretor APROVA: passa a "em processo de aquisição" (ainda não custa nem tem datas: isso é quando for comprada).
  patchAprovar(quem, agoraIso) {
    return { estado: 'em_aquisicao', decisao_por_nome: quem || '', decisao_em: agoraIso, motivo_decisao: '' };
  },
  // Campos a gravar quando a licença é ADQUIRIDA: passa a ativa; o início fica hoje (se não tinha) e, numa subscrição sem data de
  // renovação, a primeira renovação cai um período depois do início (a pessoa ajusta se for outra).
  patchAdquirir(l, hoje) {
    const inicio = l.data_inicio || hoje, meses = this.MESES_POR_PERIODO[l.periodicidade];
    const renov = l.data_renovacao || (this.ehSubscricao(l) && meses ? this.somarMeses(inicio, meses) : null);
    return { estado: 'ativa', data_inicio: inicio, data_renovacao: renov };
  },
  patchRecusar(motivo, quem, agoraIso) {
    return { estado: 'recusada', decisao_por_nome: quem || '', decisao_em: agoraIso, motivo_decisao: String(motivo || '').trim() };
  },
  // Uma linha de texto por licença, para o email ao Diretor: "• Claude Team — Milton Cabral — 18,00 € / mês (216,00 €/ano) — financ. 50% — DIH 2.0".
  linhaPedido(l, nomePessoa, projeto) {
    const sub = this.ehSubscricao(l), per = l.periodicidade === 'mensal' ? ' / mês' : l.periodicidade === 'anual' ? ' / ano' : '';
    const partes = [l.nome + (l.n_licencas > 1 ? ` (${l.n_licencas} lic.)` : ''), nomePessoa || 'sem responsável',
      `${this.eur(l.valor)}${per}${sub && l.periodicidade === 'mensal' ? ` (${this.eur(this.valorAnual(l))}/ano)` : ''}`];
    if (this.taxa(l)) partes.push(`financiada a ${String(this.taxa(l)).replace('.', ',')}%`);
    if (projeto) partes.push(projeto);
    return '• ' + partes.join(' — ');
  },

  // ---------- Validação ----------
  // Devolve a lista de erros (vazia = pode gravar).
  validar(l) {
    const e = [];
    if (!String(l.nome || '').trim()) e.push('Indica o nome do software.');
    if (!l.departamento_id) e.push('Escolhe o departamento.');
    if (!(Number(l.valor) >= 0) || l.valor === '' || l.valor == null) e.push('Indica o valor (0 se for gratuita).');
    const t = Number(l.taxa_financiamento);
    if (!(t >= 0 && t <= 100)) e.push('A taxa de financiamento tem de estar entre 0 e 100%.');
    if (l.tipo === 'perpetua' && l.periodicidade !== 'unica') e.push('Uma licença perpétua tem periodicidade única.');
    if (l.tipo !== 'perpetua' && !['mensal', 'anual'].includes(l.periodicidade)) e.push('Uma subscrição é mensal ou anual.');
    if (l.n_licencas != null && !(Number(l.n_licencas) >= 0)) e.push('O número de licenças não pode ser negativo.');
    if (l.data_inicio && l.data_renovacao && l.data_renovacao < l.data_inicio) e.push('A data de renovação não pode ser anterior à data de início.');
    if (l.ligacao && !/^(https?:\/\/|\\\\|[a-zA-Z]:\\)/.test(String(l.ligacao).trim())) e.push('A ligação tem de começar por https:// (ou ser um caminho de rede).');
    return e;
  },

  // ---------- Formatação ----------
  eur(n) { return (Number(n) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }); },
  formatarData(iso) { const p = this._partes(iso); return p ? `${String(p[2]).padStart(2, '0')}/${String(p[1]).padStart(2, '0')}/${p[0]}` : '—'; },
  nomeFicheiroExcel(hoje) { return `Licencas_${String(hoje || '').replace(/-/g, '')}.xlsx`; }
};
if (typeof module !== 'undefined') module.exports = LicencasLogica;

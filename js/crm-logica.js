// Regras puras (sem DOM, sem Supabase) do módulo CRM: funil, valores ponderados, tarefas de follow-up,
// duplicados de contas, caminhos de documentos. Recebe sempre as listas já carregadas e devolve
// números/listas — por isso é testável à parte (tests/crm-logica.test.js).
//
// A lógica do funil usa SEMPRE a "categoria" da etapa ('aberta' | 'ganha' | 'perdida'), nunca o nome:
// o Administrador pode renomear, reordenar e acrescentar etapas à vontade sem partir nada.
const CrmLogica = {
  CATEGORIAS: ['aberta', 'ganha', 'perdida'],

  _porOrdem(a, b) { return (a.ordem || 0) - (b.ordem || 0) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt'); },

  // Etapas de um tipo de oportunidade, por ordem (só as ativas, por omissão).
  etapasDoTipo(etapas, tipoId, soAtivas = true) {
    return etapas.filter(e => e.tipo_id === tipoId && (!soAtivas || e.ativo !== false)).sort(this._porOrdem);
  },
  motivosDoTipo(motivos, tipoId, soAtivos = true) {
    return motivos.filter(m => m.tipo_id === tipoId && (!soAtivos || m.ativo !== false)).sort(this._porOrdem);
  },
  indexarPorId(lista) {
    const m = new Map();
    lista.forEach(x => m.set(x.id, x));
    return m;
  },

  categoriaDe(op, etapaPorId) {
    const e = etapaPorId.get(op.etapa_id);
    return e ? e.categoria : 'aberta';
  },
  probabilidadeDe(op, etapaPorId) {
    const e = etapaPorId.get(op.etapa_id);
    if (!e) return 0;
    if (e.categoria === 'ganha') return 100;
    if (e.categoria === 'perdida') return 0;
    return Math.min(100, Math.max(0, Number(e.probabilidade) || 0));
  },
  // Valor × probabilidade da etapa; ganha vale o valor todo, perdida zero.
  valorPonderado(op, etapaPorId) {
    return (Number(op.valor_estimado) || 0) * this.probabilidadeDe(op, etapaPorId) / 100;
  },

  // Totais do funil: em curso (com valor ponderado), ganhas e perdidas.
  resumoFunil(ops, etapaPorId) {
    const r = { abertas: { n: 0, valor: 0, ponderado: 0 }, ganhas: { n: 0, valor: 0 }, perdidas: { n: 0, valor: 0 } };
    ops.forEach(op => {
      const v = Number(op.valor_estimado) || 0;
      const cat = this.categoriaDe(op, etapaPorId);
      if (cat === 'ganha') { r.ganhas.n++; r.ganhas.valor += v; }
      else if (cat === 'perdida') { r.perdidas.n++; r.perdidas.valor += v; }
      else { r.abertas.n++; r.abertas.valor += v; r.abertas.ponderado += this.valorPonderado(op, etapaPorId); }
    });
    return r;
  },
  // Ganhas / (ganhas + perdidas); null quando ainda não há nenhuma fechada.
  taxaConversao(ops, etapaPorId) {
    const { ganhas, perdidas } = this.resumoFunil(ops, etapaPorId);
    const fechadas = ganhas.n + perdidas.n;
    return fechadas ? ganhas.n / fechadas : null;
  },

  // Uma coluna por etapa (na ordem dada), mesmo vazia — é o que o quadro desenha.
  agruparPorEtapa(ops, etapasOrdenadas) {
    const grupos = new Map(etapasOrdenadas.map(e => [e.id, []]));
    ops.forEach(op => { if (grupos.has(op.etapa_id)) grupos.get(op.etapa_id).push(op); });
    return grupos;
  },

  // Regras de mudança de etapa: tem de ser uma etapa do MESMO tipo, e uma perdida exige motivo.
  validarMudancaEtapa(op, etapaDestino, motivoPerdaId, motivosDoTipoIds) {
    if (!etapaDestino) return { ok: false, erro: 'Etapa inválida.' };
    if (etapaDestino.tipo_id !== op.tipo_id) return { ok: false, erro: 'Esta etapa pertence a outro tipo de oportunidade.' };
    if (etapaDestino.categoria === 'perdida') {
      if (!motivoPerdaId) return { ok: false, erro: 'Indica o motivo da perda.' };
      if (motivosDoTipoIds && !motivosDoTipoIds.includes(motivoPerdaId)) return { ok: false, erro: 'Motivo de perda inválido para este tipo.' };
    }
    return { ok: true };
  },

  // ---------- Tarefas de follow-up ----------
  estadoTarefa(t, hojeISO) {
    if (t.concluida) return 'concluida';
    if (!t.data_limite) return 'sem-data';
    if (t.data_limite < hojeISO) return 'atrasada';
    if (t.data_limite === hojeISO) return 'hoje';
    return 'proxima';
  },
  // { atrasada, hoje, proxima, 'sem-data', concluida } — dentro de cada grupo, por data limite.
  agruparTarefas(tarefas, hojeISO) {
    const g = { atrasada: [], hoje: [], proxima: [], 'sem-data': [], concluida: [] };
    tarefas.forEach(t => g[this.estadoTarefa(t, hojeISO)].push(t));
    Object.keys(g).forEach(k => g[k].sort((a, b) => String(a.data_limite || '9999').localeCompare(String(b.data_limite || '9999'))));
    return g;
  },
  contarAtrasadas(tarefas, hojeISO, responsavelId) {
    return tarefas.filter(t => this.estadoTarefa(t, hojeISO) === 'atrasada' && (!responsavelId || t.responsavel_id === responsavelId)).length;
  },

  // ---------- Contas: duplicados ----------
  normalizarNome(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,;:()'"\-_/&]/g, ' ')
      .replace(/\b(lda|limitada|sa|unipessoal|s a|sociedade anonima|lda\.)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  },
  soDigitos(s) { return String(s || '').replace(/\D+/g, ''); },
  // Primeira conta que já tenha o mesmo NIF (só dígitos, não vazio) ou o mesmo nome normalizado.
  duplicadoConta(contas, { nome, nif }, ignorarId) {
    const nifN = this.soDigitos(nif);
    const nomeN = this.normalizarNome(nome);
    return contas.find(c => {
      if (ignorarId && c.id === ignorarId) return false;
      if (nifN && this.soDigitos(c.nif) === nifN) return true;
      return !!nomeN && this.normalizarNome(c.nome) === nomeN;
    }) || null;
  },

  // ---------- Propostas ----------
  proximaVersao(propostas, oportunidadeId) {
    return propostas.filter(p => p.oportunidade_id === oportunidadeId).reduce((m, p) => Math.max(m, Number(p.versao) || 0), 0) + 1;
  },
  validarProposta(p) {
    const erros = [];
    if (!(Number(p.valor) >= 0)) erros.push('O valor tem de ser um número igual ou superior a 0.');
    if (!(Number(p.versao) >= 1)) erros.push('A versão tem de ser 1 ou mais.');
    if (p.data_envio && p.data_validade && p.data_validade < p.data_envio) erros.push('A validade não pode ser anterior à data de envio.');
    if (p.estado === 'enviada' && !p.data_envio) erros.push('Uma proposta enviada precisa de data de envio.');
    return erros;
  },
  // Uma ligação (http/https) abre-se; um caminho de rede/disco (\\servidor\pasta, C:\...) só se pode
  // mostrar e copiar — o browser não abre caminhos locais.
  tipoCaminho(caminho) {
    const c = String(caminho || '').trim();
    if (!c) return { tipo: 'vazio', texto: '' };
    if (/^https?:\/\//i.test(c)) return { tipo: 'url', texto: c, href: c };
    return { tipo: 'caminho', texto: c };
  },
  // A proposta "em vigor" de uma oportunidade: a aceite, senão a de versão mais alta.
  propostaVigente(propostas, oportunidadeId) {
    const doOp = propostas.filter(p => p.oportunidade_id === oportunidadeId);
    return doOp.find(p => p.estado === 'aceite') || doOp.slice().sort((a, b) => (b.versao || 0) - (a.versao || 0))[0] || null;
  },

  // ---------- Formatação ----------
  euro(v) { return (Number(v) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); },
  data(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'; }
};
if (typeof module !== 'undefined') module.exports = CrmLogica;

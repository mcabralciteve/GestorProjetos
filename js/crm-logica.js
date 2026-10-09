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

  // ============================ Fase 2: dashboard ============================
  // Intervalo [de, ate] (datas ISO inclusivas, ou null = sem limite) de um período predefinido.
  periodoPreset(preset, hojeISO) {
    const [a, m, d] = hojeISO.split('-').map(Number);
    const iso = (y, mes, dia) => `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const ultimoDia = (y, mes) => new Date(Date.UTC(y, mes, 0)).getUTCDate();
    if (preset === 'ano') return { de: iso(a, 1, 1), ate: iso(a, 12, 31) };
    if (preset === 'trimestre') {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { de: iso(a, q0, 1), ate: iso(a, q0 + 2, ultimoDia(a, q0 + 2)) };
    }
    if (preset === '12m') {
      // Os 12 meses que terminam hoje: do dia seguinte ao mesmo dia do ano passado até hoje.
      const dt = new Date(Date.UTC(a - 1, m - 1, d + 1));
      return { de: dt.toISOString().slice(0, 10), ate: hojeISO };
    }
    return { de: null, ate: null };
  },
  _dentro(iso, de, ate) { return !!iso && (!de || iso >= de) && (!ate || iso <= ate); },

  // Em curso, por etapa (só as abertas), na ordem do funil — o que o gráfico de barras desenha.
  pipelinePorEtapa(ops, etapasDoTipoOrdenadas) {
    return etapasDoTipoOrdenadas.filter(e => e.categoria === 'aberta').map(e => {
      const doGrupo = ops.filter(o => o.etapa_id === e.id);
      const valor = doGrupo.reduce((s, o) => s + (Number(o.valor_estimado) || 0), 0);
      return { etapa: e, n: doGrupo.length, valor, ponderado: valor * (Math.min(100, Math.max(0, Number(e.probabilidade) || 0))) / 100 };
    });
  },
  // Quando se espera fechar o que está em curso: por mês da data prevista de fecho (valor ponderado),
  // à parte as que já passaram da data e as que nem têm data.
  previsaoPorMes(ops, etapaPorId, hojeISO) {
    const meses = new Map();
    const atrasadas = { n: 0, valor: 0, ponderado: 0 }, semData = { n: 0, valor: 0, ponderado: 0 };
    const somar = (o, op) => { const v = Number(op.valor_estimado) || 0; o.n++; o.valor += v; o.ponderado += this.valorPonderado(op, etapaPorId); };
    ops.forEach(op => {
      if (this.categoriaDe(op, etapaPorId) !== 'aberta') return;
      if (!op.data_prevista_fecho) { somar(semData, op); return; }
      if (op.data_prevista_fecho < hojeISO) { somar(atrasadas, op); return; }
      const k = op.data_prevista_fecho.slice(0, 7);
      if (!meses.has(k)) meses.set(k, { mes: k, n: 0, valor: 0, ponderado: 0 });
      somar(meses.get(k), op);
    });
    return { meses: [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)), atrasadas, semData };
  },
  // Ganhas/perdidas fechadas no período (pela data de fecho).
  resumoFechadas(ops, etapaPorId, de, ate) {
    const r = { ganhas: { n: 0, valor: 0 }, perdidas: { n: 0, valor: 0 } };
    ops.forEach(op => {
      const cat = this.categoriaDe(op, etapaPorId);
      if (cat === 'aberta' || !this._dentro(op.data_fecho, de, ate)) return;
      const alvo = cat === 'ganha' ? r.ganhas : r.perdidas;
      alvo.n++; alvo.valor += Number(op.valor_estimado) || 0;
    });
    const f = r.ganhas.n + r.perdidas.n;
    r.conversao = f ? r.ganhas.n / f : null;
    return r;
  },
  fechadasPorMes(ops, etapaPorId, de, ate) {
    const meses = new Map();
    ops.forEach(op => {
      const cat = this.categoriaDe(op, etapaPorId);
      if (cat === 'aberta' || !this._dentro(op.data_fecho, de, ate)) return;
      const k = op.data_fecho.slice(0, 7);
      if (!meses.has(k)) meses.set(k, { mes: k, ganhas: { n: 0, valor: 0 }, perdidas: { n: 0, valor: 0 } });
      const alvo = cat === 'ganha' ? meses.get(k).ganhas : meses.get(k).perdidas;
      alvo.n++; alvo.valor += Number(op.valor_estimado) || 0;
    });
    return [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  },
  // Motivos de perda no período, do mais frequente para o menos.
  motivosDePerda(ops, motivoPorId, etapaPorId, de, ate) {
    const g = new Map();
    ops.forEach(op => {
      if (this.categoriaDe(op, etapaPorId) !== 'perdida' || !this._dentro(op.data_fecho, de, ate)) return;
      const k = op.motivo_perda_id || '';
      if (!g.has(k)) g.set(k, { nome: k && motivoPorId.get(k) ? motivoPorId.get(k).nome : 'Sem motivo registado', n: 0, valor: 0 });
      g.get(k).n++; g.get(k).valor += Number(op.valor_estimado) || 0;
    });
    return [...g.values()].sort((a, b) => b.n - a.n || b.valor - a.valor);
  },
  // Oportunidades em curso que pedem atenção: data de fecho ultrapassada, ou sem nenhum follow-up
  // pendente (ninguém tem nada marcado para as fazer avançar).
  emRisco(ops, etapaPorId, tarefas, hojeISO) {
    const comFollowup = new Set(tarefas.filter(t => !t.concluida && t.oportunidade_id).map(t => t.oportunidade_id));
    const lista = [];
    ops.forEach(op => {
      if (this.categoriaDe(op, etapaPorId) !== 'aberta') return;
      const motivos = [];
      if (op.data_prevista_fecho && op.data_prevista_fecho < hojeISO) motivos.push('fecho previsto ultrapassado');
      if (!comFollowup.has(op.id)) motivos.push('sem follow-up marcado');
      if (motivos.length) lista.push({ op, motivos });
    });
    return lista.sort((a, b) => b.motivos.length - a.motivos.length || (Number(b.op.valor_estimado) || 0) - (Number(a.op.valor_estimado) || 0));
  },

  // ============================ Fase 2: importação ============================
  // Texto CSV → matriz de células. Deteta o separador (; , ou tab) pela 1.ª linha e respeita aspas.
  parseCsv(texto) {
    const t = String(texto || '').replace(/^﻿/, '');
    const primeira = t.split(/\r?\n/, 1)[0] || '';
    const sep = [';', '\t', ','].map(s => [s, primeira.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const linhas = [];
    let cel = '', linha = [], aspas = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (aspas) {
        if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
        else cel += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { linha.push(cel); cel = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i++;
        linha.push(cel); cel = '';
        if (linha.some(x => x.trim() !== '')) linhas.push(linha);
        linha = [];
      } else cel += c;
    }
    linha.push(cel);
    if (linha.some(x => x.trim() !== '')) linhas.push(linha);
    return linhas;
  },

  CAMPOS_CONTA: [
    { k: 'nome', rotulo: 'Nome', obrig: true, aliases: ['nome', 'name', 'empresa', 'cliente', 'razao social', 'organizacao', 'organization', 'company', 'conta', 'account', 'account name', 'designacao', 'denominacao'] },
    { k: 'nif', rotulo: 'NIF', aliases: ['nif', 'nipc', 'contribuinte', 'vat', 'vat id', 'vat number', 'tax id', 'n fiscal', 'numero fiscal', 'nr contribuinte'] },
    { k: 'setor', rotulo: 'Setor', aliases: ['setor', 'sector', 'industria', 'industry', 'cae', 'atividade', 'area de atividade'] },
    { k: 'dimensao', rotulo: 'Dimensão', aliases: ['dimensao', 'dimension', 'size', 'tamanho', 'dimensao empresa'] },
    { k: 'morada', rotulo: 'Morada (rua)', aliases: ['morada', 'billing street', 'rua', 'endereco', 'address', 'cidade', 'city'] },
    { k: 'cp', rotulo: 'Código postal (junta à morada)', aliases: ['billing postal code', 'codigo postal', 'cp', 'postal code', 'zip'] },
    { k: 'localidade', rotulo: 'Localidade (junta à morada)', aliases: ['billing city', 'localidade', 'concelho'] },
    { k: 'website', rotulo: 'Website', aliases: ['website', 'site', 'web', 'url', 'pagina web'] },
    { k: 'estado', rotulo: 'Estado', aliases: ['estado', 'tipo conta', 'tipo de cliente', 'fase'] },
    { k: 'responsavel', rotulo: 'Responsável (utilizador)', aliases: ['assigned to', 'responsavel', 'owner', 'assigned user', 'atribuido a'] },
    { k: 'notas', rotulo: 'Notas', aliases: ['notas', 'observacoes', 'notes', 'comentarios', 'descricao', 'description'] },
    { k: 'apagado', rotulo: 'Apagado (ignora se 1)', aliases: ['deleted', 'apagado', 'eliminado'] }
  ],
  CAMPOS_CONTACTO: [
    { k: 'nome', rotulo: 'Nome do contacto', obrig: true, aliases: ['nome', 'first name', 'primeiro nome', 'name', 'contacto', 'contact', 'nome completo', 'full name', 'pessoa'] },
    { k: 'apelido', rotulo: 'Apelido (junta ao nome)', aliases: ['apelido', 'last name', 'surname', 'sobrenome', 'ultimo nome'] },
    { k: 'conta_nome', rotulo: 'Conta (nome)', aliases: ['empresa', 'conta', 'cliente', 'organizacao', 'organization', 'company', 'account', 'account name', 'entidade'] },
    { k: 'conta_nif', rotulo: 'Conta (NIF)', aliases: ['nif', 'nipc', 'nif empresa', 'vat', 'contribuinte'] },
    { k: 'cargo', rotulo: 'Cargo', aliases: ['cargo', 'funcao', 'title', 'job title', 'position', 'posicao'] },
    { k: 'email', rotulo: 'Email', aliases: ['email', 'e mail', 'mail', 'correio eletronico'] },
    { k: 'telefone', rotulo: 'Telefone (telemóvel)', aliases: ['telefone', 'telemovel', 'phone', 'mobile', 'tel', 'contacto telefonico'] },
    { k: 'telefone2', rotulo: 'Telefone alternativo (se faltar o 1.º)', aliases: ['office phone', 'telefone fixo', 'phone office', 'other phone', 'home'] },
    { k: 'papel_decisao', rotulo: 'Papel na decisão', aliases: ['papel', 'papel decisao', 'papel na decisao', 'decisor', 'role'] },
    { k: 'notas', rotulo: 'Notas', aliases: ['notas', 'observacoes', 'notes', 'comentarios', 'description'] },
    { k: 'apagado', rotulo: 'Apagado (ignora se 1)', aliases: ['deleted', 'apagado', 'eliminado'] }
  ],
  _normCab(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  },
  // Sugere, para cada campo, a coluna do ficheiro (índice) com o cabeçalho que melhor lhe corresponde;
  // -1 quando não encontra. Cada coluna só serve um campo.
  autoMapear(cabecalhos, campos) {
    const norm = cabecalhos.map(c => this._normCab(c));
    const usadas = new Set();
    const mapa = {};
    campos.forEach(c => { mapa[c.k] = -1; });
    const passar = (testa) => campos.forEach(c => {
      if (mapa[c.k] !== -1) return;
      const al = c.aliases.map(a => this._normCab(a));
      const i = norm.findIndex((h, idx) => !usadas.has(idx) && h && testa(h, al));
      if (i !== -1) { mapa[c.k] = i; usadas.add(i); }
    });
    passar((h, al) => al.includes(h));                                                                 // igual a um alias
    passar((h, al) => al.some(a => h.split(' ').includes(a) || (a.includes(' ') && h.includes(a)))); // contém-no como palavra
    return mapa;
  },
  // Célula limpa: sem espaços, sem o apóstrofo que o SuiteCRM põe à frente de alguns valores ("'+351…") e
  // sem os marcadores de "vazio" ("-").
  _cel(linha, i) {
    const v = i >= 0 && linha[i] != null ? String(linha[i]).trim().replace(/^'+/, '').trim() : '';
    return /^-+$/.test(v) ? '' : v;
  },
  // Só fica um endereço web que o pareça mesmo (ignora "http://" sozinho e texto solto).
  normalizarWebsite(v) {
    const t = String(v || '').trim();
    if (!t || /\s/.test(t)) return '';
    if (/^https?:\/\/[^\s\/]+\.[^\s\/]+/i.test(t)) return t;
    if (/^(www\.)?[^\s\/]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return 'https://' + t;
    return '';
  },
  comporMorada(rua, cp, localidade) {
    return [rua, [cp, localidade].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  },
  // null quando o texto não é um estado conhecido (ao atualizar, nunca se assume um estado por omissão).
  reconhecerEstadoConta(v) {
    const n = this._normCab(v);
    if (/^(ativo|ativa|active|cliente|customer)$/.test(n)) return 'ativo';
    if (/^(inativo|inativa|inactive|perdido|antigo)$/.test(n)) return 'inativo';
    if (/^(prospeto|prospecto|prospect|lead|potencial)$/.test(n)) return 'prospeto';
    return null;
  },
  normalizarEstadoConta(v, padrao) { return this.reconhecerEstadoConta(v) || padrao || 'prospeto'; },
  normalizarDimensao(v) {
    const n = this._normCab(v);
    if (/^pme|^sme/.test(n)) return 'PME';
    if (/^micro/.test(n)) return 'Micro';
    if (/^peq|^small/.test(n)) return 'Pequena';
    if (/^med|^medium/.test(n)) return 'Média';
    if (/^gra|^large|^big/.test(n)) return 'Grande';
    return '';
  },
  normalizarPapelDecisao(v) {
    const n = this._normCab(v);
    if (/decisor|decision|decide/.test(n)) return 'decisor';
    if (/influen/.test(n)) return 'influenciador';
    if (/tecnic|technic/.test(n)) return 'tecnico';
    return '';
  },
  // Pré-visualização da importação de CONTAS (matriz inclui a linha de cabeçalho em [0]). Devolve o que
  // seria criado e o que fica de fora (duplicados — de contas já existentes ou repetidos no próprio
  // ficheiro — e linhas inválidas); a linha é a do ficheiro (1 = cabeçalho).
  prepararContas(matriz, mapa, existentes, opts) {
    opts = opts || {};
    const r = { novas: [], atualizar: [], iguais: 0, avisos: [], duplicadas: [], invalidas: [] };
    const aceites = existentes.slice();
    const tratadas = new Set();   // contas já existentes que este ficheiro já atualizou (a 2.ª linha igual é repetida)
    matriz.slice(1).forEach((linha, idx) => {
      if (!linha.some(x => String(x).trim() !== '') || this._eApagado(this._cel(linha, mapa.apagado))) return;
      const nl = idx + 2;
      const nome = this._cel(linha, mapa.nome);
      if (!nome) { r.invalidas.push({ linha: nl, motivo: 'Sem nome' }); return; }
      const nif = this._cel(linha, mapa.nif);
      const dup = this.duplicadoConta(aceites, { nome, nif });
      if (dup) {
        const existente = existentes.includes(dup) ? dup : null;
        if (existente && opts.atualizarExistentes && !tratadas.has(existente.id)) {
          tratadas.add(existente.id);
          // Atualiza só o que o ficheiro TRAZ e é diferente; vazio nunca apaga.
          const cmp = this.compararConta(existente, {
            nif, setor: this._cel(linha, mapa.setor), dimensao: this.normalizarDimensao(this._cel(linha, mapa.dimensao)),
            morada: this.comporMorada(this._cel(linha, mapa.morada), this._cel(linha, mapa.cp), this._cel(linha, mapa.localidade)),
            website: this.normalizarWebsite(this._cel(linha, mapa.website)),
            estado: mapa.estado >= 0 ? this.reconhecerEstadoConta(this._cel(linha, mapa.estado)) : null, notas: this._cel(linha, mapa.notas),
            responsavelId: this.resolverResponsavel(this._cel(linha, mapa.responsavel), opts.recursos || [])
          });
          cmp.avisos.forEach(a => r.avisos.push({ linha: nl, motivo: a }));
          if (cmp.mudancas.length) r.atualizar.push({ linha: nl, nome: existente.nome, existente, patch: cmp.patch, mudancas: cmp.mudancas }); else r.iguais++;
          return;
        }
        r.duplicadas.push({ linha: nl, nome, com: dup.nome, noFicheiro: !existente || tratadas.has(existente.id) });
        return;
      }
      const conta = {
        nome, nif, setor: this._cel(linha, mapa.setor), dimensao: this.normalizarDimensao(this._cel(linha, mapa.dimensao)),
        morada: this.comporMorada(this._cel(linha, mapa.morada), this._cel(linha, mapa.cp), this._cel(linha, mapa.localidade)),
        website: this.normalizarWebsite(this._cel(linha, mapa.website)),
        estado: this.normalizarEstadoConta(this._cel(linha, mapa.estado), opts.estadoPadrao), notas: this._cel(linha, mapa.notas),
        responsavel_id: this.resolverResponsavel(this._cel(linha, mapa.responsavel), opts.recursos || [])
      };
      aceites.push(conta);
      r.novas.push(conta);
    });
    return r;
  },
  // O que mudaria numa conta que já existe. NIF: só se preenche quando a conta ainda não tem; se tiver outro, avisa e
  // não mexe. Notas: só se a conta ainda não tiver (nunca se sobrepõem notas escritas na app).
  compararConta(ex, n) {
    const patch = {}, mudancas = [], avisos = [];
    const alt = (k, para) => { mudancas.push({ k, de: ex[k], para }); patch[k] = para; };
    if (n.nif) {
      if (!this.soDigitos(ex.nif)) alt('nif', n.nif);
      else if (this.soDigitos(ex.nif) !== this.soDigitos(n.nif)) avisos.push(`"${ex.nome}" já tem o NIF ${ex.nif}; o ficheiro traz ${n.nif} — NIF não alterado`);
    }
    ['setor', 'dimensao', 'morada', 'website'].forEach(k => { if (n[k] && n[k] !== (ex[k] || '')) alt(k, n[k]); });
    if (n.estado && n.estado !== ex.estado) alt('estado', n.estado);
    if (n.responsavelId && n.responsavelId !== ex.responsavel_id) alt('responsavel_id', n.responsavelId);
    if (n.notas && !String(ex.notas || '').trim()) alt('notas', n.notas);
    return { patch, mudancas, avisos };
  },
  // Idem para um contacto que já existe. Nome só muda quando o contacto foi encontrado pelo email (mesmo email, nome
  // escrito de outra forma). Notas: só se ainda não tiver.
  compararContacto(ex, n) {
    const patch = {}, mudancas = [];
    const alt = (k, para) => { mudancas.push({ k, de: ex[k], para }); patch[k] = para; };
    if (n.atualizarNome && n.nome && this.normalizarNome(n.nome) !== this.normalizarNome(ex.nome)) alt('nome', n.nome);
    ['cargo', 'telefone'].forEach(k => { if (n[k] && n[k] !== (ex[k] || '')) alt(k, n[k]); });
    if (n.email && n.email.toLowerCase() !== String(ex.email || '').toLowerCase()) alt('email', n.email);
    if (n.papel_decisao && n.papel_decisao !== (ex.papel_decisao || '')) alt('papel_decisao', n.papel_decisao);
    if (n.notas && !String(ex.notas || '').trim()) alt('notas', n.notas);
    return { patch, mudancas };
  },
  // Idem para CONTACTOS: cada um liga-se a uma conta pelo NIF, ou senão pelo nome (normalizado). Sem
  // conta correspondente, ou se cria a conta (opts.criarContas) ou o contacto fica de fora.
  prepararContactos(matriz, mapa, contas, contactosExistentes, opts) {
    opts = opts || {};
    const r = { novos: [], atualizar: [], iguais: 0, contasACriar: [], duplicados: [], semConta: [], invalidos: [], avisos: [] };
    const contaPorNif = new Map(), contaPorNome = new Map();
    contas.forEach(c => {
      if (this.soDigitos(c.nif)) contaPorNif.set(this.soDigitos(c.nif), c);
      contaPorNome.set(this.normalizarNome(c.nome), c);
    });
    const porNome = new Map(contactosExistentes.map(c => [`${c.conta_id}|${this.normalizarNome(c.nome)}`, c]));
    const porEmail = new Map(contactosExistentes.filter(c => c.email).map(c => [`${c.conta_id}|${String(c.email).toLowerCase()}`, c]));
    const tratados = new Set();   // contactos já existentes que este ficheiro já atualizou
    const novasPorChave = new Map();
    const vistos = new Set(contactosExistentes.map(c => `${c.conta_id}|${this.normalizarNome(c.nome)}`));
    const emails = new Set(contactosExistentes.filter(c => c.email).map(c => `${c.conta_id}|${String(c.email).toLowerCase()}`));
    matriz.slice(1).forEach((linha, idx) => {
      if (!linha.some(x => String(x).trim() !== '') || this._eApagado(this._cel(linha, mapa.apagado))) return;
      const nl = idx + 2;
      const nome = [this._cel(linha, mapa.nome), this._cel(linha, mapa.apelido)].filter(Boolean).join(' ');
      if (!nome) { r.invalidos.push({ linha: nl, motivo: 'Sem nome' }); return; }
      const nomeConta = this._cel(linha, mapa.conta_nome), nifConta = this.soDigitos(this._cel(linha, mapa.conta_nif));
      const conta = (nifConta && contaPorNif.get(nifConta)) || (nomeConta && contaPorNome.get(this.normalizarNome(nomeConta))) || null;
      let contaRef = null;
      if (!conta) {
        const chave = nifConta || this.normalizarNome(nomeConta);
        if (!chave) { r.semConta.push({ linha: nl, nome, conta: '' }); return; }
        if (!opts.criarContas) { r.semConta.push({ linha: nl, nome, conta: nomeConta || nifConta }); return; }
        if (!novasPorChave.has(chave)) { const nova = { nome: nomeConta || nifConta, nif: nifConta }; novasPorChave.set(chave, nova); r.contasACriar.push(nova); }
        contaRef = novasPorChave.get(chave);
      }
      const contaChave = conta ? conta.id : '@' + (contaRef.nif || this.normalizarNome(contaRef.nome));
      let email = this._cel(linha, mapa.email);
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { r.avisos.push({ linha: nl, motivo: `Email inválido ignorado (${email})` }); email = ''; }
      const chaveNome = `${contaChave}|${this.normalizarNome(nome)}`;
      const porNomeEx = conta ? porNome.get(chaveNome) : null;
      const existente = porNomeEx || (conta && email ? porEmail.get(`${contaChave}|${email.toLowerCase()}`) : null) || null;
      if (existente && opts.atualizarExistentes && !tratados.has(existente.id)) {
        tratados.add(existente.id);
        const cmp = this.compararContacto(existente, {
          nome, atualizarNome: !porNomeEx, cargo: this._cel(linha, mapa.cargo), email,
          telefone: this._cel(linha, mapa.telefone) || this._cel(linha, mapa.telefone2),
          papel_decisao: this.normalizarPapelDecisao(this._cel(linha, mapa.papel_decisao)), notas: this._cel(linha, mapa.notas)
        });
        if (cmp.mudancas.length) r.atualizar.push({ linha: nl, nome: existente.nome, existente, patch: cmp.patch, mudancas: cmp.mudancas }); else r.iguais++;
        return;
      }
      if (vistos.has(chaveNome) || (email && emails.has(`${contaChave}|${email.toLowerCase()}`))) { r.duplicados.push({ linha: nl, nome }); return; }
      vistos.add(chaveNome); if (email) emails.add(`${contaChave}|${email.toLowerCase()}`);
      r.novos.push({
        conta_id: conta ? conta.id : null, conta_ref: contaRef, nome, cargo: this._cel(linha, mapa.cargo), email,
        telefone: this._cel(linha, mapa.telefone) || this._cel(linha, mapa.telefone2), papel_decisao: this.normalizarPapelDecisao(this._cel(linha, mapa.papel_decisao)), notas: this._cel(linha, mapa.notas)
      });
    });
    return r;
  },

  // ============================ Importação de oportunidades (e extras do SuiteCRM) ============================
  CAMPOS_OPORTUNIDADE: [
    { k: 'titulo', rotulo: 'Título', obrig: true, aliases: ['opportunity name', 'titulo', 'nome', 'name', 'oportunidade'] },
    { k: 'conta_nome', rotulo: 'Conta (nome)', obrig: true, aliases: ['account name', 'conta', 'empresa', 'cliente', 'organizacao', 'company', 'account'] },
    { k: 'valor', rotulo: 'Valor (€)', aliases: ['opportunity amount', 'amount', 'valor', 'montante', 'valor estimado'] },
    { k: 'fecho', rotulo: 'Data prevista de fecho', aliases: ['expected close date', 'close date', 'data de fecho', 'fecho previsto', 'data prevista'] },
    { k: 'etapa', rotulo: 'Etapa', obrig: true, aliases: ['sales stage', 'etapa', 'fase', 'stage', 'estado'] },
    { k: 'probabilidade', rotulo: 'Probabilidade (ajuda a escolher a etapa)', aliases: ['probability', 'probabilidade', 'probability %'] },
    { k: 'tipo', rotulo: 'Tipo de oportunidade', obrig: true, aliases: ['type', 'tipo', 'tipo de oportunidade'] },
    { k: 'responsavel', rotulo: 'Responsável (utilizador)', aliases: ['assigned to', 'responsavel', 'owner', 'assigned user', 'atribuido a'] },
    { k: 'origem', rotulo: 'Origem', aliases: ['lead source', 'origem', 'source'] },
    { k: 'descricao', rotulo: 'Descrição', aliases: ['description', 'descricao', 'notas'] },
    { k: 'proximo_passo', rotulo: 'Próximo passo (vira follow-up)', aliases: ['next step', 'proximo passo', 'next steps'] },
    { k: 'ref_giaf', rotulo: 'Referência GIAF (liga ao projeto)', aliases: ['ano obra referencia giaf', 'referencia giaf', 'ano obra', 'ref giaf', 'giaf'] },
    { k: 'apagado', rotulo: 'Apagado (ignora se 1)', aliases: ['deleted', 'apagado', 'eliminado'] }
  ],
  ORIGENS_SUITECRM: { 'existing customer': 'Cliente existente', 'sales contact': 'Contacto comercial', conference: 'Evento / feira', 'trade show': 'Evento / feira', 'web site': 'Website', 'word of mouth': 'Recomendação', partner: 'Parceiro', employee: 'Colaborador', other: 'Outro' },
  traduzirOrigem(v) { const n = this._normCab(v); return n ? (this.ORIGENS_SUITECRM[n] || String(v).trim()) : ''; },

  // "€8.100,00" / "8100,5" / "8,100.50" / "700.000" → número. Aceita os formatos português e inglês.
  parseValor(s) {
    let t = String(s == null ? '' : s).trim().replace(/[€$£\s]/g, '').replace(/^'+/, '');
    if (!t || !/\d/.test(t)) return null;
    const negativo = t.startsWith('-');
    t = t.replace(/[^\d.,]/g, '');
    const ultimaVirg = t.lastIndexOf(','), ultimoPonto = t.lastIndexOf('.');
    if (ultimaVirg !== -1 && ultimoPonto !== -1) {
      // O separador que aparece por último é o decimal.
      if (ultimaVirg > ultimoPonto) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
    } else if (ultimaVirg !== -1) {
      t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (ultimoPonto !== -1) {
      if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    }
    const n = parseFloat(t);
    return isNaN(n) ? null : (negativo ? -n : n);
  },
  // Descobre o formato das datas a partir dos valores: "mdy" (americano, SuiteCRM), "dmy" ou "ymd".
  detectarFormatoData(valores) {
    let mdy = true, dmy = true, viu = false;
    for (const v of valores) {
      const t = String(v || '').trim();
      if (!t) continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return 'ymd';
      const m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
      if (!m) continue;
      viu = true;
      if (Number(m[1]) > 12) mdy = false;
      if (Number(m[2]) > 12) dmy = false;
    }
    if (!viu) return 'mdy';
    if (mdy && !dmy) return 'mdy';
    if (dmy && !mdy) return 'dmy';
    return 'mdy'; // ambíguo: o SuiteCRM exporta no formato americano
  },
  parseData(s, formato) {
    const t = String(s == null ? '' : s).trim();
    if (!t) return null;
    let a, m, d;
    let x = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (x) { a = +x[1]; m = +x[2]; d = +x[3]; }
    else {
      x = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
      if (!x) return null;
      const p1 = +x[1], p2 = +x[2];
      a = +x[3] < 100 ? 2000 + +x[3] : +x[3];
      if (formato === 'dmy') { d = p1; m = p2; } else { m = p1; d = p2; }
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return dt.toISOString().slice(0, 10);
  },
  // Quem é "mcabral"? O utilizador do ficheiro antigo costuma ser a inicial do nome + apelido, ou a
  // parte do email antes do @. Devolve o id do recurso ou null.
  resolverResponsavel(valor, recursos) {
    const v = this._normCab(valor).replace(/\s+/g, '');
    if (!v) return null;
    const achado = recursos.find(r => {
      const mail = String(r.email || '').split('@')[0];
      if (mail && this._normCab(mail).replace(/\s+/g, '') === v) return true;
      const partes = this._normCab(r.nome).split(' ').filter(Boolean);
      if (!partes.length) return false;
      if (partes.join('') === v) return true;
      return partes.length > 1 && (partes[0][0] + partes[partes.length - 1]) === v;
    });
    return achado ? achado.id : null;
  },
  // Texto da etapa do ficheiro antigo ("Ganho | Aprovada") → etapa nova do tipo dado. "Ganho/Aprovad…" vai
  // para a etapa ganha, "Perdid/Abandon/Rejeit…" para a perdida; as restantes escolhem a etapa em curso
  // com mais palavras parecidas (e, a desempatar, a probabilidade mais próxima).
  mapearEtapa(texto, prob, etapasDoTipo) {
    const norm = this._normCab(texto);
    const abertas = etapasDoTipo.filter(e => e.categoria === 'aberta');
    if (/\b(ganh|won|aprovad|adjudic)/.test(norm) && !/nao aprov|reprov/.test(norm)) { const g = etapasDoTipo.find(e => e.categoria === 'ganha'); if (g) return g; }
    if (/\b(perd|abandon|rejeit|lost|cancel|reprov|nao aprov)/.test(norm)) { const p = etapasDoTipo.find(e => e.categoria === 'perdida'); if (p) return p; }
    if (!abertas.length) return null;
    const palavras = norm.split(' ').filter(p => p.length >= 3);
    const parecidas = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && a.slice(0, 5) === b.slice(0, 5));
    const p = Number.isFinite(Number(prob)) && String(prob).trim() !== '' ? Number(prob) : null;
    let melhor = null, melhorScore = -Infinity;
    abertas.forEach(e => {
      const nomes = this._normCab(e.nome).split(' ').filter(x => x.length >= 3);
      const acertos = palavras.filter(w => nomes.some(n => parecidas(w, n))).length;
      const score = acertos * 10 - (p === null ? 0 : Math.abs(p - (Number(e.probabilidade) || 0)) / 10);
      if (score > melhorScore) { melhorScore = score; melhor = e; }
    });
    return melhor;
  },
  mapearTipo(texto, tipos) {
    const n = this._normCab(texto);
    if (!n) return null;
    const ativos = tipos.filter(t => t.ativo !== false);
    return ativos.find(t => this._normCab(t.nome) === n) || ativos.find(t => { const tn = this._normCab(t.nome); return tn.includes(n) || n.includes(tn); }) || null;
  },
  // "2026/0829" e "2026/829" são a mesma referência GIAF; "2026/0000" é um marcador sem obra.
  normalizarRefGiaf(s) {
    const m = String(s || '').trim().match(/^(\d{4})\s*[\/\-]\s*0*(\d+)$/);
    return m && Number(m[2]) > 0 ? `${m[1]}/${Number(m[2])}` : '';
  },
  // "2026/829-01" (referência da proposta) ou "2026/0829" -> "2026/829": a referência-base, sem o nº sequencial.
  baseRefProposta(s) {
    const m = String(s || '').trim().match(/^(\d{4})\s*\/\s*0*(\d+)(?:\s*-\s*\d+)?$/);
    return m && Number(m[2]) > 0 ? `${m[1]}/${Number(m[2])}` : '';
  },
  // A proposta herda a referência GIAF da oportunidade e acrescenta o nº sequencial (a versão da proposta):
  // 2026/829 + versão 1 -> "2026/829-01". Sem referência GIAF na oportunidade, devolve '' (preenche-se à mão).
  referenciaProposta(refGiaf, n) {
    const base = this.baseRefProposta(refGiaf);
    return base ? `${base}-${String(Math.max(1, Math.round(Number(n)) || 1)).padStart(2, '0')}` : '';
  },
  // Referência GIAF de uma oportunidade: a sua; senão a do projeto ligado (se for do tipo GIAF).
  refGiafDaOportunidade(op, projeto) {
    const r = this.baseRefProposta(op && op.referencia_giaf);
    if (r) return r;
    return projeto && projeto.tipoReferencia !== 'interno' ? this.baseRefProposta(projeto.idInterno) : '';
  },
  _eApagado(v) { return /^(1|true|sim|yes|s|y)$/i.test(String(v || '').trim()); },

  // Combinações distintas do ficheiro que o utilizador pode ajustar: tipos ("Serviços", "I&D") e pares
  // (tipo, etapa do ficheiro) — com a sugestão automática para cada uma.
  combinacoesOportunidades(matriz, mapa, tipos, etapas, formatoData) {
    const tiposTxt = new Map(), pares = new Map();
    matriz.slice(1).forEach(linha => {
      if (!linha.some(x => String(x).trim() !== '') || this._eApagado(this._cel(linha, mapa.apagado))) return;
      const tTxt = this._cel(linha, mapa.tipo), eTxt = this._cel(linha, mapa.etapa), prob = this._cel(linha, mapa.probabilidade);
      if (!tiposTxt.has(tTxt)) tiposTxt.set(tTxt, { texto: tTxt, n: 0, tipoId: (this.mapearTipo(tTxt, tipos) || {}).id || null });
      tiposTxt.get(tTxt).n++;
      const chave = tTxt + '|' + eTxt;
      if (!pares.has(chave)) pares.set(chave, { tipoTexto: tTxt, texto: eTxt, prob, n: 0 });
      pares.get(chave).n++;
    });
    return { tipos: [...tiposTxt.values()], etapas: [...pares.values()] };
  },
  // O que mudaria numa oportunidade que já existe. n = o que o ficheiro diz (valor/fecho/responsavelId/origem/
  // descricao/projetoId vazios ou null = "não diz nada" -> não toca). Devolve { patch, mudancas:[{k,de,para}], reabre }.
  compararOportunidadeExistente(ex, n, etapaPorId) {
    const patch = {}, mudancas = [];
    const alt = (k, para) => { mudancas.push({ k, de: ex[k], para }); patch[k] = para; };
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    if (n.tipoId && n.tipoId !== ex.tipo_id) alt('tipo_id', n.tipoId);
    if (n.etapa && n.etapa.id !== ex.etapa_id) alt('etapa_id', n.etapa.id);
    if (n.valor !== null && n.valor !== undefined && n.valor > 0 && Number(ex.valor_estimado) !== n.valor) alt('valor_estimado', n.valor);
    if (n.fecho && n.fecho !== ex.data_prevista_fecho) alt('data_prevista_fecho', n.fecho);
    if (n.responsavelId && n.responsavelId !== ex.responsavel_id) alt('responsavel_id', n.responsavelId);
    if (n.origem && n.origem !== (ex.origem || '')) alt('origem', n.origem);
    if (n.descricao && norm(n.descricao) !== norm(ex.descricao)) alt('descricao', n.descricao);
    if (n.projetoId && !ex.projeto_id) alt('projeto_id', n.projetoId);
    if (n.referenciaGiaf && n.referenciaGiaf !== (ex.referencia_giaf || '')) alt('referencia_giaf', n.referenciaGiaf);
    let reabre = false;
    if (patch.etapa_id) {
      // A etapa manda no estado de fecho: aberta -> sem data de fecho nem motivo; ganha/perdida -> data de fecho.
      const cat = n.etapa.categoria, antes = (etapaPorId.get(ex.etapa_id) || {}).categoria;
      patch.data_fecho = cat === 'aberta' ? null : (n.fecho || ex.data_fecho || null);
      patch.motivo_perda_id = cat === 'perdida' ? (ex.motivo_perda_id || n.motivoPadraoId || null) : null;
      if (cat !== 'perdida') patch.motivo_perda_notas = '';
      reabre = !!antes && antes !== 'aberta' && cat === 'aberta';
    }
    return { patch, mudancas, reabre };
  },
  // Pré-visualização da importação de OPORTUNIDADES. ctx: { contas, oportunidades, tipos, etapas,
  // recursos, projetos }; opts: { formatoData, criarContas, criarFollowups, mapaTipos {textoTipo→tipoId},
  // mapaEtapas {textoTipo|textoEtapa→etapaId}, motivoPadrao {tipoId→motivoId} }.
  prepararOportunidades(matriz, mapa, ctx, opts) {
    opts = opts || {};
    const r = { novas: [], atualizar: [], iguais: 0, followupsExistentes: [], contasACriar: [], duplicadas: [], semConta: [], invalidas: [], avisos: [], followups: 0, comProjeto: 0 };
    const contaPorNome = new Map(ctx.contas.map(c => [this.normalizarNome(c.nome), c]));
    const novasContas = new Map();
    const tipoPorId = new Map(ctx.tipos.map(t => [t.id, t])), etapaPorId = new Map(ctx.etapas.map(e => [e.id, e]));
    // Já existe? Mesma conta + mesmo título (sem maiúsculas/pontuação). "vistos" = chaves já tratadas neste ficheiro.
    const existentes = new Map(ctx.oportunidades.map(o => [`${o.conta_id}|${this.normalizarNome(o.titulo)}`, o]));
    const vistos = new Set();
    const tarefasAbertas = new Set((ctx.tarefas || []).filter(t => !t.concluida && t.oportunidade_id).map(t => `${t.oportunidade_id}|${this.normalizarNome(t.descricao)}`));
    const projetoPorRef = new Map();
    (ctx.projetos || []).forEach(p => { const k = this.normalizarRefGiaf(p.idInterno); if (k) projetoPorRef.set(k, p); });
    const formato = opts.formatoData || 'mdy';
    matriz.slice(1).forEach((linha, idx) => {
      if (!linha.some(x => String(x).trim() !== '') || this._eApagado(this._cel(linha, mapa.apagado))) return;
      const nl = idx + 2;
      const titulo = this._cel(linha, mapa.titulo);
      if (!titulo) { r.invalidas.push({ linha: nl, motivo: 'Sem título' }); return; }
      const tTxt = this._cel(linha, mapa.tipo), eTxt = this._cel(linha, mapa.etapa);
      const tipoId = (opts.mapaTipos && opts.mapaTipos[tTxt]) || (this.mapearTipo(tTxt, ctx.tipos) || {}).id;
      if (!tipoId) { r.invalidas.push({ linha: nl, motivo: `Tipo "${tTxt || '(vazio)'}" sem correspondência` }); return; }
      const etapasDoTipo = this.etapasDoTipo(ctx.etapas, tipoId, false);
      const etapaId = (opts.mapaEtapas && opts.mapaEtapas[tTxt + '|' + eTxt]) || (this.mapearEtapa(eTxt, this._cel(linha, mapa.probabilidade), etapasDoTipo.filter(e => e.ativo !== false)) || {}).id;
      const etapa = etapaPorId.get(etapaId);
      if (!etapa || etapa.tipo_id !== tipoId) { r.invalidas.push({ linha: nl, motivo: `Etapa "${eTxt || '(vazia)'}" sem correspondência` }); return; }
      const nomeConta = this._cel(linha, mapa.conta_nome);
      const chaveConta = this.normalizarNome(nomeConta);
      if (!chaveConta) { r.invalidas.push({ linha: nl, motivo: 'Sem conta' }); return; }
      let conta = contaPorNome.get(chaveConta) || null, contaRef = null;
      if (!conta) {
        if (!opts.criarContas) { r.semConta.push({ linha: nl, titulo, conta: nomeConta }); return; }
        if (!novasContas.has(chaveConta)) { const nova = { nome: nomeConta, nif: '' }; novasContas.set(chaveConta, nova); r.contasACriar.push(nova); }
        contaRef = novasContas.get(chaveConta);
      }
      const contaChave = conta ? conta.id : '@' + chaveConta;
      const chaveOp = `${contaChave}|${this.normalizarNome(titulo)}`;
      if (vistos.has(chaveOp)) { r.duplicadas.push({ linha: nl, titulo, noFicheiro: true }); return; }
      vistos.add(chaveOp);
      const existente = existentes.get(chaveOp);
      if (existente && !opts.atualizarExistentes) { r.duplicadas.push({ linha: nl, titulo }); return; }
      const valorBruto = this._cel(linha, mapa.valor);
      let valor = this.parseValor(valorBruto);
      const valorLido = valor;
      if (valor === null) { if (valorBruto) r.avisos.push({ linha: nl, motivo: `Valor "${valorBruto}" não percebido — ficou a 0` }); valor = 0; }
      const fechoBruto = this._cel(linha, mapa.fecho);
      const fecho = this.parseData(fechoBruto, formato);
      if (fechoBruto && !fecho) r.avisos.push({ linha: nl, motivo: `Data "${fechoBruto}" não percebida — ficou sem data` });
      const ref = this.normalizarRefGiaf(this._cel(linha, mapa.ref_giaf));
      const projeto = ref ? projetoPorRef.get(ref) : null;
      const descricao = this._cel(linha, mapa.descricao);
      const fechada = etapa.categoria !== 'aberta';
      const proximo = this._cel(linha, mapa.proximo_passo);
      const followup = opts.criarFollowups && proximo && !fechada ? proximo : '';
      if (existente) {
        // Atualiza só o que o ficheiro TRAZ e é diferente — um campo vazio no ficheiro nunca apaga o que já está na app.
        const cmp = this.compararOportunidadeExistente(existente, {
          tipoId, etapa, valor: valorLido, fecho, responsavelId: this.resolverResponsavel(this._cel(linha, mapa.responsavel), ctx.recursos || []),
          origem: this.traduzirOrigem(this._cel(linha, mapa.origem)), descricao: this._cel(linha, mapa.descricao),
          projetoId: projeto ? projeto.id : null, referenciaGiaf: ref, motivoPadraoId: (opts.motivoPadrao && opts.motivoPadrao[tipoId]) || null
        }, etapaPorId);
        const novoFollowup = followup && !tarefasAbertas.has(`${existente.id}|${this.normalizarNome(followup)}`) ? followup : '';
        if (novoFollowup) { r.followups++; r.followupsExistentes.push({ op: existente, descricao: novoFollowup }); }
        if (cmp.mudancas.length) r.atualizar.push({ linha: nl, titulo: existente.titulo, op: existente, patch: cmp.patch, mudancas: cmp.mudancas, reabre: cmp.reabre, followup: novoFollowup });
        else r.iguais++;
        return;
      }
      if (projeto) r.comProjeto++;
      if (followup) r.followups++;
      r.novas.push({
        conta_id: conta ? conta.id : null, conta_ref: contaRef, tipo_id: tipoId, etapa_id: etapaId, titulo, descricao, referencia_giaf: ref,
        valor_estimado: valor, data_prevista_fecho: fecho, responsavel_id: this.resolverResponsavel(this._cel(linha, mapa.responsavel), ctx.recursos || []),
        origem: this.traduzirOrigem(this._cel(linha, mapa.origem)),
        motivo_perda_id: etapa.categoria === 'perdida' ? ((opts.motivoPadrao && opts.motivoPadrao[tipoId]) || null) : null,
        data_fecho: fechada ? (fecho || null) : null, projeto_id: projeto ? projeto.id : null, followup
      });
    });
    return r;
  },
  // ============================ Fase 2: contas — projetos e duplicados ============================
  // Clientes (texto livre) dos projetos que ainda não têm conta no CRM, do mais frequente para o menos.
  // Variantes de grafia do mesmo cliente juntam-se; fica a grafia mais usada.
  clientesDosProjetos(projetos, contas) {
    const existentes = new Set(contas.map(c => this.normalizarNome(c.nome)));
    const g = new Map();
    projetos.forEach(p => {
      const bruto = String(p.cliente || '').trim();
      const chave = this.normalizarNome(bruto);
      if (!chave || existentes.has(chave)) return;
      if (!g.has(chave)) g.set(chave, { projetos: 0, grafias: new Map() });
      const x = g.get(chave);
      x.projetos++; x.grafias.set(bruto, (x.grafias.get(bruto) || 0) + 1);
    });
    return [...g.values()].map(x => ({ nome: [...x.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0], projetos: x.projetos }))
      .sort((a, b) => b.projetos - a.projetos || a.nome.localeCompare(b.nome, 'pt'));
  },
  // Grupos de contas que parecem a mesma (mesmo NIF, ou mesmo nome normalizado) — transitivo.
  gruposDuplicados(contas) {
    const pai = new Map(contas.map(c => [c.id, c.id]));
    const raiz = x => { while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
    const unir = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) pai.set(rb, ra); };
    const porChave = new Map();
    contas.forEach(c => {
      [this.soDigitos(c.nif) && 'nif:' + this.soDigitos(c.nif), this.normalizarNome(c.nome) && 'nome:' + this.normalizarNome(c.nome)].filter(Boolean).forEach(k => {
        if (porChave.has(k)) unir(porChave.get(k), c.id); else porChave.set(k, c.id);
      });
    });
    const grupos = new Map();
    contas.forEach(c => { const r = raiz(c.id); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(c); });
    return [...grupos.values()].filter(g => g.length > 1).map(g => g.sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || ''))))
      .sort((a, b) => a[0].nome.localeCompare(b[0].nome, 'pt'));
  },

  // ============================ Fase 3: cruzamento com projetos ============================
  // Oportunidades ganhas que ainda não têm projeto — o que falta passar à execução. Mais recentes primeiro.
  ganhasSemProjeto(ops, etapaPorId) {
    return ops.filter(o => this.categoriaDe(o, etapaPorId) === 'ganha' && !o.projeto_id)
      .sort((a, b) => String(b.data_fecho || '').localeCompare(String(a.data_fecho || '')));
  },
  // Projetos de uma conta: os ligados por oportunidade (projeto_id) e, a seguir, os que têm o mesmo cliente
  // (texto livre do projeto, comparado sem maiúsculas/pontuação/"Lda"). Sem repetidos; mais recentes primeiro.
  projetosDaConta(conta, ops, projetos) {
    const porId = new Map(projetos.map(p => [p.id, p]));
    const vistos = new Set();
    const lista = [];
    ops.filter(o => o.conta_id === conta.id && o.projeto_id && porId.has(o.projeto_id)).forEach(o => {
      if (vistos.has(o.projeto_id)) return;
      vistos.add(o.projeto_id);
      lista.push({ projeto: porId.get(o.projeto_id), origem: 'oportunidade', op: o });
    });
    const nome = this.normalizarNome(conta.nome);
    if (nome) {
      projetos.forEach(p => {
        if (vistos.has(p.id) || this.normalizarNome(p.cliente) !== nome) return;
        vistos.add(p.id);
        lista.push({ projeto: p, origem: 'cliente', op: null });
      });
    }
    return lista.sort((a, b) => String(b.projeto.dataInicio || '').localeCompare(String(a.projeto.dataInicio || '')));
  },
  // Projetos que se podem ligar a uma oportunidade ganha: nunca os que já estão ligados a OUTRA oportunidade.
  // Vêm primeiro os que "batem" (referência GIAF da proposta = ID do projeto, ou mesmo cliente da conta).
  sugerirProjetos(op, conta, propostas, ops, projetos) {
    const ocupados = new Set(ops.filter(o => o.id !== op.id && o.projeto_id).map(o => o.projeto_id));
    const refs = new Set(propostas.filter(p => p.oportunidade_id === op.id).map(p => this.baseRefProposta(p.referencia_giaf)).concat([this.baseRefProposta(op.referencia_giaf)]).filter(Boolean));
    const nomeConta = conta ? this.normalizarNome(conta.nome) : '';
    const sugeridos = [], outros = [];
    projetos.filter(p => !ocupados.has(p.id)).forEach(p => {
      const porRef = refs.size && refs.has(this.baseRefProposta(p.idInterno));
      const porCliente = nomeConta && this.normalizarNome(p.cliente) === nomeConta;
      if (porRef) sugeridos.push({ projeto: p, motivo: 'mesma referência GIAF' });
      else if (porCliente) sugeridos.push({ projeto: p, motivo: 'mesmo cliente' });
      else outros.push({ projeto: p, motivo: '' });
    });
    return { sugeridos, outros };
  },
  // Soma de projetos já resumidos ({ visivel, valorVendido, horasVendidas, horasReais, faturado }). Os que a
  // pessoa não tem permissão para ver em detalhe contam só como projetos (n), nunca nos totais.
  totaisProjetos(resumos) {
    const t = { n: resumos.length, nVisiveis: 0, valorVendido: 0, horasVendidas: 0, horasReais: 0, faturado: 0 };
    resumos.forEach(r => {
      if (!r.visivel) return;
      t.nVisiveis++;
      t.valorVendido += Number(r.valorVendido) || 0; t.horasVendidas += Number(r.horasVendidas) || 0;
      t.horasReais += Number(r.horasReais) || 0; t.faturado += Number(r.faturado) || 0;
    });
    return t;
  },

  // ---------- Formatação ----------
  euro(v) { return (Number(v) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); },
  data(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'; }
};
if (typeof module !== 'undefined') module.exports = CrmLogica;

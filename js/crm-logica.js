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
    { k: 'dimensao', rotulo: 'Dimensão', aliases: ['dimensao', 'size', 'tamanho', 'dimensao empresa'] },
    { k: 'morada', rotulo: 'Morada', aliases: ['morada', 'endereco', 'address', 'localidade', 'cidade', 'city'] },
    { k: 'website', rotulo: 'Website', aliases: ['website', 'site', 'web', 'url', 'pagina web'] },
    { k: 'estado', rotulo: 'Estado', aliases: ['estado', 'status', 'tipo conta', 'tipo de cliente', 'fase'] },
    { k: 'notas', rotulo: 'Notas', aliases: ['notas', 'observacoes', 'notes', 'comentarios', 'descricao'] }
  ],
  CAMPOS_CONTACTO: [
    { k: 'nome', rotulo: 'Nome do contacto', obrig: true, aliases: ['nome', 'name', 'contacto', 'contact', 'nome completo', 'full name', 'pessoa'] },
    { k: 'conta_nome', rotulo: 'Conta (nome)', aliases: ['empresa', 'conta', 'cliente', 'organizacao', 'organization', 'company', 'account', 'account name', 'entidade'] },
    { k: 'conta_nif', rotulo: 'Conta (NIF)', aliases: ['nif', 'nipc', 'nif empresa', 'vat', 'contribuinte'] },
    { k: 'cargo', rotulo: 'Cargo', aliases: ['cargo', 'funcao', 'title', 'job title', 'position', 'posicao'] },
    { k: 'email', rotulo: 'Email', aliases: ['email', 'e mail', 'mail', 'correio eletronico'] },
    { k: 'telefone', rotulo: 'Telefone', aliases: ['telefone', 'telemovel', 'phone', 'mobile', 'tel', 'contacto telefonico'] },
    { k: 'papel_decisao', rotulo: 'Papel na decisão', aliases: ['papel', 'papel decisao', 'papel na decisao', 'decisor', 'role'] },
    { k: 'notas', rotulo: 'Notas', aliases: ['notas', 'observacoes', 'notes', 'comentarios'] }
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
  _cel(linha, i) { return i >= 0 && linha[i] != null ? String(linha[i]).trim() : ''; },
  normalizarEstadoConta(v, padrao) {
    const n = this._normCab(v);
    if (/^(ativo|ativa|active|cliente|customer)$/.test(n)) return 'ativo';
    if (/^(inativo|inativa|inactive|perdido|antigo)$/.test(n)) return 'inativo';
    if (/^(prospeto|prospecto|prospect|lead|potencial)$/.test(n)) return 'prospeto';
    return padrao || 'prospeto';
  },
  normalizarDimensao(v) {
    const n = this._normCab(v);
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
    const r = { novas: [], duplicadas: [], invalidas: [] };
    const aceites = existentes.slice();
    matriz.slice(1).forEach((linha, idx) => {
      if (!linha.some(x => String(x).trim() !== '')) return;
      const nl = idx + 2;
      const nome = this._cel(linha, mapa.nome);
      if (!nome) { r.invalidas.push({ linha: nl, motivo: 'Sem nome' }); return; }
      const nif = this._cel(linha, mapa.nif);
      const dup = this.duplicadoConta(aceites, { nome, nif });
      if (dup) { r.duplicadas.push({ linha: nl, nome, com: dup.nome, noFicheiro: !existentes.includes(dup) }); return; }
      const conta = {
        nome, nif, setor: this._cel(linha, mapa.setor), dimensao: this.normalizarDimensao(this._cel(linha, mapa.dimensao)),
        morada: this._cel(linha, mapa.morada), website: this._cel(linha, mapa.website),
        estado: this.normalizarEstadoConta(this._cel(linha, mapa.estado), opts.estadoPadrao), notas: this._cel(linha, mapa.notas)
      };
      aceites.push(conta);
      r.novas.push(conta);
    });
    return r;
  },
  // Idem para CONTACTOS: cada um liga-se a uma conta pelo NIF, ou senão pelo nome (normalizado). Sem
  // conta correspondente, ou se cria a conta (opts.criarContas) ou o contacto fica de fora.
  prepararContactos(matriz, mapa, contas, contactosExistentes, opts) {
    opts = opts || {};
    const r = { novos: [], contasACriar: [], duplicados: [], semConta: [], invalidos: [], avisos: [] };
    const contaPorNif = new Map(), contaPorNome = new Map();
    contas.forEach(c => {
      if (this.soDigitos(c.nif)) contaPorNif.set(this.soDigitos(c.nif), c);
      contaPorNome.set(this.normalizarNome(c.nome), c);
    });
    const novasPorChave = new Map();
    const vistos = new Set(contactosExistentes.map(c => `${c.conta_id}|${this.normalizarNome(c.nome)}`));
    const emails = new Set(contactosExistentes.filter(c => c.email).map(c => `${c.conta_id}|${String(c.email).toLowerCase()}`));
    matriz.slice(1).forEach((linha, idx) => {
      if (!linha.some(x => String(x).trim() !== '')) return;
      const nl = idx + 2;
      const nome = this._cel(linha, mapa.nome);
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
      if (vistos.has(chaveNome) || (email && emails.has(`${contaChave}|${email.toLowerCase()}`))) { r.duplicados.push({ linha: nl, nome }); return; }
      vistos.add(chaveNome); if (email) emails.add(`${contaChave}|${email.toLowerCase()}`);
      r.novos.push({
        conta_id: conta ? conta.id : null, conta_ref: contaRef, nome, cargo: this._cel(linha, mapa.cargo), email,
        telefone: this._cel(linha, mapa.telefone), papel_decisao: this.normalizarPapelDecisao(this._cel(linha, mapa.papel_decisao)), notas: this._cel(linha, mapa.notas)
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

  // ---------- Formatação ----------
  euro(v) { return (Number(v) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); },
  data(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'; }
};
if (typeof module !== 'undefined') module.exports = CrmLogica;

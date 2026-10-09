// Módulo CRM ("Comercial"): contas, contactos, oportunidades, propostas, interações e follow-ups.
// Ao contrário do resto da app (estado inteiro em App.state, sincronizado por diferenças e com
// Ctrl+Z), os dados do CRM têm acesso restrito (RLS no Supabase — ver supabase/schema.sql) e podem
// ser muitos, por isso este módulo fala DIRETAMENTE com as tabelas "crm_*", só quando alguém abre o
// Comercial, e cada ação grava logo (sem desfazer). As regras puras estão em crm-logica.js.
//
// Em memória guardamos as linhas tal como vêm da base de dados (snake_case) — sem camada de tradução.
const Crm = {
  TABELAS: {
    tipos: 'crm_tipos_oportunidade', etapas: 'crm_etapas', motivos: 'crm_motivos_perda',
    contas: 'crm_contas', contactos: 'crm_contactos', oportunidades: 'crm_oportunidades',
    propostas: 'crm_propostas', interacoes: 'crm_interacoes', tarefas: 'crm_tarefas'
  },
  // Tabelas com coluna "atualizado_em" (a app preenche-a em cada gravação).
  COM_ATUALIZADO_EM: ['contas', 'contactos', 'oportunidades', 'propostas'],
  d: { tipos: [], etapas: [], motivos: [], contas: [], contactos: [], oportunidades: [], propostas: [], interacoes: [], tarefas: [] },
  idx: {},
  carregado: false,
  followupsAtrasados: 0,
  filtros: {
    op: { tipoId: '', vista: 'quadro', resp: 'todos', estado: 'abertas', texto: '' },
    contas: { texto: '', estado: '', resp: '' },
    contactos: { texto: '' },
    propostas: { texto: '', estado: '' },
    tarefas: { quem: 'minhas', estado: 'pendentes' },
    dash: { tipoId: '', periodo: 'ano', resp: 'todos' }
  },
  ABAS: {
    crmDashboard: 'crmDashboardCorpo', crmOportunidades: 'crmOportunidadesCorpo', crmContas: 'crmContasCorpo', crmContactos: 'crmContactosCorpo',
    crmPropostas: 'crmPropostasCorpo', crmFollowups: 'crmFollowupsCorpo', crmFunil: 'crmFunilCorpo'
  },
  ORIGENS: ['Cliente existente', 'Recomendação', 'Evento / feira', 'Prospeção ativa', 'Candidatura / aviso', 'Parceiro', 'Outro'],
  TIPOS_INTERACAO: { chamada: '📞 Chamada', reuniao: '🤝 Reunião', email: '✉️ Email', visita: '🏢 Visita', outro: '📝 Outro' },
  ESTADOS_PROPOSTA: { rascunho: 'Rascunho', enviada: 'Enviada', aceite: 'Aceite', rejeitada: 'Rejeitada', expirada: 'Expirada' },
  ESTADOS_CONTA: { prospeto: 'Prospeto', ativo: 'Ativo', inativo: 'Inativo' },
  PAPEIS_DECISAO: { '': '—', decisor: 'Decisor', influenciador: 'Influenciador', tecnico: 'Técnico' },

  // ============================ Permissões ============================
  // Mesmo critério das regras no Supabase (crm_tem_acesso): Administrador, Diretor ou Team Leader.
  podeVer() {
    return App.souAdmin() || App.souDiretorDeAlgumDepartamento() || App.souLiderDeAlgumaEquipa();
  },
  souAdmin() { return App.souAdmin(); },
  meuRecursoId() { return (App.perfilAtual() || {}).recursoId || null; },

  // ============================ Dados ============================
  // Ao terminar a sessão: nada do CRM fica em memória para a pessoa seguinte neste browser.
  limpar() {
    Object.keys(this.d).forEach(k => { this.d[k] = []; });
    this.idx = {};
    this.carregado = false;
    this.erroCarga = null;
    this.followupsAtrasados = 0;
  },
  // Os pedidos do Supabase devolvem no máximo 1000 linhas — lê-se por páginas até acabar.
  async _lerTudo(tabela) {
    const PAGINA = 1000;
    const linhas = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabaseClient.from(tabela).select('*').order('id').range(de, de + PAGINA - 1);
      if (error) throw error;
      linhas.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }
    return linhas;
  },
  async carregar(forcar) {
    if (this.carregado && !forcar) return;
    if (this._aCarregar) { await this._aCarregar; return; }
    this._aCarregar = (async () => {
      const chaves = Object.keys(this.TABELAS);
      const resultados = await Promise.all(chaves.map(k => this._lerTudo(this.TABELAS[k])));
      chaves.forEach((k, i) => { this.d[k] = resultados[i]; });
      this.carregado = true;
      this.reindexar();
      this.recalcularFollowups();
    })();
    try { await this._aCarregar; this.erroCarga = null; }
    catch (err) { this.erroCarga = this.msgErro(err); throw err; }
    finally { this._aCarregar = null; }
  },
  reindexar() {
    const L = CrmLogica;
    this.idx = {
      tipo: L.indexarPorId(this.d.tipos), etapa: L.indexarPorId(this.d.etapas), motivo: L.indexarPorId(this.d.motivos),
      conta: L.indexarPorId(this.d.contas), contacto: L.indexarPorId(this.d.contactos), op: L.indexarPorId(this.d.oportunidades),
      proposta: L.indexarPorId(this.d.propostas)
    };
  },
  async gravar(chave, obj) {
    const linha = Object.assign({}, obj);
    if (!linha.id) linha.id = crypto.randomUUID();
    if (this.COM_ATUALIZADO_EM.includes(chave)) linha.atualizado_em = new Date().toISOString();
    const { data, error } = await supabaseClient.from(this.TABELAS[chave]).upsert(linha).select().single();
    if (error) throw error;
    const lista = this.d[chave];
    const i = lista.findIndex(x => x.id === data.id);
    if (i >= 0) lista[i] = data; else lista.push(data);
    this.reindexar();
    if (chave === 'tarefas') this.recalcularFollowups();
    return data;
  },
  async apagar(chave, id) {
    const { error } = await supabaseClient.from(this.TABELAS[chave]).delete().eq('id', id);
    if (error) throw error;
    // Apagar uma conta/oportunidade/contacto mexe noutras linhas na base de dados (cascade/set null)
    // — recarrega tudo para a memória não ficar desatualizada; as restantes saem só da memória.
    if (['contas', 'oportunidades', 'contactos'].includes(chave)) { await this.carregar(true); return; }
    this.d[chave] = this.d[chave].filter(x => x.id !== id);
    this.reindexar();
    if (chave === 'tarefas') this.recalcularFollowups();
  },
  // Número de follow-ups meus em atraso (alimenta o sino). Quando o módulo ainda não foi aberto, faz
  // só uma contagem leve — sem carregar as tabelas todas.
  recalcularFollowups() {
    this.followupsAtrasados = CrmLogica.contarAtrasadas(this.d.tarefas, DateUtil.todayISO(), this.meuRecursoId());
    if (typeof App.renderNotificacoes === 'function' && App.els) App.renderNotificacoes();
  },
  async atualizarContagemFollowups() {
    if (!this.podeVer() || this.carregado) return;
    const meu = this.meuRecursoId();
    if (!meu) return;
    try {
      const { count, error } = await supabaseClient.from(this.TABELAS.tarefas)
        .select('id', { count: 'exact', head: true })
        .eq('concluida', false).eq('responsavel_id', meu).lt('data_limite', DateUtil.todayISO());
      if (error) throw error;
      this.followupsAtrasados = count || 0;
      App.renderNotificacoes();
    } catch (err) {
      // Sem as tabelas (SQL ainda por correr) ou sem acesso: o sino simplesmente não conta o CRM.
      this.followupsAtrasados = 0;
    }
  },
  msgErro(err) {
    const msg = String((err && err.message) || err || '');
    const cod = err && err.code;
    if (cod === '42P01' || /does not exist|Could not find the table|schema cache/i.test(msg)) return 'O módulo CRM ainda não está instalado na base de dados (falta correr supabase/crm_fase1.sql no Supabase).';
    if (cod === '23503') return 'Não é possível: existem registos associados (ex.: oportunidades). Remove-os ou desativa em vez de apagar.';
    if (cod === '42501' || /row-level security|permission denied/i.test(msg)) return 'Sem permissão para esta ação.';
    return msg || 'Erro desconhecido.';
  },
  avisoErro(err) {
    console.error(err);
    App.toast(this.msgErro(err));
  },

  // ============================ Auxiliares de UI ============================
  recursoNome(id) { const r = App.state.recursos.find(x => x.id === id); return r ? r.nome : '—'; },
  _primeiroNome(id) { return this.recursoNome(id).split(' ')[0]; },
  // Responsáveis possíveis: pessoas com conta na app.
  responsaveis() {
    return App.state.utilizadores.filter(u => u.recursoId).map(u => ({ id: u.recursoId, nome: u.nome || u.email }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  },
  opcoes(lista, valor, rotulo, vazio) {
    return (vazio !== undefined ? `<option value="">${escapeHtml(vazio)}</option>` : '') +
      lista.map(x => `<option value="${escapeAttr(x.id)}"${x.id === valor ? ' selected' : ''}>${escapeHtml(rotulo(x))}</option>`).join('');
  },
  optResponsaveis(valor, vazio) { return this.opcoes(this.responsaveis(), valor, r => r.nome, vazio); },
  contasOrdenadas() { return this.d.contas.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt')); },
  tiposAtivos() { return this.d.tipos.filter(t => t.ativo !== false).sort(CrmLogica._porOrdem); },
  euro(v) { return CrmLogica.euro(v); },
  data(iso) { return CrmLogica.data(iso); },
  hoje() { return DateUtil.todayISO(); },
  abrir(titulo, html, largo) { App.abrirModal(titulo, html, { largo: !!largo }); },
  corpo() { return App.els.modalCorpo; },
  vazioHtml(msg) { return `<p class="hint" style="padding:12px 0;">${escapeHtml(msg)}</p>`; },
  // Texto de pesquisa: tira acentos/maiúsculas para "textil" encontrar "Têxtil".
  _n(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
  contem(texto, ...campos) {
    const t = this._n(texto).trim();
    return !t || campos.some(c => this._n(c).includes(t));
  },
  caminhoHtml(caminho) {
    const c = CrmLogica.tipoCaminho(caminho);
    if (c.tipo === 'vazio') return '<span class="hint">—</span>';
    if (c.tipo === 'url') return `<a href="${escapeAttr(c.href)}" target="_blank" rel="noopener noreferrer">Abrir documento ↗</a>`;
    return `<span class="crm-caminho" title="${escapeAttr(c.texto)}">${escapeHtml(c.texto)}</span> <button type="button" class="btn btn-sm" data-crm-acao="copiar" data-texto="${escapeAttr(c.texto)}">Copiar</button>`;
  },
  async copiar(texto) {
    try { await navigator.clipboard.writeText(texto); App.toast('Caminho copiado.'); }
    catch (e) { window.prompt('Copia o caminho:', texto); }
  },

  // ============================ Navegação / arranque de cada separador ============================
  // Chamado por App.irParaAba para qualquer separador do CRM.
  async aoAbrirAba(aba) {
    const el = document.getElementById(this.ABAS[aba]);
    if (!el) return;
    this.ligarEventos(el, aba);
    if (!this.carregado) {
      el.innerHTML = this.vazioHtml('A carregar o CRM…');
      App.mostrarCarregamento('A carregar o CRM…');
      try { await this.carregar(); }
      catch (err) {
        console.error(err);
        el.innerHTML = `<p class="hint" style="color:var(--vermelho);padding:12px 0;">${escapeHtml(this.msgErro(err))}</p>`;
        return;
      } finally { App.esconderCarregamento(); }
    }
    this.render(aba);
  },
  render(aba) {
    const el = document.getElementById(this.ABAS[aba]);
    if (!el || !this.carregado) return;
    ({
      crmDashboard: () => this.renderDashboard(el),
      crmOportunidades: () => this.renderOportunidades(el),
      crmContas: () => this.renderContas(el),
      crmContactos: () => this.renderContactos(el),
      crmPropostas: () => this.renderPropostas(el),
      crmFollowups: () => this.renderFollowups(el),
      crmFunil: () => this.renderFunil(el)
    })[aba]();
  },
  renderAtual() {
    if (this.ABAS[App.abaAtiva]) this.render(App.abaAtiva);
  },
  // Um único conjunto de listeners delegados por contentor (ligado uma vez).
  ligarEventos(el, aba) {
    if (el._crmLigado) return;
    el._crmLigado = true;
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-crm-acao]');
      if (b) this.acao(b.dataset.crmAcao, b, ev);
    });
    const filtro = ev => {
      const c = ev.target.closest('[data-crm-filtro]');
      if (!c) return;
      const [grupo, chave] = c.dataset.crmFiltro.split('.');
      this.filtros[grupo][chave] = c.value;
      // Escrever no campo de texto re-desenha a lista, mas sem perder o foco/cursor.
      const posicao = c.selectionStart;
      this.render(aba);
      if (c.tagName === 'INPUT') {
        const novo = el.querySelector(`[data-crm-filtro="${c.dataset.crmFiltro}"]`);
        if (novo) { novo.focus(); try { novo.setSelectionRange(posicao, posicao); } catch (e) { /* tipo sem seleção */ } }
      }
    };
    el.addEventListener('change', ev => { if (ev.target.tagName !== 'INPUT' || ev.target.type !== 'text') filtro(ev); });
    el.addEventListener('input', ev => { if (ev.target.tagName === 'INPUT' && ev.target.type === 'text') filtro(ev); });
    // Arrastar cartões do quadro de oportunidades entre etapas.
    el.addEventListener('dragstart', ev => {
      const card = ev.target.closest('[data-op-id]');
      if (!card) return;
      ev.dataTransfer.setData('text/plain', card.dataset.opId);
      ev.dataTransfer.effectAllowed = 'move';
      card.classList.add('crm-card-a-arrastar');
    });
    el.addEventListener('dragend', ev => {
      const card = ev.target.closest('[data-op-id]');
      if (card) card.classList.remove('crm-card-a-arrastar');
      el.querySelectorAll('.crm-coluna-alvo').forEach(c => c.classList.remove('crm-coluna-alvo'));
    });
    el.addEventListener('dragover', ev => {
      const col = ev.target.closest('[data-etapa-id]');
      if (!col) return;
      ev.preventDefault();
      el.querySelectorAll('.crm-coluna-alvo').forEach(c => { if (c !== col) c.classList.remove('crm-coluna-alvo'); });
      col.classList.add('crm-coluna-alvo');
    });
    el.addEventListener('drop', ev => {
      const col = ev.target.closest('[data-etapa-id]');
      if (!col) return;
      ev.preventDefault();
      col.classList.remove('crm-coluna-alvo');
      const opId = ev.dataTransfer.getData('text/plain');
      if (opId) this.moverEtapa(opId, col.dataset.etapaId);
    });
  },
  // Despacho de todos os botões [data-crm-acao] dos painéis.
  acao(nome, el) {
    const id = el.dataset.id;
    const mapa = {
      'nova-op': () => this.abrirOportunidade(null, el.dataset.conta || null),
      'abrir-op': () => this.abrirOportunidade(id),
      'nova-conta': () => this.abrirConta(null),
      'abrir-conta': () => this.abrirConta(id),
      'novo-contacto': () => this.abrirContacto(null, el.dataset.conta || null),
      'abrir-contacto': () => this.abrirContacto(id),
      'nova-proposta': () => this.abrirProposta(null, el.dataset.op || null),
      'abrir-proposta': () => this.abrirProposta(id),
      'nova-tarefa': () => this.abrirTarefa(null, { conta: el.dataset.conta, op: el.dataset.op }),
      'abrir-tarefa': () => this.abrirTarefa(id),
      'concluir-tarefa': () => this.alternarTarefa(id),
      'copiar': () => this.copiar(el.dataset.texto),
      'vista': () => { this.filtros.op.vista = el.dataset.valor; this.renderAtual(); },
      'ir-conta': () => { App.fecharModal(); this.abrirConta(id); },
      'importar-contas': () => this.abrirImportacao('contas'),
      'importar-contactos': () => this.abrirImportacao('contactos'),
      'importar-oportunidades': () => this.abrirImportacao('oportunidades'),
      'contas-projetos': () => this.abrirContasDosProjetos(),
      'duplicados': () => this.abrirDuplicados()
    };
    const f = mapa[nome] || (() => this.acaoFunil(nome, el));
    f();
  },

  // ============================ Oportunidades ============================
  opsFiltradas(ignorarEstado) {
    const f = this.filtros.op;
    const meu = this.meuRecursoId();
    return this.d.oportunidades.filter(op => {
      if (f.tipoId && op.tipo_id !== f.tipoId) return false;
      if (f.resp === 'meus' && op.responsavel_id !== meu) return false;
      if (!ignorarEstado && f.vista === 'lista' && f.estado !== 'todas') {
        const cat = CrmLogica.categoriaDe(op, this.idx.etapa);
        if (f.estado === 'abertas' && cat !== 'aberta') return false;
        if (f.estado === 'ganhas' && cat !== 'ganha') return false;
        if (f.estado === 'perdidas' && cat !== 'perdida') return false;
      }
      const conta = this.idx.conta.get(op.conta_id);
      return this.contem(f.texto, op.titulo, conta && conta.nome);
    });
  },
  renderOportunidades(el) {
    const f = this.filtros.op;
    const tipos = this.tiposAtivos();
    if (!tipos.length) { el.innerHTML = this.vazioHtml('Ainda não há tipos de oportunidade. O Administrador define-os em Configurações → Funil CRM.'); return; }
    // O quadro precisa de UM tipo (cada tipo tem as suas etapas); na lista pode ver-se tudo.
    if (f.vista === 'quadro' && !this.idx.tipo.get(f.tipoId)) f.tipoId = tipos[0].id;
    const baseKpi = this.opsFiltradas(true);
    const r = CrmLogica.resumoFunil(baseKpi, this.idx.etapa);
    const conv = CrmLogica.taxaConversao(baseKpi, this.idx.etapa);
    const kpis = `<div class="crm-kpis">
      <div class="crm-kpi"><b>${r.abertas.n}</b><span>em curso</span></div>
      <div class="crm-kpi"><b>${this.euro(r.abertas.valor)}</b><span>valor em curso</span></div>
      <div class="crm-kpi"><b>${this.euro(r.abertas.ponderado)}</b><span>valor ponderado</span></div>
      <div class="crm-kpi"><b>${r.ganhas.n}</b><span>ganhas · ${this.euro(r.ganhas.valor)}</span></div>
      <div class="crm-kpi"><b>${r.perdidas.n}</b><span>perdidas</span></div>
      <div class="crm-kpi"><b>${conv === null ? '—' : Math.round(conv * 100) + '%'}</b><span>conversão</span></div>
    </div>`;
    const tipoSel = `<label class="zoom-label">Tipo <select data-crm-filtro="op.tipoId">${f.vista === 'lista' ? '<option value="">Todos</option>' : ''}${this.opcoes(tipos, f.tipoId, t => t.nome)}</select></label>`;
    const estadoSel = f.vista === 'lista'
      ? `<label class="zoom-label">Estado <select data-crm-filtro="op.estado">${['abertas', 'ganhas', 'perdidas', 'todas'].map(v => `<option value="${v}"${f.estado === v ? ' selected' : ''}>${{ abertas: 'Em curso', ganhas: 'Ganhas', perdidas: 'Perdidas', todas: 'Todas' }[v]}</option>`).join('')}</select></label>` : '';
    const barra = `<div class="filters crm-barra">
      ${tipoSel}
      <label class="zoom-label">Responsável <select data-crm-filtro="op.resp"><option value="todos"${f.resp === 'todos' ? ' selected' : ''}>Todos</option><option value="meus"${f.resp === 'meus' ? ' selected' : ''}>As minhas</option></select></label>
      ${estadoSel}
      <label class="zoom-label">Pesquisar <input type="text" data-crm-filtro="op.texto" value="${escapeAttr(f.texto)}" placeholder="Título ou conta…"></label>
      <span class="crm-barra-fim">
        <button type="button" class="chip-projeto${f.vista === 'quadro' ? ' ativo' : ''}" data-crm-acao="vista" data-valor="quadro">▦ Quadro</button>
        <button type="button" class="chip-projeto${f.vista === 'lista' ? ' ativo' : ''}" data-crm-acao="vista" data-valor="lista">☰ Lista</button>
        <button type="button" class="btn" data-crm-acao="importar-oportunidades">⬆ Importar</button>
        <button type="button" class="btn btn-primary" data-crm-acao="nova-op">+ Nova oportunidade</button>
      </span>
    </div>`;
    el.innerHTML = kpis + barra + (f.vista === 'quadro' ? this.htmlQuadro() : this.htmlListaOps());
  },
  htmlCardOp(op) {
    const conta = this.idx.conta.get(op.conta_id);
    const cat = CrmLogica.categoriaDe(op, this.idx.etapa);
    const atrasada = cat === 'aberta' && op.data_prevista_fecho && op.data_prevista_fecho < this.hoje();
    const nProp = this.d.propostas.filter(p => p.oportunidade_id === op.id).length;
    return `<div class="crm-card" draggable="true" data-op-id="${escapeAttr(op.id)}" data-crm-acao="abrir-op" data-id="${escapeAttr(op.id)}">
      <div class="crm-card-titulo">${escapeHtml(op.titulo)}</div>
      <div class="crm-card-conta">${escapeHtml(conta ? conta.nome : '—')}</div>
      <div class="crm-card-linha"><b>${this.euro(op.valor_estimado)}</b>${nProp ? `<span class="crm-badge" title="Propostas registadas">📄 ${nProp}</span>` : ''}</div>
      <div class="crm-card-linha crm-card-sub">
        <span class="${atrasada ? 'crm-atrasada' : ''}" title="Data prevista de fecho">${op.data_prevista_fecho ? '📅 ' + this.data(op.data_prevista_fecho) : 'sem data'}</span>
        <span>${escapeHtml(this._primeiroNome(op.responsavel_id))}</span>
      </div>
    </div>`;
  },
  htmlQuadro() {
    const f = this.filtros.op;
    const etapas = CrmLogica.etapasDoTipo(this.d.etapas, f.tipoId);
    if (!etapas.length) return this.vazioHtml('Este tipo ainda não tem etapas. O Administrador define-as em Configurações → Funil CRM.');
    const grupos = CrmLogica.agruparPorEtapa(this.opsFiltradas(true), etapas);
    return `<div class="crm-quadro">${etapas.map(e => {
      const ops = (grupos.get(e.id) || []).slice().sort((a, b) => String(a.data_prevista_fecho || '9999').localeCompare(String(b.data_prevista_fecho || '9999')));
      const total = ops.reduce((s, o) => s + (Number(o.valor_estimado) || 0), 0);
      return `<div class="crm-coluna crm-cat-${e.categoria}" data-etapa-id="${escapeAttr(e.id)}">
        <div class="crm-coluna-head"><b>${escapeHtml(e.nome)}</b><span>${ops.length} · ${this.euro(total)}</span><small>${e.categoria === 'aberta' ? Math.round(e.probabilidade) + '%' : (e.categoria === 'ganha' ? 'ganha' : 'perdida')}</small></div>
        <div class="crm-coluna-corpo">${ops.map(o => this.htmlCardOp(o)).join('') || '<div class="crm-coluna-vazia">Largar aqui</div>'}</div>
      </div>`;
    }).join('')}</div>`;
  },
  htmlListaOps() {
    const ops = this.opsFiltradas().sort((a, b) => String(a.data_prevista_fecho || '9999').localeCompare(String(b.data_prevista_fecho || '9999')));
    if (!ops.length) return this.vazioHtml('Nenhuma oportunidade com estes filtros.');
    return `<div class="table-scroll"><table class="tabela-crud"><thead><tr>
      <th>Título</th><th>Conta</th><th>Tipo</th><th>Etapa</th><th>Valor</th><th>Prob.</th><th>Ponderado</th><th>Fecho previsto</th><th>Responsável</th></tr></thead><tbody>
      ${ops.map(op => {
        const conta = this.idx.conta.get(op.conta_id), etapa = this.idx.etapa.get(op.etapa_id), tipo = this.idx.tipo.get(op.tipo_id);
        return `<tr class="crm-linha" data-crm-acao="abrir-op" data-id="${escapeAttr(op.id)}">
          <td><b>${escapeHtml(op.titulo)}</b></td><td>${escapeHtml(conta ? conta.nome : '—')}</td><td>${escapeHtml(tipo ? tipo.nome : '—')}</td>
          <td>${escapeHtml(etapa ? etapa.nome : '—')}</td><td>${this.euro(op.valor_estimado)}</td>
          <td>${Math.round(CrmLogica.probabilidadeDe(op, this.idx.etapa))}%</td><td>${this.euro(CrmLogica.valorPonderado(op, this.idx.etapa))}</td>
          <td>${this.data(op.data_prevista_fecho)}</td><td>${escapeHtml(this.recursoNome(op.responsavel_id))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  },

  // ---------- Mudança de etapa (quadro e formulário) ----------
  async moverEtapa(opId, etapaId) {
    const op = this.idx.op.get(opId), etapa = this.idx.etapa.get(etapaId);
    if (!op || !etapa || op.etapa_id === etapaId) return;
    if (etapa.tipo_id !== op.tipo_id) { App.toast('Esta etapa pertence a outro tipo de oportunidade.'); return; }
    if (etapa.categoria === 'perdida') { this.abrirModalPerda(op, etapa); return; }
    if (etapa.categoria === 'ganha') { this.abrirModalGanha(op, etapa); return; }
    try {
      await this.gravar('oportunidades', Object.assign({}, op, { etapa_id: etapaId, data_fecho: null, motivo_perda_id: null, motivo_perda_notas: '' }));
      this.renderAtual();
    } catch (err) { this.avisoErro(err); this.renderAtual(); }
  },
  abrirModalPerda(op, etapa) {
    const motivos = CrmLogica.motivosDoTipo(this.d.motivos, op.tipo_id);
    this.abrir(`Perdida — ${op.titulo}`, `
      <p class="hint" style="margin:0 0 10px;">A oportunidade passa para "${escapeHtml(etapa.nome)}". O motivo é obrigatório (alimenta a análise de perdas).</p>
      <label>Motivo da perda <span style="color:var(--vermelho);">*</span>
        <select id="crmPerdaMotivo">${this.opcoes(motivos, '', m => m.nome, 'Seleciona…')}</select></label>
      <label>Notas <textarea id="crmPerdaNotas" rows="3" placeholder="O que aconteceu? (opcional)"></textarea></label>
      <span id="crmPerdaMsg" class="calc-line" style="border:none;display:block;margin-top:6px;color:var(--vermelho);"></span>
      <button class="btn btn-primary" id="crmPerdaOk" style="margin-top:10px;">Marcar como perdida</button>`);
    const m = this.corpo();
    m.querySelector('#crmPerdaOk').addEventListener('click', async () => {
      const motivoId = m.querySelector('#crmPerdaMotivo').value;
      const v = CrmLogica.validarMudancaEtapa(op, etapa, motivoId, motivos.map(x => x.id));
      if (!v.ok) { m.querySelector('#crmPerdaMsg').textContent = v.erro; return; }
      try {
        await this.gravar('oportunidades', Object.assign({}, op, { etapa_id: etapa.id, motivo_perda_id: motivoId, motivo_perda_notas: m.querySelector('#crmPerdaNotas').value.trim(), data_fecho: this.hoje() }));
        App.fecharModal(); this.renderAtual();
      } catch (err) { this.avisoErro(err); }
    });
  },
  abrirModalGanha(op, etapa) {
    const vigente = CrmLogica.propostaVigente(this.d.propostas, op.id);
    const valor = vigente && vigente.valor ? vigente.valor : op.valor_estimado;
    const podeProjeto = this.souAdmin() && !op.projeto_id;
    this.abrir(`Ganha — ${op.titulo}`, `
      <p class="hint" style="margin:0 0 10px;">A oportunidade passa para "${escapeHtml(etapa.nome)}".${vigente ? ` Proposta ${escapeHtml(vigente.referencia_giaf || 'v' + vigente.versao)} (${this.euro(vigente.valor)}).` : ''}</p>
      <label>Valor final (€) <input type="number" id="crmGanhaValor" min="0" step="0.01" value="${Number(valor) || 0}"></label>
      ${podeProjeto
        ? `<label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" id="crmGanhaProjeto" checked> Criar já o projeto a partir desta oportunidade</label>`
        : `<p class="hint">${op.projeto_id ? 'Esta oportunidade já tem um projeto associado.' : 'O projeto é criado pelo Administrador (botão "Criar projeto" na oportunidade).'}</p>`}
      <button class="btn btn-primary" id="crmGanhaOk" style="margin-top:10px;">Marcar como ganha</button>`);
    const m = this.corpo();
    m.querySelector('#crmGanhaOk').addEventListener('click', async () => {
      const criar = !!(m.querySelector('#crmGanhaProjeto') && m.querySelector('#crmGanhaProjeto').checked);
      try {
        const gravada = await this.gravar('oportunidades', Object.assign({}, op, {
          etapa_id: etapa.id, motivo_perda_id: null, motivo_perda_notas: '', data_fecho: this.hoje(),
          valor_estimado: Number(m.querySelector('#crmGanhaValor').value) || 0
        }));
        App.fecharModal(); this.renderAtual();
        if (criar) this.criarProjetoDaOportunidade(gravada.id);
      } catch (err) { this.avisoErro(err); }
    });
  },

  // ---------- Criar projeto a partir de uma oportunidade ganha ----------
  // Usa o mesmo ecrã "Novo Projeto" da app (só o Administrador cria projetos), já preenchido. A
  // ligação oportunidade → projeto grava-se só depois de o projeto existir na base de dados.
  criarProjetoDaOportunidade(opId) {
    const op = this.idx.op.get(opId);
    if (!op || !this.souAdmin()) return;
    const conta = this.idx.conta.get(op.conta_id);
    const vigente = CrmLogica.propostaVigente(this.d.propostas, op.id);
    App.criarProjeto({
      nome: op.titulo,
      cliente: conta ? conta.nome : '',
      descricao: op.descricao || '',
      valorVendido: (vigente && vigente.valor) || op.valor_estimado || 0,
      horasVendidas: (vigente && vigente.horas_estimadas) || 0,
      refGiaf: vigente ? vigente.referencia_giaf : '',
      gestorRecursoId: op.responsavel_id || null,
      onCriado: async (projeto) => {
        try {
          // O projeto grava-se em segundo plano; a chave estrangeira só aceita a ligação depois.
          if (App._filaSincronizacao) await App._filaSincronizacao;
          await this.gravar('oportunidades', Object.assign({}, this.idx.op.get(opId), { projeto_id: projeto.id }));
          this.renderAtual();
          App.toast('Projeto criado e ligado à oportunidade.');
        } catch (err) { this.avisoErro(err); }
      }
    });
  },
  nomeProjetoDaOp(op) {
    const p = op.projeto_id && App.state.projetos[op.projeto_id];
    return p ? `${p.idInterno ? p.idInterno + ' — ' : ''}${p.nome}` : null;
  },

  // ---------- Ficha da oportunidade ----------
  abrirOportunidade(id, contaPre) {
    const tipos = this.tiposAtivos();
    if (!tipos.length) { App.toast('Define primeiro os tipos de oportunidade em Configurações → Funil CRM.'); return; }
    if (!this.d.contas.length) { App.toast('Cria primeiro uma conta (cliente).'); return; }
    const op = id ? this.idx.op.get(id) : null;
    if (id && !op) return;
    const filtroTipo = this.filtros.op.tipoId;
    const o = op || {
      id: null, conta_id: contaPre || '', contacto_id: null, tipo_id: this.idx.tipo.get(filtroTipo) ? filtroTipo : tipos[0].id,
      etapa_id: '', titulo: '', descricao: '', valor_estimado: 0, data_prevista_fecho: null,
      responsavel_id: this.meuRecursoId(), origem: '', motivo_perda_id: null, motivo_perda_notas: '', projeto_id: null
    };
    if (!o.etapa_id) { const e1 = CrmLogica.etapasDoTipo(this.d.etapas, o.tipo_id)[0]; o.etapa_id = e1 ? e1.id : ''; }
    const projNome = op ? this.nomeProjetoDaOp(op) : null;
    const catAtual = op ? CrmLogica.categoriaDe(op, this.idx.etapa) : 'aberta';
    const html = `
      <div class="row-2">
        <label>Título <span style="color:var(--vermelho);">*</span><input type="text" id="opTitulo" value="${escapeAttr(o.titulo)}" placeholder="Ex.: Projeto de eficiência energética"></label>
        <label>Conta <span style="color:var(--vermelho);">*</span><select id="opConta">${this.opcoes(this.contasOrdenadas(), o.conta_id, c => c.nome, 'Seleciona…')}</select></label>
      </div>
      <div class="row-2">
        <label>Contacto principal <select id="opContacto"></select></label>
        <label>Tipo <select id="opTipo"${op ? ' disabled title="O tipo não se altera depois de criada (cada tipo tem as suas etapas)."' : ''}>${this.opcoes(tipos, o.tipo_id, t => t.nome)}</select></label>
      </div>
      <div class="row-2">
        <label>Etapa <select id="opEtapa"></select></label>
        <label>Valor estimado (€) <input type="number" id="opValor" min="0" step="0.01" value="${Number(o.valor_estimado) || 0}"></label>
      </div>
      <div id="opPerdaWrap" style="display:none;">
        <div class="row-2">
          <label>Motivo da perda <span style="color:var(--vermelho);">*</span><select id="opMotivo"></select></label>
          <label>Notas da perda <input type="text" id="opMotivoNotas" value="${escapeAttr(o.motivo_perda_notas || '')}"></label>
        </div>
      </div>
      <div class="row-2">
        <label>Data prevista de fecho <input type="date" id="opFecho" value="${escapeAttr(o.data_prevista_fecho || '')}"></label>
        <label>Responsável <select id="opResp">${this.optResponsaveis(o.responsavel_id, 'Sem responsável')}</select></label>
      </div>
      <label>Origem <input type="text" id="opOrigem" list="opOrigens" value="${escapeAttr(o.origem || '')}" placeholder="Como surgiu?">
        <datalist id="opOrigens">${this.ORIGENS.map(x => `<option value="${escapeAttr(x)}">`).join('')}</datalist></label>
      <label>Descrição <textarea id="opDescricao" rows="3">${escapeHtml(o.descricao || '')}</textarea></label>
      ${projNome ? `<p class="hint" style="margin:6px 0;">🔗 Projeto associado: <b>${escapeHtml(projNome)}</b></p>` : ''}
      <span id="opMsg" class="calc-line" style="border:none;display:block;margin-top:4px;color:var(--vermelho);"></span>
      <div class="crm-acoes-form">
        <button class="btn btn-primary" id="opGuardar">${op ? 'Guardar' : 'Criar oportunidade'}</button>
        ${op && catAtual === 'ganha' && !op.projeto_id && this.souAdmin() ? '<button class="btn" id="opCriarProjeto">Criar projeto</button>' : ''}
        ${op ? '<button class="btn btn-danger" id="opEliminar">Eliminar</button>' : ''}
      </div>
      ${op ? '<div id="opSecoes"></div>' : '<p class="hint">Depois de criada, podes juntar propostas, interações e follow-ups.</p>'}`;
    this.abrir(op ? `Oportunidade — ${o.titulo}` : 'Nova oportunidade', html, true);
    const m = this.corpo();
    const selConta = m.querySelector('#opConta'), selContacto = m.querySelector('#opContacto');
    const selTipo = m.querySelector('#opTipo'), selEtapa = m.querySelector('#opEtapa'), selMotivo = m.querySelector('#opMotivo');
    const preencherContactos = () => {
      const lista = this.d.contactos.filter(c => c.conta_id === selConta.value).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
      selContacto.innerHTML = this.opcoes(lista, o.contacto_id, c => c.nome + (c.cargo ? ' — ' + c.cargo : ''), lista.length ? 'Sem contacto principal' : 'Esta conta não tem contactos');
    };
    const preencherEtapas = () => {
      const etapas = CrmLogica.etapasDoTipo(this.d.etapas, selTipo.value);
      // Uma etapa desativada onde a oportunidade ainda está continua a aparecer, para não a perder.
      const atual = this.idx.etapa.get(o.etapa_id);
      const lista = atual && atual.tipo_id === selTipo.value && !etapas.some(e => e.id === atual.id) ? etapas.concat([atual]) : etapas;
      const sel = lista.some(e => e.id === o.etapa_id) ? o.etapa_id : (lista[0] ? lista[0].id : '');
      selEtapa.innerHTML = this.opcoes(lista, sel, e => `${e.nome}${e.categoria === 'aberta' ? ' (' + Math.round(e.probabilidade) + '%)' : ''}`);
      const motivos = CrmLogica.motivosDoTipo(this.d.motivos, selTipo.value);
      selMotivo.innerHTML = this.opcoes(motivos, o.motivo_perda_id, mo => mo.nome, 'Seleciona…');
      mostrarPerda();
    };
    const mostrarPerda = () => {
      const e = this.idx.etapa.get(selEtapa.value);
      m.querySelector('#opPerdaWrap').style.display = e && e.categoria === 'perdida' ? '' : 'none';
    };
    selConta.addEventListener('change', () => { o.contacto_id = null; preencherContactos(); });
    selTipo.addEventListener('change', () => { o.etapa_id = ''; o.motivo_perda_id = null; preencherEtapas(); });
    selEtapa.addEventListener('change', () => { o.etapa_id = selEtapa.value; mostrarPerda(); });
    preencherContactos();
    preencherEtapas();
    m.querySelector('#opGuardar').addEventListener('click', () => this.guardarOportunidadeDoForm(op, m));
    const bProj = m.querySelector('#opCriarProjeto');
    if (bProj) bProj.addEventListener('click', () => { App.fecharModal(); this.criarProjetoDaOportunidade(op.id); });
    const bDel = m.querySelector('#opEliminar');
    if (bDel) bDel.addEventListener('click', async () => {
      if (!confirm('Eliminar esta oportunidade e as suas propostas, interações e follow-ups? Não se pode desfazer.')) return;
      try { await this.apagar('oportunidades', op.id); App.fecharModal(); this.renderAtual(); } catch (err) { this.avisoErro(err); }
    });
    if (op) this.renderSecoesOp(op.id);
  },
  async guardarOportunidadeDoForm(op, m) {
    const msg = m.querySelector('#opMsg');
    const titulo = m.querySelector('#opTitulo').value.trim();
    const contaId = m.querySelector('#opConta').value;
    const tipoId = m.querySelector('#opTipo').value;
    const etapaId = m.querySelector('#opEtapa').value;
    if (!titulo) { msg.textContent = 'O título é obrigatório.'; return; }
    if (!contaId) { msg.textContent = 'Escolhe a conta.'; return; }
    const etapa = this.idx.etapa.get(etapaId);
    if (!etapa) { msg.textContent = 'Escolhe a etapa.'; return; }
    const motivoId = m.querySelector('#opMotivo').value || null;
    const base = op || { id: null };
    const novo = Object.assign({}, base, {
      conta_id: contaId, contacto_id: m.querySelector('#opContacto').value || null, tipo_id: tipoId, etapa_id: etapaId, titulo,
      descricao: m.querySelector('#opDescricao').value.trim(), valor_estimado: Number(m.querySelector('#opValor').value) || 0,
      data_prevista_fecho: m.querySelector('#opFecho').value || null, responsavel_id: m.querySelector('#opResp').value || null,
      origem: m.querySelector('#opOrigem').value.trim(),
      motivo_perda_id: etapa.categoria === 'perdida' ? motivoId : null,
      motivo_perda_notas: etapa.categoria === 'perdida' ? m.querySelector('#opMotivoNotas').value.trim() : ''
    });
    const v = CrmLogica.validarMudancaEtapa(novo, etapa, novo.motivo_perda_id, CrmLogica.motivosDoTipo(this.d.motivos, tipoId, false).map(x => x.id));
    if (!v.ok) { msg.textContent = v.erro; return; }
    // data_fecho acompanha a categoria: preenchida ao fechar (se ainda não estava), limpa se reabrir.
    const eraFechada = op && CrmLogica.categoriaDe(op, this.idx.etapa) !== 'aberta';
    if (etapa.categoria === 'aberta') novo.data_fecho = null;
    else if (!eraFechada || op.etapa_id !== etapaId || !op.data_fecho) novo.data_fecho = this.hoje();
    try {
      const gravada = await this.gravar('oportunidades', novo);
      this.renderAtual();
      if (op) { App.toast('Oportunidade guardada.'); this.abrirOportunidade(gravada.id); }
      else { App.fecharModal(); this.abrirOportunidade(gravada.id); App.toast('Oportunidade criada.'); }
    } catch (err) { this.avisoErro(err); }
  },

  // ============================ Formulários reutilizáveis ============================
  // Cada formulário existe em duas formas — num modal (separadores Propostas/Contactos/Follow-ups) ou
  // "inline" dentro de uma ficha (oportunidade/conta) — por isso o HTML e a ligação de eventos ficam
  // separados e trabalham sobre uma "raiz" qualquer. Os campos usam [data-f="nome_da_coluna"].
  lerCampos(raiz) {
    const o = {};
    raiz.querySelectorAll('[data-f]').forEach(c => {
      const k = c.dataset.f;
      if (c.type === 'checkbox') o[k] = c.checked;
      else if (c.type === 'number') o[k] = c.value === '' ? null : Number(c.value);
      else if (c.type === 'date') o[k] = c.value || null;
      else o[k] = c.value.trim();
    });
    return o;
  },
  botoesForm(existe, extra) {
    return `<span data-msg class="calc-line" style="border:none;display:block;margin-top:6px;color:var(--vermelho);"></span>
      <div class="crm-acoes-form">
        <button type="button" class="btn btn-primary" data-acao-form="guardar">Guardar</button>
        <button type="button" class="btn" data-acao-form="cancelar">Cancelar</button>
        ${extra || ''}
        ${existe ? '<button type="button" class="btn btn-danger" data-acao-form="eliminar">Eliminar</button>' : ''}
      </div>`;
  },
  // Liga guardar/cancelar/eliminar de um formulário. "guardar" devolve a linha a gravar (ou uma
  // string de erro); depois de gravar chama aoFim(linhaGravada).
  ligarForm(raiz, { chave, existente, montar, aoFim, aoCancelar, confirmarEliminar }) {
    const msg = raiz.querySelector('[data-msg]');
    const botao = n => raiz.querySelector(`[data-acao-form="${n}"]`);
    botao('guardar').addEventListener('click', async () => {
      const r = montar(this.lerCampos(raiz));
      if (typeof r === 'string') { msg.textContent = r; return; }
      try {
        const gravada = await this.gravar(chave, r);
        if (aoFim) aoFim(gravada);
      } catch (err) { this.avisoErro(err); }
    });
    botao('cancelar').addEventListener('click', () => (aoCancelar ? aoCancelar() : App.fecharModal()));
    const bEl = botao('eliminar');
    if (bEl) bEl.addEventListener('click', async () => {
      if (!confirm(confirmarEliminar || 'Eliminar? Não se pode desfazer.')) return;
      try { await this.apagar(chave, existente.id); if (aoFim) aoFim(null); } catch (err) { this.avisoErro(err); }
    });
  },
  ligarAcoes(raiz, mapa) {
    raiz.querySelectorAll('[data-sec-acao]').forEach(b => b.addEventListener('click', () => { const f = mapa[b.dataset.secAcao]; if (f) f(b); }));
  },

  // ---------- Propostas ----------
  htmlFormProposta(p, fixarOp) {
    const ops = this.d.oportunidades.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt'));
    const rotuloOp = o => { const c = this.idx.conta.get(o.conta_id); return `${o.titulo} — ${c ? c.nome : '?'}`; };
    return `<div class="row-2">
        <label>Oportunidade <span style="color:var(--vermelho);">*</span><select data-f="oportunidade_id"${fixarOp ? ' disabled' : ''}>${this.opcoes(ops, p.oportunidade_id, rotuloOp, 'Seleciona…')}</select></label>
        <label>Referência GIAF <input type="text" data-f="referencia_giaf" value="${escapeAttr(p.referencia_giaf || '')}" placeholder="Nº da proposta no GIAF"></label>
      </div>
      <div class="row-2">
        <label>Versão <input type="number" data-f="versao" min="1" step="1" value="${Number(p.versao) || 1}"></label>
        <label>Valor (€) <input type="number" data-f="valor" min="0" step="0.01" value="${Number(p.valor) || 0}"></label>
      </div>
      <div class="row-2">
        <label>Horas estimadas <input type="number" data-f="horas_estimadas" min="0" step="0.5" value="${p.horas_estimadas == null ? '' : p.horas_estimadas}" placeholder="opcional"></label>
        <label>Estado <select data-f="estado">${Object.entries(this.ESTADOS_PROPOSTA).map(([k, v]) => `<option value="${k}"${p.estado === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="row-2">
        <label>Data de envio <input type="date" data-f="data_envio" value="${escapeAttr(p.data_envio || '')}"></label>
        <label>Validade <input type="date" data-f="data_validade" value="${escapeAttr(p.data_validade || '')}"></label>
      </div>
      <label>Documento (OneDrive / SharePoint) <input type="text" data-f="caminho_documento" value="${escapeAttr(p.caminho_documento || '')}" placeholder="Ligação https://… ou caminho da pasta/ficheiro"></label>
      <label>Notas <textarea data-f="notas" rows="2">${escapeHtml(p.notas || '')}</textarea></label>`;
  },
  novaProposta(opId) {
    return { id: null, oportunidade_id: opId || '', referencia_giaf: '', versao: CrmLogica.proximaVersao(this.d.propostas, opId), valor: (this.idx.op.get(opId) || {}).valor_estimado || 0, horas_estimadas: null, data_envio: null, data_validade: null, estado: 'rascunho', caminho_documento: '', notas: '' };
  },
  ligarFormProposta(raiz, p, aoFim, aoCancelar) {
    this.ligarForm(raiz, {
      chave: 'propostas', existente: p, aoFim: g => { if (g) this.aposGuardarProposta(g); else this.renderAtual(); aoFim(g); }, aoCancelar,
      confirmarEliminar: 'Eliminar esta proposta? (O documento no OneDrive/SharePoint não é afetado.)',
      montar: v => {
        const nova = Object.assign({}, p, v, { oportunidade_id: v.oportunidade_id || p.oportunidade_id });
        if (!nova.oportunidade_id) return 'Escolhe a oportunidade.';
        const erros = CrmLogica.validarProposta(nova);
        return erros.length ? erros.join(' ') : nova;
      }
    });
  },
  // Proposta aceite → oferece marcar a oportunidade como ganha.
  aposGuardarProposta(p) {
    this.renderAtual();
    if (p.estado !== 'aceite') return;
    const op = this.idx.op.get(p.oportunidade_id);
    if (!op || CrmLogica.categoriaDe(op, this.idx.etapa) === 'ganha') return;
    const ganha = CrmLogica.etapasDoTipo(this.d.etapas, op.tipo_id).find(e => e.categoria === 'ganha');
    if (ganha && confirm('A proposta ficou "Aceite". Marcar a oportunidade como Ganha?')) setTimeout(() => this.moverEtapa(op.id, ganha.id), 0);
  },
  abrirProposta(id, opId) {
    const p = id ? this.idx.proposta.get(id) : this.novaProposta(opId);
    if (id && !p) return;
    if (!id && !this.d.oportunidades.length) { App.toast('Cria primeiro uma oportunidade.'); return; }
    this.abrir(id ? 'Proposta' : 'Nova proposta', this.htmlFormProposta(p, !!opId) + this.botoesForm(!!id), false);
    this.ligarFormProposta(this.corpo(), p, () => App.fecharModal());
  },
  htmlTabelaPropostas(lista, comOp) {
    if (!lista.length) return '';
    return `<div class="table-scroll" style="max-height:none;"><table class="tabela-crud"><thead><tr>
      ${comOp ? '<th>Oportunidade</th><th>Conta</th>' : ''}<th>Ref. GIAF</th><th>v</th><th>Valor</th><th>Estado</th><th>Envio</th><th>Validade</th><th>Documento</th><th></th></tr></thead><tbody>
      ${lista.map(p => {
        const op = this.idx.op.get(p.oportunidade_id), c = op && this.idx.conta.get(op.conta_id);
        const expirada = p.estado === 'enviada' && p.data_validade && p.data_validade < this.hoje();
        return `<tr>${comOp ? `<td>${escapeHtml(op ? op.titulo : '—')}</td><td>${escapeHtml(c ? c.nome : '—')}</td>` : ''}
          <td>${escapeHtml(p.referencia_giaf || '—')}</td><td>${p.versao}</td><td>${this.euro(p.valor)}</td>
          <td><span class="crm-estado crm-estado-${p.estado}">${this.ESTADOS_PROPOSTA[p.estado] || p.estado}</span>${expirada ? ' <span class="crm-atrasada" title="Validade ultrapassada">⚠ validade</span>' : ''}</td>
          <td>${this.data(p.data_envio)}</td><td>${this.data(p.data_validade)}</td><td>${this.caminhoHtml(p.caminho_documento)}</td>
          <td><button type="button" class="btn btn-sm" ${comOp ? 'data-crm-acao' : 'data-sec-acao'}="${comOp ? 'abrir-proposta' : 'editar-proposta'}" data-id="${escapeAttr(p.id)}">Editar</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
  },
  renderPropostas(el) {
    const f = this.filtros.propostas;
    let lista = this.d.propostas.filter(p => {
      if (f.estado && p.estado !== f.estado) return false;
      const op = this.idx.op.get(p.oportunidade_id), c = op && this.idx.conta.get(op.conta_id);
      return this.contem(f.texto, p.referencia_giaf, op && op.titulo, c && c.nome);
    }).sort((a, b) => String(b.data_envio || b.criado_em).localeCompare(String(a.data_envio || a.criado_em)));
    const soma = est => this.d.propostas.filter(p => p.estado === est).reduce((s, p) => s + (Number(p.valor) || 0), 0);
    el.innerHTML = `<div class="crm-kpis">
        <div class="crm-kpi"><b>${this.d.propostas.length}</b><span>propostas</span></div>
        <div class="crm-kpi"><b>${this.euro(soma('enviada'))}</b><span>enviadas (a aguardar)</span></div>
        <div class="crm-kpi"><b>${this.euro(soma('aceite'))}</b><span>aceites</span></div>
      </div>
      <div class="filters crm-barra">
        <label class="zoom-label">Estado <select data-crm-filtro="propostas.estado"><option value="">Todos</option>${Object.entries(this.ESTADOS_PROPOSTA).map(([k, v]) => `<option value="${k}"${f.estado === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="zoom-label">Pesquisar <input type="text" data-crm-filtro="propostas.texto" value="${escapeAttr(f.texto)}" placeholder="Referência, oportunidade ou conta…"></label>
        <span class="crm-barra-fim"><button type="button" class="btn btn-primary" data-crm-acao="nova-proposta">+ Nova proposta</button></span>
      </div>
      ${lista.length ? this.htmlTabelaPropostas(lista, true) : this.vazioHtml('Nenhuma proposta com estes filtros.')}`;
  },
  // Secção "Propostas" dentro da ficha da oportunidade.
  secPropostas(raiz, opId) {
    const lista = this.d.propostas.filter(p => p.oportunidade_id === opId).sort((a, b) => b.versao - a.versao);
    raiz.innerHTML = `${this.htmlTabelaPropostas(lista, false) || this.vazioHtml('Ainda sem propostas.')}
      <button type="button" class="btn btn-sm" data-sec-acao="nova-proposta">+ Proposta</button><div class="crm-inline"></div>`;
    const slot = raiz.querySelector('.crm-inline');
    const abrirInline = p => {
      slot.innerHTML = `<div class="crm-inline-form">${this.htmlFormProposta(p, true)}${this.botoesForm(!!p.id)}</div>`;
      this.ligarFormProposta(slot, p, () => this.secPropostas(raiz, opId), () => { slot.innerHTML = ''; });
    };
    this.ligarAcoes(raiz, {
      'nova-proposta': () => abrirInline(this.novaProposta(opId)),
      'editar-proposta': b => abrirInline(this.idx.proposta.get(b.dataset.id))
    });
  },

  // ---------- Interações ----------
  htmlFormInteracao(i, contaId) {
    const contactos = this.d.contactos.filter(c => c.conta_id === contaId).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    return `<div class="row-2">
        <label>Tipo <select data-f="tipo">${Object.entries(this.TIPOS_INTERACAO).map(([k, v]) => `<option value="${k}"${i.tipo === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Data <input type="date" data-f="data" value="${escapeAttr(i.data || this.hoje())}"></label>
      </div>
      <label>Contacto <select data-f="contacto_id">${this.opcoes(contactos, i.contacto_id, c => c.nome, 'Sem contacto específico')}</select></label>
      <label>Resumo <span style="color:var(--vermelho);">*</span><textarea data-f="resumo" rows="3" placeholder="O que foi falado/acordado?">${escapeHtml(i.resumo || '')}</textarea></label>`;
  },
  secInteracoes(raiz, ctx) {
    const lista = this.d.interacoes.filter(i => ctx.opId ? i.oportunidade_id === ctx.opId : i.conta_id === ctx.contaId)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    raiz.innerHTML = `${lista.length ? `<div class="crm-lista">${lista.map(i => `<div class="crm-item">
        <div><b>${this.TIPOS_INTERACAO[i.tipo] || i.tipo}</b> · ${this.data(i.data)}${i.contacto_id && this.idx.contacto.get(i.contacto_id) ? ' · ' + escapeHtml(this.idx.contacto.get(i.contacto_id).nome) : ''}
          <span class="hint"> — ${escapeHtml(this.recursoNome(i.criado_por))}</span>
          <button type="button" class="btn btn-sm" data-sec-acao="editar" data-id="${escapeAttr(i.id)}">Editar</button></div>
        <div class="crm-item-texto">${escapeHtml(i.resumo)}</div></div>`).join('')}</div>` : this.vazioHtml('Ainda sem interações registadas.')}
      <button type="button" class="btn btn-sm" data-sec-acao="nova">+ Interação</button><div class="crm-inline"></div>`;
    const slot = raiz.querySelector('.crm-inline');
    const abrirInline = i => {
      slot.innerHTML = `<div class="crm-inline-form">${this.htmlFormInteracao(i, ctx.contaId)}${this.botoesForm(!!i.id)}</div>`;
      this.ligarForm(slot, {
        chave: 'interacoes', existente: i, aoCancelar: () => { slot.innerHTML = ''; }, confirmarEliminar: 'Eliminar esta interação?',
        aoFim: () => { this.secInteracoes(raiz, ctx); this.renderAtual(); },
        montar: v => {
          if (!v.resumo) return 'Escreve um resumo.';
          return Object.assign({}, i, v, { contacto_id: v.contacto_id || null });
        }
      });
    };
    this.ligarAcoes(raiz, {
      nova: () => abrirInline({ id: null, conta_id: ctx.contaId, oportunidade_id: ctx.opId || null, contacto_id: null, tipo: 'reuniao', data: this.hoje(), resumo: '', criado_por: this.meuRecursoId() }),
      editar: b => abrirInline(this.d.interacoes.find(x => x.id === b.dataset.id))
    });
  },

  // ---------- Tarefas de follow-up ----------
  htmlFormTarefa(t) {
    return `<label>O que fazer <span style="color:var(--vermelho);">*</span><input type="text" data-f="descricao" value="${escapeAttr(t.descricao || '')}" placeholder="Ex.: Enviar proposta revista"></label>
      <div class="row-2">
        <label>Responsável <select data-f="responsavel_id">${this.optResponsaveis(t.responsavel_id, 'Sem responsável')}</select></label>
        <label>Data limite <input type="date" data-f="data_limite" value="${escapeAttr(t.data_limite || '')}"></label>
      </div>
      ${t.id ? `<label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" data-f="concluida"${t.concluida ? ' checked' : ''}> Concluída</label>` : ''}`;
  },
  novaTarefa(ctx) {
    return { id: null, conta_id: ctx.conta || ctx.contaId || null, oportunidade_id: ctx.op || ctx.opId || null, descricao: '', responsavel_id: this.meuRecursoId(), data_limite: null, concluida: false, concluida_em: null };
  },
  ligarFormTarefa(raiz, t, aoFim, aoCancelar) {
    this.ligarForm(raiz, {
      chave: 'tarefas', existente: t, aoFim, aoCancelar, confirmarEliminar: 'Eliminar este follow-up?',
      montar: v => {
        if (!v.descricao) return 'Descreve o que há a fazer.';
        const concluida = t.id ? !!v.concluida : false;
        return Object.assign({}, t, v, {
          responsavel_id: v.responsavel_id || null, concluida,
          concluida_em: concluida ? (t.concluida_em || new Date().toISOString()) : null
        });
      }
    });
  },
  abrirTarefa(id, ctx) {
    const t = id ? this.d.tarefas.find(x => x.id === id) : this.novaTarefa(ctx || {});
    if (id && !t) return;
    this.abrir(id ? 'Follow-up' : 'Novo follow-up', this.htmlFormTarefa(t) + this.botoesForm(!!id), false);
    this.ligarFormTarefa(this.corpo(), t, () => { App.fecharModal(); this.renderAtual(); });
  },
  async alternarTarefa(id) {
    const t = this.d.tarefas.find(x => x.id === id);
    if (!t) return;
    try {
      await this.gravar('tarefas', Object.assign({}, t, { concluida: !t.concluida, concluida_em: !t.concluida ? new Date().toISOString() : null }));
      this.renderAtual();
    } catch (err) { this.avisoErro(err); this.renderAtual(); }
  },
  secTarefas(raiz, ctx) {
    const lista = this.d.tarefas.filter(t => ctx.opId ? t.oportunidade_id === ctx.opId : t.conta_id === ctx.contaId)
      .sort((a, b) => (a.concluida - b.concluida) || String(a.data_limite || '9999').localeCompare(String(b.data_limite || '9999')));
    raiz.innerHTML = `${lista.length ? `<div class="crm-lista">${lista.map(t => {
      const estado = CrmLogica.estadoTarefa(t, this.hoje());
      return `<div class="crm-item crm-item-linha ${t.concluida ? 'crm-feita' : ''}">
        <input type="checkbox" data-sec-acao="concluir" data-id="${escapeAttr(t.id)}"${t.concluida ? ' checked' : ''} title="Marcar como concluída">
        <span class="crm-item-texto">${escapeHtml(t.descricao)}</span>
        <span class="${estado === 'atrasada' ? 'crm-atrasada' : 'hint'}">${t.data_limite ? this.data(t.data_limite) : 'sem data'} · ${escapeHtml(this._primeiroNome(t.responsavel_id))}</span>
        <button type="button" class="btn btn-sm" data-sec-acao="editar" data-id="${escapeAttr(t.id)}">Editar</button></div>`;
    }).join('')}</div>` : this.vazioHtml('Sem follow-ups.')}
      <button type="button" class="btn btn-sm" data-sec-acao="nova">+ Follow-up</button><div class="crm-inline"></div>`;
    const slot = raiz.querySelector('.crm-inline');
    const abrirInline = t => {
      slot.innerHTML = `<div class="crm-inline-form">${this.htmlFormTarefa(t)}${this.botoesForm(!!t.id)}</div>`;
      this.ligarFormTarefa(slot, t, () => { this.secTarefas(raiz, ctx); this.renderAtual(); }, () => { slot.innerHTML = ''; });
    };
    raiz.querySelectorAll('[data-sec-acao="concluir"]').forEach(cb => cb.addEventListener('change', async () => {
      await this.alternarTarefa(cb.dataset.id); this.secTarefas(raiz, ctx);
    }));
    this.ligarAcoes(raiz, {
      nova: () => abrirInline(this.novaTarefa(ctx)),
      editar: b => abrirInline(this.d.tarefas.find(x => x.id === b.dataset.id))
    });
  },
  renderFollowups(el) {
    const f = this.filtros.tarefas;
    const meu = this.meuRecursoId();
    const base = this.d.tarefas.filter(t => (f.quem === 'todas' || t.responsavel_id === meu) &&
      (f.estado === 'todas' || (f.estado === 'concluidas' ? t.concluida : !t.concluida)));
    const g = CrmLogica.agruparTarefas(base, this.hoje());
    const rotulos = { atrasada: '⚠ Em atraso', hoje: 'Hoje', proxima: 'Próximos dias', 'sem-data': 'Sem data', concluida: 'Concluídas' };
    const blocos = Object.keys(rotulos).filter(k => g[k].length).map(k => `<h4 class="crm-h ${k === 'atrasada' ? 'crm-atrasada' : ''}">${rotulos[k]} (${g[k].length})</h4>
      <div class="crm-lista">${g[k].map(t => {
        const op = t.oportunidade_id && this.idx.op.get(t.oportunidade_id), c = this.idx.conta.get(t.conta_id || (op && op.conta_id));
        return `<div class="crm-item crm-item-linha ${t.concluida ? 'crm-feita' : ''}">
          <input type="checkbox" data-crm-acao="concluir-tarefa" data-id="${escapeAttr(t.id)}"${t.concluida ? ' checked' : ''} title="Marcar como concluída">
          <span class="crm-item-texto"><a href="#" data-crm-acao="abrir-tarefa" data-id="${escapeAttr(t.id)}">${escapeHtml(t.descricao)}</a>
            ${op ? ` · <a href="#" data-crm-acao="abrir-op" data-id="${escapeAttr(op.id)}">${escapeHtml(op.titulo)}</a>` : ''}
            ${c ? ` · <a href="#" data-crm-acao="abrir-conta" data-id="${escapeAttr(c.id)}">${escapeHtml(c.nome)}</a>` : ''}</span>
          <span class="${k === 'atrasada' ? 'crm-atrasada' : 'hint'}">${t.data_limite ? this.data(t.data_limite) : 'sem data'} · ${escapeHtml(this._primeiroNome(t.responsavel_id))}</span></div>`;
      }).join('')}</div>`).join('');
    el.innerHTML = `<div class="filters crm-barra">
        <label class="zoom-label">De quem <select data-crm-filtro="tarefas.quem"><option value="minhas"${f.quem === 'minhas' ? ' selected' : ''}>Os meus</option><option value="todas"${f.quem === 'todas' ? ' selected' : ''}>Todos</option></select></label>
        <label class="zoom-label">Estado <select data-crm-filtro="tarefas.estado"><option value="pendentes"${f.estado === 'pendentes' ? ' selected' : ''}>Pendentes</option><option value="concluidas"${f.estado === 'concluidas' ? ' selected' : ''}>Concluídos</option><option value="todas"${f.estado === 'todas' ? ' selected' : ''}>Todos</option></select></label>
        <span class="crm-barra-fim"><button type="button" class="btn btn-primary" data-crm-acao="nova-tarefa">+ Novo follow-up</button></span>
      </div>${blocos || this.vazioHtml('Nada por fazer. 🎉')}`;
    // Os "links" são âncoras: não saltar para o topo da página.
    el.querySelectorAll('a[data-crm-acao]').forEach(a => a.addEventListener('click', ev => ev.preventDefault()));
  },

  // ---------- Secções da ficha da oportunidade ----------
  renderSecoesOp(opId) {
    const op = this.idx.op.get(opId);
    const raiz = this.corpo().querySelector('#opSecoes');
    if (!raiz || !op) return;
    const mostraProjeto = op.projeto_id || CrmLogica.categoriaDe(op, this.idx.etapa) === 'ganha';
    raiz.innerHTML = `${mostraProjeto ? '<h4 class="crm-h">Projeto</h4><div id="opSecProj"></div>' : ''}<h4 class="crm-h">Propostas</h4><div id="opSecProp"></div>
      <h4 class="crm-h">Interações</h4><div id="opSecInt"></div>
      <h4 class="crm-h">Follow-ups</h4><div id="opSecTar"></div>`;
    if (mostraProjeto) this.secProjetoDaOp(raiz.querySelector('#opSecProj'), opId);
    this.secPropostas(raiz.querySelector('#opSecProp'), opId);
    this.secInteracoes(raiz.querySelector('#opSecInt'), { opId, contaId: op.conta_id });
    this.secTarefas(raiz.querySelector('#opSecTar'), { opId, contaId: op.conta_id });
  },

  // ============================ Contas ============================
  renderContas(el) {
    const f = this.filtros.contas;
    const nDup = CrmLogica.gruposDuplicados(this.d.contas).length;
    const lista = this.d.contas.filter(c => (!f.estado || c.estado === f.estado) && (!f.resp || c.responsavel_id === f.resp) &&
      this.contem(f.texto, c.nome, c.nif, c.setor)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    el.innerHTML = `<div class="filters crm-barra">
        <label class="zoom-label">Estado <select data-crm-filtro="contas.estado"><option value="">Todos</option>${Object.entries(this.ESTADOS_CONTA).map(([k, v]) => `<option value="${k}"${f.estado === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="zoom-label">Responsável <select data-crm-filtro="contas.resp">${this.optResponsaveis(f.resp, 'Todos')}</select></label>
        <label class="zoom-label">Pesquisar <input type="text" data-crm-filtro="contas.texto" value="${escapeAttr(f.texto)}" placeholder="Nome, NIF ou setor…"></label>
        <span class="crm-barra-fim"><span class="hint">${lista.length} de ${this.d.contas.length} contas</span>
          ${nDup ? `<button type="button" class="btn" data-crm-acao="duplicados" title="Contas com o mesmo NIF ou nome">⚠ Duplicados (${nDup})</button>` : ''}
          <button type="button" class="btn" data-crm-acao="contas-projetos" title="Cria contas para os clientes que já aparecem nos projetos">Dos projetos</button>
          <button type="button" class="btn" data-crm-acao="importar-contas">⬆ Importar</button>
          <button type="button" class="btn btn-primary" data-crm-acao="nova-conta">+ Nova conta</button></span>
      </div>
      ${lista.length ? `<div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Conta</th><th>NIF</th><th>Estado</th><th>Setor</th><th>Responsável</th><th>Contactos</th><th>Oport. em curso</th><th>Valor em curso</th></tr></thead><tbody>
        ${lista.map(c => {
          const ops = this.d.oportunidades.filter(o => o.conta_id === c.id && CrmLogica.categoriaDe(o, this.idx.etapa) === 'aberta');
          return `<tr class="crm-linha" data-crm-acao="abrir-conta" data-id="${escapeAttr(c.id)}"><td><b>${escapeHtml(c.nome)}</b></td><td>${escapeHtml(c.nif || '—')}</td>
            <td><span class="crm-estado crm-estado-${c.estado}">${this.ESTADOS_CONTA[c.estado] || c.estado}</span></td><td>${escapeHtml(c.setor || '—')}</td>
            <td>${escapeHtml(this.recursoNome(c.responsavel_id))}</td><td>${this.d.contactos.filter(x => x.conta_id === c.id).length}</td>
            <td>${ops.length}</td><td>${this.euro(ops.reduce((s, o) => s + (Number(o.valor_estimado) || 0), 0))}</td></tr>`;
        }).join('')}</tbody></table></div>` : this.vazioHtml(this.d.contas.length ? 'Nenhuma conta com estes filtros.' : 'Ainda não há contas. Cria a primeira em "+ Nova conta".')}`;
  },
  abrirConta(id) {
    const c = id ? this.idx.conta.get(id) : { id: null, nome: '', nif: '', setor: '', dimensao: '', morada: '', website: '', estado: 'prospeto', responsavel_id: this.meuRecursoId(), notas: '' };
    if (id && !c) return;
    const html = `
      <div class="row-2">
        <label>Nome <span style="color:var(--vermelho);">*</span><input type="text" id="ctNome" value="${escapeAttr(c.nome)}"></label>
        <label>NIF <input type="text" id="ctNif" value="${escapeAttr(c.nif || '')}" inputmode="numeric"></label>
      </div>
      <div class="row-2">
        <label>Setor <input type="text" id="ctSetor" value="${escapeAttr(c.setor || '')}" placeholder="Ex.: Têxtil, Calçado, Energia…"></label>
        <label>Dimensão <select id="ctDimensao">${['', 'Micro', 'PME', 'Pequena', 'Média', 'Grande'].map(v => `<option value="${v}"${c.dimensao === v ? ' selected' : ''}>${v || '—'}</option>`).join('')}</select></label>
      </div>
      <div class="row-2">
        <label>Estado <select id="ctEstado">${Object.entries(this.ESTADOS_CONTA).map(([k, v]) => `<option value="${k}"${c.estado === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Responsável <select id="ctResp">${this.optResponsaveis(c.responsavel_id, 'Sem responsável')}</select></label>
      </div>
      <div class="row-2">
        <label>Morada <input type="text" id="ctMorada" value="${escapeAttr(c.morada || '')}"></label>
        <label>Website <input type="text" id="ctWebsite" value="${escapeAttr(c.website || '')}" placeholder="https://…"></label>
      </div>
      <label>Notas <textarea id="ctNotas" rows="2">${escapeHtml(c.notas || '')}</textarea></label>
      <span id="ctMsg" class="calc-line" style="border:none;display:block;margin-top:4px;color:var(--vermelho);"></span>
      <div class="crm-acoes-form">
        <button class="btn btn-primary" id="ctGuardar">${id ? 'Guardar' : 'Criar conta'}</button>
        ${id ? '<button class="btn btn-danger" id="ctEliminar">Eliminar</button>' : ''}
      </div>
      ${id ? '<div id="ctSecoes"></div>' : '<p class="hint">Depois de criada, podes juntar contactos, oportunidades, interações e follow-ups.</p>'}`;
    this.abrir(id ? `Conta — ${c.nome}` : 'Nova conta', html, true);
    const m = this.corpo();
    m.querySelector('#ctGuardar').addEventListener('click', async () => {
      const msg = m.querySelector('#ctMsg');
      const nome = m.querySelector('#ctNome').value.trim();
      if (!nome) { msg.textContent = 'O nome é obrigatório.'; return; }
      const nif = m.querySelector('#ctNif').value.trim();
      const dup = CrmLogica.duplicadoConta(this.d.contas, { nome, nif }, id);
      if (dup && !confirm(`Já existe a conta "${dup.nome}" (mesmo NIF ou nome parecido). Guardar mesmo assim?`)) return;
      const nova = Object.assign({}, c, {
        nome, nif, setor: m.querySelector('#ctSetor').value.trim(), dimensao: m.querySelector('#ctDimensao').value,
        estado: m.querySelector('#ctEstado').value, responsavel_id: m.querySelector('#ctResp').value || null,
        morada: m.querySelector('#ctMorada').value.trim(), website: m.querySelector('#ctWebsite').value.trim(), notas: m.querySelector('#ctNotas').value.trim()
      });
      try {
        const g = await this.gravar('contas', nova);
        this.renderAtual();
        App.toast(id ? 'Conta guardada.' : 'Conta criada.');
        if (!id) this.abrirConta(g.id);
      } catch (err) { this.avisoErro(err); }
    });
    const bDel = m.querySelector('#ctEliminar');
    if (bDel) bDel.addEventListener('click', async () => {
      if (this.d.oportunidades.some(o => o.conta_id === id)) { App.toast('Esta conta tem oportunidades — elimina-as primeiro (ou passa a conta a "Inativo").'); return; }
      if (!confirm('Eliminar esta conta, os seus contactos, interações e follow-ups? Não se pode desfazer.')) return;
      try { await this.apagar('contas', id); App.fecharModal(); this.renderAtual(); } catch (err) { this.avisoErro(err); }
    });
    if (id) this.renderSecoesConta(id);
  },
  renderSecoesConta(contaId) {
    const raiz = this.corpo().querySelector('#ctSecoes');
    if (!raiz) return;
    raiz.innerHTML = `<h4 class="crm-h">Contactos</h4><div id="ctSecCont"></div>
      <h4 class="crm-h">Oportunidades</h4><div id="ctSecOp"></div>
      <h4 class="crm-h">Projetos</h4><div id="ctSecProj"></div>
      <h4 class="crm-h">Interações</h4><div id="ctSecInt"></div>
      <h4 class="crm-h">Follow-ups</h4><div id="ctSecTar"></div>`;
    this.secContactos(raiz.querySelector('#ctSecCont'), contaId);
    this.secOportunidadesDaConta(raiz.querySelector('#ctSecOp'), contaId);
    this.secProjetosDaConta(raiz.querySelector('#ctSecProj'), contaId);
    this.secInteracoes(raiz.querySelector('#ctSecInt'), { contaId });
    this.secTarefas(raiz.querySelector('#ctSecTar'), { contaId });
  },
  secOportunidadesDaConta(raiz, contaId) {
    const ops = this.d.oportunidades.filter(o => o.conta_id === contaId);
    raiz.innerHTML = `${ops.length ? `<div class="crm-lista">${ops.map(o => {
      const e = this.idx.etapa.get(o.etapa_id), t = this.idx.tipo.get(o.tipo_id);
      return `<div class="crm-item crm-item-linha"><span class="crm-item-texto"><b>${escapeHtml(o.titulo)}</b> · ${escapeHtml(t ? t.nome : '')}</span>
        <span class="hint">${escapeHtml(e ? e.nome : '')} · ${this.euro(o.valor_estimado)}</span>
        <button type="button" class="btn btn-sm" data-sec-acao="abrir" data-id="${escapeAttr(o.id)}">Abrir</button></div>`;
    }).join('')}</div>` : this.vazioHtml('Sem oportunidades.')}
      <button type="button" class="btn btn-sm" data-sec-acao="nova">+ Oportunidade</button>`;
    this.ligarAcoes(raiz, { abrir: b => this.abrirOportunidade(b.dataset.id), nova: () => this.abrirOportunidade(null, contaId) });
  },

  // ============================ Contactos ============================
  htmlFormContacto(c, fixarConta) {
    return `<div class="row-2">
        <label>Conta <span style="color:var(--vermelho);">*</span><select data-f="conta_id"${fixarConta ? ' disabled' : ''}>${this.opcoes(this.contasOrdenadas(), c.conta_id, x => x.nome, 'Seleciona…')}</select></label>
        <label>Nome <span style="color:var(--vermelho);">*</span><input type="text" data-f="nome" value="${escapeAttr(c.nome || '')}"></label>
      </div>
      <div class="row-2">
        <label>Cargo <input type="text" data-f="cargo" value="${escapeAttr(c.cargo || '')}"></label>
        <label>Papel na decisão <select data-f="papel_decisao">${Object.entries(this.PAPEIS_DECISAO).map(([k, v]) => `<option value="${k}"${c.papel_decisao === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="row-2">
        <label>Email <input type="text" data-f="email" value="${escapeAttr(c.email || '')}"></label>
        <label>Telefone <input type="text" data-f="telefone" value="${escapeAttr(c.telefone || '')}"></label>
      </div>
      <label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" data-f="consentimento_rgpd"${c.consentimento_rgpd ? ' checked' : ''}> Consentimento RGPD para contacto comercial${c.consentimento_data ? ` <span class="hint">(registado em ${this.data(c.consentimento_data)})</span>` : ''}</label>
      <label>Notas <textarea data-f="notas" rows="2">${escapeHtml(c.notas || '')}</textarea></label>`;
  },
  novoContacto(contaId) {
    return { id: null, conta_id: contaId || '', nome: '', cargo: '', email: '', telefone: '', papel_decisao: '', consentimento_rgpd: false, consentimento_data: null, notas: '' };
  },
  ligarFormContacto(raiz, c, aoFim, aoCancelar) {
    this.ligarForm(raiz, {
      chave: 'contactos', existente: c, aoFim, aoCancelar,
      confirmarEliminar: 'Eliminar este contacto? (As interações ficam, sem contacto associado.)',
      montar: v => {
        const nova = Object.assign({}, c, v, { conta_id: v.conta_id || c.conta_id });
        if (!nova.conta_id) return 'Escolhe a conta.';
        if (!nova.nome) return 'O nome é obrigatório.';
        // A data do consentimento é a do dia em que se marcou (e limpa-se se se desmarcar).
        nova.consentimento_data = nova.consentimento_rgpd ? (c.consentimento_rgpd && c.consentimento_data ? c.consentimento_data : this.hoje()) : null;
        return nova;
      }
    });
  },
  // RGPD: exporta tudo o que a app guarda sobre este contacto (ficheiro JSON, descarregado no browser).
  exportarContacto(c) {
    const dados = {
      exportadoEm: new Date().toISOString(),
      conta: (this.idx.conta.get(c.conta_id) || {}).nome || null,
      contacto: c,
      interacoes: this.d.interacoes.filter(i => i.contacto_id === c.id),
      oportunidadesPrincipais: this.d.oportunidades.filter(o => o.contacto_id === c.id).map(o => ({ titulo: o.titulo, valor_estimado: o.valor_estimado }))
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `contacto_${c.nome.replace(/[^\w]+/g, '_')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  abrirContacto(id, contaPre) {
    const c = id ? this.idx.contacto.get(id) : this.novoContacto(contaPre);
    if (id && !c) return;
    if (!id && !this.d.contas.length) { App.toast('Cria primeiro uma conta.'); return; }
    this.abrir(id ? `Contacto — ${c.nome}` : 'Novo contacto', this.htmlFormContacto(c, !!contaPre) +
      this.botoesForm(!!id, id ? '<button type="button" class="btn" data-acao-form="exportar" title="Descarrega os dados deste contacto (RGPD)">Exportar dados</button>' : ''), false);
    const m = this.corpo();
    this.ligarFormContacto(m, c, () => { App.fecharModal(); this.renderAtual(); });
    const bExp = m.querySelector('[data-acao-form="exportar"]');
    if (bExp) bExp.addEventListener('click', () => this.exportarContacto(c));
  },
  secContactos(raiz, contaId) {
    const lista = this.d.contactos.filter(c => c.conta_id === contaId).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    raiz.innerHTML = `${lista.length ? `<div class="crm-lista">${lista.map(c => `<div class="crm-item crm-item-linha">
        <span class="crm-item-texto"><b>${escapeHtml(c.nome)}</b>${c.cargo ? ' · ' + escapeHtml(c.cargo) : ''}${c.papel_decisao ? ` <span class="crm-badge">${this.PAPEIS_DECISAO[c.papel_decisao]}</span>` : ''}</span>
        <span class="hint">${escapeHtml(c.email || '')} ${escapeHtml(c.telefone || '')}</span>
        <button type="button" class="btn btn-sm" data-sec-acao="editar" data-id="${escapeAttr(c.id)}">Editar</button></div>`).join('')}</div>` : this.vazioHtml('Sem contactos.')}
      <button type="button" class="btn btn-sm" data-sec-acao="novo">+ Contacto</button><div class="crm-inline"></div>`;
    const slot = raiz.querySelector('.crm-inline');
    const abrirInline = c => {
      slot.innerHTML = `<div class="crm-inline-form">${this.htmlFormContacto(c, true)}${this.botoesForm(!!c.id)}</div>`;
      this.ligarFormContacto(slot, c, () => { this.secContactos(raiz, contaId); this.renderAtual(); }, () => { slot.innerHTML = ''; });
    };
    this.ligarAcoes(raiz, { novo: () => abrirInline(this.novoContacto(contaId)), editar: b => abrirInline(this.idx.contacto.get(b.dataset.id)) });
  },
  renderContactos(el) {
    const f = this.filtros.contactos;
    const lista = this.d.contactos.filter(c => { const conta = this.idx.conta.get(c.conta_id); return this.contem(f.texto, c.nome, c.email, c.cargo, c.telefone, conta && conta.nome); })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    el.innerHTML = `<div class="filters crm-barra">
        <label class="zoom-label">Pesquisar <input type="text" data-crm-filtro="contactos.texto" value="${escapeAttr(f.texto)}" placeholder="Nome, conta, email, cargo…"></label>
        <span class="crm-barra-fim"><span class="hint">${lista.length} de ${this.d.contactos.length} contactos</span>
          <button type="button" class="btn" data-crm-acao="importar-contactos">⬆ Importar</button>
          <button type="button" class="btn btn-primary" data-crm-acao="novo-contacto">+ Novo contacto</button></span>
      </div>
      ${lista.length ? `<div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Nome</th><th>Conta</th><th>Cargo</th><th>Papel</th><th>Email</th><th>Telefone</th><th>RGPD</th></tr></thead><tbody>
        ${lista.map(c => { const conta = this.idx.conta.get(c.conta_id); return `<tr class="crm-linha" data-crm-acao="abrir-contacto" data-id="${escapeAttr(c.id)}">
          <td><b>${escapeHtml(c.nome)}</b></td><td>${escapeHtml(conta ? conta.nome : '—')}</td><td>${escapeHtml(c.cargo || '—')}</td>
          <td>${this.PAPEIS_DECISAO[c.papel_decisao] || '—'}</td><td>${escapeHtml(c.email || '—')}</td><td>${escapeHtml(c.telefone || '—')}</td>
          <td>${c.consentimento_rgpd ? '✔' : '<span class="hint">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
        : this.vazioHtml(this.d.contactos.length ? 'Nenhum contacto com este filtro.' : 'Ainda não há contactos.')}`;
  },

  // ============================ Funil CRM (parâmetros — só Administrador) ============================
  renderFunil(el) {
    if (!this.souAdmin()) { el.innerHTML = this.vazioHtml('Só o Administrador altera os parâmetros do funil.'); return; }
    const tipos = this.d.tipos.slice().sort(CrmLogica._porOrdem);
    const usos = (chave, campo, id) => this.d[chave].filter(x => x[campo] === id).length;
    el.innerHTML = `<p class="pagina-sub" style="margin-top:0;">Define, para cada tipo de oportunidade, as etapas do funil (com a probabilidade de fecho de cada uma) e os motivos de perda. As alterações gravam-se logo. A <b>categoria</b> é o que a app usa: "em curso", "ganha" (permite criar o projeto) ou "perdida" (exige motivo) — por isso podes renomear e reordenar etapas à vontade.</p>
      ${tipos.map(t => {
        const etapas = CrmLogica.etapasDoTipo(this.d.etapas, t.id, false), motivos = CrmLogica.motivosDoTipo(this.d.motivos, t.id, false);
        const semMotivo = etapas.some(e => e.categoria === 'perdida' && e.ativo !== false) && !motivos.some(m => m.ativo !== false);
        return `<section class="crm-funil-tipo">
          <div class="crm-funil-head">
            <input type="text" class="crm-funil-nome" data-funil="tipos" data-id="${escapeAttr(t.id)}" data-campo="nome" value="${escapeAttr(t.nome)}">
            <label class="zoom-label" style="flex-direction:row;align-items:center;gap:6px;"><input type="checkbox" data-funil="tipos" data-id="${escapeAttr(t.id)}" data-campo="ativo"${t.ativo !== false ? ' checked' : ''}> Ativo</label>
            <span class="hint">${usos('oportunidades', 'tipo_id', t.id)} oportunidades</span>
          </div>
          ${semMotivo ? '<p class="crm-atrasada" style="margin:4px 0;">⚠ Este tipo tem uma etapa "perdida" mas nenhum motivo de perda ativo.</p>' : ''}
          <h4 class="crm-h">Etapas</h4>
          <table class="tabela-crud crm-funil-tab"><thead><tr><th></th><th>Nome</th><th>Probabilidade %</th><th>Categoria</th><th>Ativa</th><th>Oport.</th><th></th></tr></thead><tbody>
            ${etapas.map((e, i) => `<tr>
              <td class="crm-ord"><button type="button" class="btn-icon" data-crm-acao="funil-mover" data-chave="etapas" data-id="${escapeAttr(e.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button><button type="button" class="btn-icon" data-crm-acao="funil-mover" data-chave="etapas" data-id="${escapeAttr(e.id)}" data-dir="1" ${i === etapas.length - 1 ? 'disabled' : ''} title="Descer">↓</button></td>
              <td><input type="text" data-funil="etapas" data-id="${escapeAttr(e.id)}" data-campo="nome" value="${escapeAttr(e.nome)}"></td>
              <td><input type="number" min="0" max="100" step="1" style="width:70px" data-funil="etapas" data-id="${escapeAttr(e.id)}" data-campo="probabilidade" value="${Number(e.probabilidade) || 0}"${e.categoria !== 'aberta' ? ' disabled title="Ganha = 100%, perdida = 0%"' : ''}></td>
              <td><select data-funil="etapas" data-id="${escapeAttr(e.id)}" data-campo="categoria">${[['aberta', 'Em curso'], ['ganha', 'Ganha'], ['perdida', 'Perdida']].map(([k, v]) => `<option value="${k}"${e.categoria === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
              <td><input type="checkbox" data-funil="etapas" data-id="${escapeAttr(e.id)}" data-campo="ativo"${e.ativo !== false ? ' checked' : ''}></td>
              <td>${usos('oportunidades', 'etapa_id', e.id)}</td>
              <td><button type="button" class="btn-icon" data-crm-acao="funil-apagar" data-chave="etapas" data-id="${escapeAttr(e.id)}" title="Eliminar">🗑</button></td></tr>`).join('')}
          </tbody></table>
          <button type="button" class="btn btn-sm" data-crm-acao="funil-novo" data-chave="etapas" data-tipo="${escapeAttr(t.id)}">+ Etapa</button>
          <h4 class="crm-h">Motivos de perda</h4>
          <table class="tabela-crud crm-funil-tab"><tbody>
            ${motivos.map((mo, i) => `<tr>
              <td class="crm-ord"><button type="button" class="btn-icon" data-crm-acao="funil-mover" data-chave="motivos" data-id="${escapeAttr(mo.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="btn-icon" data-crm-acao="funil-mover" data-chave="motivos" data-id="${escapeAttr(mo.id)}" data-dir="1" ${i === motivos.length - 1 ? 'disabled' : ''}>↓</button></td>
              <td><input type="text" data-funil="motivos" data-id="${escapeAttr(mo.id)}" data-campo="nome" value="${escapeAttr(mo.nome)}"></td>
              <td><label class="zoom-label" style="flex-direction:row;align-items:center;gap:6px;"><input type="checkbox" data-funil="motivos" data-id="${escapeAttr(mo.id)}" data-campo="ativo"${mo.ativo !== false ? ' checked' : ''}> Ativo</label></td>
              <td>${usos('oportunidades', 'motivo_perda_id', mo.id)} usos</td>
              <td><button type="button" class="btn-icon" data-crm-acao="funil-apagar" data-chave="motivos" data-id="${escapeAttr(mo.id)}" title="Eliminar">🗑</button></td></tr>`).join('')}
          </tbody></table>
          <button type="button" class="btn btn-sm" data-crm-acao="funil-novo" data-chave="motivos" data-tipo="${escapeAttr(t.id)}">+ Motivo de perda</button>
        </section>`;
      }).join('')}
      <button type="button" class="btn" data-crm-acao="funil-novo-tipo" style="margin-top:12px;">+ Novo tipo de oportunidade</button>`;
    if (!el._funilLigado) {
      el._funilLigado = true;
      el.addEventListener('change', ev => { const c = ev.target.closest('[data-funil]'); if (c) this.alterarFunil(c); });
    }
  },
  async alterarFunil(c) {
    const chave = c.dataset.funil, linha = this.d[chave].find(x => x.id === c.dataset.id);
    if (!linha) return;
    const campo = c.dataset.campo;
    const nova = Object.assign({}, linha);
    if (campo === 'ativo') nova.ativo = c.checked;
    else if (campo === 'probabilidade') nova.probabilidade = Math.min(100, Math.max(0, Number(c.value) || 0));
    else if (campo === 'nome') { nova.nome = c.value.trim(); if (!nova.nome) { this.renderAtual(); return; } }
    else nova[campo] = c.value;
    if (campo === 'categoria') nova.probabilidade = c.value === 'ganha' ? 100 : (c.value === 'perdida' ? 0 : (linha.categoria === 'aberta' ? linha.probabilidade : 50));
    try { await this.gravar(chave, nova); } catch (err) { this.avisoErro(err); }
    this.renderAtual();
  },
  async acaoFunil(nome, el) {
    if (!nome.startsWith('funil-') || !this.souAdmin()) return;
    const chave = el.dataset.chave;
    try {
      if (nome === 'funil-novo-tipo') {
        const ordem = this.d.tipos.reduce((m, t) => Math.max(m, t.ordem || 0), -1) + 1;
        const t = await this.gravar('tipos', { id: null, nome: 'Novo tipo', ordem, ativo: true });
        // Um tipo novo já nasce com o essencial: uma etapa em curso, uma ganha e uma perdida.
        await this.gravar('etapas', { id: null, tipo_id: t.id, nome: 'Lead', probabilidade: 10, categoria: 'aberta', ordem: 0, ativo: true });
        await this.gravar('etapas', { id: null, tipo_id: t.id, nome: 'Ganha', probabilidade: 100, categoria: 'ganha', ordem: 1, ativo: true });
        await this.gravar('etapas', { id: null, tipo_id: t.id, nome: 'Perdida', probabilidade: 0, categoria: 'perdida', ordem: 2, ativo: true });
        await this.gravar('motivos', { id: null, tipo_id: t.id, nome: 'Outro', ordem: 0, ativo: true });
      } else if (nome === 'funil-novo') {
        const tipoId = el.dataset.tipo;
        const ordem = this.d[chave].filter(x => x.tipo_id === tipoId).reduce((m, x) => Math.max(m, x.ordem || 0), -1) + 1;
        await this.gravar(chave, chave === 'etapas'
          ? { id: null, tipo_id: tipoId, nome: 'Nova etapa', probabilidade: 50, categoria: 'aberta', ordem, ativo: true }
          : { id: null, tipo_id: tipoId, nome: 'Novo motivo', ordem, ativo: true });
      } else if (nome === 'funil-mover') {
        const linha = this.d[chave].find(x => x.id === el.dataset.id);
        const irmas = this.d[chave].filter(x => x.tipo_id === linha.tipo_id).sort(CrmLogica._porOrdem);
        const i = irmas.findIndex(x => x.id === linha.id), j = i + Number(el.dataset.dir);
        if (j < 0 || j >= irmas.length) return;
        [irmas[i], irmas[j]] = [irmas[j], irmas[i]];
        for (let k = 0; k < irmas.length; k++) if (irmas[k].ordem !== k) await this.gravar(chave, Object.assign({}, irmas[k], { ordem: k }));
      } else if (nome === 'funil-apagar') {
        const id = el.dataset.id;
        const emUso = chave === 'etapas' ? this.d.oportunidades.filter(o => o.etapa_id === id).length : this.d.oportunidades.filter(o => o.motivo_perda_id === id).length;
        if (emUso) { App.toast(`Está em uso em ${emUso} oportunidade(s) — desativa em vez de eliminar.`); return; }
        if (!confirm('Eliminar? Não se pode desfazer.')) return;
        await this.apagar(chave, id);
      }
    } catch (err) { this.avisoErro(err); }
    this.renderAtual();
  },

  // ============================ Fase 2: Dashboard comercial ============================
  // Barras horizontais em CSS. Cada linha: { rotulo, valor, valor2 (opcional, camada mais clara por
  // baixo, ex.: valor total vs ponderado), texto, cor }. A escala é a do maior valor do conjunto.
  htmlBarras(linhas, vazio) {
    if (!linhas.length) return this.vazioHtml(vazio || 'Sem dados.');
    const max = Math.max(...linhas.map(l => Math.max(l.valor || 0, l.valor2 || 0)), 1);
    return `<div class="crm-barras">${linhas.map(l => `<div class="crm-barra-linha">
      <span class="crm-barra-rotulo" title="${escapeAttr(l.rotulo)}">${escapeHtml(l.rotulo)}</span>
      <span class="crm-barra-pista">
        ${l.valor2 != null ? `<i class="crm-barra-fundo" style="width:${Math.max(1, (l.valor2 / max) * 100)}%"></i>` : ''}
        <i class="crm-barra-cheia" style="width:${l.valor ? Math.max(1, (l.valor / max) * 100) : 0}%;${l.cor ? `background:${l.cor};` : ''}"></i>
      </span>
      <span class="crm-barra-texto">${escapeHtml(l.texto)}</span></div>`).join('')}</div>`;
  },
  rotuloMes(k) { const M = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; return `${M[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`; },
  renderDashboard(el) {
    const L = CrmLogica, f = this.filtros.dash, hoje = this.hoje();
    const per = L.periodoPreset(f.periodo, hoje);
    const meu = this.meuRecursoId();
    const tipos = this.tiposAtivos();
    const ops = this.d.oportunidades.filter(o => (!f.tipoId || o.tipo_id === f.tipoId) && (f.resp !== 'meus' || o.responsavel_id === meu));
    const abertas = L.resumoFunil(ops, this.idx.etapa).abertas;
    const fech = L.resumoFechadas(ops, this.idx.etapa, per.de, per.ate);
    const risco = L.emRisco(ops, this.idx.etapa, this.d.tarefas, hoje);
    const rotuloPer = { ano: 'este ano', '12m': 'últimos 12 meses', trimestre: 'este trimestre', todo: 'desde sempre' }[f.periodo];
    const kpi = (n, t) => `<div class="crm-kpi"><b>${n}</b><span>${t}</span></div>`;
    const kpis = `<div class="crm-kpis">
      ${kpi(abertas.n, 'em curso')}${kpi(this.euro(abertas.valor), 'valor em curso')}${kpi(this.euro(abertas.ponderado), 'valor ponderado')}
      ${kpi(`${fech.ganhas.n} · ${this.euro(fech.ganhas.valor)}`, 'ganhas, ' + rotuloPer)}${kpi(`${fech.perdidas.n} · ${this.euro(fech.perdidas.valor)}`, 'perdidas, ' + rotuloPer)}
      ${kpi(fech.conversao === null ? '—' : Math.round(fech.conversao * 100) + '%', 'conversão, ' + rotuloPer)}
      ${kpi(risco.length, 'a precisar de atenção')}${kpi(L.ganhasSemProjeto(ops, this.idx.etapa).length, 'ganhas sem projeto')}</div>`;
    const barra = `<div class="filters crm-barra">
      <label class="zoom-label">Tipo <select data-crm-filtro="dash.tipoId"><option value="">Todos</option>${this.opcoes(tipos, f.tipoId, t => t.nome)}</select></label>
      <label class="zoom-label">Período (ganhas/perdidas) <select data-crm-filtro="dash.periodo">${[['ano', 'Este ano'], ['12m', 'Últimos 12 meses'], ['trimestre', 'Este trimestre'], ['todo', 'Desde sempre']].map(([k, v]) => `<option value="${k}"${f.periodo === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="zoom-label">Responsável <select data-crm-filtro="dash.resp"><option value="todos"${f.resp === 'todos' ? ' selected' : ''}>Todos</option><option value="meus"${f.resp === 'meus' ? ' selected' : ''}>As minhas</option></select></label>
    </div>`;

    // Funil em curso, por etapa — um gráfico por tipo (cada tipo tem as suas etapas).
    const tiposAMostrar = f.tipoId ? tipos.filter(t => t.id === f.tipoId) : tipos;
    const funis = tiposAMostrar.map(t => {
      const linhas = L.pipelinePorEtapa(ops.filter(o => o.tipo_id === t.id), L.etapasDoTipo(this.d.etapas, t.id))
        .map(p => ({ rotulo: `${p.etapa.nome} (${Math.round(p.etapa.probabilidade)}%)`, valor: p.ponderado, valor2: p.valor, texto: `${p.n} · ${this.euro(p.valor)} → ${this.euro(p.ponderado)}` }));
      return `<h4 class="crm-h">${escapeHtml(t.nome)}</h4>${this.htmlBarras(linhas, 'Sem etapas.')}`;
    }).join('');

    const prev = L.previsaoPorMes(ops, this.idx.etapa, hoje);
    const linhasPrev = prev.meses.map(m => ({ rotulo: this.rotuloMes(m.mes), valor: m.ponderado, valor2: m.valor, texto: `${m.n} · ${this.euro(m.valor)} → ${this.euro(m.ponderado)}` }));
    if (prev.atrasadas.n) linhasPrev.unshift({ rotulo: 'Data ultrapassada', valor: prev.atrasadas.ponderado, valor2: prev.atrasadas.valor, texto: `${prev.atrasadas.n} · ${this.euro(prev.atrasadas.valor)} → ${this.euro(prev.atrasadas.ponderado)}`, cor: 'var(--vermelho)' });
    if (prev.semData.n) linhasPrev.push({ rotulo: 'Sem data', valor: prev.semData.ponderado, valor2: prev.semData.valor, texto: `${prev.semData.n} · ${this.euro(prev.semData.valor)} → ${this.euro(prev.semData.ponderado)}`, cor: 'var(--cinza-500)' });

    const porMes = L.fechadasPorMes(ops, this.idx.etapa, per.de, per.ate);
    const linhasFech = porMes.flatMap(m => [
      { rotulo: `${this.rotuloMes(m.mes)} ganhas`, valor: m.ganhas.valor, texto: `${m.ganhas.n} · ${this.euro(m.ganhas.valor)}`, cor: 'var(--verde)' },
      { rotulo: `${this.rotuloMes(m.mes)} perdidas`, valor: m.perdidas.valor, texto: `${m.perdidas.n} · ${this.euro(m.perdidas.valor)}`, cor: 'var(--vermelho)' }
    ]);
    const motivos = L.motivosDePerda(ops, this.idx.motivo, this.idx.etapa, per.de, per.ate)
      .map(m => ({ rotulo: m.nome, valor: m.n, texto: `${m.n} · ${this.euro(m.valor)}`, cor: 'var(--vermelho)' }));

    const listaRisco = risco.length ? `<div class="crm-lista">${risco.slice(0, 12).map(({ op, motivos: ms }) => {
      const c = this.idx.conta.get(op.conta_id);
      return `<div class="crm-item crm-item-linha crm-linha" data-crm-acao="abrir-op" data-id="${escapeAttr(op.id)}">
        <span class="crm-item-texto"><b>${escapeHtml(op.titulo)}</b> · ${escapeHtml(c ? c.nome : '—')}</span>
        <span class="crm-atrasada">${escapeHtml(ms.join(' · '))}</span><span class="hint">${this.euro(op.valor_estimado)} · ${escapeHtml(this._primeiroNome(op.responsavel_id))}</span></div>`;
    }).join('')}${risco.length > 12 ? `<p class="hint">+ ${risco.length - 12} outras.</p>` : ''}</div>` : this.vazioHtml('Nada a precisar de atenção. 🎉');

    el.innerHTML = `${barra}${kpis}
      <div class="crm-grelha-dash">
        <section class="crm-painel"><h3>Funil em curso <span class="hint">(valor ponderado sobre o total)</span></h3>${funis || this.vazioHtml('Sem tipos.')}</section>
        <section class="crm-painel"><h3>Previsão de fecho <span class="hint">(em curso, por mês previsto)</span></h3>${this.htmlBarras(linhasPrev, 'Nada em curso.')}</section>
        <section class="crm-painel"><h3>Ganhas e perdidas por mês <span class="hint">(${rotuloPer})</span></h3>${this.htmlBarras(linhasFech, 'Ainda sem oportunidades fechadas neste período.')}</section>
        <section class="crm-painel"><h3>Motivos de perda <span class="hint">(${rotuloPer})</span></h3>${this.htmlBarras(motivos, 'Sem perdas neste período.')}</section>
        <section class="crm-painel"><h3>Ganhas sem projeto <span class="hint">(falta passar à execução)</span></h3>${this.htmlGanhasSemProjeto(ops)}</section>
        <section class="crm-painel"><h3>Do ganho à entrega <span class="hint">(faturado vs vendido, ganhas ${rotuloPer})</span></h3>${(() => { const e = this.linhasEntrega(ops, per.de, per.ate); return this.htmlBarras(e.linhas, 'Sem projetos ligados a oportunidades ganhas neste período.') + (e.semPermissao ? `<p class="hint">${e.semPermissao} projeto(s) sem permissão para ver os números.</p>` : ''); })()}</section>
        <section class="crm-painel crm-painel-largo"><h3>A precisar de atenção</h3>${listaRisco}</section>
      </div>`;
  },

  // ============================ Fase 2: cartão no Início ============================
  // HTML do corpo do cartão "Comercial" do Início: as minhas oportunidades em curso e os meus
  // follow-ups mais próximos. As linhas levam à ficha respetiva (ver App.renderDashboard).
  htmlCartaoInicio() {
    if (this.erroCarga) return `<p class="hint">${escapeHtml(this.erroCarga)}</p>`;
    const meu = this.meuRecursoId(), hoje = this.hoje();
    const mais7 = DateUtil.toISO(DateUtil.addDays(DateUtil.parseISO(hoje), 7));
    const ops = this.d.oportunidades.filter(o => o.responsavel_id === meu && CrmLogica.categoriaDe(o, this.idx.etapa) === 'aberta')
      .sort((a, b) => String(a.data_prevista_fecho || '9999').localeCompare(String(b.data_prevista_fecho || '9999')));
    const tarefas = this.d.tarefas.filter(t => !t.concluida && t.responsavel_id === meu && (!t.data_limite || t.data_limite <= mais7))
      .sort((a, b) => String(a.data_limite || '9999').localeCompare(String(b.data_limite || '9999')));
    const linhaOp = o => { const c = this.idx.conta.get(o.conta_id), e = this.idx.etapa.get(o.etapa_id); const atr = o.data_prevista_fecho && o.data_prevista_fecho < hoje;
      return `<div class="dash-linha dash-linha-link" data-dash-crm="op|${escapeAttr(o.id)}"><span class="dash-linha-principal">${escapeHtml(o.titulo)}</span>
        <span class="dash-linha-sub">${escapeHtml(c ? c.nome : '—')} · ${escapeHtml(e ? e.nome : '')} · ${this.euro(o.valor_estimado)}${o.data_prevista_fecho ? ` · <span class="${atr ? 'crm-atrasada' : ''}">${this.data(o.data_prevista_fecho)}</span>` : ''}</span></div>`; };
    const linhaT = t => { const atr = t.data_limite && t.data_limite < hoje;
      return `<div class="dash-linha dash-linha-link" data-dash-crm="tarefa|${escapeAttr(t.id)}"><span class="dash-linha-principal">${escapeHtml(t.descricao)}</span>
        <span class="dash-linha-sub"><span class="${atr ? 'crm-atrasada' : ''}">${t.data_limite ? (atr ? '⚠ ' : '') + this.data(t.data_limite) : 'sem data'}</span></span></div>`; };
    return `<p class="dash-sub"><b>Follow-ups</b> (atrasados e próximos 7 dias)</p>${tarefas.length ? tarefas.slice(0, 6).map(linhaT).join('') : '<p class="hint">Nenhum.</p>'}
      <p class="dash-sub" style="margin-top:8px;"><b>As minhas oportunidades em curso</b></p>${ops.length ? ops.slice(0, 5).map(linhaOp).join('') : '<p class="hint">Nenhuma.</p>'}
      ${ops.length > 5 ? `<p class="hint">+ ${ops.length - 5} no separador Oportunidades.</p>` : ''}`;
  },
  // Abre uma ficha a partir de fora do módulo (cartão do Início): vai ao separador e abre-a quando os
  // dados estiverem carregados.
  async irPara(tipo, id) {
    App.irParaAba(tipo === 'tarefa' ? 'crmFollowups' : 'crmOportunidades');
    try { await this.carregar(); } catch (e) { return; }
    if (tipo === 'tarefa') this.abrirTarefa(id); else this.abrirOportunidade(id);
  },

  // ============================ Fase 3: cruzamento com projetos ============================
  // Resumo de um projeto para o CRM. As horas e a faturação só se mostram a quem já as vê na app
  // (Administrador, gestor, consultor ou diretor do departamento do projeto — App.estouEnvolvidoEm): ter acesso
  // ao Comercial não dá acesso aos números internos dos projetos. Sem margem/custos, de propósito.
  resumoProjeto(p) {
    if (!App.estouEnvolvidoEm(p.id)) return { projeto: p, visivel: false };
    const orc = App.avaliarOrcamentoProjeto(p), prazo = App.avaliarPrazoProjeto(p);
    return {
      projeto: p, visivel: true, valorVendido: p.valorVendido || 0, horasVendidas: p.horasVendidas || 0, horasReais: orc.totalReal,
      eac: orc.eac, saldo: orc.saldoDisponivel, nivelHoras: orc.nivel, motivoHoras: orc.motivo,
      faturado: App.totalFaturadoProjeto(p), sobreFaturado: App.projetoSobreFaturado(p), prazo
    };
  },
  rotuloProjeto(p) { return `${p.idInterno ? p.idInterno + ' — ' : ''}${p.nome}${p.cliente ? ` (${p.cliente})` : ''}`; },
  horasFmt(h) { return `${(Math.round((Number(h) || 0) * 10) / 10).toLocaleString('pt-PT')}h`; },
  htmlNumerosProjeto(r) {
    if (!r.visivel) return '<p class="hint">Sem permissão para ver as horas e a faturação deste projeto.</p>';
    const kpi = (n, t, cor) => `<div class="crm-kpi"><b${cor ? ` style="color:${cor}"` : ''}>${n}</b><span>${t}</span></div>`;
    const cor = { verde: 'var(--verde)', amarelo: 'var(--amarelo)', vermelho: 'var(--vermelho)' };
    const horas = r.horasVendidas ? `${this.horasFmt(r.horasReais)} de ${this.horasFmt(r.horasVendidas)} (${Math.round(r.horasReais / r.horasVendidas * 100)}%)` : this.horasFmt(r.horasReais);
    const fat = r.valorVendido ? `${this.euro(r.faturado)} de ${this.euro(r.valorVendido)} (${Math.round(r.faturado / r.valorVendido * 100)}%)` : this.euro(r.faturado);
    return `<div class="crm-kpis">
      ${kpi(horas, 'horas reais' + (r.horasVendidas ? ' / vendidas' : ''), cor[r.nivelHoras])}
      ${r.horasVendidas ? kpi(this.horasFmt(r.eac), 'reprevisão (EAC)') : ''}
      ${kpi(fat, 'faturado' + (r.valorVendido ? ' / vendido' : ''), r.sobreFaturado ? 'var(--vermelho)' : '')}
      ${kpi(Math.round(r.prazo.progresso || 0) + '%', 'concluído', cor[r.prazo.nivel])}
    </div>${r.motivoHoras && r.nivelHoras !== 'verde' && r.nivelHoras !== 'neutro' ? `<p class="hint">Horas: ${escapeHtml(r.motivoHoras)}</p>` : ''}${r.prazo.motivo && r.prazo.nivel !== 'verde' && r.prazo.nivel !== 'neutro' ? `<p class="hint">Prazo: ${escapeHtml(r.prazo.motivo)}</p>` : ''}`;
  },
  abrirProjetoNoGantt(id) { App.fecharModal(); App.abrirProjetoNoGantt(id); },

  // Ficha da oportunidade: o projeto ligado (ou a forma de o ligar, se já foi ganha).
  secProjetoDaOp(raiz, opId) {
    const op = this.idx.op.get(opId);
    if (!op) return;
    const p = op.projeto_id && App.state.projetos[op.projeto_id];
    if (p) {
      const r = this.resumoProjeto(p);
      raiz.innerHTML = `<div class="crm-item"><div class="crm-item-linha"><span class="crm-item-texto"><b>${escapeHtml(this.rotuloProjeto(p))}</b></span><span class="crm-badge">${escapeHtml(p.estado || '')}</span></div>
        <p class="hint" style="margin:2px 0 6px;">${this.data(p.dataInicio)} a ${this.data(p.dataFim)}${p.gestorId ? ` · Gestor: ${escapeHtml(App.nomeUtilizador(p.gestorId))}` : ''}</p>${this.htmlNumerosProjeto(r)}</div>
        ${App.possoVerProjeto(p.id) ? '<button type="button" class="btn btn-sm" data-sec-acao="abrir">Abrir no Gantt</button>' : ''}
        <button type="button" class="btn btn-sm btn-danger" data-sec-acao="desligar" title="Só desfaz a ligação — o projeto não é apagado">Desligar</button>`;
      this.ligarAcoes(raiz, {
        abrir: () => this.abrirProjetoNoGantt(p.id),
        desligar: async () => {
          if (!confirm('Desligar este projeto da oportunidade? O projeto não é apagado.')) return;
          try { await this.gravar('oportunidades', Object.assign({}, op, { projeto_id: null })); this.renderAtual(); this.secProjetoDaOp(raiz, opId); } catch (err) { this.avisoErro(err); }
        }
      });
      return;
    }
    const conta = this.idx.conta.get(op.conta_id);
    const s = CrmLogica.sugerirProjetos(op, conta, this.d.propostas, this.d.oportunidades, Object.values(App.state.projetos));
    const ordenar = (l) => l.sort((a, b) => this.rotuloProjeto(a.projeto).localeCompare(this.rotuloProjeto(b.projeto), 'pt'));
    const opt = (x) => `<option value="${escapeAttr(x.projeto.id)}">${escapeHtml(this.rotuloProjeto(x.projeto))}${x.motivo ? ` — ${x.motivo}` : ''}</option>`;
    raiz.innerHTML = `<p class="hint">Esta oportunidade ganha ainda não tem projeto.${this.souAdmin() ? ' Cria-o no botão "Criar projeto" acima, ou liga um que já exista.' : ' O Administrador cria o projeto; se já existe, liga-o aqui.'}</p>
      ${s.sugeridos.length + s.outros.length ? `<div class="crm-inline-form"><select id="opLigarProj"><option value="">Escolhe um projeto existente…</option>${ordenar(s.sugeridos).map(opt).join('')}${s.sugeridos.length && s.outros.length ? '<option disabled>──────────</option>' : ''}${ordenar(s.outros).map(opt).join('')}</select>
        <button type="button" class="btn btn-sm" data-sec-acao="ligar">Ligar</button></div>` : '<p class="hint">Não há projetos livres para ligar.</p>'}`;
    this.ligarAcoes(raiz, {
      ligar: async () => {
        const id = raiz.querySelector('#opLigarProj').value;
        if (!id) { App.toast('Escolhe primeiro o projeto.'); return; }
        try { await this.gravar('oportunidades', Object.assign({}, op, { projeto_id: id })); this.renderAtual(); this.secProjetoDaOp(raiz, opId); } catch (err) { this.avisoErro(err); }
      }
    });
  },

  // Ficha da conta: todos os projetos desta conta, com totais.
  secProjetosDaConta(raiz, contaId) {
    const conta = this.idx.conta.get(contaId);
    if (!conta) return;
    const lista = CrmLogica.projetosDaConta(conta, this.d.oportunidades, Object.values(App.state.projetos));
    if (!lista.length) { raiz.innerHTML = this.vazioHtml('Sem projetos associados (por oportunidade ganha, ou pelo nome do cliente nos projetos).'); return; }
    const resumos = lista.map(x => Object.assign(this.resumoProjeto(x.projeto), { origem: x.origem, op: x.op }));
    const t = CrmLogica.totaisProjetos(resumos);
    const semPerm = t.n - t.nVisiveis;
    const totais = `<p class="hint" style="margin:0 0 6px;"><b>${t.n} projeto(s)</b>${t.nVisiveis ? ` · vendido ${this.euro(t.valorVendido)} · faturado ${this.euro(t.faturado)} · horas ${this.horasFmt(t.horasReais)}${t.horasVendidas ? ` de ${this.horasFmt(t.horasVendidas)}` : ''}` : ''}${semPerm ? ` · ${semPerm} sem permissão para ver os números` : ''}</p>`;
    raiz.innerHTML = `${totais}<div class="crm-lista">${resumos.map(r => {
      const nums = r.visivel ? `${this.euro(r.faturado)} / ${this.euro(r.valorVendido)} · ${this.horasFmt(r.horasReais)}${r.horasVendidas ? ' / ' + this.horasFmt(r.horasVendidas) : ''}` : 'números reservados';
      return `<div class="crm-item crm-item-linha"><span class="crm-item-texto"><b>${escapeHtml(this.rotuloProjeto(r.projeto))}</b> · ${escapeHtml(r.projeto.estado || '')}
        ${r.origem === 'oportunidade' ? `<span class="crm-badge" title="Ligado à oportunidade">via ${escapeHtml(r.op.titulo)}</span>` : '<span class="crm-badge" title="Mesmo cliente, sem oportunidade ligada">pelo cliente</span>'}</span>
        <span class="hint">${nums}</span>${App.possoVerProjeto(r.projeto.id) ? `<button type="button" class="btn btn-sm" data-sec-acao="abrir" data-id="${escapeAttr(r.projeto.id)}">Abrir</button>` : ''}</div>`;
    }).join('')}</div>`;
    this.ligarAcoes(raiz, { abrir: b => this.abrirProjetoNoGantt(b.dataset.id) });
  },

  // Dashboard: ganhas ainda sem projeto, e a entrega (faturado vs vendido) das ganhas já com projeto.
  htmlGanhasSemProjeto(ops) {
    const lista = CrmLogica.ganhasSemProjeto(ops, this.idx.etapa);
    if (!lista.length) return this.vazioHtml('Todas as oportunidades ganhas têm projeto. 👌');
    return `<div class="crm-lista">${lista.slice(0, 10).map(o => {
      const c = this.idx.conta.get(o.conta_id);
      return `<div class="crm-item crm-item-linha crm-linha" data-crm-acao="abrir-op" data-id="${escapeAttr(o.id)}">
        <span class="crm-item-texto"><b>${escapeHtml(o.titulo)}</b> · ${escapeHtml(c ? c.nome : '—')}</span>
        <span class="hint">${this.euro(o.valor_estimado)}${o.data_fecho ? ' · ganha em ' + this.data(o.data_fecho) : ''}</span></div>`;
    }).join('')}${lista.length > 10 ? `<p class="hint">+ ${lista.length - 10} outras.</p>` : ''}</div>`;
  },
  linhasEntrega(ops, de, ate) {
    const ganhas = ops.filter(o => CrmLogica.categoriaDe(o, this.idx.etapa) === 'ganha' && o.projeto_id && App.state.projetos[o.projeto_id] && CrmLogica._dentro(o.data_fecho, de, ate));
    const resumos = ganhas.map(o => this.resumoProjeto(App.state.projetos[o.projeto_id]));
    const visiveis = resumos.filter(r => r.visivel).sort((a, b) => b.valorVendido - a.valorVendido).slice(0, 10);
    return {
      linhas: visiveis.map(r => ({
        rotulo: `${r.projeto.idInterno || ''} ${r.projeto.nome}`.trim(), valor: r.faturado, valor2: r.valorVendido,
        texto: `${this.euro(r.faturado)} de ${this.euro(r.valorVendido)} faturado · ${this.horasFmt(r.horasReais)}${r.horasVendidas ? ' de ' + this.horasFmt(r.horasVendidas) : ''}`
      })),
      semPermissao: resumos.length - resumos.filter(r => r.visivel).length
    };
  },

  // ============================ Fase 2: gravar em lote ============================
  async gravarLote(chave, linhas) {
    const TAM = 200;
    for (let i = 0; i < linhas.length; i += TAM) {
      const parte = linhas.slice(i, i + TAM).map(l => {
        const r = Object.assign({}, l);
        if (!r.id) r.id = crypto.randomUUID();
        if (this.COM_ATUALIZADO_EM.includes(chave)) r.atualizado_em = new Date().toISOString();
        return r;
      });
      const { error } = await supabaseClient.from(this.TABELAS[chave]).upsert(parte);
      if (error) throw error;
    }
  },

  // ============================ Fase 2: importar contas / contactos (Excel ou CSV) ============================
  async lerFicheiro(ficheiro) {
    const buf = await ficheiro.arrayBuffer();
    if (/\.(csv|txt)$/i.test(ficheiro.name)) {
      let texto;
      try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { texto = new TextDecoder('windows-1252').decode(buf); }
      return { folhas: [{ nome: ficheiro.name, matriz: CrmLogica.parseCsv(texto) }] };
    }
    if (typeof XLSX === 'undefined') await App.carregarScript('lib/xlsx.full.min.js');
    const wb = XLSX.read(buf, { type: 'array' });
    return { folhas: wb.SheetNames.map(n => ({ nome: n, matriz: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).filter(l => l.some(c => String(c).trim() !== '')) })) };
  },
  abrirImportacao(tipo) {
    const nomes = { contas: ['Importar contas', 'conta'], contactos: ['Importar contactos', 'contacto'], oportunidades: ['Importar oportunidades', 'oportunidade'] }[tipo];
    this.abrir(nomes[0], `
      <p class="hint" style="margin:0 0 8px;">Escolhe um ficheiro Excel (.xlsx/.xls) ou CSV com <b>uma linha de cabeçalho</b> e uma linha por ${nomes[1]}. Podes exportar do teu CRM atual (ex.: SuiteCRM). A seguir associas as colunas aos campos e vês uma pré-visualização — <b>nada é gravado até confirmares</b>.</p>
      <label>Ficheiro <input type="file" id="impFicheiro" accept=".xlsx,.xls,.csv,.txt"></label>
      <div id="impPasso"></div>`, true);
    const m = this.corpo();
    m.querySelector('#impFicheiro').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const passo = m.querySelector('#impPasso');
      passo.innerHTML = this.vazioHtml('A ler o ficheiro…');
      try {
        const lido = await this.lerFicheiro(f);
        const folhas = lido.folhas.filter(x => x.matriz.length > 1);
        if (!folhas.length) { passo.innerHTML = '<p class="hint" style="color:var(--vermelho);">O ficheiro não tem linhas de dados (só o cabeçalho, ou está vazio).</p>'; return; }
        this.passoMapeamento(passo, tipo, folhas);
      } catch (err) { console.error(err); passo.innerHTML = `<p class="hint" style="color:var(--vermelho);">Não consegui ler o ficheiro: ${escapeHtml(err.message || err)}</p>`; }
    });
  },
  passoMapeamento(raiz, tipo, folhas) {
    const ehConta = tipo === 'contas', ehOp = tipo === 'oportunidades';
    const campos = ehConta ? CrmLogica.CAMPOS_CONTA : ehOp ? CrmLogica.CAMPOS_OPORTUNIDADE : CrmLogica.CAMPOS_CONTACTO;
    let folha = folhas[0];
    const desenhar = () => {
      const cab = folha.matriz[0].map(c => String(c));
      const mapa = CrmLogica.autoMapear(cab, campos);
      const opcoesCol = sel => `<option value="-1">— não importar —</option>${cab.map((c, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${escapeHtml(c || `(coluna ${i + 1})`)}</option>`).join('')}`;
      raiz.innerHTML = `
        ${folhas.length > 1 ? `<label>Folha <select id="impFolha">${folhas.map((f, i) => `<option value="${i}"${f === folha ? ' selected' : ''}>${escapeHtml(f.nome)} (${f.matriz.length - 1} linhas)</option>`).join('')}</select></label>` : `<p class="hint">${folha.matriz.length - 1} linhas de dados.</p>`}
        <h4 class="crm-h">Associar colunas</h4>
        <div class="crm-mapa">${campos.map(c => `<label>${escapeHtml(c.rotulo)}${c.obrig ? ' <span style="color:var(--vermelho);">*</span>' : ''}<select data-imp-campo="${c.k}">${opcoesCol(mapa[c.k])}</select></label>`).join('')}</div>
        ${ehConta
          ? `<label style="margin-top:8px;">Estado das contas sem essa informação <select id="impEstado"><option value="prospeto">Prospeto</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>`
          : `<label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" id="impCriarContas" checked> Criar a conta quando ainda não existir</label>`}
        ${ehOp ? `<label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="impFollowups" checked> Criar um follow-up (sem data) com o "Próximo passo", nas oportunidades em curso</label>
          <label style="margin-top:4px;">Formato das datas <select id="impFormatoData"><option value="auto">Detetar automaticamente</option><option value="mdy">Mês/Dia/Ano (SuiteCRM em inglês)</option><option value="dmy">Dia/Mês/Ano</option><option value="ymd">Ano-Mês-Dia</option></select></label>` : ''}
        <div class="crm-acoes-form"><button class="btn btn-primary" id="impPrever">Pré-visualizar</button></div>
        <div id="impPrevia"></div>`;
      const fsel = raiz.querySelector('#impFolha');
      if (fsel) fsel.addEventListener('change', () => { folha = folhas[Number(fsel.value)]; desenhar(); });
      raiz.querySelector('#impPrever').addEventListener('click', () => {
        const mp = {};
        raiz.querySelectorAll('[data-imp-campo]').forEach(s => { mp[s.dataset.impCampo] = Number(s.value); });
        const faltam = campos.filter(c => c.obrig && mp[c.k] < 0);
        if (faltam.length) { raiz.querySelector('#impPrevia').innerHTML = `<p class="hint" style="color:var(--vermelho);">Associa pelo menos: ${faltam.map(c => escapeHtml(c.rotulo)).join(', ')}.</p>`; return; }
        if (ehConta) this.previaContas(raiz.querySelector('#impPrevia'), folha.matriz, mp, raiz.querySelector('#impEstado').value);
        else if (ehOp) this.previaOportunidades(raiz.querySelector('#impPrevia'), folha.matriz, mp, { criarContas: raiz.querySelector('#impCriarContas').checked, criarFollowups: raiz.querySelector('#impFollowups').checked, formatoData: raiz.querySelector('#impFormatoData').value });
        else this.previaContactos(raiz.querySelector('#impPrevia'), folha.matriz, mp, raiz.querySelector('#impCriarContas').checked);
      });
    };
    desenhar();
  },
  // ---------- Importar oportunidades (ex.: exportação do SuiteCRM) ----------
  // O passo de mapeamento é o mesmo das contas/contactos; aqui acrescentam-se as opções específicas e
  // duas tabelas de correspondência (tipo do ficheiro → tipo novo; etapa do ficheiro → etapa nova) já
  // com sugestão automática, que o utilizador pode corrigir antes de confirmar.
  previaOportunidades(raiz, matriz, mapa, opts) {
    const D = this.d;
    const tiposAtivos = D.tipos.filter(t => t.ativo !== false);
    const formato = opts.formatoData === 'auto' ? CrmLogica.detectarFormatoData(matriz.slice(1).map(l => CrmLogica._cel(l, mapa.fecho))) : opts.formatoData;
    const comb = CrmLogica.combinacoesOportunidades(matriz, mapa, D.tipos, D.etapas, formato);
    const mapaTipos = {}, mapaEtapas = {}, motivoPadrao = {};
    const sugerirEtapa = (e, tipoId) => (CrmLogica.mapearEtapa(e.texto, e.prob, CrmLogica.etapasDoTipo(D.etapas, tipoId, true)) || {}).id || '';
    comb.tipos.forEach(t => { mapaTipos[t.texto] = t.tipoId || ''; });
    const reSugerir = (textoTipo) => comb.etapas.filter(e => e.tipoTexto === textoTipo).forEach(e => { mapaEtapas[e.tipoTexto + '|' + e.texto] = mapaTipos[textoTipo] ? sugerirEtapa(e, mapaTipos[textoTipo]) : ''; });
    comb.tipos.forEach(t => reSugerir(t.texto));
    const rotuloTxt = s => s || '(vazio)';
    raiz.innerHTML = `
      <h4 class="crm-h">Correspondência com o funil</h4>
      <p class="hint" style="margin:0 0 6px;">Confirma como cada tipo e cada etapa do ficheiro passam para o novo funil (já vão sugeridos).</p>
      <div id="impCorresp"></div>
      <div id="impResultado"></div>`;
    const desenharCorresp = () => {
      const optTipos = sel => `<option value="">— sem correspondência —</option>${tiposAtivos.map(t => `<option value="${escapeAttr(t.id)}"${t.id === sel ? ' selected' : ''}>${escapeHtml(t.nome)}</option>`).join('')}`;
      const optEtapas = (tipoId, sel) => `<option value="">— sem correspondência —</option>${CrmLogica.etapasDoTipo(D.etapas, tipoId, true).map(e => `<option value="${escapeAttr(e.id)}"${e.id === sel ? ' selected' : ''}>${escapeHtml(e.nome)} (${e.categoria === 'ganha' ? 'ganha' : e.categoria === 'perdida' ? 'perdida' : e.probabilidade + '%'})</option>`).join('')}`;
      const temPerdida = comb.etapas.some(e => { const et = this.idx.etapa.get(mapaEtapas[e.tipoTexto + '|' + e.texto]); return et && et.categoria === 'perdida'; });
      raiz.querySelector('#impCorresp').innerHTML = `
        <div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Tipo no ficheiro</th><th></th><th>Tipo na app</th></tr></thead><tbody>
          ${comb.tipos.map((t, i) => `<tr><td>${escapeHtml(rotuloTxt(t.texto))}</td><td class="hint">${t.n}×</td><td><select data-imp-tipo="${i}">${optTipos(mapaTipos[t.texto])}</select></td></tr>`).join('')}
        </tbody></table></div>
        <div class="table-scroll" style="margin-top:8px;"><table class="tabela-crud"><thead><tr><th>Tipo</th><th>Etapa no ficheiro</th><th></th><th>Etapa na app</th></tr></thead><tbody>
          ${comb.etapas.map((e, i) => `<tr><td>${escapeHtml(rotuloTxt(e.tipoTexto))}</td><td>${escapeHtml(rotuloTxt(e.texto))}${e.prob !== '' ? ` <span class="hint">(${escapeHtml(e.prob)}%)</span>` : ''}</td><td class="hint">${e.n}×</td><td><select data-imp-etapa="${i}"${mapaTipos[e.tipoTexto] ? '' : ' disabled'}>${optEtapas(mapaTipos[e.tipoTexto], mapaEtapas[e.tipoTexto + '|' + e.texto])}</select></td></tr>`).join('')}
        </tbody></table></div>
        ${temPerdida ? `<div style="margin-top:8px;"><b>Motivo de perda para as oportunidades perdidas</b> <span class="hint">(o ficheiro antigo não o indica; podes deixar em branco e preencher depois)</span>
          ${comb.tipos.filter(t => mapaTipos[t.texto]).map(t => `<label>${escapeHtml(this.idx.tipo.get(mapaTipos[t.texto]).nome)} <select data-imp-motivo="${escapeAttr(mapaTipos[t.texto])}"><option value="">— em branco —</option>${D.motivos.filter(m => m.tipo_id === mapaTipos[t.texto] && m.ativo !== false).map(m => `<option value="${escapeAttr(m.id)}"${motivoPadrao[mapaTipos[t.texto]] === m.id ? ' selected' : ''}>${escapeHtml(m.nome)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}`;
      raiz.querySelectorAll('[data-imp-tipo]').forEach(s => s.addEventListener('change', () => {
        const t = comb.tipos[Number(s.dataset.impTipo)];
        mapaTipos[t.texto] = s.value; reSugerir(t.texto); desenharCorresp(); desenharResultado();
      }));
      raiz.querySelectorAll('[data-imp-etapa]').forEach(s => s.addEventListener('change', () => {
        const e = comb.etapas[Number(s.dataset.impEtapa)];
        mapaEtapas[e.tipoTexto + '|' + e.texto] = s.value; desenharResultado();
      }));
      raiz.querySelectorAll('[data-imp-motivo]').forEach(s => s.addEventListener('change', () => { motivoPadrao[s.dataset.impMotivo] = s.value || null; desenharResultado(); }));
    };
    const desenharResultado = () => {
      const alvo = raiz.querySelector('#impResultado');
      const r = CrmLogica.prepararOportunidades(matriz, mapa, {
        contas: D.contas, oportunidades: D.oportunidades, tipos: D.tipos, etapas: D.etapas,
        recursos: App.state.recursos, projetos: Object.values(App.state.projetos)
      }, { formatoData: formato, criarContas: opts.criarContas, criarFollowups: opts.criarFollowups, mapaTipos, mapaEtapas, motivoPadrao });
      const nomeEtapa = id => (this.idx.etapa.get(id) || {}).nome || '—';
      alvo.innerHTML = `<h4 class="crm-h">Pré-visualização</h4>
        <div class="crm-kpis"><div class="crm-kpi"><b>${r.novas.length}</b><span>oportunidades a criar</span></div><div class="crm-kpi"><b>${r.contasACriar.length}</b><span>contas novas a criar</span></div><div class="crm-kpi"><b>${r.followups}</b><span>follow-ups a criar</span></div><div class="crm-kpi"><b>${r.duplicadas.length}</b><span>duplicadas (ignoradas)</span></div><div class="crm-kpi"><b>${r.semConta.length + r.invalidas.length}</b><span>ignoradas por problemas</span></div></div>
        ${r.novas.length ? `<div class="table-scroll" style="max-height:220px;"><table class="tabela-crud"><thead><tr><th>Oportunidade</th><th>Conta</th><th>Etapa</th><th>Valor</th><th>Fecho</th></tr></thead><tbody>${r.novas.slice(0, 8).map(o => `<tr><td>${escapeHtml(o.titulo)}</td><td>${escapeHtml(o.conta_id ? (this.idx.conta.get(o.conta_id) || {}).nome : o.conta_ref.nome + ' (nova)')}</td><td>${escapeHtml(nomeEtapa(o.etapa_id))}</td><td>${escapeHtml(this.euro(o.valor_estimado))}</td><td>${escapeHtml(o.data_prevista_fecho || '—')}</td></tr>`).join('')}</tbody></table></div>${r.novas.length > 8 ? `<p class="hint">Amostra das primeiras 8 de ${r.novas.length}.</p>` : ''}` : ''}
        ${this.htmlProblemas('Sem conta correspondente', r.semConta, d => `Linha ${d.linha}: ${d.titulo} (conta "${d.conta}" não existe)`)}
        ${this.htmlProblemas('Duplicadas', r.duplicadas, d => `Linha ${d.linha}: ${d.titulo}`)}
        ${this.htmlProblemas('Avisos', r.avisos, d => `Linha ${d.linha}: ${d.motivo}`)}
        ${this.htmlProblemas('Inválidas', r.invalidas, d => `Linha ${d.linha}: ${d.motivo}`)}
        <div class="crm-acoes-form"><button class="btn btn-primary" id="impConfirmar"${r.novas.length ? '' : ' disabled'}>Importar ${r.novas.length} oportunidades</button></div>`;
      const b = alvo.querySelector('#impConfirmar');
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'A importar…';
        try {
          const novasContas = r.contasACriar.map(c => Object.assign({ id: crypto.randomUUID(), setor: '', dimensao: '', morada: '', website: '', estado: 'prospeto', notas: '', responsavel_id: null }, c));
          const idConta = new Map(r.contasACriar.map((c, i) => [c, novasContas[i].id]));
          if (novasContas.length) await this.gravarLote('contas', novasContas);
          const ops = r.novas.map(o => Object.assign({ id: crypto.randomUUID(), contacto_id: null, motivo_perda_notas: '' }, o, { conta_id: o.conta_id || idConta.get(o.conta_ref) }));
          const tarefas = ops.filter(o => o.followup).map(o => ({ conta_id: o.conta_id, oportunidade_id: o.id, descricao: o.followup, responsavel_id: o.responsavel_id, data_limite: null, concluida: false, concluida_em: null }));
          await this.gravarLote('oportunidades', ops.map(o => { const l = Object.assign({}, o); delete l.conta_ref; delete l.followup; return l; }));
          if (tarefas.length) await this.gravarLote('tarefas', tarefas);
          await this.carregar(true);
          App.fecharModal(); this.renderAtual();
          App.toast(`${ops.length} oportunidades importadas${novasContas.length ? ` (e ${novasContas.length} contas criadas)` : ''}.`);
        } catch (err) { this.avisoErro(err); b.disabled = false; b.textContent = `Importar ${r.novas.length} oportunidades`; }
      });
    };
    desenharCorresp();
    desenharResultado();
  },

  htmlProblemas(titulo, itens, texto) {
    if (!itens.length) return '';
    return `<details class="crm-problemas"><summary>${titulo} (${itens.length})</summary><ul>${itens.slice(0, 15).map(i => `<li>${escapeHtml(texto(i))}</li>`).join('')}${itens.length > 15 ? `<li>… e mais ${itens.length - 15}.</li>` : ''}</ul></details>`;
  },
  previaContas(raiz, matriz, mapa, estadoPadrao) {
    const r = CrmLogica.prepararContas(matriz, mapa, this.d.contas, { estadoPadrao, recursos: App.state.recursos });
    raiz.innerHTML = `<div class="crm-kpis"><div class="crm-kpi"><b>${r.novas.length}</b><span>contas a criar</span></div><div class="crm-kpi"><b>${r.duplicadas.length}</b><span>duplicadas (ignoradas)</span></div><div class="crm-kpi"><b>${r.invalidas.length}</b><span>inválidas</span></div></div>
      ${r.novas.length ? `<div class="table-scroll" style="max-height:200px;"><table class="tabela-crud"><thead><tr><th>Nome</th><th>NIF</th><th>Setor</th><th>Estado</th></tr></thead><tbody>${r.novas.slice(0, 8).map(c => `<tr><td>${escapeHtml(c.nome)}</td><td>${escapeHtml(c.nif || '—')}</td><td>${escapeHtml(c.setor || '—')}</td><td>${this.ESTADOS_CONTA[c.estado]}</td></tr>`).join('')}</tbody></table></div>${r.novas.length > 8 ? `<p class="hint">Amostra das primeiras 8 de ${r.novas.length}.</p>` : ''}` : ''}
      ${this.htmlProblemas('Duplicadas', r.duplicadas, d => `Linha ${d.linha}: "${d.nome}" já existe como "${d.com}"${d.noFicheiro ? ' (repetida no ficheiro)' : ''}`)}
      ${this.htmlProblemas('Inválidas', r.invalidas, d => `Linha ${d.linha}: ${d.motivo}`)}
      <div class="crm-acoes-form"><button class="btn btn-primary" id="impConfirmar"${r.novas.length ? '' : ' disabled'}>Importar ${r.novas.length} contas</button></div>`;
    const b = raiz.querySelector('#impConfirmar');
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'A importar…';
      try {
        await this.gravarLote('contas', r.novas);
        await this.carregar(true);
        App.fecharModal(); this.renderAtual();
        App.toast(`${r.novas.length} contas importadas.`);
      } catch (err) { this.avisoErro(err); b.disabled = false; b.textContent = `Importar ${r.novas.length} contas`; }
    });
  },
  previaContactos(raiz, matriz, mapa, criarContas) {
    const r = CrmLogica.prepararContactos(matriz, mapa, this.d.contas, this.d.contactos, { criarContas });
    raiz.innerHTML = `<div class="crm-kpis"><div class="crm-kpi"><b>${r.novos.length}</b><span>contactos a criar</span></div><div class="crm-kpi"><b>${r.contasACriar.length}</b><span>contas novas a criar</span></div><div class="crm-kpi"><b>${r.duplicados.length}</b><span>duplicados (ignorados)</span></div><div class="crm-kpi"><b>${r.semConta.length}</b><span>sem conta (ignorados)</span></div></div>
      ${r.novos.length ? `<div class="table-scroll" style="max-height:200px;"><table class="tabela-crud"><thead><tr><th>Contacto</th><th>Conta</th><th>Cargo</th><th>Email</th></tr></thead><tbody>${r.novos.slice(0, 8).map(c => `<tr><td>${escapeHtml(c.nome)}</td><td>${escapeHtml(c.conta_id ? (this.idx.conta.get(c.conta_id) || {}).nome : c.conta_ref.nome + ' (nova)')}</td><td>${escapeHtml(c.cargo || '—')}</td><td>${escapeHtml(c.email || '—')}</td></tr>`).join('')}</tbody></table></div>${r.novos.length > 8 ? `<p class="hint">Amostra dos primeiros 8 de ${r.novos.length}.</p>` : ''}` : ''}
      ${this.htmlProblemas('Sem conta correspondente', r.semConta, d => `Linha ${d.linha}: ${d.nome}${d.conta ? ` (conta "${d.conta}" não existe)` : ' (sem empresa indicada)'}`)}
      ${this.htmlProblemas('Duplicados', r.duplicados, d => `Linha ${d.linha}: ${d.nome}`)}
      ${this.htmlProblemas('Avisos', r.avisos, d => `Linha ${d.linha}: ${d.motivo}`)}
      ${this.htmlProblemas('Inválidos', r.invalidos, d => `Linha ${d.linha}: ${d.motivo}`)}
      <div class="crm-acoes-form"><button class="btn btn-primary" id="impConfirmar"${r.novos.length ? '' : ' disabled'}>Importar ${r.novos.length} contactos</button></div>`;
    const b = raiz.querySelector('#impConfirmar');
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'A importar…';
      try {
        const novasContas = r.contasACriar.map(c => Object.assign({ id: crypto.randomUUID(), setor: '', dimensao: '', morada: '', website: '', estado: 'prospeto', notas: '', responsavel_id: null }, c));
        const idDe = new Map(r.contasACriar.map((c, i) => [c, novasContas[i].id]));
        if (novasContas.length) await this.gravarLote('contas', novasContas);
        await this.gravarLote('contactos', r.novos.map(c => ({
          conta_id: c.conta_id || idDe.get(c.conta_ref), nome: c.nome, cargo: c.cargo, email: c.email, telefone: c.telefone,
          papel_decisao: c.papel_decisao, notas: c.notas, consentimento_rgpd: false, consentimento_data: null
        })));
        await this.carregar(true);
        App.fecharModal(); this.renderAtual();
        App.toast(`${r.novos.length} contactos importados${novasContas.length ? ` (e ${novasContas.length} contas criadas)` : ''}.`);
      } catch (err) { this.avisoErro(err); b.disabled = false; b.textContent = `Importar ${r.novos.length} contactos`; }
    });
  },

  // ============================ Fase 2: contas a partir dos projetos ============================
  abrirContasDosProjetos() {
    const lista = CrmLogica.clientesDosProjetos(Object.values(App.state.projetos), this.d.contas);
    if (!lista.length) { App.toast('Todos os clientes dos projetos já têm conta no CRM.'); return; }
    this.abrir('Criar contas a partir dos projetos', `
      <p class="hint" style="margin:0 0 8px;">Clientes que aparecem nos projetos e ainda não têm conta. Desmarca os que não queiras criar. Ficam como contas <b>Ativas</b>, sem NIF nem contactos (completas depois). Grafias diferentes do mesmo cliente já vêm juntas.</p>
      <div class="crm-lista" style="max-height:48vh;overflow:auto;">${lista.map((c, i) => `<label class="crm-item crm-item-linha"><input type="checkbox" data-cli="${i}" checked><span class="crm-item-texto">${escapeHtml(c.nome)}</span><span class="hint">${c.projetos} projeto(s)</span></label>`).join('')}</div>
      <div class="crm-acoes-form"><button class="btn btn-primary" id="cliCriar">Criar contas</button></div>`, true);
    const m = this.corpo();
    m.querySelector('#cliCriar').addEventListener('click', async (ev) => {
      const escolhidos = [...m.querySelectorAll('[data-cli]')].filter(c => c.checked).map(c => lista[Number(c.dataset.cli)]);
      if (!escolhidos.length) { App.fecharModal(); return; }
      ev.target.disabled = true; ev.target.textContent = 'A criar…';
      try {
        await this.gravarLote('contas', escolhidos.map(c => ({ nome: c.nome, nif: '', setor: '', dimensao: '', morada: '', website: '', estado: 'ativo', responsavel_id: null, notas: 'Criada a partir dos projetos.' })));
        await this.carregar(true);
        App.fecharModal(); this.renderAtual();
        App.toast(`${escolhidos.length} contas criadas.`);
      } catch (err) { this.avisoErro(err); ev.target.disabled = false; ev.target.textContent = 'Criar contas'; }
    });
  },

  // ============================ Fase 2: duplicados e fusão de contas ============================
  contagensConta(id) {
    return { contactos: this.d.contactos.filter(c => c.conta_id === id).length, oportunidades: this.d.oportunidades.filter(o => o.conta_id === id).length,
      interacoes: this.d.interacoes.filter(i => i.conta_id === id).length, tarefas: this.d.tarefas.filter(t => t.conta_id === id).length };
  },
  abrirDuplicados() {
    const grupos = CrmLogica.gruposDuplicados(this.d.contas);
    if (!grupos.length) { App.toast('Não há contas duplicadas.'); return; }
    this.abrir('Contas duplicadas', `
      <p class="hint" style="margin:0 0 8px;">Contas com o mesmo NIF ou o mesmo nome. Escolhe a que fica (por omissão a mais antiga) e funde: os contactos, oportunidades, interações e follow-ups das outras passam para ela, e as outras são eliminadas. Os campos vazios da conta que fica são preenchidos com os das outras. <b>Não se pode desfazer.</b></p>
      ${grupos.map((g, gi) => `<section class="crm-funil-tipo" data-grupo="${gi}">
        ${g.map((c, i) => { const n = this.contagensConta(c.id); return `<label class="crm-item crm-item-linha"><input type="radio" name="manter${gi}" value="${escapeAttr(c.id)}"${i === 0 ? ' checked' : ''}>
          <span class="crm-item-texto"><b>${escapeHtml(c.nome)}</b> · ${escapeHtml(c.nif || 'sem NIF')}</span><span class="hint">${n.contactos} contactos · ${n.oportunidades} oportunidades · ${n.interacoes} interações · ${n.tarefas} follow-ups</span></label>`; }).join('')}
        <div class="crm-acoes-form"><button class="btn btn-primary btn-sm" data-fundir="${gi}">Fundir este grupo</button></div></section>`).join('')}`, true);
    const m = this.corpo();
    m.querySelectorAll('[data-fundir]').forEach(b => b.addEventListener('click', async () => {
      const gi = Number(b.dataset.fundir), g = grupos[gi];
      const manter = m.querySelector(`input[name="manter${gi}"]:checked`).value;
      const outras = g.filter(c => c.id !== manter);
      if (!confirm(`Fundir ${outras.length} conta(s) em "${this.idx.conta.get(manter).nome}"? Não se pode desfazer.`)) return;
      b.disabled = true; b.textContent = 'A fundir…';
      try {
        await this.fundirContas(manter, outras.map(c => c.id));
        App.toast('Contas fundidas.');
        this.renderAtual();
        if (CrmLogica.gruposDuplicados(this.d.contas).length) this.abrirDuplicados(); else App.fecharModal();
      } catch (err) { this.avisoErro(err); b.disabled = false; b.textContent = 'Fundir este grupo'; }
    }));
  },
  // Passa tudo o que depende das contas "outras" para a conta "manter" e só depois as elimina — se um
  // passo falhar a meio, nada foi apagado ainda (voltar a tentar é seguro).
  async fundirContas(manterId, outrasIds) {
    const manter = this.idx.conta.get(manterId);
    for (const outraId of outrasIds) {
      for (const tabela of ['contactos', 'oportunidades', 'interacoes', 'tarefas']) {
        const { error } = await supabaseClient.from(this.TABELAS[tabela]).update({ conta_id: manterId }).eq('conta_id', outraId);
        if (error) throw error;
      }
    }
    const preenchida = Object.assign({}, manter);
    outrasIds.map(id => this.idx.conta.get(id)).forEach(o => ['nif', 'setor', 'dimensao', 'morada', 'website', 'responsavel_id'].forEach(k => { if (!preenchida[k] && o[k]) preenchida[k] = o[k]; }));
    const { error: e1 } = await supabaseClient.from(this.TABELAS.contas).update({ nif: preenchida.nif, setor: preenchida.setor, dimensao: preenchida.dimensao, morada: preenchida.morada, website: preenchida.website, responsavel_id: preenchida.responsavel_id, atualizado_em: new Date().toISOString() }).eq('id', manterId);
    if (e1) throw e1;
    const { error: e2 } = await supabaseClient.from(this.TABELAS.contas).delete().in('id', outrasIds);
    if (e2) throw e2;
    await this.carregar(true);
  },
};
if (typeof module !== 'undefined') module.exports = Crm;

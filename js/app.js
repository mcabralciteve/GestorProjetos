const DateUtil = {
  parseISO(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },
  addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  },
  diffDays(a, b) {
    return Math.round((b - a) / 86400000);
  },
  formatShort(date) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  },
  todayISO() {
    return DateUtil.toISO(new Date());
  },
  formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const data = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${data} ${hora}`;
  },
  timestampCompacto() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
};


const App = {
  STORAGE_KEY: 'gp_state_v2',
  state: { recursos: [], feriados: [], ausencias: [], equipas: [], registos: [], projetos: {}, utilizadores: [], projetoAtivoId: null },
  zoom: 14,
  selecionadaId: null,
  selecionadasIds: new Set(),
  colapsadas: new Set(),
  undoStack: [],
  redoStack: [],
  LIMITE_HISTORICO: 5,
  abaAtiva: 'gantt',
  filtroEquipaCap: '',
  filtrosRegisto: { pessoa: '', projeto: '', de: '', ate: '', texto: '' },
  paginaRegistos: 1,
  TAMANHO_PAGINA_REGISTOS: 20,
  filtrosFaturacao: { projeto: '', de: '', ate: '', numRegisto: '' },
  ordenacaoFaturas: { campo: 'dataPrevista', dir: 'asc' },
  ordenacaoRegistos: { campo: 'data', dir: 'desc' },

  init() {
    this.cacheEls();
    this.capturarEstadoLocalPreLogin();
    this.state = this.estadoVazio();
    this.wireEvents();
    document.addEventListener('auth-mudou', (e) => this.aoMudarSessao(e.detail));
    this.atualizarBotoesHistorico();
  },

  cacheEls() {
    this.els = {
      selProjeto: document.getElementById('selProjeto'),
      projIdInterno: document.getElementById('projIdInterno'),
      projEstado: document.getElementById('projEstado'),
      projNome: document.getElementById('projNome'),
      projCliente: document.getElementById('projCliente'),
      projDescricao: document.getElementById('projDescricao'),
      projInicio: document.getElementById('projInicio'),
      projFim: document.getElementById('projFim'),
      projHorasVendidas: document.getElementById('projHorasVendidas'),
      projValorVendido: document.getElementById('projValorVendido'),
      projValorHoraMedio: document.getElementById('projValorHoraMedio'),
      projVersao: document.getElementById('projVersao'),
      projFaturacaoResumo: document.getElementById('projFaturacaoResumo'),
      projGestorId: document.getElementById('projGestorId'),
      listaConsultoresProjeto: document.getElementById('listaConsultoresProjeto'),
      grupoBtnEquipa: document.getElementById('grupoBtnEquipa'),
      tabBtnFaturacao: document.getElementById('tabBtnFaturacao'),
      tabBtnAcompanhamento: document.getElementById('tabBtnAcompanhamento'),
      acompanhamentoProjetoNome: document.getElementById('acompanhamentoProjetoNome'),
      acompanhamentoSemProjeto: document.getElementById('acompanhamentoSemProjeto'),
      acompanhamentoConteudo: document.getElementById('acompanhamentoConteudo'),
      corpoPontosSituacao: document.getElementById('corpoPontosSituacao'),
      corpoProximosPassos: document.getElementById('corpoProximosPassos'),
      projHorasReais: document.getElementById('projHorasReais'),
      projHorasEAC: document.getElementById('projHorasEAC'),
      projHorasSaldo: document.getElementById('projHorasSaldo'),
      projEstadoOrc: document.getElementById('projEstadoOrc'),
      corpoTabelaTarefas: document.getElementById('corpoTabelaTarefas'),
      corpoTabelaProjetos: document.getElementById('corpoTabelaProjetos'),
      corpoTabelaRecursosCentral: document.getElementById('corpoTabelaRecursosCentral'),
      corpoTabelaEquipas: document.getElementById('corpoTabelaEquipas'),
      corpoTabelaFeriados: document.getElementById('corpoTabelaFeriados'),
      corpoTabelaAusencias: document.getElementById('corpoTabelaAusencias'),
      selEquipaCap: document.getElementById('selEquipaCap'),
      selHorizonteCap: document.getElementById('selHorizonteCap'),
      heatmapCapHead: document.getElementById('heatmapCapHead'),
      heatmapCapBody: document.getElementById('heatmapCapBody'),
      gridCapacidade: document.getElementById('gridCapacidade'),
      statsPortefolio: document.getElementById('statsPortefolio'),
      gridPortefolio: document.getElementById('gridPortefolio'),
      chipsProjetosPortGantt: document.getElementById('chipsProjetosPortGantt'),
      selZoomPortGantt: document.getElementById('selZoomPortGantt'),
      corpoTabelaPortGantt: document.getElementById('corpoTabelaPortGantt'),
      painelTabelaPortGantt: document.getElementById('painelTabelaPortGantt'),
      painelGanttPortfolio: document.getElementById('painelGanttPortfolio'),
      ganttContainerPortfolio: document.getElementById('ganttContainerPortfolio'),
      ganttContainer: document.getElementById('ganttContainer'),
      painelTabela: document.getElementById('painelTabela'),
      painelGantt: document.getElementById('painelGantt'),
      selZoom: document.getElementById('selZoom'),
      zoomLabel: document.getElementById('zoomLabel'),
      zoomLabelPortGantt: document.getElementById('zoomLabelPortGantt'),
      modalBackdrop: document.getElementById('modalBackdrop'),
      modal: document.getElementById('modal'),
      modalTitulo: document.getElementById('modalTitulo'),
      modalCorpo: document.getElementById('modalCorpo'),
      toast: document.getElementById('toast'),
      resizerSidebar: document.getElementById('resizerSidebar'),
      resizerTabela: document.getElementById('resizerTabela'),
      resizerPortGantt: document.getElementById('resizerPortGantt'),
      sidebarGantt: document.getElementById('sidebarGantt'),
      btnToggleSidebar: document.getElementById('btnToggleSidebar'),
      layoutGantt: document.getElementById('layoutGantt'),
      btnDesfazer: document.getElementById('btnDesfazer'),
      btnRefazer: document.getElementById('btnRefazer'),
      formRegisto: document.getElementById('formRegisto'),
      regPessoa: document.getElementById('regPessoa'),
      regData: document.getElementById('regData'),
      regProjeto: document.getElementById('regProjeto'),
      regTarefa: document.getElementById('regTarefa'),
      regHoras: document.getElementById('regHoras'),
      regNotas: document.getElementById('regNotas'),
      regMsg: document.getElementById('regMsg'),
      fRegPessoa: document.getElementById('fRegPessoa'),
      fRegProjeto: document.getElementById('fRegProjeto'),
      fRegDe: document.getElementById('fRegDe'),
      fRegAte: document.getElementById('fRegAte'),
      fRegTexto: document.getElementById('fRegTexto'),
      statsRegisto: document.getElementById('statsRegisto'),
      corpoTabelaRegistos: document.getElementById('corpoTabelaRegistos'),
      paginacaoRegistos: document.getElementById('paginacaoRegistos'),
      statsFaturacao: document.getElementById('statsFaturacao'),
      fFatProjeto: document.getElementById('fFatProjeto'),
      fFatDe: document.getElementById('fFatDe'),
      fFatAte: document.getElementById('fFatAte'),
      fFatNumRegisto: document.getElementById('fFatNumRegisto'),
      corpoTabelaFaturas: document.getElementById('corpoTabelaFaturas')
    };
  },

  // ---------- Persistência ----------
  // Fotografia dos dados que já estavam neste browser em localStorage, tirada logo no arranque —
  // ANTES de qualquer sessão ser resolvida. É a fonte do botão "Carregar dados locais para a
  // nuvem" (Sync.migrarDadosLocais): assim que o login acontece, App.state passa a vir do
  // Supabase, por isso não dá para usar App.state como fonte da migração nessa altura.
  capturarEstadoLocalPreLogin() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (!raw) { this._estadoLocalPreLogin = null; return; }
    const estadoAtual = this.state;
    try {
      this.state = JSON.parse(raw);
      this.normalizarEstado();
      this._estadoLocalPreLogin = this.state;
    } catch (e) {
      this._estadoLocalPreLogin = null;
    } finally {
      this.state = estadoAtual;
    }
  },
  // Chamado sempre que o estado de autenticação muda (evento "auth-mudou", disparado por
  // js/auth.js). Só recarrega tudo numa transição real "sem sessão" → "com sessão" — o Supabase
  // dispara este aviso várias vezes para a MESMA sessão (ao entrar, e depois periodicamente para
  // renovar o token), e recarregar nessas alturas apagaria qualquer edição ainda não guardada.
  async aoMudarSessao(session) {
    const autenticadoAgora = !!session;
    this.usuarioAtualId = autenticadoAgora ? session.user.id : null;
    if (autenticadoAgora && !this.sessaoAtiva) {
      this.sessaoAtiva = true;
      try {
        await Sync.carregarDeSupabase();
      } catch (err) {
        console.error(err);
        this.toast('Erro ao carregar dados da nuvem: ' + err.message);
        this.state = this.estadoVazio();
      }
      // O projeto ativo carregado pode não ser um em que este utilizador esteja envolvido
      // (o Supabase devolve todos os projetos, o filtro por papel é só na interface) — troca para
      // o primeiro projeto acessível, se necessário.
      if (!this.estouEnvolvidoEm(this.state.projetoAtivoId)) {
        const primeiro = this.meusProjetosEnvolvidos()[0];
        this.state.projetoAtivoId = primeiro ? primeiro.id : null;
      }
      this._ultimoEstadoPersistido = JSON.stringify(this.state);
      this.renderProjetoSelect();
      this.renderTudo();
      this.atualizarBotaoMigracao();
    } else if (!autenticadoAgora && this.sessaoAtiva) {
      this.sessaoAtiva = false;
      this.state = this.estadoVazio();
      this.renderProjetoSelect();
      this.renderTudo();
    }
  },
  // Mostra o botão de migração só quando há dados locais por subir e a nuvem ainda não tem nada
  // (evita tentações de o carregar "por engano" depois de já se estar a trabalhar na nuvem).
  atualizarBotaoMigracao() {
    const btn = document.getElementById('btnMigrarDadosLocais');
    if (!btn) return;
    const temDadosLocais = !!(this._estadoLocalPreLogin && (
      this._estadoLocalPreLogin.recursos.length || Object.keys(this._estadoLocalPreLogin.projetos).length
    ));
    const nuvemVazia = !this.state.recursos.length && !Object.keys(this.state.projetos).length;
    btn.style.display = (temDadosLocais && nuvemVazia) ? '' : 'none';
  },
  // Sobe de uma vez todos os dados que já estavam neste browser (localStorage) para o Supabase —
  // pensado para correr uma única vez, logo depois desta funcionalidade ficar disponível.
  async migrarDadosLocais() {
    if (!this._estadoLocalPreLogin) return;
    if (!confirm('Isto vai carregar todos os teus dados locais (projetos, consultores, equipas, etc.) para a base de dados partilhada. Só deves fazer isto uma vez — se já lá estiverem dados mais recentes de outra pessoa, corres o risco de os sobrescrever. Continuar?')) return;
    try {
      await Sync.sincronizarComSupabase(null, JSON.stringify(this._estadoLocalPreLogin));
      await Sync.carregarDeSupabase();
      this._ultimoEstadoPersistido = JSON.stringify(this.state);
      this._estadoLocalPreLogin = null;
      this.renderProjetoSelect();
      this.renderTudo();
      this.atualizarBotaoMigracao();
      this.toast('Dados locais carregados para a nuvem com sucesso.');
    } catch (err) {
      console.error(err);
      this.toast('Erro ao migrar dados locais: ' + err.message);
    }
  },
  // Guarda o estado anterior no histórico de desfazer sempre que uma alteração relevante é
  // persistida — trocar apenas o projeto ativo não conta como ação, para não gastar as ~5
  // posições do histórico só de navegação entre projetos.
  persist() {
    const atual = JSON.stringify(this.state);
    const anterior = this._ultimoEstadoPersistido;
    if (anterior !== undefined && this._mudancaRelevante(anterior, atual)) {
      this.undoStack.push(anterior);
      if (this.undoStack.length > this.LIMITE_HISTORICO) this.undoStack.shift();
      this.redoStack = [];
    }
    localStorage.setItem(this.STORAGE_KEY, atual);
    this._ultimoEstadoPersistido = atual;
    this.atualizarBotoesHistorico();
    this.sincronizarEmSegundoPlano(anterior, atual);
  },
  // Dispara a sincronização com o Supabase sem bloquear a interface — a app tem de continuar a
  // responder de imediato mesmo em ligações lentas ou sem rede; erros aparecem como aviso, nunca
  // travam a ação local que já aconteceu (localStorage e undo/redo continuam a fonte imediata).
  // As chamadas são encadeadas numa fila (nunca corridas em paralelo): cada sincronização assume
  // que a anterior já terminou de escrever (ex.: uma equipa nova tem de existir na base de dados
  // antes de um recurso que lhe é atribuído tentar gravar-se) — sem a fila, duas ações seguidas
  // rápidas (ex.: "+ Novo Projeto" logo a seguir a criar um recurso) podiam correr em simultâneo
  // e uma delas assumir, erradamente, que a outra já lá tinha posto os dados.
  sincronizarEmSegundoPlano(anteriorJSON, atualJSON) {
    if (!this.sessaoAtiva) return;
    this._filaSincronizacao = (this._filaSincronizacao || Promise.resolve())
      .then(() => Sync.sincronizarComSupabase(anteriorJSON, atualJSON))
      .catch(err => {
        console.error(err);
        if (this.sessaoAtiva) this.toast('Erro ao guardar na nuvem: ' + err.message);
      });
  },
  _mudancaRelevante(strAntes, strDepois) {
    if (strAntes === strDepois) return false;
    try {
      const a = JSON.parse(strAntes), b = JSON.parse(strDepois);
      a.projetoAtivoId = null; b.projetoAtivoId = null;
      return JSON.stringify(a) !== JSON.stringify(b);
    } catch (e) { return true; }
  },
  desfazer() {
    if (!this.undoStack.length) return;
    const atual = JSON.stringify(this.state);
    const anterior = this.undoStack.pop();
    this.redoStack.push(atual);
    if (this.redoStack.length > this.LIMITE_HISTORICO) this.redoStack.shift();
    this.state = JSON.parse(anterior);
    this._ultimoEstadoPersistido = anterior;
    localStorage.setItem(this.STORAGE_KEY, anterior);
    this.selecionadaId = null;
    this.selecionadasIds = new Set();
    this.renderProjetoSelect();
    this.renderTudo();
    this.atualizarBotoesHistorico();
    this.toast('Ação desfeita.');
    this.sincronizarEmSegundoPlano(atual, anterior);
  },
  refazer() {
    if (!this.redoStack.length) return;
    const atual = JSON.stringify(this.state);
    const seguinte = this.redoStack.pop();
    this.undoStack.push(atual);
    if (this.undoStack.length > this.LIMITE_HISTORICO) this.undoStack.shift();
    this.state = JSON.parse(seguinte);
    this._ultimoEstadoPersistido = seguinte;
    localStorage.setItem(this.STORAGE_KEY, seguinte);
    this.selecionadaId = null;
    this.selecionadasIds = new Set();
    this.renderProjetoSelect();
    this.renderTudo();
    this.atualizarBotoesHistorico();
    this.toast('Ação refeita.');
    this.sincronizarEmSegundoPlano(atual, seguinte);
  },
  atualizarBotoesHistorico() {
    if (this.els.btnDesfazer) this.els.btnDesfazer.disabled = !this.undoStack.length;
    if (this.els.btnRefazer) this.els.btnRefazer.disabled = !this.redoStack.length;
  },
  estadoVazio() {
    return { recursos: [], feriados: [], ausencias: [], equipas: [], registos: [], projetos: {}, utilizadores: [], projetoAtivoId: null };
  },
  normalizarEstado() {
    // Compatibilidade com estados guardados antes da introdução de Equipas / Registos de horas.
    if (!this.state.equipas) this.state.equipas = [];
    this.state.recursos.forEach(r => { if (r.equipaId === undefined) r.equipaId = null; if (r.email === undefined) r.email = ''; });
    if (!this.state.registos) this.state.registos = [];
    if (!this.state.utilizadores) this.state.utilizadores = [];
    this.migrarIdsParaUuid();
    // Compatibilidade com projetos guardados antes da introdução do Gestor de Projeto.
    Object.values(this.state.projetos).forEach(p => {
      if (p.gestorId === undefined) p.gestorId = null;
      delete p.consultorIds; // versão manual descontinuada — consultor deriva-se das tarefas
      if (!p.pontosSituacao) p.pontosSituacao = [];
      if (!p.proximosPassos) p.proximosPassos = [];
    });
    // Compatibilidade com projetos guardados antes da introdução da Faturação.
    Object.values(this.state.projetos).forEach(p => {
      if (!p.faturas) p.faturas = [];
      // Migração %→horas: até agora a alocação de um recurso numa tarefa era só uma percentagem,
      // aplicada a todos os dias úteis da duração. Agora é em horas totais, independentes da
      // duração — convertida aqui uma única vez (à entrada), usando a duração da tarefa neste
      // momento; a partir daqui as horas ficam fixas mesmo que a tarefa seja esticada/encolhida.
      p.tarefas.forEach(t => {
        if (t.alocacoesPct) {
          if (!t.alocacoesHoras) t.alocacoesHoras = {};
          Object.keys(t.alocacoesPct).forEach(rid => {
            if (t.alocacoesHoras[rid] === undefined) {
              t.alocacoesHoras[rid] = this.diasUteisTarefa(t) * Capacidade.HORAS_DIA * (t.alocacoesPct[rid] / 100);
            }
          });
          delete t.alocacoesPct;
        } else if (!t.alocacoesHoras) {
          t.alocacoesHoras = {};
        }
      });
    });
  },
  UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  ehUuid(s) { return typeof s === 'string' && this.UUID_REGEX.test(s); },
  // Compatibilidade com estados guardados antes da mudança de IDs numéricos/contadores para UUID
  // (necessária para ligar a app a uma base de dados partilhada). Corre uma única vez por
  // carregamento: qualquer ID que ainda não seja UUID é substituído por um novo, e todas as
  // referências cruzadas a esse ID (equipaId, recursoId, parentId, predecessoras, recursoIds,
  // chaves de alocacoesHoras) são reescritas a partir de um mapa id-antigo → uuid-novo. Registos,
  // feriados e faturas não são referenciados por outra entidade pelo próprio ID, por isso só
  // precisam de um ID novo, sem remapeamento.
  migrarIdsParaUuid() {
    const mapaEquipas = new Map();
    this.state.equipas.forEach(eq => {
      const idAntigo = eq.id;
      if (!this.ehUuid(idAntigo)) {
        const novo = crypto.randomUUID();
        mapaEquipas.set(idAntigo, novo);
        eq.id = novo;
      }
    });
    const mapaRecursos = new Map();
    this.state.recursos.forEach(r => {
      const idAntigo = r.id;
      if (!this.ehUuid(idAntigo)) {
        const novo = crypto.randomUUID();
        mapaRecursos.set(idAntigo, novo);
        r.id = novo;
      }
      if (mapaEquipas.has(r.equipaId)) r.equipaId = mapaEquipas.get(r.equipaId);
    });
    this.state.feriados.forEach(f => { if (!this.ehUuid(f.id)) f.id = crypto.randomUUID(); });
    this.state.ausencias.forEach(a => {
      if (!this.ehUuid(a.id)) a.id = crypto.randomUUID();
      if (mapaRecursos.has(a.recursoId)) a.recursoId = mapaRecursos.get(a.recursoId);
    });
    this.state.registos.forEach(rg => { if (!this.ehUuid(rg.id)) rg.id = crypto.randomUUID(); });

    Object.values(this.state.projetos).forEach(p => {
      if (!this.ehUuid(p.id)) {
        const novoId = crypto.randomUUID();
        if (this.state.projetoAtivoId === p.id) this.state.projetoAtivoId = novoId;
        delete this.state.projetos[p.id];
        p.id = novoId;
        this.state.projetos[novoId] = p;
      }
      const mapaTarefas = new Map();
      p.tarefas.forEach(t => {
        if (!this.ehUuid(t.id)) { mapaTarefas.set(t.id, crypto.randomUUID()); }
      });
      p.tarefas.forEach(t => {
        if (mapaTarefas.has(t.id)) t.id = mapaTarefas.get(t.id);
        if (t.parentId !== null && mapaTarefas.has(t.parentId)) t.parentId = mapaTarefas.get(t.parentId);
        t.predecessores.forEach(pr => { if (mapaTarefas.has(pr.id)) pr.id = mapaTarefas.get(pr.id); });
        if (t.recursoIds) t.recursoIds = t.recursoIds.map(rid => mapaRecursos.has(rid) ? mapaRecursos.get(rid) : rid);
        if (t.alocacoesHoras) {
          // Chaves de objeto são sempre strings, mas o mapa foi construído com os IDs antigos no
          // seu tipo original (number) — por isso a procura tem de converter a chave de volta.
          const novo = {};
          Object.keys(t.alocacoesHoras).forEach(rid => {
            const chaveNova = mapaRecursos.get(Number(rid));
            novo[chaveNova !== undefined ? chaveNova : rid] = t.alocacoesHoras[rid];
          });
          t.alocacoesHoras = novo;
        }
      });
      (p.faturas || []).forEach(f => { if (!this.ehUuid(f.id)) f.id = crypto.randomUUID(); });
      delete p.seq;
      delete p.seqFatura;
    });
  },
  projetoAtivo() {
    return this.state.projetos[this.state.projetoAtivoId];
  },

  // ---------- Permissões ----------
  // Aplicadas só na interface (esconder/desativar), não em RLS — decisão explícita, ver plano
  // "Perfis e Permissões". Um utilizador autenticado continua tecnicamente capaz de ler/escrever
  // tudo via chamadas diretas ao Supabase; isto só governa o que a app mostra/permite.
  perfilAtual() {
    return this.state.utilizadores.find(u => u.id === this.usuarioAtualId) || null;
  },
  souAdmin() {
    return this.perfilAtual()?.papel === 'admin';
  },
  // gestorId guarda um id de "recursos" (mesma convenção de recursoIds nas tarefas) — compara-se
  // contra o recurso ligado ao meu próprio login, não contra o id da conta.
  souGestorDe(projetoId) {
    const p = this.state.projetos[projetoId];
    const meuRecursoId = this.perfilAtual()?.recursoId;
    return !!p && !!meuRecursoId && p.gestorId === meuRecursoId;
  },
  // Não há lista manual de consultores do projeto — é consultor quem já tem, em qualquer tarefa
  // deste projeto, o recurso ligado ao seu próprio login (perfilAtual().recursoId). Atribuir
  // alguém a uma tarefa (no Gantt) já o torna consultor automaticamente; tirá-lo de todas as
  // tarefas remove-o também automaticamente — sem passo manual à parte para manter sincronizado.
  souConsultorDe(projetoId) {
    const p = this.state.projetos[projetoId];
    const meuRecursoId = this.perfilAtual()?.recursoId;
    if (!p || !meuRecursoId) return false;
    return p.tarefas.some(t => (t.recursoIds || []).includes(meuRecursoId));
  },
  estouEnvolvidoEm(projetoId) {
    return this.souAdmin() || this.souGestorDe(projetoId) || this.souConsultorDe(projetoId);
  },
  possoEditarProjeto(projetoId) {
    return this.souAdmin() || this.souGestorDe(projetoId);
  },
  possoEliminarProjeto(projetoId) {
    return this.souAdmin();
  },
  souGestorDeAlgumProjeto() {
    return this.souAdmin() || Object.keys(this.state.projetos).some(id => this.souGestorDe(id));
  },
  meusProjetosEnvolvidos() {
    return Object.values(this.state.projetos).filter(p => this.estouEnvolvidoEm(p.id));
  },

  // UUID gerado no cliente — aceite tal e qual pelo Postgres como chave primária (a base de
  // dados só usa o valor por omissão quando nenhum é fornecido), por isso não há round-trip
  // necessário para saber o ID de algo mesmo antes de o gravar.
  novoIdProjeto() {
    return crypto.randomUUID();
  },
  novoProjetoBase(nome, gestorId) {
    const hoje = DateUtil.toISO(new Date());
    return {
      id: this.novoIdProjeto(),
      idInterno: '',
      nome: nome || 'Novo Projeto',
      cliente: '',
      descricao: '',
      dataInicio: hoje,
      dataFim: DateUtil.toISO(DateUtil.addDays(new Date(), 30)),
      horasVendidas: 0,
      valorVendido: 0,
      estado: 'Por iniciar',
      gestorId: gestorId || null,
      versao: new Date().toISOString(),
      tarefas: [],
      faturas: [],
      pontosSituacao: [],
      proximosPassos: []
    };
  },
  novoPontoSituacaoObj(feedback, criadoPor) {
    return { id: crypto.randomUUID(), data: DateUtil.todayISO(), feedback: feedback || '', criadoPor: criadoPor || null, criadoEm: new Date().toISOString() };
  },
  novoProximoPassoObj(descricao, tarefaId, pontoSituacaoId, criadoPor) {
    const agora = new Date().toISOString();
    return {
      id: crypto.randomUUID(), tarefaId: tarefaId || null, pontoSituacaoId: pontoSituacaoId || null,
      descricao: descricao || '', estado: 'aberto', notas: '', fechado: false, fechadoEm: null,
      criadoPor: criadoPor || null, criadoEm: agora, atualizadoEm: agora
    };
  },
  novoRecursoObj(nome, papel, precoCusto, precoVenda, equipaId, email) {
    return { id: crypto.randomUUID(), nome: nome || 'Recurso', email: email || '', papel: papel || '', equipaId: equipaId || null, precoCusto: precoCusto || 0, precoVenda: precoVenda || 0 };
  },
  novoFeriadoObj(data, descricao) {
    return { id: crypto.randomUUID(), data: data || DateUtil.todayISO(), descricao: descricao || '' };
  },
  novoEquipaObj(nome) {
    return { id: crypto.randomUUID(), nome: nome || 'Nova equipa' };
  },
  novoAusenciaObj(recursoId, dataInicio, dataFim, tipo, notas) {
    return { id: crypto.randomUUID(), recursoId: recursoId || null, dataInicio: dataInicio || DateUtil.todayISO(), dataFim: dataFim || DateUtil.todayISO(), tipo: tipo || 'Férias', notas: notas || '' };
  },
  novaTarefaObj(p, nome, parentId, inicio, fim, recursoIds, progresso) {
    return {
      id: crypto.randomUUID(),
      nome: nome || 'Nova tarefa',
      parentId: parentId || null,
      inicio: inicio || DateUtil.toISO(new Date()),
      fim: fim || inicio || DateUtil.toISO(new Date()),
      progresso: progresso || 0,
      recursoIds: recursoIds || [],
      alocacoesHoras: {},
      predecessores: []
    };
  },
  // Dá um UUID novo a cada tarefa de uma lista, reescrevendo parentId/predecessores para
  // continuarem a apontar umas para as outras (recursoIds/alocacoesHoras não mudam, porque
  // continuam a referir-se aos MESMOS recursos, não a outras tarefas). Usado sempre que um
  // conjunto de tarefas muda de "dono" sem deixar de ser, estruturalmente, a mesma árvore —
  // duplicar um projeto, ou importar um ficheiro Excel (onde os IDs do ficheiro só servem para
  // resolver as referências dentro dele, nunca são usados como o UUID final).
  remaparIdsTarefas(tarefas) {
    const mapa = new Map();
    tarefas.forEach(t => mapa.set(t.id, crypto.randomUUID()));
    tarefas.forEach(t => {
      t.id = mapa.get(t.id);
      if (t.parentId !== null && mapa.has(t.parentId)) t.parentId = mapa.get(t.parentId);
      t.predecessores.forEach(pr => { if (mapa.has(pr.id)) pr.id = mapa.get(pr.id); });
    });
    return tarefas;
  },
  novaFaturaObj() {
    return {
      id: crypto.randomUUID(),
      dataPrevista: DateUtil.todayISO(),
      tipo: 'percentagem',
      percentagem: 0,
      valor: 0,
      emitida: false,
      dataEmissao: '',
      emitidoPor: '',
      numeroRegisto: ''
    };
  },
  // Percentagem converte-se sempre a partir do valor vendido do projeto; "valor" é um montante fixo.
  valorFatura(f, projeto) {
    if (f.tipo === 'percentagem') return (parseFloat(f.percentagem) || 0) / 100 * (projeto.valorVendido || 0);
    return parseFloat(f.valor) || 0;
  },
  totalFaturadoProjeto(projeto) {
    return (projeto.faturas || []).reduce((s, f) => s + this.valorFatura(f, projeto), 0);
  },
  projetoSobreFaturado(projeto) {
    return (projeto.valorVendido || 0) > 0 && this.totalFaturadoProjeto(projeto) > projeto.valorVendido + 0.005;
  },

  // ---------- Projetos: CRUD ----------
  // Só o Administrador cria projetos (é ele que atribui logo o Gestor de Projeto) — o botão que
  // chama isto já fica escondido para os restantes papéis, mas confirma-se aqui também.
  criarProjeto() {
    if (!this.souAdmin()) return;
    const opcoesGestor = '<option value="">Sem gestor atribuído</option>' +
      this.state.utilizadores.map(u => `<option value="${u.recursoId}">${escapeHtml(u.nome || u.email)}</option>`).join('');
    const html = `
      <label>Nome do projeto
        <input type="text" id="novoProjNome" placeholder="Nome do projeto">
      </label>
      <label>Gestor de Projeto
        <select id="novoProjGestor">${opcoesGestor}</select>
      </label>
      <button class="btn btn-primary" id="btnConfirmarNovoProjeto" style="margin-top:10px;">Criar Projeto</button>`;
    this.abrirModal('Novo Projeto', html);
    const inpNome = this.els.modalCorpo.querySelector('#novoProjNome');
    const selGestor = this.els.modalCorpo.querySelector('#novoProjGestor');
    inpNome.focus();
    this.els.modalCorpo.querySelector('#btnConfirmarNovoProjeto').addEventListener('click', () => {
      const nome = inpNome.value.trim();
      if (!nome) { inpNome.focus(); return; }
      const p = this.novoProjetoBase(nome, selGestor.value || null);
      this.state.projetos[p.id] = p;
      this.state.projetoAtivoId = p.id;
      this.persist();
      this.fecharModal();
      this.renderProjetoSelect();
      this.renderTudo();
      this.irParaAba('gantt');
      this.toast('Projeto criado.');
    });
  },
  duplicarProjeto() {
    if (!this.souAdmin()) return;
    const atual = this.projetoAtivo();
    if (!atual) return;
    const copia = JSON.parse(JSON.stringify(atual));
    copia.id = this.novoIdProjeto();
    copia.nome = atual.nome + ' (cópia)';
    copia.idInterno = '';
    copia.versao = new Date().toISOString();
    // Tarefas e faturas precisam de IDs novos e globalmente únicos — copiar os do original
    // criaria duas linhas com a mesma chave primária assim que isto for gravado numa base de
    // dados partilhada (a cópia "roubaria" as linhas do projeto original).
    this.remaparIdsTarefas(copia.tarefas);
    copia.faturas.forEach(f => { f.id = crypto.randomUUID(); });
    // Pontos de situação e next steps são histórico de reuniões do projeto original — a cópia
    // começa sem nenhum, não faz sentido herdar conversas de coaching de outro projeto.
    copia.pontosSituacao = [];
    copia.proximosPassos = [];
    this.state.projetos[copia.id] = copia;
    this.state.projetoAtivoId = copia.id;
    this.persist();
    this.renderProjetoSelect();
    this.renderTudo();
    this.toast('Projeto duplicado.');
  },
  eliminarProjeto(id) {
    if (!this.souAdmin()) return;
    const alvo = this.state.projetos[id || this.state.projetoAtivoId];
    if (!alvo) return;
    if (!confirm(`Eliminar o projeto "${alvo.nome}"? Esta ação não pode ser desfeita.`)) return;
    delete this.state.projetos[alvo.id];
    const restantes = Object.keys(this.state.projetos);
    if (this.state.projetoAtivoId === alvo.id) {
      this.state.projetoAtivoId = restantes.length ? restantes[0] : null;
    }
    this.persist();
    this.renderProjetoSelect();
    this.renderTudo();
    this.toast('Projeto eliminado.');
  },
  selecionarProjeto(id) {
    this.state.projetoAtivoId = id;
    this.selecionadaId = null;
    this.selecionadasIds = new Set();
    this.persist();
    this.renderTudo();
  },
  abrirProjetoNoGantt(id) {
    this.selecionarProjeto(id);
    this.renderProjetoSelect();
    this.irParaAba('gantt');
  },
  // ---------- Tarefas ----------
  tarefaPorId(p, id) { return p.tarefas.find(t => t.id === id); },
  filhosDe(p, id) { return p.tarefas.filter(t => t.parentId === id); },
  temFilhos(p, id) { return p.tarefas.some(t => t.parentId === id); },
  descendentesDe(p, id) {
    const out = [];
    const stack = [...this.filhosDe(p, id)];
    while (stack.length) {
      const t = stack.pop();
      out.push(t);
      stack.push(...this.filhosDe(p, t.id));
    }
    return out;
  },

  adicionarTarefa(comoSubtarefa) {
    const p = this.projetoAtivo();
    if (!p) return;
    let parentId = null;
    if (comoSubtarefa && this.selecionadaId) {
      const sel = this.tarefaPorId(p, this.selecionadaId);
      if (sel) parentId = sel.id;
    } else if (this.selecionadaId) {
      const sel = this.tarefaPorId(p, this.selecionadaId);
      if (sel) parentId = sel.parentId;
    }
    const base = this.selecionadaId ? this.tarefaPorId(p, this.selecionadaId) : null;
    const inicio = base ? base.inicio : DateUtil.toISO(new Date());
    const t = this.novaTarefaObj(p, 'Nova tarefa', parentId, inicio, DateUtil.toISO(DateUtil.addDays(DateUtil.parseISO(inicio), 1)));
    p.tarefas.push(t);
    this.selecionadaId = t.id;
    this.selecionadasIds = new Set([t.id]);
    this._ancoraSelecao = t.id;
    this.recalcularAgendamento(p);
    this.persist();
    this.renderTudo();
  },
  // Elimina todas as tarefas selecionadas (e respetivos descendentes) numa só passagem.
  eliminarTarefaSelecionada() {
    const p = this.projetoAtivo();
    const ids = this.idsSelecionados();
    if (!p || !ids.length) return;
    const alvos = ids.map(id => this.tarefaPorId(p, id)).filter(Boolean);
    if (!alvos.length) return;
    const temSub = alvos.some(a => this.temFilhos(p, a.id));
    const descricao = alvos.length === 1 ? `"${alvos[0].nome}"` : `${alvos.length} tarefas selecionadas`;
    if (!confirm(`Eliminar ${descricao}${temSub ? ' e as suas subtarefas' : ''}?`)) return;
    const idsRemover = new Set();
    alvos.forEach(a => { idsRemover.add(a.id); this.descendentesDe(p, a.id).forEach(d => idsRemover.add(d.id)); });
    p.tarefas = p.tarefas.filter(t => !idsRemover.has(t.id));
    p.tarefas.forEach(t => { t.predecessores = t.predecessores.filter(pr => !idsRemover.has(pr.id)); });
    this.selecionadaId = null;
    this.selecionadasIds = new Set();
    this.recalcularAgendamento(p);
    this.persist();
    this.renderTudo();
  },
  // Indenta cada tarefa selecionada sob a sua irmã imediatamente anterior, uma de cada vez e
  // por ordem de cima para baixo — equivalente a clicar "Indentar" em cada linha, em sequência.
  indentarSelecionada() {
    const p = this.projetoAtivo();
    const ids = this.idsSelecionados();
    if (!p || !ids.length) return;
    const ordemIds = this.flatten(p).map(x => x.tarefa.id);
    const alvosOrdenados = ids.slice().sort((a, b) => ordemIds.indexOf(a) - ordemIds.indexOf(b));
    alvosOrdenados.forEach(id => this._indentarUmaTarefa(p, id));
    this.recalcularAgendamento(p);
    this.persist();
    this.renderTudo();
  },
  _indentarUmaTarefa(p, id) {
    const lista = this.flatten(p);
    const idx = lista.findIndex(x => x.tarefa.id === id);
    if (idx <= 0) return;
    const atual = lista[idx].tarefa;
    let candidato = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (lista[i].tarefa.parentId === atual.parentId) { candidato = lista[i].tarefa; break; }
    }
    if (!candidato) return;
    atual.parentId = candidato.id;
  },
  // Promove cada tarefa selecionada um nível acima — independente entre si, não precisa de ordem.
  promoverSelecionada() {
    const p = this.projetoAtivo();
    const ids = this.idsSelecionados();
    if (!p || !ids.length) return;
    ids.forEach(id => {
      const atual = this.tarefaPorId(p, id);
      if (!atual || atual.parentId === null) return;
      const pai = this.tarefaPorId(p, atual.parentId);
      atual.parentId = pai ? pai.parentId : null;
    });
    this.recalcularAgendamento(p);
    this.persist();
    this.renderTudo();
  },
  // Move cada tarefa selecionada uma posição entre as irmãs, na direção indicada. Ao descer,
  // processa de baixo para cima (e ao subir, de cima para baixo) para as linhas selecionadas não
  // "empurrarem-se" umas às outras durante o lote.
  moverOrdemSelecionada(direcao) {
    const p = this.projetoAtivo();
    const ids = this.idsSelecionados();
    if (!p || !ids.length) return;
    const ordemIds = this.flatten(p).map(x => x.tarefa.id);
    const alvosOrdenados = ids.slice().sort((a, b) => ordemIds.indexOf(a) - ordemIds.indexOf(b));
    if (direcao > 0) alvosOrdenados.reverse();
    alvosOrdenados.forEach(id => this._moverUmaTarefa(p, id, direcao));
    this.persist();
    this.renderTudo();
  },
  _moverUmaTarefa(p, id, direcao) {
    const atual = this.tarefaPorId(p, id);
    if (!atual) return;
    const irmaos = this.filhosDe(p, atual.parentId);
    const idx = irmaos.findIndex(t => t.id === atual.id);
    const novoIdx = idx + direcao;
    if (novoIdx < 0 || novoIdx >= irmaos.length) return;
    const vizinho = irmaos[novoIdx];
    const posAtual = p.tarefas.indexOf(atual);
    const posVizinho = p.tarefas.indexOf(vizinho);
    p.tarefas[posAtual] = vizinho;
    p.tarefas[posVizinho] = atual;
  },
  atualizarCampoTarefa(id, campo, valor) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, id);
    if (!t) return;
    if (campo === 'inicio' || campo === 'fim') {
      t[campo] = valor;
      if (DateUtil.parseISO(t.fim) < DateUtil.parseISO(t.inicio)) {
        if (campo === 'inicio') t.fim = t.inicio; else t.inicio = t.fim;
      }
    } else if (campo === 'duracao') {
      const dias = Math.max(1, parseInt(valor, 10) || 1);
      t.fim = DateUtil.toISO(DateUtil.addDays(DateUtil.parseISO(t.inicio), dias - 1));
    } else if (campo === 'progresso') {
      t.progresso = Math.max(0, Math.min(100, parseInt(valor, 10) || 0));
    } else if (campo === 'nome') {
      t.nome = valor;
    }
    this.recalcularAgendamento(p);
    this.persist();
    this.renderTudo();
  },
  moverTarefa(id, novoInicioISO, novoFimISO) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, id);
    if (!t) return;
    t.inicio = novoInicioISO;
    t.fim = novoFimISO;
    this.recalcularAgendamento(p);
    this.persist();
    this.renderTudo();
  },

  // ---------- Predecessoras ----------
  wouldCreateCycle(p, taskId, novoPredId) {
    const visitados = new Set();
    const fila = [taskId];
    while (fila.length) {
      const atual = fila.shift();
      if (atual === novoPredId) return true;
      if (visitados.has(atual)) continue;
      visitados.add(atual);
      p.tarefas.forEach(t => {
        if (t.predecessores.some(pr => pr.id === atual)) fila.push(t.id);
      });
    }
    return false;
  },
  adicionarPredecessor(taskId, predId, tipo, atraso) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, taskId);
    if (!t || taskId === predId) return false;
    if (this.wouldCreateCycle(p, taskId, predId)) { this.toast('Isso criaria uma dependência circular.'); return false; }
    const existente = t.predecessores.find(pr => pr.id === predId);
    if (existente) { existente.tipo = tipo; existente.atraso = atraso; }
    else t.predecessores.push({ id: predId, tipo, atraso });
    this.recalcularAgendamento(p);
    this.persist();
    return true;
  },
  removerPredecessor(taskId, predId) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, taskId);
    if (!t) return;
    t.predecessores = t.predecessores.filter(pr => pr.id !== predId);
    this.recalcularAgendamento(p);
    this.persist();
  },

  // ---------- Recursos (central) ----------
  adicionarRecurso() {
    this.state.recursos.push(this.novoRecursoObj('Novo consultor', '', 0, 0, null, ''));
    this.persist();
    this.renderTabelaRecursosCentral();
    this.renderCapacidade();
  },
  eliminarRecurso(id) {
    const temConta = this.state.utilizadores.some(u => u.recursoId === id);
    const aviso = temConta
      ? 'Esta pessoa tem conta de acesso à plataforma — eliminar apaga também o acesso dela (fica sem papel de Administrador/Utilizador). A conta de login em si mantém-se, mas passa a ficar "órfã" até recriares o registo. Eliminar mesmo assim?'
      : 'Eliminar este consultor? Será removido de todas as tarefas e ausências onde está associado.';
    if (!confirm(aviso)) return;
    this.state.recursos = this.state.recursos.filter(r => r.id !== id);
    this.state.ausencias = this.state.ausencias.filter(a => a.recursoId !== id);
    this.state.utilizadores = this.state.utilizadores.filter(u => u.recursoId !== id);
    Object.values(this.state.projetos).forEach(p => {
      p.tarefas.forEach(t => { t.recursoIds = t.recursoIds.filter(rid => rid !== id); });
    });
    this.persist();
    this.renderTudo();
  },
  atualizarRecurso(id, campo, valor) {
    const r = this.state.recursos.find(x => x.id === id);
    if (!r) return;
    if (campo === 'nome' || campo === 'papel' || campo === 'email') r[campo] = valor;
    else if (campo === 'equipaId') r.equipaId = valor || null;
    else r[campo] = parseFloat(valor) || 0;
    this.persist();
    this.renderTabelaRecursosCentral();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },
  alternarRecursoTarefa(taskId, recursoId) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, taskId);
    if (!t) return;
    const idx = t.recursoIds.indexOf(recursoId);
    if (idx >= 0) {
      t.recursoIds.splice(idx, 1);
      if (t.alocacoesHoras) delete t.alocacoesHoras[recursoId];
    } else {
      t.recursoIds.push(recursoId);
    }
    this.persist();
    this.renderTudo();
  },
  // Nº de dias úteis (seg-sex, sem descontar feriados/ausências) entre duas datas ISO, inclusive.
  diasUteisEntre(inicioISO, fimISO) {
    const inicio = DateUtil.parseISO(inicioISO), fim = DateUtil.parseISO(fimISO);
    let dias = 0;
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (!Capacidade.ehFimDeSemana(d)) dias++;
    }
    return dias;
  },
  diasUteisTarefa(t) {
    return this.diasUteisEntre(t.inicio, t.fim);
  },
  // Horas que um recurso a tempo inteiro (100%) trabalharia na duração ATUAL da tarefa.
  horasTempoInteiro(t) {
    return this.diasUteisTarefa(t) * Capacidade.HORAS_DIA;
  },
  // Horas totais planeadas de um recurso nesta tarefa. Por omissão, tempo inteiro (todos os dias
  // úteis da duração atual) — recalculado dinamicamente se a tarefa for esticada/encolhida, tal
  // como acontecia com a % antiga. Uma vez definido um valor explícito, esse valor fica fixo e
  // independente da duração — é precisamente para isto que esta funcionalidade existe: a duração
  // da tarefa (quando pode decorrer) e o esforço necessário (quanto trabalho realmente exige) são
  // coisas diferentes.
  horasAlocadas(t, recursoId) {
    if (t.alocacoesHoras && t.alocacoesHoras[recursoId] !== undefined) return t.alocacoesHoras[recursoId];
    return this.horasTempoInteiro(t);
  },
  definirHorasRecursoTarefa(projeto, taskId, recursoId, valor) {
    const t = this.tarefaPorId(projeto, taskId);
    if (!t || !t.recursoIds.includes(recursoId)) return;
    const horas = Math.max(0, Number(valor) || 0);
    if (!t.alocacoesHoras) t.alocacoesHoras = {};
    t.alocacoesHoras[recursoId] = horas;
    this.persist();
    this.renderTudo();
  },
  // Percentagem MÉDIA de ocupação diária, derivada das horas totais planeadas espalhadas pelos
  // dias úteis da tarefa — é o que o motor de capacidade (heatmap, deteção de conflitos em
  // capacidade.js) usa para saber quanto esta tarefa ocupa a pessoa em cada dia, sem precisar de
  // saber nada sobre horas. Pode passar de 100% se as horas pedidas não cabem na duração da tarefa
  // sozinha — é intencional, sinaliza logo essa sobrecarga.
  pctAlocacao(t, recursoId) {
    const dias = this.diasUteisTarefa(t);
    if (dias <= 0) return 100;
    return Math.round((this.horasAlocadas(t, recursoId) / dias / Capacidade.HORAS_DIA) * 100);
  },

  // ---------- Equipas (central) ----------
  adicionarEquipa() {
    this.state.equipas.push(this.novoEquipaObj('Nova equipa'));
    this.persist();
    this.renderTabelaEquipas();
    this.renderTabelaRecursosCentral();
    this.renderFiltroEquipaCap();
  },
  eliminarEquipa(id) {
    if (!confirm('Eliminar esta equipa? Os consultores associados ficam sem equipa atribuída.')) return;
    this.state.equipas = this.state.equipas.filter(eq => eq.id !== id);
    this.state.recursos.forEach(r => { if (r.equipaId === id) r.equipaId = null; });
    if (this.filtroEquipaCap === String(id)) this.filtroEquipaCap = '';
    this.persist();
    this.renderTabelaEquipas();
    this.renderTabelaRecursosCentral();
    this.renderFiltroEquipaCap();
    this.renderCapacidade();
  },
  atualizarEquipa(id, valor) {
    const eq = this.state.equipas.find(x => x.id === id);
    if (!eq) return;
    eq.nome = valor;
    this.persist();
    this.renderTabelaRecursosCentral();
    this.renderFiltroEquipaCap();
  },

  // ---------- Feriados ----------
  adicionarFeriado() {
    this.state.feriados.push(this.novoFeriadoObj(DateUtil.todayISO(), 'Novo feriado'));
    this.persist();
    this.renderTabelaFeriados();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },
  eliminarFeriado(id) {
    this.state.feriados = this.state.feriados.filter(f => f.id !== id);
    this.persist();
    this.renderTabelaFeriados();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },
  atualizarFeriado(id, campo, valor) {
    const f = this.state.feriados.find(x => x.id === id);
    if (!f) return;
    f[campo] = valor;
    this.persist();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },

  // ---------- Ausências ----------
  adicionarAusencia() {
    const primeiroRecurso = this.state.recursos[0];
    this.state.ausencias.push(this.novoAusenciaObj(primeiroRecurso ? primeiroRecurso.id : null, DateUtil.todayISO(), DateUtil.todayISO(), 'Férias', ''));
    this.persist();
    this.renderTabelaAusencias();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },
  eliminarAusencia(id) {
    this.state.ausencias = this.state.ausencias.filter(a => a.id !== id);
    this.persist();
    this.renderTabelaAusencias();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },
  atualizarAusencia(id, campo, valor) {
    const a = this.state.ausencias.find(x => x.id === id);
    if (!a) return;
    a[campo] = valor;
    if (campo === 'dataInicio' || campo === 'dataFim') {
      if (DateUtil.parseISO(a.dataFim) < DateUtil.parseISO(a.dataInicio)) {
        if (campo === 'dataInicio') a.dataFim = a.dataInicio; else a.dataInicio = a.dataFim;
        this.toast('A data de fim não pode ser anterior à de início — foi ajustada automaticamente.');
      }
    }
    this.persist();
    this.renderTabelaAusencias();
    this.renderTabelaTarefas();
    this.renderCapacidade();
  },

  // ---------- Faturação ----------
  adicionarFatura() {
    // Usa o projeto selecionado no filtro desta página, se houver um — caso contrário cai para o
    // projeto ativo no separador Gantt. Sem isto, uma fatura podia ser criada "às cegas" num
    // projeto diferente do que a pessoa está a ver aqui, ficando escondida pelo próprio filtro.
    const idFiltro = this.els.fFatProjeto.value;
    const p = idFiltro ? this.state.projetos[idFiltro] : this.projetoAtivo();
    if (!p) { this.toast('Escolhe primeiro um projeto (no filtro acima ou no separador "Gantt do Projeto").'); return; }
    if (!this.possoEditarProjeto(p.id)) { this.toast('Não tens permissão para faturar este projeto.'); return; }
    p.faturas.push(this.novaFaturaObj());
    this.persist();
    this.renderFaturacao();
    // Garante que a fatura acabada de criar fica sempre visível de imediato — fixa o filtro de
    // projeto neste e limpa filtros de data/nº de registo que a pudessem esconder.
    this.els.fFatProjeto.value = p.id;
    this.els.fFatDe.value = ''; this.els.fFatAte.value = ''; this.els.fFatNumRegisto.value = '';
    this.aplicarFiltrosFaturacao();
    this.renderGanttAtual();
    this.toast(`Fatura adicionada a "${p.nome}".`);
  },
  eliminarFatura(projetoId, faturaId) {
    const p = this.state.projetos[projetoId];
    if (!p) return;
    if (!confirm('Eliminar esta fatura?')) return;
    p.faturas = p.faturas.filter(f => f.id !== faturaId);
    this.persist();
    this.renderFaturacao();
    this.renderGanttAtual();
  },
  atualizarFatura(projetoId, faturaId, campo, valor) {
    const p = this.state.projetos[projetoId];
    if (!p) return;
    const f = p.faturas.find(x => x.id === faturaId);
    if (!f) return;
    if (campo === 'emitida') {
      f.emitida = !!valor;
      if (f.emitida && !f.dataEmissao) f.dataEmissao = DateUtil.todayISO();
    } else if (campo === 'percentagem' || campo === 'valor') {
      f[campo] = parseFloat(valor) || 0;
    } else {
      f[campo] = valor;
    }
    this.persist();
    this.renderTabelaFaturas();
    this.renderGanttAtual();
    if ((campo === 'tipo' || campo === 'percentagem' || campo === 'valor') && this.projetoSobreFaturado(p)) {
      const total = this.totalFaturadoProjeto(p);
      this.toast(`⚠ "${p.nome}" tem ${total.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} € em faturas planeadas, acima dos ${p.valorVendido.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} € vendidos.`);
    }
  },

  // ---------- Registo de Horas ----------
  ULTIMA_PESSOA_KEY: 'gp_ultima_pessoa',
  novoRegistoObj(dados) {
    return {
      id: crypto.randomUUID(),
      data: dados.data,
      pessoa: dados.pessoa,
      projetoIdInterno: dados.projetoIdInterno,
      projetoNome: dados.projetoNome,
      projetoId: dados.projetoId || null,
      tarefaNome: dados.tarefaNome || '',
      horas: dados.horas,
      notas: dados.notas || '',
      origem: dados.origem || 'app',
      userId: dados.userId || null,
      submetidoEm: dados.submetidoEm || new Date().toISOString()
    };
  },
  submeterRegisto(dados) {
    const registo = this.novoRegistoObj(Object.assign({ origem: 'app' }, dados));
    this.state.registos.push(registo);
    try { localStorage.setItem(this.ULTIMA_PESSOA_KEY, dados.pessoa); } catch (e) { /* ignora */ }
    this.persist();
    this.renderTabelaRegistos();
    this.renderTabelaTarefas();
    this.renderTabelaProjetos();
    this.renderInfoProjeto();
    this.renderPortefolio();
    return registo;
  },
  eliminarRegisto(id) {
    if (!confirm('Eliminar este registo? A base de dados é partilhada — esta ação remove-o para toda a equipa, não só para ti.')) return;
    this.state.registos = this.state.registos.filter(r => r.id !== id);
    this.persist();
    this.renderTabelaRegistos();
    this.renderTabelaTarefas();
    this.renderTabelaProjetos();
    this.renderInfoProjeto();
    this.renderPortefolio();
  },
  // Soma as horas reais desta tarefa. Casa por nome (sem sensibilidade a maiúsculas/espaços, para
  // não perder registos por diferenças triviais de escrita). Registos cuja "Tarefa" não corresponde
  // ao nome de nenhuma tarefa real do projeto — em branco, ou texto livre vindo de uma importação
  // em bloco do "Registo Diário" — só são atribuídos a esta tarefa se for a ÚNICA tarefa desta
  // pessoa neste projeto; havendo mais que uma, ficam por atribuir (contam à mesma no total do
  // projeto, só não sabemos a qual tarefa pertencem).
  horasReaisTarefa(p, t) {
    if (!p || !t || !p.idInterno) return 0;
    const normalizar = (s) => String(s || '').trim().toLowerCase();
    const nomeTarefa = normalizar(t.nome);
    const registosProjeto = this.state.registos.filter(r => r.projetoIdInterno === p.idInterno);
    // Nomes de TODAS as tarefas do projeto (resumo e folha) — um registo cujo texto bate certo com
    // o nome de qualquer uma delas já tem "casa" definida, mesmo que essa tarefa seja uma fase com
    // sub-tarefas (uma fase pode ter recursos e registos próprios, além dos das suas subtarefas).
    const nomesTodasTarefas = new Set(p.tarefas.map(x => normalizar(x.nome)));
    const diretas = registosProjeto.reduce((soma, r) => {
      const nomeRegisto = normalizar(r.tarefaNome);
      return nomeRegisto && nomeRegisto === nomeTarefa ? soma + (parseFloat(r.horas) || 0) : soma;
    }, 0);
    if (this.temFilhos(p, t.id)) {
      return diretas + this.filhosDe(p, t.id).reduce((soma, filho) => soma + this.horasReaisTarefa(p, filho), 0);
    }
    // Registos sem correspondência a nenhuma tarefa do projeto — em branco, ou texto livre vindo de
    // uma importação em bloco do "Registo Diário" — só são atribuídos a esta tarefa se for a ÚNICA
    // tarefa desta pessoa neste projeto; havendo mais que uma, ficam por atribuir (contam à mesma no
    // total do projeto, só não sabemos a qual tarefa pertencem).
    const semCorrespondencia = registosProjeto.reduce((soma, r) => {
      const nomeRegisto = normalizar(r.tarefaNome);
      if (nomeRegisto && nomesTodasTarefas.has(nomeRegisto)) return soma;
      const recurso = this.state.recursos.find(x => normalizar(x.nome) === normalizar(r.pessoa));
      if (!recurso || !t.recursoIds.includes(recurso.id)) return soma;
      const outrasTarefasDaPessoa = p.tarefas.filter(x => x.id !== t.id && !this.temFilhos(p, x.id) && x.recursoIds.includes(recurso.id));
      return outrasTarefasDaPessoa.length === 0 ? soma + (parseFloat(r.horas) || 0) : soma;
    }, 0);
    return diretas + semCorrespondencia;
  },
  // ---------- Portefólio ----------
  progressoGeralProjeto(p) {
    const raizes = p.tarefas.filter(t => t.parentId === null);
    if (!raizes.length) return 0;
    let totalDur = 0, somaPond = 0;
    raizes.forEach(t => {
      const dur = DateUtil.diffDays(DateUtil.parseISO(t.inicio), DateUtil.parseISO(t.fim)) + 1;
      totalDur += dur;
      somaPond += dur * (t.progresso || 0);
    });
    return totalDur ? Math.round(somaPond / totalDur) : 0;
  },
  horasReaisProjeto(p) {
    return this.state.registos
      .filter(r => p.idInterno && r.projetoIdInterno === p.idInterno)
      .reduce((soma, r) => soma + (parseFloat(r.horas) || 0), 0);
  },
  mesmoMes(dataISO, ano, mes) {
    const d = DateUtil.parseISO(dataISO);
    return !!d && d.getFullYear() === ano && d.getMonth() === mes;
  },
  // Horas planeadas do projeto num mês específico — só conta os dias de cada tarefa que caem
  // dentro desse mês — usado para construir a reprevisão.
  planeadoMesProjeto(p, ano, mes) {
    const inicioMes = new Date(ano, mes, 1);
    const fimMes = new Date(ano, mes + 1, 0);
    let total = 0;
    p.tarefas.forEach(t => {
      if (this.temFilhos(p, t.id)) return;
      const inicioT = DateUtil.parseISO(t.inicio), fimT = DateUtil.parseISO(t.fim);
      const inicio = inicioT > inicioMes ? inicioT : inicioMes;
      const fim = fimT < fimMes ? fimT : fimMes;
      if (inicio > fim) return;
      const fatorRecursos = t.recursoIds.length
        ? t.recursoIds.reduce((soma, rid) => soma + this.pctAlocacao(t, rid) / 100, 0)
        : 1;
      for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
        if (!Capacidade.ehFimDeSemana(d)) total += Capacidade.HORAS_DIA * fatorRecursos;
      }
    });
    return total;
  },
  realMesProjeto(p, ano, mes) {
    return this.state.registos
      .filter(r => p.idInterno && r.projetoIdInterno === p.idInterno && this.mesmoMes(r.data, ano, mes))
      .reduce((soma, r) => soma + (parseFloat(r.horas) || 0), 0);
  },
  // Meses a considerar na reprevisão: do início ao fim das tarefas do projeto, alargado para
  // incluir também quaisquer registos de horas reais fora desse intervalo (ex.: trabalho lançado
  // num mês sem tarefas planeadas) — assim a reprevisão nunca fica abaixo do real já registado.
  mesesDoProjeto(p) {
    const datas = [];
    p.tarefas.forEach(t => { if (!this.temFilhos(p, t.id)) datas.push(DateUtil.parseISO(t.inicio), DateUtil.parseISO(t.fim)); });
    this.state.registos.forEach(r => { if (p.idInterno && r.projetoIdInterno === p.idInterno) datas.push(DateUtil.parseISO(r.data)); });
    if (!datas.length) return [];
    return Capacidade.mesesEntre(new Date(Math.min(...datas)), new Date(Math.max(...datas)));
  },
  // Reprevisão / EAC = para cada mês do projeto, usa o Real se já houver registos nesse mês,
  // senão usa o Planeado — mês a mês, tal como no ficheiro de controlo de capacidade de origem.
  reprevisaoEAC(p) {
    return this.mesesDoProjeto(p).reduce((soma, m) => {
      const temRegisto = this.state.registos.some(r => p.idInterno && r.projetoIdInterno === p.idInterno && this.mesmoMes(r.data, m.ano, m.mes));
      return soma + (temRegisto ? this.realMesProjeto(p, m.ano, m.mes) : this.planeadoMesProjeto(p, m.ano, m.mes));
    }, 0);
  },
  avaliarPrazoProjeto(p) {
    const progresso = this.progressoGeralProjeto(p);
    if (p.estado === 'Concluído' || p.estado === 'Cancelado') {
      return { nivel: 'neutro', motivo: p.estado, progresso };
    }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const inicio = DateUtil.parseISO(p.dataInicio), fim = DateUtil.parseISO(p.dataFim);
    const duracaoTotal = Math.max(DateUtil.diffDays(inicio, fim), 1);
    const decorrido = Math.min(Math.max(DateUtil.diffDays(inicio, hoje), 0), duracaoTotal);
    const pctTempo = Math.round((decorrido / duracaoTotal) * 100);
    const desvio = pctTempo - progresso;
    const diasRestantes = DateUtil.diffDays(hoje, fim);

    if (hoje > fim && progresso < 100) {
      return { nivel: 'vermelho', motivo: `Prazo ultrapassado (previsto ${DateUtil.formatShort(fim)}) — ${progresso}% concluído`, progresso, pctTempo, diasRestantes };
    }
    if (desvio >= 20) {
      return { nivel: 'vermelho', motivo: `${desvio} pontos abaixo do previsto para esta fase do calendário`, progresso, pctTempo, diasRestantes };
    }
    if (desvio >= 10) {
      return { nivel: 'amarelo', motivo: `${desvio} pontos abaixo do previsto — a aproximar-se do limite`, progresso, pctTempo, diasRestantes };
    }
    return { nivel: 'verde', motivo: 'Dentro do planeado', progresso, pctTempo, diasRestantes };
  },
  // Estado orçamental do projeto em horas: compara o Real acumulado e a Reprevisão (EAC = Real +
  // Planeado restante dos meses ainda sem registo) com as Horas Vendidas. Vermelho quando a
  // reprevisão já ultrapassa o estimado (risco de derrapagem), amarelo quando o consumo real já
  // passa 85% do estimado, verde caso contrário — mesmos limiares do ficheiro de origem.
  avaliarOrcamentoProjeto(p) {
    const totalReal = this.horasReaisProjeto(p);
    const eac = this.reprevisaoEAC(p);
    if (!p.horasVendidas) {
      return { nivel: 'neutro', motivo: 'Sem orçamento de horas definido', totalReal, eac, saldoDisponivel: null, pctConsumido: null, desvioEAC: null };
    }
    const saldoDisponivel = p.horasVendidas - totalReal;
    const pctConsumido = totalReal / p.horasVendidas;
    const desvioEAC = eac - p.horasVendidas;
    if (desvioEAC > 0) return { nivel: 'vermelho', motivo: 'Risco de derrapagem (reprevisão acima do estimado)', totalReal, eac, saldoDisponivel, pctConsumido, desvioEAC };
    if (pctConsumido > 0.85) return { nivel: 'amarelo', motivo: 'Perto do limite do orçamento', totalReal, eac, saldoDisponivel, pctConsumido, desvioEAC };
    return { nivel: 'verde', motivo: 'Dentro do orçamento', totalReal, eac, saldoDisponivel, pctConsumido, desvioEAC };
  },
  renderPortefolio() {
    const e = this.els;
    if (!e.gridPortefolio) return;
    const projetos = this.meusProjetosEnvolvidos();
    if (!projetos.length) {
      e.statsPortefolio.innerHTML = '';
      e.gridPortefolio.innerHTML = '<p style="color:#9ca3af">Sem projetos carregados.</p>';
      return;
    }
    const contagemPrazo = { verde: 0, amarelo: 0, vermelho: 0, neutro: 0 };
    const contagemOrc = { verde: 0, amarelo: 0, vermelho: 0, neutro: 0 };

    const cartoes = projetos.map(p => {
      const prazo = this.avaliarPrazoProjeto(p);
      const orc = this.avaliarOrcamentoProjeto(p);
      contagemPrazo[prazo.nivel]++;
      contagemOrc[orc.nivel]++;
      const diasTexto = prazo.diasRestantes === undefined ? '' :
        (prazo.diasRestantes >= 0 ? `${prazo.diasRestantes} dia(s) até ao fim previsto` : `${Math.abs(prazo.diasRestantes)} dia(s) de atraso face ao previsto`);
      const orcTexto = orc.pctConsumido === null ? 'Sem horas vendidas definidas'
        : `${orc.totalReal.toFixed(0)}h reais de ${p.horasVendidas}h vendidas (${Math.round(orc.pctConsumido * 100)}%) · Reprevisão: ${orc.eac.toFixed(0)}h`;
      return `
        <div class="card-portfolio">
          <div class="port-head">
            <div>
              <div class="port-titulo">${escapeHtml(p.idInterno || '—')} — ${escapeHtml(p.nome)}</div>
              <div class="port-sub">${escapeHtml(p.cliente || 'Sem cliente')} · ${escapeHtml(p.estado)}</div>
            </div>
            <div class="port-badges">
              <span class="rag-dot rag-${prazo.nivel}" title="Prazo: ${escapeAttr(prazo.motivo)}"></span>
              <span class="rag-dot rag-${orc.nivel}" title="Orçamento: ${escapeAttr(orc.motivo)}"></span>
            </div>
          </div>
          <div class="port-bar"><div class="port-bar-fill" style="width:${Math.min(prazo.progresso, 100)}%"></div></div>
          <div class="port-meta">${prazo.progresso}% concluído · ${DateUtil.formatShort(DateUtil.parseISO(p.dataInicio))} – ${DateUtil.formatShort(DateUtil.parseISO(p.dataFim))}${diasTexto ? ' · ' + diasTexto : ''}</div>
          <div class="port-linha">Prazo: <span class="rag-texto rag-${prazo.nivel}">${escapeHtml(prazo.motivo)}</span></div>
          <div class="port-linha">Orçamento: <span class="rag-texto rag-${orc.nivel}">${escapeHtml(orc.motivo)}</span><br><span style="color:var(--cinza-500);font-size:11px;">${escapeHtml(orcTexto)}</span></div>
          <div class="port-acoes"><button class="btn btn-sm" data-abrir-portefolio="${p.id}">Abrir no Gantt</button></div>
        </div>`;
    }).join('');

    e.statsPortefolio.innerHTML = `
      <span><b>${projetos.length}</b> projeto(s)</span>
      <span>Prazo: <span class="rag-texto rag-verde">${contagemPrazo.verde} verde</span> · <span class="rag-texto rag-amarelo">${contagemPrazo.amarelo} amarelo</span> · <span class="rag-texto rag-vermelho">${contagemPrazo.vermelho} vermelho</span></span>
      <span>Orçamento: <span class="rag-texto rag-verde">${contagemOrc.verde} verde</span> · <span class="rag-texto rag-amarelo">${contagemOrc.amarelo} amarelo</span> · <span class="rag-texto rag-vermelho">${contagemOrc.vermelho} vermelho</span></span>`;
    e.gridPortefolio.innerHTML = cartoes;
    e.gridPortefolio.querySelectorAll('[data-abrir-portefolio]').forEach(btn => {
      btn.addEventListener('click', () => this.abrirProjetoNoGantt(btn.dataset.abrirPortefolio));
    });

    this.renderPortfolioGantt();
  },

  renderPortfolioGantt() {
    const e = this.els;
    if (!e.chipsProjetosPortGantt) return;
    const projetosBrutos = this.meusProjetosEnvolvidos();
    if (!this.selecaoPortGantt) this.selecaoPortGantt = new Set();
    if (!this.projetosVistosPortGantt) this.projetosVistosPortGantt = new Set();
    if (!this.ordemPortGantt) this.ordemPortGantt = [];
    const idsAtuais = new Set(projetosBrutos.map(p => p.id));
    // remove seleções/ordem de projetos entretanto eliminados
    this.selecaoPortGantt.forEach(id => { if (!idsAtuais.has(id)) this.selecaoPortGantt.delete(id); });
    this.ordemPortGantt = this.ordemPortGantt.filter(id => idsAtuais.has(id));
    // projetos novos (nunca vistos nesta sessão) entram selecionados por omissão e no fim da ordem
    projetosBrutos.forEach(p => {
      if (!this.projetosVistosPortGantt.has(p.id)) {
        this.projetosVistosPortGantt.add(p.id);
        this.selecaoPortGantt.add(p.id);
      }
      if (!this.ordemPortGantt.includes(p.id)) this.ordemPortGantt.push(p.id);
    });

    const projetos = projetosBrutos.slice().sort((a, b) => this.ordemPortGantt.indexOf(a.id) - this.ordemPortGantt.indexOf(b.id));

    e.chipsProjetosPortGantt.innerHTML = projetos.map(p => `
      <button type="button" class="chip-projeto ${this.selecaoPortGantt.has(p.id) ? 'ativo' : ''}" data-chip-projeto="${p.id}">${escapeHtml(p.idInterno || p.nome)}</button>
    `).join('') || '<span style="color:#9ca3af;font-size:12px;">Sem projetos.</span>';
    e.chipsProjetosPortGantt.querySelectorAll('[data-chip-projeto]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.chipProjeto;
        if (this.selecaoPortGantt.has(id)) this.selecaoPortGantt.delete(id); else this.selecaoPortGantt.add(id);
        this.renderPortfolioGantt();
      });
    });

    if (!this.colapsadosPortGantt) this.colapsadosPortGantt = new Set();
    const selecionados = projetos.filter(p => this.selecaoPortGantt.has(p.id));
    const linhas = PortfolioGantt.construirLinhas(selecionados, this.colapsadosPortGantt);

    e.corpoTabelaPortGantt.innerHTML = linhas.length ? linhas.map(l => {
      if (l.tipo === 'projeto') {
        const p = l.projeto;
        const colapsado = this.colapsadosPortGantt.has(p.id);
        return `<tr class="linha-projeto-port">
          <td colspan="4">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span><span class="toggle-filhos" data-toggle-projeto="${p.id}">${colapsado ? '▶' : '▼'}</span> ${escapeHtml(p.idInterno || '')} — ${escapeHtml(p.nome)}${p.cliente ? ` (${escapeHtml(p.cliente)})` : ''}</span>
              <span class="port-mover">
                <button type="button" class="btn-icon" data-mover-projeto="${p.id}" data-dir="-1" title="Mover projeto para cima">↑</button>
                <button type="button" class="btn-icon" data-mover-projeto="${p.id}" data-dir="1" title="Mover projeto para baixo">↓</button>
              </span>
            </div>
          </td>
        </tr>`;
      }
      const t = l.tarefa;
      return `<tr class="linha-tarefa-port" data-projeto-id="${l.projeto.id}" data-tarefa-id="${t.id}">
        <td style="padding-left:20px;">${escapeHtml(t.nome)}</td>
        <td>${DateUtil.formatShort(DateUtil.parseISO(t.inicio))}</td>
        <td>${DateUtil.formatShort(DateUtil.parseISO(t.fim))}</td>
        <td>${t.progresso}%</td>
      </tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="4" style="text-align:center;color:#9ca3af;padding:16px">Seleciona pelo menos um projeto.</td></tr>';
    e.corpoTabelaPortGantt.querySelectorAll('[data-toggle-projeto]').forEach(span => {
      span.addEventListener('click', () => {
        const id = span.dataset.toggleProjeto;
        if (this.colapsadosPortGantt.has(id)) this.colapsadosPortGantt.delete(id); else this.colapsadosPortGantt.add(id);
        this.renderPortfolioGantt();
      });
    });
    e.corpoTabelaPortGantt.querySelectorAll('[data-mover-projeto]').forEach(btn => {
      btn.addEventListener('click', () => this.moverProjetoPortGantt(btn.dataset.moverProjeto, parseInt(btn.dataset.dir, 10)));
    });
    e.corpoTabelaPortGantt.querySelectorAll('.linha-tarefa-port').forEach(tr => {
      tr.addEventListener('click', () => {
        this.selecionarProjeto(tr.dataset.projetoId);
        this.selecionarTarefa(tr.dataset.tarefaId);
        this.renderProjetoSelect();
        this.irParaAba('gantt');
      });
    });

    const zoom = parseInt(e.selZoomPortGantt.value, 10) || 14;
    PortfolioGantt.render(e.ganttContainerPortfolio, selecionados, { zoom, colapsados: this.colapsadosPortGantt });
  },
  moverProjetoPortGantt(id, direcao) {
    if (!this.ordemPortGantt) return;
    const idx = this.ordemPortGantt.indexOf(id);
    const novoIdx = idx + direcao;
    if (idx === -1 || novoIdx < 0 || novoIdx >= this.ordemPortGantt.length) return;
    const tmp = this.ordemPortGantt[idx];
    this.ordemPortGantt[idx] = this.ordemPortGantt[novoIdx];
    this.ordemPortGantt[novoIdx] = tmp;
    this.renderPortfolioGantt();
  },

  // ---------- Agendamento automático ----------
  recalcularAgendamento(p) {
    for (let iter = 0; iter < 3; iter++) {
      this.recomputarResumos(p);
      this.relaxarPredecessoras(p);
    }
    this.recomputarResumos(p);
  },
  recomputarResumos(p) {
    const raizes = p.tarefas.filter(t => t.parentId === null);
    const visitar = (t) => {
      const filhos = this.filhosDe(p, t.id);
      if (filhos.length === 0) return;
      filhos.forEach(visitar);
      const inicios = filhos.map(f => DateUtil.parseISO(f.inicio).getTime());
      const fins = filhos.map(f => DateUtil.parseISO(f.fim).getTime());
      t.inicio = DateUtil.toISO(new Date(Math.min(...inicios)));
      t.fim = DateUtil.toISO(new Date(Math.max(...fins)));
      let totalDur = 0, somaPond = 0;
      filhos.forEach(f => {
        const dur = DateUtil.diffDays(DateUtil.parseISO(f.inicio), DateUtil.parseISO(f.fim)) + 1;
        totalDur += dur;
        somaPond += dur * (f.progresso || 0);
      });
      t.progresso = totalDur ? Math.round(somaPond / totalDur) : 0;
    };
    raizes.forEach(visitar);
  },
  relaxarPredecessoras(p) {
    const folhas = p.tarefas.filter(t => !this.temFilhos(p, t.id));
    const mapa = new Map(p.tarefas.map(t => [t.id, t]));
    for (let pass = 0; pass < folhas.length + 1; pass++) {
      let mudou = false;
      folhas.forEach(t => {
        if (!t.predecessores.length) return;
        const inicioAtual = DateUtil.parseISO(t.inicio);
        const fimAtual = DateUtil.parseISO(t.fim);
        const duracao = DateUtil.diffDays(inicioAtual, fimAtual);
        let minInicio = null;
        t.predecessores.forEach(pr => {
          const pred = mapa.get(pr.id);
          if (!pred) return;
          const predInicio = DateUtil.parseISO(pred.inicio);
          const predFim = DateUtil.parseISO(pred.fim);
          const atraso = pr.atraso || 0;
          let candidato;
          if (pr.tipo === 'FS') candidato = DateUtil.addDays(predFim, 1 + atraso);
          else if (pr.tipo === 'SS') candidato = DateUtil.addDays(predInicio, atraso);
          else if (pr.tipo === 'FF') candidato = DateUtil.addDays(predFim, atraso - duracao);
          else if (pr.tipo === 'SF') candidato = DateUtil.addDays(predInicio, atraso - duracao);
          if (candidato && (minInicio === null || candidato > minInicio)) minInicio = candidato;
        });
        if (minInicio && minInicio > inicioAtual) {
          t.inicio = DateUtil.toISO(minInicio);
          t.fim = DateUtil.toISO(DateUtil.addDays(minInicio, duracao));
          mudou = true;
        }
      });
      if (!mudou) break;
    }
  },

  // ---------- Flatten / render ----------
  flatten(p) {
    const out = [];
    const visitar = (parentId, nivel) => {
      p.tarefas.filter(t => t.parentId === parentId).forEach(t => {
        out.push({ tarefa: t, nivel });
        if (!this.colapsadas.has(t.id)) visitar(t.id, nivel + 1);
      });
    };
    visitar(null, 0);
    return out;
  },

  renderProjetoSelect() {
    const sel = this.els.selProjeto;
    sel.innerHTML = '';
    this.meusProjetosEnvolvidos().forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.idInterno ? p.idInterno + ' — ' : '') + p.nome + (p.cliente ? ' (' + p.cliente + ')' : '');
      if (p.id === this.state.projetoAtivoId) opt.selected = true;
      sel.appendChild(opt);
    });
  },

  renderTudo() {
    this.aplicarPermissoesUI();
    this.renderInfoProjeto();
    this.renderTabelaTarefas();
    this.renderGanttAtual();
    this.renderTabelaProjetos();
    this.renderPortefolio();
    this.renderTabelaRecursosCentral();
    this.renderTabelaEquipas();
    this.renderTabelaFeriados();
    this.renderTabelaAusencias();
    this.renderFiltroEquipaCap();
    this.renderCapacidade();
    this.renderFormRegisto();
    this.renderTabelaRegistos();
    this.renderFaturacao();
    this.renderAcompanhamento();
  },

  // Esconde/mostra grupos de navegação, separadores e botões consoante o papel do utilizador
  // autenticado. Chamado a cada renderTudo() — é barato (só toggles de style.display) e mantém a
  // interface correta mesmo depois de o próprio administrador alterar um papel.
  aplicarPermissoesUI() {
    const e = this.els;
    const admin = this.souAdmin();
    const gestorDeAlgo = this.souGestorDeAlgumProjeto();
    if (e.grupoBtnEquipa) e.grupoBtnEquipa.style.display = admin ? '' : 'none';
    if (e.tabBtnFaturacao) e.tabBtnFaturacao.style.display = gestorDeAlgo ? '' : 'none';
    if (e.tabBtnAcompanhamento) e.tabBtnAcompanhamento.style.display = gestorDeAlgo ? '' : 'none';
    ['btnNovoProjeto', 'btnNovoProjeto2', 'btnDuplicarProjeto', 'btnEliminarProjeto'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = admin ? '' : 'none';
    });
    if (!admin && ['recursos', 'capacidade', 'feriados'].includes(this.abaAtiva)) this.irParaAba('gantt');
    if (!gestorDeAlgo && ['faturacao', 'acompanhamento'].includes(this.abaAtiva)) this.irParaAba('gantt');
  },

  renderInfoProjeto() {
    const p = this.projetoAtivo();
    const e = this.els;
    const campos = [e.projIdInterno, e.projEstado, e.projNome, e.projCliente, e.projDescricao, e.projInicio, e.projFim, e.projHorasVendidas, e.projValorVendido];
    this.renderGestorConsultores(p);
    if (!p) {
      campos.forEach(c => { c.value = ''; c.disabled = true; });
      e.projValorHoraMedio.textContent = '—';
      e.projVersao.textContent = '—';
      e.projFaturacaoResumo.textContent = '—';
      e.projHorasReais.textContent = '—';
      e.projHorasEAC.textContent = '—';
      e.projHorasSaldo.textContent = '—';
      e.projEstadoOrc.textContent = '—';
      return;
    }
    const podeEditar = this.possoEditarProjeto(p.id);
    campos.forEach(c => { c.disabled = !podeEditar; });
    e.projIdInterno.value = p.idInterno || '';
    e.projEstado.value = p.estado || 'Por iniciar';
    e.projNome.value = p.nome;
    e.projCliente.value = p.cliente || '';
    e.projDescricao.value = p.descricao;
    e.projInicio.value = p.dataInicio;
    e.projFim.value = p.dataFim;
    e.projHorasVendidas.value = p.horasVendidas || 0;
    e.projValorVendido.value = p.valorVendido || 0;
    e.projValorHoraMedio.textContent = this.formatarValorHoraMedio(p);
    e.projVersao.textContent = DateUtil.formatDateTime(p.versao);
    const totalFaturado = this.totalFaturadoProjeto(p);
    const sobreFaturado = this.projetoSobreFaturado(p);
    const pctFaturado = p.valorVendido > 0 ? Math.round(totalFaturado / p.valorVendido * 100) : null;
    e.projFaturacaoResumo.textContent = `${totalFaturado.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €` + (p.valorVendido > 0 ? ` de ${p.valorVendido.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} € (${pctFaturado}%)` : '');
    e.projFaturacaoResumo.style.color = sobreFaturado ? 'var(--vermelho)' : '';

    const orc = this.avaliarOrcamentoProjeto(p);
    const corNivel = { verde: 'var(--verde)', amarelo: 'var(--amarelo)', vermelho: 'var(--vermelho)', neutro: '' };
    e.projHorasReais.textContent = `${orc.totalReal.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}h` + (p.horasVendidas > 0 ? ` de ${p.horasVendidas}h (${Math.round(orc.pctConsumido * 100)}%)` : '');
    e.projHorasEAC.textContent = `${orc.eac.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}h`;
    e.projHorasSaldo.textContent = orc.saldoDisponivel === null ? '—' : `${orc.saldoDisponivel.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}h`;
    e.projHorasSaldo.style.color = orc.saldoDisponivel !== null && orc.saldoDisponivel < 0 ? 'var(--vermelho)' : '';
    e.projEstadoOrc.textContent = orc.motivo;
    e.projEstadoOrc.style.color = corNivel[orc.nivel] || '';
  },
  formatarValorHoraMedio(p) {
    const horas = parseFloat(p.horasVendidas) || 0;
    const valor = parseFloat(p.valorVendido) || 0;
    if (!horas) return '—';
    return (valor / horas).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €/h';
  },
  // gestorId (e os ids dentro de recursoIds) são sempre ids de "recursos" — mesmo id que a app usa
  // em todo o lado para tarefas/capacidade/faturação.
  nomeUtilizador(recursoId) {
    const r = this.state.recursos.find(x => x.id === recursoId);
    return r ? (r.nome || r.email) : '—';
  },
  // Cartão "Gestor de Projeto" (atribuído pelo administrador) e lista, só de leitura, de quem já
  // está a trabalhar no projeto. Não há lista manual de consultores: aparece aqui quem já tem o
  // seu recurso atribuído a pelo menos uma tarefa — associar/desassociar faz-se no Gantt (coluna
  // "Consultores" da tabela de tarefas), nunca aqui.
  renderGestorConsultores(p) {
    const e = this.els;
    if (!e.projGestorId) return;
    const opcoesGestor = '<option value="">Sem gestor atribuído</option>' +
      this.state.utilizadores.map(u => `<option value="${u.recursoId}">${escapeHtml(u.nome || u.email)}</option>`).join('');
    e.projGestorId.innerHTML = opcoesGestor;
    e.projGestorId.value = p ? (p.gestorId || '') : '';
    e.projGestorId.disabled = !p || !this.souAdmin();

    const cardConsultores = document.getElementById('cardConsultores');
    if (!p) { if (cardConsultores) cardConsultores.style.display = 'none'; return; }
    if (cardConsultores) cardConsultores.style.display = '';
    const idsConsultores = new Set();
    p.tarefas.forEach(t => (t.recursoIds || []).forEach(rid => idsConsultores.add(rid)));
    const nomes = [...idsConsultores].map(rid => (this.state.recursos.find(r => r.id === rid) || {}).nome).filter(Boolean);
    e.listaConsultoresProjeto.innerHTML = nomes.length
      ? nomes.map(n => `<span class="chip">${escapeHtml(n)}</span>`).join(' ')
      : 'Ainda sem consultores — associa consultores às tarefas no Gantt.';
  },

  // ---------- Tab: Projetos ----------
  renderTabelaProjetos() {
    const tbody = this.els.corpoTabelaProjetos;
    tbody.innerHTML = '';
    const admin = this.souAdmin();
    const opcoesGestor = '<option value="">Sem gestor</option>' +
      this.state.utilizadores.map(u => `<option value="${u.recursoId}">${escapeHtml(u.nome || u.email)}</option>`).join('');
    this.meusProjetosEnvolvidos().forEach(p => {
      const tr = document.createElement('tr');
      const orc = this.avaliarOrcamentoProjeto(p);
      const corNivel = { verde: 'var(--verde)', amarelo: 'var(--amarelo)', vermelho: 'var(--vermelho)', neutro: 'var(--cinza-500)' };
      const podeEditar = this.possoEditarProjeto(p.id);
      const dis = podeEditar ? '' : 'disabled';
      tr.innerHTML = `
        <td><input type="text" value="${escapeAttr(p.idInterno || '')}" data-campo="idInterno" style="width:100px" ${dis}></td>
        <td><input type="text" value="${escapeAttr(p.nome)}" data-campo="nome" style="min-width:160px" ${dis}></td>
        <td><input type="text" value="${escapeAttr(p.cliente || '')}" data-campo="cliente" style="width:120px" ${dis}></td>
        <td>${admin
          ? `<select data-campo="gestorId" style="min-width:120px">${opcoesGestor}</select>`
          : escapeHtml(this.nomeUtilizador(p.gestorId))}</td>
        <td><input type="date" value="${p.dataInicio}" data-campo="dataInicio" ${dis}></td>
        <td><input type="date" value="${p.dataFim}" data-campo="dataFim" ${dis}></td>
        <td><input type="number" min="0" value="${p.horasVendidas || 0}" data-campo="horasVendidas" style="width:70px" ${dis}></td>
        <td><input type="number" min="0" value="${p.valorVendido || 0}" data-campo="valorVendido" style="width:90px" ${dis}></td>
        <td>${this.formatarValorHoraMedio(p)}</td>
        <td>
          <select data-campo="estado" ${dis}>
            ${['Por iniciar', 'Em curso', 'Concluído', 'Cancelado'].map(op => `<option ${p.estado === op ? 'selected' : ''}>${op}</option>`).join('')}
          </select>
        </td>
        <td>${orc.totalReal.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}</td>
        <td>${orc.eac.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}</td>
        <td style="color:${orc.saldoDisponivel !== null && orc.saldoDisponivel < 0 ? 'var(--vermelho)' : 'inherit'}">${orc.saldoDisponivel === null ? '—' : orc.saldoDisponivel.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}</td>
        <td>${orc.pctConsumido === null ? '—' : Math.round(orc.pctConsumido * 100) + '%'}</td>
        <td style="color:${corNivel[orc.nivel]}">${escapeHtml(orc.motivo)}</td>
        <td class="col-acoes">
          <button class="btn btn-sm" data-acao="abrir">Abrir</button>
          ${admin ? '<button class="btn-icon" data-acao="eliminar" title="Eliminar">🗑</button>' : ''}
        </td>`;
      if (admin) {
        tr.querySelector('[data-campo="gestorId"]').value = p.gestorId || '';
        tr.querySelector('[data-campo="gestorId"]').addEventListener('change', (ev) => {
          p.gestorId = ev.target.value || null;
          this.persist();
          this.renderTudo();
        });
      }
      tr.querySelectorAll('input[data-campo],select[data-campo="estado"]').forEach(inp => {
        inp.addEventListener('change', () => {
          p[inp.dataset.campo] = (inp.type === 'number') ? (parseFloat(inp.value) || 0) : inp.value;
          this.persist();
          this.renderTabelaProjetos();
          if (p.id === this.state.projetoAtivoId) { this.renderInfoProjeto(); this.renderProjetoSelect(); }
        });
      });
      tr.querySelector('[data-acao="abrir"]').addEventListener('click', () => this.abrirProjetoNoGantt(p.id));
      const btnEliminar = tr.querySelector('[data-acao="eliminar"]');
      if (btnEliminar) btnEliminar.addEventListener('click', () => this.eliminarProjeto(p.id));
      tbody.appendChild(tr);
    });
  },

  // ---------- Tab: Recursos ----------
  // "Pessoas" — lista única de recursos e acesso à plataforma (não duas entidades separadas):
  // criar conta cria/liga automaticamente um recurso com o mesmo email (ver handle_new_user no
  // schema); aqui só resta, para quem já tem conta, ajustar o papel de acesso (Administrador vs
  // Utilizador). Quem ainda não criou conta aparece como "Sem conta" — continua a poder ser usado
  // em tarefas/capacidade normalmente, só não pode ser Gestor/Consultor de projeto nem entrar na app.
  renderTabelaRecursosCentral() {
    const tbody = this.els.corpoTabelaRecursosCentral;
    tbody.innerHTML = '';
    const opcoesEquipas = '<option value="">Sem equipa</option>' + this.state.equipas.map(eq => `<option value="${eq.id}">${escapeHtml(eq.nome)}</option>`).join('');
    this.state.recursos.forEach(r => {
      const margem = r.precoVenda ? ((r.precoVenda - r.precoCusto) / r.precoVenda * 100) : 0;
      const perfil = this.state.utilizadores.find(u => u.recursoId === r.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" value="${escapeAttr(r.nome)}" data-campo="nome" style="min-width:140px"></td>
        <td><input type="text" value="${escapeAttr(r.email || '')}" data-campo="email" placeholder="email@exemplo.com" style="min-width:160px"></td>
        <td><input type="text" value="${escapeAttr(r.papel)}" data-campo="papel" style="min-width:120px"></td>
        <td><select data-campo="equipaId" style="min-width:110px">${opcoesEquipas}</select></td>
        <td><input type="number" min="0" step="0.5" value="${r.precoCusto}" data-campo="precoCusto" style="width:80px"></td>
        <td><input type="number" min="0" step="0.5" value="${r.precoVenda}" data-campo="precoVenda" style="width:80px"></td>
        <td>${margem.toFixed(1)}%</td>
        <td>${perfil ? `<select data-acesso style="min-width:110px"><option value="user" ${perfil.papel === 'user' ? 'selected' : ''}>Utilizador</option><option value="admin" ${perfil.papel === 'admin' ? 'selected' : ''}>Administrador</option></select>` : '<span class="hint">Sem conta</span>'}</td>
        <td class="col-acoes">
          <button class="btn btn-sm" data-acao="alocacoes" title="Ver projetos, atividades e datas em que este consultor está alocado">📅 Alocações</button>
          <button class="btn-icon" data-acao="eliminar" title="Eliminar">🗑</button>
        </td>`;
      tr.querySelector('[data-campo="equipaId"]').value = r.equipaId || '';
      tr.querySelectorAll('[data-campo]').forEach(inp => {
        inp.addEventListener('change', () => this.atualizarRecurso(r.id, inp.dataset.campo, inp.value));
      });
      const selAcesso = tr.querySelector('[data-acesso]');
      if (selAcesso) {
        selAcesso.addEventListener('change', async (ev) => {
          const novoPapel = ev.target.value;
          if (perfil.id === this.usuarioAtualId && novoPapel !== 'admin' && !confirm('Vais remover o teu próprio papel de Administrador. Continuar?')) {
            ev.target.value = perfil.papel;
            return;
          }
          try {
            await Sync.atualizarUtilizador(perfil.id, { papel: novoPapel });
            perfil.papel = novoPapel;
            this.renderTudo();
            this.toast('Acesso atualizado.');
          } catch (err) {
            this.toast('Erro ao atualizar acesso: ' + err.message);
            ev.target.value = perfil.papel;
          }
        });
      }
      tr.querySelector('[data-acao="alocacoes"]').addEventListener('click', () => this.abrirModalAlocacoesRecurso(r.id));
      tr.querySelector('[data-acao="eliminar"]').addEventListener('click', () => this.eliminarRecurso(r.id));
      tbody.appendChild(tr);
    });
  },

  renderTabelaEquipas() {
    const tbody = this.els.corpoTabelaEquipas;
    if (!tbody) return;
    tbody.innerHTML = '';
    this.state.equipas.forEach(eq => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" value="${escapeAttr(eq.nome)}" data-campo="nome"></td>
        <td class="col-acoes"><button class="btn-icon" title="Eliminar">🗑</button></td>`;
      tr.querySelector('input').addEventListener('change', (e) => this.atualizarEquipa(eq.id, e.target.value));
      tr.querySelector('button').addEventListener('click', () => this.eliminarEquipa(eq.id));
      tbody.appendChild(tr);
    });
  },

  renderFiltroEquipaCap() {
    const sel = this.els.selEquipaCap;
    if (!sel) return;
    const valorAtual = this.filtroEquipaCap;
    sel.innerHTML = '<option value="">Todas</option>' + this.state.equipas.map(eq => `<option value="${eq.id}">${escapeHtml(eq.nome)}</option>`).join('');
    sel.value = valorAtual;
    if (sel.value !== valorAtual) { this.filtroEquipaCap = ''; sel.value = ''; }
  },

  // ---------- Tab: Feriados & Ausências ----------
  renderTabelaFeriados() {
    const tbody = this.els.corpoTabelaFeriados;
    tbody.innerHTML = '';
    this.state.feriados.slice().sort((a, b) => a.data < b.data ? -1 : 1).forEach(f => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="date" value="${f.data}" data-campo="data"></td>
        <td><input type="text" value="${escapeAttr(f.descricao)}" data-campo="descricao" style="min-width:200px"></td>
        <td class="col-acoes"><button class="btn-icon" title="Eliminar">🗑</button></td>`;
      tr.querySelectorAll('input[data-campo]').forEach(inp => {
        inp.addEventListener('change', () => this.atualizarFeriado(f.id, inp.dataset.campo, inp.value));
      });
      tr.querySelector('button').addEventListener('click', () => this.eliminarFeriado(f.id));
      tbody.appendChild(tr);
    });
  },
  renderTabelaAusencias() {
    const tbody = this.els.corpoTabelaAusencias;
    tbody.innerHTML = '';
    const opcoesRecursos = this.state.recursos.map(r => `<option value="${r.id}">${escapeHtml(r.nome)}</option>`).join('');
    this.state.ausencias.forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><select data-campo="recursoId">${opcoesRecursos}</select></td>
        <td>
          <select data-campo="tipo">
            ${['Férias', 'Baixa', 'Formação', 'Outro'].map(op => `<option ${a.tipo === op ? 'selected' : ''}>${op}</option>`).join('')}
          </select>
        </td>
        <td><input type="date" value="${a.dataInicio}" data-campo="dataInicio"></td>
        <td><input type="date" value="${a.dataFim}" data-campo="dataFim" min="${a.dataInicio}"></td>
        <td><input type="text" value="${escapeAttr(a.notas)}" data-campo="notas" style="min-width:140px"></td>
        <td class="col-acoes"><button class="btn-icon" title="Eliminar">🗑</button></td>`;
      tr.querySelector('[data-campo="recursoId"]').value = a.recursoId;
      tr.querySelectorAll('[data-campo]').forEach(inp => {
        inp.addEventListener('change', () => this.atualizarAusencia(a.id, inp.dataset.campo, inp.value));
      });
      tr.querySelector('button').addEventListener('click', () => this.eliminarAusencia(a.id));
      tbody.appendChild(tr);
    });
  },

  // ---------- Tab: Capacidade ----------
  renderCapacidade() {
    const e = this.els;
    if (!e.gridCapacidade) return;
    const nMeses = parseInt(e.selHorizonteCap.value, 10) || 6;
    const meses = Capacidade.horizonteMeses(nMeses);

    e.heatmapCapHead.innerHTML = '<th>Consultor</th>' + meses.map(m => `<th>${escapeHtml(m.label)}</th>`).join('');
    e.heatmapCapBody.innerHTML = '';
    e.gridCapacidade.innerHTML = '';

    this.filtroEquipaCap = e.selEquipaCap.value;
    const recursosFiltrados = this.filtroEquipaCap
      ? this.state.recursos.filter(r => String(r.equipaId || '') === this.filtroEquipaCap)
      : this.state.recursos;

    if (this.state.recursos.length === 0) {
      e.gridCapacidade.innerHTML = '<p style="color:#9ca3af">Sem consultores definidos. Adiciona no separador "Pessoas".</p>';
      return;
    }
    if (recursosFiltrados.length === 0) {
      e.gridCapacidade.innerHTML = '<p style="color:#9ca3af">Nenhum consultor nesta equipa.</p>';
      return;
    }

    recursosFiltrados.forEach(r => {
      const resumos = meses.map(m => Object.assign({ label: m.label }, Capacidade.resumoMes(r, m.ano, m.mes)));

      const tr = document.createElement('tr');
      const celulas = resumos.map(res => {
        const cls = Capacidade.classeResumo(res);
        const temContexto = res.capacidade > 0 || res.alocado > 0;
        const texto = !temContexto ? '—' : (isFinite(res.pct) ? Math.round(res.pct * 100) + '%' : '⚠');
        const dica = res.diasConflito > 0 ? ` — ⚠ ${res.diasConflito} dia(s) em conflito (indisponível ou sobre-alocado)` : '';
        return `<td class="occ-${cls}" title="${res.alocado.toFixed(0)}h alocadas / ${res.capacidade.toFixed(0)}h capacidade${dica}">${texto}</td>`;
      }).join('');
      tr.innerHTML = `<th>${escapeHtml(r.nome)}</th>${celulas}`;
      e.heatmapCapBody.appendChild(tr);

      const mesAtual = resumos[0];
      const revenueTotal = resumos.reduce((s, res) => s + res.alocado, 0) * (r.precoVenda || 0);
      const projetos = Capacidade.projetosDoRecurso(r.id);
      const sobreAlocados = resumos.filter(res => res.diasConflito > 0).map(res => res.label);
      const clsMesAtual = Capacidade.classeResumo(mesAtual);

      const equipa = this.state.equipas.find(eq => eq.id === r.equipaId);
      const card = document.createElement('div');
      card.className = 'card-capacidade';
      card.innerHTML = `
        <div class="cap-head">
          <div><b>${escapeHtml(r.nome)}</b><div class="cap-papel">${escapeHtml(r.papel || '')}${equipa ? ' · ' + escapeHtml(equipa.nome) : ''}</div></div>
          <div class="cap-pct cap-${clsMesAtual}">${(mesAtual.capacidade > 0 || mesAtual.alocado > 0) ? (isFinite(mesAtual.pct) ? Math.round(mesAtual.pct * 100) + '%' : '⚠') : '—'}</div>
        </div>
        <div class="cap-bar"><div class="cap-bar-fill cap-${clsMesAtual}" style="width:${Math.min(isFinite(mesAtual.pct) ? mesAtual.pct * 100 : 100, 100)}%"></div></div>
        <div class="cap-meta">Mês atual: ${mesAtual.alocado.toFixed(0)}h alocadas / ${mesAtual.capacidade.toFixed(0)}h disponíveis</div>
        <div class="cap-meses">
          ${resumos.map(res => `<div class="cap-mes-barra" title="${escapeHtml(res.label)}: ${isFinite(res.pct) ? Math.round(res.pct * 100) : 0}%"><div class="cap-mes-fill cap-${Capacidade.classeResumo(res)}" style="height:${Math.max(Math.min(res.pct * 100, 100), res.alocado > 0 ? 6 : 0)}%"></div></div>`).join('')}
        </div>
        <div class="cap-revenue">Revenue previsto (${nMeses}m): <b>${revenueTotal.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €</b></div>
        ${sobreAlocados.length ? `<div class="cap-alerta">⚠ Sobre-alocado em: ${sobreAlocados.map(escapeHtml).join(', ')}</div>` : ''}
        <div class="cap-projetos">
          ${projetos.length ? projetos.map(pr => `<div class="cap-projeto-linha">${escapeHtml(pr.projeto.nome)}<span class="cap-projeto-datas">${DateUtil.formatShort(DateUtil.parseISO(pr.inicio))} – ${DateUtil.formatShort(DateUtil.parseISO(pr.fim))}</span></div>`).join('') : '<span style="color:#9ca3af">Sem alocações.</span>'}
        </div>`;
      e.gridCapacidade.appendChild(card);
    });
  },

  // ---------- Tab: Registo de Horas ----------
  // Recursos que o utilizador autenticado pode escolher como "Pessoa": Admin vê todos; Gestor vê
  // os recursos já atribuídos a alguma tarefa nos projetos que gere (+ o seu próprio); Consultor
  // só se vê a si próprio (recurso ligado ao seu login) — nunca em nome de outra pessoa.
  recursosPermitidosRegisto() {
    if (this.souAdmin()) return this.state.recursos;
    const meuRecursoId = this.perfilAtual()?.recursoId;
    if (!this.souGestorDeAlgumProjeto()) {
      return meuRecursoId ? this.state.recursos.filter(r => r.id === meuRecursoId) : [];
    }
    const idsPermitidos = new Set(meuRecursoId ? [meuRecursoId] : []);
    Object.values(this.state.projetos).forEach(p => {
      if (!this.souGestorDe(p.id)) return;
      p.tarefas.forEach(t => (t.recursoIds || []).forEach(rid => idsPermitidos.add(rid)));
    });
    return this.state.recursos.filter(r => idsPermitidos.has(r.id));
  },
  // Projetos em que o utilizador pode registar horas: Admin todos; Gestor só os que gere;
  // Consultor só os em que está envolvido.
  projetosRegistoPermitidos() {
    const comId = Object.values(this.state.projetos).filter(p => p.idInterno);
    if (this.souAdmin()) return comId;
    return comId.filter(p => this.estouEnvolvidoEm(p.id));
  },
  renderFormRegisto() {
    const e = this.els;
    if (!e.regPessoa) return;
    const recursosPermitidos = this.recursosPermitidosRegisto();
    const somenteEuProprio = !this.souAdmin() && !this.souGestorDeAlgumProjeto();
    const valorAtualPessoa = e.regPessoa.value;
    e.regPessoa.innerHTML = '<option value="">Seleciona…</option>' + recursosPermitidos.map(r => `<option value="${escapeAttr(r.nome)}">${escapeHtml(r.nome)}</option>`).join('');
    let ultimaPessoa = '';
    try { ultimaPessoa = localStorage.getItem(this.ULTIMA_PESSOA_KEY) || ''; } catch (err) { /* ignora */ }
    e.regPessoa.value = valorAtualPessoa || (somenteEuProprio && recursosPermitidos[0] ? recursosPermitidos[0].nome : ultimaPessoa);
    e.regPessoa.disabled = somenteEuProprio;
    if (e.regMsg) {
      if (!recursosPermitidos.length) {
        e.regMsg.textContent = somenteEuProprio ? 'A tua conta ainda não está associada a um consultor — contacta o administrador.' : '';
        e.regMsg.style.color = 'var(--vermelho)';
      } else if (e.regMsg.textContent.includes('associada a um consultor')) {
        e.regMsg.textContent = '';
      }
    }
    if (e.formRegisto) e.formRegisto.querySelectorAll('input,select,textarea,button').forEach(c => { if (c !== e.regPessoa) c.disabled = !recursosPermitidos.length; });

    this.renderProjetosRegisto();

    if (!e.regData.value) e.regData.value = DateUtil.todayISO();

    const projetosComId = this.projetosRegistoPermitidos();
    const filtrosProjetos = '<option value="">Todos</option>' + projetosComId.map(p => `<option value="${escapeAttr(p.idInterno)}">${escapeHtml(p.idInterno)} — ${escapeHtml(p.nome)}${p.cliente ? ` (${escapeHtml(p.cliente)})` : ''}</option>`).join('');
    const valorFiltroProjeto = e.fRegProjeto.value;
    e.fRegProjeto.innerHTML = filtrosProjetos;
    e.fRegProjeto.value = valorFiltroProjeto;
    const filtrosPessoas = '<option value="">Todas</option>' + recursosPermitidos.map(r => `<option value="${escapeAttr(r.nome)}">${escapeHtml(r.nome)}</option>`).join('');
    const valorFiltroPessoa = e.fRegPessoa.value;
    e.fRegPessoa.innerHTML = filtrosPessoas;
    e.fRegPessoa.value = valorFiltroPessoa;
  },
  // Só mostra, no registo de horas, os projetos aos quais a pessoa selecionada já está
  // efetivamente associada (tem pelo menos uma tarefa com o seu recurso atribuído) — evita
  // registos de horas em projetos/atividades a que a pessoa não pertence.
  renderProjetosRegisto() {
    const e = this.els;
    const valorAtualProjeto = e.regProjeto.value;
    const recurso = this.recursosPermitidosRegisto().find(r => r.nome === e.regPessoa.value);
    const projetosComId = this.projetosRegistoPermitidos();
    const projetosDaPessoa = recurso ? projetosComId.filter(p => p.tarefas.some(t => t.recursoIds.includes(recurso.id))) : [];
    e.regProjeto.innerHTML = `<option value="">${recurso ? 'Seleciona…' : 'Seleciona primeiro a pessoa…'}</option>` + projetosDaPessoa.map(p => `<option value="${escapeAttr(p.idInterno)}">${escapeHtml(p.idInterno)} — ${escapeHtml(p.nome)}${p.cliente ? ` (${escapeHtml(p.cliente)})` : ''}</option>`).join('');
    e.regProjeto.disabled = !recurso;
    e.regProjeto.value = projetosDaPessoa.some(p => p.idInterno === valorAtualProjeto) ? valorAtualProjeto : '';
    this.renderTarefasRegisto();
  },
  renderTarefasRegisto() {
    const e = this.els;
    const p = Object.values(this.state.projetos).find(pr => pr.idInterno === e.regProjeto.value);
    const recurso = this.state.recursos.find(r => r.nome === e.regPessoa.value);
    const opcoes = (p && recurso) ? this.flatten(p).filter(x => !this.temFilhos(p, x.tarefa.id) && x.tarefa.recursoIds.includes(recurso.id)).map(x => `<option value="${escapeAttr(x.tarefa.nome)}">${escapeHtml(x.tarefa.nome)}</option>`).join('') : '';
    e.regTarefa.innerHTML = `<option value="">${p ? 'Seleciona…' : 'Seleciona primeiro o projeto…'}</option>` + opcoes;
    e.regTarefa.disabled = !p;
  },
  submeterFormRegisto() {
    const e = this.els;
    const pessoa = e.regPessoa.value;
    const data = e.regData.value;
    const projetoIdInterno = e.regProjeto.value;
    const tarefaNome = e.regTarefa.value;
    const horas = parseFloat(e.regHoras.value);
    const notas = e.regNotas.value.trim();

    if (!pessoa || !data || !projetoIdInterno || !tarefaNome || !horas || horas <= 0) {
      e.regMsg.textContent = 'Preenche pessoa, data, projeto, tarefa e horas.';
      e.regMsg.style.color = 'var(--vermelho)';
      return;
    }
    // Reforça na submissão as mesmas restrições já aplicadas ao preencher os selects — o valor
    // guardado no <select> nunca deve sair fora do que o papel do utilizador autoriza.
    if (!this.recursosPermitidosRegisto().some(r => r.nome === pessoa) || !this.projetosRegistoPermitidos().some(p => p.idInterno === projetoIdInterno)) {
      e.regMsg.textContent = 'Não tens permissão para registar horas nesta pessoa/projeto.';
      e.regMsg.style.color = 'var(--vermelho)';
      return;
    }
    const proj = Object.values(this.state.projetos).find(pr => pr.idInterno === projetoIdInterno);
    const projetoNome = proj ? proj.nome : projetoIdInterno;
    const payload = {
      data, pessoa, projetoIdInterno, projetoNome, projetoId: proj ? proj.id : null, tarefaNome, horas, notas,
      origem: 'app-gestor-projetos', userId: this.usuarioAtualId, submetidoEm: new Date().toISOString()
    };

    this.submeterRegisto(payload);

    e.regMsg.textContent = 'Registo guardado.';
    e.regMsg.style.color = 'var(--verde)';
    e.regProjeto.value = '';
    this.renderTarefasRegisto();
    e.regHoras.value = '';
    e.regNotas.value = '';
  },
  aplicarFiltrosRegisto() {
    const e = this.els;
    this.filtrosRegisto = {
      pessoa: e.fRegPessoa.value, projeto: e.fRegProjeto.value,
      de: e.fRegDe.value, ate: e.fRegAte.value, texto: e.fRegTexto.value.trim().toLowerCase()
    };
    this.paginaRegistos = 1;
    this.renderTabelaRegistos();
  },
  // Extrai de um registo o valor comparável para a coluna de ordenação atual.
  valorOrdenacaoRegisto(r, campo) {
    switch (campo) {
      case 'projeto': return `${r.projetoIdInterno || ''} ${r.projetoNome || ''}`.toLowerCase();
      case 'tarefaNome': return (r.tarefaNome || '').toLowerCase();
      case 'horas': return parseFloat(r.horas) || 0;
      case 'notas': return (r.notas || '').toLowerCase();
      case 'origem': return (r.origem || '').toLowerCase();
      case 'pessoa': return (r.pessoa || '').toLowerCase();
      default: return r.data || '';
    }
  },
  renderTabelaRegistos() {
    const e = this.els;
    if (!e.corpoTabelaRegistos) return;
    const f = this.filtrosRegisto;
    const { campo, dir } = this.ordenacaoRegistos;
    const mult = dir === 'desc' ? -1 : 1;
    const filtrados = this.state.registos.filter(r => {
      if (f.pessoa && r.pessoa !== f.pessoa) return false;
      if (f.projeto && r.projetoIdInterno !== f.projeto) return false;
      if (f.de && r.data < f.de) return false;
      if (f.ate && r.data > f.ate) return false;
      if (f.texto && !((r.tarefaNome || '').toLowerCase().includes(f.texto) || r.notas.toLowerCase().includes(f.texto))) return false;
      return true;
    }).sort((a, b) => {
      const va = this.valorOrdenacaoRegisto(a, campo), vb = this.valorOrdenacaoRegisto(b, campo);
      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return b.id - a.id;
    });

    document.querySelectorAll('#tabelaRegistos thead th[data-sort]').forEach(th => {
      const ativo = th.dataset.sort === campo;
      th.classList.toggle('ord-asc', ativo && dir === 'asc');
      th.classList.toggle('ord-desc', ativo && dir === 'desc');
    });

    const totalHoras = filtrados.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
    const nomesPessoas = new Set(filtrados.map(r => r.pessoa)).size;
    const nomesProjetos = new Set(filtrados.map(r => r.projetoIdInterno)).size;
    e.statsRegisto.innerHTML = `
      <span><b>${filtrados.length}</b> registo(s)</span>
      <span><b>${totalHoras.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}h</b> total</span>
      <span><b>${nomesPessoas}</b> pessoa(s)</span>
      <span><b>${nomesProjetos}</b> projeto(s)</span>`;

    const tamanho = this.TAMANHO_PAGINA_REGISTOS;
    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / tamanho));
    this.paginaRegistos = Math.min(Math.max(1, this.paginaRegistos), totalPaginas);
    const inicio = (this.paginaRegistos - 1) * tamanho;
    const pagina = filtrados.slice(inicio, inicio + tamanho);

    e.corpoTabelaRegistos.innerHTML = pagina.length ? pagina.map(r => `
      <tr>
        <td>${DateUtil.formatShort(DateUtil.parseISO(r.data))}</td>
        <td>${escapeHtml(r.pessoa)}</td>
        <td>${escapeHtml(r.projetoIdInterno)} — ${escapeHtml(r.projetoNome)}</td>
        <td>${escapeHtml(r.tarefaNome) || '<span style="color:#9ca3af">—</span>'}</td>
        <td>${(parseFloat(r.horas) || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}h</td>
        <td>${escapeHtml(r.notas)}</td>
        <td><span style="color:#9ca3af;font-size:11px">${escapeHtml(r.origem)}</span></td>
        <td class="col-acoes"><button class="btn-icon" data-eliminar="${r.id}" title="Eliminar">🗑</button></td>
      </tr>`).join('') : '<tr class="empty-row"><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">Sem registos para os filtros selecionados.</td></tr>';
    e.corpoTabelaRegistos.querySelectorAll('[data-eliminar]').forEach(btn => {
      btn.addEventListener('click', () => this.eliminarRegisto(btn.dataset.eliminar));
    });

    if (e.paginacaoRegistos) {
      e.paginacaoRegistos.innerHTML = filtrados.length ? `
        <button class="btn btn-sm" id="btnPaginaRegistosAnt" ${this.paginaRegistos <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span>Página ${this.paginaRegistos} de ${totalPaginas}</span>
        <button class="btn btn-sm" id="btnPaginaRegistosSeg" ${this.paginaRegistos >= totalPaginas ? 'disabled' : ''}>Seguinte ›</button>` : '';
      const btnAnt = document.getElementById('btnPaginaRegistosAnt');
      const btnSeg = document.getElementById('btnPaginaRegistosSeg');
      if (btnAnt) btnAnt.addEventListener('click', () => { this.paginaRegistos--; this.renderTabelaRegistos(); });
      if (btnSeg) btnSeg.addEventListener('click', () => { this.paginaRegistos++; this.renderTabelaRegistos(); });
    }
  },

  // ---------- Tab: Faturação ----------
  renderFaturacao() {
    const e = this.els;
    if (!e.corpoTabelaFaturas) return;
    const valorFiltro = e.fFatProjeto.value;
    const todosProjetos = Object.values(this.state.projetos).filter(p => this.possoEditarProjeto(p.id));
    e.fFatProjeto.innerHTML = '<option value="">Todos</option>' + todosProjetos.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.idInterno ? p.idInterno + ' — ' : '')}${escapeHtml(p.nome)}${p.cliente ? ` (${escapeHtml(p.cliente)})` : ''}</option>`).join('');
    e.fFatProjeto.value = valorFiltro;
    this.renderTabelaFaturas();
  },
  aplicarFiltrosFaturacao() {
    const e = this.els;
    this.filtrosFaturacao = {
      projeto: e.fFatProjeto.value, de: e.fFatDe.value, ate: e.fFatAte.value,
      numRegisto: e.fFatNumRegisto.value.trim().toLowerCase()
    };
    this.renderTabelaFaturas();
  },
  // Extrai de uma linha {projeto, fatura} o valor comparável para a coluna de ordenação atual.
  valorOrdenacaoFatura(l, campo) {
    const p = l.projeto, f = l.fatura;
    switch (campo) {
      case 'projeto': return (p.idInterno || p.nome).toLowerCase();
      case 'tipo': return f.tipo;
      case 'percentagem': return f.tipo === 'percentagem' ? (parseFloat(f.percentagem) || 0) : -1;
      case 'valor': return this.valorFatura(f, p);
      case 'emitida': return f.emitida ? 1 : 0;
      case 'emitidoPor': return (f.emitidoPor || '').toLowerCase();
      case 'numeroRegisto': return (f.numeroRegisto || '').toLowerCase();
      case 'dataEmissao': return f.dataEmissao || '';
      default: return f.dataPrevista || '';
    }
  },
  renderTabelaFaturas() {
    const e = this.els;
    if (!e.corpoTabelaFaturas) return;
    const f = this.filtrosFaturacao || {};
    const { campo, dir } = this.ordenacaoFaturas;
    const mult = dir === 'desc' ? -1 : 1;
    const linhas = [];
    Object.values(this.state.projetos).filter(p => this.possoEditarProjeto(p.id)).forEach(p => {
      (p.faturas || []).forEach(fat => linhas.push({ projeto: p, fatura: fat }));
    });
    const filtradas = linhas.filter(({ projeto: p, fatura: fat }) => {
      if (f.projeto && p.id !== f.projeto) return false;
      if (f.de && fat.dataPrevista < f.de) return false;
      if (f.ate && fat.dataPrevista > f.ate) return false;
      if (f.numRegisto && !(fat.numeroRegisto || '').toLowerCase().includes(f.numRegisto)) return false;
      return true;
    }).sort((a, b) => {
      const va = this.valorOrdenacaoFatura(a, campo), vb = this.valorOrdenacaoFatura(b, campo);
      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
    });

    document.querySelectorAll('#tabelaFaturas thead th[data-sort]').forEach(th => {
      const ativo = th.dataset.sort === campo;
      th.classList.toggle('ord-asc', ativo && dir === 'asc');
      th.classList.toggle('ord-desc', ativo && dir === 'desc');
    });

    const totalPrevisto = linhas.reduce((s, l) => s + this.valorFatura(l.fatura, l.projeto), 0);
    const totalEmitido = linhas.filter(l => l.fatura.emitida).reduce((s, l) => s + this.valorFatura(l.fatura, l.projeto), 0);
    const projetosSobreFaturados = new Set(linhas.filter(l => this.projetoSobreFaturado(l.projeto)).map(l => l.projeto.id)).size;
    e.statsFaturacao.innerHTML = `
      <span><b>${linhas.length}</b> fatura(s)</span>
      <span><b>${totalPrevisto.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €</b> previsto</span>
      <span><b>${totalEmitido.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €</b> emitido</span>
      ${projetosSobreFaturados ? `<span style="color:#dc2626;"><b>⚠ ${projetosSobreFaturados}</b> projeto(s) acima do valor vendido</span>` : ''}`;

    e.corpoTabelaFaturas.innerHTML = '';
    if (!filtradas.length) {
      e.corpoTabelaFaturas.innerHTML = '<tr class="empty-row"><td colspan="10" style="text-align:center;color:#9ca3af;padding:20px">Sem faturas para os filtros selecionados.</td></tr>';
      return;
    }
    filtradas.forEach(({ projeto: p, fatura: fat }) => {
      const valor = this.valorFatura(fat, p);
      const sobreFaturado = this.projetoSobreFaturado(p);
      const tr = document.createElement('tr');
      tr.className = sobreFaturado ? 'linha-sobre-faturado' : '';
      tr.innerHTML = `
        <td>${escapeHtml(p.idInterno || p.nome)}${p.cliente ? ` <span style="color:var(--cinza-500);">(${escapeHtml(p.cliente)})</span>` : ''}</td>
        <td><input type="date" value="${fat.dataPrevista}" data-campo="dataPrevista"></td>
        <td>
          <select data-campo="tipo">
            <option value="percentagem" ${fat.tipo === 'percentagem' ? 'selected' : ''}>%</option>
            <option value="valor" ${fat.tipo === 'valor' ? 'selected' : ''}>Valor (€)</option>
          </select>
        </td>
        <td><input type="number" min="0" max="100" step="1" value="${fat.percentagem}" data-campo="percentagem" ${fat.tipo !== 'percentagem' ? 'disabled' : ''} style="width:56px"></td>
        <td>${sobreFaturado ? `<span title="Este projeto tem faturas acima do valor vendido.">⚠</span> ` : ''}${fat.tipo === 'percentagem'
          ? `<span>${valor.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} €</span>`
          : `<input type="number" min="0" step="0.01" value="${fat.valor}" data-campo="valor" style="width:90px">`}</td>
        <td style="text-align:center"><input type="checkbox" data-campo="emitida" ${fat.emitida ? 'checked' : ''}></td>
        <td><input type="date" value="${fat.dataEmissao || ''}" data-campo="dataEmissao" ${!fat.emitida ? 'disabled' : ''}></td>
        <td><input type="text" value="${escapeAttr(fat.emitidoPor)}" data-campo="emitidoPor" ${!fat.emitida ? 'disabled' : ''} style="width:110px"></td>
        <td><input type="text" value="${escapeAttr(fat.numeroRegisto)}" data-campo="numeroRegisto" ${!fat.emitida ? 'disabled' : ''} style="width:110px"></td>
        <td class="col-acoes"><button class="btn-icon" title="Eliminar">🗑</button></td>`;
      tr.querySelectorAll('[data-campo]').forEach(inp => {
        inp.addEventListener('change', () => {
          const valorCampo = inp.type === 'checkbox' ? inp.checked : inp.value;
          this.atualizarFatura(p.id, fat.id, inp.dataset.campo, valorCampo);
        });
      });
      tr.querySelector('button').addEventListener('click', () => this.eliminarFatura(p.id, fat.id));
      e.corpoTabelaFaturas.appendChild(tr);
    });
  },

  // ---------- Tab: Acompanhamento (pontos de situação + next steps) ----------
  // Só o Administrador cria/apaga pontos de situação e cria/fecha next steps; o Gestor do projeto
  // só atualiza estado/notas dos next steps já existentes. Mostra sempre o projeto ativo do Gantt
  // (não tem filtro de projeto próprio, ao contrário da Faturação).
  criarPontoSituacao() {
    if (!this.souAdmin()) return;
    const p = this.projetoAtivo();
    if (!p) return;
    p.pontosSituacao.push(this.novoPontoSituacaoObj('', this.perfilAtual()?.recursoId));
    this.persist();
    this.renderAcompanhamento();
  },
  atualizarPontoSituacao(id, campo, valor) {
    if (!this.souAdmin()) return;
    const p = this.projetoAtivo();
    const ps = p && p.pontosSituacao.find(x => x.id === id);
    if (!ps) return;
    ps[campo] = valor;
    this.persist();
    this.renderAcompanhamento();
  },
  eliminarPontoSituacao(id) {
    if (!this.souAdmin()) return;
    const p = this.projetoAtivo();
    if (!p || !confirm('Eliminar este ponto de situação?')) return;
    p.pontosSituacao = p.pontosSituacao.filter(x => x.id !== id);
    this.persist();
    this.renderAcompanhamento();
  },
  criarProximoPasso() {
    if (!this.souAdmin()) return;
    const p = this.projetoAtivo();
    if (!p) return;
    const ultimoPonto = [...p.pontosSituacao].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)).pop();
    p.proximosPassos.push(this.novoProximoPassoObj('Novo next step', null, ultimoPonto ? ultimoPonto.id : null, this.perfilAtual()?.recursoId));
    this.persist();
    this.renderAcompanhamento();
  },
  // "estado"/"notas" podem ser editados por quem pode editar o projeto (admin ou gestor);
  // "descricao"/"tarefaId" só pelo admin, que é quem define o next step. Nada se edita depois de fechado.
  atualizarProximoPasso(id, campo, valor) {
    const p = this.projetoAtivo();
    if (!p || !this.possoEditarProjeto(p.id)) return;
    const pp = p.proximosPassos.find(x => x.id === id);
    if (!pp || pp.fechado) return;
    if (['descricao', 'tarefaId'].includes(campo) && !this.souAdmin()) return;
    pp[campo] = campo === 'tarefaId' ? (valor || null) : valor;
    pp.atualizadoEm = new Date().toISOString();
    this.persist();
    this.renderAcompanhamento();
  },
  fecharProximoPasso(id) {
    if (!this.souAdmin()) return;
    const p = this.projetoAtivo();
    const pp = p && p.proximosPassos.find(x => x.id === id);
    if (!pp) return;
    pp.fechado = true;
    pp.fechadoEm = pp.atualizadoEm = new Date().toISOString();
    this.persist();
    this.renderAcompanhamento();
  },
  renderAcompanhamento() {
    const e = this.els;
    if (!e.corpoPontosSituacao) return;
    const p = this.projetoAtivo();
    const podeVer = !!p && this.possoEditarProjeto(p.id);
    const btnAddPS = document.getElementById('btnAddPontoSituacao');
    const btnAddPP = document.getElementById('btnAddProximoPasso');
    e.acompanhamentoProjetoNome.textContent = p ? p.nome : '—';
    e.acompanhamentoConteudo.style.display = podeVer ? '' : 'none';
    e.acompanhamentoSemProjeto.style.display = podeVer ? 'none' : '';
    e.acompanhamentoSemProjeto.textContent = p ? 'Não tens acesso ao acompanhamento deste projeto.' : 'Escolhe um projeto no separador "Gantt do Projeto" primeiro.';
    const admin = this.souAdmin();
    if (btnAddPS) btnAddPS.style.display = (podeVer && admin) ? '' : 'none';
    if (btnAddPP) btnAddPP.style.display = (podeVer && admin) ? '' : 'none';
    if (!podeVer) return;

    const pontos = [...p.pontosSituacao].sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm));
    e.corpoPontosSituacao.innerHTML = pontos.length ? '' : '<tr class="empty-row"><td colspan="3" style="text-align:center;color:#9ca3af;padding:16px">Sem pontos de situação registados.</td></tr>';
    pontos.forEach(ps => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${admin ? `<input type="date" value="${ps.data}" data-campo="data">` : escapeHtml(DateUtil.formatShort(DateUtil.parseISO(ps.data)))}</td>
        <td>${admin ? `<textarea data-campo="feedback" rows="2" style="width:100%;resize:vertical;">${escapeHtml(ps.feedback)}</textarea>` : escapeHtml(ps.feedback)}</td>
        <td class="col-acoes">${admin ? '<button class="btn-icon" data-acao="eliminar" title="Eliminar">🗑</button>' : ''}</td>`;
      if (admin) {
        tr.querySelectorAll('[data-campo]').forEach(inp => {
          inp.addEventListener('change', () => this.atualizarPontoSituacao(ps.id, inp.dataset.campo, inp.value));
        });
        tr.querySelector('[data-acao="eliminar"]').addEventListener('click', () => this.eliminarPontoSituacao(ps.id));
      }
      e.corpoPontosSituacao.appendChild(tr);
    });

    const tarefasFolha = this.flatten(p).filter(x => !this.temFilhos(p, x.tarefa.id)).map(x => x.tarefa);
    const opcoesTarefa = '<option value="">—</option>' + tarefasFolha.map(t => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    const passos = [...p.proximosPassos].sort((a, b) => (!!a.fechado === !!b.fechado) ? b.criadoEm.localeCompare(a.criadoEm) : (a.fechado ? 1 : -1));
    e.corpoProximosPassos.innerHTML = passos.length ? '' : '<tr class="empty-row"><td colspan="5" style="text-align:center;color:#9ca3af;padding:16px">Sem next steps registados.</td></tr>';
    passos.forEach(pp => {
      const tr = document.createElement('tr');
      const dis = pp.fechado ? 'disabled' : '';
      tr.innerHTML = `
        <td>${admin ? `<input type="text" value="${escapeAttr(pp.descricao)}" data-campo="descricao" style="min-width:180px" ${dis}>` : escapeHtml(pp.descricao)}</td>
        <td>${admin ? `<select data-campo="tarefaId" ${dis}>${opcoesTarefa}</select>` : escapeHtml((tarefasFolha.find(t => t.id === pp.tarefaId) || {}).nome || '—')}</td>
        <td><select data-campo="estado" ${dis}>
          <option value="aberto" ${pp.estado === 'aberto' ? 'selected' : ''}>Aberto</option>
          <option value="em_curso" ${pp.estado === 'em_curso' ? 'selected' : ''}>Em curso</option>
          <option value="concluido" ${pp.estado === 'concluido' ? 'selected' : ''}>Concluído</option>
        </select></td>
        <td><textarea data-campo="notas" rows="1" style="width:100%;resize:vertical;" ${dis}>${escapeHtml(pp.notas)}</textarea></td>
        <td class="col-acoes">${admin ? (pp.fechado ? '<span class="hint">Fechado</span>' : '<button class="btn btn-sm" data-acao="fechar">Fechar</button>') : ''}</td>`;
      const selTarefa = tr.querySelector('[data-campo="tarefaId"]');
      if (selTarefa) selTarefa.value = pp.tarefaId || '';
      tr.querySelectorAll('[data-campo]').forEach(inp => {
        inp.addEventListener('change', () => this.atualizarProximoPasso(pp.id, inp.dataset.campo, inp.value));
      });
      const btnFechar = tr.querySelector('[data-acao="fechar"]');
      if (btnFechar) btnFechar.addEventListener('click', () => this.fecharProximoPasso(pp.id));
      e.corpoProximosPassos.appendChild(tr);
    });
  },

  // ---------- Tab: Gantt (tabela de tarefas) ----------
  renderTabelaTarefas() {
    const p = this.projetoAtivo();
    const tbody = this.els.corpoTabelaTarefas;
    tbody.innerHTML = '';
    const podeEditar = !!p && this.possoEditarProjeto(p.id);
    ['btnAddTarefa', 'btnAddSubtarefa', 'btnSubir', 'btnDescer', 'btnIndent', 'btnOutdent', 'btnDelTarefa'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = podeEditar ? '' : 'none';
    });
    if (!p) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8" style="text-align:center;color:#9ca3af;padding:24px">Sem projeto carregado — cria um novo ou importa um ficheiro de projeto.</td></tr>';
      return;
    }
    const lista = this.flatten(p);
    const hojeISO = DateUtil.todayISO();
    lista.forEach(({ tarefa: t, nivel }) => {
      const filhos = this.temFilhos(p, t.id);
      const atrasada = t.fim < hojeISO && t.progresso < 100;
      const tr = document.createElement('tr');
      tr.dataset.id = t.id;
      tr.className = (this.selecionadasIds.has(t.id) ? 'selecionada ' : '') + (filhos ? 'resumo' : '');
      const nomesRec = t.recursoIds.map(rid => {
        const r = this.state.recursos.find(x => x.id === rid);
        if (!r) return '';
        const pct = this.pctAlocacao(t, rid);
        const explicito = t.alocacoesHoras && t.alocacoesHoras[rid] !== undefined;
        const horasFmt = Math.round(this.horasAlocadas(t, rid) * 100) / 100;
        const sufixoPct = explicito ? ` (${horasFmt}h)` : '';
        if (filhos) return `<span class="badge-rec">${escapeHtml(r.nome)}${sufixoPct}</span>`;
        const resultado = Capacidade.avaliarAtribuicao(r, p.id, t.id, t.inicio, t.fim, pct);
        if (resultado.nivel === 'ok' || resultado.nivel === 'vazio') return `<span class="badge-rec">${escapeHtml(r.nome)}${sufixoPct}</span>`;
        const dica = Capacidade.descreverProblema(r.nome, resultado);
        return `<span class="badge-rec ${resultado.nivel}" title="${escapeAttr(dica)}">⚠ ${escapeHtml(r.nome)}${sufixoPct}</span>`;
      }).join('');
      const chipsPred = t.predecessores.map(pr => {
        const pt = this.tarefaPorId(p, pr.id);
        return `<span class="pred-tag">${pt ? escapeHtml(pt.nome.slice(0, 14)) : '?'} (${pr.tipo})</span>`;
      }).join('');
      const duracao = DateUtil.diffDays(DateUtil.parseISO(t.inicio), DateUtil.parseISO(t.fim)) + 1;
      const horasReais = this.horasReaisTarefa(p, t);
      // Uma célula por coluna, montadas depois pela ordem atual dos cabeçalhos — assim arrastar
      // uma coluna para outra posição reordena automaticamente as células de todas as linhas.
      const celulas = {
        nome: `<td class="col-nome">
          <div class="nome-cell" style="padding-left:${nivel * 16}px">
            <span class="toggle-filhos">${filhos ? (this.colapsadas.has(t.id) ? '▶' : '▼') : ''}</span>
            <input type="text" value="${escapeAttr(t.nome)}" data-campo="nome" ${podeEditar ? '' : 'disabled'}>
          </div>
        </td>`,
        inicio: `<td><input type="date" value="${t.inicio}" data-campo="inicio" ${(filhos || !podeEditar) ? 'disabled' : ''}></td>`,
        fim: `<td><input type="date" value="${t.fim}" data-campo="fim" ${(filhos || !podeEditar) ? 'disabled' : ''} style="${atrasada ? 'color:#dc2626;font-weight:600' : ''}"></td>`,
        dias: `<td><input type="number" min="1" value="${duracao}" data-campo="duracao" ${(filhos || !podeEditar) ? 'disabled' : ''} style="width:40px"></td>`,
        prog: `<td><input type="number" min="0" max="100" value="${t.progresso}" data-campo="progresso" ${(filhos || !podeEditar) ? 'disabled' : ''} style="width:44px"></td>`,
        horasReais: `<td title="Soma dos registos de horas ligados a esta tarefa">${horasReais > 0 ? horasReais.toLocaleString('pt-PT', { maximumFractionDigits: 2 }) + 'h' : '<span style="color:#9ca3af">—</span>'}</td>`,
        recursos: `<td class="rec-cell" data-acao="recursos">${nomesRec || '<span style="color:#9ca3af">+ associar</span>'}</td>`,
        pred: `<td class="pred-cell-wrap" data-acao="pred">${filhos ? '<span style="color:#9ca3af">n/d</span>' : (chipsPred || '<span style="color:#9ca3af">+ ligar</span>')}</td>`
      };
      tr.innerHTML = this.ordemColunasTarefas().map(k => celulas[k]).join('');

      tr.addEventListener('click', (e) => {
        if (e.target.closest('input') || e.target.closest('[data-acao]') || e.target.closest('.toggle-filhos')) return;
        this.selecionarTarefa(t.id, e);
      });
      tr.querySelector('.toggle-filhos').addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.colapsadas.has(t.id)) this.colapsadas.delete(t.id); else this.colapsadas.add(t.id);
        this.renderTabelaTarefas();
        this.renderGanttAtual();
      });
      tr.querySelectorAll('input[data-campo]').forEach(inp => {
        inp.addEventListener('click', (e) => e.stopPropagation());
        inp.addEventListener('change', () => { this.selecionadaId = t.id; this.selecionadasIds = new Set([t.id]); this.atualizarCampoTarefa(t.id, inp.dataset.campo, inp.value); });
      });
      if (podeEditar) {
        tr.querySelector('[data-acao="recursos"]').addEventListener('click', (e) => { e.stopPropagation(); this.selecionadaId = t.id; this.selecionadasIds = new Set([t.id]); this.abrirModalRecursos(t.id); });
        const predCell = tr.querySelector('[data-acao="pred"]');
        if (predCell && !filhos) predCell.addEventListener('click', (e) => { e.stopPropagation(); this.selecionadaId = t.id; this.selecionadasIds = new Set([t.id]); this.abrirModalPredecessoras(t.id); });
      }

      tbody.appendChild(tr);
    });
  },

  // Ordem atual das colunas da tabela de tarefas, lida diretamente do DOM do cabeçalho — assim
  // fica sempre sincronizada com o que o utilizador vê, sem precisar de guardar estado à parte.
  ordemColunasTarefas() {
    const ths = document.querySelectorAll('#tabelaTarefas thead th[data-col]');
    if (ths.length) return Array.from(ths).map(th => th.dataset.col);
    return ['nome', 'inicio', 'fim', 'dias', 'prog', 'horasReais', 'recursos', 'pred'];
  },
  // Clique normal seleciona só a linha; Ctrl/Cmd+clique acrescenta/remove; Shift+clique
  // seleciona o intervalo entre a última âncora e a linha clicada (como numa folha de cálculo).
  selecionarTarefa(id, e) {
    const p = this.projetoAtivo();
    const multi = e && (e.ctrlKey || e.metaKey);
    const intervalo = e && e.shiftKey;
    if (intervalo && this._ancoraSelecao && p) {
      const ordemIds = this.flatten(p).map(x => x.tarefa.id);
      const i1 = ordemIds.indexOf(this._ancoraSelecao), i2 = ordemIds.indexOf(id);
      if (i1 !== -1 && i2 !== -1) {
        const [a, b] = i1 < i2 ? [i1, i2] : [i2, i1];
        this.selecionadasIds = new Set(ordemIds.slice(a, b + 1));
      } else {
        this.selecionadasIds = new Set([id]);
      }
    } else if (multi) {
      if (this.selecionadasIds.has(id)) this.selecionadasIds.delete(id); else this.selecionadasIds.add(id);
      this._ancoraSelecao = id;
    } else {
      this.selecionadasIds = new Set([id]);
      this._ancoraSelecao = id;
    }
    this.selecionadaId = id;
    this.renderTabelaTarefas();
    this.renderGanttAtual();
  },
  // Lista de IDs de tarefas alvo das ações em lote (Subir/Descer/Indentar/Promover/Eliminar).
  idsSelecionados() {
    if (this.selecionadasIds && this.selecionadasIds.size) return Array.from(this.selecionadasIds);
    return this.selecionadaId ? [this.selecionadaId] : [];
  },

  renderGanttAtual() {
    const p = this.projetoAtivo();
    if (!p) { this.els.ganttContainer.innerHTML = ''; return; }
    const lista = this.flatten(p);
    Gantt.render(this.els.ganttContainer, p, lista, {
      zoom: this.zoom,
      selecionadaId: this.selecionadaId,
      selecionadasIds: this.selecionadasIds,
      colapsadas: this.colapsadas
    });
  },

  // ---------- Abas ----------
  gruposAbas: { gantt: 'planeamento', projetos: 'planeamento', portefolio: 'planeamento', acompanhamento: 'planeamento', recursos: 'equipa', capacidade: 'equipa', feriados: 'equipa', registo: 'registos', faturacao: 'registos' },
  primeiroTabDoGrupo: { planeamento: 'gantt', equipa: 'recursos', registos: 'registo' },
  irParaAba(nome) {
    this.abaAtiva = nome;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === nome));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + nome));
    const grupo = this.gruposAbas[nome];
    document.querySelectorAll('.grupo-btn').forEach(b => b.classList.toggle('active', b.dataset.grupo === grupo));
    document.querySelectorAll('.tabs-grupo').forEach(g => g.classList.toggle('active', g.dataset.grupo === grupo));
    if (nome === 'gantt') this.renderGanttAtual();
  },
  irParaGrupo(grupo) {
    if (this.gruposAbas[this.abaAtiva] === grupo) return;
    this.irParaAba(this.primeiroTabDoGrupo[grupo]);
  },
  verFaturacaoDoProjeto() {
    const p = this.projetoAtivo();
    if (!p) return;
    this.irParaAba('faturacao');
    this.els.fFatProjeto.value = p.id;
    this.aplicarFiltrosFaturacao();
  },

  // ---------- Modais ----------
  abrirModal(titulo, corpoHtml, opts) {
    this.els.modalTitulo.textContent = titulo;
    this.els.modalCorpo.innerHTML = corpoHtml;
    this.els.modal.classList.toggle('modal-largo', !!(opts && opts.largo));
    this.els.modalBackdrop.classList.add('aberto');
  },
  fecharModal() {
    this.els.modalBackdrop.classList.remove('aberto');
  },
  abrirModalMinhaConta() {
    const perfil = this.perfilAtual();
    if (!perfil) return;
    const html = `
      <label>Nome
        <input type="text" id="contaNome" value="${escapeAttr(perfil.nome || '')}">
      </label>
      <div class="calc-line">Email: <b>${escapeHtml(perfil.email || '')}</b></div>
      <label>Nova password <span class="hint">(deixa em branco para não alterar)</span>
        <input type="password" id="contaPassword" minlength="6" placeholder="••••••" autocomplete="new-password">
      </label>
      <label>Confirmar nova password
        <input type="password" id="contaPassword2" minlength="6" placeholder="••••••" autocomplete="new-password">
      </label>
      <button class="btn btn-primary" id="btnGuardarConta" style="margin-top:10px;">Guardar</button>
      <span id="contaMsg" class="calc-line" style="border:none;display:block;margin-top:6px;"></span>`;
    this.abrirModal('A minha conta', html);
    const m = this.els.modalCorpo;
    const msg = m.querySelector('#contaMsg');
    m.querySelector('#btnGuardarConta').addEventListener('click', async () => {
      const nome = m.querySelector('#contaNome').value.trim();
      const password = m.querySelector('#contaPassword').value;
      const password2 = m.querySelector('#contaPassword2').value;
      if (!nome) { msg.style.color = 'var(--vermelho)'; msg.textContent = 'O nome não pode ficar vazio.'; return; }
      if (password || password2) {
        if (password.length < 6) { msg.style.color = 'var(--vermelho)'; msg.textContent = 'A password tem de ter pelo menos 6 caracteres.'; return; }
        if (password !== password2) { msg.style.color = 'var(--vermelho)'; msg.textContent = 'As passwords não coincidem.'; return; }
      }
      msg.style.color = 'var(--cinza-500)';
      msg.textContent = 'A guardar...';
      try {
        await Sync.atualizarConta({ nome, password: password || null, recursoId: perfil.recursoId });
        perfil.nome = nome;
        const recurso = this.state.recursos.find(r => r.id === perfil.recursoId);
        if (recurso) recurso.nome = nome;
        this.fecharModal();
        this.renderTudo();
        this.toast('Conta atualizada.');
      } catch (err) {
        msg.style.color = 'var(--vermelho)';
        msg.textContent = 'Erro: ' + err.message;
      }
    });
  },
  abrirModalAlocacoesRecurso(recursoId) {
    const r = this.state.recursos.find(x => x.id === recursoId);
    if (!r) return;
    const linhas = [];
    Object.values(this.state.projetos).forEach(p => {
      p.tarefas.forEach(t => {
        if (!t.recursoIds.includes(recursoId)) return;
        if (this.temFilhos(p, t.id)) return;
        linhas.push({ projeto: p, tarefa: t });
      });
    });
    linhas.sort((a, b) => a.tarefa.inicio < b.tarefa.inicio ? -1 : (a.tarefa.inicio > b.tarefa.inicio ? 1 : 0));

    // O estado (e o destaque de conflito) usa sempre a % média de ocupação diária desta pessoa
    // nesta tarefa, derivada das horas planeadas — duas tarefas com datas sobrepostas não são um
    // problema, por si só, se as ocupações não ultrapassarem 100% no total no período.
    linhas.forEach(l => {
      l.horas = this.horasAlocadas(l.tarefa, recursoId);
      const pct = this.pctAlocacao(l.tarefa, recursoId);
      l.resultado = Capacidade.avaliarAtribuicao(r, l.projeto.id, l.tarefa.id, l.tarefa.inicio, l.tarefa.fim, pct);
    });

    const numConflito = linhas.filter(l => l.resultado.nivel === 'critico').length;
    const resumoTopo = linhas.length
      ? `<p class="hint" style="margin:0 0 10px;">${linhas.length} alocação(ões) em ${new Set(linhas.map(l => l.projeto.id)).size} projeto(s).${numConflito ? ` <b style="color:#dc2626;">⚠ ${numConflito} com conflito de alocação.</b>` : ' Sem conflitos de alocação.'} Ajusta as horas de alocação diretamente aqui para resolver.</p>`
      : '';

    const html = linhas.length ? `
      ${resumoTopo}
      <div class="table-scroll" style="max-height:50vh;">
        <table class="tabela-crud">
          <thead><tr><th></th><th>Projeto</th><th>Cliente</th><th>Tarefa</th><th>Início</th><th>Fim</th><th>Dias</th><th>Horas</th></tr></thead>
          <tbody>
            ${linhas.map(l => {
              const disp = this.rotuloDisponibilidade(l.resultado);
              const emConflito = l.resultado.nivel === 'critico';
              const dias = DateUtil.diffDays(DateUtil.parseISO(l.tarefa.inicio), DateUtil.parseISO(l.tarefa.fim)) + 1;
              const dicaEstado = Capacidade.descreverProblema(r.nome, l.resultado) || 'Sem conflitos conhecidos neste período.';
              return `<tr class="${emConflito ? 'linha-sobreposta' : ''}">
                <td><span class="disp-tag disp-${disp.classe}" title="${escapeAttr(dicaEstado)}">${disp.texto}</span></td>
                <td>${escapeHtml(l.projeto.nome)}</td>
                <td>${escapeHtml(l.projeto.cliente || '—')}</td>
                <td>${escapeHtml(l.tarefa.nome)}</td>
                <td>${DateUtil.formatShort(DateUtil.parseISO(l.tarefa.inicio))}</td>
                <td>${DateUtil.formatShort(DateUtil.parseISO(l.tarefa.fim))}</td>
                <td>${dias}</td>
                <td><input type="number" class="rec-horas" min="0" step="0.25" value="${l.horas}" data-horas-alocacao-tarefa="${l.tarefa.id}" data-projeto-alocacao="${l.projeto.id}"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : '<p style="color:#9ca3af">Sem alocações em nenhum projeto carregado.</p>';
    this.abrirModal(`Alocações — ${r.nome}`, html, { largo: true });
    this.els.modalCorpo.querySelectorAll('[data-horas-alocacao-tarefa]').forEach(inp => {
      inp.addEventListener('change', () => {
        const projeto = this.state.projetos[inp.dataset.projetoAlocacao];
        this.definirHorasRecursoTarefa(projeto, inp.dataset.horasAlocacaoTarefa, recursoId, inp.value);
        this.abrirModalAlocacoesRecurso(recursoId);
      });
    });
  },
  rotuloDisponibilidade(resultado) {
    if (resultado.nivel === 'critico') {
      const temAusencia = resultado.diasIndisponivel > 0;
      const temSobreAlocacao = resultado.diasSobreAlocado > 0;
      if (temAusencia && !temSobreAlocacao) {
        const motivos = new Set((resultado.detalheIndisponivel || []).map(d => d.motivo));
        const motivo = motivos.size === 1 ? Array.from(motivos)[0] : 'ausência';
        return { texto: `● Ausente (${motivo.charAt(0).toUpperCase()}${motivo.slice(1)})`, classe: 'critico' };
      }
      if (temSobreAlocacao && !temAusencia) return { texto: '● Sobre-alocado', classe: 'critico' };
      return { texto: '● Ausente / sobre-alocado', classe: 'critico' };
    }
    if (resultado.nivel === 'aviso') return { texto: `● Perto do limite (${Math.round(resultado.pct * 100)}%)`, classe: 'aviso' };
    return { texto: '● Livre', classe: 'ok' };
  },
  abrirModalRecursos(taskId) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, taskId);
    if (!t) return;
    if (!this.state.recursos.length) {
      this.abrirModal(`Associar consultores — ${t.nome}`, '<p>Sem consultores definidos. Adiciona no separador "Pessoas".</p>');
      return;
    }
    const ordemNivel = { critico: 0, aviso: 1, ok: 2, vazio: 2 };
    const linhas = this.state.recursos.map(r => ({ r, horas: this.horasAlocadas(t, r.id), resultado: Capacidade.avaliarAtribuicao(r, p.id, t.id, t.inicio, t.fim, this.pctAlocacao(t, r.id)) }))
      .sort((a, b) => ordemNivel[a.resultado.nivel] - ordemNivel[b.resultado.nivel]);
    const horasCheias = this.horasTempoInteiro(t);
    const html = `
      <p class="hint" style="margin:0 0 10px;">Disponibilidade de cada consultor neste período (${DateUtil.formatShort(DateUtil.parseISO(t.inicio))} – ${DateUtil.formatShort(DateUtil.parseISO(t.fim))}), considerando as suas outras tarefas, feriados e ausências. Por omissão a alocação é a tempo inteiro (${horasCheias}h, toda a duração útil da tarefa) — ajusta as horas totais previstas se a pessoa não for dedicar esse tempo todo.</p>
      ${linhas.map(({ r, horas, resultado }) => {
        const equipa = this.state.equipas.find(eq => eq.id === r.equipaId);
        const disp = this.rotuloDisponibilidade(resultado);
        const dica = Capacidade.descreverProblema(r.nome, resultado) || 'Sem conflitos conhecidos neste período.';
        const marcado = t.recursoIds.includes(r.id);
        const livreHoras = Capacidade.capacidadeLivreHoras(r, t.id, t.inicio, t.fim);
        return `
        <label class="rec-check">
          <input type="checkbox" value="${r.id}" ${marcado ? 'checked' : ''}>
          <span class="rec-check-nome">${escapeHtml(r.nome)} <span style="color:#9ca3af">— ${escapeHtml(r.papel || '')}${equipa ? ' · ' + escapeHtml(equipa.nome) : ''}</span></span>
          <span class="rec-horas-wrap">
            <input type="number" class="rec-horas" min="0" step="0.25" value="${horas}" data-horas-recurso="${r.id}" ${marcado ? '' : 'disabled'}>h
            ${livreHoras !== null ? `<span class="hint-livre" title="Horas livres deste consultor neste período, sem ultrapassar 100% em nenhum dia, dadas as outras tarefas desta pessoa">Livre: ${livreHoras.toFixed(1)}h</span>` : ''}
          </span>
          <span class="disp-tag disp-${disp.classe}" title="${escapeAttr(dica)}">${disp.texto}</span>
        </label>`;
      }).join('')}`;
    this.abrirModal(`Associar consultores — ${t.nome}`, html);
    this.els.modalCorpo.querySelectorAll('[data-horas-recurso]').forEach(inp => {
      inp.addEventListener('change', () => {
        this.definirHorasRecursoTarefa(p, taskId, inp.dataset.horasRecurso, inp.value);
        this.abrirModalRecursos(taskId);
      });
    });
    this.els.modalCorpo.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const recursoId = cb.value;
        if (cb.checked) {
          const r = this.state.recursos.find(x => x.id === recursoId);
          const novoFim = Capacidade.calcularFimComCompensacao(r, t.inicio, t.fim);
          if (novoFim) {
            const estender = confirm(
              `${r.nome} tem dias indisponíveis (feriado/ausência) entre ${DateUtil.formatShort(DateUtil.parseISO(t.inicio))} e ${DateUtil.formatShort(DateUtil.parseISO(t.fim))}.\n\n` +
              `Queres estender a tarefa até ${DateUtil.formatShort(novoFim)} para compensar esses dias, ou manter as datas atuais e aceitar que ${r.nome} fica indisponível nesses dias?\n\n` +
              `OK = Estender a tarefa\nCancelar = Manter as datas atuais`
            );
            if (estender) {
              t.fim = DateUtil.toISO(novoFim);
              this.recalcularAgendamento(p);
            }
          }
        }
        this.alternarRecursoTarefa(taskId, recursoId);
        this.abrirModalRecursos(taskId);
      });
    });
  },
  abrirModalPredecessoras(taskId) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, taskId);
    if (!t) return;
    const opcoes = p.tarefas.filter(x => x.id !== taskId)
      .map(x => `<option value="${x.id}">${escapeHtml(x.nome)}</option>`).join('');
    const linhasAtuais = t.predecessores.map(pr => {
      const pt = this.tarefaPorId(p, pr.id);
      return `<div class="pred-linha">
        <span style="flex:1">${pt ? escapeHtml(pt.nome) : '?'} — ${pr.tipo}${pr.atraso ? ' +' + pr.atraso + 'd' : ''}</span>
        <button class="btn-icon" data-remover="${pr.id}">🗑</button>
      </div>`;
    }).join('') || '<p style="color:#9ca3af">Sem predecessoras.</p>';
    const html = `
      <div id="listaPred">${linhasAtuais}</div>
      <hr style="margin:12px 0;border:none;border-top:1px solid #e5e7eb">
      <div class="pred-linha">
        <select id="novaPredTarefa" style="flex:1">${opcoes}</select>
        <select id="novaPredTipo">
          <option value="FS">Fim→Início</option>
          <option value="SS">Início→Início</option>
          <option value="FF">Fim→Fim</option>
          <option value="SF">Início→Fim</option>
        </select>
        <input type="number" id="novaPredAtraso" value="0" title="Atraso (dias)" style="width:52px">
        <button class="btn btn-sm btn-primary" id="btnAddPred">Adicionar</button>
      </div>`;
    this.abrirModal(`Predecessoras — ${t.nome}`, html);
    this.els.modalCorpo.querySelectorAll('[data-remover]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removerPredecessor(taskId, btn.dataset.remover);
        this.renderTudo();
        this.abrirModalPredecessoras(taskId);
      });
    });
    const btnAdd = document.getElementById('btnAddPred');
    if (btnAdd) btnAdd.addEventListener('click', () => {
      const predId = document.getElementById('novaPredTarefa').value;
      const tipo = document.getElementById('novaPredTipo').value;
      const atraso = parseInt(document.getElementById('novaPredAtraso').value, 10) || 0;
      if (this.adicionarPredecessor(taskId, predId, tipo, atraso)) {
        this.renderTudo();
        this.abrirModalPredecessoras(taskId);
      }
    });
  },


  toast(msg) {
    const el = this.els.toast;
    el.textContent = msg;
    el.classList.add('mostrar');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('mostrar'), 2600);
  },

  // ---------- Eventos ----------
  wireEvents() {
    const e = this.els;
    document.getElementById('tabsNav').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab-btn');
      if (btn) this.irParaAba(btn.dataset.tab);
    });
    document.getElementById('gruposNav').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.grupo-btn');
      if (btn) this.irParaGrupo(btn.dataset.grupo);
    });

    e.btnDesfazer.addEventListener('click', () => this.desfazer());
    e.btnRefazer.addEventListener('click', () => this.refazer());
    const btnMigrar = document.getElementById('btnMigrarDadosLocais');
    if (btnMigrar) btnMigrar.addEventListener('click', () => this.migrarDadosLocais());
    document.addEventListener('keydown', (ev) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const tecla = ev.key.toLowerCase();
      if (tecla === 'z' && !ev.shiftKey) { ev.preventDefault(); this.desfazer(); }
      else if (tecla === 'y' || (tecla === 'z' && ev.shiftKey)) { ev.preventDefault(); this.refazer(); }
    });

    e.selProjeto.addEventListener('change', () => this.selecionarProjeto(e.selProjeto.value));
    document.getElementById('btnNovoProjeto').addEventListener('click', () => this.criarProjeto());
    document.getElementById('btnNovoProjeto2').addEventListener('click', () => this.criarProjeto());
    document.getElementById('btnDuplicarProjeto').addEventListener('click', () => this.duplicarProjeto());
    document.getElementById('btnEliminarProjeto').addEventListener('click', () => this.eliminarProjeto());

    e.projIdInterno.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().idInterno = e.projIdInterno.value; this.persist(); this.renderProjetoSelect(); this.renderTabelaProjetos(); });
    e.projEstado.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().estado = e.projEstado.value; this.persist(); this.renderTabelaProjetos(); });
    e.projNome.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().nome = e.projNome.value; this.persist(); this.renderProjetoSelect(); this.renderTabelaProjetos(); });
    e.projCliente.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().cliente = e.projCliente.value; this.persist(); this.renderTabelaProjetos(); });
    e.projDescricao.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().descricao = e.projDescricao.value; this.persist(); });
    e.projInicio.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().dataInicio = e.projInicio.value; this.persist(); this.renderGanttAtual(); this.renderTabelaProjetos(); });
    e.projFim.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().dataFim = e.projFim.value; this.persist(); this.renderGanttAtual(); this.renderTabelaProjetos(); });
    e.projHorasVendidas.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().horasVendidas = parseFloat(e.projHorasVendidas.value) || 0; this.persist(); this.renderInfoProjeto(); this.renderTabelaProjetos(); });
    e.projValorVendido.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().valorVendido = parseFloat(e.projValorVendido.value) || 0; this.persist(); this.renderInfoProjeto(); this.renderTabelaProjetos(); });
    e.projGestorId.addEventListener('change', () => { if (!this.projetoAtivo() || !this.souAdmin()) return; this.projetoAtivo().gestorId = e.projGestorId.value || null; this.persist(); this.renderTudo(); });

    document.getElementById('btnAddTarefa').addEventListener('click', () => this.adicionarTarefa(false));
    document.getElementById('btnAddSubtarefa').addEventListener('click', () => this.adicionarTarefa(true));
    document.getElementById('btnSubir').addEventListener('click', () => this.moverOrdemSelecionada(-1));
    document.getElementById('btnDescer').addEventListener('click', () => this.moverOrdemSelecionada(1));
    document.getElementById('btnIndent').addEventListener('click', () => this.indentarSelecionada());
    document.getElementById('btnOutdent').addEventListener('click', () => this.promoverSelecionada());
    document.getElementById('btnDelTarefa').addEventListener('click', () => this.eliminarTarefaSelecionada());
    e.btnToggleSidebar.addEventListener('click', () => this.alternarSidebar());

    e.selZoom.addEventListener('input', () => {
      this.zoom = parseInt(e.selZoom.value, 10);
      this.els.zoomLabel.textContent = this.rotuloZoom(this.zoom);
      this.renderGanttAtual();
      this.gravarPrefUI('zoomGantt', this.zoom);
    });

    document.getElementById('btnAddRecursoTab').addEventListener('click', () => this.adicionarRecurso());
    document.getElementById('btnAddEquipa').addEventListener('click', () => this.adicionarEquipa());
    document.getElementById('btnAddFeriado').addEventListener('click', () => this.adicionarFeriado());
    document.getElementById('btnAddAusencia').addEventListener('click', () => this.adicionarAusencia());
    e.selHorizonteCap.addEventListener('change', () => this.renderCapacidade());
    e.selEquipaCap.addEventListener('change', () => this.renderCapacidade());

    document.querySelectorAll('.link-tab').forEach(a => a.addEventListener('click', (ev) => { ev.preventDefault(); this.verFaturacaoDoProjeto(); }));
    e.regPessoa.addEventListener('change', () => this.renderProjetosRegisto());
    e.regProjeto.addEventListener('change', () => this.renderTarefasRegisto());
    e.formRegisto.addEventListener('submit', (ev) => { ev.preventDefault(); this.submeterFormRegisto(); });
    [e.fRegPessoa, e.fRegProjeto, e.fRegDe, e.fRegAte].forEach(el => el.addEventListener('change', () => this.aplicarFiltrosRegisto()));
    e.fRegTexto.addEventListener('input', () => this.aplicarFiltrosRegisto());
    document.getElementById('btnLimparFiltrosRegisto').addEventListener('click', () => {
      e.fRegPessoa.value = ''; e.fRegProjeto.value = ''; e.fRegDe.value = ''; e.fRegAte.value = ''; e.fRegTexto.value = '';
      this.aplicarFiltrosRegisto();
    });

    document.getElementById('btnAddFatura').addEventListener('click', () => this.adicionarFatura());
    [e.fFatProjeto, e.fFatDe, e.fFatAte].forEach(el => el.addEventListener('change', () => this.aplicarFiltrosFaturacao()));
    e.fFatNumRegisto.addEventListener('input', () => this.aplicarFiltrosFaturacao());
    document.getElementById('btnLimparFiltrosFaturacao').addEventListener('click', () => {
      e.fFatProjeto.value = ''; e.fFatDe.value = ''; e.fFatAte.value = ''; e.fFatNumRegisto.value = '';
      this.aplicarFiltrosFaturacao();
    });
    document.querySelector('#tabelaFaturas thead').addEventListener('click', (ev) => {
      const th = ev.target.closest('th[data-sort]');
      if (!th) return;
      const campo = th.dataset.sort;
      if (this.ordenacaoFaturas.campo === campo) {
        this.ordenacaoFaturas.dir = this.ordenacaoFaturas.dir === 'asc' ? 'desc' : 'asc';
      } else {
        this.ordenacaoFaturas = { campo, dir: 'asc' };
      }
      this.renderTabelaFaturas();
    });
    document.querySelector('#tabelaRegistos thead').addEventListener('click', (ev) => {
      const th = ev.target.closest('th[data-sort]');
      if (!th) return;
      const campo = th.dataset.sort;
      if (this.ordenacaoRegistos.campo === campo) {
        this.ordenacaoRegistos.dir = this.ordenacaoRegistos.dir === 'asc' ? 'desc' : 'asc';
      } else {
        this.ordenacaoRegistos = { campo, dir: campo === 'data' ? 'desc' : 'asc' };
      }
      this.paginaRegistos = 1;
      this.renderTabelaRegistos();
    });

    document.getElementById('modalFechar').addEventListener('click', () => this.fecharModal());
    e.modalBackdrop.addEventListener('click', (ev) => { if (ev.target === e.modalBackdrop) this.fecharModal(); });
    document.getElementById('btnMinhaConta').addEventListener('click', () => this.abrirModalMinhaConta());
    document.getElementById('btnAddPontoSituacao').addEventListener('click', () => this.criarPontoSituacao());
    document.getElementById('btnAddProximoPasso').addEventListener('click', () => this.criarProximoPasso());

    let sincronizando = false;
    e.painelTabela.addEventListener('scroll', () => {
      if (sincronizando) return;
      sincronizando = true;
      e.painelGantt.scrollTop = e.painelTabela.scrollTop;
      sincronizando = false;
    });
    e.painelGantt.addEventListener('scroll', () => {
      if (sincronizando) return;
      sincronizando = true;
      e.painelTabela.scrollTop = e.painelGantt.scrollTop;
      sincronizando = false;
    });

    e.selZoomPortGantt.addEventListener('input', () => {
      this.els.zoomLabelPortGantt.textContent = this.rotuloZoom(parseInt(e.selZoomPortGantt.value, 10));
      this.renderPortfolioGantt();
      this.gravarPrefUI('zoomPortGantt', parseInt(e.selZoomPortGantt.value, 10));
    });
    let sincronizandoPort = false;
    e.painelTabelaPortGantt.addEventListener('scroll', () => {
      if (sincronizandoPort) return;
      sincronizandoPort = true;
      e.painelGanttPortfolio.scrollTop = e.painelTabelaPortGantt.scrollTop;
      sincronizandoPort = false;
    });
    e.painelGanttPortfolio.addEventListener('scroll', () => {
      if (sincronizandoPort) return;
      sincronizandoPort = true;
      e.painelTabelaPortGantt.scrollTop = e.painelGanttPortfolio.scrollTop;
      sincronizandoPort = false;
    });

    this.wireResizers();
  },

  // Rótulo amigável para o valor numérico (píxeis por dia) da barra de zoom — usa os mesmos
  // limiares da réguas de cabeçalho do Gantt (ver criarHeaderSVG em gantt.js), para o texto
  // corresponder sempre ao que a régua está de facto a mostrar.
  rotuloZoom(px) {
    if (px >= 26) return 'Dias';
    if (px >= 9) return 'Semanas';
    return 'Meses';
  },
  wireResizers() {
    const prefs = this.lerPrefsUI();
    if (prefs.sidebarW) this.els.sidebarGantt.style.width = prefs.sidebarW + 'px';
    if (prefs.tabelaW) this.els.painelTabela.style.width = prefs.tabelaW + 'px';
    if (prefs.portGanttW) this.els.painelTabelaPortGantt.style.width = prefs.portGanttW + 'px';
    if (prefs.zoomGantt) this.zoom = prefs.zoomGantt;
    this.els.selZoom.value = this.zoom;
    this.els.zoomLabel.textContent = this.rotuloZoom(this.zoom);
    this.els.selZoomPortGantt.value = prefs.zoomPortGantt || 14;
    this.els.zoomLabelPortGantt.textContent = this.rotuloZoom(parseInt(this.els.selZoomPortGantt.value, 10));

    this.tornarRedimensionavel(this.els.resizerSidebar, this.els.sidebarGantt, 220, 560, (w) => this.gravarPrefUI('sidebarW', w));
    this.tornarRedimensionavel(this.els.resizerTabela, this.els.painelTabela, 320, 900, (w) => this.gravarPrefUI('tabelaW', w));
    this.tornarRedimensionavel(this.els.resizerPortGantt, this.els.painelTabelaPortGantt, 220, 700, (w) => this.gravarPrefUI('portGanttW', w));
    this.aplicarOrdemColunasSalva('tabelaTarefas', 'ordemTarefas');
    this.tornarColunasRedimensionaveis('tabelaTarefas', 'colunasTarefas');
    this.tornarColunasReordenaveis('tabelaTarefas', 'ordemTarefas');
    if (prefs.sidebarColapsada) this.alternarSidebar(true);
  },
  // Fecha/abre a barra lateral da aba Gantt para ganhar largura útil para a tabela/Gantt.
  alternarSidebar(forcarColapsar) {
    const colapsada = forcarColapsar !== undefined ? forcarColapsar : !this.els.sidebarGantt.classList.contains('colapsada');
    this.els.sidebarGantt.classList.toggle('colapsada', colapsada);
    if (this.els.layoutGantt) this.els.layoutGantt.classList.toggle('sidebar-colapsada', colapsada);
    this.els.btnToggleSidebar.textContent = colapsada ? '⟩' : '⟨';
    this.els.btnToggleSidebar.title = colapsada ? 'Abrir painel lateral' : 'Fechar painel lateral';
    if (!colapsada) {
      const prefs = this.lerPrefsUI();
      this.els.sidebarGantt.style.width = (prefs.sidebarW || 320) + 'px';
    }
    this.gravarPrefUI('sidebarColapsada', colapsada);
  },
  // Reordena os <th> guardados em gp_ui_prefs (se houver) antes da primeira renderização — as
  // colunas que a preferência não conhece (ex.: adicionadas numa atualização futura) ficam no
  // fim, pela ordem em que já estão no HTML.
  aplicarOrdemColunasSalva(tabelaId, prefChave) {
    const ordem = this.lerPrefsUI()[prefChave];
    if (!ordem || !ordem.length) return;
    const tabela = document.getElementById(tabelaId);
    if (!tabela) return;
    const linha = tabela.querySelector('thead tr');
    const porChave = {};
    linha.querySelectorAll('th[data-col]').forEach(th => { porChave[th.dataset.col] = th; });
    ordem.forEach(col => { if (porChave[col]) linha.appendChild(porChave[col]); });
  },
  // Arrastar um cabeçalho de coluna (fora do puxador de redimensionar) troca-o de posição em
  // tempo real com a coluna sobre a qual passa o rato; ao largar, guarda a nova ordem e volta a
  // desenhar as linhas — que já respeitam a ordem atual do cabeçalho (ver ordemColunasTarefas).
  tornarColunasReordenaveis(tabelaId, prefChave) {
    const tabela = document.getElementById(tabelaId);
    if (!tabela) return;
    const linha = tabela.querySelector('thead tr');
    let arrastando = null;
    linha.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.col-resizer')) return;
        arrastando = th;
        th.classList.add('coluna-a-arrastar');
        e.preventDefault();
      });
    });
    document.addEventListener('pointermove', (e) => {
      if (!arrastando) return;
      const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('th[data-col]');
      if (!alvo || alvo === arrastando || alvo.parentElement !== linha) return;
      const rect = alvo.getBoundingClientRect();
      const antes = e.clientX < rect.left + rect.width / 2;
      linha.insertBefore(arrastando, antes ? alvo : alvo.nextSibling);
    });
    document.addEventListener('pointerup', () => {
      if (!arrastando) return;
      arrastando.classList.remove('coluna-a-arrastar');
      arrastando = null;
      const ordem = Array.from(linha.querySelectorAll('th[data-col]')).map(th => th.dataset.col);
      this.gravarPrefUI(prefChave, ordem);
      this.renderTabelaTarefas();
    });
  },
  // Torna cada coluna de uma tabela redimensionável a partir de um pequeno puxador na borda
  // direita do cabeçalho — a largura de cada coluna fica guardada em gp_ui_prefs (por nome de
  // coluna, via data-col em cada <th>) e é reaplicada da próxima vez que a app abre.
  tornarColunasRedimensionaveis(tabelaId, prefChave) {
    const tabela = document.getElementById(tabelaId);
    if (!tabela) return;
    const larguras = this.lerPrefsUI()[prefChave] || {};
    Array.from(tabela.querySelectorAll('thead th[data-col]')).forEach(th => {
      const col = th.dataset.col;
      if (larguras[col]) th.style.width = larguras[col] + 'px';
      const handle = th.querySelector('.col-resizer');
      if (!handle) return;
      let arrastando = false, startX = 0, startW = 0;
      handle.addEventListener('pointerdown', (e) => {
        arrastando = true; startX = e.clientX; startW = th.getBoundingClientRect().width;
        handle.classList.add('ativo');
        e.preventDefault(); e.stopPropagation();
      });
      document.addEventListener('pointermove', (e) => {
        if (!arrastando) return;
        th.style.width = Math.max(40, Math.min(600, startW + (e.clientX - startX))) + 'px';
      });
      document.addEventListener('pointerup', () => {
        if (!arrastando) return;
        arrastando = false;
        handle.classList.remove('ativo');
        const atuais = this.lerPrefsUI()[prefChave] || {};
        atuais[col] = Math.round(th.getBoundingClientRect().width);
        this.gravarPrefUI(prefChave, atuais);
      });
    });
  },
  tornarRedimensionavel(handle, alvo, min, max, aoSoltar) {
    let arrastando = false, startX = 0, startW = 0;
    handle.addEventListener('pointerdown', (e) => {
      arrastando = true; startX = e.clientX; startW = alvo.getBoundingClientRect().width;
      handle.classList.add('ativo');
      e.preventDefault();
    });
    document.addEventListener('pointermove', (e) => {
      if (!arrastando) return;
      const nova = Math.max(min, Math.min(max, startW + (e.clientX - startX)));
      alvo.style.width = nova + 'px';
    });
    document.addEventListener('pointerup', () => {
      if (!arrastando) return;
      arrastando = false;
      handle.classList.remove('ativo');
      aoSoltar(Math.round(alvo.getBoundingClientRect().width));
    });
  },
  lerPrefsUI() {
    try { return JSON.parse(localStorage.getItem('gp_ui_prefs')) || {}; } catch (e) { return {}; }
  },
  gravarPrefUI(chave, valor) {
    const prefs = this.lerPrefsUI();
    prefs[chave] = valor;
    localStorage.setItem('gp_ui_prefs', JSON.stringify(prefs));
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

document.addEventListener('DOMContentLoaded', () => App.init());

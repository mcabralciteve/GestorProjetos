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
  filtrosCalendarioRegisto: { pessoa: '', projeto: '' },
  calMesAtual: null,
  CORES_CALENDARIO: ['#2a6a9a', '#1f8a5b', '#c8951f', '#6b4fa0', '#3e8fc0', '#b0562f', '#4a8f7a', '#8a4f7a'],
  filtrosFaturacao: { projeto: '', de: '', ate: '', numRegisto: '' },
  filtrosTodosPassos: { projeto: '', pontoSituacao: '', responsavel: '', estado: '', criadoDe: '', criadoAte: '' },
  filtrosProjetos: { gestorId: '', cliente: '', estado: '', estadoOrc: '' },
  // Definição das colunas da tabela de Projetos, para o painel "⚙ Colunas" — a ordem aqui é só a
  // do painel de checkboxes, não afeta a ordem real das colunas na tabela (essa é fixa no HTML).
  COLUNAS_PROJETOS: [
    { key: 'idInterno', label: 'ID interno' },
    { key: 'nome', label: 'Nome' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'gestor', label: 'Gestor' },
    { key: 'dataInicio', label: 'Início' },
    { key: 'dataFim', label: 'Fim' },
    { key: 'horasVendidas', label: 'Horas vendidas' },
    { key: 'valorVendido', label: 'Valor vendido (€)' },
    { key: 'valorHoraMedio', label: '€/h médio' },
    { key: 'estado', label: 'Estado' },
    { key: 'real', label: 'Real (h)' },
    { key: 'eac', label: 'Reprevisão / EAC (h)' },
    { key: 'saldo', label: 'Saldo (h)' },
    { key: 'pctConsumido', label: '% Consumido' },
    { key: 'estadoOrc', label: 'Estado Orçamental' }
  ],
  ordenacaoFaturas: { campo: 'dataPrevista', dir: 'asc' },
  ordenacaoRegistos: { campo: 'data', dir: 'desc' },

  init() {
    this.cacheEls();
    this.aplicarTema(this.lerPrefsUI().tema || 'claro');
    this.capturarEstadoLocalPreLogin();
    this.state = this.estadoVazio();
    this.wireEvents();
    this.atualizarBotoesHistorico();
  },
  // O tema em si já é aplicado antes de qualquer script correr (ver <script> no <head> do
  // index.html, para não haver flash do tema errado) — isto só mantém o botão/estado coerentes.
  aplicarTema(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    if (this.els.btnAlternarTema) {
      this.els.btnAlternarTema.textContent = tema === 'escuro' ? '☀️' : '🌙';
      this.els.btnAlternarTema.title = tema === 'escuro' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    }
  },
  alternarTema() {
    const atual = document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
    const novo = atual === 'escuro' ? 'claro' : 'escuro';
    this.aplicarTema(novo);
    this.gravarPrefUI('tema', novo);
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
      grupoBtnFaturacao: document.getElementById('grupoBtnFaturacao'),
      tabBtnAcompanhamento: document.getElementById('tabBtnAcompanhamento'),
      acompanhamentoProjetoNome: document.getElementById('acompanhamentoProjetoNome'),
      acompanhamentoSemProjeto: document.getElementById('acompanhamentoSemProjeto'),
      acompanhamentoConteudo: document.getElementById('acompanhamentoConteudo'),
      corpoPontosSituacao: document.getElementById('corpoPontosSituacao'),
      corpoProximosPassos: document.getElementById('corpoProximosPassos'),
      tabBtnTodosPassos: document.getElementById('tabBtnTodosPassos'),
      fPassoProjeto: document.getElementById('fPassoProjeto'),
      fPassoSessao: document.getElementById('fPassoSessao'),
      fPassoResponsavel: document.getElementById('fPassoResponsavel'),
      fPassoEstado: document.getElementById('fPassoEstado'),
      fPassoCriadoDe: document.getElementById('fPassoCriadoDe'),
      fPassoCriadoAte: document.getElementById('fPassoCriadoAte'),
      corpoTodosPassos: document.getElementById('corpoTodosPassos'),
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
      selGestorFiltroGantt: document.getElementById('selGestorFiltroGantt'),
      fProjGestor: document.getElementById('fProjGestor'),
      fProjCliente: document.getElementById('fProjCliente'),
      fProjEstado: document.getElementById('fProjEstado'),
      fProjEstadoOrc: document.getElementById('fProjEstadoOrc'),
      btnColunasProjetos: document.getElementById('btnColunasProjetos'),
      painelColunasProjetos: document.getElementById('painelColunasProjetos'),
      selHorizonteCap: document.getElementById('selHorizonteCap'),
      selMesInicioCap: document.getElementById('selMesInicioCap'),
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
      btnAlternarTema: document.getElementById('btnAlternarTema'),
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
      fCalPessoa: document.getElementById('fCalPessoa'),
      fCalProjeto: document.getElementById('fCalProjeto'),
      btnCalMesAnt: document.getElementById('btnCalMesAnt'),
      btnCalMesSeg: document.getElementById('btnCalMesSeg'),
      btnCalHoje: document.getElementById('btnCalHoje'),
      calMesLabel: document.getElementById('calMesLabel'),
      calendarioRegistos: document.getElementById('calendarioRegistos'),
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
    // Conta gravações ainda a decorrer — "atualizarDaNuvem" usa isto para avisar antes de
    // substituir o estado local por dados do servidor enquanto ainda há algo a caminho.
    this._pendentesSincronizacao = (this._pendentesSincronizacao || 0) + 1;
    this._filaSincronizacao = (this._filaSincronizacao || Promise.resolve())
      .then(() => Sync.sincronizarComSupabase(anteriorJSON, atualJSON))
      .catch(err => {
        console.error(err);
        if (this.sessaoAtiva) this.toast('Erro ao guardar na nuvem: ' + err.message);
      })
      .finally(() => { this._pendentesSincronizacao = Math.max(0, (this._pendentesSincronizacao || 1) - 1); });
  },
  // Recarrega tudo a partir do Supabase — para quando o próprio (ex.: por SQL direto) ou outra
  // pessoa mudou algo na base de dados e a app ainda mostra a versão antiga em memória.
  // "opts.silencioso" (usado ao voltar à aba) nunca interrompe com um confirm() nem mostra toast de
  // sucesso; só o clique manual no botão pergunta antes de descartar uma gravação ainda a decorrer.
  async atualizarDaNuvem(opts) {
    opts = opts || {};
    if (!this.sessaoAtiva || this._atualizandoDaNuvem) return;
    if (this._pendentesSincronizacao > 0) {
      if (opts.silencioso) return;
      if (!confirm('Ainda há alterações a ser guardadas na nuvem. Se atualizares agora podes ver dados desatualizados por instantes. Continuar?')) return;
    }
    this._atualizandoDaNuvem = true;
    const btn = document.getElementById('btnAtualizarDados');
    if (btn) btn.disabled = true;
    // Sync.carregarDeSupabase() escolhe sempre o primeiro projeto por omissão — guarda o que
    // estava ativo antes de recarregar, para voltar a esse mesmo projeto, não para o primeiro.
    const projetoAnteriorId = this.state.projetoAtivoId;
    try {
      await Sync.carregarDeSupabase();
      if (projetoAnteriorId && this.state.projetos[projetoAnteriorId] && this.estouEnvolvidoEm(projetoAnteriorId)) {
        this.state.projetoAtivoId = projetoAnteriorId;
      } else if (!this.estouEnvolvidoEm(this.state.projetoAtivoId)) {
        const primeiro = this.meusProjetosEnvolvidos()[0];
        this.state.projetoAtivoId = primeiro ? primeiro.id : null;
      }
      this._ultimoEstadoPersistido = JSON.stringify(this.state);
      this.undoStack = [];
      this.redoStack = [];
      this.selecionadaId = null;
      this.selecionadasIds = new Set();
      this.renderProjetoSelect();
      this.renderTudo();
      this.atualizarBotaoMigracao();
      if (!opts.silencioso) this.toast('Dados atualizados.');
    } catch (err) {
      console.error(err);
      this.toast('Erro ao atualizar: ' + err.message);
    } finally {
      this._atualizandoDaNuvem = false;
      if (btn) btn.disabled = false;
    }
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
  // Consultores "do projeto" para efeitos de responsável de next step — quem já tem o recurso
  // atribuído a alguma tarefa deste projeto (mesma definição usada por souConsultorDe).
  consultoresDoProjeto(p) {
    const ids = new Set();
    p.tarefas.forEach(t => (t.recursoIds || []).forEach(rid => ids.add(rid)));
    return this.state.recursos.filter(r => ids.has(r.id));
  },
  // Um next step só pode ser criado por quem pode editar o projeto (admin ou o gestor desse
  // projeto). Editar um já existente: o Administrador pode sempre, mesmo depois de fechado (é quem
  // decide o que fica arrumado); o Gestor só o que ele próprio criou, e só enquanto não estiver
  // fechado (fica um registo histórico assim que o Administrador o fecha).
  podeEditarProximoPasso(p, pp) {
    if (this.souAdmin()) return true;
    if (pp.fechado) return false;
    return this.souGestorDe(p.id) && pp.criadoPor === this.perfilAtual()?.recursoId;
  },
  // Eliminar: o Administrador pode sempre (mesmo já fechado); o Gestor só o que criou e só
  // enquanto não estiver fechado.
  podeEliminarProximoPasso(p, pp) {
    if (this.souAdmin()) return true;
    return !pp.fechado && this.souGestorDe(p.id) && pp.criadoPor === this.perfilAtual()?.recursoId;
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
  novoProximoPassoObj(descricao, tarefaId, pontoSituacaoId, responsavelId, criadoPor) {
    const agora = new Date().toISOString();
    return {
      id: crypto.randomUUID(), tarefaId: tarefaId || null, pontoSituacaoId: pontoSituacaoId || null,
      responsavelId: responsavelId || null, dataPrevista: null, dataReal: null,
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
      predecessores: [],
      negrito: false,
      italico: false,
      cor: null
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
      // Um <input type="date"> dispara "change" assim que o valor fica "completo" — ao escrever
      // o ano dígito a dígito (ex.: "2026"), isso acontece logo no primeiro "2" (ano 0002), muito
      // antes de a pessoa acabar de escrever. Se aceitássemos e re-desenhássemos a linha nesse
      // instante, o campo perdia o foco/estado a meio da escrita. Ignora anos claramente
      // incompletos — a app só reage quando o ano já é plausível.
      const ano = parseInt(String(valor).slice(0, 4), 10);
      if (!ano || ano < 1000) return;
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
  // Formatação do rótulo (negrito/itálico/cor) — só o nome inteiro, aplicada na tabela e no Gantt.
  atualizarFormatoTarefa(id, campo, valor) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, id);
    if (!t || !this.possoEditarProjeto(p.id)) return;
    if (campo === 'cor') t.cor = valor || null; else t[campo] = !!valor;
    this.persist();
    this.renderTudo();
  },
  abrirModalFormatoTarefa(id) {
    const p = this.projetoAtivo();
    const t = this.tarefaPorId(p, id);
    if (!t) return;
    const html = `
      <label style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="fmtNegrito" ${t.negrito ? 'checked' : ''}> Negrito</label>
      <label style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="fmtItalico" ${t.italico ? 'checked' : ''}> Itálico</label>
      <label>Cor do texto
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="color" id="fmtCor" value="${t.cor || '#12222f'}" style="width:44px;padding:2px;">
          <button class="btn btn-sm" id="fmtLimparCor">Sem cor</button>
        </div>
      </label>`;
    this.abrirModal(`Formatar — ${t.nome}`, html);
    document.getElementById('fmtNegrito').addEventListener('change', (e) => this.atualizarFormatoTarefa(id, 'negrito', e.target.checked));
    document.getElementById('fmtItalico').addEventListener('change', (e) => this.atualizarFormatoTarefa(id, 'italico', e.target.checked));
    document.getElementById('fmtCor').addEventListener('change', (e) => this.atualizarFormatoTarefa(id, 'cor', e.target.value));
    document.getElementById('fmtLimparCor').addEventListener('click', () => {
      this.atualizarFormatoTarefa(id, 'cor', null);
      document.getElementById('fmtCor').value = '#12222f';
    });
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
      cliente: dados.cliente || '',
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
  // dentro desse mês — usado para construir a reprevisão. Uma tarefa sem nenhum consultor
  // atribuído não entra na conta (0h): sem alguém indicado, não há esforço real associado a
  // somar, só um marco/fase de calendário — contá-la como "1 pessoa a tempo inteiro" por omissão
  // inflava artificialmente a reprevisão sempre que várias tarefas por atribuir se sobrepunham.
  planeadoMesProjeto(p, ano, mes) {
    const inicioMes = new Date(ano, mes, 1);
    const fimMes = new Date(ano, mes + 1, 0);
    let total = 0;
    p.tarefas.forEach(t => {
      if (this.temFilhos(p, t.id)) return;
      if (!t.recursoIds.length) return;
      const inicioT = DateUtil.parseISO(t.inicio), fimT = DateUtil.parseISO(t.fim);
      const inicio = inicioT > inicioMes ? inicioT : inicioMes;
      const fim = fimT < fimMes ? fimT : fimMes;
      if (inicio > fim) return;
      const fatorRecursos = t.recursoIds.reduce((soma, rid) => soma + this.pctAlocacao(t, rid) / 100, 0);
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
      e.gridPortefolio.innerHTML = '<p style="color:var(--cinza-500)">Sem projetos carregados.</p>';
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
    `).join('') || '<span style="color:var(--cinza-500);font-size:12px;">Sem projetos.</span>';
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
    }).join('') : '<tr class="empty-row"><td colspan="4" style="text-align:center;color:var(--cinza-500);padding:16px">Seleciona pelo menos um projeto.</td></tr>';
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
    const selGestor = this.els.selGestorFiltroGantt;
    let projetos = this.meusProjetosEnvolvidos();
    if (this.souAdmin() && selGestor) {
      const valorAtual = selGestor.value;
      selGestor.innerHTML = '<option value="">Todos os gestores</option>' +
        this.state.utilizadores.map(u => `<option value="${escapeAttr(u.recursoId || '')}">${escapeHtml(u.nome || u.email)}</option>`).join('');
      selGestor.value = valorAtual;
      this.filtroGestorGantt = selGestor.value;
      if (this.filtroGestorGantt) projetos = projetos.filter(p => p.gestorId === this.filtroGestorGantt);
    }
    sel.innerHTML = '';
    projetos.forEach(p => {
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
    this.renderTodosPassos();
  },

  // Esconde/mostra grupos de navegação, separadores e botões consoante o papel do utilizador
  // autenticado. Chamado a cada renderTudo() — é barato (só toggles de style.display) e mantém a
  // interface correta mesmo depois de o próprio administrador alterar um papel.
  aplicarPermissoesUI() {
    const e = this.els;
    const admin = this.souAdmin();
    const gestorDeAlgo = this.souGestorDeAlgumProjeto();
    if (e.grupoBtnEquipa) e.grupoBtnEquipa.style.display = admin ? '' : 'none';
    if (e.grupoBtnFaturacao) e.grupoBtnFaturacao.style.display = gestorDeAlgo ? '' : 'none';
    if (e.tabBtnAcompanhamento) e.tabBtnAcompanhamento.style.display = gestorDeAlgo ? '' : 'none';
    if (e.tabBtnTodosPassos) e.tabBtnTodosPassos.style.display = admin ? '' : 'none';
    if (e.selGestorFiltroGantt) e.selGestorFiltroGantt.style.display = admin ? '' : 'none';
    ['btnNovoProjeto', 'btnNovoProjeto2', 'btnDuplicarProjeto', 'btnEliminarProjeto'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = admin ? '' : 'none';
    });
    if (!admin && ['recursos', 'capacidade', 'feriados', 'todosPassos'].includes(this.abaAtiva)) this.irParaAba('gantt');
    if (!gestorDeAlgo && this.abaAtiva === 'faturacao') this.irParaAba('registo');
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
    // Opções dos filtros (preservam o valor atual ao repopular).
    const e = this.els;
    const valorFiltroGestor = e.fProjGestor.value;
    e.fProjGestor.innerHTML = '<option value="">Todos</option>' + this.state.utilizadores.map(u => `<option value="${escapeAttr(u.recursoId || '')}">${escapeHtml(u.nome || u.email)}</option>`).join('');
    e.fProjGestor.value = valorFiltroGestor;
    const valorFiltroCliente = e.fProjCliente.value;
    const clientesDistintos = [...new Set(Object.values(this.state.projetos).map(p => p.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    e.fProjCliente.innerHTML = '<option value="">Todos</option>' + clientesDistintos.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    e.fProjCliente.value = valorFiltroCliente;

    const f = this.filtrosProjetos;
    let linhas = this.meusProjetosEnvolvidos().map(p => ({ p, orc: this.avaliarOrcamentoProjeto(p) }));
    linhas = linhas.filter(({ p, orc }) => {
      if (f.gestorId && p.gestorId !== f.gestorId) return false;
      if (f.cliente && p.cliente !== f.cliente) return false;
      if (f.estado && p.estado !== f.estado) return false;
      if (f.estadoOrc && orc.nivel !== f.estadoOrc) return false;
      return true;
    });
    const ordenadas = this.aplicarOrdenacaoTabela('tabelaProjetos', linhas, (l, campo) => {
      const { p, orc } = l;
      switch (campo) {
        case 'nome': return p.nome.toLowerCase();
        case 'cliente': return (p.cliente || '').toLowerCase();
        case 'gestor': return this.nomeUtilizador(p.gestorId).toLowerCase();
        case 'dataInicio': return p.dataInicio || '';
        case 'dataFim': return p.dataFim || '';
        case 'horasVendidas': return p.horasVendidas || 0;
        case 'valorVendido': return p.valorVendido || 0;
        case 'valorHoraMedio': return p.horasVendidas ? (p.valorVendido || 0) / p.horasVendidas : 0;
        case 'estado': return p.estado || '';
        case 'real': return orc.totalReal;
        case 'eac': return orc.eac;
        case 'saldo': return orc.saldoDisponivel === null ? -Infinity : orc.saldoDisponivel;
        case 'pctConsumido': return orc.pctConsumido === null ? -Infinity : orc.pctConsumido;
        case 'estadoOrc': return orc.motivo || '';
        default: return (p.idInterno || '').toLowerCase();
      }
    });
    ordenadas.forEach(({ p, orc }) => {
      const tr = document.createElement('tr');
      const corNivel = { verde: 'var(--verde)', amarelo: 'var(--amarelo)', vermelho: 'var(--vermelho)', neutro: 'var(--cinza-500)' };
      const podeEditar = this.possoEditarProjeto(p.id);
      const dis = podeEditar ? '' : 'disabled';
      tr.innerHTML = `
        <td><input type="text" value="${escapeAttr(p.idInterno || '')}" data-campo="idInterno" autocomplete="new-password" spellcheck="false" readonly ${dis}></td>
        <td><input type="text" value="${escapeAttr(p.nome)}" data-campo="nome" ${dis}></td>
        <td><input type="text" value="${escapeAttr(p.cliente || '')}" data-campo="cliente" ${dis}></td>
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
            ${['Adjudicado', 'Por iniciar', 'Em curso', 'Concluído', 'Cancelado'].map(op => `<option ${p.estado === op ? 'selected' : ''}>${op}</option>`).join('')}
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
      const inpIdInterno = tr.querySelector('[data-campo="idInterno"]');
      inpIdInterno.addEventListener('focus', (ev) => ev.target.removeAttribute('readonly'), { once: true });
      this.bloquearPreenchimentoAutomatico(inpIdInterno);
      tr.querySelectorAll('input[data-campo],select[data-campo="estado"]').forEach(inp => {
        inp.addEventListener('change', () => {
          p[inp.dataset.campo] = (inp.type === 'number') ? (parseFloat(inp.value) || 0) : inp.value.trim();
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
    this.aplicarVisibilidadeColunasProjetos();
  },
  aplicarFiltrosProjetos() {
    const e = this.els;
    this.filtrosProjetos = {
      gestorId: e.fProjGestor.value, cliente: e.fProjCliente.value,
      estado: e.fProjEstado.value, estadoOrc: e.fProjEstadoOrc.value
    };
    this.renderTabelaProjetos();
  },
  // Painel "⚙ Colunas" — quais ficam escondidas fica guardado em localStorage (gp_ui_prefs), como
  // as larguras/ordenação de outras tabelas; lido de fresco de cada vez, sem estado à parte.
  colunasEscondidasProjetosSet() {
    return new Set(this.lerPrefsUI().colunasEscondidasProjetos || []);
  },
  alternarColunaProjeto(key) {
    const escondidas = this.colunasEscondidasProjetosSet();
    if (escondidas.has(key)) escondidas.delete(key); else escondidas.add(key);
    this.gravarPrefUI('colunasEscondidasProjetos', [...escondidas]);
    this.aplicarVisibilidadeColunasProjetos();
  },
  renderPainelColunasProjetos() {
    const escondidas = this.colunasEscondidasProjetosSet();
    this.els.painelColunasProjetos.innerHTML = this.COLUNAS_PROJETOS.map(c => `
      <label style="display:flex;gap:8px;align-items:center;padding:5px 12px;font-size:12.5px;cursor:pointer;">
        <input type="checkbox" data-col="${c.key}" ${escondidas.has(c.key) ? '' : 'checked'}> ${escapeHtml(c.label)}
      </label>`).join('');
    this.els.painelColunasProjetos.querySelectorAll('input[data-col]').forEach(chk => {
      chk.addEventListener('change', () => this.alternarColunaProjeto(chk.dataset.col));
    });
  },
  alternarPainelColunasProjetos() {
    const aberto = this.els.painelColunasProjetos.classList.toggle('aberto');
    if (aberto) this.renderPainelColunasProjetos();
  },
  // Colunas escondidas identificam-se pela posição (nth-child), tal como o cabeçalho — esta
  // tabela não tem reordenação de colunas (ao contrário da tabela de tarefas do Gantt), por isso
  // a posição de cada <th data-col> corresponde sempre à mesma posição em cada <td> da linha.
  aplicarVisibilidadeColunasProjetos() {
    const escondidas = this.colunasEscondidasProjetosSet();
    const ths = document.querySelectorAll('#tabelaProjetos thead th[data-col]');
    ths.forEach((th, idx) => {
      const esconder = escondidas.has(th.dataset.col);
      th.style.display = esconder ? 'none' : '';
      document.querySelectorAll(`#tabelaProjetos tbody tr td:nth-child(${idx + 1})`).forEach(td => {
        td.style.display = esconder ? 'none' : '';
      });
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
    const nomeEquipaDe = (r) => (this.state.equipas.find(eq => eq.id === r.equipaId) || {}).nome || '';
    const recursos = this.aplicarOrdenacaoTabela('tabelaRecursosCentral', this.state.recursos, (r, campo) => {
      switch (campo) {
        case 'email': return (r.email || '').toLowerCase();
        case 'papel': return (r.papel || '').toLowerCase();
        case 'equipa': return nomeEquipaDe(r).toLowerCase();
        case 'precoCusto': return r.precoCusto || 0;
        case 'precoVenda': return r.precoVenda || 0;
        case 'margem': return r.precoVenda ? ((r.precoVenda - r.precoCusto) / r.precoVenda) : 0;
        case 'acesso': return (this.state.utilizadores.find(u => u.recursoId === r.id) || {}).papel || '';
        default: return r.nome.toLowerCase();
      }
    });
    recursos.forEach(r => {
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
      this.bloquearPreenchimentoAutomatico(tr.querySelector('[data-campo="nome"]'));
      this.bloquearPreenchimentoAutomatico(tr.querySelector('[data-campo="email"]'));
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
    const equipas = this.aplicarOrdenacaoTabela('tabelaEquipas', this.state.equipas, (eq) => eq.nome.toLowerCase());
    equipas.forEach(eq => {
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
    const feriados = this.aplicarOrdenacaoTabela('tabelaFeriados', this.state.feriados, (f, campo) => campo === 'descricao' ? (f.descricao || '').toLowerCase() : f.data);
    feriados.forEach(f => {
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
    const nomeRecursoDe = (a) => (this.state.recursos.find(r => r.id === a.recursoId) || {}).nome || '';
    const ausencias = this.aplicarOrdenacaoTabela('tabelaAusencias', this.state.ausencias, (a, campo) => {
      switch (campo) {
        case 'recurso': return nomeRecursoDe(a).toLowerCase();
        case 'tipo': return a.tipo || '';
        case 'dataFim': return a.dataFim || '';
        case 'notas': return (a.notas || '').toLowerCase();
        default: return a.dataInicio || '';
      }
    });
    ausencias.forEach(a => {
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
  // Avança/recua um mês o "A partir de" da Capacidade — mantém o mesmo horizonte, só desloca o
  // início da janela (incluindo para trás, para ver meses já passados).
  navegarMesCap(delta) {
    const e = this.els;
    const atual = e.selMesInicioCap.value || DateUtil.todayISO().slice(0, 7);
    const [ano, mes] = atual.split('-').map(Number);
    const d = new Date(ano, mes - 1 + delta, 1);
    e.selMesInicioCap.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.renderCapacidade();
  },
  renderCapacidade() {
    const e = this.els;
    if (!e.gridCapacidade) return;
    const nMeses = parseInt(e.selHorizonteCap.value, 10) || 6;
    // "A partir de" (input type=month) — por omissão o mês atual (mantém o comportamento de
    // sempre mostrar os 6 meses seguintes), mas dá para recuar e ver meses passados.
    if (!e.selMesInicioCap.value) {
      const hoje = new Date();
      e.selMesInicioCap.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    }
    const [anoIni, mesIni] = e.selMesInicioCap.value.split('-').map(Number);
    const meses = Capacidade.horizonteMeses(nMeses, { ano: anoIni, mes: mesIni - 1 });

    e.heatmapCapHead.innerHTML = '<th>Consultor</th>' + meses.map(m => `<th>${escapeHtml(m.label)}</th>`).join('');
    e.heatmapCapBody.innerHTML = '';
    e.gridCapacidade.innerHTML = '';

    this.filtroEquipaCap = e.selEquipaCap.value;
    const recursosFiltrados = this.filtroEquipaCap
      ? this.state.recursos.filter(r => String(r.equipaId || '') === this.filtroEquipaCap)
      : this.state.recursos;

    if (this.state.recursos.length === 0) {
      e.gridCapacidade.innerHTML = '<p style="color:var(--cinza-500)">Sem consultores definidos. Adiciona no separador "Pessoas".</p>';
      return;
    }
    if (recursosFiltrados.length === 0) {
      e.gridCapacidade.innerHTML = '<p style="color:var(--cinza-500)">Nenhum consultor nesta equipa.</p>';
      return;
    }

    recursosFiltrados.forEach(r => {
      const resumos = meses.map(m => Object.assign({ label: m.label }, Capacidade.resumoMes(r, m.ano, m.mes)));

      const tr = document.createElement('tr');
      const celulas = resumos.map(res => {
        const cls = Capacidade.classeResumo(res);
        const temContexto = res.capacidade > 0 || res.alocado > 0;
        const texto = !temContexto ? '—' : (isFinite(res.pct) ? Math.round(res.pct * 100) + '%' : '⚠');
        let dica = '';
        if (res.diasSobreAlocado > 0) dica += ` — ⚠ sobre-alocado(a) em ${this.formatarDatasConflito(res.datasSobreAlocado)} (duplo agendamento)`;
        if (res.diasConflitoDisponibilidade > 0) dica += ` — ⚠ conflito com ausência/feriado em ${this.formatarDatasConflito(res.datasConflitoDisponibilidade)}`;
        return `<td class="occ-${cls}" title="${res.alocado.toFixed(0)}h alocadas / ${res.capacidade.toFixed(0)}h capacidade${dica}">${texto}</td>`;
      }).join('');
      tr.innerHTML = `<th>${escapeHtml(r.nome)}</th>${celulas}`;
      e.heatmapCapBody.appendChild(tr);

      const mesAtual = resumos[0];
      const revenueTotal = resumos.reduce((s, res) => s + res.alocado, 0) * (r.precoVenda || 0);
      const projetos = Capacidade.projetosDoRecurso(r.id);
      const datasSobreAlocado = resumos.reduce((acc, res) => acc.concat(res.datasSobreAlocado), []);
      const datasConflito = resumos.reduce((acc, res) => acc.concat(res.datasConflitoDisponibilidade), []);
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
        <div class="cap-meta">${escapeHtml(mesAtual.label)}: ${mesAtual.alocado.toFixed(0)}h alocadas / ${mesAtual.capacidade.toFixed(0)}h disponíveis</div>
        <div class="cap-meses">
          ${resumos.map(res => `<div class="cap-mes-barra" title="${escapeHtml(res.label)}: ${isFinite(res.pct) ? Math.round(res.pct * 100) : 0}%"><div class="cap-mes-fill cap-${Capacidade.classeResumo(res)}" style="height:${Math.max(Math.min(res.pct * 100, 100), res.alocado > 0 ? 6 : 0)}%"></div></div>`).join('')}
        </div>
        <div class="cap-revenue">Revenue previsto (${nMeses}m): <b>${revenueTotal.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €</b></div>
        ${datasSobreAlocado.length ? `<div class="cap-alerta">⚠ Sobre-alocado em: ${this.formatarDatasConflito(datasSobreAlocado, 10)}</div>` : ''}
        ${datasConflito.length ? `<div class="cap-alerta cap-alerta-conflito">⚠ Conflito com ausência/feriado em: ${this.formatarDatasConflito(datasConflito, 10)}</div>` : ''}
        <div class="cap-projetos">
          ${projetos.length ? projetos.map(pr => `<div class="cap-projeto-linha">${escapeHtml(pr.projeto.nome)}<span class="cap-projeto-datas">${DateUtil.formatShort(DateUtil.parseISO(pr.inicio))} – ${DateUtil.formatShort(DateUtil.parseISO(pr.fim))}</span></div>`).join('') : '<span style="color:var(--cinza-500)">Sem alocações.</span>'}
        </div>
        <button class="btn btn-sm" style="margin-top:8px;width:100%;" data-acao="ver-tarefas">📋 Ver todas as tarefas</button>`;
      card.querySelector('[data-acao="ver-tarefas"]').addEventListener('click', () => this.abrirModalAlocacoesRecurso(r.id));
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
  // Mesma lógica de "a que projetos/tarefas esta pessoa está ligada" do formulário de criar
  // registo, reutilizada para editar linhas já existentes na tabela de Registos (só Administrador).
  projetosDaPessoaRegisto(nomePessoa) {
    const recurso = this.state.recursos.find(r => r.nome === nomePessoa);
    if (!recurso) return [];
    return Object.values(this.state.projetos).filter(p => p.idInterno && p.tarefas.some(t => t.recursoIds.includes(recurso.id)));
  },
  tarefasDoProjetoParaPessoaRegisto(idInternoProjeto, nomePessoa) {
    const p = Object.values(this.state.projetos).find(pr => pr.idInterno === idInternoProjeto);
    const recurso = this.state.recursos.find(r => r.nome === nomePessoa);
    if (!p || !recurso) return [];
    return this.flatten(p).filter(x => !this.temFilhos(p, x.tarefa.id) && x.tarefa.recursoIds.includes(recurso.id)).map(x => x.tarefa);
  },
  // Edição direta de um registo já existente (só Administrador) — ao contrário da criação, isto
  // não passa pelo undo/redo nem pelo diff de sincronização normal (registos, por design, só são
  // sincronizados como "novo" ou "apagado" — ver Sync.sincronizarListaSimples/sincronizarRegistos);
  // por isso escreve logo na Supabase, como já acontece com atualizarUtilizador/atualizarConta.
  async atualizarCampoRegisto(id, campo, valor) {
    if (!this.souAdmin()) return;
    const r = this.state.registos.find(x => x.id === id);
    if (!r) return;
    const campos = {};
    if (campo === 'data') {
      // Mesmo problema do <input type="date"> nas tarefas do Gantt: dispara "change" logo ao
      // primeiro dígito do ano (ex.: "2" vira 0002) — ignora enquanto o ano não for plausível.
      const ano = parseInt(String(valor).slice(0, 4), 10);
      if (!ano || ano < 1000) return;
      r.data = valor; campos.data = valor;
    } else if (campo === 'horas') {
      // Horas é obrigatório e tem de ser maior que zero — nunca se aceita vazio/zero/negativo,
      // nem na criação nem aqui.
      const h = parseFloat(valor);
      if (!h || h <= 0) { this.toast('Horas é obrigatório e tem de ser maior que zero.'); this.renderTabelaRegistos(); return; }
      r.horas = h; campos.horas = h;
    } else if (campo === 'notas') {
      r.notas = valor.trim(); campos.notas = r.notas;
    } else {
      return;
    }
    try {
      await Sync.atualizarRegisto(id, campos);
    } catch (err) {
      this.toast('Erro ao atualizar registo: ' + err.message);
    }
    this.renderTabelaRegistos();
  },
  // Pessoa/Projeto/Tarefa mudam sempre em conjunto (ver as chamadas em renderTabelaRegistos) —
  // um registo nunca pode ficar sem tarefa associada, por isso as três só se gravam juntas, já
  // com a combinação final validada (a tarefa escolhida tem mesmo de pertencer ao projeto e a
  // pessoa indicados).
  async gravarLinhaRegisto(id, alteracoes) {
    if (!this.souAdmin()) return;
    const r = this.state.registos.find(x => x.id === id);
    if (!r) return;
    const campos = {};
    if ('pessoa' in alteracoes) { r.pessoa = alteracoes.pessoa; campos.pessoa = r.pessoa; }
    if ('projetoIdInterno' in alteracoes) {
      const proj = Object.values(this.state.projetos).find(p => p.idInterno === alteracoes.projetoIdInterno);
      r.projetoIdInterno = alteracoes.projetoIdInterno;
      r.projetoNome = proj ? proj.nome : alteracoes.projetoIdInterno;
      r.projetoId = proj ? proj.id : null;
      r.cliente = proj ? (proj.cliente || '') : '';
      campos.projeto_id_interno = r.projetoIdInterno;
      campos.projeto_nome = r.projetoNome;
      campos.projeto_id = r.projetoId;
      campos.cliente = r.cliente;
    }
    if ('tarefaNome' in alteracoes) { r.tarefaNome = alteracoes.tarefaNome; campos.tarefa_nome = r.tarefaNome; }
    try {
      await Sync.atualizarRegisto(id, campos);
    } catch (err) {
      this.toast('Erro ao atualizar registo: ' + err.message);
    }
    this.renderTabelaRegistos();
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
      data, pessoa, projetoIdInterno, projetoNome, projetoId: proj ? proj.id : null, cliente: proj ? (proj.cliente || '') : '', tarefaNome, horas, notas,
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
      case 'cliente': return (r.cliente || '').toLowerCase();
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

    e.corpoTabelaRegistos.innerHTML = '';
    const admin = this.souAdmin();
    if (!pagina.length) {
      e.corpoTabelaRegistos.innerHTML = '<tr class="empty-row"><td colspan="9" style="text-align:center;color:var(--cinza-500);padding:20px">Sem registos para os filtros selecionados.</td></tr>';
    }
    pagina.forEach(r => {
      const tr = document.createElement('tr');
      if (!admin) {
        tr.innerHTML = `
          <td>${DateUtil.formatShort(DateUtil.parseISO(r.data))}</td>
          <td>${escapeHtml(r.pessoa)}</td>
          <td>${escapeHtml(r.projetoIdInterno)} — ${escapeHtml(r.projetoNome)}</td>
          <td>${escapeHtml(r.cliente) || '<span style="color:var(--cinza-500)">—</span>'}</td>
          <td>${escapeHtml(r.tarefaNome) || '<span style="color:var(--cinza-500)">—</span>'}</td>
          <td>${(parseFloat(r.horas) || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}h</td>
          <td>${escapeHtml(r.notas)}</td>
          <td><span style="color:var(--cinza-500);font-size:11px">${escapeHtml(r.origem)}</span></td>
          <td class="col-acoes"><button class="btn-icon" data-eliminar="${r.id}" title="Eliminar">🗑</button></td>`;
        tr.querySelector('[data-eliminar]').addEventListener('click', () => this.eliminarRegisto(r.id));
        e.corpoTabelaRegistos.appendChild(tr);
        return;
      }
      // Administrador: todos os campos editáveis, com Projeto/Tarefa em cascata sobre a Pessoa —
      // as mesmas regras de "a que projetos/tarefas esta pessoa está ligada" do formulário de
      // criar registo (renderProjetosRegisto/renderTarefasRegisto), só que por linha já existente.
      // Cliente nunca se edita à parte — segue sempre o Projeto escolhido (ver atualizarCampoRegisto).
      const opcoesPessoa = this.state.recursos.map(rec => `<option value="${escapeAttr(rec.nome)}">${escapeHtml(rec.nome)}</option>`).join('');
      tr.innerHTML = `
        <td><input type="date" value="${r.data}" data-campo="data" style="min-width:120px"></td>
        <td><select data-campo="pessoa">${opcoesPessoa}</select></td>
        <td><select data-campo="projetoIdInterno" style="min-width:200px"></select></td>
        <td class="cel-cliente">${escapeHtml(r.cliente) || '<span style="color:var(--cinza-500)">—</span>'}</td>
        <td><select data-campo="tarefaNome" style="min-width:160px"></select></td>
        <td><input type="number" min="0.1" step="0.1" value="${parseFloat(r.horas) || 0}" data-campo="horas" style="width:60px"></td>
        <td><input type="text" value="${escapeAttr(r.notas)}" data-campo="notas" style="min-width:160px"></td>
        <td><span style="color:var(--cinza-500);font-size:11px">${escapeHtml(r.origem)}</span></td>
        <td class="col-acoes"><button class="btn-icon" data-eliminar="${r.id}" title="Eliminar">🗑</button></td>`;
      tr.querySelector('[data-campo="pessoa"]').value = r.pessoa;
      // Projeto e Tarefa nunca podem ficar por preencher — um registo sem tarefa associada não é
      // permitido (nem na criação, nem aqui). Sempre que a Pessoa ou o Projeto mudam de forma a
      // invalidar a escolha atual, escolhe-se automaticamente a primeira opção válida em vez de
      // deixar a célula vazia.
      const preencherProjetos = (manterSelecao) => {
        const selProjeto = tr.querySelector('[data-campo="projetoIdInterno"]');
        const nomePessoa = tr.querySelector('[data-campo="pessoa"]').value;
        const projetos = this.projetosDaPessoaRegisto(nomePessoa);
        if (!projetos.length) {
          selProjeto.innerHTML = '<option value="">Sem projetos atribuídos</option>';
          selProjeto.disabled = true;
          preencherTarefas();
          return;
        }
        selProjeto.disabled = false;
        selProjeto.innerHTML = projetos.map(p => `<option value="${escapeAttr(p.idInterno)}">${escapeHtml(p.idInterno)} — ${escapeHtml(p.nome)}</option>`).join('');
        selProjeto.value = manterSelecao && projetos.some(p => p.idInterno === r.projetoIdInterno) ? r.projetoIdInterno : projetos[0].idInterno;
        preencherTarefas();
      };
      const preencherTarefas = () => {
        const selTarefa = tr.querySelector('[data-campo="tarefaNome"]');
        const nomePessoa = tr.querySelector('[data-campo="pessoa"]').value;
        const idInternoProjeto = tr.querySelector('[data-campo="projetoIdInterno"]').value;
        const tarefas = this.tarefasDoProjetoParaPessoaRegisto(idInternoProjeto, nomePessoa);
        if (!tarefas.length) {
          selTarefa.innerHTML = '<option value="">Sem tarefas neste projeto</option>';
          selTarefa.disabled = true;
          return;
        }
        selTarefa.disabled = false;
        selTarefa.innerHTML = tarefas.map(t => `<option value="${escapeAttr(t.nome)}">${escapeHtml(t.nome)}</option>`).join('');
        selTarefa.value = tarefas.some(t => t.nome === r.tarefaNome) ? r.tarefaNome : tarefas[0].nome;
      };
      preencherProjetos(true);
      tr.querySelector('[data-campo="pessoa"]').addEventListener('change', (ev) => {
        preencherProjetos(false);
        const selProjeto = tr.querySelector('[data-campo="projetoIdInterno"]');
        const selTarefa = tr.querySelector('[data-campo="tarefaNome"]');
        if (!selProjeto.value || !selTarefa.value) { this.toast('Esta pessoa não tem tarefas atribuídas em nenhum projeto — o registo não pode ficar sem tarefa.'); this.renderTabelaRegistos(); return; }
        this.gravarLinhaRegisto(r.id, { pessoa: ev.target.value, projetoIdInterno: selProjeto.value, tarefaNome: selTarefa.value });
      });
      tr.querySelector('[data-campo="projetoIdInterno"]').addEventListener('change', (ev) => {
        preencherTarefas();
        const selTarefa = tr.querySelector('[data-campo="tarefaNome"]');
        if (!selTarefa.value) { this.toast('Este projeto não tem tarefas atribuídas a esta pessoa — o registo não pode ficar sem tarefa.'); this.renderTabelaRegistos(); return; }
        this.gravarLinhaRegisto(r.id, { projetoIdInterno: ev.target.value, tarefaNome: selTarefa.value });
      });
      tr.querySelector('[data-campo="tarefaNome"]').addEventListener('change', (ev) => {
        if (!ev.target.value) { this.toast('Tem de escolher uma tarefa.'); this.renderTabelaRegistos(); return; }
        this.gravarLinhaRegisto(r.id, { tarefaNome: ev.target.value });
      });
      tr.querySelector('[data-campo="data"]').addEventListener('change', (ev) => this.atualizarCampoRegisto(r.id, 'data', ev.target.value));
      tr.querySelector('[data-campo="horas"]').addEventListener('change', (ev) => this.atualizarCampoRegisto(r.id, 'horas', ev.target.value));
      tr.querySelector('[data-campo="notas"]').addEventListener('change', (ev) => this.atualizarCampoRegisto(r.id, 'notas', ev.target.value));
      tr.querySelector('[data-eliminar]').addEventListener('click', () => this.eliminarRegisto(r.id));
      e.corpoTabelaRegistos.appendChild(tr);
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
    this.renderCalendarioRegisto();
  },

  // ---------- Tab: Registo de Horas — Calendário ----------
  // Cor estável por pessoa (mesmo hash sempre dá a mesma cor), só para diferenciar visualmente
  // várias pessoas no mesmo mês — não tem nenhum significado além disso.
  corPessoaCalendario(nome) {
    const cores = this.CORES_CALENDARIO;
    let hash = 0;
    for (let i = 0; i < nome.length; i++) hash = (hash * 31 + nome.charCodeAt(i)) >>> 0;
    return cores[hash % cores.length];
  },
  // Mesma regra de permissão do Registo de Horas (Admin vê tudo; Gestor só os projetos que gere;
  // Consultor só os seus próprios registos), aplicada aos registos já existentes.
  registosCalendarioPermitidos() {
    const pessoasPermitidas = new Set(this.recursosPermitidosRegisto().map(r => r.nome));
    const projetosPermitidosIds = new Set(this.projetosRegistoPermitidos().map(p => p.idInterno));
    return this.state.registos.filter(r => pessoasPermitidas.has(r.pessoa) && projetosPermitidosIds.has(r.projetoIdInterno));
  },
  navegarMesCalendario(delta) {
    if (!this.calMesAtual) { const hoje = new Date(); this.calMesAtual = { ano: hoje.getFullYear(), mes: hoje.getMonth() }; }
    let { ano, mes } = this.calMesAtual;
    mes += delta;
    if (mes < 0) { mes = 11; ano--; } else if (mes > 11) { mes = 0; ano++; }
    this.calMesAtual = { ano, mes };
    this.renderCalendarioRegisto();
  },
  irParaHojeCalendario() {
    const hoje = new Date();
    this.calMesAtual = { ano: hoje.getFullYear(), mes: hoje.getMonth() };
    this.renderCalendarioRegisto();
  },
  aplicarFiltrosCalendarioRegisto() {
    const e = this.els;
    this.filtrosCalendarioRegisto = { pessoa: e.fCalPessoa.value, projeto: e.fCalProjeto.value };
    this.renderCalendarioRegisto();
  },
  // Vista mensal tipo Outlook: uma grelha de semanas/dias, com uma barra por registo em cada dia
  // (altura proporcional às horas desse registo). Só leitura — não há aqui edição/arrastar.
  renderCalendarioRegisto() {
    const e = this.els;
    if (!e.calendarioRegistos) return;
    if (!this.calMesAtual) { const hoje = new Date(); this.calMesAtual = { ano: hoje.getFullYear(), mes: hoje.getMonth() }; }

    const registosPermitidos = this.registosCalendarioPermitidos();
    const pessoasDisponiveis = [...new Set(registosPermitidos.map(r => r.pessoa))].sort((a, b) => a.localeCompare(b, 'pt'));
    const projetosDisponiveis = [];
    const idsProjetoVistos = new Set();
    registosPermitidos.forEach(r => {
      if (idsProjetoVistos.has(r.projetoIdInterno)) return;
      idsProjetoVistos.add(r.projetoIdInterno);
      projetosDisponiveis.push({ idInterno: r.projetoIdInterno, nome: r.projetoNome });
    });
    projetosDisponiveis.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt'));

    if (e.fCalPessoa) {
      const valorPessoa = this.filtrosCalendarioRegisto.pessoa;
      e.fCalPessoa.innerHTML = '<option value="">Todas</option>' + pessoasDisponiveis.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
      e.fCalPessoa.value = pessoasDisponiveis.includes(valorPessoa) ? valorPessoa : '';
    }
    if (e.fCalProjeto) {
      const valorProjeto = this.filtrosCalendarioRegisto.projeto;
      e.fCalProjeto.innerHTML = '<option value="">Todos</option>' + projetosDisponiveis.map(p => `<option value="${escapeAttr(p.idInterno)}">${escapeHtml(p.idInterno)} — ${escapeHtml(p.nome)}</option>`).join('');
      e.fCalProjeto.value = projetosDisponiveis.some(p => p.idInterno === valorProjeto) ? valorProjeto : '';
    }
    this.filtrosCalendarioRegisto = { pessoa: e.fCalPessoa ? e.fCalPessoa.value : '', projeto: e.fCalProjeto ? e.fCalProjeto.value : '' };

    const f = this.filtrosCalendarioRegisto;
    const registosFiltrados = registosPermitidos.filter(r => (!f.pessoa || r.pessoa === f.pessoa) && (!f.projeto || r.projetoIdInterno === f.projeto));

    const { ano, mes } = this.calMesAtual;
    const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    if (e.calMesLabel) e.calMesLabel.textContent = `${NOMES_MES[mes]} ${ano}`;

    const primeiroDiaMes = new Date(ano, mes, 1);
    const ultimoDiaMes = new Date(ano, mes + 1, 0);
    const inicioGrelha = new Date(primeiroDiaMes);
    inicioGrelha.setDate(inicioGrelha.getDate() - inicioGrelha.getDay());
    const fimGrelha = new Date(ultimoDiaMes);
    fimGrelha.setDate(fimGrelha.getDate() + (6 - fimGrelha.getDay()));

    const porDia = {};
    registosFiltrados.forEach(r => { (porDia[r.data] = porDia[r.data] || []).push(r); });
    Object.values(porDia).forEach(lista => lista.sort((a, b) => a.pessoa.localeCompare(b.pessoa, 'pt') || a.projetoNome.localeCompare(b.projetoNome, 'pt')));

    const hojeISO = DateUtil.todayISO();
    const mostrarPessoaNaBarra = !f.pessoa && pessoasDisponiveis.length > 1;
    const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    let html = '<div class="cal-cabecalho">' + DIAS_SEMANA.map(d => `<div>${d}</div>`).join('') + '</div><div class="cal-grelha">';
    let cursor = new Date(inicioGrelha);
    while (cursor <= fimGrelha) {
      const iso = DateUtil.toISO(cursor);
      const foraDoMes = cursor.getMonth() !== mes;
      const registosDoDia = porDia[iso] || [];
      const totalHoras = registosDoDia.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
      const blocos = registosDoDia.map(r => {
        const horas = parseFloat(r.horas) || 0;
        const altura = Math.max(20, Math.min(horas * 12, 96));
        const cor = this.corPessoaCalendario(r.pessoa);
        const linha1 = mostrarPessoaNaBarra ? `${escapeHtml(r.pessoa)} — ${escapeHtml(r.projetoNome)}` : escapeHtml(r.projetoNome);
        const titulo = `${escapeAttr(r.pessoa)} · ${escapeAttr(r.projetoNome)}${r.tarefaNome ? ' · ' + escapeAttr(r.tarefaNome) : ''} · ${horas}h${r.notas ? ' · ' + escapeAttr(r.notas) : ''}`;
        return `<div class="cal-bloco" style="height:${altura}px;background:${cor};" title="${titulo}">
          <span class="cal-bloco-linha1">${linha1}</span>
          <span class="cal-bloco-linha2">${escapeHtml(r.tarefaNome || '')} · ${horas}h</span>
        </div>`;
      }).join('');
      html += `<div class="cal-dia${foraDoMes ? ' fora-mes' : ''}${iso === hojeISO ? ' hoje' : ''}">
        <div class="cal-dia-cabecalho"><span class="cal-dia-numero">${cursor.getDate()}</span>${totalHoras ? `<span class="cal-dia-total">${totalHoras}h</span>` : ''}</div>
        <div class="cal-dia-blocos">${blocos}</div>
      </div>`;
      cursor = DateUtil.addDays(cursor, 1);
    }
    html += '</div>';
    e.calendarioRegistos.innerHTML = html;
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
      e.corpoTabelaFaturas.innerHTML = '<tr class="empty-row"><td colspan="10" style="text-align:center;color:var(--cinza-500);padding:20px">Sem faturas para os filtros selecionados.</td></tr>';
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
  // Pontos de situação: só o Administrador cria/edita/apaga. Next steps: Administrador e Gestor do
  // projeto podem criar (sempre associados a uma sessão de ponto de situação, com um consultor do
  // projeto como responsável); cada um só edita/apaga os que criou, exceto o Administrador que pode
  // editar/apagar qualquer um (ver podeEditarProximoPasso/podeEliminarProximoPasso). Mostra sempre o
  // projeto ativo do Gantt (não tem filtro de projeto próprio, ao contrário da Faturação).
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
  // Um next step tem sempre de estar associado a uma sessão já existente — não há para onde o
  // associar sem pelo menos um Ponto de Situação criado primeiro (só o Administrador cria esses).
  criarProximoPasso() {
    const p = this.projetoAtivo();
    if (!p || !this.possoEditarProjeto(p.id)) return;
    const ultimoPonto = [...p.pontosSituacao].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)).pop();
    if (!ultimoPonto) { this.toast('Cria primeiro um Ponto de Situação — um next step tem de estar associado a uma sessão.'); return; }
    p.proximosPassos.push(this.novoProximoPassoObj('Novo next step', null, ultimoPonto.id, null, this.perfilAtual()?.recursoId));
    this.persist();
    this.renderAcompanhamento();
  },
  atualizarProximoPasso(id, campo, valor) {
    const p = this.projetoAtivo();
    if (!p) return;
    const pp = p.proximosPassos.find(x => x.id === id);
    if (!pp || !this.podeEditarProximoPasso(p, pp)) return;
    pp[campo] = ['tarefaId', 'pontoSituacaoId', 'responsavelId', 'dataPrevista', 'dataReal'].includes(campo) ? (valor || null) : valor;
    pp.atualizadoEm = new Date().toISOString();
    this.persist();
    this.renderAcompanhamento();
  },
  eliminarProximoPasso(id) {
    const p = this.projetoAtivo();
    if (!p) return;
    const pp = p.proximosPassos.find(x => x.id === id);
    if (!pp || !this.podeEliminarProximoPasso(p, pp)) return;
    if (!confirm('Eliminar este next step?')) return;
    p.proximosPassos = p.proximosPassos.filter(x => x.id !== id);
    this.persist();
    this.renderAcompanhamento();
  },
  // Se o estado ainda não é "Concluído" nem "Abandonado", pergunta primeiro se quer corrigir o
  // estado antes de fechar — quem responder "sim" só cancela este fecho (o estado corrige-se no
  // próprio select da linha; o fecho fica para o próximo clique em "Fechar").
  fecharProximoPasso(id) {
    if (!this.souAdmin()) return;
    const p = this.projetoAtivo();
    const pp = p && p.proximosPassos.find(x => x.id === id);
    if (!pp) return;
    if (!['concluido', 'abandonado'].includes(pp.estado)) {
      const corrigirEstado = confirm('O estado ainda não está "Concluído" nem "Abandonado". Queres alterar o estado antes de fechar este next step?');
      if (corrigirEstado) return;
    }
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
    if (btnAddPP) {
      btnAddPP.style.display = podeVer ? '' : 'none';
      const semSessao = podeVer && !p.pontosSituacao.length;
      btnAddPP.disabled = semSessao;
      btnAddPP.title = semSessao ? 'Cria primeiro um Ponto de Situação — um next step tem de estar associado a uma sessão.' : '';
    }
    if (!podeVer) return;

    const pontos = this.aplicarOrdenacaoTabela('tabelaPontosSituacao', p.pontosSituacao, (ps, campo) => campo === 'feedback' ? (ps.feedback || '').toLowerCase() : ps.data);
    e.corpoPontosSituacao.innerHTML = pontos.length ? '' : '<tr class="empty-row"><td colspan="3" style="text-align:center;color:var(--cinza-500);padding:16px">Sem pontos de situação registados.</td></tr>';
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
    const sessoesOrdenadas = [...p.pontosSituacao].sort((a, b) => a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm));
    const opcoesSessao = sessoesOrdenadas.map(ps => `<option value="${ps.id}">${escapeHtml(DateUtil.formatShort(DateUtil.parseISO(ps.data)))}${ps.feedback ? ' — ' + escapeHtml(ps.feedback.slice(0, 30)) : ''}</option>`).join('');
    const consultores = this.consultoresDoProjeto(p);
    const opcoesResponsavel = '<option value="">— Sem responsável —</option>' + consultores.map(r => `<option value="${r.id}">${escapeHtml(r.nome)}</option>`).join('');

    const passos = this.aplicarOrdenacaoTabela('tabelaProximosPassos', p.proximosPassos, (pp, campo) => {
      switch (campo) {
        case 'descricao': return (pp.descricao || '').toLowerCase();
        case 'sessao': return (p.pontosSituacao.find(ps => ps.id === pp.pontoSituacaoId) || {}).data || '';
        case 'tarefa': return ((tarefasFolha.find(t => t.id === pp.tarefaId) || {}).nome || '').toLowerCase();
        case 'responsavel': return ((consultores.find(r => r.id === pp.responsavelId) || {}).nome || '').toLowerCase();
        case 'dataPrevista': return pp.dataPrevista || '';
        case 'dataReal': return pp.dataReal || '';
        case 'estado': return pp.estado || '';
        case 'notas': return (pp.notas || '').toLowerCase();
        default: return pp.fechado ? 1 : 0;
      }
    });
    e.corpoProximosPassos.innerHTML = passos.length ? '' : '<tr class="empty-row"><td colspan="10" style="text-align:center;color:var(--cinza-500);padding:16px">Sem next steps registados.</td></tr>';
    passos.forEach(pp => {
      const tr = document.createElement('tr');
      const podeEditar = this.podeEditarProximoPasso(p, pp);
      const podeEliminar = this.podeEliminarProximoPasso(p, pp);
      const dis = podeEditar ? '' : 'disabled';
      const sessao = p.pontosSituacao.find(ps => ps.id === pp.pontoSituacaoId);
      const nomeCriador = (this.state.recursos.find(r => r.id === pp.criadoPor) || {}).nome || '—';
      tr.innerHTML = `
        <td>${podeEditar ? `<input type="text" value="${escapeAttr(pp.descricao)}" data-campo="descricao" style="min-width:180px">` : escapeHtml(pp.descricao)}</td>
        <td>${podeEditar ? `<select data-campo="pontoSituacaoId">${opcoesSessao}</select>` : escapeHtml(sessao ? DateUtil.formatShort(DateUtil.parseISO(sessao.data)) : '—')}</td>
        <td>${podeEditar ? `<select data-campo="tarefaId">${opcoesTarefa}</select>` : escapeHtml((tarefasFolha.find(t => t.id === pp.tarefaId) || {}).nome || '—')}</td>
        <td>${podeEditar ? `<select data-campo="responsavelId">${opcoesResponsavel}</select>` : escapeHtml((consultores.find(r => r.id === pp.responsavelId) || {}).nome || '—')}</td>
        <td>${podeEditar ? `<input type="date" value="${pp.dataPrevista || ''}" data-campo="dataPrevista">` : escapeHtml(pp.dataPrevista ? DateUtil.formatShort(DateUtil.parseISO(pp.dataPrevista)) : '—')}</td>
        <td>${podeEditar ? `<input type="date" value="${pp.dataReal || ''}" data-campo="dataReal">` : escapeHtml(pp.dataReal ? DateUtil.formatShort(DateUtil.parseISO(pp.dataReal)) : '—')}</td>
        <td><select data-campo="estado" ${dis}>
          <option value="aberto" ${pp.estado === 'aberto' ? 'selected' : ''}>Aberto</option>
          <option value="em_curso" ${pp.estado === 'em_curso' ? 'selected' : ''}>Em curso</option>
          <option value="concluido" ${pp.estado === 'concluido' ? 'selected' : ''}>Concluído</option>
          <option value="abandonado" ${pp.estado === 'abandonado' ? 'selected' : ''}>Abandonado</option>
        </select></td>
        <td>${podeEditar ? `<textarea data-campo="notas" rows="1" style="width:100%;resize:vertical;">${escapeHtml(pp.notas)}</textarea>` : escapeHtml(pp.notas)}</td>
        <td class="hint" title="Criado por">${escapeHtml(nomeCriador)}</td>
        <td class="col-acoes">
          ${admin && !pp.fechado ? '<button class="btn btn-sm" data-acao="fechar">Fechar</button>' : ''}
          ${pp.fechado ? '<span class="hint">Fechado</span>' : ''}
          ${podeEliminar ? '<button class="btn-icon" data-acao="eliminar" title="Eliminar">🗑</button>' : ''}
        </td>`;
      const selSessao = tr.querySelector('[data-campo="pontoSituacaoId"]');
      if (selSessao) selSessao.value = pp.pontoSituacaoId || '';
      const selTarefa = tr.querySelector('[data-campo="tarefaId"]');
      if (selTarefa) selTarefa.value = pp.tarefaId || '';
      const selResponsavel = tr.querySelector('[data-campo="responsavelId"]');
      if (selResponsavel) selResponsavel.value = pp.responsavelId || '';
      tr.querySelectorAll('[data-campo]').forEach(inp => {
        inp.addEventListener('change', () => this.atualizarProximoPasso(pp.id, inp.dataset.campo, inp.value));
      });
      const btnFechar = tr.querySelector('[data-acao="fechar"]');
      if (btnFechar) btnFechar.addEventListener('click', () => this.fecharProximoPasso(pp.id));
      const btnEliminar = tr.querySelector('[data-acao="eliminar"]');
      if (btnEliminar) btnEliminar.addEventListener('click', () => this.eliminarProximoPasso(pp.id));
      e.corpoProximosPassos.appendChild(tr);
    });
  },
  abrirProjetoNoAcompanhamento(id) {
    this.selecionarProjeto(id);
    this.renderProjetoSelect();
    this.irParaAba('acompanhamento');
  },

  // ---------- Tab: Todos os Next Steps (visão global, só Administrador) ----------
  // Só de leitura + navegação — para editar um next step, "Abrir" leva ao Acompanhamento do
  // respetivo projeto, onde as mesmas regras de autoria/permissão de sempre se aplicam.
  aplicarFiltrosTodosPassos() {
    const e = this.els;
    this.filtrosTodosPassos = {
      projeto: e.fPassoProjeto.value, pontoSituacao: e.fPassoSessao.value, responsavel: e.fPassoResponsavel.value,
      estado: e.fPassoEstado.value, criadoDe: e.fPassoCriadoDe.value, criadoAte: e.fPassoCriadoAte.value
    };
    this.renderTodosPassos();
  },
  renderTodosPassos() {
    const e = this.els;
    if (!e.corpoTodosPassos || !this.souAdmin()) return;
    const todosProjetos = Object.values(this.state.projetos);
    const f = this.filtrosTodosPassos;

    const projAtual = e.fPassoProjeto.value;
    e.fPassoProjeto.innerHTML = '<option value="">Todos</option>' + todosProjetos.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.idInterno ? p.idInterno + ' — ' : '')}${escapeHtml(p.nome)}</option>`).join('');
    e.fPassoProjeto.value = projAtual;

    // A lista de sessões filtra-se pelo projeto escolhido (se houver); se o projeto mudar e a
    // sessão selecionada deixar de fazer sentido, o filtro de sessão reinicia sozinho.
    const projetosParaSessoes = f.projeto ? todosProjetos.filter(p => p.id === f.projeto) : todosProjetos;
    const opcoesSessao = [];
    projetosParaSessoes.forEach(p => {
      [...p.pontosSituacao].sort((a, b) => a.data.localeCompare(b.data)).forEach(ps => {
        opcoesSessao.push(`<option value="${ps.id}">${escapeHtml(p.idInterno || p.nome)} — ${escapeHtml(DateUtil.formatShort(DateUtil.parseISO(ps.data)))}</option>`);
      });
    });
    e.fPassoSessao.innerHTML = '<option value="">Todas</option>' + opcoesSessao.join('');
    e.fPassoSessao.value = f.pontoSituacao;
    if (e.fPassoSessao.value !== f.pontoSituacao) { f.pontoSituacao = ''; e.fPassoSessao.value = ''; }

    const respAtual = e.fPassoResponsavel.value;
    const responsaveisOrdenados = [...this.state.recursos].sort((a, b) => a.nome.localeCompare(b.nome));
    e.fPassoResponsavel.innerHTML = '<option value="">Todos</option>' + responsaveisOrdenados.map(r => `<option value="${r.id}">${escapeHtml(r.nome)}</option>`).join('');
    e.fPassoResponsavel.value = respAtual;

    const linhas = [];
    todosProjetos.forEach(p => p.proximosPassos.forEach(pp => linhas.push({ p, pp })));
    const filtradas = linhas.filter(({ p, pp }) => {
      if (f.projeto && p.id !== f.projeto) return false;
      if (f.pontoSituacao && pp.pontoSituacaoId !== f.pontoSituacao) return false;
      if (f.responsavel && pp.responsavelId !== f.responsavel) return false;
      if (f.estado && pp.estado !== f.estado) return false;
      if (f.criadoDe && pp.criadoEm.slice(0, 10) < f.criadoDe) return false;
      if (f.criadoAte && pp.criadoEm.slice(0, 10) > f.criadoAte) return false;
      return true;
    });
    const rotulosEstado = { aberto: 'Aberto', em_curso: 'Em curso', concluido: 'Concluído', abandonado: 'Abandonado' };
    const ordenadas = this.aplicarOrdenacaoTabela('tabelaTodosPassos', filtradas, ({ p, pp }, campo) => {
      switch (campo) {
        case 'projeto': return (p.idInterno || p.nome).toLowerCase();
        case 'sessao': return (p.pontosSituacao.find(ps => ps.id === pp.pontoSituacaoId) || {}).data || '';
        case 'descricao': return (pp.descricao || '').toLowerCase();
        case 'responsavel': return ((this.state.recursos.find(r => r.id === pp.responsavelId) || {}).nome || '').toLowerCase();
        case 'dataPrevista': return pp.dataPrevista || '';
        case 'dataReal': return pp.dataReal || '';
        case 'estado': return pp.estado || '';
        case 'criadoPor': return ((this.state.recursos.find(r => r.id === pp.criadoPor) || {}).nome || '').toLowerCase();
        default: return pp.criadoEm || '';
      }
    });

    e.corpoTodosPassos.innerHTML = ordenadas.length ? '' : '<tr class="empty-row"><td colspan="10" style="text-align:center;color:var(--cinza-500);padding:20px">Sem next steps para os filtros selecionados.</td></tr>';
    ordenadas.forEach(({ p, pp }) => {
      const sessao = p.pontosSituacao.find(ps => ps.id === pp.pontoSituacaoId);
      const responsavel = this.state.recursos.find(r => r.id === pp.responsavelId);
      const criador = this.state.recursos.find(r => r.id === pp.criadoPor);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.idInterno || p.nome)}${p.cliente ? ` <span style="color:var(--cinza-500);">(${escapeHtml(p.cliente)})</span>` : ''}</td>
        <td>${sessao ? escapeHtml(DateUtil.formatShort(DateUtil.parseISO(sessao.data))) : '—'}</td>
        <td>${escapeHtml(pp.descricao)}</td>
        <td>${escapeHtml(responsavel ? responsavel.nome : '—')}</td>
        <td>${pp.dataPrevista ? escapeHtml(DateUtil.formatShort(DateUtil.parseISO(pp.dataPrevista))) : '—'}</td>
        <td>${pp.dataReal ? escapeHtml(DateUtil.formatShort(DateUtil.parseISO(pp.dataReal))) : '—'}</td>
        <td>${escapeHtml(rotulosEstado[pp.estado] || pp.estado)}${pp.fechado ? ' <span class="hint">(fechado)</span>' : ''}</td>
        <td>${escapeHtml(criador ? criador.nome : '—')}</td>
        <td>${escapeHtml(DateUtil.formatShort(DateUtil.parseISO(pp.criadoEm.slice(0, 10))))}</td>
        <td class="col-acoes"><button class="btn btn-sm" data-acao="abrir">Abrir</button></td>`;
      tr.querySelector('[data-acao="abrir"]').addEventListener('click', () => this.abrirProjetoNoAcompanhamento(p.id));
      e.corpoTodosPassos.appendChild(tr);
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
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8" style="text-align:center;color:var(--cinza-500);padding:24px">Sem projeto carregado — cria um novo ou importa um ficheiro de projeto.</td></tr>';
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
            <input type="text" value="${escapeAttr(t.nome)}" data-campo="nome" ${podeEditar ? '' : 'disabled'}
              style="${t.negrito ? 'font-weight:700;' : ''}${t.italico ? 'font-style:italic;' : ''}${t.cor ? 'color:' + escapeAttr(t.cor) + ';' : ''}">
            ${podeEditar ? `<button class="btn-icon" data-acao="formatar" title="Formatar (negrito, itálico, cor)" style="flex-shrink:0;">🎨</button>` : ''}
          </div>
        </td>`,
        inicio: `<td><input type="date" value="${t.inicio}" data-campo="inicio" ${(filhos || !podeEditar) ? 'disabled' : ''}></td>`,
        fim: `<td><input type="date" value="${t.fim}" data-campo="fim" ${(filhos || !podeEditar) ? 'disabled' : ''} style="${atrasada ? 'color:#dc2626;font-weight:600' : ''}"></td>`,
        dias: `<td><input type="number" min="1" value="${duracao}" data-campo="duracao" ${(filhos || !podeEditar) ? 'disabled' : ''} style="width:40px"></td>`,
        prog: `<td><input type="number" min="0" max="100" value="${t.progresso}" data-campo="progresso" ${(filhos || !podeEditar) ? 'disabled' : ''} style="width:44px"></td>`,
        horasReais: `<td title="Soma dos registos de horas ligados a esta tarefa">${horasReais > 0 ? horasReais.toLocaleString('pt-PT', { maximumFractionDigits: 2 }) + 'h' : '<span style="color:var(--cinza-500)">—</span>'}</td>`,
        recursos: `<td class="rec-cell" data-acao="recursos">${nomesRec || '<span style="color:var(--cinza-500)">+ associar</span>'}</td>`,
        pred: `<td class="pred-cell-wrap" data-acao="pred">${filhos ? '<span style="color:var(--cinza-500)">n/d</span>' : (chipsPred || '<span style="color:var(--cinza-500)">+ ligar</span>')}</td>`
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
        const btnFormatar = tr.querySelector('[data-acao="formatar"]');
        if (btnFormatar) btnFormatar.addEventListener('click', (e) => { e.stopPropagation(); this.abrirModalFormatoTarefa(t.id); });
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

  // ---------- Exportar Gantt (CSV / Imagem / PDF) ----------
  nomeFicheiroExport(p, ext) {
    return `Gantt_${(p.idInterno || p.nome)}_${DateUtil.todayISO()}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
  },
  descarregarBlob(blob, nomeFicheiro) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeFicheiro;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  csvEscape(v) {
    const s = String(v === undefined || v === null ? '' : v);
    // Delimitador ";" (não ",") porque em pt-PT a vírgula é o separador decimal — o Excel local
    // só reconhece as colunas certas se usarmos ";".
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  },
  exportarCsv() {
    const p = this.projetoAtivo();
    if (!p) { this.toast('Escolhe um projeto primeiro.'); return; }
    const lista = this.flatten(p);
    const linhas = [['Tarefa', 'Início', 'Fim', 'Dias', '% Concl.', 'Horas Reais', 'Consultores', 'Predecessoras']];
    lista.forEach(({ tarefa: t, nivel }) => {
      const duracao = DateUtil.diffDays(DateUtil.parseISO(t.inicio), DateUtil.parseISO(t.fim)) + 1;
      const horasReais = this.horasReaisTarefa(p, t);
      const nomesRec = t.recursoIds.map(rid => (this.state.recursos.find(r => r.id === rid) || {}).nome).filter(Boolean).join('; ');
      const nomesPred = t.predecessores.map(pr => { const pt = this.tarefaPorId(p, pr.id); return pt ? `${pt.nome} (${pr.tipo})` : ''; }).filter(Boolean).join('; ');
      linhas.push(['  '.repeat(nivel) + t.nome, t.inicio, t.fim, duracao, t.progresso, horasReais || '', nomesRec, nomesPred]);
    });
    const csv = linhas.map(l => l.map(v => this.csvEscape(v)).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    this.descarregarBlob(blob, this.nomeFicheiroExport(p, 'csv'));
  },
  // Copia, do SVG ainda ligado ao documento (onde var(--...) e as classes CSS já estão
  // resolvidas), as propriedades visuais para o clone que vai ser serializado sozinho — um SVG
  // isolado (fora do documento) não tem acesso à folha de estilos nem às variáveis CSS.
  inlinarEstilosSvg(orig, clone) {
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-weight', 'font-style', 'font-family', 'opacity', 'text-anchor'];
    const computado = getComputedStyle(orig);
    props.forEach(prop => {
      const v = computado.getPropertyValue(prop);
      if (v) clone.style.setProperty(prop, v);
    });
    for (let i = 0; i < orig.children.length; i++) this.inlinarEstilosSvg(orig.children[i], clone.children[i]);
  },
  svgParaImagem(svgEl, w, h) {
    return new Promise((resolve, reject) => {
      const clone = svgEl.cloneNode(true);
      this.inlinarEstilosSvg(svgEl, clone);
      clone.setAttribute('width', w);
      clone.setAttribute('height', h);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const svgStr = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('falha ao converter o Gantt em imagem')); };
      img.src = url;
    });
  },
  async exportarImagem() {
    const p = this.projetoAtivo();
    if (!p) { this.toast('Escolhe um projeto primeiro.'); return; }
    const svgs = this.els.ganttContainer.querySelectorAll('svg');
    if (svgs.length < 2) { this.toast('Nada para exportar.'); return; }
    const [headerSvg, bodySvg] = svgs;
    const w = Math.max(parseFloat(headerSvg.getAttribute('width')) || 0, parseFloat(bodySvg.getAttribute('width')) || 0);
    const hHeader = parseFloat(headerSvg.getAttribute('height')) || 0;
    const hBody = parseFloat(bodySvg.getAttribute('height')) || 0;
    const escala = 2; // exporta a 2x para ficar nítido também em ecrãs de alta densidade
    const canvas = document.createElement('canvas');
    canvas.width = w * escala;
    canvas.height = (hHeader + hBody) * escala;
    const ctx = canvas.getContext('2d');
    ctx.scale(escala, escala);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, hHeader + hBody);
    try {
      const imgHeader = await this.svgParaImagem(headerSvg, w, hHeader);
      ctx.drawImage(imgHeader, 0, 0, w, hHeader);
      const imgBody = await this.svgParaImagem(bodySvg, w, hBody);
      ctx.drawImage(imgBody, 0, hHeader, w, hBody);
    } catch (err) {
      this.toast('Erro ao gerar a imagem: ' + err.message);
      return;
    }
    canvas.toBlob(blob => this.descarregarBlob(blob, this.nomeFicheiroExport(p, 'png')), 'image/png');
  },
  // PDF via diálogo de impressão do browser — sem bibliotecas novas. A regra @media print em
  // style.css já esconde tudo menos o Gantt sozinha (só se ativa em impressão, nunca no ecrã).
  exportarPdf() {
    const p = this.projetoAtivo();
    if (!p) { this.toast('Escolhe um projeto primeiro.'); return; }
    window.print();
  },

  // ---------- Abas ----------
  gruposAbas: { gantt: 'planeamento', projetos: 'planeamento', portefolio: 'planeamento', acompanhamento: 'planeamento', todosPassos: 'planeamento', recursos: 'equipa', capacidade: 'equipa', feriados: 'equipa', registo: 'horas', calendario: 'horas', faturacao: 'faturacao' },
  primeiroTabDoGrupo: { planeamento: 'gantt', equipa: 'recursos', horas: 'registo', faturacao: 'faturacao' },
  irParaAba(nome) {
    this.abaAtiva = nome;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === nome));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + nome));
    const grupo = this.gruposAbas[nome];
    document.querySelectorAll('.grupo-btn').forEach(b => b.classList.toggle('active', b.dataset.grupo === grupo));
    document.querySelectorAll('.tabs-grupo').forEach(g => g.classList.toggle('active', g.dataset.grupo === grupo));
    if (nome === 'gantt') this.renderGanttAtual();
    if (nome === 'calendario') this.renderCalendarioRegisto();
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
    this.els.modal.style.transform = ''; // recomeça centrado, mesmo que o anterior tenha sido arrastado
    this.els.modalBackdrop.classList.add('aberto');
  },
  fecharModal() {
    this.els.modalBackdrop.classList.remove('aberto');
  },
  // Deixa arrastar o modal pelo cabeçalho, para se poder ver o que está por trás (o fundo já é
  // quase transparente de propósito, ver style.css) — desloca-se por transform, a posição
  // "centrado" original é sempre o ponto de partida de cada vez que abrirModal() é chamado.
  ligarArrastarModal() {
    const header = document.querySelector('.modal-header');
    const modal = this.els.modal;
    if (!header || !modal) return;
    let arrastando = false, startX = 0, startY = 0, origX = 0, origY = 0;
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; // não interfere com o "✕" de fechar
      arrastando = true;
      startX = e.clientX; startY = e.clientY;
      const atual = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(modal.style.transform || '');
      origX = atual ? parseFloat(atual[1]) : 0;
      origY = atual ? parseFloat(atual[2]) : 0;
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => {
      if (!arrastando) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      modal.style.transform = `translate(${origX + dx}px, ${origY + dy}px)`;
    });
    header.addEventListener('pointerup', () => { arrastando = false; });
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

    const numConflito = linhas.filter(l => l.resultado.nivel === 'critico' || l.resultado.nivel === 'conflito').length;
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
              const classeLinha = l.resultado.nivel === 'critico' ? 'linha-sobreposta' : (l.resultado.nivel === 'conflito' ? 'linha-conflito' : '');
              const dias = DateUtil.diffDays(DateUtil.parseISO(l.tarefa.inicio), DateUtil.parseISO(l.tarefa.fim)) + 1;
              const dicaEstado = Capacidade.descreverProblema(r.nome, l.resultado) || 'Sem conflitos conhecidos neste período.';
              return `<tr class="${classeLinha}">
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
      </div>` : '<p style="color:var(--cinza-500)">Sem alocações em nenhum projeto carregado.</p>';
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
      if (temAusencia) return { texto: '● Ausente / sobre-alocado', classe: 'critico' };
      return { texto: '● Sobre-alocado', classe: 'critico' };
    }
    if (resultado.nivel === 'conflito') {
      const motivos = new Set((resultado.detalheIndisponivel || []).map(d => d.motivo));
      const motivo = motivos.size === 1 ? Array.from(motivos)[0] : 'ausência';
      return { texto: `● Ausente (${motivo.charAt(0).toUpperCase()}${motivo.slice(1)})`, classe: 'conflito' };
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
    const ordemNivel = { critico: 0, conflito: 1, aviso: 2, ok: 3, vazio: 3 };
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
          <span class="rec-check-nome">${escapeHtml(r.nome)} <span style="color:var(--cinza-500)">— ${escapeHtml(r.papel || '')}${equipa ? ' · ' + escapeHtml(equipa.nome) : ''}</span></span>
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
    }).join('') || '<p style="color:var(--cinza-500)">Sem predecessoras.</p>';
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
    if (e.selGestorFiltroGantt) e.selGestorFiltroGantt.addEventListener('change', () => this.renderProjetoSelect());
    document.getElementById('btnNovoProjeto').addEventListener('click', () => this.criarProjeto());
    document.getElementById('btnNovoProjeto2').addEventListener('click', () => this.criarProjeto());
    document.getElementById('btnDuplicarProjeto').addEventListener('click', () => this.duplicarProjeto());
    document.getElementById('btnEliminarProjeto').addEventListener('click', () => this.eliminarProjeto());

    // "readonly" até ao primeiro clique (trava o autofill do próprio browser) + bloqueio de
    // preenchimento não fidedigno (trava extensões como o RoboForm — ver bloquearPreenchimentoAutomatico).
    e.projIdInterno.addEventListener('focus', () => e.projIdInterno.removeAttribute('readonly'), { once: true });
    this.bloquearPreenchimentoAutomatico(e.projIdInterno);
    e.projIdInterno.addEventListener('change', () => { if (!this.projetoAtivo()) return; this.projetoAtivo().idInterno = e.projIdInterno.value.trim(); e.projIdInterno.value = this.projetoAtivo().idInterno; this.persist(); this.renderProjetoSelect(); this.renderTabelaProjetos(); });
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
    e.selMesInicioCap.addEventListener('change', () => this.renderCapacidade());
    document.getElementById('btnCapMesAnt').addEventListener('click', () => this.navegarMesCap(-1));
    document.getElementById('btnCapMesSeg').addEventListener('click', () => this.navegarMesCap(1));
    document.getElementById('btnCapHoje').addEventListener('click', () => { e.selMesInicioCap.value = ''; this.renderCapacidade(); });

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

    if (e.fCalPessoa) e.fCalPessoa.addEventListener('change', () => this.aplicarFiltrosCalendarioRegisto());
    if (e.fCalProjeto) e.fCalProjeto.addEventListener('change', () => this.aplicarFiltrosCalendarioRegisto());
    if (e.btnCalMesAnt) e.btnCalMesAnt.addEventListener('click', () => this.navegarMesCalendario(-1));
    if (e.btnCalMesSeg) e.btnCalMesSeg.addEventListener('click', () => this.navegarMesCalendario(1));
    if (e.btnCalHoje) e.btnCalHoje.addEventListener('click', () => this.irParaHojeCalendario());

    document.getElementById('btnAddFatura').addEventListener('click', () => this.adicionarFatura());
    [e.fFatProjeto, e.fFatDe, e.fFatAte].forEach(el => el.addEventListener('change', () => this.aplicarFiltrosFaturacao()));
    e.fFatNumRegisto.addEventListener('input', () => this.aplicarFiltrosFaturacao());
    document.getElementById('btnLimparFiltrosFaturacao').addEventListener('click', () => {
      e.fFatProjeto.value = ''; e.fFatDe.value = ''; e.fFatAte.value = ''; e.fFatNumRegisto.value = '';
      this.aplicarFiltrosFaturacao();
    });
    [e.fProjGestor, e.fProjCliente, e.fProjEstado, e.fProjEstadoOrc].forEach(el => el.addEventListener('change', () => this.aplicarFiltrosProjetos()));
    document.getElementById('btnLimparFiltrosProjetos').addEventListener('click', () => {
      e.fProjGestor.value = ''; e.fProjCliente.value = ''; e.fProjEstado.value = ''; e.fProjEstadoOrc.value = '';
      this.aplicarFiltrosProjetos();
    });
    e.btnColunasProjetos.addEventListener('click', (ev) => { ev.stopPropagation(); this.alternarPainelColunasProjetos(); });
    e.painelColunasProjetos.addEventListener('click', (ev) => ev.stopPropagation()); // não fecha ao marcar várias colunas seguidas
    document.addEventListener('click', () => this.els.painelColunasProjetos.classList.remove('aberto'));
    [e.fPassoProjeto, e.fPassoSessao, e.fPassoResponsavel, e.fPassoEstado, e.fPassoCriadoDe, e.fPassoCriadoAte].forEach(el => el.addEventListener('change', () => this.aplicarFiltrosTodosPassos()));
    document.getElementById('btnLimparFiltrosPassos').addEventListener('click', () => {
      e.fPassoProjeto.value = ''; e.fPassoSessao.value = ''; e.fPassoResponsavel.value = '';
      e.fPassoEstado.value = ''; e.fPassoCriadoDe.value = ''; e.fPassoCriadoAte.value = '';
      this.aplicarFiltrosTodosPassos();
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
    this.ligarArrastarModal();
    e.modalBackdrop.addEventListener('click', (ev) => { if (ev.target === e.modalBackdrop) this.fecharModal(); });
    document.getElementById('btnMinhaConta').addEventListener('click', () => this.abrirModalMinhaConta());
    this.els.btnAlternarTema.addEventListener('click', () => this.alternarTema());
    document.getElementById('btnExportCsv').addEventListener('click', () => this.exportarCsv());
    document.getElementById('btnExportImagem').addEventListener('click', () => this.exportarImagem());
    document.getElementById('btnExportPdf').addEventListener('click', () => this.exportarPdf());
    const btnAtualizar = document.getElementById('btnAtualizarDados');
    if (btnAtualizar) btnAtualizar.addEventListener('click', () => this.atualizarDaNuvem());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.atualizarDaNuvem({ silencioso: true });
    });
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

    // Colunas ajustáveis + cabeçalhos ordenáveis nas restantes tabelas de dados da app.
    this.tornarColunasRedimensionaveis('tabelaProjetos', 'colunasProjetos');
    this.ligarOrdenacaoTabela('tabelaProjetos', { campo: 'idInterno', dir: 'asc' }, () => this.renderTabelaProjetos());
    this.tornarColunasRedimensionaveis('tabelaPontosSituacao', 'colunasPontosSituacao');
    this.ligarOrdenacaoTabela('tabelaPontosSituacao', { campo: 'data', dir: 'desc' }, () => this.renderAcompanhamento());
    this.tornarColunasRedimensionaveis('tabelaProximosPassos', 'colunasProximosPassos');
    this.ligarOrdenacaoTabela('tabelaProximosPassos', { campo: 'fechado', dir: 'asc' }, () => this.renderAcompanhamento());
    this.tornarColunasRedimensionaveis('tabelaTodosPassos', 'colunasTodosPassos');
    this.ligarOrdenacaoTabela('tabelaTodosPassos', { campo: 'criadoEm', dir: 'desc' }, () => this.renderTodosPassos());
    this.tornarColunasRedimensionaveis('tabelaRecursosCentral', 'colunasRecursos');
    this.ligarOrdenacaoTabela('tabelaRecursosCentral', { campo: 'nome', dir: 'asc' }, () => this.renderTabelaRecursosCentral());
    this.tornarColunasRedimensionaveis('tabelaEquipas', 'colunasEquipas');
    this.ligarOrdenacaoTabela('tabelaEquipas', { campo: 'nome', dir: 'asc' }, () => this.renderTabelaEquipas());
    this.tornarColunasRedimensionaveis('tabelaFeriados', 'colunasFeriados');
    this.ligarOrdenacaoTabela('tabelaFeriados', { campo: 'data', dir: 'asc' }, () => this.renderTabelaFeriados());
    this.tornarColunasRedimensionaveis('tabelaAusencias', 'colunasAusencias');
    this.ligarOrdenacaoTabela('tabelaAusencias', { campo: 'dataInicio', dir: 'asc' }, () => this.renderTabelaAusencias());
    // Faturação e Registo de Horas já tinham ordenação própria — só ganham colunas ajustáveis.
    this.tornarColunasRedimensionaveis('tabelaRegistos', 'colunasRegistos');
    this.tornarColunasRedimensionaveis('tabelaFaturas', 'colunasFaturas');
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
    // "table-layout:fixed" só entra depois de existir pelo menos uma largura guardada — antes
    // disso a tabela mantém-se com o dimensionamento automático de sempre, por conteúdo (ver CSS).
    if (Object.keys(larguras).length) tabela.classList.add('colunas-ajustadas');
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
        tabela.classList.add('colunas-ajustadas');
        const atuais = this.lerPrefsUI()[prefChave] || {};
        atuais[col] = Math.round(th.getBoundingClientRect().width);
        this.gravarPrefUI(prefChave, atuais);
      });
    });
  },
  // ---------- Ordenação genérica por cabeçalho (clique num <th data-sort>) ----------
  // Um único mecanismo, reutilizado por várias tabelas — cada uma só precisa de: cabeçalhos com
  // "data-sort", chamar ligarOrdenacaoTabela() uma vez a montar os eventos, e chamar
  // aplicarOrdenacaoTabela() dentro do próprio render para ordenar as linhas antes de as desenhar.
  ordenacoesTabelas: {},
  ligarOrdenacaoTabela(tabelaId, padrao, renderFn) {
    this.ordenacoesTabelas[tabelaId] = padrao;
    const thead = document.querySelector(`#${tabelaId} thead`);
    if (!thead) return;
    thead.addEventListener('click', (ev) => {
      const th = ev.target.closest('th[data-sort]');
      if (!th) return;
      const campo = th.dataset.sort;
      const atual = this.ordenacoesTabelas[tabelaId];
      if (atual.campo === campo) atual.dir = atual.dir === 'asc' ? 'desc' : 'asc';
      else this.ordenacoesTabelas[tabelaId] = { campo, dir: 'asc' };
      renderFn();
    });
  },
  // Devolve "linhas" ordenadas segundo o estado guardado para "tabelaId" (valorFn extrai, de cada
  // linha, o valor comparável para a coluna atual) e atualiza as setas nos cabeçalhos.
  aplicarOrdenacaoTabela(tabelaId, linhas, valorFn) {
    const estado = this.ordenacoesTabelas[tabelaId];
    document.querySelectorAll(`#${tabelaId} thead th[data-sort]`).forEach(th => {
      const ativo = estado && th.dataset.sort === estado.campo;
      th.classList.toggle('ord-asc', !!ativo && estado.dir === 'asc');
      th.classList.toggle('ord-desc', !!ativo && estado.dir === 'desc');
    });
    if (!estado) return linhas;
    const mult = estado.dir === 'desc' ? -1 : 1;
    return linhas.slice().sort((a, b) => {
      const va = valorFn(a, estado.campo), vb = valorFn(b, estado.campo);
      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
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
  // Bloqueia gestores de password/preenchimento automático (RoboForm, LastPass, etc.) num campo
  // de texto. Estas extensões escrevem o valor diretamente via JavaScript — autocomplete="off",
  // "new-password" e até readonly não as trava, porque só bloqueiam o próprio browser, não uma
  // extensão a mexer no DOM. A diferença fica no evento: uma tecla realmente premida por uma
  // pessoa gera um evento "input" com isTrusted=true; uma extensão a escrever o valor por fora
  // gera um (ou nenhum) evento com isTrusted=false. Guarda o valor a cada foco e repõe-no sempre
  // que aparecer uma alteração não fidedigna.
  // Formata uma lista de datas ISO (já ordenada cronologicamente) como "13/07, 22/07 +3 dia(s)",
  // limitando a `limite` datas visíveis para o texto não crescer sem controlo num período longo.
  formatarDatasConflito(datasISO, limite) {
    limite = limite || 6;
    const visiveis = datasISO.slice(0, limite).map(iso => DateUtil.formatShort(DateUtil.parseISO(iso)));
    const resto = datasISO.length - visiveis.length;
    return escapeHtml(visiveis.join(', ') + (resto > 0 ? ` +${resto} dia(s)` : ''));
  },
  bloquearPreenchimentoAutomatico(input) {
    let valorAntesDoFoco = input.value;
    input.addEventListener('focus', () => { valorAntesDoFoco = input.value; });
    input.addEventListener('input', (ev) => {
      if (!ev.isTrusted && input.value !== valorAntesDoFoco) input.value = valorAntesDoFoco;
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

// Registado já na análise do script (não dentro de App.init(), que só corre no DOMContentLoaded) —
// js/auth.js pode disparar "auth-mudou" muito cedo (ao correr onAuthStateChange logo que é
// registado), antes do DOMContentLoaded chegar a acontecer; registar o listener aqui garante que
// nunca perde esse primeiro aviso por uma questão de ordem/tempo entre os dois ficheiros.
document.addEventListener('auth-mudou', (e) => App.aoMudarSessao(e.detail));
document.addEventListener('DOMContentLoaded', () => App.init());

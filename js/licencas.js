// Módulo "Ativos → Licenças": registo das licenças de software (valor, responsável, departamento, renovação, projeto e financiamento).
// Como as Reuniões e o CRM, fala DIRETAMENTE com a sua tabela ("licencas", ver supabase/licencas.sql) — só quando alguém abre o
// separador — e cada gravação é imediata (sem desfazer). As regras puras estão em licencas-logica.js. Em memória guardamos as linhas
// como vêm da base de dados (snake_case). Quem vê o quê é decidido pela base de dados (RLS): o Administrador vê todas; um Diretor
// só as do seu departamento. A app limita-se a esconder o menu a quem não tem acesso.
const Licencas = {
  lista: [],
  carregado: false,
  semTabela: false,
  erro: null,
  filtros: { texto: '', departamento: '', responsavel: '', projeto: '', estado: 'abertas', renovacao: '', tipo: '' },
  atual: null,       // licença aberta no formulário (cópia)
  original: '',      // JSON da licença como foi aberta/gravada
  _aGuardar: false,

  L: LicencasLogica,

  // ---------- Permissões ----------
  podeVer() { return App.souAdmin() || App.souDiretorDeAlgumDepartamento(); },
  // Departamentos em que esta pessoa pode registar licenças: todos (Administrador) ou só os que dirige.
  departamentosEditaveis() {
    return App.state.departamentos.filter(d => App.souAdmin() || App.souDiretorDe(d.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  },
  // Aprovar/recusar uma licença em processo de aquisição: o Diretor do departamento dela (ou o Administrador).
  podeDecidir(l) { return !!l && l.estado === 'em_aquisicao' && (App.souAdmin() || App.souDiretorDe(l.departamento_id)); },
  diretorDe(departamentoId) {
    const d = departamentoId ? App.state.departamentos.find(x => x.id === departamentoId) : null;
    return d && d.diretorId ? App.state.recursos.find(r => r.id === d.diretorId) || null : null;
  },
  // As que ESTA pessoa tem de aprovar (sino): o Diretor recebe as do seu departamento; o Administrador só as que ninguém
  // mais pode aprovar (sem departamento, ou departamento sem Diretor) — as outras são do Diretor, o Administrador apenas as vê.
  paraAprovarPorMim() {
    return this.L.paraAprovar(this.lista).filter(l => App.souDiretorDe(l.departamento_id) || (App.souAdmin() && !this.diretorDe(l.departamento_id)));
  },
  contarParaAprovar() { return this.carregado ? this.paraAprovarPorMim().length : 0; },
  // Chamado ao entrar na app (só quem tem acesso ao módulo): carrega as licenças em fundo para o sino saber se há algo por aprovar.
  carregarEmFundo() {
    if (!this.podeVer() || this.carregado || this._aCarregar || this.erro) return;
    this.carregar().finally(() => { App.renderNotificacoes(); if (App.abaAtiva === 'licencas') this.renderTudo(); });
  },
  // Clique no sino: abre as licenças só com as que aguardam aprovação.
  verParaAprovar() {
    this.filtros = { texto: '', departamento: '', responsavel: '', projeto: '', estado: 'em_aquisicao', renovacao: '', tipo: '' };
    App.irParaAba('licencas');
  },
  hoje() { return DateUtil.todayISO(); },
  meuNome() { return (App.perfilAtual() || {}).nome || ''; },
  corpo() { return document.getElementById('licencasCorpo'); },
  nomePessoa(id) { const r = id ? App.state.recursos.find(x => x.id === id) : null; return r ? r.nome : ''; },
  nomeDepartamento(id) { const d = id ? App.state.departamentos.find(x => x.id === id) : null; return d ? d.nome : ''; },
  // Rótulo do projeto: o atual (nome/cliente/código) se o projeto existe e a pessoa o vê; senão o que ficou guardado na licença.
  rotuloProjeto(l) {
    const p = l.projeto_id ? App.state.projetos[l.projeto_id] : null;
    return p ? App.rotuloProjetoCompleto(p) : (l.projeto_nome || '');
  },
  ctxFiltro() {
    return { hoje: this.hoje(), nomeResponsavel: l => this.nomePessoa(l.responsavel_id), nomeDepartamento: l => this.nomeDepartamento(l.departamento_id) };
  },

  // ---------- Dados ----------
  limpar() {
    this.lista = []; this.carregado = false; this.semTabela = false; this.erro = null; this.atual = null; this.original = ''; this._aCarregar = null;
    this.filtros = { texto: '', departamento: '', responsavel: '', projeto: '', estado: 'abertas', renovacao: '', tipo: '' };
    const c = this.corpo(); if (c) c.innerHTML = '';
  },
  async carregar(forcar) {
    if (this.carregado && !forcar) return;
    if (this._aCarregar) { await this._aCarregar; return; }
    this._aCarregar = (async () => {
      const PAGINA = 1000, linhas = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await supabaseClient.from('licencas').select('*').order('nome').order('id').range(de, de + PAGINA - 1);
        if (error) throw error;
        linhas.push(...(data || []));
        if (!data || data.length < PAGINA) break;
      }
      this.lista = linhas.map(l => this.L.normalizar(l));
      this.semTabela = false;
      this.carregado = true;
    })();
    try { await this._aCarregar; this.erro = null; }
    catch (err) {
      // Antes de correr supabase/licencas.sql a tabela não existe: o resto da app continua, este separador explica o que falta.
      this.semTabela = (/licencas/i.test(err.message || '') && /does not exist|schema cache|could not find/i.test(err.message || '')) || err.code === '42P01' || err.code === 'PGRST205';
      this.erro = err.message || String(err);
    } finally { this._aCarregar = null; }
  },
  async aoAbrir() {
    const c = this.corpo();
    if (!c) return;
    if (!this.carregado) c.innerHTML = '<p class="hint">A carregar as licenças…</p>';
    await this.carregar();
    this.renderTudo();
  },
  renderTudo() {
    const c = this.corpo();
    if (!c) return;
    if (this.semTabela) { c.innerHTML = '<div class="card"><p><b>O módulo de licenças ainda não está instalado.</b></p><p class="hint">Falta correr o ficheiro <code>supabase/licencas.sql</code> no SQL Editor do Supabase (cria só uma tabela nova) e recarregar a página.</p></div>'; return; }
    if (this.erro && !this.carregado) { c.innerHTML = `<div class="card"><p>Não foi possível carregar as licenças: ${escapeHtml(this.erro)}</p><p><button type="button" class="btn" data-lic-acao="recarregar">Tentar de novo</button></p></div>`; this.ligar(c); return; }
    this.renderPagina();
  },

  // ============================ Página ============================
  renderPagina() {
    const f = this.filtros, hoje = this.hoje(), c = this.corpo();
    const todas = this.lista;
    const lista = this.L.ordenar(this.L.filtrar(todas, f, this.ctxFiltro()), hoje);
    const eur = v => this.L.eur(v);
    const opt = (v, t, sel) => `<option value="${escapeAttr(v)}"${sel === v ? ' selected' : ''}>${escapeHtml(t)}</option>`;
    const deps = App.state.departamentos.filter(d => todas.some(l => l.departamento_id === d.id) || this.departamentosEditaveis().some(x => x.id === d.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const resp = App.state.recursos.filter(r => todas.some(l => l.responsavel_id === r.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const projs = [...new Map(todas.filter(l => l.projeto_id).map(l => [l.projeto_id, this.rotuloProjeto(l)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
    // Os totais do topo seguem os filtros de departamento/responsável/projeto/tipo (não o de estado nem o de renovação): assim vêem-se sempre as ativas.
    const base = this.L.filtrar(todas, { departamento: f.departamento, responsavel: f.responsavel, projeto: f.projeto, tipo: f.tipo, texto: f.texto }, this.ctxFiltro());
    const r = this.L.resumo(base, hoje);
    const kpi = (rotulo, valor, sub, cls) => `<div class="an-kpi${cls ? ' ' + cls : ''}"><b>${valor}</b><span>${escapeHtml(rotulo)}</span>${sub ? `<span class="prev-sub">${sub}</span>` : ''}</div>`;
    const subRen = x => x.n ? `${x.n} licença${x.n === 1 ? '' : 's'} · ${eur(x.valor)}` : 'nenhuma';
    const linhas = lista.map(l => this.htmlLinha(l, hoje)).join('');
    const grupo = (titulo, chave, nomeDe) => {
      const g = this.L.agrupar(base, chave, nomeDe), haPend = g.some(x => x.nPend);
      return `<details class="lic-resumo"><summary>${escapeHtml(titulo)} <span class="hint">(${g.length})</span></summary>
        ${g.length ? `<div class="table-scroll"><table class="tabela-crud"><thead><tr><th>${chave === 'projeto' ? 'Projeto' : 'Departamento'}</th><th class="num">Licenças</th><th class="num">Custo (anual / aquisição)</th><th class="num">Financiado</th><th class="num">A cargo do departamento</th>${haPend ? '<th class="num">Em aquisição (previsto)</th>' : ''}</tr></thead>
          <tbody>${g.map(x => `<tr><td>${escapeHtml(x.nome)}</td><td class="num">${x.n}</td><td class="num">${eur(x.base)}</td><td class="num">${eur(x.financiado)}</td><td class="num">${eur(x.liquido)}</td>${haPend ? `<td class="num">${x.nPend ? `${x.nPend} · ${eur(x.basePend)}` : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="hint">Sem licenças ativas.</p>'}</details>`;
    };
    c.innerHTML = `${this.htmlAprovacoes(todas)}<div class="an-kpis">
        ${r.previsto.n ? kpi('Em processo de aquisição', String(r.previsto.n), `${eur(r.previsto.base)} por ano · a aprovar`, 'lic-kpi-pend') : ''}
        ${kpi('Custo anual (subscrições)', eur(r.anual), r.aquisicoes ? `+ ${eur(r.aquisicoes)} em aquisições` : `${r.n} licença${r.n === 1 ? '' : 's'} ativa${r.n === 1 ? '' : 's'}`)}
        ${kpi('Financiado', eur(r.financiado), r.anual + r.aquisicoes ? `${Math.round(r.financiado / (r.anual + r.aquisicoes) * 100)}% do total` : '')}
        ${kpi('A cargo do departamento', eur(r.liquido))}
        ${kpi('Renovações atrasadas', String(r.atrasadas.n), subRen(r.atrasadas), r.atrasadas.n ? 'lic-kpi-alerta' : '')}
        ${kpi('Renovam em 30 dias', String(r.ate30.n), subRen(r.ate30))}
        ${kpi('Renovam em 90 dias', String(r.ate90.n), subRen(r.ate90))}
      </div>
      <div class="filters crm-barra">
        <label class="zoom-label">Pesquisar <input type="text" data-lic-filtro="texto" value="${escapeAttr(f.texto)}" placeholder="Software, fornecedor, pessoa, projeto…"></label>
        <label class="zoom-label">Departamento <select data-lic-filtro="departamento">${opt('', 'Todos', f.departamento)}${deps.map(d => opt(d.id, d.nome, f.departamento)).join('')}</select></label>
        <label class="zoom-label">Responsável <select data-lic-filtro="responsavel">${opt('', 'Todos', f.responsavel)}${resp.map(x => opt(x.id, x.nome, f.responsavel)).join('')}</select></label>
        <label class="zoom-label">Projeto <select data-lic-filtro="projeto">${opt('', 'Todos', f.projeto)}${opt('_sem', 'Sem projeto', f.projeto)}${projs.map(([id, t]) => opt(id, t, f.projeto)).join('')}</select></label>
        <label class="zoom-label">Estado <select data-lic-filtro="estado">${opt('abertas', 'Ativas e em aquisição', f.estado)}${opt('', 'Todos', f.estado)}${Object.entries(this.L.ESTADOS).map(([k, v]) => opt(k, v, f.estado)).join('')}</select></label>
        <label class="zoom-label">Renovação <select data-lic-filtro="renovacao">${opt('', 'Qualquer', f.renovacao)}${opt('atrasadas', 'Atrasadas', f.renovacao)}${opt('30', 'Em 30 dias', f.renovacao)}${opt('60', 'Em 60 dias', f.renovacao)}${opt('90', 'Em 90 dias', f.renovacao)}</select></label>
        <span class="crm-barra-fim"><span class="hint">${lista.length} de ${todas.length} licenças</span>
          <button type="button" class="ib" data-lic-acao="excel" data-tip="Exportar a lista (com os filtros) para Excel" aria-label="Exportar para Excel"><span>Excel</span></button>
          <button type="button" class="ib ib-pri" data-lic-acao="nova" data-tip="Registar uma licença" aria-label="Nova licença">${Icones.svg('plus')}<span>Nova licença</span></button></span>
      </div>
      ${lista.length ? `<div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Software</th><th>Responsável</th><th>Departamento</th><th>Projeto</th><th class="num">Valor</th><th class="num">Custo anual / aquisição</th><th class="num">Financ.</th><th class="num">A cargo do dep.</th><th>Renovação</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>`
        : `<p class="hint" style="margin-top:14px">${todas.length ? 'Nenhuma licença com estes filtros.' : 'Ainda não há licenças registadas. Regista a primeira em "+ Nova licença".'}</p>`}
      <div class="lic-resumos">${grupo('Totais por departamento', 'departamento', id => this.nomeDepartamento(id))}${grupo('Totais por projeto', 'projeto', (id, l) => this.rotuloProjeto(l))}</div>
      <p class="hint" style="margin-top:10px">Valores em € sem IVA. Nos totais só entram licenças ativas (as em processo de aquisição são uma previsão, à parte, até serem aprovadas). Subscrição: o custo anual é o valor × 12 (mensal) ou × 1 (anual); perpétua: o valor de aquisição. Financiado = custo × taxa de financiamento do projeto.</p>`;
    this.ligar(c);
  },
  htmlLinha(l, hoje) {
    const eur = v => this.L.eur(v), sub = this.L.ehSubscricao(l);
    const sit = this.L.situacaoRenovacao(l, hoje, 30), prox = this.L.proximaRenovacao(l, hoje), dias = this.L.diasParaRenovacao(l, hoje);
    const txtRen = l.data_renovacao
      ? `${this.L.formatarData(prox)}${l.estado === 'ativa' && dias != null ? ` <span class="hint">(${dias < 0 ? `há ${-dias} d` : dias === 0 ? 'hoje' : `em ${dias} d`})</span>` : ''}${l.renovacao_automatica && sub ? ' <span class="hint" title="Renovação automática">↻</span>' : ''}`
      : '—';
    const nPer = sub ? (l.periodicidade === 'mensal' ? '/mês' : '/ano') : ' (único)';
    const proj = this.rotuloProjeto(l);
    const pend = l.estado === 'em_aquisicao';
    const botoes = this.podeDecidir(l) ? `<div class="lic-dec"><button type="button" class="ib" data-lic-acao="aprovar" data-id="${escapeAttr(l.id)}" data-tip="Aprovar a aquisição: passa a Ativa"><span>✔ Aprovar</span></button><button type="button" class="ib" data-lic-acao="recusar" data-id="${escapeAttr(l.id)}" data-tip="Recusar a aquisição"><span>✖ Recusar</span></button></div>` : '';
    const decisao = l.decisao_em && (l.estado === 'ativa' || l.estado === 'recusada') ? `<div class="hint" style="margin:2px 0 0" title="${escapeAttr(l.motivo_decisao || '')}">${l.estado === 'recusada' ? 'Recusada' : 'Aprovada'} por ${escapeHtml(l.decisao_por_nome || '—')} em ${this.L.formatarData(String(l.decisao_em).slice(0, 10))}${l.estado === 'recusada' && l.motivo_decisao ? ` — ${escapeHtml(l.motivo_decisao)}` : ''}</div>` : '';
    return `<tr class="crm-linha${pend ? ' lic-pendente' : (l.estado !== 'ativa' ? ' fechado' : '')}" data-lic-acao="abrir" data-id="${escapeAttr(l.id)}">
      <td><b>${escapeHtml(l.nome)}</b>${l.fornecedor ? `<div class="hint" style="margin:0">${escapeHtml(l.fornecedor)}${l.n_licencas ? ' · ' + l.n_licencas + ' lic.' : ''}</div>` : (l.n_licencas ? `<div class="hint" style="margin:0">${l.n_licencas} lic.</div>` : '')}</td>
      <td>${escapeHtml(this.nomePessoa(l.responsavel_id) || '—')}</td>
      <td>${escapeHtml(this.nomeDepartamento(l.departamento_id) || '—')}</td>
      <td>${proj ? escapeHtml(proj) : '—'}</td>
      <td class="num" style="white-space:nowrap">${eur(l.valor)}<span class="hint">${nPer}</span></td>
      <td class="num">${eur(this.L.valorBase(l))}</td>
      <td class="num">${this.L.taxa(l) ? `${eur(this.L.valorFinanciado(l))} <span class="hint">(${String(this.L.taxa(l)).replace('.', ',')}%)</span>` : '—'}</td>
      <td class="num">${eur(this.L.valorLiquido(l))}</td>
      <td style="white-space:nowrap"><span class="lic-ren lic-ren-${sit}">${txtRen}</span></td>
      <td><span class="reu-estado lic-estado-${escapeAttr(l.estado)}">${escapeHtml(this.L.ESTADOS[l.estado] || l.estado)}</span>${botoes}${decisao}</td></tr>`;
  },
  // Aviso no topo: o que aguarda aprovação, por departamento — com o Diretor, "Ver", "Avisar por email" (quem não é o Diretor)
  // e "Aprovar todas" (quem pode decidir).
  htmlAprovacoes(todas) {
    const pend = this.L.paraAprovar(todas);
    if (!pend.length) return '';
    const eur = v => this.L.eur(v), porDep = new Map();
    pend.forEach(l => { const k = l.departamento_id || ''; if (!porDep.has(k)) porDep.set(k, []); porDep.get(k).push(l); });
    const linhas = [...porDep.entries()].sort((a, b) => this.nomeDepartamento(a[0]).localeCompare(this.nomeDepartamento(b[0]), 'pt')).map(([depId, ls]) => {
      const dir = this.diretorDe(depId), sou = App.souDiretorDe(depId), podeDec = ls.some(l => this.podeDecidir(l));
      const custo = this.L.resumoPendentes(ls).base;
      const quem = !depId ? '<span class="hint">sem departamento — só o Administrador pode decidir</span>'
        : dir ? `<span class="hint">Diretor: ${escapeHtml(dir.nome)}${sou ? ' (tu)' : ''}</span>`
          : '<span class="hint">este departamento ainda não tem Diretor atribuído (Configurações → Pessoas)</span>';
      return `<div class="lic-aviso-linha"><span><b>${escapeHtml(this.nomeDepartamento(depId) || '(sem departamento)')}</b>: ${ls.length} licença${ls.length === 1 ? '' : 's'} · ${eur(custo)} por ano ${quem}</span>
        <span class="lic-aviso-acoes">
          <button type="button" class="ib" data-lic-acao="ver-dep" data-dep="${escapeAttr(depId)}"><span>Ver</span></button>
          ${dir && !sou && dir.email ? `<button type="button" class="ib" data-lic-acao="avisar" data-dep="${escapeAttr(depId)}" data-tip="Abre um email já escrito para ${escapeAttr(dir.nome)} com a lista"><span>✉ Avisar o Diretor</span></button>` : ''}
          ${podeDec ? `<button type="button" class="ib ib-pri" data-lic-acao="aprovar-dep" data-dep="${escapeAttr(depId)}" data-tip="Aprova de uma vez as ${ls.length} licenças deste departamento"><span>✔ Aprovar todas (${ls.length})</span></button>` : ''}
        </span></div>`;
    }).join('');
    return `<div class="lic-aviso"><div class="lic-aviso-titulo">⏳ ${pend.length} licença${pend.length === 1 ? '' : 's'} em processo de aquisição — a aguardar aprovação do Diretor</div>${linhas}</div>`;
  },

  // ---------- Eventos da página (delegados no contentor: um só conjunto) ----------
  ligar(raiz) {
    if (raiz._licLigado) return;
    raiz._licLigado = true;
    raiz.addEventListener('click', ev => {
      const el = ev.target.closest('[data-lic-acao]');
      if (!el || !raiz.contains(el)) return;
      ev.preventDefault();
      const acao = el.dataset.licAcao;
      if (acao === 'abrir') this.abrir(el.dataset.id);
      else if (acao === 'nova') this.nova();
      else if (acao === 'excel') this.exportarExcel();
      else if (acao === 'recarregar') { this.carregar(true).then(() => this.renderTudo()); }
      else if (acao === 'aprovar') this.decidir([el.dataset.id], 'aprovar');
      else if (acao === 'recusar') this.decidir([el.dataset.id], 'recusar');
      else if (acao === 'aprovar-dep') this.aprovarDepartamento(el.dataset.dep);
      else if (acao === 'ver-dep') { this.filtros.estado = 'em_aquisicao'; this.filtros.departamento = el.dataset.dep || ''; this.renderPagina(); }
      else if (acao === 'avisar') this.avisarDiretor(el.dataset.dep);
    });
    const aoFiltrar = ev => {
      const t = ev.target;
      if (t.dataset.licFiltro === undefined) return;
      if (t.tagName === 'INPUT' && ev.type === 'change') return; // o texto filtra a escrever
      this.filtros[t.dataset.licFiltro] = t.value;
      const pos = t.selectionStart;
      this.renderPagina();
      const novo = raiz.querySelector(`[data-lic-filtro="${t.dataset.licFiltro}"]`);
      if (novo && t.tagName === 'INPUT') { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) { /* tipo sem seleção */ } }
    };
    raiz.addEventListener('input', aoFiltrar);
    raiz.addEventListener('change', aoFiltrar);
  },

  // ============================ Aprovação da aquisição ============================
  // Aprovar (passa a Ativa) ou recusar (com motivo opcional) licenças em processo de aquisição. Cada uma é gravada à parte e a lista
  // em memória só muda quando a base de dados confirma; devolve quantas ficaram decididas.
  async decidir(ids, acao) {
    if (this._aGuardar) return 0;
    const alvo = ids.map(id => this.lista.find(x => x.id === id)).filter(l => l && this.podeDecidir(l));
    if (!alvo.length) { App.toast('Não tens permissão para decidir sobre esta licença (ou já foi decidida).'); return 0; }
    let motivo = '';
    if (acao === 'recusar') {
      motivo = window.prompt(`Recusar ${alvo.length === 1 ? `"${alvo[0].nome}"` : alvo.length + ' licenças'}.\nMotivo (opcional):`, '');
      if (motivo === null) return 0;
    }
    this._aGuardar = true;
    const nome = this.meuNome(), agora = new Date().toISOString(), hoje = this.hoje();
    let feitas = 0, erro = null;
    try {
      for (const l of alvo) {
        const patch = acao === 'aprovar' ? this.L.patchAprovar(l, hoje, nome, agora) : this.L.patchRecusar(motivo, nome, agora);
        const res = await supabaseClient.from('licencas').update(Object.assign(patch, { atualizado_em: agora, atualizado_por_nome: nome })).eq('id', l.id).eq('estado', 'em_aquisicao').select();
        if (res.error) { erro = res.error; break; }
        if (res.data && res.data.length === 1) {
          const i = this.lista.findIndex(x => x.id === l.id);
          if (i >= 0) this.lista[i] = this.L.normalizar(res.data[0]);
          feitas++;
        }
      }
    } catch (err) { erro = err; } finally { this._aGuardar = false; }
    this.renderPagina();
    App.renderNotificacoes();
    if (erro) App.toast('Não foi possível gravar a decisão: ' + (erro.message || erro));
    else if (!feitas) App.toast('Nada alterado: a licença já tinha sido decidida por outra pessoa.');
    else App.toast(acao === 'aprovar' ? `${feitas} licença${feitas === 1 ? '' : 's'} aprovada${feitas === 1 ? '' : 's'}: passa${feitas === 1 ? '' : 'm'} a Ativa. A data de renovação foi assumida a partir de hoje — ajusta-a se for outra.` : `${feitas} licença${feitas === 1 ? '' : 's'} recusada${feitas === 1 ? '' : 's'}.`);
    return feitas;
  },
  aprovarDepartamento(depId) {
    const ls = this.L.paraAprovar(this.lista).filter(l => (l.departamento_id || '') === (depId || '') && this.podeDecidir(l));
    if (!ls.length) return;
    const custo = this.L.resumoPendentes(ls).base;
    if (!confirm(`Aprovar as ${ls.length} licenças em processo de aquisição de ${this.nomeDepartamento(depId) || 'este departamento'}?\nCusto anual: ${this.L.eur(custo)}.\n\nPassam a Ativa.`)) return;
    this.decidir(ls.map(l => l.id), 'aprovar');
  },
  // Email já escrito (abre o programa de email de quem está a usar a app) ao Diretor, com as licenças que aguardam a sua aprovação.
  // Como nos pedidos de ausência, a app não envia sozinha: a pessoa só tem de carregar em "Enviar".
  emailPedido(depId, licencas) {
    const dir = this.diretorDe(depId);
    if (!dir || !dir.email || !licencas.length) return null;
    const custo = this.L.resumoPendentes(licencas).base, hoje = this.hoje();
    const montar = ls => {
      const linhas = ls.map(l => this.L.linhaPedido(l, this.nomePessoa(l.responsavel_id), this.rotuloProjeto(l)));
      const corpo = [`Olá ${dir.nome.split(' ')[0]},`, '',
        `${licencas.length === 1 ? 'Há 1 licença' : `Há ${licencas.length} licenças`} de software em processo de aquisição no departamento ${this.nomeDepartamento(depId)} que aguarda${licencas.length === 1 ? '' : 'm'} a tua aprovação (custo anual: ${this.L.eur(custo)}, sem IVA):`, '',
        ...linhas, ...(ls.length < licencas.length ? [`… e mais ${licencas.length - ls.length} (vê a lista completa na app)`] : []), '',
        `Para aprovar ou recusar: ${location.origin}${location.pathname} → Ativos → Licenças (as pendentes aparecem no topo; também tens um aviso no sino).`, '',
        `Pedido registado por ${this.meuNome() || '—'} em ${this.L.formatarData(hoje)}.`].join('\n');
      return `mailto:${encodeURIComponent(dir.email)}?subject=${encodeURIComponent(`Licenças para aprovar — ${this.nomeDepartamento(depId)} (${licencas.length})`)}&body=${encodeURIComponent(corpo.replace(/\n/g, '\r\n'))}`;
    };
    // Os programas de email limitam o tamanho da ligação: se for comprida, corta a lista (a app tem-na completa).
    let ls = licencas.slice(), url = montar(ls);
    while (url.length > 1900 && ls.length > 1) { ls = ls.slice(0, -1); url = montar(ls); }
    return url;
  },
  avisarDiretor(depId) {
    const ls = this.L.paraAprovar(this.lista).filter(l => (l.departamento_id || '') === (depId || ''));
    const url = this.emailPedido(depId, ls);
    if (!url) { App.toast('Este departamento não tem Diretor com email preenchido.'); return; }
    window.location.href = url;
  },

  // ============================ Formulário (janela) ============================
  nova() {
    const deps = this.departamentosEditaveis();
    const meuRec = (App.perfilAtual() || {}).recursoId || null;
    this.atual = this.L.nova({ departamento_id: deps.length === 1 ? deps[0].id : null, responsavel_id: meuRec && App.state.recursos.some(r => r.id === meuRec) ? meuRec : null });
    if (!this.atual.departamento_id) this.sugerirDepartamento();
    this.original = JSON.stringify(this.atual);
    this.abrirForm('Nova licença');
  },
  abrir(id) {
    const l = this.lista.find(x => x.id === id);
    if (!l) return;
    this.atual = JSON.parse(JSON.stringify(l));
    this.original = JSON.stringify(this.atual);
    this.abrirForm(l.nome);
  },
  // Departamento por omissão = o da equipa do responsável (se a pessoa puder registar nele).
  sugerirDepartamento() {
    const rec = this.atual.responsavel_id ? App.state.recursos.find(r => r.id === this.atual.responsavel_id) : null;
    const eq = rec ? App.state.equipas.find(e => e.id === rec.equipaId) : null;
    if (eq && eq.departamentoId && this.departamentosEditaveis().some(d => d.id === eq.departamentoId)) this.atual.departamento_id = eq.departamentoId;
  },
  sujo() { return !!this.atual && JSON.stringify(this.atual) !== this.original; },
  abrirForm(titulo) {
    App.abrirModal(titulo, '', { largo: true, alteracoes: () => this.sujo() });
    this.renderForm();
  },
  opcoesPessoas(l) {
    const ativos = App.recursosAtivos().slice();
    const atual = l.responsavel_id ? App.state.recursos.find(r => r.id === l.responsavel_id) : null;
    if (atual && !ativos.some(r => r.id === atual.id)) ativos.push(atual); // pessoa entretanto inativa: mantém-se visível
    ativos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    return `<option value="">— sem responsável —</option>${ativos.map(r => `<option value="${escapeAttr(r.id)}"${l.responsavel_id === r.id ? ' selected' : ''}>${escapeHtml(r.nome)}${App.recursoInativo(r) ? ' (inativo)' : ''}</option>`).join('')}`;
  },
  opcoesDepartamentos(l) {
    const deps = this.departamentosEditaveis().slice();
    const atual = l.departamento_id ? App.state.departamentos.find(d => d.id === l.departamento_id) : null;
    if (atual && !deps.some(d => d.id === atual.id)) deps.push(atual);
    return `<option value="">— escolhe —</option>${deps.map(d => `<option value="${escapeAttr(d.id)}"${l.departamento_id === d.id ? ' selected' : ''}>${escapeHtml(d.nome)}</option>`).join('')}`;
  },
  // Projeto: "sem projeto", um projeto da app, ou "outro" (fora da app: texto livre guardado em projeto_nome).
  // "__outro" é só um marcador do formulário (a pessoa escolheu "Outro" e ainda não escreveu o texto); não vai para a base de dados.
  valorSelectProjeto(l) { return l.projeto_id ? l.projeto_id : (l.projeto_nome || l.__outro ? '_outro' : ''); },
  opcoesProjetos(l) {
    const projs = App.projetosQuePossoVer().slice().sort((a, b) => App.rotuloProjetoCompleto(a).localeCompare(App.rotuloProjetoCompleto(b), 'pt'));
    const sel = this.valorSelectProjeto(l);
    const foraDaLista = l.projeto_id && !projs.some(p => p.id === l.projeto_id);
    const o = (v, t) => `<option value="${escapeAttr(v)}"${sel === v ? ' selected' : ''}>${escapeHtml(t)}</option>`;
    return o('', '— sem projeto —') + projs.map(p => o(p.id, App.rotuloProjetoCompleto(p))).join('')
      + (foraDaLista ? o(l.projeto_id, l.projeto_nome || '(projeto)') : '') + o('_outro', 'Outro (fora da app)…');
  },
  renderForm() {
    const l = this.atual, S = this.L, m = App.els.modalCorpo, sub = S.ehSubscricao(l);
    const v = x => x == null ? '' : escapeAttr(x);
    const nova = !l.id;
    m.innerHTML = `<div data-lic-form>
      <div class="row-2">
        <label><span class="rotulo-campo"><span class="obrig">*</span> Software</span><input type="text" data-lic-f="nome" value="${v(l.nome)}" placeholder="Ex.: Microsoft 365, Adobe, Matlab…"></label>
        <label>Fornecedor <input type="text" data-lic-f="fornecedor" value="${v(l.fornecedor)}"></label>
      </div>
      <div class="row-2">
        <label>Tipo <select data-lic-f="tipo">${Object.entries(S.TIPOS).map(([k, t]) => `<option value="${k}"${l.tipo === k ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>
        <label>Periodicidade <select data-lic-f="periodicidade"${sub ? '' : ' disabled'}>${(sub ? ['mensal', 'anual'] : ['unica']).map(k => `<option value="${k}"${l.periodicidade === k ? ' selected' : ''}>${S.PERIODICIDADES[k]}</option>`).join('')}</select></label>
      </div>
      <div class="row-2">
        <label><span class="rotulo-campo"><span class="obrig">*</span> ${sub ? 'Valor de cada período (€, sem IVA)' : 'Valor de aquisição (€, sem IVA)'} <span class="nota">(total, para todos os lugares)</span></span><input type="number" min="0" step="0.01" data-lic-f="valor" value="${v(l.valor)}"></label>
        <label>N.º de licenças / lugares <input type="number" min="0" step="1" data-lic-f="n_licencas" value="${v(l.n_licencas)}"></label>
      </div>
      <div class="row-2">
        <label>Responsável (a quem pertence) <select data-lic-f="responsavel_id">${this.opcoesPessoas(l)}</select></label>
        <label><span class="rotulo-campo"><span class="obrig">*</span> Departamento</span><select data-lic-f="departamento_id">${this.opcoesDepartamentos(l)}</select></label>
      </div>
      <div class="row-2">
        <label>Data de início <input type="date" data-lic-f="data_inicio" value="${v(l.data_inicio)}"></label>
        <label>${sub ? 'Próxima renovação' : 'Fim de suporte / renovação (opcional)'} <input type="date" data-lic-f="data_renovacao" value="${v(l.data_renovacao)}"></label>
      </div>
      ${sub ? `<label class="zoom-label" style="padding:2px 0"><input type="checkbox" data-lic-f="renovacao_automatica"${l.renovacao_automatica ? ' checked' : ''}> Renova automaticamente <span class="hint">(a app avança a data sozinha para a próxima renovação; desmarca se tiver de ser renovada à mão)</span></label>` : ''}
      <div class="row-2">
        <label>Projeto que a suporta <select data-lic-f="projeto_sel">${this.opcoesProjetos(l)}</select></label>
        <label>Taxa de financiamento (%) <input type="number" min="0" max="100" step="0.01" data-lic-f="taxa_financiamento" value="${v(l.taxa_financiamento)}"></label>
      </div>
      ${this.valorSelectProjeto(l) === '_outro' ? `<label>Projeto fora da app (nome/código) <input type="text" data-lic-f="projeto_nome" value="${v(l.projeto_nome)}"></label>` : ''}
      <div class="lic-calculo" id="licCalculo">${this.htmlCalculo()}</div>
      <div class="row-2">
        <label>Estado <select data-lic-f="estado">${Object.entries(S.ESTADOS).map(([k, t]) => `<option value="${k}"${l.estado === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Ligação à fatura / contrato (https://…) <input type="text" data-lic-f="ligacao" value="${v(l.ligacao)}" placeholder="Ligação do SharePoint/OneDrive"></label>
      </div>
      ${l.estado === 'em_aquisicao' ? '<p class="hint" style="margin:2px 0 6px">Em processo de aquisição: ao guardar, o Diretor do departamento fica com um aviso no sino para aprovar (e, numa licença nova, abre-se um email já escrito para ele). Só passa a contar para os custos depois de aprovada.</p>' : ''}
      ${l.estado === 'recusada' ? `<label>Motivo da recusa <input type="text" data-lic-f="motivo_decisao" value="${v(l.motivo_decisao)}"></label>` : ''}
      <label>Notas <textarea rows="3" data-lic-f="notas">${escapeHtml(l.notas)}</textarea></label>
      <div class="lic-form-acoes">
        <button type="button" class="btn btn-primary" data-lic-m="guardar">Guardar</button>
        <button type="button" class="btn" data-lic-m="cancelar">Cancelar</button>
        ${this.podeDecidir(l) && l.id ? '<button type="button" class="btn" data-lic-m="aprovar">✔ Aprovar</button><button type="button" class="btn" data-lic-m="recusar">✖ Recusar</button>' : ''}
        ${nova ? '' : `<span class="crm-barra-fim"><button type="button" class="btn btn-danger" data-lic-m="eliminar">Eliminar</button></span>`}
      </div>
      <p class="hint" id="licMsg" style="margin:6px 0 0"></p>
      ${nova ? '' : `<p class="hint" style="margin:6px 0 0">Registada por ${escapeHtml(l.criado_por_nome || '—')}${l.atualizado_por_nome ? ` · última alteração: ${escapeHtml(l.atualizado_por_nome)}` : ''}${l.decisao_em && (l.estado === 'ativa' || l.estado === 'recusada') ? ` · ${l.estado === 'recusada' ? 'recusada' : 'aprovada'} por ${escapeHtml(l.decisao_por_nome || '—')} em ${S.formatarData(String(l.decisao_em).slice(0, 10))}` : ''}.</p>`}
    </div>`;
    const raiz = m.querySelector('[data-lic-form]');
    raiz.addEventListener('input', ev => this.aoEditar(ev, false));
    raiz.addEventListener('change', ev => this.aoEditar(ev, true));
    raiz.addEventListener('click', ev => {
      const b = ev.target.closest('[data-lic-m]');
      if (!b) return;
      ev.preventDefault();
      if (b.dataset.licM === 'guardar') this.guardarComAviso();
      else if (b.dataset.licM === 'cancelar') this.cancelarForm();
      else if (b.dataset.licM === 'eliminar') this.eliminar();
      else if (b.dataset.licM === 'aprovar' || b.dataset.licM === 'recusar') this.decidirDoForm(b.dataset.licM);
    });
  },
  // Resumo em tempo real do que o formulário já permite calcular.
  htmlCalculo() {
    const l = Object.assign({}, this.atual, { valor: Number(this.atual.valor) || 0 }), S = this.L, eur = x => S.eur(x), sub = S.ehSubscricao(l);
    return `<span><b>${eur(S.valorBase(l))}</b> ${sub ? 'por ano' : 'de aquisição'}</span>
      <span><b>${eur(S.valorFinanciado(l))}</b> financiado (${String(S.taxa(l)).replace('.', ',')}%)</span>
      <span><b>${eur(S.valorLiquido(l))}</b> a cargo do departamento</span>`;
  },
  aoEditar(ev, mudou) {
    const t = ev.target, k = t.dataset.licF, l = this.atual;
    if (!k || !l) return;
    const S = this.L;
    if (k === 'projeto_sel') {
      if (!mudou) return;
      if (t.value === '_outro') { l.projeto_id = null; if (!l.projeto_nome) l.projeto_nome = ''; l.__outro = true; }
      else if (t.value === '') { l.projeto_id = null; l.projeto_nome = ''; delete l.__outro; }
      else { l.projeto_id = t.value; const p = App.state.projetos[t.value]; l.projeto_nome = p ? App.rotuloProjetoCompleto(p) : l.projeto_nome; delete l.__outro; }
      this.renderForm();
      return;
    }
    if (k === 'renovacao_automatica') l[k] = t.checked;
    else if (k === 'valor' || k === 'taxa_financiamento') l[k] = t.value === '' ? '' : Number(t.value);
    else if (k === 'n_licencas') l[k] = t.value === '' ? null : Number(t.value);
    else if (k === 'data_inicio' || k === 'data_renovacao') l[k] = t.value || null;
    else if (k === 'responsavel_id' || k === 'departamento_id') {
      l[k] = t.value || null;
      if (k === 'responsavel_id' && mudou && !l.departamento_id) { this.sugerirDepartamento(); if (l.departamento_id) { this.renderForm(); return; } }
    } else l[k] = t.value;
    if (k === 'estado' && mudou) { this.renderForm(); return; } // mostra/esconde o aviso e o motivo da recusa
    if (k === 'tipo' && mudou) {
      l.periodicidade = l.tipo === 'perpetua' ? 'unica' : (['mensal', 'anual'].includes(l.periodicidade) ? l.periodicidade : 'anual');
      this.renderForm();
      return;
    }
    const calc = document.getElementById('licCalculo');
    if (calc) calc.innerHTML = this.htmlCalculo();
  },
  cancelarForm() {
    if (this.sujo() && !confirm('Descartar as alterações a esta licença?')) return;
    this.atual = null; this.original = '';
    App.fecharModal();
  },
  _payload(l) {
    const t = x => String(x == null ? '' : x).trim();
    return {
      nome: t(l.nome), fornecedor: t(l.fornecedor), tipo: l.tipo, periodicidade: l.periodicidade,
      n_licencas: l.n_licencas == null || l.n_licencas === '' ? null : Number(l.n_licencas), valor: Number(l.valor) || 0,
      responsavel_id: l.responsavel_id || null, departamento_id: l.departamento_id || null,
      data_inicio: l.data_inicio || null, data_renovacao: l.data_renovacao || null, renovacao_automatica: !!l.renovacao_automatica,
      projeto_id: l.projeto_id || null, projeto_nome: t(l.projeto_nome), taxa_financiamento: Number(l.taxa_financiamento) || 0,
      estado: l.estado, ligacao: t(l.ligacao), notas: t(l.notas)
    };
  },
  // Aprovar/recusar a partir da janela da licença: as alterações por guardar teriam de ser gravadas antes.
  async decidirDoForm(acao) {
    const l = this.atual;
    if (!l || !l.id) return;
    if (this.sujo()) { const m = App.els.modalCorpo.querySelector('#licMsg'); if (m) { m.style.color = 'var(--vermelho)'; m.textContent = 'Há alterações por guardar: guarda primeiro e depois decide.'; } return; }
    const feitas = await this.decidir([l.id], acao);
    if (feitas) { this.atual = null; this.original = ''; App.fecharModal(); }
  },
  async guardar() {
    const l = this.atual, erros = this.L.validar(l);
    if (erros.length) throw new Error(erros[0]);
    const agora = new Date().toISOString(), nome = this.meuNome();
    let data;
    if (!l.id) {
      const linha = Object.assign(this._payload(l), { criado_por_user: App.usuarioAtualId || null, criado_por_nome: nome, atualizado_por_nome: nome });
      const res = await supabaseClient.from('licencas').insert(linha).select().single();
      if (res.error) throw res.error;
      data = res.data;
    } else {
      const linha = Object.assign(this._payload(l), { atualizado_em: agora, atualizado_por_nome: nome });
      // Mudar o estado de "em aquisição" para outro (aprovar/recusar pelo formulário) deixa o registo da decisão.
      const antes = this.original ? JSON.parse(this.original) : {};
      if (antes.estado === 'em_aquisicao' && l.estado !== 'em_aquisicao') {
        Object.assign(linha, { decisao_por_nome: nome, decisao_em: agora, motivo_decisao: l.estado === 'recusada' ? String(l.motivo_decisao || '').trim() : '' });
      } else if (l.estado === 'recusada' && antes.estado === 'recusada') linha.motivo_decisao = String(l.motivo_decisao || '').trim();
      const res = await supabaseClient.from('licencas').update(linha).eq('id', l.id).select();
      if (res.error) throw res.error;
      if (!res.data || res.data.length !== 1) throw new Error('Não foi possível gravar: a licença já não existe ou deixaste de ter permissão sobre ela.');
      data = res.data[0];
    }
    const gravada = this.L.normalizar(data);
    const i = this.lista.findIndex(x => x.id === gravada.id);
    if (i >= 0) this.lista[i] = gravada; else this.lista.push(gravada);
    return gravada;
  },
  async _executar(fn) {
    if (this._aGuardar) return false;
    this._aGuardar = true;
    const m = App.els.modalCorpo, msg = m.querySelector('#licMsg');
    m.querySelectorAll('[data-lic-m]').forEach(b => { b.disabled = true; });
    if (msg) { msg.style.color = 'var(--cinza-500)'; msg.textContent = 'A gravar…'; }
    try { await fn(); return true; }
    catch (err) {
      const aviso = m.querySelector('#licMsg');
      if (aviso) { aviso.style.color = 'var(--vermelho)'; aviso.textContent = err.message || String(err); } else App.toast(err.message || String(err));
      m.querySelectorAll('[data-lic-m]').forEach(b => { b.disabled = false; });
      return false;
    } finally { this._aGuardar = false; }
  },
  async guardarComAviso() {
    const eraNova = !this.atual.id, estadoAntes = this.original ? JSON.parse(this.original).estado : null;
    let gravada = null;
    const ok = await this._executar(async () => { gravada = await this.guardar(); });
    if (!ok) return;
    this.atual = null; this.original = '';
    App.fecharModal();
    App.renderNotificacoes();
    // Passou a "em processo de aquisição" (nova, ou mudada para esse estado): avisa o Diretor — email já escrito, a quem o regista só falta enviar.
    const pedido = gravada && gravada.estado === 'em_aquisicao' && (eraNova || estadoAntes !== 'em_aquisicao');
    if (pedido && !App.souDiretorDe(gravada.departamento_id)) {
      const url = this.emailPedido(gravada.departamento_id, [gravada]);
      if (url) { App.toast('Licença guardada. A abrir um email para o Diretor aprovar…'); this.renderPagina(); window.location.href = url; return; }
      App.toast(this.diretorDe(gravada.departamento_id) ? 'Licença guardada. O Diretor não tem email preenchido: avisa-o à mão — vê o aviso no sino dele.' : 'Licença guardada. Este departamento não tem Diretor atribuído (Configurações → Pessoas): ninguém foi avisado.');
    } else App.toast('Licença guardada.');
    this.renderPagina();
  },
  async eliminar() {
    const l = this.atual;
    if (!l || !l.id) return;
    if (!confirm(`Eliminar a licença "${l.nome}"? Não dá para desfazer. (Se só deixou de estar em uso, é melhor marcá-la como Cancelada ou Expirada — fica no histórico.)`)) return;
    const ok = await this._executar(async () => {
      const { error } = await supabaseClient.from('licencas').delete().eq('id', l.id);
      if (error) throw error;
      this.lista = this.lista.filter(x => x.id !== l.id);
    });
    if (!ok) return;
    this.atual = null; this.original = '';
    App.fecharModal();
    App.toast('Licença eliminada.');
    this.renderPagina();
  },

  // ============================ Excel ============================
  // Exporta a lista tal como está filtrada. Custo anual e líquido são fórmulas do Excel (conferíveis); os totais só somam as ativas.
  async exportarExcel() {
    try {
      const X = XlsxEstilo, S = this.L, hoje = this.hoje();
      const lista = S.ordenar(S.filtrar(this.lista, this.filtros, this.ctxFiltro()), hoje);
      if (!lista.length) { App.toast('Não há licenças para exportar com estes filtros.'); return; }
      const cab = ['Software', 'Fornecedor', 'Tipo', 'Periodicidade', 'N.º lic.', 'Valor (período / aquisição)', 'Custo anual / aquisição', 'Taxa financ.', 'Financiado', 'A cargo do dep.', 'Responsável', 'Departamento', 'Projeto', 'Início', 'Próx. renovação', 'Renova auto.', 'Estado', 'Notas'];
      const EUR = '#,##0.00 "€"', primeira = 5, ultima = primeira + lista.length - 1;
      const linhas = [
        { altura: 24, celulas: [{ v: 'Licenças de software', e: { negrito: true, tam: 14 }, colspan: 6 }] },
        { altura: 16, celulas: [{ v: `Exportado em ${S.formatarData(hoje)} · valores em € sem IVA · o total só soma licenças ativas (as em aquisição aparecem à parte)`, e: { italico: true, cor: '6B7280' }, colspan: 10 }] },
        { altura: 8, celulas: [] },
        { altura: 32, celulas: cab.map(t => ({ v: t, e: { negrito: true, fundo: 'DCE8F3', borda: 'fina', quebra: true, alinha: 'center' } })) }
      ];
      lista.forEach((l, i) => {
        const r = primeira + i, zebra = i % 2 ? 'F7F9FC' : null, b = { borda: 'fina', fundo: zebra };
        const prox = S.proximaRenovacao(l, hoje), custo = S.valorBase(l), taxa = S.taxa(l) / 100;
        const fin = S.r2(custo * taxa);
        linhas.push({ altura: 18, celulas: [
          { v: l.nome, e: Object.assign({ negrito: true }, b) }, { v: l.fornecedor, e: b },
          { v: S.TIPOS[l.tipo] || l.tipo, e: b }, { v: S.PERIODICIDADES[l.periodicidade] || l.periodicidade, e: b },
          { v: l.n_licencas == null ? '' : l.n_licencas, e: Object.assign({ alinha: 'right' }, b) },
          { v: S.r2(l.valor), e: Object.assign({ formato: EUR, alinha: 'right' }, b) },
          { v: custo, e: Object.assign({ formato: EUR, alinha: 'right' }, b) },
          { v: taxa, e: Object.assign({ formato: '0.0%', alinha: 'right' }, b) },
          { v: fin, f: `${X.ref(r, 6)}*${X.ref(r, 7)}`, e: Object.assign({ formato: EUR, alinha: 'right' }, b) },
          { v: S.r2(custo - fin), f: `${X.ref(r, 6)}-${X.ref(r, 8)}`, e: Object.assign({ formato: EUR, alinha: 'right' }, b) },
          { v: this.nomePessoa(l.responsavel_id), e: b }, { v: this.nomeDepartamento(l.departamento_id), e: b },
          { v: this.rotuloProjeto(l), e: b }, { v: l.data_inicio ? S.formatarData(l.data_inicio) : '', e: b },
          { v: prox ? S.formatarData(prox) : '', e: b }, { v: S.ehSubscricao(l) ? (l.renovacao_automatica ? 'Sim' : 'Não') : '', e: b },
          { v: S.ESTADOS[l.estado] || l.estado, e: b }, { v: l.notas, e: b }
        ] });
      });
      // Totais: só as ativas (coluna Estado = "Ativa").
      const soma = (col) => `SUMIF(${X.ref(primeira, 16)}:${X.ref(ultima, 16)},"Ativa",${X.ref(primeira, col)}:${X.ref(ultima, col)})`;
      const ativas = lista.filter(l => l.estado === 'ativa');
      const tot = ativas.reduce((a, l) => { const c = S.valorBase(l), f = S.r2(c * S.taxa(l) / 100); a.c += c; a.f += f; a.l += c - f; return a; }, { c: 0, f: 0, l: 0 });
      const te = Object.assign({ negrito: true, fundo: 'DCE8F3', borda: 'topo', formato: EUR, alinha: 'right' });
      linhas.push({ altura: 20, celulas: [
        { v: `Total (${ativas.length} ativa${ativas.length === 1 ? '' : 's'})`, e: { negrito: true, fundo: 'DCE8F3', borda: 'topo' }, colspan: 6 },
        { v: S.r2(tot.c), f: soma(6), e: te }, { v: '', e: { fundo: 'DCE8F3', borda: 'topo' } },
        { v: S.r2(tot.f), f: soma(8), e: te }, { v: S.r2(tot.l), f: soma(9), e: te }
      ] });
      // Previsão: as que aguardam aprovação, à parte (não entram no total acima).
      const pendentes = lista.filter(l => l.estado === 'em_aquisicao');
      if (pendentes.length) {
        const rotPend = S.ESTADOS.em_aquisicao, somaP = (col) => `SUMIF(${X.ref(primeira, 16)}:${X.ref(ultima, 16)},"${rotPend}",${X.ref(primeira, col)}:${X.ref(ultima, col)})`;
        const tp = pendentes.reduce((a, l) => { const c = S.valorBase(l), f = S.r2(c * S.taxa(l) / 100); a.c += c; a.f += f; a.l += c - f; return a; }, { c: 0, f: 0, l: 0 });
        const tpe = { negrito: true, fundo: 'FFF4D6', formato: EUR, alinha: 'right' };
        linhas.push({ altura: 20, celulas: [
          { v: `Em processo de aquisição (${pendentes.length}) — previsão, a aprovar`, e: { negrito: true, fundo: 'FFF4D6' }, colspan: 6 },
          { v: S.r2(tp.c), f: somaP(6), e: tpe }, { v: '', e: { fundo: 'FFF4D6' } },
          { v: S.r2(tp.f), f: somaP(8), e: tpe }, { v: S.r2(tp.l), f: somaP(9), e: tpe }
        ] });
      }
      const spec = {
        nome: 'Licenças', paisagem: true,
        larguras: [28, 18, 16, 13, 8, 18, 18, 10, 16, 16, 20, 20, 30, 12, 14, 10, 11, 36],
        congelar: { linhas: 4, colunas: 1 },
        autofiltro: { linha: 4, de: 0, ate: cab.length - 1, ultimaLinha: ultima },
        linhas
      };
      const blob = await XlsxEstilo.gerar(spec, JSZip, 'blob');
      App.descarregarBlob(blob, S.nomeFicheiroExcel(hoje));
      App.toast('Licenças exportadas para Excel.');
    } catch (err) {
      console.error(err);
      App.toast('Erro ao gerar o Excel: ' + err.message);
    }
  }
};

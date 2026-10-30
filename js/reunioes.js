// Módulo "Reuniões": identificar a reunião (cliente, projeto/oportunidade), participantes, notas, ligações a ficheiros,
// decisões e ações, e emitir a ata em Word. Como o CRM, fala DIRETAMENTE com a sua tabela ("reunioes", ver
// supabase/reunioes.sql) — só quando alguém abre o separador — e cada gravação é imediata (sem desfazer). As regras puras estão em
// reunioes-logica.js e a ata em reunioes-ata.js. Em memória guardamos as linhas como vêm da base de dados (snake_case).
//
// Uma reunião aberta para edição vive em "this.atual" (cópia). Fica em memória ao mudar de separador (não se perde o que se
// escreveu); só se descarta ao voltar à lista a pedido, ao gravar ou ao terminar a sessão.
const Reunioes = {
  lista: [],
  carregado: false,
  semTabela: false,
  erro: null,
  filtros: { texto: '', estado: '', projeto: '', periodo: '' },
  atual: null,      // reunião em edição (null = a mostrar a lista)
  original: '',     // JSON da reunião como foi aberta/gravada, para saber se há alterações por guardar
  _aGuardar: false,

  L: ReunioesLogica,

  // ---------- Permissões ----------
  ctx() {
    const perfil = App.perfilAtual() || {};
    const recursoId = perfil.recursoId || null;
    return {
      userId: App.usuarioAtualId, recursoId, admin: App.souAdmin(), crmVer: Crm.podeVer(),
      veProjeto: id => App.possoVerProjeto(id), editaProjeto: id => App.possoEditarProjeto(id),
      souResponsavelOp: id => !!recursoId && (((Crm.idx.op && Crm.idx.op.get(id)) || {}).responsavel_id === recursoId),
      souResponsavelConta: id => !!recursoId && (((Crm.idx.conta && Crm.idx.conta.get(id)) || {}).responsavel_id === recursoId)
    };
  },
  meuNome() { return (App.perfilAtual() || {}).nome || ''; },
  visiveis() { const c = this.ctx(); return this.lista.filter(r => this.L.podeVer(r, c)); },
  corpo() { return document.getElementById('reunioesCorpo'); },
  sujo() { return !!this.atual && JSON.stringify(this.atual) !== this.original; },
  clonar(o) { return JSON.parse(JSON.stringify(o)); },

  // ---------- Dados ----------
  limpar() {
    this.lista = []; this.carregado = false; this.semTabela = false; this.erro = null;
    this.atual = null; this.original = ''; this._aCarregar = null;
    this.filtros = { texto: '', estado: '', projeto: '', periodo: '' };
    const c = this.corpo(); if (c) c.innerHTML = '';
  },
  async carregar(forcar) {
    if (this.carregado && !forcar) return;
    if (this._aCarregar) { await this._aCarregar; return; }
    this._aCarregar = (async () => {
      const PAGINA = 1000, linhas = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await supabaseClient.from('reunioes').select('*').order('data_hora', { ascending: false }).order('id').range(de, de + PAGINA - 1);
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
      // Antes de correr supabase/reunioes.sql a tabela não existe: o resto da app continua, este separador explica o que falta.
      this.semTabela = /reunioes/i.test(err.message || '') && /does not exist|schema cache|could not find/i.test(err.message || '') || err.code === '42P01' || err.code === 'PGRST205';
      this.erro = err.message || String(err);
    } finally { this._aCarregar = null; }
  },
  async aoAbrir() {
    const c = this.corpo();
    if (!c) return;
    if (!this.carregado && !this.atual) c.innerHTML = '<p class="hint">A carregar as reuniões…</p>';
    await this.carregar();
    this.renderTudo();
  },
  renderTudo() {
    if (!this.corpo()) return;
    if (this.semTabela) { this.corpo().innerHTML = '<div class="card"><p><b>O módulo de reuniões ainda não está instalado.</b></p><p class="hint">Falta correr o ficheiro <code>supabase/reunioes.sql</code> no SQL Editor do Supabase (cria só uma tabela nova) e recarregar a página.</p></div>'; return; }
    if (this.erro && !this.carregado) { this.corpo().innerHTML = `<div class="card"><p>Não foi possível carregar as reuniões: ${escapeHtml(this.erro)}</p><p><button type="button" class="btn" data-reu-acao="recarregar">Tentar de novo</button></p></div>`; this.ligar(this.corpo()); return; }
    if (this.atual) this.renderEditor(); else this.renderLista();
  },

  // ============================ Lista ============================
  renderLista() {
    const f = this.filtros;
    const todas = this.visiveis();
    const lista = this.L.filtrar(todas, f);
    const projetos = App.projetosQuePossoVer().slice().sort((a, b) => App.rotuloProjetoCompleto(a).localeCompare(App.rotuloProjetoCompleto(b), 'pt'));
    const opt = (v, t, sel) => `<option value="${escapeAttr(v)}"${sel === v ? ' selected' : ''}>${escapeHtml(t)}</option>`;
    const linhas = lista.map(r => {
      const res = this.L.resumoPontos(r);
      const ligacao = [r.projeto_nome, r.oportunidade_titulo].filter(Boolean);
      return `<tr class="crm-linha" data-reu-acao="abrir" data-id="${escapeAttr(r.id)}">
        <td style="white-space:nowrap">${escapeHtml(this.L.formatarDataHora(r.data_hora))}</td>
        <td><b>${escapeHtml(r.titulo)}</b></td>
        <td>${escapeHtml(r.cliente || '—')}</td>
        <td>${ligacao.length ? ligacao.map(escapeHtml).join('<br>') : '—'}</td>
        <td>${r.participantes.length}</td>
        <td>${res.acoes ? `${res.acoesPorFechar} por fechar` : '—'}</td>
        <td>${r.ata_versao ? `v${r.ata_versao}` : '—'}</td>
        <td><span class="reu-estado reu-estado-${escapeAttr(r.estado)}">${escapeHtml(this.L.ESTADOS[r.estado] || r.estado)}</span></td></tr>`;
    }).join('');
    this.corpo().innerHTML = `<div class="filters crm-barra">
        <label class="zoom-label">Pesquisar <input type="text" data-reu-filtro="texto" value="${escapeAttr(f.texto)}" placeholder="Título, cliente, projeto, pessoa…"></label>
        <label class="zoom-label">Quando <select data-reu-filtro="periodo">${opt('', 'Todas', f.periodo)}${opt('proximas', 'Próximas', f.periodo)}${opt('passadas', 'Já realizadas / passadas', f.periodo)}</select></label>
        <label class="zoom-label">Estado <select data-reu-filtro="estado">${opt('', 'Todos', f.estado)}${Object.entries(this.L.ESTADOS).map(([k, v]) => opt(k, v, f.estado)).join('')}</select></label>
        <label class="zoom-label">Projeto <select data-reu-filtro="projeto">${opt('', 'Todos', f.projeto)}${projetos.map(p => opt(p.id, App.rotuloProjetoCompleto(p), f.projeto)).join('')}</select></label>
        <span class="crm-barra-fim"><span class="hint">${lista.length} de ${todas.length} reuniões</span>
          <button type="button" class="ib ib-pri" data-reu-acao="nova" data-tip="Registar uma reunião" aria-label="Nova reunião">${Icones.svg('plus')}<span>Nova reunião</span></button></span>
      </div>
      ${lista.length ? `<div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Data e hora</th><th>Reunião</th><th>Cliente</th><th>Projeto / Oportunidade</th><th>Pessoas</th><th>Ações</th><th>Ata</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table></div>`
        : `<p class="hint" style="margin-top:14px">${todas.length ? 'Nenhuma reunião com estes filtros.' : 'Ainda não há reuniões. Regista a primeira em "+ Nova reunião".'}</p>`}`;
    this.ligar(this.corpo());
  },

  // inicial (opcional): { projetoId, contaId, oportunidadeId } — para começar já ligada (a partir da ficha do cliente/oportunidade).
  nova(inicial) {
    inicial = inicial || {};
    const op = inicial.oportunidadeId && Crm.idx.op ? Crm.idx.op.get(inicial.oportunidadeId) : null;
    const contaId = inicial.contaId || (op && op.conta_id) || null;
    const conta = contaId && Crm.idx.conta ? Crm.idx.conta.get(contaId) : null;
    const projetoId = inicial.projetoId || (op && op.projeto_id && App.state.projetos[op.projeto_id] && App.possoVerProjeto(op.projeto_id) ? op.projeto_id : null);
    const p = projetoId ? App.state.projetos[projetoId] : null;
    this.atual = this.L.nova({ projeto: p });
    if (p) this.atual.projeto_nome = App.rotuloProjetoCompleto(p);
    if (conta) { this.atual.conta_id = conta.id; if (!this.atual.cliente) this.atual.cliente = conta.nome; }
    if (op) { this.atual.oportunidade_id = op.id; this.atual.oportunidade_titulo = op.titulo; }
    this.original = JSON.stringify(this.atual); // nova e ainda por tocar: sem alterações
    this.abrirEditor();
  },
  // A partir de outro ecrã (ficha do cliente/oportunidade): abre uma reunião, ou começa uma nova já ligada, no separador Reuniões.
  abrirDeFora(id, inicial) {
    if (this.sujo() && !confirm('Tens uma reunião por guardar no separador Reuniões. Descartar o que lá escreveste e continuar?')) return;
    if (id) this.abrir(id); else this.nova(inicial);
    App.fecharModal();
    App.irParaAba('reunioes');
  },
  // Sai do editor para a lista (se houver reunião por guardar, pergunta antes). Devolve false se a pessoa preferir ficar.
  _sairDoEditor() {
    if (this.sujo() && !confirm('Tens uma reunião por guardar no separador Reuniões. Descartar o que lá escreveste e continuar?')) return false;
    this.atual = null; this.original = '';
    return true;
  },
  // Cartão "Reuniões" da barra lateral do Gantt (projeto ativo): as mais recentes, "Ver todas" e "+ Reunião" já ligada ao projeto.
  renderCardProjeto(p) {
    const card = document.getElementById('cardReunioes'), corpo = document.getElementById('reunioesProjetoCorpo');
    if (!card || !corpo) return;
    if (!p || this.semTabela) { card.style.display = 'none'; return; }
    card.style.display = '';
    if (!corpo._reuLigado) {
      corpo._reuLigado = true;
      corpo.addEventListener('click', ev => {
        const el = ev.target.closest('[data-reu-proj]');
        const proj = App.projetoAtivo();
        if (!el || !proj) return;
        ev.preventDefault();
        const acao = el.dataset.reuProj;
        if (acao === 'abrir') this.abrirDeFora(el.dataset.id);
        else if (acao === 'nova') this.abrirDeFora(null, { projetoId: proj.id });
        else if (acao === 'todas') {
          if (!this._sairDoEditor()) return;
          this.filtros = { texto: '', estado: '', projeto: proj.id, periodo: '' };
          App.irParaAba('reunioes');
        }
      });
    }
    if (!this.carregado) {
      if (this.erro) { corpo.innerHTML = '<p class="hint" style="margin:0">Não foi possível carregar as reuniões.</p>'; return; }
      corpo.innerHTML = '<p class="hint" style="margin:0">A carregar…</p>';
      this.carregar().then(() => this.renderCardProjeto(App.projetoAtivo()));
      return;
    }
    const lista = this.visiveis().filter(r => r.projeto_id === p.id).sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));
    const mostra = lista.slice(0, 4);
    corpo.innerHTML = `${mostra.length ? mostra.map(r => `<div class="reu-mini"><a href="#" data-reu-proj="abrir" data-id="${escapeAttr(r.id)}" title="${escapeAttr(r.titulo)}"><b>${escapeHtml(this.L.formatarData(r.data_hora))}</b> ${escapeHtml(r.titulo)}</a>
        <span class="reu-estado reu-estado-${escapeAttr(r.estado)}">${escapeHtml(this.L.ESTADOS[r.estado] || r.estado)}</span></div>`).join('')
        : '<p class="hint" style="margin:0 0 6px">Ainda sem reuniões deste projeto.</p>'}
      <div class="reu-mini-acoes">${lista.length > mostra.length ? `<a href="#" data-reu-proj="todas">Ver todas (${lista.length})</a>` : (lista.length ? '<a href="#" data-reu-proj="todas">Ver no separador Reuniões</a>' : '')}
        <button type="button" class="btn btn-sm" data-reu-proj="nova">+ Reunião</button></div>`;
  },
  // Secção "Reuniões" da ficha da conta (ctx.contaId) ou da oportunidade (ctx.opId): as que a pessoa pode ver, mais recentes primeiro.
  async secCrm(raiz, ctx) {
    if (!raiz) return;
    raiz.innerHTML = '<p class="hint">A carregar as reuniões…</p>';
    await this.carregar();
    if (!raiz.isConnected) return; // a janela mudou entretanto
    if (this.semTabela) { raiz.innerHTML = '<p class="hint">O módulo de reuniões ainda não está instalado (falta correr supabase/reunioes.sql).</p>'; return; }
    if (!this.carregado) { raiz.innerHTML = `<p class="hint">Não foi possível carregar as reuniões: ${escapeHtml(this.erro || '')}</p>`; return; }
    let todas = this.visiveis();
    if (ctx.opId) todas = this.L.daOportunidade(todas, ctx.opId);
    else {
      const conta = Crm.idx.conta && Crm.idx.conta.get(ctx.contaId);
      const opIds = (Crm.d.oportunidades || []).filter(o => o.conta_id === ctx.contaId).map(o => o.id);
      const projetoIds = conta ? CrmLogica.projetosDaConta(conta, Crm.d.oportunidades, Object.values(App.state.projetos)).map(x => x.projeto.id) : [];
      todas = this.L.daConta(todas, { contaId: ctx.contaId, opIds, projetoIds });
    }
    const lista = todas.slice().sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));
    raiz.innerHTML = `${lista.length ? `<div class="crm-lista">${lista.map(r => {
        const res = this.L.resumoPontos(r);
        return `<div class="crm-item crm-item-linha"><span class="crm-item-texto"><b>${escapeHtml(this.L.formatarDataHora(r.data_hora))}</b> · ${escapeHtml(r.titulo)}
          <span class="reu-estado reu-estado-${escapeAttr(r.estado)}">${escapeHtml(this.L.ESTADOS[r.estado] || r.estado)}</span></span>
          <span class="hint">${r.participantes.length} pessoa(s)${res.acoesPorFechar ? ` · ${res.acoesPorFechar} ação(ões) por fechar` : ''}${r.ata_versao ? ` · ata v${r.ata_versao}` : ''}</span>
          <button type="button" class="btn btn-sm" data-sec-acao="abrir" data-id="${escapeAttr(r.id)}">Abrir</button></div>`;
      }).join('')}</div>` : '<p class="hint">Ainda sem reuniões registadas.</p>'}
      <button type="button" class="btn btn-sm" data-sec-acao="nova">+ Reunião</button>`;
    Crm.ligarAcoes(raiz, {
      abrir: b => this.abrirDeFora(b.dataset.id),
      nova: () => this.abrirDeFora(null, ctx.opId ? { oportunidadeId: ctx.opId } : { contaId: ctx.contaId })
    });
  },
  abrir(id) {
    const r = this.lista.find(x => x.id === id);
    if (!r) return;
    this.atual = this.clonar(r);
    this.atual.notas = this.L.notasParaEditor(this.atual.notas); // notas antigas (texto simples) → HTML, sem contar como alteração
    this.original = JSON.stringify(this.atual);
    this.abrirEditor();
  },
  async abrirEditor() {
    // As contas/oportunidades/contactos do CRM só existem para quem tem acesso ao CRM — carregam-se à vez, sem bloquear.
    if (Crm.podeVer() && !Crm.carregado) { try { await Crm.carregar(); } catch (e) { /* o editor funciona sem CRM */ } }
    if (this.atual) { this.renderEditor(); const c = this.corpo(); if (c) c.scrollIntoView({ block: 'start' }); }
  },
  voltar() {
    if (this.sujo() && !confirm('Tens alterações por guardar nesta reunião. Sair e perder o que escreveste?')) return;
    this.atual = null; this.original = '';
    this.renderTudo();
  },

  // ============================ Editor ============================
  podeEditarAtual() { return !this.atual.id || this.L.podeEditar(this.atual, this.ctx()); },
  opcoesProjetos() {
    const r = this.atual;
    const ps = App.projetosQuePossoVer().slice().sort((a, b) => App.rotuloProjetoCompleto(a).localeCompare(App.rotuloProjetoCompleto(b), 'pt'));
    const sel = r.projeto_id || '';
    const extra = sel && !ps.some(p => p.id === sel) ? `<option value="${escapeAttr(sel)}" selected>${escapeHtml(r.projeto_nome || 'Projeto')}</option>` : '';
    return `<option value="">— sem projeto —</option>${extra}${ps.map(p => `<option value="${escapeAttr(p.id)}"${sel === p.id ? ' selected' : ''}>${escapeHtml(App.rotuloProjetoCompleto(p))}</option>`).join('')}`;
  },
  opcoesContas() {
    const sel = this.atual.conta_id || '';
    const cs = (Crm.d.contas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    return `<option value="">— sem conta —</option>${cs.map(c => `<option value="${escapeAttr(c.id)}"${sel === c.id ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}`;
  },
  opcoesOportunidades() {
    const r = this.atual;
    const sel = r.oportunidade_id || '';
    let ops = (Crm.d.oportunidades || []).filter(o => !r.conta_id || o.conta_id === r.conta_id || o.id === sel);
    ops = ops.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt'));
    const extra = sel && !(Crm.d.oportunidades || []).some(o => o.id === sel) ? `<option value="${escapeAttr(sel)}" selected>${escapeHtml(r.oportunidade_titulo || 'Oportunidade')}</option>` : '';
    return `<option value="">— sem oportunidade —</option>${extra}${ops.map(o => `<option value="${escapeAttr(o.id)}"${sel === o.id ? ' selected' : ''}>${escapeHtml(o.titulo)}${(Crm.idx.conta && Crm.idx.conta.get(o.conta_id)) ? ' — ' + escapeHtml(Crm.idx.conta.get(o.conta_id).nome) : ''}</option>`).join('')}`;
  },
  secIdentificacao() {
    const r = this.atual, ed = this.podeEditarAtual(), d = ed ? '' : ' disabled';
    const crm = Crm.podeVer() && Crm.carregado;
    return `<div class="row-2">
        <label><span class="rotulo-campo"><span class="obrig">*</span> Título</span><input type="text" data-reu-f="titulo" value="${escapeAttr(r.titulo)}" placeholder="Ex.: Reunião de arranque, Ponto de situação…"${d}></label>
        <label>Estado <select data-reu-f="estado"${d}>${Object.entries(this.L.ESTADOS).map(([k, v]) => `<option value="${k}"${r.estado === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="row-2">
        <label><span class="rotulo-campo"><span class="obrig">*</span> Data e hora</span><input type="datetime-local" data-reu-f="data_hora" value="${escapeAttr(this.L.paraInputLocal(r.data_hora))}"${d}></label>
        <label>Duração (minutos) <input type="number" min="1" step="5" data-reu-f="duracao_min" value="${r.duracao_min == null ? '' : escapeAttr(r.duracao_min)}"${d}></label>
      </div>
      <label>Local ou ligação (Teams…) <input type="text" data-reu-f="local" value="${escapeAttr(r.local)}"${d}></label>
      <div class="row-2">
        <label>Projeto <select data-reu-f="projeto_id"${d}>${this.opcoesProjetos()}</select></label>
        <label>Cliente <input type="text" data-reu-f="cliente" value="${escapeAttr(r.cliente)}" placeholder="Nome do cliente"${d}></label>
      </div>
      ${crm ? `<div class="row-2">
        <label>Conta (CRM) <select data-reu-f="conta_id"${d}>${this.opcoesContas()}</select></label>
        <label>Oportunidade (CRM) <select data-reu-f="oportunidade_id"${d}>${this.opcoesOportunidades()}</select></label>
      </div>` : (r.oportunidade_titulo ? `<p class="hint">Oportunidade: ${escapeHtml(r.oportunidade_titulo)}</p>` : '')}`;
  },

  // Quem se pode acrescentar como participante, a partir do que a app conhece (já sem os que já lá estão).
  candidatos() {
    const r = this.atual;
    const ja = new Set(r.participantes.map(p => this.L.chaveParticipante(p)));
    const jaNomes = new Set(r.participantes.map(p => this.L.norm(p.nome)));
    const livre = (tipo, id, nome) => !ja.has(`${tipo}:${id}`) && !jaNomes.has(this.L.norm(nome));
    const proj = r.projeto_id ? App.state.projetos[r.projeto_id] : null;
    const equipa = proj ? App.consultoresDoProjeto(proj).filter(x => livre('recurso', x.id, x.nome)) : [];
    const idsEquipa = new Set(equipa.map(x => x.id));
    const contactos = r.conta_id && Crm.carregado ? (Crm.d.contactos || []).filter(c => c.conta_id === r.conta_id && livre('contacto', c.id, c.nome)) : [];
    const colegas = App.recursosAtivos().filter(x => !idsEquipa.has(x.id) && livre('recurso', x.id, x.nome)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    return { equipa, contactos, colegas };
  },
  secParticipantes() {
    const r = this.atual, ed = this.podeEditarAtual();
    const linhas = r.participantes.map((p, i) => `<tr>
        <td><b>${escapeHtml(p.nome)}</b><div class="hint" style="margin:0">${escapeHtml(this.L.TIPOS_PARTICIPANTE[p.tipo] || '')}${p.email ? ' · ' + escapeHtml(p.email) : ''}</div></td>
        <td>${escapeHtml([p.organizacao, p.cargo].filter(Boolean).join(' · ') || '—')}</td>
        <td style="text-align:center"><label class="reu-presente"><input type="checkbox" data-reu-lista="participantes" data-i="${i}" data-k="presente"${p.presente !== false ? ' checked' : ''}${ed ? '' : ' disabled'}> presente</label></td>
        <td>${ed ? `<button type="button" class="btn-icon" data-reu-acao="rem-participante" data-i="${i}" title="Retirar da reunião">✕</button>` : ''}</td></tr>`).join('');
    let adicionar = '';
    if (ed) {
      const c = this.candidatos();
      const og = (titulo, itens, f) => itens.length ? `<optgroup label="${escapeAttr(titulo)}">${itens.map(f).join('')}</optgroup>` : '';
      adicionar = `<div class="reu-add">
        <select id="reuPartSel"><option value="">Adicionar pessoa que a app já conhece…</option>
          ${og('Equipa do projeto', c.equipa, x => `<option value="recurso:${escapeAttr(x.id)}">${escapeHtml(x.nome)}</option>`)}
          ${og(`Contactos do cliente${r.cliente ? ' — ' + r.cliente : ''}`, c.contactos, x => `<option value="contacto:${escapeAttr(x.id)}">${escapeHtml(x.nome)}${x.cargo ? ' (' + escapeHtml(x.cargo) + ')' : ''}</option>`)}
          ${og('Colegas', c.colegas, x => `<option value="recurso:${escapeAttr(x.id)}">${escapeHtml(x.nome)}</option>`)}
        </select>
        <button type="button" class="btn btn-sm" data-reu-acao="add-participante">Adicionar</button>
        ${c.equipa.length ? `<button type="button" class="btn btn-sm" data-reu-acao="add-equipa" title="Acrescenta o gestor e os consultores do projeto">+ Toda a equipa do projeto (${c.equipa.length})</button>` : ''}
      </div>
      <div class="reu-add">
        <input type="text" id="reuExtNome" placeholder="Pessoa externa: nome" style="min-width:160px">
        <input type="text" id="reuExtOrg" placeholder="Organização">
        <input type="text" id="reuExtCargo" placeholder="Cargo">
        <input type="text" id="reuExtEmail" placeholder="Email (opcional)">
        <button type="button" class="btn btn-sm" data-reu-acao="add-externo">Adicionar</button>
      </div>`;
    }
    return `${r.participantes.length ? `<div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Pessoa</th><th>Organização / cargo</th><th>Presença</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<p class="hint">Ainda ninguém. Acrescenta quem foi convidado e marca quem esteve presente.</p>'}${adicionar}`;
  },
  // Notas com formatação: barra de botões + área editável (contenteditable). O que fica guardado é sempre HTML limpo (ver
  // ReunioesLogica.limparHtml); quem só pode ler vê o mesmo texto, sem barra.
  editorNotas() {
    const ed = this.podeEditarAtual();
    const html = this.L.limparHtml(this.atual.notas || '');
    if (!ed) return `<div class="reu-rt reu-rt-leitura">${html || '<span class="hint">Sem notas.</span>'}</div>`;
    const b = (cmd, rotulo, dica, arg) => `<button type="button" class="reu-rt-btn" data-reu-cmd="${cmd}"${arg ? ` data-arg="${arg}"` : ''} title="${escapeAttr(dica)}" aria-label="${escapeAttr(dica)}">${rotulo}</button>`;
    const cores = [['#2a6a9a', 'Azul'], ['#d64545', 'Vermelho'], ['#1f8a5b', 'Verde'], ['#c77700', 'Laranja']];
    return `<div class="reu-rt-bar" role="toolbar" aria-label="Formatação do texto">
        ${b('bold', '<b>N</b>', 'Negrito (Ctrl+B)')}${b('italic', '<i>I</i>', 'Itálico (Ctrl+I)')}${b('underline', '<u>S</u>', 'Sublinhado (Ctrl+U)')}${b('strikeThrough', '<s>R</s>', 'Riscado')}
        <span class="reu-rt-sep"></span>
        ${b('tamanho-', 'A<small>−</small>', 'Diminuir o tamanho do texto')}${b('tamanho+', 'A<big>+</big>', 'Aumentar o tamanho do texto')}${b('titulo', 'T', 'Título (liga/desliga)')}
        <span class="reu-rt-sep"></span>
        ${b('insertUnorderedList', '• ≡', 'Lista com marcas')}${b('insertOrderedList', '1. ≡', 'Lista numerada')}
        <span class="reu-rt-sep"></span>
        ${cores.map(([c, n]) => `<button type="button" class="reu-rt-btn reu-rt-cor" data-reu-cmd="cor" data-arg="${c}" title="Cor do texto: ${n}" aria-label="Cor do texto: ${n}" style="--cor:${c}"></button>`).join('')}
        <span class="reu-rt-sep"></span>
        ${b('limpar', 'Tx', 'Limpar a formatação do texto selecionado')}
      </div>
      <div class="reu-rt" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Notas da reunião" data-reu-rt="notas" data-ph="O que foi dito e acordado…">${html}</div>`;
  },
  secPontos() {
    const r = this.atual, ed = this.podeEditarAtual(), d = ed ? '' : ' disabled';
    const nomes = [...new Set([...r.participantes.map(p => p.nome), ...App.recursosAtivos().map(x => x.nome)])];
    const linhas = r.pontos.map((p, i) => `<div class="reu-ponto${p.tipo === 'acao' && p.concluida ? ' reu-feita' : ''}">
        <select data-reu-lista="pontos" data-i="${i}" data-k="tipo"${d}><option value="decisao"${p.tipo === 'decisao' ? ' selected' : ''}>Decisão</option><option value="acao"${p.tipo === 'acao' ? ' selected' : ''}>Ação</option></select>
        <input type="text" class="reu-ponto-texto" data-reu-lista="pontos" data-i="${i}" data-k="texto" value="${escapeAttr(p.texto)}" placeholder="${p.tipo === 'decisao' ? 'O que ficou decidido' : 'O que há a fazer'}"${d}>
        ${p.tipo === 'acao' ? `<input type="text" list="reuNomes" data-reu-lista="pontos" data-i="${i}" data-k="responsavel" value="${escapeAttr(p.responsavel || '')}" placeholder="Responsável"${d}>
        <input type="date" data-reu-lista="pontos" data-i="${i}" data-k="prazo" value="${escapeAttr(p.prazo || '')}" title="Prazo"${d}>
        <label class="reu-presente" title="Ação concluída"><input type="checkbox" data-reu-lista="pontos" data-i="${i}" data-k="concluida"${p.concluida ? ' checked' : ''}${d}> feita</label>` : '<span class="reu-ponto-vazio"></span>'}
        ${ed ? `<button type="button" class="btn-icon" data-reu-acao="rem-ponto" data-i="${i}" title="Remover">✕</button>` : '<span></span>'}</div>`).join('');
    return `${linhas || '<p class="hint">Sem decisões nem ações registadas.</p>'}
      <datalist id="reuNomes">${nomes.map(n => `<option value="${escapeAttr(n)}">`).join('')}</datalist>
      ${ed ? `<div class="reu-add"><button type="button" class="btn btn-sm" data-reu-acao="add-ponto" data-tipo="decisao">+ Decisão</button><button type="button" class="btn btn-sm" data-reu-acao="add-ponto" data-tipo="acao">+ Ação</button></div>` : ''}`;
  },
  secFicheiros() {
    const r = this.atual, ed = this.podeEditarAtual(), d = ed ? '' : ' disabled';
    const linhas = r.ficheiros.map((f, i) => `<div class="reu-ficheiro">
        <input type="text" data-reu-lista="ficheiros" data-i="${i}" data-k="nome" value="${escapeAttr(f.nome)}" placeholder="Nome do documento"${d}>
        <input type="text" data-reu-lista="ficheiros" data-i="${i}" data-k="ligacao" value="${escapeAttr(f.ligacao)}" placeholder="Ligação https://… (OneDrive / SharePoint)"${d}>
        ${/^https?:\/\//i.test(f.ligacao || '') ? `<a class="btn btn-sm" href="${escapeAttr(f.ligacao)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '<span></span>'}
        ${ed ? `<button type="button" class="btn-icon" data-reu-acao="rem-ficheiro" data-i="${i}" title="Remover">✕</button>` : '<span></span>'}</div>`).join('');
    return `${linhas || '<p class="hint">Sem documentos. Guarda aqui a ligação para os ficheiros que estão no OneDrive ou SharePoint — a app não guarda os ficheiros.</p>'}
      ${ed ? '<div class="reu-add"><button type="button" class="btn btn-sm" data-reu-acao="add-ficheiro">+ Documento</button></div>' : ''}`;
  },
  secAta() {
    const r = this.atual, ed = this.podeEditarAtual();
    const emitida = r.ata_versao > 0
      ? `Ata <b>v${r.ata_versao}</b> emitida em ${escapeHtml(this.L.formatarDataHora(r.ata_emitida_em))}${r.ata_emitida_por ? ' por ' + escapeHtml(r.ata_emitida_por) : ''}.`
      : 'A ata ainda não foi emitida.';
    return `<p style="margin:0 0 8px">${emitida}</p>
      <div class="reu-add">
        ${ed ? `<button type="button" class="btn btn-primary" data-reu-acao="emitir-ata" title="Grava a reunião e descarrega a ata em Word">📄 Emitir ata (v${r.ata_versao + 1})</button>
        <button type="button" class="btn" data-reu-acao="rascunho-ata" title="Descarrega um rascunho em Word, sem emitir nem gravar">Rascunho (Word)</button>` : ''}
        ${r.ata_versao > 0 && r.id ? `<button type="button" class="btn" data-reu-acao="descarregar-ata" title="Gera de novo o Word com o conteúdo atual da reunião">Descarregar ata (Word)</button>` : ''}
      </div>
      <p class="hint">A ata é gerada com o que está escrito na reunião. Cada emissão dá um novo número de versão; guarda o Word onde guardas as restantes atas (SharePoint) — a app não o armazena.</p>`;
  },
  renderEditor() {
    const r = this.atual, ed = this.podeEditarAtual(), d = ed ? '' : ' disabled';
    const meta = r.id ? `Criada por ${escapeHtml(r.criado_por_nome || '—')} em ${escapeHtml(this.L.formatarDataHora(r.criado_em))}${r.atualizado_em && r.atualizado_em !== r.criado_em ? ` · última edição por ${escapeHtml(r.atualizado_por_nome || '—')} em ${escapeHtml(this.L.formatarDataHora(r.atualizado_em))}` : ''}` : 'Reunião nova (ainda não gravada).';
    const secao = (id, titulo, html) => `<div class="card reu-card"><h4 class="crm-h">${titulo}</h4><div id="${id}">${html}</div></div>`;
    this.corpo().innerHTML = `<div class="reu-topo">
        <button type="button" class="btn btn-sm" data-reu-acao="voltar">← Reuniões</button>
        <b class="reu-topo-titulo">${r.id ? 'Reunião' : 'Nova reunião'}</b>
        ${ed ? '' : '<span class="hint">Só podes ler esta reunião (não és quem a criou nem gere o projeto).</span>'}
        <span class="crm-barra-fim">${ed ? '<button type="button" class="btn btn-primary" data-reu-acao="guardar">Guardar</button>' : ''}
          ${ed && r.id ? '<button type="button" class="btn btn-danger" data-reu-acao="eliminar">Eliminar</button>' : ''}</span>
      </div>
      <p class="hint" style="margin:0 0 10px">${meta}</p>
      ${secao('reuSecId', 'Identificação', this.secIdentificacao())}
      ${secao('reuSecPart', 'Participantes', this.secParticipantes())}
      <div class="card reu-card"><h4 class="crm-h">Ordem de trabalhos e notas</h4>
        <label>Ordem de trabalhos <textarea data-reu-f="ordem_trabalhos" rows="3" placeholder="Um ponto por linha"${d}>${escapeHtml(r.ordem_trabalhos)}</textarea></label>
        <div class="reu-rt-campo"><span class="reu-rt-rotulo">Notas / assuntos tratados</span>${this.editorNotas()}</div></div>
      ${secao('reuSecPontos', 'Decisões e ações', this.secPontos())}
      ${secao('reuSecFich', 'Documentos', this.secFicheiros())}
      ${secao('reuSecAta', 'Ata', this.secAta())}`;
    this.ligar(this.corpo());
  },
  // Volta a desenhar só uma secção (para não perder o foco dos campos das outras).
  // (Os eventos são delegados no contentor principal — ver ligar() —, por isso não há nada a religar.)
  renderSecao(id, fn) { const el = document.getElementById(id); if (el) el.innerHTML = fn.call(this); },

  // ============================ Eventos ============================
  _ligado: new WeakSet(),
  ligar(raiz) {
    if (this._ligado.has(raiz)) return; // delegação: um só conjunto de ouvintes por contentor
    this._ligado.add(raiz);
    raiz.addEventListener('mousedown', ev => { if (ev.target.closest('[data-reu-cmd]')) ev.preventDefault(); }); // não tirar a seleção ao texto
    raiz.addEventListener('paste', ev => this.aoColar(ev));
    raiz.addEventListener('drop', ev => { if (ev.target.closest && ev.target.closest('[data-reu-rt]') && ev.dataTransfer && ev.dataTransfer.files.length) ev.preventDefault(); });
    raiz.addEventListener('click', ev => {
      const cmd = ev.target.closest('[data-reu-cmd]');
      if (cmd && raiz.contains(cmd)) { ev.preventDefault(); this.comandoRt(cmd.dataset.reuCmd, cmd.dataset.arg); return; }
      const el = ev.target.closest('[data-reu-acao]');
      if (el && raiz.contains(el)) { ev.preventDefault(); this.acao(el.dataset.reuAcao, el); }
    });
    raiz.addEventListener('input', ev => this.aoEditar(ev, false));
    raiz.addEventListener('change', ev => this.aoEditar(ev, true));
  },
  aoEditar(ev, mudou) {
    const t = ev.target;
    if (t.dataset.reuFiltro !== undefined) {
      if (t.tagName === 'INPUT' && ev.type === 'change') return; // o texto filtra a escrever
      this.filtros[t.dataset.reuFiltro] = t.value;
      const pos = t.selectionStart;
      this.renderLista();
      const novo = this.corpo().querySelector(`[data-reu-filtro="${t.dataset.reuFiltro}"]`);
      if (novo && t.tagName === 'INPUT') { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) { /* tipo sem seleção */ } }
      return;
    }
    if (!this.atual || !this.podeEditarAtual()) return;
    const r = this.atual;
    if (t.dataset.reuRt !== undefined) { this.sincronizarRt(t); return; }
    if (t.dataset.reuF) this.editarCampo(t.dataset.reuF, t, mudou);
    else if (t.dataset.reuLista) {
      const item = r[t.dataset.reuLista][Number(t.dataset.i)];
      if (!item) return;
      const k = t.dataset.k;
      item[k] = t.type === 'checkbox' ? t.checked : (t.type === 'date' ? (t.value || null) : t.value);
      if (mudou && t.dataset.reuLista === 'pontos') {
        if (k === 'responsavel') { const col = App.state.recursos.find(x => this.L.norm(x.nome) === this.L.norm(item.responsavel)); item.responsavel_recurso_id = col ? col.id : null; }
        if (k === 'tipo' || k === 'concluida') this.renderSecao('reuSecPontos', this.secPontos);
      }
    }
  },
  // Passa o conteúdo da área editável para a reunião em edição (já limpo).
  sincronizarRt(el) { if (this.atual) this.atual[el.dataset.reuRt] = this.L.limparHtml(el.innerHTML); },
  // Botões da barra de formatação (execCommand é antigo, mas funciona em todos os browsers e não exige bibliotecas).
  comandoRt(cmd, arg) {
    const ed = this.corpo() && this.corpo().querySelector('[data-reu-rt]');
    if (!ed || !this.podeEditarAtual()) return;
    ed.focus();
    document.execCommand('styleWithCSS', false, false); // <b>/<font> em vez de style="…", que a limpeza descartaria
    if (cmd === 'tamanho+' || cmd === 'tamanho-') {
      const atual = parseInt(document.queryCommandValue('fontSize'), 10) || 3;
      document.execCommand('fontSize', false, String(Math.max(1, Math.min(7, atual + (cmd === 'tamanho+' ? 1 : -1)))));
    } else if (cmd === 'titulo') {
      document.execCommand('formatBlock', false, String(document.queryCommandValue('formatBlock')).toLowerCase() === 'h3' ? '<div>' : '<h3>');
    } else if (cmd === 'cor') document.execCommand('foreColor', false, arg);
    else if (cmd === 'limpar') { document.execCommand('removeFormat'); if (String(document.queryCommandValue('formatBlock')).toLowerCase() === 'h3') document.execCommand('formatBlock', false, '<div>'); }
    else document.execCommand(cmd);
    this.sincronizarRt(ed);
  },
  // Colar: aceita a estrutura (negrito, listas…) mas não o resto (estilos, imagens, ligações do Word/Outlook/sites).
  aoColar(ev) {
    const ed = ev.target.closest && ev.target.closest('[data-reu-rt]');
    if (!ed) return;
    ev.preventDefault();
    if (!this.atual || !this.podeEditarAtual()) return;
    const cd = ev.clipboardData;
    const html = cd.getData('text/html'), txt = cd.getData('text/plain');
    const limpo = (html && this.L.limparHtml(html)) || this.L.textoParaHtml(txt) || escapeHtml(txt);
    document.execCommand('insertHTML', false, limpo);
    this.sincronizarRt(ed);
  },
  editarCampo(campo, t, mudou) {
    const r = this.atual;
    if (campo === 'data_hora') { const iso = this.L.deInputLocal(t.value); if (iso) r.data_hora = iso; return; }
    if (campo === 'duracao_min') { r.duracao_min = t.value === '' ? null : Number(t.value); return; }
    if (!mudou && t.tagName === 'SELECT') return;
    if (campo === 'projeto_id') return this.escolherProjeto(t.value);
    if (campo === 'conta_id') return this.escolherConta(t.value);
    if (campo === 'oportunidade_id') return this.escolherOportunidade(t.value);
    r[campo] = t.value;
  },
  // Escolher projeto/conta/oportunidade preenche o cliente quando está vazio (ou ainda é o nome da escolha anterior).
  _clienteAutomatico(novoNome, anteriorNome) {
    const r = this.atual;
    const atual = String(r.cliente || '').trim();
    if (novoNome && (!atual || atual === String(anteriorNome || '').trim())) r.cliente = novoNome;
  },
  escolherProjeto(id) {
    const r = this.atual, p = id ? App.state.projetos[id] : null;
    const anterior = r.projeto_id ? (App.state.projetos[r.projeto_id] || {}).cliente : '';
    r.projeto_id = p ? p.id : null;
    r.projeto_nome = p ? App.rotuloProjetoCompleto(p) : '';
    if (p) this._clienteAutomatico(p.cliente, anterior);
    this.renderSecao('reuSecId', this.secIdentificacao);
    this.renderSecao('reuSecPart', this.secParticipantes);
  },
  escolherConta(id) {
    const r = this.atual, c = id && Crm.idx.conta ? Crm.idx.conta.get(id) : null;
    const anterior = r.conta_id && Crm.idx.conta && Crm.idx.conta.get(r.conta_id) ? Crm.idx.conta.get(r.conta_id).nome : '';
    r.conta_id = c ? c.id : null;
    if (c) this._clienteAutomatico(c.nome, anterior);
    // uma oportunidade de outra conta já não faz sentido
    if (r.oportunidade_id) { const o = Crm.idx.op && Crm.idx.op.get(r.oportunidade_id); if (o && c && o.conta_id !== c.id) { r.oportunidade_id = null; r.oportunidade_titulo = ''; } }
    this.renderSecao('reuSecId', this.secIdentificacao);
    this.renderSecao('reuSecPart', this.secParticipantes);
  },
  escolherOportunidade(id) {
    const r = this.atual, o = id && Crm.idx.op ? Crm.idx.op.get(id) : null;
    r.oportunidade_id = o ? o.id : null;
    r.oportunidade_titulo = o ? o.titulo : '';
    if (o) {
      const c = Crm.idx.conta && Crm.idx.conta.get(o.conta_id);
      const anterior = r.conta_id && Crm.idx.conta && Crm.idx.conta.get(r.conta_id) ? Crm.idx.conta.get(r.conta_id).nome : '';
      r.conta_id = o.conta_id || null;
      if (c) this._clienteAutomatico(c.nome, anterior);
      if (o.projeto_id && !r.projeto_id && App.state.projetos[o.projeto_id] && App.possoVerProjeto(o.projeto_id)) { r.projeto_id = o.projeto_id; r.projeto_nome = App.rotuloProjetoCompleto(App.state.projetos[o.projeto_id]); }
    }
    this.renderSecao('reuSecId', this.secIdentificacao);
    this.renderSecao('reuSecPart', this.secParticipantes);
  },

  acao(nome, el) {
    const r = this.atual;
    const i = Number(el.dataset.i);
    switch (nome) {
      case 'nova': return this.nova(this.filtros.projeto ? { projetoId: this.filtros.projeto } : undefined); // com o filtro de projeto ligado, nasce nesse projeto
      case 'abrir': return this.abrir(el.dataset.id);
      case 'recarregar': return this.carregar(true).then(() => this.renderTudo());
      case 'voltar': return this.voltar();
      case 'guardar': return this.guardarComAviso();
      case 'eliminar': return this.eliminar();
      case 'emitir-ata': return this.emitirAta();
      case 'rascunho-ata': return this.descarregarAta({ rascunho: true });
      case 'descarregar-ata': return this.descarregarAta({});
      case 'add-participante': {
        const v = (document.getElementById('reuPartSel') || {}).value || '';
        if (!v) { App.toast('Escolhe primeiro uma pessoa na lista.'); return; }
        const [tipo, id] = v.split(':');
        this.adicionarConhecido(tipo, id);
        return this.renderSecao('reuSecPart', this.secParticipantes);
      }
      case 'add-equipa': {
        const proj = r.projeto_id ? App.state.projetos[r.projeto_id] : null;
        if (proj) App.consultoresDoProjeto(proj).forEach(x => this.adicionarConhecido('recurso', x.id));
        return this.renderSecao('reuSecPart', this.secParticipantes);
      }
      case 'add-externo': {
        const val = id => (document.getElementById(id) || {}).value || '';
        const nomeExt = val('reuExtNome').trim();
        if (!nomeExt) { App.toast('Escreve o nome da pessoa externa.'); return; }
        if (!this.L.adicionarParticipante(r.participantes, { tipo: 'externo', nome: nomeExt, organizacao: val('reuExtOrg').trim(), cargo: val('reuExtCargo').trim(), email: val('reuExtEmail').trim() })) App.toast('Essa pessoa já está na lista.');
        return this.renderSecao('reuSecPart', this.secParticipantes);
      }
      case 'rem-participante': r.participantes.splice(i, 1); return this.renderSecao('reuSecPart', this.secParticipantes);
      case 'add-ponto': r.pontos.push(this.L.novoPonto(el.dataset.tipo)); this.renderSecao('reuSecPontos', this.secPontos); { const f = document.querySelectorAll('#reuSecPontos .reu-ponto-texto'); if (f.length) f[f.length - 1].focus(); } return;
      case 'rem-ponto': r.pontos.splice(i, 1); return this.renderSecao('reuSecPontos', this.secPontos);
      case 'add-ficheiro': r.ficheiros.push({ id: this.L.novoId(), nome: '', ligacao: '' }); this.renderSecao('reuSecFich', this.secFicheiros); { const f = document.querySelectorAll('#reuSecFich input'); if (f.length >= 2) f[f.length - 2].focus(); } return;
      case 'rem-ficheiro': r.ficheiros.splice(i, 1); return this.renderSecao('reuSecFich', this.secFicheiros);
    }
  },
  adicionarConhecido(tipo, id) {
    const r = this.atual;
    let p;
    if (tipo === 'recurso') { const x = App.state.recursos.find(y => y.id === id); if (x) p = { tipo: 'recurso', ref_id: x.id, nome: x.nome, organizacao: 'CITEVE', cargo: x.papel || '', email: x.email || '' }; }
    else if (tipo === 'contacto') { const c = (Crm.d.contactos || []).find(y => y.id === id); if (c) p = { tipo: 'contacto', ref_id: c.id, nome: c.nome, organizacao: r.cliente || '', cargo: c.cargo || '', email: c.email || '' }; }
    if (p) this.L.adicionarParticipante(r.participantes, p);
  },

  // ============================ Gravar ============================
  _payload(r) {
    return {
      titulo: r.titulo.trim(), data_hora: r.data_hora, duracao_min: r.duracao_min == null || r.duracao_min === '' ? null : Number(r.duracao_min),
      local: r.local || '', estado: r.estado, projeto_id: r.projeto_id || null, conta_id: r.conta_id || null, oportunidade_id: r.oportunidade_id || null,
      cliente: (r.cliente || '').trim(), projeto_nome: r.projeto_nome || '', oportunidade_titulo: r.oportunidade_titulo || '',
      ordem_trabalhos: r.ordem_trabalhos || '', notas: this.L.limparHtml(r.notas || ''),
      participantes: r.participantes, ficheiros: r.ficheiros.map(f => ({ id: f.id, nome: (f.nome || '').trim(), ligacao: (f.ligacao || '').trim() })), pontos: r.pontos
    };
  },
  // Grava a reunião aberta (insert ou update com a versão que foi aberta). "extra": campos a gravar na mesma operação (ata).
  async guardar(extra) {
    const r = this.atual;
    const erros = this.L.validar(r);
    if (erros.length) throw new Error(erros[0]);
    const agora = new Date().toISOString(), nome = this.meuNome();
    let data;
    if (!r.id) {
      const linha = Object.assign(this._payload(r), { criado_por_user: App.usuarioAtualId || null, criado_por_nome: nome, atualizado_por_nome: nome, versao: 1 }, extra || {});
      const res = await supabaseClient.from('reunioes').insert(linha).select().single();
      if (res.error) throw res.error;
      data = res.data;
    } else {
      const linha = Object.assign(this._payload(r), { versao: r.versao + 1, atualizado_em: agora, atualizado_por_nome: nome }, extra || {});
      const res = await supabaseClient.from('reunioes').update(linha).eq('id', r.id).eq('versao', r.versao).select();
      if (res.error) throw res.error;
      if (!res.data || res.data.length !== 1) throw new Error('Esta reunião foi alterada por outra pessoa (ou eliminada) desde que a abriste. Copia o que escreveste, volta à lista e abre-a de novo — assim não se perde o trabalho de ninguém.');
      data = res.data[0];
    }
    const gravada = this.L.normalizar(data);
    const k = this.lista.findIndex(x => x.id === gravada.id);
    if (k >= 0) this.lista[k] = gravada; else this.lista.push(gravada);
    this.atual = this.clonar(gravada);
    this.original = JSON.stringify(this.atual);
    return gravada;
  },
  // Executa uma operação de rede uma de cada vez (evita cliques duplos) e mostra o erro sem perder o que está escrito.
  async _executar(fn) {
    if (this._aGuardar) return false;
    this._aGuardar = true;
    document.querySelectorAll('#reunioesCorpo button[data-reu-acao]').forEach(b => { b.disabled = true; });
    try { await fn(); return true; }
    catch (err) { App.toast(err.message || String(err)); return false; }
    finally { this._aGuardar = false; if (this.atual && this.corpo()) this.renderEditor(); }
  },
  guardarComAviso() {
    return this._executar(async () => { await this.guardar(); App.toast('Reunião guardada.'); });
  },
  async eliminar() {
    const r = this.atual;
    if (!r || !r.id) return;
    const aviso = r.ata_versao > 0 ? `\n\nJá foi emitida a ata v${r.ata_versao}: guarda o Word antes de eliminar.` : '';
    if (!confirm(`Eliminar a reunião "${r.titulo}"? Não dá para desfazer.${aviso}`)) return;
    await this._executar(async () => {
      const { error } = await supabaseClient.from('reunioes').delete().eq('id', r.id);
      if (error) throw error;
      this.lista = this.lista.filter(x => x.id !== r.id);
      this.atual = null; this.original = '';
      App.toast('Reunião eliminada.');
    });
    this.renderTudo();
  },

  // ============================ Ata ============================
  async _blobAta(reuniao, meta) {
    return ReunioesAta.gerar(reuniao, meta, JSZip, 'blob');
  },
  // Rascunho (sem emitir, com o que está no ecrã) ou a última ata emitida (com o conteúdo atual).
  async descarregarAta({ rascunho }) {
    const r = this.atual;
    if (rascunho) {
      const erros = this.L.validar(r);
      if (erros.length) { App.toast(erros[0]); return; }
    }
    try {
      const meta = rascunho ? { rascunho: true } : { versao: r.ata_versao, emitidaEm: r.ata_emitida_em, emitidaPor: r.ata_emitida_por };
      const blob = await this._blobAta(r, meta);
      const nome = rascunho ? this.L.nomeFicheiroAta(r, 1).replace(/_v1\.docx$/, '_rascunho.docx') : this.L.nomeFicheiroAta(r, r.ata_versao);
      App.descarregarBlob(blob, nome);
    } catch (err) { App.toast('Não foi possível gerar o Word: ' + (err.message || err)); }
  },
  async emitirAta() {
    const r = this.atual;
    if (!this.podeEditarAtual()) return;
    const erros = this.L.validar(r);
    if (erros.length) { App.toast(erros[0]); return; }
    const versao = r.ata_versao + 1;
    if (!confirm(`Emitir a ata (versão ${versao})? A reunião é gravada e o Word é descarregado.${r.estado === 'agendada' ? '\n\nA reunião ainda está como "Agendada" — passa-a para "Realizada"?' : ''}`)) return;
    if (r.estado === 'agendada' && confirm('Marcar a reunião como "Realizada"?')) r.estado = 'realizada';
    let gravada = null;
    const ok = await this._executar(async () => {
      gravada = await this.guardar({ ata_versao: versao, ata_emitida_em: new Date().toISOString(), ata_emitida_por: this.meuNome() });
      const blob = await this._blobAta(gravada, { versao, emitidaEm: gravada.ata_emitida_em, emitidaPor: gravada.ata_emitida_por });
      App.descarregarBlob(blob, this.L.nomeFicheiroAta(gravada, versao));
    });
    if (ok) App.toast(`Ata v${versao} emitida — guarda o Word onde arquivas as atas.`);
  }
};

// Aviso do browser ao fechar/recarregar a página com uma reunião por guardar.
window.addEventListener('beforeunload', (ev) => {
  if (Reunioes.sujo()) { ev.preventDefault(); ev.returnValue = ''; }
});

// Horas → orcprev: o que já foi carregado, por pessoa e por semana (separador Horas → Orcprev).
// Cada pessoa vê as suas semanas; quem lidera uma equipa vê também as da sua equipa; o Administrador vê todas.
// Os "envios" (supabase/orcprev_registo.sql) nascem quando se copia uma semana no Gestor e ficam confirmados quando o
// importador, dentro do orcprev, grava e avisa. As regras (o que conta como carregado) estão em OrcprevLogica.estadoSemana.
// Como as Licenças/Reuniões, fala diretamente com a sua tabela, só quando se abre o separador (ou a modal da semana).
const OrcprevEstado = {
  envios: [],
  carregado: false,
  semTabela: false,
  erro: null,
  _aCarregar: null,
  cfg: null,          // { ativo, hora, desde } do lembrete de sexta-feira (só o Administrador o vê/edita)
  semCfg: false,
  vista: 'eu',        // 'eu' | 'equipa' | 'todos'
  SEMANAS: 8,
  L: OrcprevLogica,

  corpo() { return document.getElementById('orcprevEstadoCorpo'); },
  meuRecurso() { const p = App.perfilAtual(); return p && p.recursoId ? App.state.recursos.find(r => r.id === p.recursoId) || null : null; },
  // Disponível enquanto a tabela existir (ou ainda não se soube); depois de um erro "sem tabela" o Gestor funciona como antes.
  disponivel() { return !this.semTabela; },
  limpar() { this.envios = []; this.carregado = false; this.semTabela = false; this.erro = null; this._aCarregar = null; this.cfg = null; },

  // ---------- Leitura ----------
  _mapear(l) {
    return { id: l.id, recursoId: l.recurso_id, semanaInicio: l.semana_inicio, criadoEm: l.criado_em, confirmadoEm: l.confirmado_em, dias: l.dias || {}, origem: l.origem, horasEnviadas: Number(l.horas_enviadas) || 0 };
  },
  carregar(forcar) {
    if (this._aCarregar) return this._aCarregar;
    if (this.carregado && !forcar) return Promise.resolve();
    // Só as últimas semanas (o controlo nunca olha mais para trás do que SEMANAS + folga).
    const desde = this.L.somarDias(this.L.segundaDaSemana(DateUtil.todayISO()), -7 * (this.SEMANAS + 4));
    this._aCarregar = (async () => {
      try {
        const colunas = 'id,recurso_id,semana_inicio,criado_em,confirmado_em,dias,origem,horas_enviadas';
        let todas = [];
        for (let de = 0; ; de += 1000) {
          const { data, error } = await supabaseClient.from('orcprev_envios').select(colunas).gte('semana_inicio', desde).order('criado_em').range(de, de + 999);
          if (error) throw error;
          todas = todas.concat(data || []);
          if (!data || data.length < 1000) break;
        }
        this.envios = todas.map(l => this._mapear(l));
        this.carregado = true; this.semTabela = false; this.erro = null;
      } catch (err) {
        const msg = String((err && err.message) || err);
        if ((err && (err.code === '42P01' || err.code === 'PGRST205')) || /orcprev_envios/.test(msg)) this.semTabela = true;
        else this.erro = msg;
      } finally { this._aCarregar = null; }
    })();
    return this._aCarregar;
  },
  async carregarCfg() {
    try {
      const { data, error } = await supabaseClient.from('configuracoes').select('lembrete_orcprev_ativo,lembrete_orcprev_hora,orcprev_controlo_desde').eq('id', 1).maybeSingle();
      if (error) throw error;
      this.cfg = { ativo: !!(data && data.lembrete_orcprev_ativo), hora: (data && data.lembrete_orcprev_hora) || '09:00', desde: (data && data.orcprev_controlo_desde) || '' };
      this.semCfg = false;
    } catch (e) { this.semCfg = true; }
  },
  // Chamado ao entrar na app: carrega em fundo (para saber se a tabela existe) e trata do link "#orcprev=AAAA-MM-DD" do email de sexta-feira.
  async aoEntrar() {
    await this.carregar();
    await this.carregarCfg();
    const m = /[#&]orcprev=(\d{4}-\d{2}-\d{2})/.exec(location.hash || '');
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignora */ }
    const eu = this.meuRecurso();
    if (!eu) return;
    App.diaRegistoPessoa = eu.nome;
    App.abrirModalOrcprev(m[1]);
  },

  // ---------- Escrita (funções da base de dados — ver supabase/orcprev_registo.sql) ----------
  // Cria o envio da MINHA pessoa e devolve { id, token }; null se não for possível (a cópia segue sem registo).
  async novoEnvio(semana, horasGestor) {
    if (!this.disponivel()) return null;
    try {
      const { data, error } = await supabaseClient.rpc('orcprev_novo_envio', { p_semana_inicio: semana.inicio, p_semana_fim: semana.fim, p_horas_gestor: horasGestor });
      if (error) throw error;
      this.carregado = false; // a próxima leitura traz também esta cópia
      return data && data.token ? data : null;
    } catch (e) { return null; }
  },
  async marcarManual(inicio, fim, dias) {
    const { error } = await supabaseClient.rpc('orcprev_marcar_manual', { p_semana_inicio: inicio, p_semana_fim: fim, p_dias: dias });
    if (error) throw error;
    await this.carregar(true);
  },
  registoParaPacote(envio) {
    return envio && envio.token ? { url: SUPABASE_URL, chave: SUPABASE_ANON_KEY, token: envio.token } : null;
  },

  // ---------- Quem se vê ----------
  pessoasVisiveis() {
    const eu = this.meuRecurso();
    const ativas = r => !App.recursoInativo(r);
    let lista;
    if (App.souAdmin() && this.vista === 'todos') lista = App.state.recursos.filter(ativas);
    else if (this.vista === 'equipa') lista = App.recursosDaMinhaLideranca().filter(ativas);
    else lista = [];
    if (eu && !lista.some(r => r.id === eu.id)) lista.unshift(eu);
    return lista.sort((a, b) => (eu && a.id === eu.id ? -1 : eu && b.id === eu.id ? 1 : 0) || a.nome.localeCompare(b.nome, 'pt'));
  },
  podeVerEquipa() { return App.souAdmin() || App.souLiderDeAlgumaEquipa(); },

  // ---------- Estado ----------
  desde() { return this.cfg && this.cfg.desde ? this.cfg.desde : null; },
  semanas() { return this.L.semanasDoControlo({ hojeISO: DateUtil.todayISO(), desdeISO: this.desde(), max: this.SEMANAS }); },
  registosDe(recurso) { return App.state.registos.filter(r => r.pessoa === recurso.nome && App.possoVerRegisto(r)); },
  // Estado de uma semana de uma pessoa (com os registos que o Gestor tem hoje).
  estadoDe(recurso, inicio, registos) {
    const ini = this.L.segundaDaSemana(inicio);
    const horasDia = this.L.horasEnviaveisPorDia(registos || this.registosDe(recurso), id => App.state.tiposTrabalho.find(tt => tt.id === id), ini, this.L.somarDias(ini, 6));
    const envios = this.envios.filter(e => e.recursoId === recurso.id && e.semanaInicio === ini);
    return this.L.estadoSemana({ inicio: ini, horasDia, envios, desdeISO: this.desde() });
  },

  // ---------- Ecrã ----------
  fmtH(n) { return String(Math.round(n * 100) / 100).replace('.', ','); },
  fmtDia(iso) { const [, m, d] = iso.split('-'); return `${d}/${m}`; },
  async aoAbrir() {
    const c = this.corpo();
    if (!c) return;
    if (!this.carregado) c.innerHTML = '<p class="hint">A carregar…</p>';
    await Promise.all([this.carregar(true), this.cfg ? Promise.resolve() : this.carregarCfg()]);
    this.render();
  },
  celula(estado, ehMinha) {
    const dias = estado.diasEmFalta.map(d => this.fmtDia(d)).join(', ');
    const base = 'display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;';
    if (estado.estado === 'vazia') return '<span class="hint">—</span>';
    if (estado.estado === 'carregada') return `<span style="${base}background:#dcfce7;color:#166534;" title="${escapeAttr(estado.manual ? 'Marcada como lançada à mão' : 'Carregada no orcprev')}${estado.carregadoEm ? ' · ' + escapeAttr(String(estado.carregadoEm).slice(0, 10)) : ''}">✔ ${this.fmtH(estado.totalGestor)} h${estado.manual ? ' (à mão)' : ''}</span>`;
    const alterada = estado.estado === 'alterada';
    return `<span style="${base}background:${alterada ? '#ffedd5' : '#fee2e2'};color:${alterada ? '#9a3412' : '#991b1b'};" title="${escapeAttr((alterada ? 'Mudou depois de carregada. ' : '') + 'Por carregar: ' + dias)}">${alterada ? '⚠' : '⏳'} ${this.fmtH(estado.totalGestor - estado.totalCarregado)} h por carregar</span>${estado.copiada ? '<div class="hint" style="font-size:10.5px;">copiada, por confirmar</div>' : ''}`;
  },
  render() {
    const c = this.corpo();
    if (!c) return;
    if (this.semTabela) { c.innerHTML = '<div class="card"><p><b>O registo do orcprev ainda não está instalado.</b></p><p class="hint">Falta correr o ficheiro <code>supabase/orcprev_registo.sql</code> no SQL Editor do Supabase (só cria coisas novas) e recarregar a página.</p></div>'; return; }
    if (this.erro && !this.carregado) { c.innerHTML = `<div class="card"><p>Não foi possível carregar: ${escapeHtml(this.erro)}</p><p><button type="button" class="btn" data-orcest="recarregar">Tentar de novo</button></p></div>`; this.ligar(c); return; }
    const bAbrir = document.getElementById('btnOrcprevEstadoAbrir');
    if (bAbrir && !bAbrir._ligado) {
      bAbrir._ligado = true;
      bAbrir.addEventListener('click', () => { const eu = this.meuRecurso(); if (!eu) { App.toast('Esta conta não está ligada a uma pessoa em Pessoas.'); return; } App.diaRegistoPessoa = eu.nome; App.abrirModalOrcprev(DateUtil.todayISO()); });
    }
    if (!this.podeVerEquipa()) this.vista = 'eu';
    if (this.vista === 'todos' && !App.souAdmin()) this.vista = 'equipa';
    const eu = this.meuRecurso();
    const semanas = this.semanas();
    const pessoas = this.pessoasVisiveis();
    const linhas = pessoas.map(r => {
      const registos = this.registosDe(r);
      const estados = semanas.map(ini => this.estadoDe(r, ini, registos));
      const emFalta = estados.reduce((s, e) => s + e.diasEmFalta.length, 0);
      return { r, estados, emFalta };
    });
    const meus = linhas.find(l => eu && l.r.id === eu.id);
    const resumoMeu = !eu ? '<p class="hint">Esta conta não está ligada a uma pessoa em Pessoas.</p>' : (meus && meus.emFalta
      ? `<div class="card" style="border-left:4px solid var(--vermelho);"><b>Tens ${meus.emFalta} dia(s) com horas por carregar no orcprev.</b> <span class="hint">Abre a semana, copia e importa no orcprev.</span></div>`
      : '<div class="card" style="border-left:4px solid var(--verde);"><b>Estás em dia:</b> tudo o que registaste no Gestor já foi carregado no orcprev.</div>');
    const seletor = this.podeVerEquipa() ? `<label style="display:inline-flex;gap:6px;align-items:center;">Ver <select data-orcest="vista"><option value="eu" ${this.vista === 'eu' ? 'selected' : ''}>Só eu</option><option value="equipa" ${this.vista === 'equipa' ? 'selected' : ''}>A minha equipa</option>${App.souAdmin() ? `<option value="todos" ${this.vista === 'todos' ? 'selected' : ''}>Toda a gente</option>` : ''}</select></label>` : '';
    const cab = semanas.map(ini => `<th style="text-align:center;white-space:nowrap;">${this.fmtDia(ini)}<div class="hint" style="font-weight:400;">a ${this.fmtDia(this.L.somarDias(ini, 6))}</div></th>`).join('');
    const corpoTab = linhas.map(l => {
      const minha = eu && l.r.id === eu.id;
      return `<tr><td><b>${escapeHtml(l.r.nome)}</b>${minha ? ' <span class="hint">(eu)</span>' : ''}${l.emFalta ? `<div class="hint" style="color:var(--vermelho);">${l.emFalta} dia(s) por carregar</div>` : ''}</td>${l.estados.map(e => `<td style="text-align:center;">${this.celula(e, minha)}${minha && e.estado !== 'vazia' && e.estado !== 'carregada' ? `<div><button type="button" class="btn btn-sm" data-orcest="abrir" data-sem="${e.inicio}" style="margin-top:3px;">Abrir cópia</button></div>` : ''}</td>`).join('')}</tr>`;
    }).join('');
    c.innerHTML = `${resumoMeu}
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0;">${seletor}<span class="hint">Mostra as últimas ${semanas.length} semana(s)${this.desde() ? ` (a contar desde ${this.fmtDia(this.desde())}/${this.desde().slice(0, 4)})` : ''}. "Por carregar" = horas registadas no Gestor que ainda não foram importadas no orcprev.</span></div>
      <div class="table-scroll"><table class="tabela-crud"><thead><tr><th>Pessoa</th>${cab}</tr></thead><tbody>${corpoTab || '<tr><td class="hint" colspan="9">Sem pessoas para mostrar.</td></tr>'}</tbody></table></div>
      ${this.htmlConfig()}`;
    this.ligar(c);
  },
  htmlConfig() {
    if (!App.souAdmin() || this.semCfg || !this.cfg) return '';
    const k = this.cfg;
    return `<div class="card" style="margin-top:14px;"><b>Lembrete de sexta-feira</b>
      <p class="hint" style="margin:4px 0 8px;">À sexta-feira, cada pessoa recebe por email as datas com horas por carregar no orcprev, com um link direto para a cópia da semana. Só segue para quem tem conta e não desligou os lembretes (e, em modo piloto, para as pessoas marcadas). A função <code>lembrete-orcprev</code> e o seu agendamento instalam-se à parte (ver LEIAME).</p>
      <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap;">
        <label style="flex-direction:row;align-items:center;gap:6px;"><input type="checkbox" data-orcest-cfg="ativo" ${k.ativo ? 'checked' : ''}> Enviar à sexta-feira</label>
        <label>Hora <input type="time" data-orcest-cfg="hora" value="${escapeAttr(k.hora)}"></label>
        <label>Contar a partir de <input type="date" data-orcest-cfg="desde" value="${escapeAttr(k.desde)}"></label>
        <button type="button" class="btn btn-primary btn-sm" data-orcest="guardar-cfg">Guardar</button>
        <span class="hint" data-orcest-msg></span>
      </div>
      <p class="hint" style="margin:6px 0 0;">"Contar a partir de": antes desta data nada é considerado por carregar (útil para não avisar do que foi lançado à mão no passado). Em branco = só as últimas ${this.SEMANAS} semanas.</p></div>`;
  },
  ligar(c) {
    c.querySelectorAll('[data-orcest]').forEach(el => {
      const acao = el.dataset.orcest;
      if (acao === 'vista') el.addEventListener('change', () => { this.vista = el.value; this.render(); });
      else if (acao === 'recarregar') el.addEventListener('click', () => this.aoAbrir());
      else if (acao === 'abrir') el.addEventListener('click', () => { const eu = this.meuRecurso(); if (eu) { App.diaRegistoPessoa = eu.nome; App.abrirModalOrcprev(el.dataset.sem); } });
      else if (acao === 'guardar-cfg') el.addEventListener('click', () => this.guardarCfg(c));
    });
  },
  async guardarCfg(c) {
    const v = n => c.querySelector(`[data-orcest-cfg="${n}"]`);
    const msg = c.querySelector('[data-orcest-msg]');
    const novo = { ativo: v('ativo').checked, hora: v('hora').value || '09:00', desde: v('desde').value || '' };
    if (novo.desde && !App.anoDataPlausivel(novo.desde)) { msg.style.color = 'var(--vermelho)'; msg.textContent = 'Data inválida.'; return; }
    msg.style.color = ''; msg.textContent = 'A gravar…';
    const { error } = await supabaseClient.from('configuracoes').update({ lembrete_orcprev_ativo: novo.ativo, lembrete_orcprev_hora: novo.hora, orcprev_controlo_desde: novo.desde || null }).eq('id', 1);
    if (error) { msg.style.color = 'var(--vermelho)'; msg.textContent = 'Não foi possível gravar: ' + error.message; return; }
    this.cfg = novo;
    App.toast('Guardado.');
    this.render();
  }
};

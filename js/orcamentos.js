// Orçamentação (Propostas e Orçamentos): cada proposta do CRM tem vários orçamentos (versões/alternativas) e, quando a
// proposta é adjudicada, UM deles fica "validado" — é a base da faturação (Fase 2). Ecrã do orçamento = a "Folha de
// Orçamentação — DTD" (5 secções por área). Cálculos em js/orcamento-logica.js (testado); Excel em js/orcamento-export.js.
// Como o resto do CRM, fala diretamente com as tabelas crm_* (RLS: Administrador, Diretores e Team Leaders) e só quando
// alguém abre uma proposta; o valor/hora de cada consultor vem das Pessoas (preço de venda/custo) e fica COPIADO para a linha.
const Orc = {
  d: { resumos: [], carregado: false },
  PADRAO: { aluguer_saida: 45, custo_km: 0.16, validade_dias: 30, sharepoint_url: '' },
  parametros: null,
  indisponivel: null,
  atual: null,          // orçamento aberto no editor (objeto completo, com áreas e linhas)
  areaAtiva: null,
  sujo: false,
  proposta: null,

  // ============================ Dados ============================
  msgErro(err) {
    const msg = String((err && err.message) || err || '');
    if ((err && err.code === '42P01') || /does not exist|Could not find the (table|function)|schema cache/i.test(msg)) return 'A Orçamentação ainda não está instalada na base de dados (falta correr supabase/orcamentos_fase1.sql no Supabase).';
    if (err && err.code === '23505') return 'Esta proposta já tem um orçamento validado — só um pode ser o adjudicado.';
    if (/só um rascunho/i.test(msg)) return msg;
    return Crm.msgErro(err);
  },
  async carregarResumos(forcar) {
    if (this.d.carregado && !forcar) return;
    try {
      const { data, error } = await supabaseClient.from('crm_orcamentos').select('id,proposta_id,versao,titulo,estado,total,margem,validade_dias,criado_em,validado_em').order('versao');
      if (error) throw error;
      this.d.resumos = data || []; this.d.carregado = true; this.indisponivel = null;
    } catch (err) { this.indisponivel = this.msgErro(err); this.d.resumos = []; }
  },
  limpar() { this.d = { resumos: [], carregado: false }; this.parametros = null; this.atual = null; this.proposta = null; },
  async carregarParametros(forcar) {
    if (this.parametros && !forcar) return this.parametros;
    try {
      const { data, error } = await supabaseClient.from('crm_orc_parametros').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      this.parametros = Object.assign({}, this.PADRAO, data || {});
    } catch (err) { this.parametros = Object.assign({}, this.PADRAO); }
    return this.parametros;
  },
  async carregarCompleto(id) {
    const { data: o, error } = await supabaseClient.from('crm_orcamentos').select('*').eq('id', id).single();
    if (error) throw error;
    const { data: areas, error: e2 } = await supabaseClient.from('crm_orc_areas').select('*').eq('orcamento_id', id).order('ordem');
    if (e2) throw e2;
    let linhas = [];
    if ((areas || []).length) {
      const r = await supabaseClient.from('crm_orc_linhas').select('*').in('area_id', areas.map(a => a.id)).order('ordem');
      if (r.error) throw r.error;
      linhas = r.data || [];
    }
    return Object.assign({}, o, {
      areas: (areas || []).map(a => Object.assign({}, a, { linhas: linhas.filter(l => l.area_id === a.id).map(l => Object.assign({}, l, { dados: l.dados || {} })) }))
    });
  },
  // Payload do RPC (tudo ou nada). total/margem calculam-se aqui.
  payload(o) {
    const c = OrcLogica.calcOrcamento(o);
    return {
      id: o.id, proposta_id: o.proposta_id, versao: o.versao, titulo: o.titulo || '', validade_dias: o.validade_dias, aluguer_saida: o.aluguer_saida,
      custo_km: o.custo_km, total: OrcLogica.arred(c.total), margem: OrcLogica.arred(c.margem), notas: o.notas || '', criado_por: o.criado_por || null,
      areas: o.areas.map((a, i) => ({
        id: a.id, equipa_id: a.equipa_id || null, nome: a.nome || '', ordem: i, custos_especificos: OrcLogica.n(a.custos_especificos),
        linhas: (a.linhas || []).map((l, j) => ({ id: l.id, seccao: l.seccao, ordem: j, descricao: l.descricao || '', recurso_id: l.recurso_id || null, dados: l.dados || {} }))
      }))
    };
  },
  async gravarConteudo(o) {
    const { error } = await supabaseClient.rpc('crm_gravar_orcamento', { p: this.payload(o) });
    if (error) throw error;
    const c = OrcLogica.calcOrcamento(o);
    const r = { id: o.id, proposta_id: o.proposta_id, versao: o.versao, titulo: o.titulo, estado: o.estado, total: OrcLogica.arred(c.total), margem: OrcLogica.arred(c.margem), validade_dias: o.validade_dias, criado_em: o.criado_em };
    const i = this.d.resumos.findIndex(x => x.id === o.id);
    if (i >= 0) this.d.resumos[i] = Object.assign({}, this.d.resumos[i], r); else this.d.resumos.push(r);
  },
  resumosDaProposta(propostaId) { return this.d.resumos.filter(o => o.proposta_id === propostaId).sort((a, b) => a.versao - b.versao); },

  // ============================ Secção "Orçamentos" na ficha da proposta ============================
  async secOrcamentos(raiz, proposta) {
    raiz.innerHTML = Crm.vazioHtml('A carregar…');
    await this.carregarResumos(true);
    if (this.indisponivel) { raiz.innerHTML = `<p class="hint" style="color:var(--vermelho);">${escapeHtml(this.indisponivel)}</p>`; return; }
    const lista = this.resumosDaProposta(proposta.id);
    const validado = lista.find(o => o.estado === 'validado');
    raiz.innerHTML = `${lista.length ? `<div class="crm-lista">${lista.map(o => `<div class="crm-item crm-item-linha">
        <span class="crm-item-texto"><b>v${o.versao}</b>${o.titulo ? ' · ' + escapeHtml(o.titulo) : ''} <span class="crm-estado orc-estado-${o.estado}">${OrcLogica.ESTADOS[o.estado]}</span></span>
        <span class="hint">${OrcLogica.euro(o.total)}</span><button type="button" class="btn btn-sm" data-sec-acao="abrir" data-id="${escapeAttr(o.id)}">Abrir</button></div>`).join('')}</div>`
      : Crm.vazioHtml('Ainda não há orçamentos nesta proposta.')}
      ${validado ? `<p class="hint">✔ O orçamento v${validado.versao} (${OrcLogica.euro(validado.total)}) é o adjudicado — serve de base à faturação.</p>` : ''}
      <button type="button" class="btn btn-sm" data-sec-acao="novo">+ Novo orçamento</button>`;
    Crm.ligarAcoes(raiz, { abrir: b => this.abrir(b.dataset.id, proposta), novo: () => this.novo(proposta) });
  },

  // ============================ Orçamento validado -> projeto (Fase 2) ============================
  validadoDaOportunidade(opId) {
    const props = new Set(Crm.d.propostas.filter(p => p.oportunidade_id === opId).map(p => p.id));
    return this.d.resumos.find(o => props.has(o.proposta_id) && o.estado === 'validado') || null;
  },
  // Cópia que fica no projeto: total, horas e valor de cada rubrica do orçamento validado.
  async carregarBase(orcamentoId) {
    return OrcLogica.baseDoOrcamento(await this.carregarCompleto(orcamentoId));
  },

  // ============================ Criar / abrir ============================
  async novo(proposta) {
    try {
      const par = await this.carregarParametros();
      const versao = OrcLogica.proximaVersao(this.d.resumos, proposta.id);
      const meu = App.state.recursos.find(r => r.id === Crm.meuRecursoId());
      const equipa = meu && meu.equipaId ? App.state.equipas.find(e => e.id === meu.equipaId) : null;
      const o = {
        id: crypto.randomUUID(), proposta_id: proposta.id, versao, titulo: '', estado: 'rascunho', validade_dias: par.validade_dias,
        aluguer_saida: par.aluguer_saida, custo_km: par.custo_km, notas: '', criado_por: Crm.meuRecursoId(), areas: [], _novo: true
      };
      if (equipa) o.areas.push(this.areaNova(equipa, 0));
      this.mostrar(o, proposta, true);
    } catch (err) { App.toast(this.msgErro(err)); }
  },
  async abrir(id, proposta) {
    try {
      App.mostrarCarregamento('A abrir o orçamento…');
      const o = await this.carregarCompleto(id);
      this.mostrar(o, proposta, false);
    } catch (err) { App.toast(this.msgErro(err)); } finally { App.esconderCarregamento(); }
  },
  areaNova(equipa, ordem) {
    return { id: crypto.randomUUID(), equipa_id: equipa ? equipa.id : null, nome: equipa ? equipa.nome : '', ordem, custos_especificos: 0, linhas: [] };
  },
  linhaNova(seccao, area) {
    const l = { id: crypto.randomUUID(), seccao, ordem: 0, descricao: '', recurso_id: null, dados: OrcLogica.dadosNovos(seccao) };
    return l;
  },

  // ============================ Editor ============================
  mostrar(o, proposta, novo) {
    this.atual = o; this.proposta = proposta; this.sujo = !!novo; this.areaAtiva = (o.areas[0] || {}).id || null;
    Crm.abrir(`Orçamento v${o.versao}`, '<div id="orcEditor"></div>', true);
    App.els.modal.classList.add('modal-orc');   // o orçamento tem tabelas largas: usa quase todo o ecrã
    this.ligarEventos();
    this.render();
  },
  contexto() {
    const op = Crm.idx.op.get(this.proposta.oportunidade_id) || {};
    const conta = Crm.idx.conta.get(op.conta_id) || {};
    return { op, conta };
  },
  consultoresDe(area) {
    const todos = App.state.recursos.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const daEquipa = todos.filter(r => area.equipa_id && r.equipaId === area.equipa_id), outros = todos.filter(r => !daEquipa.includes(r));
    return { daEquipa, outros };
  },
  optConsultores(area, atualId) {
    const { daEquipa, outros } = this.consultoresDe(area);
    const opt = r => `<option value="${escapeAttr(r.id)}"${r.id === atualId ? ' selected' : ''}>${escapeHtml(r.nome)} (${OrcLogica.n(r.precoVenda)} €/h)</option>`;
    return `<option value="">—</option>${daEquipa.length ? `<optgroup label="${escapeAttr(area.nome || 'Equipa')}">${daEquipa.map(opt).join('')}</optgroup>` : ''}${outros.length ? `<optgroup label="Outras equipas">${outros.map(opt).join('')}</optgroup>` : ''}`;
  },
  // Campo numérico de uma linha: data-orc="linha|<areaId>|<linhaId>|<campo>"
  inp(area, linha, campo, valor, larg, extra) {
    return `<input type="number" step="any" min="0" class="orc-num" style="width:${larg || 70}px" data-orc="linha|${area.id}|${linha.id}|${campo}" value="${valor === 0 || valor === undefined || valor === null ? '' : escapeAttr(String(valor))}" placeholder="0"${extra || ''}>`;
  },
  calc(area, linha, campo, texto) { return `<span data-calc="${linha.id}|${campo}">${texto}</span>`; },
  htmlSeccao(area, secao, editavel, orc) {
    const E = OrcLogica, d = l => l.dados, linhas = area.linhas.filter(l => l.seccao === secao.k);
    const dis = editavel ? '' : ' disabled';
    const txt = (l, ph) => `<input type="text" class="orc-txt" data-orc="linha|${area.id}|${l.id}|descricao" value="${escapeAttr(l.descricao || '')}" placeholder="${ph}"${dis}>`;
    const cons = l => `<select data-orc="consultor|${area.id}|${l.id}"${dis}>${this.optConsultores(area, l.recurso_id)}</select>`;
    const rm = l => editavel ? `<td><button type="button" class="btn-icon" title="Remover linha" data-orc-acao="rm-linha|${area.id}|${l.id}">🗑</button></td>` : '<td></td>';
    const par = { aluguer_saida: orc.aluguer_saida, custo_km: orc.custo_km };
    const f = (k, cabecalhos, corpo) => `<div class="table-scroll"><table class="tabela-crud orc-tab"><thead><tr>${cabecalhos.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead><tbody>${linhas.map(l => { const c = E.calcLinha(l, par); return `<tr>${corpo(l, c)}${rm(l)}</tr>`; }).join('') || `<tr><td colspan="${cabecalhos.length + 1}" class="hint">Sem linhas.</td></tr>`}</tbody></table></div>`;
    const m = v => E.euro(v);
    let corpo = '';
    if (secao.k === 'consultoria') corpo = f(secao.k, ['Tarefa / descrição', 'Consultor', 'Nº horas', 'Valor/hora (€)', 'Subtotal', 'Margem'], (l, c) =>
      `<td>${txt(l, 'Ex.: Diagnóstico inicial')}</td><td>${cons(l)}</td><td>${this.inp(area, l, 'horas', d(l).horas, 60, dis)}</td><td>${this.inp(area, l, 'valor_hora', d(l).valor_hora, 70, dis)}</td><td>${this.calc(area, l, 'valor', m(c.valor))}</td><td>${this.calc(area, l, 'margem', m(c.margem))}</td>`);
    else if (secao.k === 'formacao') corpo = f(secao.k, ['Ação de formação', 'Consultor', 'Horas sessão', 'Horas preparação', 'Valor/hora base (€)', 'Valor/hora efetivo', 'A faturar', 'Margem'], (l, c) =>
      `<td>${txt(l, 'Ex.: Formação em IA')}</td><td>${cons(l)}</td><td>${this.inp(area, l, 'horas_sessao', d(l).horas_sessao, 60, dis)}</td><td>${this.inp(area, l, 'horas_prep', d(l).horas_prep, 60, dis)}</td><td>${this.inp(area, l, 'valor_hora', d(l).valor_hora, 70, dis)}</td><td>${this.calc(area, l, 'vhEfetivo', m(c.vhEfetivo))}</td><td>${this.calc(area, l, 'valor', m(c.valor))}</td><td>${this.calc(area, l, 'margem', m(c.margem))}</td>`);
    else if (secao.k === 'deslocacao') corpo = f(secao.k, ['Motivo', 'Saídas (viatura)', 'Km', 'Portagens €', 'Refeições €', 'Estadias €', 'Outros €', 'Horas desloc.', 'Consultor', 'Valor/hora (€)', 'Despesas', 'Custo horas'], (l, c) =>
      `<td>${txt(l, 'Ex.: Visita ao cliente')}</td>${['saidas', 'km', 'portagens', 'refeicoes', 'estadias', 'outros', 'horas'].map(k => `<td>${this.inp(area, l, k, d(l)[k], 46, dis)}</td>`).join('')}<td>${cons(l)}</td><td>${this.inp(area, l, 'valor_hora', d(l).valor_hora, 56, dis)}</td><td>${this.calc(area, l, 'despesas', m(c.despesas))}</td><td>${this.calc(area, l, 'valorHoras', m(c.valorHoras))}</td>`);
    else if (secao.k === 'consumivel') corpo = f(secao.k, ['Descrição', 'Valor (€)'], l => `<td>${txt(l, 'Ex.: Materiais')}</td><td>${this.inp(area, l, 'valor', d(l).valor, 90, dis)}</td>`);
    else corpo = f(secao.k, ['Produto / descrição', 'Quantidade', 'Preço custo (€)', 'Preço venda (€)', 'Desconto %', 'Venda final unit.', 'Subtotal venda', 'Margem €', 'Margem %'], (l, c) =>
      `<td>${txt(l, 'Ex.: Sensor')}</td><td>${this.inp(area, l, 'quantidade', d(l).quantidade, 60, dis)}</td><td>${this.inp(area, l, 'preco_custo', d(l).preco_custo, 76, dis)}</td><td>${this.inp(area, l, 'preco_venda', d(l).preco_venda, 76, dis)}</td><td>${this.inp(area, l, 'desconto', d(l).desconto, 56, dis)}</td><td>${this.calc(area, l, 'pvFinal', m(c.pvFinal))}</td><td>${this.calc(area, l, 'valor', m(c.valor))}</td><td>${this.calc(area, l, 'margem', m(c.margem))}</td><td>${this.calc(area, l, 'margemPct', E.pct(c.margemPct))}</td>`);
    return `<h4 class="crm-h">${secao.rotulo}</h4>${corpo}${editavel ? `<button type="button" class="btn btn-sm" data-orc-acao="add-linha|${area.id}|${secao.k}">+ Linha</button>` : ''}`;
  },
  htmlResumo(o) {
    const E = OrcLogica, c = E.calcOrcamento(o), a = c.areas.find(x => x.area.id === this.areaAtiva) || c.areas[0];
    const l = (t, v, cls) => `<div class="orc-res-linha ${cls || ''}"><span>${t}</span><b data-res="${t}">${v}</b></div>`;
    return `${a ? `<div class="orc-res"><h4 class="crm-h" style="margin-top:0;">${escapeHtml(a.area.nome || 'Área')}</h4>
        ${l('Horas vendáveis', E.euro(a.horasVendaveis))}${l('Produtos', E.euro(a.produtos))}${l('Despesas de deslocação', E.euro(a.despesas))}${l('Consumíveis', E.euro(a.consumiveis))}${l('Custos específicos', E.euro(a.custosEspecificos))}
        ${l('PREÇO FINAL DA ÁREA', E.euro(a.precoFinal), 'orc-res-total')}${l('Margem (€ / %)', `${E.euro(a.margem)} · ${E.pct(a.margemPct)}`, 'orc-res-sub')}</div>` : ''}
      <div class="orc-res orc-res-geral"><h4 class="crm-h" style="margin-top:0;">Orçamento (${c.areas.length} área${c.areas.length === 1 ? '' : 's'})</h4>
        ${c.areas.length > 1 ? c.areas.map(x => l(escapeHtml(x.area.nome || '—'), E.euro(x.precoFinal))).join('') : ''}
        ${l('PREÇO FINAL AO CLIENTE', E.euro(c.total), 'orc-res-total')}${l('Margem (€ / %)', `${E.euro(c.margem)} · ${E.pct(c.margemPct)}`, 'orc-res-sub')}</div>`;
  },
  htmlAvisos(o) {
    const v = OrcLogica.verificar(o);
    const l = [...v.erros.map(x => `<li style="color:var(--vermelho)">${escapeHtml(x)}</li>`), ...v.avisos.slice(0, 6).map(x => `<li>${escapeHtml(x)}</li>`)];
    return l.length ? `<ul class="orc-avisos">${l.join('')}${v.avisos.length > 6 ? `<li>… e mais ${v.avisos.length - 6}.</li>` : ''}</ul>` : '';
  },
  render() {
    const o = this.atual, el = document.getElementById('orcEditor');
    if (!o || !el) return;
    const editavel = OrcLogica.editavel(o), E = OrcLogica;
    const { op, conta } = this.contexto();
    const area = o.areas.find(a => a.id === this.areaAtiva) || o.areas[0];
    if (area) this.areaAtiva = area.id;
    const usadas = new Set(o.areas.map(a => a.equipa_id));
    const livres = App.state.equipas.filter(e => !usadas.has(e.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const outroValidado = this.d.resumos.some(x => x.proposta_id === o.proposta_id && x.estado === 'validado' && x.id !== o.id);
    const ctx = { souAdmin: Crm.souAdmin(), outroValidado };
    const btnEstado = (para, rotulo, cls) => E.podeTransitar(o.estado, para, ctx) ? `<button type="button" class="btn ${cls || ''}" data-orc-acao="estado|${para}">${rotulo}</button>` : '';
    el.innerHTML = `
      <p class="hint" style="margin:0 0 6px;">${escapeHtml(conta.nome || '—')} · ${escapeHtml(op.titulo || '—')} · proposta ${escapeHtml(this.proposta.referencia_giaf || 'v' + this.proposta.versao)}</p>
      <div class="row-2">
        <label>Título / descrição da versão <input type="text" data-orc="cab|titulo" value="${escapeAttr(o.titulo || '')}" placeholder="Ex.: Opção A — 3 sessões"${editavel ? '' : ' disabled'}></label>
        <label>Validade da proposta (dias) <input type="number" min="1" data-orc="cab|validade_dias" value="${escapeAttr(o.validade_dias)}"${editavel ? '' : ' disabled'}></label>
      </div>
      <p style="margin:6px 0;"><span class="crm-estado orc-estado-${o.estado}">${E.ESTADOS[o.estado]}</span>
        ${editavel ? '' : '<span class="hint">Registo fechado — para alterar, cria uma nova versão.</span>'}
        ${this.sujo ? '<span class="crm-atrasada">● alterações por guardar</span>' : ''}</p>
      <div class="orc-abas">${o.areas.map(a => `<button type="button" class="chip-projeto${a.id === this.areaAtiva ? ' ativo' : ''}" data-orc-acao="aba|${a.id}">${escapeHtml(a.nome || 'Área')}</button>`).join('')}
        ${editavel ? `<select data-orc="nova-area"><option value="">+ Acrescentar área…</option>${livres.map(e => `<option value="${escapeAttr(e.id)}">${escapeHtml(e.nome)}</option>`).join('')}</select>` : ''}</div>
      <div class="orc-corpo">
        <div class="orc-principal">${area ? `
          ${editavel ? `<button type="button" class="btn btn-sm btn-danger" data-orc-acao="rm-area|${area.id}" style="float:right;">Remover esta área</button>` : ''}
          ${E.SECCOES.map(s => this.htmlSeccao(area, s, editavel, o)).join('')}
          <label style="margin-top:10px;">Custos específicos do departamento (€) <span class="hint">(repartidos pelas rubricas na vista do cliente)</span>
            <input type="number" step="any" min="0" class="orc-num" data-orc="area|${area.id}|custos_especificos" value="${escapeAttr(area.custos_especificos || '')}" placeholder="0"${editavel ? '' : ' disabled'} style="width:120px"></label>`
        : '<p class="hint">Acrescenta uma área (departamento) para começar a orçamentar.</p>'}
          <label style="margin-top:10px;">Notas internas <textarea rows="2" data-orc="cab|notas"${editavel ? '' : ' disabled'}>${escapeHtml(o.notas || '')}</textarea></label>
        </div>
        <div class="orc-lateral" id="orcLateral">${this.htmlResumo(o)}<div id="orcAvisos">${this.htmlAvisos(o)}</div></div>
      </div>
      <div class="crm-acoes-form orc-botoes">
        ${editavel ? '<button type="button" class="btn btn-primary" data-orc-acao="guardar">Guardar</button>' : ''}
        ${o.estado === 'rascunho' ? '<button type="button" class="btn btn-primary" data-orc-acao="enviar" title="Envia a proposta por email ao contacto da oportunidade e copia os ficheiros para a pasta da proposta no SharePoint">✉ Enviar ao cliente</button>' : ''}
        ${o.estado === 'enviado' ? '<button type="button" class="btn" data-orc-acao="enviar" title="Volta a enviar o email com a proposta">✉ Reenviar ao cliente</button>' : ''}
        ${btnEstado('enviado', o.estado === 'rascunho' ? 'Marcar como enviado (sem email)' : 'Reabrir como enviado')}
        ${btnEstado('validado', '✔ Validar (adjudicado)', 'btn-primary')}${btnEstado('rejeitado', 'Rejeitar')}
        ${!editavel ? '<button type="button" class="btn" data-orc-acao="nova-versao">Nova versão a partir deste</button>' : ''}
        ${editavel ? '<button type="button" class="btn" data-orc-acao="atualizar-tarifas" title="Volta a copiar o valor/hora de cada consultor das Pessoas">Atualizar valores/hora</button>' : ''}
        <button type="button" class="btn" data-orc-acao="excel" title="Só a parte para o cliente: sem margem, custos específicos nem valores/hora">⬇ Proposta cliente (Excel)</button>
        <button type="button" class="btn" data-orc-acao="word" title="Preenche a capa e os honorários do modelo de proposta DG015 (Word)">📄 Proposta Word (DG015)</button>
        <button type="button" class="btn" data-orc-acao="voltar">← Voltar à proposta</button>
        ${editavel && !o._novo ? '<button type="button" class="btn btn-danger" data-orc-acao="eliminar">Eliminar</button>' : ''}
      </div>`;
  },
  // Atualiza só os números calculados (sem refazer a tabela: não se perde o foco a escrever).
  atualizarCalculos() {
    const o = this.atual, par = { aluguer_saida: o.aluguer_saida, custo_km: o.custo_km }, E = OrcLogica;
    o.areas.forEach(a => a.linhas.forEach(l => {
      const c = E.calcLinha(l, par);
      const fmt = { pvFinal: E.euro, vhEfetivo: E.euro, margemPct: E.pct };
      document.querySelectorAll(`[data-calc^="${l.id}|"]`).forEach(s => { const k = s.dataset.calc.split('|')[1]; s.textContent = (fmt[k] || E.euro)(c[k]); });
    }));
    const lat = document.getElementById('orcLateral'); if (lat) { lat.innerHTML = this.htmlResumo(o) + `<div id="orcAvisos">${this.htmlAvisos(o)}</div>`; }
  },
  marcarSujo() {
    if (this.sujo) return;
    this.sujo = true;
    const p = document.querySelector('#orcEditor p:nth-of-type(2)');
    if (p && !p.querySelector('.crm-atrasada')) p.insertAdjacentHTML('beforeend', ' <span class="crm-atrasada">● alterações por guardar</span>');
  },

  // ============================ Eventos ============================
  ligarEventos() {
    const corpo = App.els.modalCorpo;
    if (corpo._orcLigado) return;
    corpo._orcLigado = true;
    corpo.addEventListener('input', ev => {
      const c = ev.target.closest('[data-orc]');
      if (!c || !this.atual || !OrcLogica.editavel(this.atual)) return;
      const [tipo, a, l, campo] = c.dataset.orc.split('|');
      const o = this.atual;
      if (tipo === 'cab') { o[a] = a === 'validade_dias' ? (parseInt(c.value, 10) || 30) : c.value; }
      else if (tipo === 'area') { const ar = o.areas.find(x => x.id === a); if (ar) ar[l] = c.value === '' ? 0 : Number(c.value); }
      else if (tipo === 'linha') {
        const ln = (o.areas.find(x => x.id === a) || { linhas: [] }).linhas.find(x => x.id === l);
        if (!ln) return;
        if (campo === 'descricao') ln.descricao = c.value; else ln.dados[campo] = c.value === '' ? 0 : Number(c.value);
      } else return;
      this.marcarSujo();
      if (!(tipo === 'cab' && a !== 'validade_dias')) this.atualizarCalculos();
    });
    corpo.addEventListener('change', ev => {
      const c = ev.target.closest('[data-orc]');
      if (!c || !this.atual || !OrcLogica.editavel(this.atual)) return;
      const [tipo, a, l] = c.dataset.orc.split('|');
      const o = this.atual;
      if (tipo === 'consultor') {
        const ln = o.areas.find(x => x.id === a).linhas.find(x => x.id === l);
        OrcLogica.aplicarConsultor(ln, App.state.recursos.find(r => r.id === c.value) || null);
        this.marcarSujo(); this.render();
      } else if (tipo === 'nova-area' && c.value) {
        const eq = App.state.equipas.find(e => e.id === c.value);
        const ar = this.areaNova(eq, o.areas.length); o.areas.push(ar); this.areaAtiva = ar.id; this.marcarSujo(); this.render();
      }
    });
    corpo.addEventListener('click', ev => {
      const b = ev.target.closest('[data-orc-acao]');
      if (!b || !this.atual) return;
      const [acao, x, y] = b.dataset.orcAcao.split('|');
      const o = this.atual;
      if (acao === 'aba') { this.areaAtiva = x; this.render(); }
      else if (acao === 'add-linha') { const ar = o.areas.find(z => z.id === x); const ln = this.linhaNova(y, ar); ar.linhas.push(ln); this.marcarSujo(); this.render(); }
      else if (acao === 'rm-linha') { const ar = o.areas.find(z => z.id === x); ar.linhas = ar.linhas.filter(z => z.id !== y); this.marcarSujo(); this.render(); }
      else if (acao === 'rm-area') { if (confirm('Remover esta área e todas as suas linhas?')) { o.areas = o.areas.filter(z => z.id !== x); this.areaAtiva = (o.areas[0] || {}).id || null; this.marcarSujo(); this.render(); } }
      else if (acao === 'guardar') this.guardar();
      else if (acao === 'estado') this.mudarEstado(x);
      else if (acao === 'nova-versao') this.novaVersao();
      else if (acao === 'atualizar-tarifas') this.atualizarTarifas();
      else if (acao === 'excel') this.exportarExcel();
      else if (acao === 'word') this.abrirWord();
      else if (acao === 'enviar') this.abrirEnvio();
      else if (acao === 'voltar') this.voltar();
      else if (acao === 'eliminar') this.eliminar();
    });
  },

  // ============================ Ações ============================
  async guardar(silencioso) {
    const o = this.atual;
    try {
      await this.gravarConteudo(o);
      o._novo = false; this.sujo = false;
      Crm.sincronizarValorProposta(o.proposta_id);
      if (!silencioso) { App.toast('Orçamento guardado.'); this.render(); }
      return true;
    } catch (err) { App.toast(this.msgErro(err)); return false; }
  },
  atualizarTarifas() {
    const o = this.atual;
    let n = 0;
    o.areas.forEach(a => a.linhas.forEach(l => { const r = App.state.recursos.find(x => x.id === l.recurso_id); if (r) { OrcLogica.aplicarConsultor(l, r); n++; } }));
    this.marcarSujo(); this.render();
    App.toast(n ? `Valores/hora atualizados em ${n} linha(s) — guarda para os manter.` : 'Nenhuma linha tem consultor escolhido.');
  },
  async mudarEstado(para) {
    const o = this.atual, E = OrcLogica;
    const outroValidado = this.d.resumos.some(x => x.proposta_id === o.proposta_id && x.estado === 'validado' && x.id !== o.id);
    if (!E.podeTransitar(o.estado, para, { souAdmin: Crm.souAdmin(), outroValidado })) { App.toast(outroValidado && para === 'validado' ? 'Esta proposta já tem outro orçamento validado.' : 'Mudança de estado não permitida.'); return; }
    if (para === 'enviado' || para === 'validado') {
      if (E.editavel(o)) { const v = E.verificar(o); if (v.erros.length) { App.toast(v.erros[0]); return; } }
    }
    if (para === 'validado' && !confirm(`Validar este orçamento como o adjudicado (${E.euro(E.calcOrcamento(o).total)})? Só um orçamento por proposta pode ser validado; passa a ser a base da faturação.`)) return;
    if (para === 'rejeitado' && !confirm('Marcar este orçamento como rejeitado?')) return;
    try {
      if (E.editavel(o) && !(await this.guardar(true))) return;
      const total = OrcLogica.arred(E.calcOrcamento(o).total);
      const patch = { estado: para, atualizado_em: new Date().toISOString(), validado_em: para === 'validado' ? new Date().toISOString() : null };
      const { error } = await supabaseClient.from('crm_orcamentos').update(patch).eq('id', o.id);
      if (error) throw error;
      Object.assign(o, patch);
      const r = this.d.resumos.find(x => x.id === o.id); if (r) { r.estado = para; r.total = total; }
      this.sujo = false; this.render();
      Crm.sincronizarValorProposta(o.proposta_id);
      App.toast(`Orçamento ${E.ESTADOS[para].toLowerCase()}.`);
      if (para === 'validado') await this.aposValidar(o, total);
    } catch (err) { App.toast(this.msgErro(err)); }
  },
  // Adjudicado: o valor da proposta passa a ser o do orçamento validado e oferece-se marcar a proposta como aceite
  // (o que, por sua vez, oferece marcar a oportunidade como ganha — fluxo que já existe).
  async aposValidar(o, total) {
    const p = Crm.idx.proposta.get(o.proposta_id);
    if (!p) return;
    try {
      const nova = await Crm.gravar('propostas', Object.assign({}, p, { valor: total, estado: p.estado === 'aceite' ? p.estado : 'aceite' }));
      this.proposta = nova;
      Crm.renderAtual();
      Crm.aposGuardarProposta(nova);
    } catch (err) { App.toast(this.msgErro(err)); }
  },
  async novaVersao() {
    const o = this.atual;
    const copia = OrcLogica.duplicar(o, () => crypto.randomUUID(), OrcLogica.proximaVersao(this.d.resumos, o.proposta_id));
    copia.criado_por = Crm.meuRecursoId(); copia._novo = true;
    this.mostrar(copia, this.proposta, true);
    App.toast(`Nova versão v${copia.versao} criada como rascunho — guarda-a para a manter.`);
  },
  async eliminar() {
    const o = this.atual;
    if (!confirm(`Eliminar o orçamento v${o.versao}? Esta ação não pode ser desfeita.`)) return;
    try {
      const { error } = await supabaseClient.from('crm_orcamentos').delete().eq('id', o.id);
      if (error) throw error;
      this.d.resumos = this.d.resumos.filter(x => x.id !== o.id);
      this.sujo = false; this.voltar(true);
      Crm.sincronizarValorProposta(o.proposta_id);
    } catch (err) { App.toast(this.msgErro(err)); }
  },
  voltar(semPerguntar) {
    if (this.sujo && !semPerguntar && !confirm('Há alterações por guardar. Sair mesmo assim?')) return;
    const p = this.proposta;
    this.atual = null; this.sujo = false;
    App.fecharModal();
    if (p) Crm.abrirProposta(p.id);
  },
  async exportarExcel() {
    const o = this.atual;
    try {
      const { op, conta } = this.contexto();
      const resp = App.state.recursos.find(r => r.id === (op.responsavel_id || Crm.meuRecursoId()));
      const dados = { cliente: conta.nome || '', projeto: op.titulo || '', data: DateUtil.todayISO(), validadeDias: o.validade_dias, responsavel: resp ? resp.nome : '', pc: OrcLogica.propostaCliente(o) };
      const nome = `Proposta_${(conta.nome || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\-]+/g, '_').slice(0, 40)}_v${o.versao}_${DateUtil.todayISO()}.xlsx`;
      await OrcExport.descarregar(dados, nome);
    } catch (err) { App.toast(err.message || 'Não consegui gerar o Excel.'); }
  },

  reabrirEditor() {
    const o = this.atual;
    if (!o) return;
    Crm.abrir(`Orçamento v${o.versao}`, '<div id="orcEditor"></div>', true);
    App.els.modal.classList.add('modal-orc');
    this.render();
  },

  // ============================ Enviar ao cliente (email + pasta no SharePoint) ============================
  async abrirEnvio() {
    const o = this.atual;
    if (!o) return;
    const E = OrcLogica, { op, conta } = this.contexto();
    const par = await this.carregarParametros(true);
    const comEmail = Crm.d.contactos.filter(c => c.conta_id === op.conta_id && OrcEnvio.emailValido(c.email));
    const total = E.calcOrcamento(o).total;
    const erros = E.verificar(o).erros.concat(OrcEnvio.verificar({ total, contactos: comEmail }));
    if (erros.length) { App.toast(erros[0]); return; }
    const principal = comEmail.find(c => c.id === op.contacto_id) || comEmail[0];
    const meu = App.state.recursos.find(r => r.id === Crm.meuRecursoId()), resp = App.state.recursos.find(r => r.id === (op.responsavel_id || Crm.meuRecursoId())) || meu;
    const referencia = this.proposta.referencia_giaf || '', titulo = o.titulo || op.titulo || '';
    const nomes = OrcEnvio.nomesFicheiros({ cliente: conta.nome, referencia, versao: o.versao });
    const pastaNome = OrcEnvio.nomePastaProposta(referencia, titulo);
    const modeloWord = OrcWord.modeloGuardado();
    const sp = par.sharepoint_url ? OrcEnvio.lerLinkSharePoint(par.sharepoint_url) : null;
    const avisos = OrcEnvio.avisos({ referencia, sharepointConfigurado: !!sp });
    const cc = OrcEnvio.listaEmails([resp && resp.email, meu && meu.email].filter(Boolean).join(','));
    const jaEnviado = o.estado === 'enviado';
    Crm.abrir(jaEnviado ? 'Reenviar proposta ao cliente' : 'Enviar proposta ao cliente', `
      <p class="hint" style="margin:0 0 8px;">${escapeHtml(conta.nome)} · ${escapeHtml(titulo)} · orçamento v${o.versao} (<b>${E.euro(total)}</b>)${jaEnviado ? ' — já enviado; isto repete o email.' : ''}</p>
      <div class="row-2">
        <label>Para (contacto da oportunidade) <select id="envPara">${comEmail.map(c => `<option value="${escapeAttr(c.email)}"${c.id === principal.id ? ' selected' : ''}>${escapeHtml(c.nome)} &lt;${escapeHtml(c.email)}&gt;</option>`).join('')}</select></label>
        <label>Outro endereço (opcional) <input type="text" id="envOutro" placeholder="nome@empresa.pt"></label>
      </div>
      <label>Cópia (CC) <span class="hint">(o responsável também recebe as respostas)</span> <input type="text" id="envCc" value="${escapeAttr(cc.join(', '))}"></label>
      <label>Assunto <input type="text" id="envAssunto" value="${escapeAttr(OrcEnvio.assuntoPadrao({ referencia, titulo }))}"></label>
      <label>Mensagem <textarea id="envMensagem" rows="9">${escapeHtml(OrcEnvio.mensagemPadrao({ referencia, titulo, contacto: principal.nome, validadeDias: o.validade_dias, responsavel: resp && resp.nome }))}</textarea></label>
      <h4 class="crm-h">Anexos do email</h4>
      <p style="margin:2px 0;">📎 <b>${escapeHtml(nomes.excel)}</b> <span class="hint">(proposta do cliente — sem margens nem valores/hora)</span></p>
      <label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="envWord"${modeloWord ? ' checked' : ''}> 📎 <b>${escapeHtml(nomes.word)}</b> <span class="hint">(capa e honorários do modelo DG015)</span></label>
      <div id="envWordModelo" style="${modeloWord ? 'display:none;' : ''}margin:0 0 6px 24px;"><label>Modelo DG015 (.docx) <input type="file" id="envWordFicheiro" accept=".docx"></label></div>
      <h4 class="crm-h">Pasta no SharePoint</h4>
      <label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="envCopiar"${sp ? ' checked' : ' disabled'}> Copiar para <b>${sp ? escapeHtml([...sp.pasta, OrcEnvio.limparNome(conta.nome), pastaNome].join(' / ')) : '— (link não configurado)'}</b></label>
      <p class="hint" style="margin:2px 0 6px 24px;">Vão os mesmos anexos e, na subpasta <b>Interno</b>, o orçamento completo (com margens): <b>${escapeHtml(nomes.interno)}</b>. O email nunca leva o orçamento interno.${this.proposta.caminho_documento ? ` A proposta já tem pasta registada — os ficheiros são acrescentados/substituídos nela.` : ''}</p>
      <label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="envTeste"> Só um <b>teste para mim</b> (email para ${escapeHtml((meu && meu.email) || 'o meu endereço')}; não copia para o SharePoint nem muda o estado)</label>
      ${avisos.length ? `<ul class="orc-avisos">${avisos.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : ''}
      <p id="envMsg" class="hint" style="margin:8px 0;"></p>
      <div class="crm-acoes-form"><button type="button" class="btn btn-primary" id="envEnviar">✉ Enviar</button><button type="button" class="btn" id="envVoltar">← Voltar ao orçamento</button></div>`, true);
    const m = Crm.corpo(), msg = m.querySelector('#envMsg');
    m.querySelector('#envVoltar').addEventListener('click', () => this.reabrirEditor());
    m.querySelector('#envWord').addEventListener('change', ev => { if (!modeloWord) m.querySelector('#envWordModelo').style.display = ev.target.checked ? '' : 'none'; });
    if (!modeloWord) m.querySelector('#envWordModelo').style.display = 'none';
    const erro = (t) => { msg.style.color = 'var(--vermelho)'; msg.textContent = t; };
    m.querySelector('#envEnviar').addEventListener('click', async ev => {
      const btn = ev.target;
      const outro = m.querySelector('#envOutro').value.trim();
      const para = [m.querySelector('#envPara').value, ...(outro ? [outro] : [])];
      const ccLista = OrcEnvio.listaEmails(m.querySelector('#envCc').value);
      const invalido = [...para, ...ccLista].find(a => !OrcEnvio.emailValido(a));
      if (invalido) { erro(`Endereço inválido: ${invalido}`); return; }
      const assunto = m.querySelector('#envAssunto').value.trim(), mensagem = m.querySelector('#envMensagem').value.trim();
      if (!assunto || !mensagem) { erro('O assunto e a mensagem não podem ficar vazios.'); return; }
      const teste = m.querySelector('#envTeste').checked, copiar = m.querySelector('#envCopiar').checked && !teste;
      const querWord = m.querySelector('#envWord').checked, ficheiroWord = m.querySelector('#envWordFicheiro') && m.querySelector('#envWordFicheiro').files[0];
      if (querWord && !modeloWord && !ficheiroWord) { erro('Escolhe o ficheiro do modelo DG015 (.docx) ou desmarca o Word.'); return; }
      if (!teste && !confirm(`Enviar a proposta a ${para.join(', ')}${copiar ? ' e copiar os ficheiros para o SharePoint' : ''}?`)) return;
      btn.disabled = true; msg.style.color = ''; msg.textContent = 'A preparar os ficheiros…';
      try {
        if (E.editavel(o) && this.sujo && !(await this.guardar(true))) { btn.disabled = false; msg.textContent = ''; return; }
        const pc = E.propostaCliente(o), dataHoje = DateUtil.todayISO();
        const dadosExcel = { cliente: conta.nome || '', projeto: titulo, data: dataHoje, validadeDias: o.validade_dias, responsavel: resp ? resp.nome : '', pc };
        const bufExcel = await (await OrcExport.blobDaProposta(dadosExcel)).arrayBuffer();
        const anexos = [{ nome: nomes.excel, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: OrcEnvio.base64DeBuffer(bufExcel) }];
        if (querWord) {
          const bufModelo = ficheiroWord ? await ficheiroWord.arrayBuffer() : OrcWord.bufferDoModelo(modeloWord);
          const v = OrcWord.valoresPadrao({ titulo, cliente: conta.nome, referencia, areas: o.areas.map(a => a.nome), versaoProposta: this.proposta.versao, hojeISO: dataHoje, total: pc.total, validadeDias: o.validade_dias, rubricas: E.RUBRICAS.map(r => ({ rotulo: r.rotulo, valor: pc.investimento[r.k] })) });
          const { blob } = await OrcWord.gerar(bufModelo, v);
          if (ficheiroWord) OrcWord.guardarModelo(ficheiroWord.name, bufModelo);
          anexos.push({ nome: nomes.word, tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: OrcEnvio.base64DeBuffer(await blob.arrayBuffer()) });
        }
        if (typeof XLSX === 'undefined') await App.carregarScript('lib/xlsx.full.min.js');
        const interno = { nome: nomes.interno, tipo: 'application/octet-stream', base64: OrcEnvio.base64DeBuffer(OrcExport.interno(o, { cliente: conta.nome, projeto: titulo, referencia, data: dataHoje })), subpasta: 'Interno' };
        const body = {
          para, cc: ccLista, responderPara: resp && resp.email ? [resp.email] : [], assunto, corpoHtml: OrcEnvio.htmlDoTexto(mensagem), anexos, teste,
          pasta: copiar ? { cliente: conta.nome, proposta: pastaNome, ficheiros: [...anexos, interno] } : null
        };
        msg.textContent = teste ? 'A enviar o teste…' : 'A enviar…';
        const { data, error } = await supabaseClient.functions.invoke('proposta-enviar', { body });
        if (error) {
          let texto = error.message || 'Erro ao enviar.';
          try { const j = await error.context.json(); if (j && j.erro) texto = j.erro; } catch (e) { /* mantém a mensagem */ }
          if (/Failed to send a request|non-2xx/i.test(texto) && !error.context) texto = 'Não consegui contactar a função de envio. Já foi instalada no Supabase (proposta-enviar)?';
          btn.disabled = false; erro(texto); return;
        }
        if (teste) { btn.disabled = false; msg.style.color = 'var(--verde)'; msg.textContent = `Teste enviado para ${(data.email && data.email.para || []).join(', ')} — confirma o email e os anexos na tua caixa.`; return; }
        await this.aposEnvio(data, { o, conta, op, para, anexos: anexos.map(a => a.nome), referencia, total, dataHoje });
      } catch (err) { console.error(err); btn.disabled = false; erro(err.message || 'Não consegui enviar.'); }
    });
  },
  // Depois de enviado: estado do orçamento, dados de envio na proposta, link da pasta e interação na conta.
  async aposEnvio(r, c) {
    const o = this.atual, E = OrcLogica, linhas = [];
    const ok = (t) => linhas.push(`<p style="margin:4px 0;color:var(--verde);">✔ ${escapeHtml(t)}</p>`), aviso = (t) => linhas.push(`<p style="margin:4px 0;color:var(--vermelho);">⚠ ${escapeHtml(t)}</p>`);
    ok(`Email enviado a ${c.para.join(', ')}.`);
    const url = r.sharepoint && r.sharepoint.estado === 'ok' ? r.sharepoint.url : '';
    if (r.sharepoint && r.sharepoint.estado === 'ok') ok(`Ficheiros copiados para o SharePoint (${(r.sharepoint.copiados || []).join(', ')}).`);
    else if (r.sharepoint && r.sharepoint.estado === 'erro') aviso(`Não consegui copiar para o SharePoint: ${r.sharepoint.erro} O email foi enviado; podes colar o link da pasta no campo "Documento" da proposta.`);
    try {
      if (o.estado === 'rascunho') await this.mudarEstado('enviado');
      const p = Crm.idx.proposta.get(o.proposta_id);
      const validade = DateUtil.toISO(DateUtil.addDays(DateUtil.parseISO(c.dataHoje), o.validade_dias));
      const nova = await Crm.gravar('propostas', Object.assign({}, p, { estado: p.estado === 'aceite' ? p.estado : 'enviada', data_envio: c.dataHoje, data_validade: validade, caminho_documento: url || p.caminho_documento }));
      this.proposta = nova;
      const contacto = Crm.d.contactos.find(x => x.conta_id === c.op.conta_id && x.email === c.para[0]);
      await Crm.gravar('interacoes', { id: null, conta_id: c.op.conta_id, contacto_id: contacto ? contacto.id : null, oportunidade_id: c.op.id, tipo: 'email', data: c.dataHoje, resumo: OrcEnvio.resumoInteracao({ referencia: c.referencia, versao: o.versao, totalTexto: E.euro(c.total), para: c.para, anexos: c.anexos, pastaUrl: url }), criado_por: Crm.meuRecursoId() });
      Crm.renderAtual();
      ok('Orçamento marcado como enviado, proposta com a data de envio e interação registada na conta.');
    } catch (err) { aviso(`O email foi enviado, mas não consegui registar tudo no CRM: ${this.msgErro(err)}`); }
    Crm.corpo().innerHTML = `<h4 class="crm-h" style="margin-top:0;">Proposta enviada</h4>${linhas.join('')}${url ? `<p style="margin:8px 0;"><a href="${escapeAttr(url)}" target="_blank" rel="noopener">📂 Abrir a pasta no SharePoint</a></p>` : ''}
      <div class="crm-acoes-form"><button type="button" class="btn btn-primary" id="envFechar">← Voltar ao orçamento</button></div>`;
    Crm.corpo().querySelector('#envFechar').addEventListener('click', () => this.reabrirEditor());
  },

  // ============================ Proposta em Word (modelo DG015) ============================
  abrirWord() {
    const o = this.atual;
    if (!o) return;
    const { op, conta } = this.contexto();
    const pc = OrcLogica.propostaCliente(o);
    const v = OrcWord.valoresPadrao({
      titulo: o.titulo || op.titulo || '', cliente: conta.nome || '', referencia: this.proposta.referencia_giaf, areas: o.areas.map(a => a.nome),
      versaoProposta: this.proposta.versao, hojeISO: DateUtil.todayISO(), total: pc.total, validadeDias: o.validade_dias,
      rubricas: OrcLogica.RUBRICAS.map(r => ({ rotulo: r.rotulo, valor: pc.investimento[r.k] }))
    });
    const guardado = OrcWord.modeloGuardado();
    const campo = (k, rotulo, larg) => `<label${larg ? ` style="flex:${larg}"` : ''}>${rotulo} <input type="text" data-word="${k}" value="${escapeAttr(v[k])}"></label>`;
    Crm.abrir('Proposta em Word (DG015)', `
      <p class="hint" style="margin:0 0 8px;">Preenche a <b>capa</b> e os <b>honorários</b> do modelo DG015. Revê os valores (vêm da proposta e do orçamento). O texto das outras secções continua a ser escrito por ti no Word.</p>
      <div class="row-2">${campo('TrabReal', 'Trabalho a realizar')}${campo('NomeEmpresa', 'Empresa')}</div>
      <div class="row-2">${campo('Ano', 'Ano')}${campo('NObra', 'Obra')}</div>
      <div class="row-2">${campo('DepUn', 'Dept-Unidade')}${campo('NRev', 'Revisão')}</div>
      <div class="row-2">${campo('DDia', 'Dia')}${campo('DMes', 'Mês')}</div>
      <div class="row-2">${campo('DAno', 'Ano da data')}<label>Honorários (€) <input type="text" data-word="honorarios" value="${escapeAttr(v.honorarios)}"></label></div>
      <label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="wordDetalhe" checked> Acrescentar o detalhe por rubricas a seguir aos honorários (a validade de ${escapeHtml(String(v.validadeDias))} dias acerta-se no texto do modelo)</label>
      <h4 class="crm-h">Modelo</h4>
      ${guardado ? `<p id="wordModeloInfo">Modelo guardado neste computador: <b>${escapeHtml(guardado.nome)}</b> <button type="button" class="btn btn-sm" id="wordOutro">Usar outro</button> <button type="button" class="btn btn-sm" id="wordEsquecer">Esquecer</button></p>` : ''}
      <div id="wordEscolher" style="${guardado ? 'display:none;' : ''}"><label>Ficheiro do modelo (DG015_Rev07_Proposta.docx) <input type="file" id="wordFicheiro" accept=".docx"></label>
        <label class="zoom-label" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="wordGuardar" checked> Guardar o modelo neste computador (só neste browser — não vai para o servidor)</label></div>
      <p id="wordMsg" class="hint" style="margin:6px 0;"></p>
      <div class="crm-acoes-form"><button type="button" class="btn btn-primary" id="wordGerar">Gerar proposta (Word)</button><button type="button" class="btn" id="wordVoltar">← Voltar ao orçamento</button></div>`, true);
    const m = Crm.corpo(), msg = m.querySelector('#wordMsg');
    m.querySelector('#wordVoltar').addEventListener('click', () => this.reabrirEditor());
    const outro = m.querySelector('#wordOutro'), esq = m.querySelector('#wordEsquecer');
    if (outro) outro.addEventListener('click', () => { m.querySelector('#wordEscolher').style.display = ''; m.querySelector('#wordModeloInfo').style.display = 'none'; });
    if (esq) esq.addEventListener('click', () => { OrcWord.esquecerModelo(); this.abrirWord(); });
    m.querySelector('#wordGerar').addEventListener('click', async () => {
      try {
        const val = Object.assign({}, v);
        m.querySelectorAll('[data-word]').forEach(i => { val[i.dataset.word] = i.value.trim(); });
        if (!m.querySelector('#wordDetalhe').checked) val.rubricas = [];
        const ficheiro = m.querySelector('#wordFicheiro') && m.querySelector('#wordFicheiro').files[0];
        let buffer;
        if (ficheiro) buffer = await ficheiro.arrayBuffer();
        else if (guardado && m.querySelector('#wordEscolher').style.display === 'none') buffer = OrcWord.bufferDoModelo(guardado);
        else { msg.style.color = 'var(--vermelho)'; msg.textContent = 'Escolhe o ficheiro do modelo (.docx).'; return; }
        msg.style.color = ''; msg.textContent = 'A gerar…';
        const { blob, avisos } = await OrcWord.gerar(buffer, val);
        if (ficheiro && m.querySelector('#wordGuardar').checked) OrcWord.guardarModelo(ficheiro.name, buffer);
        const nome = `Proposta_${(val.NomeEmpresa || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-]+/g, '_').slice(0, 40)}_${(this.proposta.referencia_giaf || '').replace(/[^\w\-]+/g, '_') || 'v' + o.versao}.docx`;
        App.descarregarBlob(blob, nome);
        msg.style.color = avisos.length ? 'var(--vermelho)' : 'var(--verde)';
        msg.textContent = avisos.length ? `Gerada, mas: ${avisos.join(' ')}` : 'Proposta gerada — abre-a no Word e completa o texto das secções.';
      } catch (err) { console.error(err); msg.style.color = 'var(--vermelho)'; msg.textContent = err.message || 'Não consegui gerar a proposta.'; }
    });
  },

  // ============================ Parâmetros (Configurações → Funil CRM, só Administrador) ============================
  async renderParametros(el) {
    const p = await this.carregarParametros(true);
    el.innerHTML = `<h3 style="margin:18px 0 4px;">Orçamentação — parâmetros</h3>
      <p class="pagina-sub" style="margin:0 0 8px;">O valor/hora de cada consultor vem das <b>Pessoas</b> (preço de venda e de custo). Aqui ficam os custos de deslocação e a validade por omissão. Mudar estes valores <b>não altera</b> orçamentos já feitos (ficam copiados no orçamento).</p>
      <div class="row-2" style="max-width:640px;">
        <label>Aluguer de viatura por saída (€) <input type="number" step="any" min="0" data-orc-par="aluguer_saida" value="${escapeAttr(p.aluguer_saida)}"></label>
        <label>Custo por km (€/km) <input type="number" step="any" min="0" data-orc-par="custo_km" value="${escapeAttr(p.custo_km)}"></label>
      </div>
      <label style="max-width:300px;">Validade das propostas por omissão (dias) <input type="number" min="1" data-orc-par="validade_dias" value="${escapeAttr(p.validade_dias)}"></label>
      <label style="max-width:900px;margin-top:8px;">Link da pasta CLIENTES no SharePoint <span class="hint">(as propostas ficam em CLIENTES / nome do cliente / proposta)</span>
        <input type="text" data-orc-par-txt="sharepoint_url" value="${escapeAttr(p.sharepoint_url || '')}" placeholder="https://citeve2.sharepoint.com/…" spellcheck="false"></label>
      <span class="hint" id="orcSpMsg"></span><br>
      <span class="hint" id="orcParMsg"></span>`;
    const mostrarSp = () => {
      const el2 = el.querySelector('#orcSpMsg'), l = OrcEnvio.lerLinkSharePoint(el.querySelector('[data-orc-par-txt]').value);
      el2.style.color = ''; el2.textContent = l ? `Site ${l.sitio} · biblioteca "${l.biblioteca}" · pasta ${l.pasta.join('/') || '(raiz)'}` : (el.querySelector('[data-orc-par-txt]').value.trim() ? 'Não reconheço este link (tem de ser um link de uma pasta do SharePoint).' : 'Sem link: os ficheiros não são copiados para o SharePoint.');
      if (!l && el.querySelector('[data-orc-par-txt]').value.trim()) el2.style.color = 'var(--vermelho)';
    };
    mostrarSp();
    el.querySelector('[data-orc-par-txt]').addEventListener('change', async ev => {
      const msg = el.querySelector('#orcParMsg'), v = ev.target.value.trim();
      mostrarSp();
      if (v && !OrcEnvio.lerLinkSharePoint(v)) { msg.textContent = 'Link inválido — não foi guardado.'; msg.style.color = 'var(--vermelho)'; return; }
      try {
        const { error } = await supabaseClient.from('crm_orc_parametros').upsert({ id: 1, sharepoint_url: v, atualizado_em: new Date().toISOString() });
        if (error) throw error;
        this.parametros = Object.assign({}, this.parametros, { sharepoint_url: v });
        msg.textContent = 'Guardado.'; msg.style.color = 'var(--verde)';
      } catch (err) { msg.textContent = this.msgErro(err) + ' (Falta correr supabase/orcamentos_envio.sql?)'; msg.style.color = 'var(--vermelho)'; }
    });
    el.querySelectorAll('[data-orc-par]').forEach(i => i.addEventListener('change', async () => {
      const campo = i.dataset.orcPar, v = Number(i.value);
      const msg = el.querySelector('#orcParMsg');
      if (!(v >= 0) || (campo === 'validade_dias' && v < 1)) { msg.textContent = 'Valor inválido.'; msg.style.color = 'var(--vermelho)'; return; }
      try {
        const { error } = await supabaseClient.from('crm_orc_parametros').upsert({ id: 1, [campo]: campo === 'validade_dias' ? Math.round(v) : v, atualizado_em: new Date().toISOString() });
        if (error) throw error;
        this.parametros = Object.assign({}, this.parametros, { [campo]: v });
        msg.textContent = 'Guardado.'; msg.style.color = 'var(--verde)';
      } catch (err) { msg.textContent = this.msgErro(err); msg.style.color = 'var(--vermelho)'; }
    }));
  }
};

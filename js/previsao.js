// Ecrã "Previsão" (Financeiro): mapa mensal da previsão de reconhecimento e faturação. Fase A: só o contratado (projetos).
// As contas estão em js/previsao-logica.js (puras, testadas); aqui junta-se o que vem do estado da app e desenha-se.
// Só o Administrador (cruza valores de venda de toda a empresa, como o Acompanhamento Financeiro).
const Previsao = {
  HORIZONTES: [6, 12, 18],
  MESES: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
  filtros: { tipo: '', dept: '', equipa: '', horizonte: 12, serie: 'rec' },
  expandidas: new Set(),
  ligado: false,

  podeVer() { return App.souAdmin(); },
  eur(v) { return (Math.round(v) || 0).toLocaleString('pt-PT') + ' €'; },
  k(v) { return Math.abs(v) < 50 ? '–' : (v / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); },
  kk(v) { return (v / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' k€'; },
  rotuloMes(m) { return this.MESES[Number(m.slice(5)) - 1]; },

  // Abrir o separador: desenha logo (os projetos já estão em memória) e, em segundo plano, carrega o CRM — só para saber o tipo
  // (I&D/Serviços) de cada projeto, através da oportunidade ligada.
  async aoAbrir() {
    this.ligarEventos();
    this.render();
    if (Crm.podeVer() && !Crm.carregado && !Crm.erroCarga) {
      try { await Crm.carregar(); } catch (e) { /* sem CRM: o tipo fica "Sem tipo" */ }
      if (App.abaAtiva === 'previsao') this.render();
    }
  },

  tipoDoProjeto(p) {
    if (!Crm.carregado) return '';
    const op = Crm.d.oportunidades.find(o => o.projeto_id === p.id);
    const t = op && Crm.idx.tipo ? Crm.idx.tipo.get(op.tipo_id) : null;
    return t ? t.nome : 'Sem tipo';
  },

  // Uma linha por projeto com algo a prever (backlog ou faturas por emitir).
  calcular(hojeISO, meses) {
    const S = App.state;
    const linhas = [], semDados = [];
    Object.values(S.projetos).forEach(p => {
      if (p.estado === 'Cancelado') return;
      const equipa = p.equipaId ? S.equipas.find(e => e.id === p.equipaId) : null;
      const dept = equipa && equipa.departamentoId ? S.departamentos.find(d => d.id === equipa.departamentoId) : null;
      const horasRegistadas = S.registos.filter(r => App.registoPertenceAoProjeto(r, p)).reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
      const tarefas = (p.tarefas || []).filter(t => !App.temFilhos(p, t.id) && (t.progresso || 0) < 100).map(t => ({
        inicio: t.inicio, fim: t.fim,
        horasPorFazer: (t.recursoIds || []).reduce((s, rid) => s + Math.max(0, App.horasAlocadas(t, rid) - App.horasJaRegistadasTarefa(p, t, rid)), 0)
      }));
      const rec = PrevisaoLogica.reconhecimentoBacklog({ valorVendido: p.valorVendido, horasVendidas: p.horasVendidas, horasRegistadas, tarefas, hojeISO, meses });
      const fat = PrevisaoLogica.faturacaoContratada({
        faturas: (p.faturas || []).map(f => ({ dataPrevista: f.dataPrevista, valor: App.valorFatura(f, p), emitida: !!f.emitida })), hojeISO, meses
      });
      const base = {
        id: p.id, nome: App.rotuloProjeto(p), tipo: this.tipoDoProjeto(p) || 'Sem tipo', equipaId: p.equipaId || '', equipa: equipa ? equipa.nome : 'Por atribuir',
        deptId: dept ? dept.id : '', dept: dept ? dept.nome : '', suspenso: p.ativo === false, estado: p.estado, valorVendido: p.valorVendido || 0,
        horasRegistadas, rec, fat
      };
      if (!rec) { if (p.estado !== 'Concluído') semDados.push(base); if (fat.total > 0) linhas.push(base); return; }
      if (rec.porReconhecer > 0 || fat.total > 0) linhas.push(base);
    });
    return { linhas, semDados };
  },

  filtrar(linhas) {
    const f = this.filtros;
    return linhas.filter(l => (!f.tipo || l.tipo === f.tipo) && (!f.dept || l.deptId === f.dept) && (!f.equipa || l.equipaId === f.equipa));
  },

  // ---------- desenho ----------
  barras(serie, meses, cor, rotulo) {
    const H = 210, W = 620, pl = 34, pr = 6, pt = 14, pb = 22, n = meses.length;
    const teto = Math.max(10, Math.ceil(Math.max(...meses.map(m => serie[m] / 1000)) / 10) * 10);
    const bw = (W - pl - pr) / n, y = v => pt + (H - pt - pb) * (1 - v / teto);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="prev-grafico" role="img" aria-label="${escapeAttr(rotulo)}">`;
    [0, .5, 1].forEach(f => { const v = teto * f; s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="prev-grelha"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" class="prev-eixo">${Math.round(v)}</text>`; });
    meses.forEach((m, i) => {
      const v = serie[m] / 1000, x = pl + i * bw + bw * .14, w = bw * .72, h = (H - pt - pb) * v / teto;
      if (i === 0) s += `<rect x="${pl}" y="${pt}" width="${bw}" height="${H - pt - pb}" class="prev-atual"/>`;
      s += `<rect x="${x}" y="${H - pb - h}" width="${w}" height="${h}" fill="${cor}" rx="2"><title>${this.rotuloMes(m)}/${m.slice(0, 4)} · ${this.kk(serie[m])}</title></rect>`;
      s += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle" class="prev-eixo">${this.rotuloMes(m)}</text>`;
      if (v >= .05) s += `<text x="${x + w / 2}" y="${H - pb - h - 3}" text-anchor="middle" class="prev-valor">${Math.round(v)}</text>`;
    });
    return s + '</svg>';
  },

  celulas(serie, meses, rgb, intensidade) {
    const max = Math.max(...meses.map(m => serie[m]), 1);
    return meses.map((m, i) => {
      const v = serie[m];
      const estilo = v > 49 ? ` style="background:rgba(${rgb},${(0.08 + v / max * 0.34).toFixed(2)})"` : '';
      return `<td class="${i === 0 ? 'atual' : ''}"${estilo}>${this.k(v)}</td>`;
    }).join('');
  },

  render() {
    const el = document.getElementById('previsaoCorpo');
    if (!el || !this.podeVer()) return;
    const hoje = DateUtil.todayISO();
    const meses = PrevisaoLogica.mesesHorizonte(hoje, this.filtros.horizonte);
    const { linhas: todas, semDados } = this.calcular(hoje, meses);
    this.desenharFiltros(todas);
    const linhas = this.filtrar(todas);
    const P = AnaliseHoras.PALETA;
    const recSerie = PrevisaoLogica.somar(linhas.map(l => l.rec && l.rec.porMes), meses);
    const fatSerie = PrevisaoLogica.somar(linhas.map(l => l.fat.porMes), meses);
    const sum = (f) => linhas.reduce((s, l) => s + f(l), 0);
    const backlog = sum(l => l.rec ? l.rec.porReconhecer : 0), semCal = sum(l => l.rec ? l.rec.naoCalendarizado : 0);
    const emAtraso = sum(l => l.fat.emAtraso), nAtraso = sum(l => l.fat.nEmAtraso), semData = sum(l => l.fat.semData), fora = sum(l => l.fat.foraDoHorizonte);
    const nm = meses.length;

    // KPIs
    const kpi = (valor, rot, sub) => `<div class="an-kpi"><b>${valor}</b><span>${rot}</span>${sub ? `<small class="prev-sub">${sub}</small>` : ''}</div>`;
    document.getElementById('prevKpis').innerHTML =
      kpi(this.kk(backlog), 'Backlog por reconhecer', 'projetos contratados, todo o plano') +
      kpi(this.kk(PrevisaoLogica.total(recSerie, meses)), 'Reconhecimento previsto', `próximos ${nm} meses`) +
      kpi(this.kk(PrevisaoLogica.total(fatSerie, meses)), 'Faturação prevista', `faturas por emitir, próximos ${nm} meses`) +
      kpi(this.kk(semCal), 'Backlog sem calendário', 'sem horas previstas no Gantt');

    // avisos
    const avisos = [];
    if (semDados.length) avisos.push(`${semDados.length} projeto(s) sem <b>valor ou horas vendidas</b> não entram no reconhecimento: ${semDados.slice(0, 4).map(l => escapeHtml(l.nome)).join('; ')}${semDados.length > 4 ? '…' : ''}.`);
    if (semCal > 49) avisos.push(`${this.kk(semCal)} de backlog não têm horas previstas no Gantt (ver "Cobertura" no detalhe) — por isso não aparecem em nenhum mês.`);
    if (nAtraso) avisos.push(`${nAtraso} fatura(s) por emitir (${this.kk(emAtraso)}) já passaram da data prevista — estão contadas no mês atual.`);
    if (semData > 0) avisos.push(`${this.kk(semData)} em faturas por emitir sem data prevista não entram no mapa.`);
    if (fora > 0) avisos.push(`${this.kk(fora)} em faturas estão previstas depois do horizonte escolhido.`);
    document.getElementById('prevAvisos').innerHTML = avisos.map(a => `<div class="prev-aviso">⚠ ${a}</div>`).join('');

    // gráficos
    document.getElementById('prevGrafRec').innerHTML = this.barras(recSerie, meses, P[0], 'Reconhecimento previsto por mês');
    document.getElementById('prevGrafFat').innerHTML = this.barras(fatSerie, meses, P[2], 'Faturação prevista por mês');

    // mapa
    const anos = [...new Set(meses.map(m => m.slice(0, 4)))];
    const cab1 = '<tr class="ano"><th></th>' + anos.map(a => `<th colspan="${meses.filter(m => m.startsWith(a)).length}">${a}</th>`).join('') + '<th></th></tr>';
    const cab2 = '<tr><th>k€</th>' + meses.map((m, i) => `<th class="${i === 0 ? 'atual' : ''}">${this.rotuloMes(m)}</th>`).join('') + `<th>Total ${nm}m</th></tr>`;
    const linhaTot = (rot, serie, cls) => `<tr class="${cls}"><td>${rot}</td>${meses.map((m, i) => `<td class="${i === 0 ? 'atual' : ''}">${this.k(serie[m])}</td>`).join('')}<td><b>${this.k(PrevisaoLogica.total(serie, meses))}</b></td></tr>`;
    const acRec = PrevisaoLogica.acumular(recSerie, meses), acFat = PrevisaoLogica.acumular(fatSerie, meses);
    const dif = meses.map(m => acFat[m] - acRec[m]);
    document.getElementById('prevMapa').innerHTML = `<thead>${cab1}${cab2}</thead><tbody>
      <tr class="secao"><td colspan="${nm + 2}">RECONHECIMENTO (trabalho feito)</td></tr>
      <tr><td>Contratado (backlog) <span class="prev-tag">100%</span></td>${this.celulas(recSerie, meses, '42,110,166')}<td><b>${this.k(PrevisaoLogica.total(recSerie, meses))}</b></td></tr>
      <tr class="acum"><td>Acumulado</td>${meses.map((m, i) => `<td class="${i === 0 ? 'atual' : ''}">${this.k(acRec[m])}</td>`).join('')}<td></td></tr>
      <tr class="secao"><td colspan="${nm + 2}">FATURAÇÃO</td></tr>
      <tr><td>Contratada (faturas por emitir) <span class="prev-tag">100%</span></td>${this.celulas(fatSerie, meses, '58,157,107')}<td><b>${this.k(PrevisaoLogica.total(fatSerie, meses))}</b></td></tr>
      <tr class="acum"><td>Acumulado</td>${meses.map((m, i) => `<td class="${i === 0 ? 'atual' : ''}">${this.k(acFat[m])}</td>`).join('')}<td></td></tr>
      <tr class="delta"><td title="Faturação acumulada menos reconhecimento acumulado: positivo = a faturar à frente do trabalho; negativo = trabalho feito por faturar (a partir de hoje)">Faturação − reconhecimento (acum.)</td>${meses.map((m, i) => { const v = dif[i]; return `<td class="${i === 0 ? 'atual ' : ''}${v < -49 ? 'neg' : (v > 49 ? 'pos' : '')}">${Math.abs(v) < 50 ? '–' : (v > 0 ? '+' : '') + this.k(v)}</td>`; }).join('')}<td></td></tr></tbody>`;

    // detalhe
    const rec = this.filtros.serie === 'rec';
    document.getElementById('prevSerieRec').setAttribute('aria-pressed', rec ? 'true' : 'false');
    document.getElementById('prevSerieFat').setAttribute('aria-pressed', rec ? 'false' : 'true');
    const serieDe = l => rec ? (l.rec ? l.rec.porMes : PrevisaoLogica.vazio(meses)) : l.fat.porMes;
    const max = Math.max(1, ...linhas.flatMap(l => meses.map(m => serieDe(l)[m])));
    const rgb = rec ? '42,110,166' : '58,157,107';
    const ordenadas = linhas.slice().sort((a, b) => PrevisaoLogica.total(serieDe(b), meses) - PrevisaoLogica.total(serieDe(a), meses) || a.nome.localeCompare(b.nome, 'pt'));
    const cabDet = `<thead><tr><th>Projeto</th><th>Tipo</th><th>Área</th><th>${rec ? 'Backlog' : 'Por emitir'}</th>${rec ? '<th title="Parte do backlog que tem horas previstas no Gantt">Cobertura</th>' : ''}${meses.map(m => `<th>${this.rotuloMes(m)}</th>`).join('')}<th>Total</th></tr></thead>`;
    const corpoDet = ordenadas.map(l => {
      const s = serieDe(l);
      const cel = meses.map(m => `<td${s[m] > 49 ? ` style="background:rgba(${rgb},${(0.08 + s[m] / max * 0.34).toFixed(2)})"` : ''}>${this.k(s[m])}</td>`).join('');
      const cob = l.rec ? Math.round(l.rec.cobertura * 100) : null;
      const ab = this.expandidas.has(l.id);
      const pressup = l.rec
        ? `Vendido ${this.eur(l.valorVendido)} · reconhecido até hoje ${this.eur(l.rec.reconhecidoHoje)} (${l.horasRegistadas.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} h registadas) · por reconhecer ${this.eur(l.rec.porReconhecer)} · €/h do projeto ${l.rec.euroHora.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} · o plano do Gantt cobre ${cob}% do backlog (${this.eur(l.rec.naoCalendarizado)} sem horas previstas) · faturas por emitir ${this.eur(l.fat.total)}${l.fat.nEmAtraso ? `, ${l.fat.nEmAtraso} em atraso` : ''}.`
        : `Sem valor ou horas vendidas — o reconhecimento não se calcula · faturas por emitir ${this.eur(l.fat.total)}.`;
      return `<tr class="item" data-prev-linha="${escapeAttr(l.id)}"><td>${escapeHtml(l.nome)}${l.suspenso ? ' <span class="prev-tag">suspenso</span>' : ''}</td><td>${escapeHtml(l.tipo)}</td><td>${escapeHtml(l.equipa)}</td>
        <td>${this.k(rec ? (l.rec ? l.rec.porReconhecer : 0) : l.fat.total)}</td>${rec ? `<td class="${cob !== null && cob < 80 ? 'neg' : ''}">${cob === null ? '–' : cob + '%'}</td>` : ''}${cel}<td><b>${this.k(PrevisaoLogica.total(s, meses))}</b></td></tr>
        <tr class="nota"${ab ? '' : ' hidden'}><td colspan="${nm + (rec ? 6 : 5)}">${pressup}</td></tr>`;
    }).join('');
    document.getElementById('prevDet').innerHTML = cabDet + `<tbody>${corpoDet || `<tr><td colspan="${nm + 5}">Sem projetos com algo a prever neste filtro.</td></tr>`}</tbody>`;
  },

  desenharFiltros(todas) {
    const f = this.filtros, S = App.state;
    const tipos = [...new Set(todas.map(l => l.tipo))].sort((a, b) => a.localeCompare(b, 'pt'));
    const opt = (valor, rotulo, sel) => `<option value="${escapeAttr(valor)}"${sel ? ' selected' : ''}>${escapeHtml(rotulo)}</option>`;
    document.getElementById('prevTipo').innerHTML = opt('', 'Todos', !f.tipo) + tipos.map(t => opt(t, t, f.tipo === t)).join('');
    document.getElementById('prevDept').innerHTML = opt('', 'Todas', !f.dept) + [...S.departamentos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map(d => opt(d.id, d.nome, f.dept === d.id)).join('');
    const equipas = S.equipas.filter(e => !f.dept || e.departamentoId === f.dept).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    if (f.equipa && !equipas.some(e => e.id === f.equipa)) f.equipa = '';
    document.getElementById('prevEquipa').innerHTML = opt('', 'Todas', !f.equipa) + equipas.map(e => opt(e.id, e.nome, f.equipa === e.id)).join('');
    document.getElementById('prevHorizonte').innerHTML = this.HORIZONTES.map(h => opt(String(h), h + ' meses', f.horizonte === h)).join('');
  },

  ligarEventos() {
    if (this.ligado) return;
    const raiz = document.getElementById('tab-previsao');
    if (!raiz) return;
    this.ligado = true;
    const f = this.filtros;
    raiz.addEventListener('change', ev => {
      const id = ev.target.id;
      if (id === 'prevTipo') f.tipo = ev.target.value;
      else if (id === 'prevDept') { f.dept = ev.target.value; f.equipa = ''; }
      else if (id === 'prevEquipa') f.equipa = ev.target.value;
      else if (id === 'prevHorizonte') f.horizonte = Number(ev.target.value) || 12;
      else return;
      this.render();
    });
    raiz.addEventListener('click', ev => {
      const serie = ev.target.closest('[data-prev-serie]');
      if (serie) { f.serie = serie.dataset.prevSerie; this.render(); return; }
      if (ev.target.closest('#btnPrevLimpar')) { Object.assign(f, { tipo: '', dept: '', equipa: '' }); this.render(); return; }
      const linha = ev.target.closest('[data-prev-linha]');
      if (linha) { const id = linha.dataset.prevLinha; if (this.expandidas.has(id)) this.expandidas.delete(id); else this.expandidas.add(id); linha.nextElementSibling.hidden = !this.expandidas.has(id); }
    });
  }
};
if (typeof module !== 'undefined') module.exports = Previsao;

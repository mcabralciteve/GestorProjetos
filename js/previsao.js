// Ecrã "Previsão" (Financeiro): mapa mensal da previsão de reconhecimento e faturação: contratado (projetos) e, conforme o cenário,
// oportunidades do CRM ponderadas pela probabilidade da etapa (Fase B).
// As contas estão em js/previsao-logica.js (puras, testadas); aqui junta-se o que vem do estado da app e desenha-se.
// Só o Administrador (cruza valores de venda de toda a empresa, como o Acompanhamento Financeiro).
const Previsao = {
  HORIZONTES: [6, 12, 18],
  MESES: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
  filtros: { tipo: '', dept: '', equipa: '', horizonte: 12, serie: 'rec', cenario: 'pond' },
  expandidas: new Set(),
  classificarAberto: false,
  ligado: false,

  podeVer() { return App.souAdmin(); },
  eur(v) { return (Math.round(v) || 0).toLocaleString('pt-PT') + ' €'; },
  k(v) { return Math.abs(v) < 50 ? '–' : (v / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); },
  kk(v) { return (v / 1000).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' k€'; },
  rotuloMes(m) { return this.MESES[Number(m.slice(5)) - 1]; },

  // Abrir o separador: desenha logo (os projetos já estão em memória) e, em segundo plano, carrega o CRM — para as oportunidades
  // ponderadas e para o tipo (I&D/Serviços) dos projetos ligados a uma oportunidade.
  async aoAbrir() {
    this.ligarEventos();
    this.render();
    if (Crm.podeVer() && !Crm.carregado && !Crm.erroCarga) {
      try { await Crm.carregar(); } catch (e) { /* sem CRM: o tipo fica "Sem tipo" */ }
      if (App.abaAtiva === 'previsao') this.render();
    }
  },

  // Tipo efetivo: o definido no projeto; senão o da oportunidade ligada (CRM); senão "Sem tipo" (ver PrevisaoLogica.tipoDeProjeto).
  tipoDoProjeto(p) {
    let tipoCrmNome = '';
    if (Crm.carregado) {
      const op = Crm.d.oportunidades.find(o => o.projeto_id === p.id);
      const t = op && Crm.idx.tipo ? Crm.idx.tipo.get(op.tipo_id) : null;
      tipoCrmNome = t ? t.nome : '';
    }
    return PrevisaoLogica.tipoDeProjeto({ tipoProjeto: p.tipoProjeto, tipoCrmNome });
  },

  // Uma linha por projeto com algo a prever (backlog ou faturas por emitir).
  calcular(hojeISO, meses) {
    const S = App.state;
    const linhas = [], semDados = [], porClassificar = new Map();
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
      // Projeto sem faturação ao cliente (ex.: I&D financiado): conta para o reconhecimento, não para a faturação prevista.
      const fat = p.semFaturacao
        ? { porMes: PrevisaoLogica.vazio(meses), emAtraso: 0, nEmAtraso: 0, foraDoHorizonte: 0, semData: 0, total: 0 }
        : PrevisaoLogica.faturacaoContratada({
          faturas: (p.faturas || []).map(f => ({ dataPrevista: f.dataPrevista, valor: App.valorFatura(f, p), emitida: !!f.emitida })), hojeISO, meses
        });
      const tipoEf = this.tipoDoProjeto(p);
      const base = {
        id: p.id, nome: App.rotuloProjeto(p), tipo: tipoEf.rotulo, tipoOrigem: tipoEf.origem, semFaturacao: !!p.semFaturacao, equipaId: p.equipaId || '', equipa: equipa ? equipa.nome : 'Por atribuir',
        deptId: dept ? dept.id : '', dept: dept ? dept.nome : '', suspenso: p.ativo === false, estado: p.estado, valorVendido: p.valorVendido || 0,
        horasRegistadas, rec, fat
      };
      if (!rec) {
        if (p.estado !== 'Concluído') { semDados.push(base); if (tipoEf.origem !== 'projeto') porClassificar.set(p.id, base); }
        if (fat.total > 0) { linhas.push(base); if (tipoEf.origem !== 'projeto') porClassificar.set(p.id, base); }
        return;
      }
      if (rec.porReconhecer > 0 || fat.total > 0) { linhas.push(base); if (tipoEf.origem !== 'projeto') porClassificar.set(p.id, base); }
    });
    return { linhas, semDados, porClassificar: [...porClassificar.values()] };
  },

  // Oportunidades do CRM no mapa (Fase B). Conta: abertas (valor × probabilidade da etapa, ou 100% no cenário "pipeline a 100%") e
  // ganhas SEM projeto ligado (100%, assinaladas). Ganhas com projeto contam só através do projeto; perdidas ficam de fora.
  // Valor = valor da proposta vigente (reflexo dos orçamentos) se existir, senão o valor estimado.
  oportunidades(hojeISO, meses) {
    const vazio = { linhas: [], defeitos: [], ganhasSemProjeto: [], semValor: [], planoIncompleto: [], estado: 'ok' };
    if (this.filtros.cenario === 'contratado') return Object.assign(vazio, { estado: 'desligado' });
    if (!Crm.podeVer()) return Object.assign(vazio, { estado: 'sem-acesso' });
    if (!Crm.carregado) return Object.assign(vazio, { estado: Crm.erroCarga ? 'erro' : 'a-carregar' });
    const L = PrevisaoLogica, S = App.state, total100 = this.filtros.cenario === 'total';
    const out = vazio;
    Crm.d.oportunidades.forEach(op => {
      const cat = CrmLogica.categoriaDe(op, Crm.idx.etapa);
      if (cat === 'perdida') return;
      if (cat === 'ganha' && op.projeto_id && S.projetos[op.projeto_id]) return;
      const prob = CrmLogica.probabilidadeDe(op, Crm.idx.etapa) / 100;
      const peso = cat === 'ganha' || total100 ? 1 : prob;
      if (!(peso > 0)) return;
      const vigente = CrmLogica.propostaVigente(Crm.d.propostas, op.id);
      const vp = vigente ? Crm.valorProposta(vigente) : 0;
      const valor = vp > 0 ? vp : (Number(op.valor_estimado) || 0);
      const cliente = (Crm.idx.conta.get(op.conta_id) || {}).nome || '';
      const nome = op.titulo + (cliente ? ` (${cliente})` : '');
      if (!(valor > 0)) { out.semValor.push({ id: op.id, nome }); return; }
      const etapa = Crm.idx.etapa.get(op.etapa_id) || {};
      const tipoNome = (Crm.idx.tipo.get(op.tipo_id) || {}).nome;
      const tipoEf = L.tipoDeProjeto({ tipoCrmNome: tipoNome });
      const equipa = op.equipa_id ? S.equipas.find(e => e.id === op.equipa_id) : null;
      const dept = equipa && equipa.departamentoId ? S.departamentos.find(d => d.id === equipa.departamentoId) : null;
      const def = Crm.defeitosDoTipo(op.tipo_id);
      const ini = L.inicioDaOportunidade({ inicioPrevisto: op.inicio_previsto, dataFecho: op.data_prevista_fecho, aposFecho: def.apos, hojeISO });
      const duracao = op.duracao_meses || def.duracao;
      const plano = Crm.planoFaturasDaOp(op.id);
      const r = L.oportunidadeNoMapa({ valor, peso, inicioMes: ini.mes, duracao, plano, atrasoFat: 1, hojeISO, meses });
      const linha = {
        kind: 'op', id: op.id, nome, tipo: tipoEf.rotulo, equipaId: op.equipa_id || '', equipa: equipa ? equipa.nome : 'Por atribuir',
        deptId: dept ? dept.id : '', peso, etapa: etapa.nome || '', valor, valorPonderado: r.total, categoria: cat, rec: { porMes: r.rec }, fat: { porMes: r.fat },
        inicio: ini.mes, inicioOrigem: ini.origem, duracao, duracaoDefinida: !!op.duracao_meses, temPlano: r.temPlano, plano, planoSoma: r.planoSoma,
        fecho: op.data_prevista_fecho || ''
      };
      out.linhas.push(linha);
      if (cat === 'ganha') out.ganhasSemProjeto.push(linha);
      if (ini.origem !== 'definido' || !op.duracao_meses) out.defeitos.push(linha);
      if (r.temPlano && Math.abs(r.planoSoma - 100) > 0.01) out.planoIncompleto.push(linha);
    });
    return out;
  },

  filtrar(linhas) {
    const f = this.filtros;
    return linhas.filter(l => (!f.tipo || l.tipo === f.tipo) && (!f.dept || l.deptId === f.dept) && (!f.equipa || l.equipaId === f.equipa));
  },

  // ---------- desenho ----------
  // Colunas empilhadas: contratado (cheio) + oportunidades (tracejado).
  barras(C, Pn, meses, corC, rotulo) {
    const H = 210, W = 620, pl = 34, pr = 6, pt = 14, pb = 22, n = meses.length;
    const corP = AnaliseHoras.PALETA[1], idPadrao = 'prevHach' + (rotulo.length % 7) + corC.replace(/\W/g, '');
    const tot = meses.map(m => (C[m] + Pn[m]) / 1000);
    const teto = Math.max(10, Math.ceil(Math.max(...tot) / 10) * 10);
    const bw = (W - pl - pr) / n, y = v => pt + (H - pt - pb) * (1 - v / teto), esc = v => (H - pt - pb) * v / teto;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="prev-grafico" role="img" aria-label="${escapeAttr(rotulo)}"><defs><pattern id="${idPadrao}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--branco)"/><rect width="2.4" height="6" fill="${corP}"/></pattern></defs>`;
    [0, .5, 1].forEach(f => { const v = teto * f; s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="prev-grelha"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" class="prev-eixo">${Math.round(v)}</text>`; });
    meses.forEach((m, i) => {
      const x = pl + i * bw + bw * .14, w = bw * .72, hc = esc(C[m] / 1000), hp = esc(Pn[m] / 1000);
      if (i === 0) s += `<rect x="${pl}" y="${pt}" width="${bw}" height="${H - pt - pb}" class="prev-atual"/>`;
      if (hc > 0) s += `<rect x="${x}" y="${H - pb - hc}" width="${w}" height="${hc}" fill="${corC}" rx="2"><title>${this.rotuloMes(m)}/${m.slice(0, 4)} · contratado ${this.kk(C[m])}</title></rect>`;
      if (hp > 0) s += `<rect x="${x}" y="${H - pb - hc - hp}" width="${w}" height="${hp}" fill="url(#${idPadrao})" stroke="${corP}" rx="2"><title>${this.rotuloMes(m)}/${m.slice(0, 4)} · oportunidades ${this.kk(Pn[m])}</title></rect>`;
      s += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle" class="prev-eixo">${this.rotuloMes(m)}</text>`;
      if (tot[i] >= .05) s += `<text x="${x + w / 2}" y="${H - pb - hc - hp - 3}" text-anchor="middle" class="prev-valor">${Math.round(tot[i])}</text>`;
    });
    return s + '</svg>';
  },

  celulas(serie, meses, rgb, tracejado) {
    const max = Math.max(...meses.map(m => serie[m]), 1);
    return meses.map((m, i) => {
      const v = serie[m];
      const a = (0.1 + v / max * 0.4).toFixed(2);
      const estilo = v > 49 ? ` style="${tracejado ? `background-image:repeating-linear-gradient(45deg,rgba(${rgb},${a}) 0 3px,transparent 3px 7px)` : `background:rgba(${rgb},${(0.08 + v / max * 0.34).toFixed(2)})`}"` : '';
      return `<td class="${i === 0 ? 'atual' : ''}"${estilo}>${this.k(v)}</td>`;
    }).join('');
  },

  render() {
    const el = document.getElementById('previsaoCorpo');
    if (!el || !this.podeVer()) return;
    const hoje = DateUtil.todayISO();
    const meses = PrevisaoLogica.mesesHorizonte(hoje, this.filtros.horizonte);
    const { linhas: todas, semDados, porClassificar } = this.calcular(hoje, meses);
    const opsTodas = this.oportunidades(hoje, meses);
    this.desenharFiltros(todas.concat(opsTodas.linhas));
    const linhasC = this.filtrar(todas), linhasO = this.filtrar(opsTodas.linhas);
    const P = AnaliseHoras.PALETA;
    const sc = PrevisaoLogica.somar.bind(PrevisaoLogica);
    const recC = sc(linhasC.map(l => l.rec && l.rec.porMes), meses), fatC = sc(linhasC.map(l => l.fat.porMes), meses);
    const recP = sc(linhasO.map(l => l.rec.porMes), meses), fatP = sc(linhasO.map(l => l.fat.porMes), meses);
    const recT = sc([recC, recP], meses), fatT = sc([fatC, fatP], meses);
    const tot = s => PrevisaoLogica.total(s, meses);
    const sum = (f) => linhasC.reduce((s, l) => s + f(l), 0);
    const backlog = sum(l => l.rec ? l.rec.porReconhecer : 0), semCal = sum(l => l.rec ? l.rec.naoCalendarizado : 0);
    const emAtraso = sum(l => l.fat.emAtraso), nAtraso = sum(l => l.fat.nEmAtraso), semData = sum(l => l.fat.semData), fora = sum(l => l.fat.foraDoHorizonte);
    const nm = meses.length, cen = this.filtros.cenario, comOps = cen !== 'contratado';
    document.querySelectorAll('#prevCenario [data-prev-cenario]').forEach(b => b.setAttribute('aria-pressed', b.dataset.prevCenario === cen ? 'true' : 'false'));
    const rotuloOps = cen === 'total' ? '100%' : 'ponderado';

    // KPIs
    const kpi = (valor, rot, sub) => `<div class="an-kpi"><b>${valor}</b><span>${rot}</span>${sub ? `<small class="prev-sub">${sub}</small>` : ''}</div>`;
    document.getElementById('prevKpis').innerHTML =
      kpi(this.kk(backlog), 'Backlog contratado', 'por reconhecer, todo o plano') +
      (comOps ? kpi(this.kk(tot(recP)), cen === 'total' ? 'Pipeline (100%)' : 'Pipeline ponderado', `a reconhecer nos próximos ${nm} meses`) : '') +
      kpi(this.kk(tot(recT)), 'Reconhecimento previsto', `${comOps ? 'contratado + oportunidades, ' : ''}próximos ${nm} meses`) +
      kpi(this.kk(tot(fatT)), 'Faturação prevista', `${comOps ? 'contratada ' + this.kk(tot(fatC)) + ' + oportunidades ' + this.kk(tot(fatP)) : 'faturas por emitir'}`) +
      kpi(this.kk(semCal), 'Backlog sem calendário', 'sem horas previstas no Gantt');

    // avisos
    const avisos = [];
    const nomes = (lista, n) => lista.slice(0, n).map(l => `<a href="#" data-prev-op="${escapeAttr(l.id)}">${escapeHtml(l.nome)}</a>`).join('; ') + (lista.length > n ? '…' : '');
    if (opsTodas.estado === 'a-carregar') avisos.push('A carregar as oportunidades do CRM…');
    if (opsTodas.estado === 'erro') avisos.push('Não consegui ler o CRM — o mapa mostra só o contratado.');
    if (opsTodas.estado === 'sem-acesso') avisos.push('Sem acesso ao CRM — o mapa mostra só o contratado.');
    if (Crm.carregado && Crm.temPrevisao === false) avisos.push('Os campos de previsão das oportunidades ainda não existem na base de dados (corre <b>supabase/previsao_oportunidades.sql</b>): as oportunidades usam só os defeitos por tipo.');
    if (comOps && opsTodas.defeitos.length) avisos.push(`${opsTodas.defeitos.length} oportunidade(s) usam o início e/ou a duração <b>por defeito</b> do tipo — abre-as e preenche "Previsão de execução" para o mapa ficar mais fiel: ${nomes(opsTodas.defeitos, 5)}.`);
    if (comOps && opsTodas.ganhasSemProjeto.length) avisos.push(`${opsTodas.ganhasSemProjeto.length} oportunidade(s) <b>ganhas ainda sem projeto</b> contam a 100%: ${nomes(opsTodas.ganhasSemProjeto, 4)}.`);
    if (comOps && opsTodas.semValor.length) avisos.push(`${opsTodas.semValor.length} oportunidade(s) abertas sem valor (nem proposta com orçamento) não entram: ${nomes(opsTodas.semValor, 4)}.`);
    if (comOps && opsTodas.planoIncompleto.length) avisos.push(`${opsTodas.planoIncompleto.length} oportunidade(s) com plano de faturas que não soma 100%: ${nomes(opsTodas.planoIncompleto, 4)}.`);
    if (semDados.length) avisos.push(`${semDados.length} projeto(s) sem <b>valor ou horas vendidas</b> não entram no reconhecimento: ${semDados.slice(0, 4).map(l => escapeHtml(l.nome)).join('; ')}${semDados.length > 4 ? '…' : ''}. Num I&amp;D financiado, preenche o Valor vendido com o valor do financiamento (e as Horas vendidas) e marca "Sem faturação ao cliente".`);
    if (semCal > 49) avisos.push(`${this.kk(semCal)} de backlog não têm horas previstas no Gantt (ver "Cobertura" no detalhe) — por isso não aparecem em nenhum mês.`);
    if (nAtraso) avisos.push(`${nAtraso} fatura(s) por emitir (${this.kk(emAtraso)}) já passaram da data prevista — estão contadas no mês atual.`);
    if (semData > 0) avisos.push(`${this.kk(semData)} em faturas por emitir sem data prevista não entram no mapa.`);
    if (fora > 0) avisos.push(`${this.kk(fora)} em faturas estão previstas depois do horizonte escolhido.`);
    document.getElementById('prevAvisos').innerHTML = avisos.map(a => `<div class="prev-aviso">⚠ ${a}</div>`).join('') + this.htmlClassificar(porClassificar);

    // gráficos + legenda
    document.getElementById('prevGrafRec').innerHTML = this.barras(recC, recP, meses, P[0], 'Reconhecimento previsto por mês');
    document.getElementById('prevGrafFat').innerHTML = this.barras(fatC, fatP, meses, P[2], 'Faturação prevista por mês');
    const legenda = (cor) => `<span><i style="background:${cor}"></i>Contratado</span>${comOps ? `<span><i class="prev-hach"></i>Oportunidades (${cen === 'total' ? '100%' : 'ponderadas'})</span>` : ''}<span><i style="background:var(--cinza-100);border:1px solid var(--cinza-300)"></i>Mês atual</span>`;
    document.getElementById('prevLegRec').innerHTML = legenda(P[0]);
    document.getElementById('prevLegFat').innerHTML = legenda(P[2]);

    // mapa
    const anos = [...new Set(meses.map(m => m.slice(0, 4)))];
    const cab1 = '<tr class="ano"><th></th>' + anos.map(a => `<th colspan="${meses.filter(m => m.startsWith(a)).length}">${a}</th>`).join('') + '<th></th></tr>';
    const cab2 = '<tr><th>k€</th>' + meses.map((m, i) => `<th class="${i === 0 ? 'atual' : ''}">${this.rotuloMes(m)}</th>`).join('') + `<th>Total ${nm}m</th></tr>`;
    const linhaSerie = (rot, serie, rgb, tracejado) => `<tr><td>${rot}</td>${this.celulas(serie, meses, rgb, tracejado)}<td><b>${this.k(tot(serie))}</b></td></tr>`;
    const linhaTotal = (rot, serie) => `<tr class="total"><td>${rot}</td>${meses.map((m, i) => `<td class="${i === 0 ? 'atual' : ''}">${this.k(serie[m])}</td>`).join('')}<td><b>${this.k(tot(serie))}</b></td></tr>`;
    const linhaAcum = (ac) => `<tr class="acum"><td>Acumulado</td>${meses.map((m, i) => `<td class="${i === 0 ? 'atual' : ''}">${this.k(ac[m])}</td>`).join('')}<td></td></tr>`;
    const acRec = PrevisaoLogica.acumular(recT, meses), acFat = PrevisaoLogica.acumular(fatT, meses);
    const dif = meses.map(m => acFat[m] - acRec[m]);
    document.getElementById('prevMapa').innerHTML = `<thead>${cab1}${cab2}</thead><tbody>
      <tr class="secao"><td colspan="${nm + 2}">RECONHECIMENTO (trabalho feito)</td></tr>
      ${linhaSerie('Contratado (backlog) <span class="prev-tag">100%</span>', recC, '42,110,166', false)}
      ${comOps ? linhaSerie(`Oportunidades <span class="prev-tag p">${rotuloOps}</span>`, recP, '224,123,57', true) + linhaTotal('Total reconhecimento', recT) : ''}
      ${linhaAcum(acRec)}
      <tr class="secao"><td colspan="${nm + 2}">FATURAÇÃO</td></tr>
      ${linhaSerie('Contratada (faturas por emitir) <span class="prev-tag">100%</span>', fatC, '58,157,107', false)}
      ${comOps ? linhaSerie(`Oportunidades <span class="prev-tag p">${rotuloOps}</span>`, fatP, '224,123,57', true) + linhaTotal('Total faturação', fatT) : ''}
      ${linhaAcum(acFat)}
      <tr class="delta"><td title="Faturação acumulada menos reconhecimento acumulado: positivo = a faturar à frente do trabalho; negativo = trabalho feito por faturar (a partir de hoje)">Faturação − reconhecimento (acum.)</td>${meses.map((m, i) => { const v = dif[i]; return `<td class="${i === 0 ? 'atual ' : ''}${v < -49 ? 'neg' : (v > 49 ? 'pos' : '')}">${Math.abs(v) < 50 ? '–' : (v > 0 ? '+' : '') + this.k(v)}</td>`; }).join('')}<td></td></tr></tbody>`;

    // detalhe (contratados e, se ligado, oportunidades)
    const rec = this.filtros.serie === 'rec';
    document.getElementById('prevSerieRec').setAttribute('aria-pressed', rec ? 'true' : 'false');
    document.getElementById('prevSerieFat').setAttribute('aria-pressed', rec ? 'false' : 'true');
    const itens = linhasC.map(l => Object.assign({ kind: 'c' }, l)).concat(linhasO);
    const serieDe = l => rec ? (l.rec ? l.rec.porMes : PrevisaoLogica.vazio(meses)) : l.fat.porMes;
    const max = Math.max(1, ...itens.flatMap(l => meses.map(m => serieDe(l)[m])));
    const ordenadas = itens.slice().sort((a, b) => (a.kind === b.kind ? 0 : (a.kind === 'c' ? -1 : 1)) || PrevisaoLogica.total(serieDe(b), meses) - PrevisaoLogica.total(serieDe(a), meses) || a.nome.localeCompare(b.nome, 'pt'));
    const cabDet = `<thead><tr><th>Projeto / oportunidade</th><th>Tipo</th><th>Área</th>${comOps ? '<th>Peso</th>' : ''}<th>${rec ? 'Backlog / valor' : 'Por emitir / valor'}</th>${rec ? '<th title="Parte do backlog que tem horas previstas no Gantt">Cobertura</th>' : ''}${meses.map(m => `<th>${this.rotuloMes(m)}</th>`).join('')}<th>Total</th></tr></thead>`;
    const corpoDet = ordenadas.map(l => {
      const s = serieDe(l), op = l.kind === 'op';
      const rgb = op ? '224,123,57' : (rec ? '42,110,166' : '58,157,107');
      const cel = meses.map(m => `<td${s[m] > 49 ? ` style="${op ? `background-image:repeating-linear-gradient(45deg,rgba(${rgb},${(0.1 + s[m] / max * 0.4).toFixed(2)}) 0 3px,transparent 3px 7px)` : `background:rgba(${rgb},${(0.08 + s[m] / max * 0.34).toFixed(2)})`}"` : ''}>${this.k(s[m])}</td>`).join('');
      const cob = !op && l.rec ? Math.round(l.rec.cobertura * 100) : null;
      const ab = this.expandidas.has(l.id);
      let pressup;
      if (op) {
        const dataFim = PrevisaoLogica.addMeses(l.inicio, l.duracao - 1);
        pressup = `${escapeHtml(l.etapa)}${l.categoria === 'ganha' ? ' (ganha, sem projeto)' : ''} · valor ${this.eur(l.valor)} × ${Math.round(l.peso * 100)}% = ${this.eur(l.valorPonderado)} · trabalho de ${this.rotuloMes(l.inicio)}/${l.inicio.slice(0, 4)} a ${this.rotuloMes(dataFim)}/${dataFim.slice(0, 4)} (${l.duracao} meses)${l.inicioOrigem !== 'definido' || !l.duracaoDefinida ? ' — valores por defeito' : ''} · ${l.temPlano ? 'plano de faturas: ' + l.plano.map(p => p.pct + '% em ' + this.rotuloMes(p.mes) + '/' + p.mes.slice(0, 4)).join(', ') : 'sem plano de faturas: a faturação acompanha o trabalho, com 1 mês de atraso'}. <a href="#" data-prev-op="${escapeAttr(l.id)}">Abrir oportunidade</a>`;
      } else {
        pressup = l.rec
          ? `Vendido ${this.eur(l.valorVendido)} · reconhecido até hoje ${this.eur(l.rec.reconhecidoHoje)} (${l.horasRegistadas.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} h registadas) · por reconhecer ${this.eur(l.rec.porReconhecer)} · €/h do projeto ${l.rec.euroHora.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} · o plano do Gantt cobre ${cob}% do backlog (${this.eur(l.rec.naoCalendarizado)} sem horas previstas) · ${l.semFaturacao ? 'sem faturação ao cliente (financiado)' : `faturas por emitir ${this.eur(l.fat.total)}${l.fat.nEmAtraso ? `, ${l.fat.nEmAtraso} em atraso` : ''}`}.`
          : `Sem valor ou horas vendidas — o reconhecimento não se calcula · faturas por emitir ${this.eur(l.fat.total)}.`;
      }
      const valorCol = op ? l.valorPonderado : (rec ? (l.rec ? l.rec.porReconhecer : 0) : l.fat.total);
      const marca = op ? (l.inicioOrigem !== 'definido' || !l.duracaoDefinida ? ' <span class="prev-tag p">defeito</span>' : '') : (l.suspenso ? ' <span class="prev-tag">suspenso</span>' : '') + (l.semFaturacao ? ' <span class="prev-tag">sem faturação</span>' : '');
      return `<tr class="item" data-prev-linha="${escapeAttr(l.id)}"><td>${op ? '🎯 ' : '🔒 '}${escapeHtml(l.nome)}${marca}</td><td>${escapeHtml(l.tipo)}</td><td>${escapeHtml(l.equipa)}</td>
        ${comOps ? `<td>${op ? Math.round(l.peso * 100) + '%' : '100%'}</td>` : ''}<td>${this.k(valorCol)}</td>${rec ? `<td class="${cob !== null && cob < 80 ? 'neg' : ''}">${cob === null ? '–' : cob + '%'}</td>` : ''}${cel}<td><b>${this.k(PrevisaoLogica.total(s, meses))}</b></td></tr>
        <tr class="nota"${ab ? '' : ' hidden'}><td colspan="${nm + 4 + (comOps ? 1 : 0) + (rec ? 1 : 0)}">${pressup}</td></tr>`;
    }).join('');
    document.getElementById('prevDet').innerHTML = cabDet + `<tbody>${corpoDet || `<tr><td colspan="${nm + 5}">Sem projetos nem oportunidades com algo a prever neste filtro.</td></tr>`}</tbody>`;
  },

  // Projetos cujo tipo não está definido no próprio projeto (vem do CRM ou falta): permite classificá-los aqui mesmo.
  htmlClassificar(lista) {
    if (!lista.length) return '';
    const semSql = typeof Sync !== 'undefined' && Sync.temTipoProjeto === false;
    const linhas = lista.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map(l => {
      const p = App.state.projetos[l.id] || {};
      const opt = (v, r) => `<option value="${v}"${(p.tipoProjeto || '') === v ? ' selected' : ''}>${r}</option>`;
      return `<tr><td>${escapeHtml(l.nome)}</td><td class="prev-sub">${l.tipoOrigem === 'crm' ? 'deduzido do CRM: ' + escapeHtml(l.tipo) : 'sem tipo'}</td>
        <td><select data-prev-tipo="${escapeAttr(l.id)}"${semSql ? ' disabled' : ''}>${opt('', 'Por classificar')}${opt('servicos', 'Serviços')}${opt('id', 'I&amp;D')}</select></td>
        <td><label style="display:inline-flex;gap:5px;align-items:center;"><input type="checkbox" data-prev-semfat="${escapeAttr(l.id)}"${p.semFaturacao ? ' checked' : ''}${semSql ? ' disabled' : ''}> sem faturação</label></td></tr>`;
    }).join('');
    return `<details class="prev-classificar"${this.classificarAberto ? ' open' : ''}><summary><b>${lista.length}</b> projeto(s) por classificar (tipo e faturação) — abrir</summary>
      ${semSql ? '<p class="prev-sub" style="margin:6px 0;">Corre primeiro supabase/projeto_tipo.sql no Supabase para poderes classificar aqui.</p>' : '<p class="prev-sub" style="margin:6px 0;">Escolhe o tipo de cada projeto. Um I&amp;D financiado, sem faturação ao cliente, marca-se "sem faturação": continua a contar para o reconhecimento.</p>'}
      <div class="table-scroll"><table class="prev-class">${linhas}</table></div></details>`;
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
    // Mantém aberta a lista de projetos por classificar enquanto se vai classificando (cada alteração volta a desenhar o ecrã).
    raiz.addEventListener('toggle', ev => { if (ev.target.classList && ev.target.classList.contains('prev-classificar')) this.classificarAberto = ev.target.open; }, true);
    raiz.addEventListener('change', ev => {
      const selTipo = ev.target.closest && ev.target.closest('[data-prev-tipo]');
      const chkSem = ev.target.closest && ev.target.closest('[data-prev-semfat]');
      if (selTipo || chkSem) {
        const p = App.state.projetos[(selTipo || chkSem).dataset.prevTipo || (selTipo || chkSem).dataset.prevSemfat];
        if (!p || !App.souAdmin()) return;
        if (selTipo) p.tipoProjeto = selTipo.value || ''; else p.semFaturacao = !!chkSem.checked;
        App.persist();
        this.render();
        return;
      }
      const id = ev.target.id;
      if (id === 'prevTipo') f.tipo = ev.target.value;
      else if (id === 'prevDept') { f.dept = ev.target.value; f.equipa = ''; }
      else if (id === 'prevEquipa') f.equipa = ev.target.value;
      else if (id === 'prevHorizonte') f.horizonte = Number(ev.target.value) || 12;
      else return;
      this.render();
    });
    raiz.addEventListener('click', ev => {
      const abrirOp = ev.target.closest('[data-prev-op]');
      if (abrirOp) { ev.preventDefault(); Crm.irPara('op', abrirOp.dataset.prevOp); return; }
      const cenario = ev.target.closest('[data-prev-cenario]');
      if (cenario) { f.cenario = cenario.dataset.prevCenario; this.render(); return; }
      const serie = ev.target.closest('[data-prev-serie]');
      if (serie) { f.serie = serie.dataset.prevSerie; this.render(); return; }
      if (ev.target.closest('#btnPrevLimpar')) { Object.assign(f, { tipo: '', dept: '', equipa: '' }); this.render(); return; }
      const linha = ev.target.closest('[data-prev-linha]');
      if (linha) { const id = linha.dataset.prevLinha; if (this.expandidas.has(id)) this.expandidas.delete(id); else this.expandidas.add(id); linha.nextElementSibling.hidden = !this.expandidas.has(id); }
    });
  }
};
if (typeof module !== 'undefined') module.exports = Previsao;

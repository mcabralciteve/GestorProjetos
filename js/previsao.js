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
  avisosAbertos: (() => { try { return localStorage.getItem('prevAvisosAbertos') !== '0'; } catch (e) { return true; } })(),
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
    const linhas = [], semDados = [], porClassificar = new Map(), custos = [];
    Object.values(S.projetos).forEach(p => {
      if (p.estado === 'Cancelado') return;
      const equipa = p.equipaId ? S.equipas.find(e => e.id === p.equipaId) : null;
      const dept = equipa && equipa.departamentoId ? S.departamentos.find(d => d.id === equipa.departamentoId) : null;
      const horasRegistadas = S.registos.filter(r => App.registoPertenceAoProjeto(r, p)).reduce((s, r) => s + (parseFloat(r.horas) || 0), 0);
      // Horas por fazer de cada tarefa, também por EQUIPA do consultor (consultor sem equipa, ou que já não existe, conta na equipa do projeto).
      // Ao mesmo tempo, o custo dessas horas por mês e por equipa (custo/hora de cada consultor) — para a rentabilidade.
      const custoEq = {};
      const tarefas = (p.tarefas || []).filter(t => !App.temFilhos(p, t.id) && (t.progresso || 0) < 100).map(t => {
        const horasPorEquipa = {};
        (t.recursoIds || []).forEach(rid => {
          const h = Math.max(0, App.horasAlocadas(t, rid) - App.horasJaRegistadasTarefa(p, t, rid));
          if (!(h > 0)) return;
          const rec = S.recursos.find(r => r.id === rid);
          const eq = (rec && rec.equipaId) || p.equipaId || '';
          horasPorEquipa[eq] = (horasPorEquipa[eq] || 0) + h;
          if (rec && rec.precoCusto > 0) PrevisaoLogica.acumularCusto(custoEq[eq] || (custoEq[eq] = PrevisaoLogica.vazio(meses)), t.inicio, t.fim, h, rec.precoCusto, hojeISO);
        });
        return { inicio: t.inicio, fim: t.fim, horasPorFazer: Object.values(horasPorEquipa).reduce((s, h) => s + h, 0), horasPorEquipa };
      });
      // Um projeto concluído não tem prazo por onde distribuir o que não está no plano: fica fora do mapa (e é assinalado).
      const prazo = p.estado === 'Concluído' ? null : { inicio: p.dataInicio, fim: p.dataFim };
      const rec = PrevisaoLogica.reconhecimentoBacklog({ valorVendido: p.valorVendido, horasVendidas: p.horasVendidas, horasRegistadas, tarefas, prazo, hojeISO, meses });
      // Projeto sem faturação ao cliente (ex.: I&D financiado): conta para o reconhecimento, não para a faturação prevista.
      const fat = p.semFaturacao
        ? { porMes: PrevisaoLogica.vazio(meses), emAtraso: 0, nEmAtraso: 0, foraDoHorizonte: 0, semData: 0, total: 0 }
        : PrevisaoLogica.faturacaoContratada({
          faturas: (p.faturas || []).map(f => ({ dataPrevista: f.dataPrevista, valor: App.valorFatura(f, p), emitida: !!f.emitida })), hojeISO, meses
        });
      const tipoEf = this.tipoDoProjeto(p);
      if (Object.keys(custoEq).length) custos.push({ id: p.id, nome: App.rotuloProjeto(p), tipo: tipoEf.rotulo, comReceita: !!rec, suspenso: p.ativo === false, custoEq });
      const base = {
        id: p.id, nome: App.rotuloProjeto(p), tipo: tipoEf.rotulo, tipoOrigem: tipoEf.origem, semFaturacao: !!p.semFaturacao, equipaId: p.equipaId || '', equipa: equipa ? equipa.nome : 'Por atribuir',
        deptId: dept ? dept.id : '', dept: dept ? dept.nome : '', suspenso: p.ativo === false, estado: p.estado, valorVendido: p.valorVendido || 0,
        horasRegistadas, rec, fat, partes: []
      };
      // O reconhecimento reparte-se pelas equipas dos consultores (a faturação fica toda na equipa do projeto: a fatura é do projeto).
      if (rec) {
        const porEq = PrevisaoLogica.repartirPorEquipa({ rec, tarefas, equipaProjeto: p.equipaId || '', hojeISO, meses });
        base.partes = Object.entries(porEq).map(([eid, r]) => {
          const eq = eid ? S.equipas.find(e => e.id === eid) : null, d = eq && eq.departamentoId ? S.departamentos.find(x => x.id === eq.departamentoId) : null;
          return { equipaId: eid, equipa: eq ? eq.nome : 'Por atribuir', deptId: d ? d.id : '', rec: r };
        }).sort((a, b) => b.rec.porReconhecer - a.rec.porReconhecer);
        if (base.partes.length) base.equipa = base.partes.map(x => x.equipa).join(' + ');
      }
      if (!rec) {
        if (p.estado !== 'Concluído') { semDados.push(base); if (tipoEf.origem !== 'projeto') porClassificar.set(p.id, base); }
        if (fat.total > 0) { linhas.push(base); if (tipoEf.origem !== 'projeto') porClassificar.set(p.id, base); }
        return;
      }
      if (rec.porReconhecer > 0 || fat.total > 0) { linhas.push(base); if (tipoEf.origem !== 'projeto') porClassificar.set(p.id, base); }
    });
    return { linhas, semDados, porClassificar: [...porClassificar.values()], custos };
  },

  // ---------- rentabilidade ----------
  // Uma equipa (id; '' = sem equipa) passa nos filtros de Direção e Área?
  casaEquipa(equipaId) {
    const f = this.filtros;
    if (f.equipa && equipaId !== f.equipa) return false;
    if (!f.dept) return true;
    const e = App.state.equipas.find(x => x.id === equipaId);
    return !!e && e.departamentoId === f.dept;
  },
  // Custo das horas planeadas de cada projeto, só das pessoas que passam nos filtros (e do tipo escolhido).
  filtrarCustos(custos, meses) {
    return custos.filter(c => !this.filtros.tipo || c.tipo === this.filtros.tipo).map(c => {
      const equipas = Object.keys(c.custoEq).filter(eq => this.casaEquipa(eq));
      const porMes = PrevisaoLogica.somar(equipas.map(eq => c.custoEq[eq]), meses);
      return Object.assign({}, c, { porMes, equipas, total: PrevisaoLogica.total(porMes, meses) });
    }).filter(c => c.total > 0.5);
  },
  // Receita das horas planeadas de um reconhecimento: sem a parte distribuída pelo prazo (essa não tem horas, logo não tem custo).
  recPlaneada(rec, meses) { return PrevisaoLogica.diferenca(rec.porMes, rec.porMesSemHoras || {}, meses); },
  // Custos e margens do que está no ecrã. recC / recT: reconhecimento contratado / total (conforme o cenário), já filtrado.
  // semHoras: a parte de recC distribuída pelo prazo (entra na margem da equipa, não na margem dos projetos).
  // O custo da equipa não se separa por tipo de projeto: com esse filtro ligado fica null.
  rentabilidade(hojeISO, meses, custos, recC, recT, semHoras) {
    const L = PrevisaoLogica, S = App.state;
    const recProj = L.diferenca(recC, semHoras || {}, meses);
    const planeado = this.filtrarCustos(custos, meses);
    const planCom = L.somar(planeado.filter(c => c.comReceita).map(c => c.porMes), meses);
    const planSem = L.somar(planeado.filter(c => !c.comReceita).map(c => c.porMes), meses);
    const equipa = this.filtros.tipo ? null : L.custoEquipa({
      pessoas: S.recursos.filter(r => this.casaEquipa(r.equipaId || '')), meses, hojeISO,
      feriados: new Set((S.feriados || []).map(x => x.data)), horasDia: Capacidade.HORAS_DIA
    });
    return {
      planeado, planCom, planSem, equipa, recProj,
      margemEquipa: equipa ? L.diferenca(recT, equipa.porMes, meses) : null,
      margemProj: L.diferenca(recProj, planCom, meses),
      semTrabalho: equipa ? L.diferenca(equipa.porMes, L.somar([planCom, planSem], meses), meses) : null
    };
  },
  pctTexto(margem, receita) {
    const p = PrevisaoLogica.margemPct(margem, receita);
    return p === null ? '–' : (p < -100 ? '< −100%' : Math.round(p) + '%');
  },
  // Linhas "RENTABILIDADE" do mapa mensal.
  htmlMapaRentabilidade(R, meses, recT) {
    const nm = meses.length, tot = s => PrevisaoLogica.total(s, meses), atual = i => i === 0 ? 'atual ' : '';
    const linha = (rot, s, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${rot}</td>${meses.map((m, i) => `<td class="${atual(i)}">${this.k(s[m])}</td>`).join('')}<td><b>${this.k(tot(s))}</b></td></tr>`;
    const sinal = v => v < -49 ? 'neg' : (v > 49 ? 'pos' : '');
    const margem = (rot, s) => `<tr class="total"><td>${rot}</td>${meses.map((m, i) => `<td class="${atual(i)}${sinal(s[m])}">${this.k(s[m])}</td>`).join('')}<td class="${sinal(tot(s))}"><b>${this.k(tot(s))}</b></td></tr>`;
    const pct = (s, r) => `<tr class="acum"><td>Margem %</td>${meses.map((m, i) => `<td class="${atual(i)}">${this.pctTexto(s[m], r[m])}</td>`).join('')}<td>${this.pctTexto(tot(s), tot(r))}</td></tr>`;
    const secao = t => `<tr class="secao"><td colspan="${nm + 2}">${t}</td></tr>`;
    let h = secao('RENTABILIDADE DA EQUIPA (reconhecimento − custo de todas as pessoas)');
    if (!R.equipa) h += `<tr class="acum"><td colspan="${nm + 2}" style="text-align:left;">O custo da equipa não se separa por tipo de projeto — limpa o filtro "Tipo" para o ver.</td></tr>`;
    else {
      const ac = PrevisaoLogica.acumular(R.margemEquipa, meses);
      h += linha('Receita prevista (reconhecimento)', recT) + linha('Custo da equipa', R.equipa.porMes) + margem('Margem da equipa', R.margemEquipa) + pct(R.margemEquipa, recT) +
        `<tr class="acum"><td>Margem acumulada</td>${meses.map((m, i) => `<td class="${atual(i)}${sinal(ac[m])}">${this.k(ac[m])}</td>`).join('')}<td></td></tr>`;
    }
    h += secao('RENTABILIDADE DOS PROJETOS CONTRATADOS (só as horas planeadas)') +
      linha('<span title="Reconhecimento das horas planeadas no Gantt. O backlog sem horas, distribuído pelo prazo, não entra aqui porque não tem custo associado">Receita das horas planeadas</span>', R.recProj) + linha('Custo das horas planeadas', R.planCom) + margem('Margem dos projetos', R.margemProj) + pct(R.margemProj, R.recProj) +
      linha('<span title="Projetos internos ou sem valor/horas vendidas: têm custo mas não têm receita prevista">Custo planeado em projetos sem receita</span>', R.planSem);
    if (R.semTrabalho) h += `<tr class="delta"><td title="Custo da equipa menos o custo de todas as horas planeadas. Negativo = há mais horas planeadas do que capacidade">Custo sem trabalho planeado</td>${meses.map((m, i) => `<td class="${atual(i)}${R.semTrabalho[m] < -49 ? 'neg' : ''}">${this.k(R.semTrabalho[m])}</td>`).join('')}<td>${this.k(tot(R.semTrabalho))}</td></tr>`;
    return h;
  },
  // Detalhe "Margem": uma linha por projeto com receita ou custo planeado, da pior margem para a melhor.
  htmlDetalheMargem(R, meses, linhasC) {
    const L = PrevisaoLogica, tot = s => L.total(s, meses), zero = () => L.vazio(meses);
    const porId = new Map();
    linhasC.filter(l => l.rec).forEach(l => porId.set(l.id, { id: l.id, nome: l.nome, tipo: l.tipo, equipa: l.equipa, rec: this.recPlaneada(l.rec, meses), custo: zero(), comReceita: true, suspenso: l.suspenso }));
    R.planeado.forEach(c => {
      const x = porId.get(c.id) || { id: c.id, nome: c.nome, tipo: c.tipo, equipa: c.equipas.map(eq => (App.state.equipas.find(e => e.id === eq) || {}).nome || 'Por atribuir').join(' + '), rec: zero(), comReceita: c.comReceita, suspenso: c.suspenso };
      x.custo = c.porMes; porId.set(c.id, x);
    });
    const itens = [...porId.values()].map(x => Object.assign(x, { m: L.diferenca(x.rec, x.custo, meses) }))
      .filter(x => tot(x.rec) > 49 || tot(x.custo) > 49)
      .sort((a, b) => tot(a.m) - tot(b.m) || a.nome.localeCompare(b.nome, 'pt'));
    const max = Math.max(1, ...itens.flatMap(x => meses.map(m => Math.abs(x.m[m]))));
    const cab = `<thead><tr><th>Projeto</th><th>Tipo</th><th>Área</th><th title="Reconhecimento das horas planeadas no horizonte (sem o backlog distribuído pelo prazo)">Receita</th><th title="Horas por fazer no Gantt × custo/hora">Custo</th><th>Margem %</th>${meses.map(m => `<th>${this.rotuloMes(m)}</th>`).join('')}<th>Margem</th></tr></thead>`;
    const corpo = itens.map(x => {
      const r = tot(x.rec), c = tot(x.custo), mg = tot(x.m), ab = this.expandidas.has(x.id);
      const cel = meses.map(m => { const v = x.m[m]; const a = (0.08 + Math.abs(v) / max * 0.34).toFixed(2); return `<td class="${v < -49 ? 'neg' : ''}"${Math.abs(v) > 49 ? ` style="background:rgba(${v < 0 ? '214,69,69' : '58,157,107'},${a})"` : ''}>${this.k(v)}</td>`; }).join('');
      const marca = (x.suspenso ? ' <span class="prev-tag">suspenso</span>' : '') + (x.comReceita ? '' : ' <span class="prev-tag">sem receita</span>');
      return `<tr class="item" data-prev-linha="${escapeAttr(x.id)}"><td>${escapeHtml(x.nome)}${marca}</td><td>${escapeHtml(x.tipo)}</td><td>${escapeHtml(x.equipa)}</td><td>${this.k(r)}</td><td>${this.k(c)}</td><td class="${mg < -49 ? 'neg' : ''}">${this.pctTexto(mg, r)}</td>${cel}<td class="${mg < -49 ? 'neg' : ''}"><b>${this.k(mg)}</b></td></tr>
        <tr class="nota"${ab ? '' : ' hidden'}><td colspan="${meses.length + 7}">Receita das horas planeadas no horizonte ${this.eur(r)} · custo das horas planeadas ${this.eur(c)} · margem ${this.eur(mg)}. O custo é o das horas por fazer no Gantt ao custo/hora de cada consultor; horas atrasadas contam no mês atual.${x.comReceita ? '' : ' Projeto sem valor ou horas vendidas: não tem receita prevista.'}</td></tr>`;
    }).join('');
    return cab + `<tbody>${corpo || `<tr><td colspan="${meses.length + 7}">Sem projetos com receita ou horas planeadas neste filtro.</td></tr>`}</tbody>`;
  },

  // Oportunidades do CRM no mapa (Fase B). Conta: abertas (valor × probabilidade da etapa, ou 100% no cenário "pipeline a 100%") e
  // ganhas SEM projeto ligado (100%, assinaladas). Ganhas com projeto contam só através do projeto; perdidas ficam de fora.
  // Valor = valor da proposta vigente (reflexo dos orçamentos) se existir, senão o valor estimado.
  oportunidades(hojeISO, meses) {
    const vazio = { linhas: [], defeitos: [], semFecho: [], ganhasSemProjeto: [], semValor: [], planoIncompleto: [], estado: 'ok' };
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
      const r = L.oportunidadeNoMapa({ valor, peso, inicioMes: ini.mes, duracao, plano, atrasoFat: def.atrasoFat, hojeISO, meses });
      const linha = {
        kind: 'op', id: op.id, nome, tipo: tipoEf.rotulo, equipaId: op.equipa_id || '', equipa: equipa ? equipa.nome : 'Por atribuir',
        deptId: dept ? dept.id : '', peso, etapa: etapa.nome || '', valor, valorPonderado: r.total, categoria: cat, rec: { porMes: r.rec }, fat: { porMes: r.fat },
        inicio: ini.mes, inicioOrigem: ini.origem, duracao, duracaoDefinida: !!op.duracao_meses, temPlano: r.temPlano, plano, planoSoma: r.planoSoma, atrasoFat: def.atrasoFat,
        fecho: op.data_prevista_fecho || ''
      };
      out.linhas.push(linha);
      if (cat === 'ganha') out.ganhasSemProjeto.push(linha);
      // Sem início previsto não é problema: começa N meses depois do fecho (defeito do tipo). Só falta informação quando não há
      // duração, ou quando não há sequer data prevista de fecho de onde partir.
      if (!op.duracao_meses) out.defeitos.push(linha);
      if (ini.origem === 'sem-fecho') out.semFecho.push(linha);
      if (r.temPlano && Math.abs(r.planoSoma - 100) > 0.01) out.planoIncompleto.push(linha);
    });
    return out;
  },

  // Filtra por tipo, direção e área. Nas oportunidades vale a equipa da oportunidade. Num projeto contratado, a ÁREA escolhida vê a parte
  // do reconhecimento que as suas pessoas vão produzir (mesmo que o projeto seja de outra equipa) e, se for a equipa do projeto, as faturas.
  filtrar(linhas) {
    const f = this.filtros;
    const porTipo = linhas.filter(l => !f.tipo || l.tipo === f.tipo);
    if (!f.dept && !f.equipa) return porTipo;
    const casa = (eqId, deptId) => (!f.equipa || eqId === f.equipa) && (!f.dept || deptId === f.dept);
    const out = [];
    porTipo.forEach(l => {
      if (!l.partes) { if (casa(l.equipaId, l.deptId)) out.push(l); return; }       // oportunidade
      const doProjeto = casa(l.equipaId, l.deptId);
      const partes = l.partes.filter(p => casa(p.equipaId, p.deptId));
      if (!partes.length && !(doProjeto && l.fat.total > 0)) return;
      if (partes.length === l.partes.length && doProjeto) { out.push(l); return; }   // o projeto inteiro cabe no filtro
      const meses = Object.keys(l.fat.porMes);
      out.push(Object.assign({}, l, {
        rec: l.rec ? PrevisaoLogica.recDasPartes(l.rec, partes.map(p => p.rec), meses) : l.rec,
        fat: doProjeto ? l.fat : { porMes: PrevisaoLogica.vazio(meses), emAtraso: 0, nEmAtraso: 0, foraDoHorizonte: 0, semData: 0, total: 0 },
        equipa: partes.length ? partes.map(p => p.equipa).join(' + ') : l.equipa, parcial: { doProjeto, equipas: partes.map(p => p.equipa) }
      }));
    });
    return out;
  },

  // ---------- desenho ----------
  // Colunas empilhadas: contratado (cheio) + oportunidades (tracejado).
  barras(C, Pn, meses, corC, rotulo, linhas) {
    const H = 210, W = 620, pl = 34, pr = 6, pt = 14, pb = 22, n = meses.length;
    const corP = AnaliseHoras.PALETA[1], idPadrao = 'prevHach' + (rotulo.length % 7) + corC.replace(/\W/g, '');
    const tot = meses.map(m => (C[m] + Pn[m]) / 1000);
    const extra = (linhas || []).flatMap(l => meses.map(m => l.serie[m] / 1000));
    const teto = Math.max(10, Math.ceil(Math.max(...tot, ...extra) / 10) * 10);
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
    (linhas || []).forEach(l => {
      const pts = meses.map((m, i) => [pl + i * bw + bw / 2, y(l.serie[m] / 1000)]);
      s += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${l.cor}" stroke-width="2"${l.tracejado ? ' stroke-dasharray="5 3"' : ''}/>`;
      pts.forEach((p, i) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${l.cor}"><title>${this.rotuloMes(meses[i])}/${meses[i].slice(0, 4)} · ${l.nome} ${this.kk(l.serie[meses[i]])}</title></circle>`; });
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
    const { linhas: todas, semDados, porClassificar, custos } = this.calcular(hoje, meses);
    const opsTodas = this.oportunidades(hoje, meses);
    this.desenharFiltros(todas.concat(opsTodas.linhas));
    const linhasC = this.filtrar(todas), linhasO = this.filtrar(opsTodas.linhas);
    const P = AnaliseHoras.PALETA;
    const sc = PrevisaoLogica.somar.bind(PrevisaoLogica);
    const recC = sc(linhasC.map(l => l.rec && l.rec.porMes), meses), fatC = sc(linhasC.map(l => l.fat.porMes), meses);
    const recP = sc(linhasO.map(l => l.rec.porMes), meses), fatP = sc(linhasO.map(l => l.fat.porMes), meses);
    const recT = sc([recC, recP], meses), fatT = sc([fatC, fatP], meses);
    const semHoras = sc(linhasC.map(l => l.rec && l.rec.porMesSemHoras), meses);
    const tot = s => PrevisaoLogica.total(s, meses);
    const sum = (f) => linhasC.reduce((s, l) => s + f(l), 0);
    const backlog = sum(l => l.rec ? l.rec.porReconhecer : 0), semCal = sum(l => l.rec ? l.rec.naoCalendarizado : 0);
    const emAtraso = sum(l => l.fat.emAtraso), nAtraso = sum(l => l.fat.nEmAtraso), semData = sum(l => l.fat.semData), fora = sum(l => l.fat.foraDoHorizonte);
    const nm = meses.length, cen = this.filtros.cenario, comOps = cen !== 'contratado';
    const L2 = (a, b, ms) => PrevisaoLogica.somar([a, b], ms);
    document.querySelectorAll('#prevCenario [data-prev-cenario]').forEach(b => b.setAttribute('aria-pressed', b.dataset.prevCenario === cen ? 'true' : 'false'));
    const rotuloOps = cen === 'total' ? '100%' : 'ponderado';
    const R = this.rentabilidade(hoje, meses, custos, recC, recT, semHoras);

    // KPIs
    const kpi = (valor, rot, sub) => `<div class="an-kpi"><b>${valor}</b><span>${rot}</span>${sub ? `<small class="prev-sub">${sub}</small>` : ''}</div>`;
    document.getElementById('prevKpis').innerHTML =
      kpi(this.kk(backlog), 'Backlog contratado', 'por reconhecer, todo o plano') +
      (comOps ? kpi(this.kk(tot(recP)), cen === 'total' ? 'Pipeline (100%)' : 'Pipeline ponderado', `a reconhecer nos próximos ${nm} meses`) : '') +
      kpi(this.kk(tot(recT)), 'Reconhecimento previsto', `${comOps ? 'contratado + oportunidades, ' : ''}próximos ${nm} meses`) +
      kpi(this.kk(tot(fatT)), 'Faturação prevista', `${comOps ? 'contratada ' + this.kk(tot(fatC)) + ' + oportunidades ' + this.kk(tot(fatP)) : 'faturas por emitir'}`) +
      kpi(this.kk(semCal), 'Backlog sem horas no Gantt', 'distribuído até ao fim de cada projeto') +
      kpi(R.equipa ? this.kk(tot(R.equipa.porMes)) : '–', `Custo da equipa (${nm} meses)`, R.equipa ? `${R.equipa.nPessoas} pessoas · mês atual a partir de hoje` : 'não se separa por tipo') +
      kpi(R.equipa ? this.kk(tot(R.margemEquipa)) : '–', 'Margem da equipa', R.equipa ? `${this.pctTexto(tot(R.margemEquipa), tot(recT))} do reconhecimento previsto` : 'não se separa por tipo') +
      kpi(this.kk(tot(R.margemProj)), 'Margem dos projetos', `só horas planeadas: receita − custo · ${this.pctTexto(tot(R.margemProj), tot(R.recProj))}`);

    // avisos
    const avisos = [];
    const nomes = lista => this.listaAviso(lista.map(l => `<a href="#" data-prev-op="${escapeAttr(l.id)}">${escapeHtml(l.nome)}</a>`));
    // Projetos com faturas por emitir no campo pedido (em atraso, sem data, fora do horizonte), com o valor de cada um.
    const comFaturas = campo => this.listaAviso(linhasC.filter(l => l.fat[campo] > 0).sort((a, b) => b.fat[campo] - a.fat[campo])
      .map(l => `${this.ligacao('fatura', l.id, escapeHtml(l.nome))} ${this.eur(l.fat[campo])}`));
    if (opsTodas.estado === 'a-carregar') avisos.push('A carregar as oportunidades do CRM…');
    if (opsTodas.estado === 'erro') avisos.push(`Não consegui ler o CRM — o mapa mostra só o contratado. ${this.ligacao('crm', '', 'Tentar de novo')}.`);
    if (opsTodas.estado === 'sem-acesso') avisos.push('Sem acesso ao CRM — o mapa mostra só o contratado.');
    if (Crm.carregado && Crm.temPrevisao === false) avisos.push('Os campos de previsão das oportunidades ainda não existem na base de dados (corre <b>supabase/previsao_oportunidades.sql</b>): as oportunidades usam só os defeitos por tipo.');
    if (comOps && opsTodas.defeitos.length) avisos.push(`${opsTodas.defeitos.length} oportunidade(s) sem <b>duração</b> definida usam a duração por defeito do tipo — abre-as e preenche "Previsão de execução" para o mapa ficar mais fiel: ${nomes(opsTodas.defeitos)}.`);
    if (comOps && opsTodas.semFecho.length) avisos.push(`${opsTodas.semFecho.length} oportunidade(s) sem <b>data prevista de fecho</b> (nem início previsto) contam a partir do mês seguinte: ${nomes(opsTodas.semFecho)}.`);
    if (comOps && opsTodas.ganhasSemProjeto.length) avisos.push(`${opsTodas.ganhasSemProjeto.length} oportunidade(s) <b>ganhas ainda sem projeto</b> contam a 100%: ${nomes(opsTodas.ganhasSemProjeto)}.`);
    if (comOps && opsTodas.semValor.length) avisos.push(`${opsTodas.semValor.length} oportunidade(s) abertas sem valor (nem proposta com orçamento) não entram: ${nomes(opsTodas.semValor)}.`);
    if (comOps && opsTodas.planoIncompleto.length) avisos.push(`${opsTodas.planoIncompleto.length} oportunidade(s) com plano de faturação que não soma 100%: ${nomes(opsTodas.planoIncompleto)}.`);
    if (semDados.length) avisos.push(`${semDados.length} projeto(s) sem <b>valor ou horas vendidas</b> não entram no reconhecimento: ${this.listaAviso(semDados.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map(l => this.ligacao('valores', l.id, escapeHtml(l.nome))))}. Num I&amp;D financiado, preenche o Valor vendido com o valor do financiamento (e as Horas vendidas) e marca "Sem faturação ao cliente".`);
    avisos.push(...this.avisosSemHoras(linhasC));
    const semCusto = R.equipa ? R.equipa.semCusto : [];
    if (semCusto.length) avisos.push(`${semCusto.length} pessoa(s) <b>sem preço de custo</b> não contam nos custos: ${this.listaAviso(semCusto.map(id => this.ligacao('pessoa', id, escapeHtml((App.state.recursos.find(r => r.id === id) || {}).nome || '?'))))}. Preenche-o na ficha da pessoa (Configurações → Recursos).`);
    if (nAtraso) avisos.push(`${nAtraso} fatura(s) por emitir (${this.kk(emAtraso)}) já passaram da data prevista — estão contadas no mês atual: ${comFaturas('emAtraso')}.`);
    if (semData > 0) avisos.push(`${this.kk(semData)} em faturas por emitir sem data prevista não entram no mapa: ${comFaturas('semData')}.`);
    const maior = this.HORIZONTES.find(h => h > this.filtros.horizonte);
    if (fora > 0) avisos.push(`${this.kk(fora)} em faturas estão previstas depois do horizonte escolhido: ${comFaturas('foraDoHorizonte')}.${maior ? ` ${this.ligacao('horizonte', String(maior), `Ver a ${maior} meses`)}.` : ''}`);
    document.getElementById('prevAvisos').innerHTML = this.htmlAvisos(avisos) + this.htmlClassificar(porClassificar);

    // gráficos + legenda
    document.getElementById('prevGrafRec').innerHTML = this.barras(recC, recP, meses, P[0], 'Reconhecimento previsto por mês');
    document.getElementById('prevGrafFat').innerHTML = this.barras(fatC, fatP, meses, P[2], 'Faturação prevista por mês');
    const legenda = (cor) => `<span><i style="background:${cor}"></i>Contratado</span>${comOps ? `<span><i class="prev-hach"></i>Oportunidades (${cen === 'total' ? '100%' : 'ponderadas'})</span>` : ''}<span><i style="background:var(--cinza-100);border:1px solid var(--cinza-300)"></i>Mês atual</span>`;
    document.getElementById('prevLegRec').innerHTML = legenda(P[0]);
    document.getElementById('prevLegFat').innerHTML = legenda(P[2]);

    // receita vs custo
    const linhasGraf = [{ serie: L2(R.planCom, R.planSem, meses), cor: '#8b5cf6', nome: 'custo das horas planeadas', tracejado: true }];
    if (R.equipa) linhasGraf.unshift({ serie: R.equipa.porMes, cor: '#d64545', nome: 'custo da equipa' });
    document.getElementById('prevGrafMargem').innerHTML = this.barras(recC, recP, meses, P[0], 'Receita prevista e custo por mês', linhasGraf);
    document.getElementById('prevLegMargem').innerHTML = `<span><i style="background:${P[0]}"></i>Receita contratada</span>${comOps ? '<span><i class="prev-hach"></i>Receita de oportunidades</span>' : ''}${R.equipa ? '<span><i style="background:#d64545"></i>Custo da equipa</span>' : ''}<span><i style="background:#8b5cf6"></i>Custo das horas planeadas</span>`;

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
      ${tot(semHoras) > 49 ? `<tr class="acum"><td title="Já incluído na linha do contratado: backlog sem horas previstas no Gantt, repartido pelos dias úteis que faltam até ao fim de cada projeto">↳ do qual sem horas no Gantt</td>${meses.map((m, i) => `<td class="${i === 0 ? 'atual' : ''}">${this.k(semHoras[m])}</td>`).join('')}<td>${this.k(tot(semHoras))}</td></tr>` : ''}
      ${comOps ? linhaSerie(`Oportunidades <span class="prev-tag p">${rotuloOps}</span>`, recP, '224,123,57', true) + linhaTotal('Total reconhecimento', recT) : ''}
      ${linhaAcum(acRec)}
      <tr class="secao"><td colspan="${nm + 2}">FATURAÇÃO</td></tr>
      ${linhaSerie('Contratada (faturas por emitir) <span class="prev-tag">100%</span>', fatC, '58,157,107', false)}
      ${comOps ? linhaSerie(`Oportunidades <span class="prev-tag p">${rotuloOps}</span>`, fatP, '224,123,57', true) + linhaTotal('Total faturação', fatT) : ''}
      ${linhaAcum(acFat)}
      <tr class="delta"><td title="Faturação acumulada menos reconhecimento acumulado: positivo = a faturar à frente do trabalho; negativo = trabalho feito por faturar (a partir de hoje)">Faturação − reconhecimento (acum.)</td>${meses.map((m, i) => { const v = dif[i]; return `<td class="${i === 0 ? 'atual ' : ''}${v < -49 ? 'neg' : (v > 49 ? 'pos' : '')}">${Math.abs(v) < 50 ? '–' : (v > 0 ? '+' : '') + this.k(v)}</td>`; }).join('')}<td></td></tr>${this.htmlMapaRentabilidade(R, meses, recT)}</tbody>`;

    // detalhe (contratados e, se ligado, oportunidades)
    const rec = this.filtros.serie === 'rec';
    const verMargem = this.filtros.serie === 'marg';
    document.getElementById('prevSerieRec').setAttribute('aria-pressed', rec ? 'true' : 'false');
    document.getElementById('prevSerieFat').setAttribute('aria-pressed', this.filtros.serie === 'fat' ? 'true' : 'false');
    document.getElementById('prevSerieMarg').setAttribute('aria-pressed', verMargem ? 'true' : 'false');
    if (verMargem) { document.getElementById('prevDet').innerHTML = this.htmlDetalheMargem(R, meses, linhasC); return; }
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
      const pressup = this.pressupostos(l, cob);
      const valorCol = op ? l.valorPonderado : (rec ? (l.rec ? l.rec.porReconhecer : 0) : l.fat.total);
      const marca = op ? (!l.duracaoDefinida || l.inicioOrigem === 'sem-fecho' ? ' <span class="prev-tag p">defeito</span>' : '') : (l.suspenso ? ' <span class="prev-tag">suspenso</span>' : '') + (l.semFaturacao ? ' <span class="prev-tag">sem faturação</span>' : '');
      return `<tr class="item" data-prev-linha="${escapeAttr(l.id)}"><td>${op ? '🎯 ' : '🔒 '}${escapeHtml(l.nome)}${marca}</td><td>${escapeHtml(l.tipo)}</td><td>${escapeHtml(l.equipa)}</td>
        ${comOps ? `<td>${op ? Math.round(l.peso * 100) + '%' : '100%'}</td>` : ''}<td>${this.k(valorCol)}</td>${rec ? `<td class="${cob !== null && cob < 80 ? 'neg' : ''}">${cob === null ? '–' : cob + '%'}</td>` : ''}${cel}<td><b>${this.k(PrevisaoLogica.total(s, meses))}</b></td></tr>
        <tr class="nota"${ab ? '' : ' hidden'}><td colspan="${nm + 4 + (comOps ? 1 : 0) + (rec ? 1 : 0)}">${pressup}</td></tr>`;
    }).join('');
    document.getElementById('prevDet').innerHTML = cabDet + `<tbody>${corpoDet || `<tr><td colspan="${nm + 5}">Sem projetos nem oportunidades com algo a prever neste filtro.</td></tr>`}</tbody>`;
  },

  // ---------- ligações dos avisos ----------
  // Cada nome de um aviso leva ao sítio onde o assunto se resolve (ver irPara). As oportunidades usam data-prev-op.
  ligacao(destino, id, html) { return `<a href="#" data-prev-ir="${destino}" data-prev-id="${escapeAttr(id)}">${html}</a>`; },
  // Os primeiros "n" ficam à vista; os restantes aparecem ao carregar em "mais N".
  listaAviso(itens, n) {
    const lim = n || 5, visiveis = itens.slice(0, lim).join('; ');
    return itens.length <= lim ? visiveis : `${visiveis}; <a href="#" data-prev-mais>mais ${itens.length - lim}…</a><span hidden>${itens.slice(lim).join('; ')}</span>`;
  },
  // Quem sai da Previsão por uma ligação fica com o botão "Voltar a Previsão" na barra de cima.
  irPara(destino, id) {
    if (destino === 'detalhe') { this.filtros.serie = 'rec'; this.render(); document.getElementById('prevDet').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (destino === 'horizonte') { this.filtros.horizonte = Number(id); this.render(); return; }
    if (destino === 'crm') { Crm.erroCarga = null; this.aoAbrir(); return; }
    if (destino === 'gantt') { App.abrirProjetoNoGantt(id); return; }
    const p = App.state.projetos[id];
    if (destino === 'valores') { App.abrirDadosDoProjeto(id, 'valores', p && p.horasVendidas > 0 ? 'projValorVendido' : 'projHorasVendidas'); return; }
    if (destino === 'prazo') { App.abrirDadosDoProjeto(id, 'prazos', 'projFim'); return; }
    if (destino === 'estado') { App.abrirDadosDoProjeto(id, 'identificacao', 'projEstado'); return; }
    if (destino !== 'fatura' && destino !== 'pessoa') return;
    App.empurrarRetorno({ rotulo: 'Previsão', aba: 'previsao' });
    if (destino === 'fatura') {
      // Sem os filtros de datas ou de registo que lá estivessem, para a fatura do aviso não ficar escondida.
      ['fFatDe', 'fFatAte', 'fFatNumRegisto'].forEach(k => { App.els[k].value = ''; });
      App.irParaFaturacaoDoProjeto(id);
      return;
    }
    App.irParaAba('recursos');
    App.abrirModalPessoa(id);
    const custo = document.getElementById('pessoaCusto');
    if (custo) custo.focus();
  },

  // Avisos sobre o backlog sem horas no Gantt: o que foi distribuído pelo prazo, o que caiu no mês atual (prazo ultrapassado) e o que
  // ficou fora do mapa (projeto concluído ou sem data de fim).
  avisosSemHoras(linhasC) {
    const com = sit => linhasC.filter(l => l.rec && l.rec.situacaoPrazo === sit && l.rec.naoCalendarizado > 0.5)
      .sort((a, b) => b.rec.naoCalendarizado - a.rec.naoCalendarizado);
    const soma = lista => lista.reduce((s, l) => s + l.rec.naoCalendarizado, 0);
    const nomes = (lista, destino) => this.listaAviso(lista.map(l => `${this.ligacao(destino(l), l.id, escapeHtml(l.nome))} ${this.eur(l.rec.naoCalendarizado)}`));
    const prazo = com('prazo'), atraso = com('atraso'), sem = com('sem'), out = [];
    if (soma(prazo) > 49) out.push(`${this.kk(soma(prazo))} de backlog sem horas previstas no Gantt foram distribuídos pelos dias úteis que faltam até ao fim de cada projeto (${this.ligacao('detalhe', '', 'ver "Cobertura" no detalhe')}): ${nomes(prazo, () => 'gantt')}.`);
    if (soma(atraso) > 49) out.push(`${this.kk(soma(atraso))} de backlog sem horas são de projetos com o <b>prazo já ultrapassado</b> e contam no mês atual — atualiza a data de fim: ${nomes(atraso, () => 'prazo')}.`);
    if (soma(sem) > 49) out.push(`${this.kk(soma(sem))} de backlog sem horas <b>não aparecem em nenhum mês</b> (projeto concluído ou sem data de fim): ${nomes(sem, l => l.estado === 'Concluído' ? 'estado' : 'prazo')}.`);
    return out;
  },
  // O destino do backlog sem horas de um projeto, em texto (para os pressupostos).
  destinoSemHoras(rec) {
    if (rec.naoCalendarizado <= 0.5) return '';
    if (rec.situacaoPrazo === 'prazo') return `, distribuídos até ${rec.fimPrazo.split('-').reverse().join('/')}`;
    if (rec.situacaoPrazo === 'atraso') return ', contados no mês atual (prazo ultrapassado)';
    return ', fora do mapa (concluído ou sem data de fim)';
  },

  // Texto (HTML) dos pressupostos de uma linha: contratado ou oportunidade. cob = cobertura do plano (contratados).
  pressupostos(l, cob) {
    const op = l.kind === 'op';
      let pressup;
      if (op) {
        const dataFim = PrevisaoLogica.addMeses(l.inicio, l.duracao - 1);
        pressup = `${escapeHtml(l.etapa)}${l.categoria === 'ganha' ? ' (ganha, sem projeto)' : ''} · valor ${this.eur(l.valor)} × ${Math.round(l.peso * 100)}% = ${this.eur(l.valorPonderado)} · trabalho de ${this.rotuloMes(l.inicio)}/${l.inicio.slice(0, 4)} a ${this.rotuloMes(dataFim)}/${dataFim.slice(0, 4)} (${l.duracao} meses)${!l.duracaoDefinida ? ' — duração por defeito do tipo' : ''}${l.inicioOrigem === 'sem-fecho' ? ' — sem data de fecho: começa no mês seguinte' : ''} · ${l.temPlano ? 'plano de faturação: ' + l.plano.map(p => p.pct + '% (' + PrevisaoLogica.rotuloMarco(p).toLowerCase() + ') em ' + this.rotuloMes(p.mes) + '/' + p.mes.slice(0, 4)).join(', ') : `sem plano de faturação: a faturação acompanha o trabalho, com ${l.atrasoFat} mês(es) de atraso`}. <a href="#" data-prev-op="${escapeAttr(l.id)}">Abrir oportunidade</a>`;
      } else {
        // Reconhecimento repartido pelas equipas dos consultores (quando há mais do que uma).
        const tot = l.partes ? l.partes.reduce((s, x) => s + x.rec.porReconhecer, 0) : 0;
        const reparto = l.partes && l.partes.length > 1 && tot > 0
          ? ` · <b>por equipa</b> (horas por fazer de cada consultor; o que não tem horas previstas fica na equipa do projeto): ${l.partes.map(x => `${escapeHtml(x.equipa)} ${Math.round(x.rec.porReconhecer / tot * 100)}%`).join(' · ')}${l.parcial ? ` — a mostrar só ${l.parcial.equipas.map(escapeHtml).join(' + ') || 'as faturas'}${l.parcial.doProjeto ? '' : ' (as faturas ficam na equipa do projeto)'}` : ''}`
          : '';
        pressup = (l.rec
          ? `Vendido ${this.eur(l.valorVendido)} · reconhecido até hoje ${this.eur(l.rec.reconhecidoHoje)} (${l.horasRegistadas.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} h registadas) · por reconhecer ${this.eur(l.rec.porReconhecer)} · €/h do projeto ${l.rec.euroHora.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} · o plano do Gantt cobre ${cob}% do backlog (${this.eur(l.rec.naoCalendarizado)} sem horas previstas${this.destinoSemHoras(l.rec)}) · ${l.semFaturacao ? 'sem faturação ao cliente (financiado)' : `faturas por emitir ${this.eur(l.fat.total)}${l.fat.nEmAtraso ? `, ${l.fat.nEmAtraso} em atraso` : ''}`}`
          : `Sem valor ou horas vendidas — o reconhecimento não se calcula · faturas por emitir ${this.eur(l.fat.total)}.`) + (l.rec ? reparto + '.' : '');
      }
    return pressup;
  },

  // Exporta para Excel o que está no ecrã (cenário, filtros e horizonte): mapa mensal, reconhecimento e faturação por item, e os
  // pressupostos de cada linha. Valores em euros, arredondados à unidade.
  async exportarExcel() {
    const btn = document.getElementById('btnPrevExportar');
    if (btn) btn.disabled = true;
    try {
      if (typeof XLSX === 'undefined') await App.carregarScript('lib/xlsx.full.min.js');
      const hoje = DateUtil.todayISO(), f = this.filtros, S = App.state;
      const meses = PrevisaoLogica.mesesHorizonte(hoje, f.horizonte);
      const calc = this.calcular(hoje, meses);
      const linhasC = this.filtrar(calc.linhas);
      const ops = this.oportunidades(hoje, meses), linhasO = this.filtrar(ops.linhas);
      const sc = PrevisaoLogica.somar.bind(PrevisaoLogica), tot = s => PrevisaoLogica.total(s, meses), e0 = v => Math.round(v);
      const recC = sc(linhasC.map(l => l.rec && l.rec.porMes), meses), fatC = sc(linhasC.map(l => l.fat.porMes), meses);
      const recP = sc(linhasO.map(l => l.rec.porMes), meses), fatP = sc(linhasO.map(l => l.fat.porMes), meses);
      const recT = sc([recC, recP], meses), fatT = sc([fatC, fatP], meses);
      const semHoras = sc(linhasC.map(l => l.rec && l.rec.porMesSemHoras), meses);
      const comOps = f.cenario !== 'contratado';
      const rot = m => `${this.rotuloMes(m)}/${m.slice(2, 4)}`;
      const nomeDe = (lista, id) => (lista.find(x => x.id === id) || {}).nome || '';
      const cenario = { contratado: 'Só contratado', pond: 'Contratado + oportunidades ponderadas pela probabilidade da etapa', total: 'Contratado + pipeline a 100%' }[f.cenario];
      const linhaSerie = (nome, s) => [nome, ...meses.map(m => e0(s[m])), e0(tot(s))];
      const acum = s => { const a = PrevisaoLogica.acumular(s, meses); return ['Acumulado', ...meses.map(m => e0(a[m])), '']; };
      const mapa = [
        ['Previsão de reconhecimento e faturação'], [`Cenário: ${cenario}`],
        [`Filtros: tipo ${f.tipo || 'todos'} · direção ${f.dept ? nomeDe(S.departamentos, f.dept) : 'todas'} · área ${f.equipa ? nomeDe(S.equipas, f.equipa) : 'todas'} · horizonte ${meses.length} meses`],
        [`Gerado em ${hoje}`], [],
        ['€', ...meses.map(rot), `Total ${meses.length} meses`],
        ['RECONHECIMENTO (trabalho feito)'], linhaSerie('Contratado (backlog)', recC),
        linhaSerie('  do qual sem horas no Gantt (distribuído até ao fim de cada projeto)', semHoras),
        ...(comOps ? [linhaSerie(f.cenario === 'total' ? 'Oportunidades (100%)' : 'Oportunidades (ponderadas)', recP), linhaSerie('Total reconhecimento', recT)] : []),
        acum(recT),
        ['FATURAÇÃO'], linhaSerie('Contratada (faturas por emitir)', fatC),
        ...(comOps ? [linhaSerie(f.cenario === 'total' ? 'Oportunidades (100%)' : 'Oportunidades (ponderadas)', fatP), linhaSerie('Total faturação', fatT)] : []),
        acum(fatT),
        ['Faturação − reconhecimento (acumulado)', ...(() => { const a = PrevisaoLogica.acumular(fatT, meses), b = PrevisaoLogica.acumular(recT, meses); return meses.map(m => e0(a[m] - b[m])); })(), '']
      ];
      const R = this.rentabilidade(hoje, meses, calc.custos, recC, recT, semHoras);
      mapa.push([], ['RENTABILIDADE (sobre o reconhecimento) — custo mensal por pessoa: dias úteis × 8 h × custo/hora; mês atual a partir de hoje'],
        ...(R.equipa ? [linhaSerie('Receita prevista (reconhecimento)', recT), linhaSerie('Custo da equipa', R.equipa.porMes), linhaSerie('Margem da equipa', R.margemEquipa)] : [['Custo da equipa: não se separa por tipo de projeto (filtro Tipo ligado)']]),
        linhaSerie('Receita das horas planeadas', R.recProj), linhaSerie('Custo das horas planeadas', R.planCom), linhaSerie('Margem dos projetos', R.margemProj),
        linhaSerie('Custo planeado em projetos sem receita', R.planSem), ...(R.semTrabalho ? [linhaSerie('Custo sem trabalho planeado', R.semTrabalho)] : []));
      const recPorId = new Map(linhasC.filter(l => l.rec).map(l => [l.id, l]));
      const custoPorId = new Map(R.planeado.map(c => [c.id, c]));
      const margemItens = [['Projeto', 'Indicador', ...meses.map(rot), 'Total'],
        ...[...new Set([...recPorId.keys(), ...custoPorId.keys()])].flatMap(id => {
          const l = recPorId.get(id), c = custoPorId.get(id), nome = (l || c).nome;
          const r = l ? this.recPlaneada(l.rec, meses) : PrevisaoLogica.vazio(meses), k = c ? c.porMes : PrevisaoLogica.vazio(meses);
          return [['Receita das horas planeadas', r], ['Custo', k], ['Margem', PrevisaoLogica.diferenca(r, k, meses)]].map(([ind, s]) => [nome, ind, ...meses.map(m => e0(s[m])), e0(tot(s))]);
        })];
      const itens = linhasC.map(l => Object.assign({ kind: 'c' }, l)).concat(linhasO);
      const porItem = (serie) => [['Origem', 'Item', 'Tipo', 'Área', 'Peso', ...meses.map(rot), 'Total'],
        ...itens.map(l => { const s = serie(l); return [l.kind === 'op' ? 'Oportunidade' : 'Contratado', l.nome, l.tipo, l.equipa, l.kind === 'op' ? Math.round(l.peso * 100) + '%' : '100%', ...meses.map(m => e0(s[m])), e0(tot(s))]; })];
      const txt = h => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const pressup = [['Origem', 'Item', 'Pressupostos'], ...itens.map(l => [l.kind === 'op' ? 'Oportunidade' : 'Contratado', l.nome, txt(this.pressupostos(l, l.kind !== 'op' && l.rec ? Math.round(l.rec.cobertura * 100) : null))])];
      const wb = XLSX.utils.book_new();
      const folha = (nome, aoa, larguras) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = larguras.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, nome); };
      folha('Mapa', mapa, [36, ...meses.map(() => 9), 14]);
      folha('Reconhecimento por item', porItem(l => l.rec ? l.rec.porMes : PrevisaoLogica.vazio(meses)), [14, 46, 14, 14, 8, ...meses.map(() => 9), 11]);
      folha('Faturação por item', porItem(l => l.fat.porMes), [14, 46, 14, 14, 8, ...meses.map(() => 9), 11]);
      folha('Margem por projeto', margemItens, [46, 28, ...meses.map(() => 9), 11]);
      folha('Pressupostos', pressup, [14, 46, 140]);
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      App.descarregarBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Previsao_${hoje}.xlsx`);
      App.toast('Previsão exportada.');
    } catch (err) {
      console.error(err);
      App.toast('Erro ao exportar: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // Projetos cujo tipo não está definido no próprio projeto (vem do CRM ou falta): permite classificá-los aqui mesmo.
  // Os avisos ficam num só bloco que se pode recolher; a escolha fica guardada neste browser (por omissão, aberto).
  htmlAvisos(avisos) {
    if (!avisos.length) return '';
    return `<details class="prev-avisos"${this.avisosAbertos ? ' open' : ''}><summary>⚠ <b>${avisos.length}</b> aviso${avisos.length > 1 ? 's' : ''}</summary>
      ${avisos.map(a => `<div class="prev-aviso">⚠ ${a}</div>`).join('')}</details>`;
  },
  guardarAvisosAbertos(abertos) {
    this.avisosAbertos = abertos;
    try { localStorage.setItem('prevAvisosAbertos', abertos ? '1' : '0'); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
  },

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
    // Mantém aberta a lista de projetos por classificar enquanto se vai classificando (cada alteração volta a desenhar o ecrã),
    // e lembra se os avisos estão abertos ou recolhidos.
    raiz.addEventListener('toggle', ev => {
      const c = ev.target.classList;
      if (!c) return;
      if (c.contains('prev-classificar')) this.classificarAberto = ev.target.open;
      else if (c.contains('prev-avisos')) this.guardarAvisosAbertos(ev.target.open);
    }, true);
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
      if (abrirOp) { ev.preventDefault(); App.empurrarRetorno({ rotulo: 'Previsão', aba: 'previsao' }); Crm.irPara('op', abrirOp.dataset.prevOp); return; }
      const mais = ev.target.closest('[data-prev-mais]');
      if (mais) { ev.preventDefault(); mais.nextElementSibling.hidden = false; mais.remove(); return; }
      const ir = ev.target.closest('[data-prev-ir]');
      if (ir) { ev.preventDefault(); this.irPara(ir.dataset.prevIr, ir.dataset.prevId); return; }
      const cenario = ev.target.closest('[data-prev-cenario]');
      if (cenario) { f.cenario = cenario.dataset.prevCenario; this.render(); return; }
      const serie = ev.target.closest('[data-prev-serie]');
      if (serie) { f.serie = serie.dataset.prevSerie; this.render(); return; }
      if (ev.target.closest('#btnPrevExportar')) { this.exportarExcel(); return; }
      if (ev.target.closest('#btnPrevLimpar')) { Object.assign(f, { tipo: '', dept: '', equipa: '' }); this.render(); return; }
      const linha = ev.target.closest('[data-prev-linha]');
      if (linha) { const id = linha.dataset.prevLinha; if (this.expandidas.has(id)) this.expandidas.delete(id); else this.expandidas.add(id); linha.nextElementSibling.hidden = !this.expandidas.has(id); }
    });
  }
};
if (typeof module !== 'undefined') module.exports = Previsao;

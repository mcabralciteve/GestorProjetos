const Gantt = {
  ROW_H: 32,
  HEADER_H: 36,
  BAR_H: 18,
  BAR_H_RESUMO: 10,
  SVGNS: 'http://www.w3.org/2000/svg',
  PXPERDIA: { dia: 36, semana: 14, mes: 5 },

  render(container, projeto, lista, opts) {
    const pxPerDia = Number(opts.zoom) || this.PXPERDIA[opts.zoom] || 14;
    const { rangeStart, rangeEnd } = this.calcularRange(projeto, lista);
    const totalDias = DateUtil.diffDays(rangeStart, rangeEnd) + 1;
    const totalWidth = Math.max(totalDias * pxPerDia, 400);
    const totalHeight = lista.length * this.ROW_H;

    container.innerHTML = '';
    const headerWrap = document.createElement('div');
    headerWrap.style.position = 'sticky';
    headerWrap.style.top = '0';
    headerWrap.style.zIndex = '3';
    headerWrap.style.background = 'var(--branco)';
    headerWrap.appendChild(this.criarHeaderSVG(rangeStart, totalDias, pxPerDia, totalWidth));
    container.appendChild(headerWrap);

    const bodySvg = this.criarBodySVG(projeto, lista, rangeStart, pxPerDia, totalWidth, totalHeight, opts);
    container.appendChild(bodySvg);

    this.wireInteracoes(bodySvg, projeto, lista, rangeStart, pxPerDia, opts);
  },

  calcularRange(projeto, lista) {
    let datas = [];
    lista.forEach(({ tarefa }) => {
      datas.push(DateUtil.parseISO(tarefa.inicio), DateUtil.parseISO(tarefa.fim));
    });
    if (projeto.dataInicio) datas.push(DateUtil.parseISO(projeto.dataInicio));
    if (projeto.dataFim) datas.push(DateUtil.parseISO(projeto.dataFim));
    // A faturação pode acontecer depois do fim previsto do projeto — o horizonte do Gantt tem de
    // se esticar para a incluir, para os marcadores de fatura nunca ficarem fora de vista.
    (projeto.faturas || []).forEach(f => {
      if (f.dataPrevista) datas.push(DateUtil.parseISO(f.dataPrevista));
    });
    if (datas.length === 0) datas = [new Date(), DateUtil.addDays(new Date(), 30)];
    let min = new Date(Math.min(...datas));
    let max = new Date(Math.max(...datas));
    min = DateUtil.addDays(min, -4);
    max = DateUtil.addDays(max, 10);
    return { rangeStart: min, rangeEnd: max };
  },

  criarSvg(w, h) {
    const svg = document.createElementNS(this.SVGNS, 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.classList.add('gantt-svg');
    return svg;
  },

  criarHeaderSVG(rangeStart, totalDias, pxPerDia, totalWidth) {
    const svg = this.criarSvg(totalWidth, this.HEADER_H);
    svg.style.borderBottom = '1px solid var(--cinza-300)';
    // fundo
    const bg = document.createElementNS(this.SVGNS, 'rect');
    bg.setAttribute('width', totalWidth); bg.setAttribute('height', this.HEADER_H); bg.setAttribute('fill', 'var(--cinza-100)');
    svg.appendChild(bg);

    // fins de semana
    for (let i = 0; i < totalDias; i++) {
      const dia = DateUtil.addDays(rangeStart, i);
      if (dia.getDay() === 0 || dia.getDay() === 6) {
        const r = document.createElementNS(this.SVGNS, 'rect');
        r.setAttribute('x', i * pxPerDia); r.setAttribute('y', 18);
        r.setAttribute('width', pxPerDia); r.setAttribute('height', this.HEADER_H - 18);
        r.setAttribute('class', 'gantt-weekend');
        svg.appendChild(r);
      }
    }

    // linha de meses
    let i = 0;
    while (i < totalDias) {
      const dia = DateUtil.addDays(rangeStart, i);
      const mesAtual = dia.getMonth();
      let j = i;
      while (j < totalDias && DateUtil.addDays(rangeStart, j).getMonth() === mesAtual) j++;
      const larguraMes = (j - i) * pxPerDia;
      const label = document.createElementNS(this.SVGNS, 'text');
      label.setAttribute('x', i * pxPerDia + larguraMes / 2);
      label.setAttribute('y', 13);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'gantt-header-mes');
      label.textContent = dia.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
      svg.appendChild(label);
      if (i > 0) {
        const linha = document.createElementNS(this.SVGNS, 'line');
        linha.setAttribute('x1', i * pxPerDia); linha.setAttribute('x2', i * pxPerDia);
        linha.setAttribute('y1', 0); linha.setAttribute('y2', this.HEADER_H);
        linha.setAttribute('class', 'gantt-grid-line-forte');
        svg.appendChild(linha);
      }
      i = j;
    }

    // ticks de dia/semana
    const passo = pxPerDia >= 26 ? 1 : (pxPerDia >= 9 ? 7 : 30);
    for (let d = 0; d < totalDias; d += passo) {
      const dia = DateUtil.addDays(rangeStart, d);
      const label = document.createElementNS(this.SVGNS, 'text');
      label.setAttribute('x', d * pxPerDia + pxPerDia / 2);
      label.setAttribute('y', 30);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'gantt-header-dia');
      label.textContent = passo === 1 ? String(dia.getDate()) : DateUtil.formatShort(dia);
      svg.appendChild(label);
    }

    const linhaBase = document.createElementNS(this.SVGNS, 'line');
    linhaBase.setAttribute('x1', 0); linhaBase.setAttribute('x2', totalWidth);
    linhaBase.setAttribute('y1', this.HEADER_H - 0.5); linhaBase.setAttribute('y2', this.HEADER_H - 0.5);
    linhaBase.setAttribute('class', 'gantt-grid-line-forte');
    svg.appendChild(linhaBase);

    return svg;
  },

  criarBodySVG(projeto, lista, rangeStart, pxPerDia, totalWidth, totalHeight, opts) {
    const svg = this.criarSvg(totalWidth, Math.max(totalHeight, 40));
    svg.dataset.role = 'gantt-body';

    const defs = document.createElementNS(this.SVGNS, 'defs');
    defs.innerHTML = `<marker id="seta" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--cinza-500)"></path></marker>`;
    svg.appendChild(defs);

    const totalDias = Math.round(totalWidth / pxPerDia);
    for (let i = 0; i < totalDias; i++) {
      const dia = DateUtil.addDays(rangeStart, i);
      if (dia.getDay() === 0 || dia.getDay() === 6) {
        const r = document.createElementNS(this.SVGNS, 'rect');
        r.setAttribute('x', i * pxPerDia); r.setAttribute('y', 0);
        r.setAttribute('width', pxPerDia); r.setAttribute('height', totalHeight);
        r.setAttribute('class', 'gantt-weekend');
        svg.appendChild(r);
      }
    }

    lista.forEach((_, idx) => {
      const linha = document.createElementNS(this.SVGNS, 'line');
      linha.setAttribute('x1', 0); linha.setAttribute('x2', totalWidth);
      linha.setAttribute('y1', (idx + 1) * this.ROW_H); linha.setAttribute('y2', (idx + 1) * this.ROW_H);
      linha.setAttribute('class', 'gantt-grid-line');
      svg.appendChild(linha);
    });

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const offHoje = DateUtil.diffDays(rangeStart, hoje);
    if (offHoje >= 0 && offHoje <= totalDias) {
      const linha = document.createElementNS(this.SVGNS, 'line');
      linha.setAttribute('x1', offHoje * pxPerDia); linha.setAttribute('x2', offHoje * pxPerDia);
      linha.setAttribute('y1', 0); linha.setAttribute('y2', totalHeight);
      linha.setAttribute('class', 'gantt-hoje');
      svg.appendChild(linha);
    }

    (projeto.faturas || []).forEach(f => {
      const data = DateUtil.parseISO(f.dataPrevista);
      if (!data) return;
      const off = DateUtil.diffDays(rangeStart, data);
      if (off < 0 || off > totalDias) return;
      const x = off * pxPerDia;
      const linha = document.createElementNS(this.SVGNS, 'line');
      linha.setAttribute('x1', x); linha.setAttribute('x2', x);
      linha.setAttribute('y1', 0); linha.setAttribute('y2', totalHeight);
      linha.setAttribute('class', 'gantt-fatura-linha');
      svg.appendChild(linha);

      const marca = document.createElementNS(this.SVGNS, 'polygon');
      marca.setAttribute('points', `${x},1 ${x + 5},6 ${x},11 ${x - 5},6`);
      marca.setAttribute('class', 'gantt-fatura-marca' + (f.emitida ? ' emitida' : ''));
      const valor = App.valorFatura(f, projeto);
      const titulo = document.createElementNS(this.SVGNS, 'title');
      titulo.textContent = `Fatura ${DateUtil.formatShort(data)} — ${valor.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €` + (f.emitida ? ` (emitida${f.numeroRegisto ? ', nº ' + f.numeroRegisto : ''})` : ' (prevista)');
      marca.appendChild(titulo);
      svg.appendChild(marca);
    });

    lista.forEach(({ tarefa: t }, idx) => {
      const rowBg = document.createElementNS(this.SVGNS, 'rect');
      rowBg.setAttribute('x', 0); rowBg.setAttribute('y', idx * this.ROW_H);
      rowBg.setAttribute('width', totalWidth); rowBg.setAttribute('height', this.ROW_H);
      const emSelecao = opts.selecionadasIds && opts.selecionadasIds.size ? opts.selecionadasIds.has(t.id) : t.id === opts.selecionadaId;
      rowBg.setAttribute('class', 'gantt-row-bg' + (emSelecao ? ' selecionada' : ''));
      rowBg.dataset.taskId = t.id;
      rowBg.dataset.papel = 'row';
      svg.appendChild(rowBg);
    });

    // dependências
    lista.forEach(({ tarefa: t }) => {
      t.predecessores.forEach(pr => {
        const predIdx = lista.findIndex(x => x.tarefa.id === pr.id);
        const alvoIdx = lista.findIndex(x => x.tarefa.id === t.id);
        if (predIdx < 0 || alvoIdx < 0) return;
        const pred = lista[predIdx].tarefa;
        this.desenharLink(svg, pred, t, predIdx, alvoIdx, rangeStart, pxPerDia, this.ROW_H);
      });
    });

    // barras
    lista.forEach(({ tarefa: t }, idx) => {
      this.desenharBarra(svg, projeto, t, idx, rangeStart, pxPerDia, opts);
    });

    return svg;
  },

  barraGeom(t, rangeStart, pxPerDia, idx) {
    const inicio = DateUtil.parseISO(t.inicio);
    const fim = DateUtil.parseISO(t.fim);
    const x = DateUtil.diffDays(rangeStart, inicio) * pxPerDia;
    const w = Math.max((DateUtil.diffDays(inicio, fim) + 1) * pxPerDia, 4);
    const y = idx * this.ROW_H;
    return { x, w, y };
  },

  desenharLink(svg, pred, alvo, predIdx, alvoIdx, rangeStart, pxPerDia, rowH) {
    const gp = this.barraGeom(pred, rangeStart, pxPerDia, predIdx);
    const ga = this.barraGeom(alvo, rangeStart, pxPerDia, alvoIdx);
    const y1 = gp.y + rowH / 2;
    const y2 = ga.y + rowH / 2;
    const x1 = gp.x + gp.w;
    const x2 = ga.x;
    const midX = x2 > x1 + 10 ? (x1 + x2) / 2 : x1 + 10;
    const path = document.createElementNS(this.SVGNS, 'path');
    const d = `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2 - 4},${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('class', 'gantt-link');
    svg.appendChild(path);
  },

  desenharBarra(svg, projeto, t, idx, rangeStart, pxPerDia, opts) {
    const temFilhos = App.temFilhos(projeto, t.id);
    const { x, w, y } = this.barraGeom(t, rangeStart, pxPerDia, idx);
    const altura = temFilhos ? this.BAR_H_RESUMO : this.BAR_H;
    const barY = y + (this.ROW_H - altura) / 2;
    const hojeISO = DateUtil.todayISO();
    const atrasada = t.fim < hojeISO && t.progresso < 100;

    const g = document.createElementNS(this.SVGNS, 'g');
    g.dataset.taskId = t.id;
    g.dataset.temFilhos = temFilhos ? '1' : '0';

    const bar = document.createElementNS(this.SVGNS, 'rect');
    bar.setAttribute('x', x); bar.setAttribute('y', barY);
    bar.setAttribute('width', w); bar.setAttribute('height', altura);
    bar.setAttribute('rx', 4);
    bar.setAttribute('class', 'gantt-bar ' + (atrasada ? 'atrasada' : (temFilhos ? 'resumo' : (t.parentId ? 'subtarefa' : 'tarefa'))));
    bar.dataset.papel = 'bar';
    bar.dataset.taskId = t.id;
    g.appendChild(bar);

    if (t.progresso > 0) {
      const prog = document.createElementNS(this.SVGNS, 'rect');
      prog.setAttribute('x', x); prog.setAttribute('y', barY);
      prog.setAttribute('width', Math.max(w * (t.progresso / 100), 0)); prog.setAttribute('height', altura);
      prog.setAttribute('rx', 4);
      prog.setAttribute('class', 'gantt-bar-prog');
      prog.style.pointerEvents = 'none';
      g.appendChild(prog);
    }

    if (w > 30) {
      const label = document.createElementNS(this.SVGNS, 'text');
      label.setAttribute('x', x + w / 2); label.setAttribute('y', barY + altura / 2 + 4);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'gantt-label-progresso');
      label.style.pointerEvents = 'none';
      label.textContent = t.progresso + '%';
      g.appendChild(label);
    }

    const nomeLabel = document.createElementNS(this.SVGNS, 'text');
    nomeLabel.setAttribute('x', x + w + 6); nomeLabel.setAttribute('y', barY + altura / 2 + 4);
    nomeLabel.setAttribute('class', 'gantt-label');
    nomeLabel.style.pointerEvents = 'none';
    nomeLabel.textContent = t.nome;
    g.appendChild(nomeLabel);

    if (!temFilhos) {
      const handleL = document.createElementNS(this.SVGNS, 'rect');
      handleL.setAttribute('x', x - 3); handleL.setAttribute('y', barY);
      handleL.setAttribute('width', 6); handleL.setAttribute('height', altura);
      handleL.setAttribute('class', 'gantt-handle');
      handleL.dataset.papel = 'handle'; handleL.dataset.lado = 'esq'; handleL.dataset.taskId = t.id;
      g.appendChild(handleL);

      const handleR = document.createElementNS(this.SVGNS, 'rect');
      handleR.setAttribute('x', x + w - 3); handleR.setAttribute('y', barY);
      handleR.setAttribute('width', 6); handleR.setAttribute('height', altura);
      handleR.setAttribute('class', 'gantt-handle');
      handleR.dataset.papel = 'handle'; handleR.dataset.lado = 'dir'; handleR.dataset.taskId = t.id;
      g.appendChild(handleR);

      const conector = document.createElementNS(this.SVGNS, 'circle');
      conector.setAttribute('cx', x + w + 8 + t.nome.length * 0); conector.setAttribute('cy', barY + altura / 2);
      conector.setAttribute('r', 4.5);
      conector.setAttribute('class', 'gantt-connector');
      conector.dataset.papel = 'conector'; conector.dataset.taskId = t.id;
      // posiciona o conector encostado à barra, texto do nome fica atrás; usa offset fixo curto
      conector.setAttribute('cx', x + w + 8);
      g.appendChild(conector);
    }

    svg.appendChild(g);
  },

  wireInteracoes(svg, projeto, lista, rangeStart, pxPerDia, opts) {
    let drag = null;
    let linkTemp = null;

    const posSvg = (evt) => {
      const rect = svg.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    };

    svg.addEventListener('pointerdown', (e) => {
      const alvo = e.target;
      const papel = alvo.dataset ? alvo.dataset.papel : null;
      const taskId = alvo.dataset && alvo.dataset.taskId ? alvo.dataset.taskId : null;
      if (taskId === null) return;
      const t = App.tarefaPorId(projeto, taskId);
      if (!t) return;
      if (!App.possoEditarProjeto(projeto.id)) { App.selecionarTarefa(taskId); return; }

      if (papel === 'conector') {
        drag = { tipo: 'link', origemId: taskId };
        const p0 = posSvg(e);
        linkTemp = document.createElementNS(Gantt.SVGNS, 'path');
        linkTemp.setAttribute('class', 'gantt-link temp');
        linkTemp.dataset.origem = p0.x + ',' + p0.y;
        svg.appendChild(linkTemp);
        e.preventDefault();
        return;
      }
      if (App.temFilhos(projeto, taskId)) { App.selecionarTarefa(taskId); return; }

      if (papel === 'handle') {
        drag = { tipo: 'resize', taskId, lado: alvo.dataset.lado, startX: e.clientX, inicioOrig: t.inicio, fimOrig: t.fim, moveu: false };
        e.preventDefault();
      } else if (papel === 'bar' || papel === 'row') {
        drag = { tipo: 'mover', taskId, startX: e.clientX, inicioOrig: t.inicio, fimOrig: t.fim, moveu: false };
        e.preventDefault();
      }
    });

    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.tipo === 'link') {
        const rect = svg.getBoundingClientRect();
        const p0 = drag.origemId != null ? null : null;
        const origemTask = App.tarefaPorId(projeto, drag.origemId);
        const idxOrigem = lista.findIndex(x => x.tarefa.id === drag.origemId);
        const g0 = Gantt.barraGeom(origemTask, rangeStart, pxPerDia, idxOrigem);
        const x1 = g0.x + g0.w, y1 = g0.y + Gantt.ROW_H / 2;
        const x2 = e.clientX - rect.left, y2 = e.clientY - rect.top;
        linkTemp.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
        return;
      }
      const deltaPx = e.clientX - drag.startX;
      const deltaDias = Math.round(deltaPx / pxPerDia);
      if (deltaDias !== 0) drag.moveu = true;
      const inicioOrig = DateUtil.parseISO(drag.inicioOrig);
      const fimOrig = DateUtil.parseISO(drag.fimOrig);
      let novoInicio = inicioOrig, novoFim = fimOrig;
      if (drag.tipo === 'mover') {
        novoInicio = DateUtil.addDays(inicioOrig, deltaDias);
        novoFim = DateUtil.addDays(fimOrig, deltaDias);
      } else if (drag.tipo === 'resize' && drag.lado === 'esq') {
        novoInicio = DateUtil.addDays(inicioOrig, deltaDias);
        if (novoInicio > fimOrig) novoInicio = fimOrig;
      } else if (drag.tipo === 'resize' && drag.lado === 'dir') {
        novoFim = DateUtil.addDays(fimOrig, deltaDias);
        if (novoFim < inicioOrig) novoFim = inicioOrig;
      }
      const g = svg.querySelector(`g[data-task-id="${drag.taskId}"]`);
      if (g) {
        const bar = g.querySelector('[data-papel="bar"]');
        const altura = parseFloat(bar.getAttribute('height'));
        const barY = parseFloat(bar.getAttribute('y'));
        const x = DateUtil.diffDays(rangeStart, novoInicio) * pxPerDia;
        const w = Math.max((DateUtil.diffDays(novoInicio, novoFim) + 1) * pxPerDia, 4);
        bar.setAttribute('x', x); bar.setAttribute('width', w);
        const prog = g.querySelector('.gantt-bar-prog');
        if (prog) { prog.setAttribute('x', x); }
        const label = g.querySelector('.gantt-label');
        if (label) label.setAttribute('x', x + w + 6);
        const hl = g.querySelector('[data-lado="esq"]'); if (hl) hl.setAttribute('x', x - 3);
        const hr = g.querySelector('[data-lado="dir"]'); if (hr) hr.setAttribute('x', x + w - 3);
        const conector = g.querySelector('[data-papel="conector"]'); if (conector) conector.setAttribute('cx', x + w + 8);
      }
      drag._novoInicio = DateUtil.toISO(novoInicio);
      drag._novoFim = DateUtil.toISO(novoFim);
    });

    document.addEventListener('pointerup', (e) => {
      if (!drag) return;
      if (drag.tipo === 'link') {
        if (linkTemp) linkTemp.remove();
        linkTemp = null;
        const alvoEl = document.elementFromPoint(e.clientX, e.clientY);
        const destTaskId = alvoEl && alvoEl.dataset ? alvoEl.dataset.taskId : null;
        if (destTaskId && destTaskId !== drag.origemId) {
          if (App.temFilhos(projeto, destTaskId)) {
            App.toast('Tarefas-resumo não podem ter predecessoras.');
          } else {
            if (App.adicionarPredecessor(destTaskId, drag.origemId, 'FS', 0)) {
              App.renderTudo();
            }
          }
        }
        drag = null;
        return;
      }
      if (drag.moveu) {
        App.moverTarefa(drag.taskId, drag._novoInicio || drag.inicioOrig, drag._novoFim || drag.fimOrig);
      } else {
        App.selecionarTarefa(drag.taskId);
      }
      drag = null;
    });
  }
};

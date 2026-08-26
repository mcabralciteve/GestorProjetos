const PortfolioGantt = {
  ROW_H: 32,

  // "linhas": array de { tipo:'projeto', projeto } | { tipo:'tarefa', projeto, tarefa }
  // "colapsados": Set opcional de IDs de projeto cujas tarefas devem ficar escondidas.
  construirLinhas(projetos, colapsados) {
    const linhas = [];
    projetos.forEach(p => {
      linhas.push({ tipo: 'projeto', projeto: p });
      if (colapsados && colapsados.has(p.id)) return;
      p.tarefas.filter(t => t.parentId === null).forEach(t => linhas.push({ tipo: 'tarefa', projeto: p, tarefa: t }));
    });
    return linhas;
  },

  calcularRange(linhas) {
    let datas = [];
    linhas.forEach(l => {
      if (l.tipo === 'projeto') {
        if (l.projeto.dataInicio) datas.push(DateUtil.parseISO(l.projeto.dataInicio));
        if (l.projeto.dataFim) datas.push(DateUtil.parseISO(l.projeto.dataFim));
      } else {
        datas.push(DateUtil.parseISO(l.tarefa.inicio), DateUtil.parseISO(l.tarefa.fim));
      }
    });
    if (!datas.length) datas = [new Date(), DateUtil.addDays(new Date(), 30)];
    let rangeStart = new Date(Math.min(...datas));
    let rangeEnd = new Date(Math.max(...datas));
    rangeStart = DateUtil.addDays(rangeStart, -4);
    rangeEnd = DateUtil.addDays(rangeEnd, 10);
    return { rangeStart, rangeEnd };
  },

  render(container, projetos, opts) {
    const pxPerDia = Number(opts.zoom) || Gantt.PXPERDIA[opts.zoom] || 14;
    const linhas = this.construirLinhas(projetos, opts.colapsados);
    const { rangeStart, rangeEnd } = this.calcularRange(linhas);
    const totalDias = DateUtil.diffDays(rangeStart, rangeEnd) + 1;
    const totalWidth = Math.max(totalDias * pxPerDia, 400);
    const totalHeight = Math.max(linhas.length * this.ROW_H, 40);

    container.innerHTML = '';
    if (!linhas.length) {
      container.innerHTML = '<p style="color:#9ca3af;padding:12px;">Seleciona pelo menos um projeto.</p>';
      return;
    }

    const headerWrap = document.createElement('div');
    headerWrap.style.position = 'sticky';
    headerWrap.style.top = '0';
    headerWrap.style.zIndex = '3';
    headerWrap.style.background = '#fff';
    headerWrap.appendChild(Gantt.criarHeaderSVG(rangeStart, totalDias, pxPerDia, totalWidth));
    container.appendChild(headerWrap);

    const svg = Gantt.criarSvg(totalWidth, totalHeight);

    for (let i = 0; i < totalDias; i++) {
      const dia = DateUtil.addDays(rangeStart, i);
      if (dia.getDay() === 0 || dia.getDay() === 6) {
        const r = document.createElementNS(Gantt.SVGNS, 'rect');
        r.setAttribute('x', i * pxPerDia); r.setAttribute('y', 0);
        r.setAttribute('width', pxPerDia); r.setAttribute('height', totalHeight);
        r.setAttribute('class', 'gantt-weekend');
        svg.appendChild(r);
      }
    }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const offHoje = DateUtil.diffDays(rangeStart, hoje);
    if (offHoje >= 0 && offHoje <= totalDias) {
      const linha = document.createElementNS(Gantt.SVGNS, 'line');
      linha.setAttribute('x1', offHoje * pxPerDia); linha.setAttribute('x2', offHoje * pxPerDia);
      linha.setAttribute('y1', 0); linha.setAttribute('y2', totalHeight);
      linha.setAttribute('class', 'gantt-hoje');
      svg.appendChild(linha);
    }

    linhas.forEach((l, idx) => {
      const y = idx * this.ROW_H;
      const rowBg = document.createElementNS(Gantt.SVGNS, 'rect');
      rowBg.setAttribute('x', 0); rowBg.setAttribute('y', y);
      rowBg.setAttribute('width', totalWidth); rowBg.setAttribute('height', this.ROW_H);
      rowBg.setAttribute('class', 'gantt-row-bg' + (l.tipo === 'projeto' ? ' par' : ''));
      svg.appendChild(rowBg);

      if (l.tipo === 'projeto') {
        const p = l.projeto;
        const inicio = DateUtil.parseISO(p.dataInicio), fim = DateUtil.parseISO(p.dataFim);
        const x = DateUtil.diffDays(rangeStart, inicio) * pxPerDia;
        const w = Math.max((DateUtil.diffDays(inicio, fim) + 1) * pxPerDia, 4);
        const alturaBarra = 10;
        const barY = y + (this.ROW_H - alturaBarra) / 2;
        const bar = document.createElementNS(Gantt.SVGNS, 'rect');
        bar.setAttribute('x', x); bar.setAttribute('y', barY);
        bar.setAttribute('width', w); bar.setAttribute('height', alturaBarra); bar.setAttribute('rx', 3);
        bar.setAttribute('class', 'gantt-bar resumo');
        svg.appendChild(bar);
        const label = document.createElementNS(Gantt.SVGNS, 'text');
        label.setAttribute('x', 6); label.setAttribute('y', y + this.ROW_H / 2 + 4);
        label.setAttribute('class', 'gantt-label');
        label.style.fontWeight = '700';
        label.textContent = `${p.idInterno || ''} — ${p.nome}`;
        svg.appendChild(label);
      } else {
        const t = l.tarefa;
        const filhos = App.temFilhos(l.projeto, t.id);
        const inicio = DateUtil.parseISO(t.inicio), fim = DateUtil.parseISO(t.fim);
        const x = DateUtil.diffDays(rangeStart, inicio) * pxPerDia;
        const w = Math.max((DateUtil.diffDays(inicio, fim) + 1) * pxPerDia, 4);
        const altura = 16;
        const barY = y + (this.ROW_H - altura) / 2;
        const hojeISO = DateUtil.todayISO();
        const atrasada = t.fim < hojeISO && t.progresso < 100;
        const bar = document.createElementNS(Gantt.SVGNS, 'rect');
        bar.setAttribute('x', x); bar.setAttribute('y', barY);
        bar.setAttribute('width', w); bar.setAttribute('height', altura); bar.setAttribute('rx', 4);
        bar.setAttribute('class', 'gantt-bar ' + (atrasada ? 'atrasada' : (filhos ? 'resumo' : 'tarefa')));
        svg.appendChild(bar);
        if (t.progresso > 0) {
          const prog = document.createElementNS(Gantt.SVGNS, 'rect');
          prog.setAttribute('x', x); prog.setAttribute('y', barY);
          prog.setAttribute('width', Math.max(w * (t.progresso / 100), 0)); prog.setAttribute('height', altura);
          prog.setAttribute('rx', 4);
          prog.setAttribute('class', 'gantt-bar-prog');
          svg.appendChild(prog);
        }
        const label = document.createElementNS(Gantt.SVGNS, 'text');
        label.setAttribute('x', x + w + 6); label.setAttribute('y', barY + altura / 2 + 4);
        label.setAttribute('class', 'gantt-label');
        label.textContent = t.nome;
        svg.appendChild(label);
      }
    });

    container.appendChild(svg);
  }
};

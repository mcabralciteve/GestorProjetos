const Capacidade = {
  HORAS_DIA: 8,

  ehFimDeSemana(date) {
    const dow = date.getDay();
    return dow === 0 || dow === 6;
  },
  ehFeriado(date) {
    const iso = DateUtil.toISO(date);
    return App.state.feriados.some(f => f.data === iso);
  },
  ehAusente(date, recursoId) {
    const iso = DateUtil.toISO(date);
    return App.state.ausencias.some(a => a.recursoId === recursoId && iso >= a.dataInicio && iso <= a.dataFim);
  },
  // Um dia útil = 8 horas, 100% alocáveis a projetos (sem redução por taxa de utilização).
  capacidadeDiaria(date, recurso) {
    if (this.ehFimDeSemana(date) || this.ehFeriado(date) || this.ehAusente(date, recurso.id)) return 0;
    return this.HORAS_DIA;
  },

  tarefasAtivasNoDia(date, recursoId) {
    const iso = DateUtil.toISO(date);
    const out = [];
    Object.values(App.state.projetos).forEach(p => {
      p.tarefas.forEach(t => {
        if (!t.recursoIds.includes(recursoId)) return;
        if (App.temFilhos(p, t.id)) return;
        if (iso >= t.inicio && iso <= t.fim) out.push({ projeto: p, tarefa: t });
      });
    });
    return out;
  },
  // Cada tarefa contribui HORAS_DIA × (percentagem de alocação do recurso nessa tarefa / 100)
  // — por omissão 100% (tempo inteiro) quando a tarefa não define uma percentagem específica.
  alocacaoDiaria(date, recursoId) {
    return this.tarefasAtivasNoDia(date, recursoId).reduce((soma, x) => {
      return soma + this.HORAS_DIA * (App.pctAlocacao(x.tarefa, recursoId) / 100);
    }, 0);
  },

  // Total de horas livres deste recurso em todo o período [inicioISO, fimISO] — soma, dia a dia, a
  // capacidade não ocupada pelas suas OUTRAS tarefas (exclui "taskId"); dias sem capacidade
  // (fim de semana/feriado/ausência) não contribuem capacidade nenhuma, tratados à parte no aviso
  // de indisponibilidade. É o teto que se pode escrever no campo de horas desta tarefa sem
  // ultrapassar 100% de ocupação em nenhum dia. Devolve null se o período não tiver dias úteis.
  capacidadeLivreHoras(recurso, taskId, inicioISO, fimISO) {
    const inicio = DateUtil.parseISO(inicioISO), fim = DateUtil.parseISO(fimISO);
    let livre = null;
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      if (livre === null) livre = 0;
      const cap = this.capacidadeDiaria(d, recurso);
      if (cap === 0) continue;
      const outras = this.tarefasAtivasNoDia(d, recurso.id).filter(x => x.tarefa.id !== taskId);
      const outrasHoras = outras.reduce((soma, x) => soma + this.HORAS_DIA * (App.pctAlocacao(x.tarefa, recurso.id) / 100), 0);
      livre += Math.max(0, cap - outrasHoras);
    }
    return livre;
  },
  // Se o recurso tiver dias indisponíveis (feriado/ausência) dentro de [inicioISO, fimISO], calcula
  // até quando estender o fim da tarefa para "recuperar" esses dias úteis perdidos — anda dia a dia
  // a partir do fim original, contando dias úteis com capacidade, até compensar o nº de dias perdidos.
  // Devolve null se não houver nenhum dia indisponível (não é preciso estender nada).
  calcularFimComCompensacao(recurso, inicioISO, fimISO) {
    const inicio = DateUtil.parseISO(inicioISO), fimOriginal = DateUtil.parseISO(fimISO);
    let perdidos = 0;
    for (let d = new Date(inicio); d <= fimOriginal; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      if (this.capacidadeDiaria(d, recurso) === 0) perdidos++;
    }
    if (perdidos === 0) return null;
    let d = DateUtil.addDays(fimOriginal, 1);
    let recuperados = 0;
    let novoFim = fimOriginal;
    while (recuperados < perdidos) {
      if (!this.ehFimDeSemana(d) && this.capacidadeDiaria(d, recurso) > 0) recuperados++;
      novoFim = d;
      d = DateUtil.addDays(d, 1);
    }
    return novoFim;
  },

  // Resume capacidade/alocação de um recurso num intervalo de dias (dias úteis apenas).
  // "diasConflito" conta dias com um problema real: trabalho agendado num dia indisponível
  // (feriado/ausência), ou mais do que uma tarefa a tempo inteiro no mesmo dia.
  resumoPeriodo(recurso, inicio, fim) {
    let capacidade = 0, alocado = 0, diasConflito = 0;
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      const cap = this.capacidadeDiaria(d, recurso);
      const aloc = this.alocacaoDiaria(d, recurso.id);
      capacidade += cap;
      alocado += aloc;
      if (cap === 0) { if (aloc > 0) diasConflito++; }
      else if (aloc > this.HORAS_DIA) diasConflito++;
    }
    const pct = capacidade > 0 ? (alocado / capacidade) : (alocado > 0 ? Infinity : 0);
    return { capacidade, alocado, pct, diasConflito };
  },
  resumoMes(recurso, ano, mes) {
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    return this.resumoPeriodo(recurso, new Date(ano, mes, 1), new Date(ano, mes, diasNoMes));
  },
  mesesEntre(inicio, fim) {
    const out = [];
    let cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
    const limite = new Date(fim.getFullYear(), fim.getMonth(), 1);
    while (cursor <= limite) {
      out.push({ ano: cursor.getFullYear(), mes: cursor.getMonth(), label: cursor.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' }) });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return out;
  },

  horizonteMeses(nMeses) {
    const out = [];
    const hoje = new Date();
    for (let i = 0; i < nMeses; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      out.push({ ano: d.getFullYear(), mes: d.getMonth(), label: d.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' }) });
    }
    return out;
  },

  projetosDoRecurso(recursoId) {
    const out = [];
    Object.values(App.state.projetos).forEach(p => {
      const tarefas = p.tarefas.filter(t => t.recursoIds.includes(recursoId) && !App.temFilhos(p, t.id));
      if (tarefas.length === 0) return;
      const inicio = tarefas.reduce((min, t) => t.inicio < min ? t.inicio : min, tarefas[0].inicio);
      const fim = tarefas.reduce((max, t) => t.fim > max ? t.fim : max, tarefas[0].fim);
      out.push({ projeto: p, inicio, fim, numTarefas: tarefas.length });
    });
    return out;
  },

  // Classificação visual (heatmap/cartões/badges) a partir de um resumo: só é "crítico" quando
  // existem dias de conflito real; caso contrário reflete apenas o nível de ocupação.
  classeResumo(resumo) {
    if (resumo.diasConflito > 0) return 'critico';
    if (resumo.pct >= 0.8) return 'aviso';
    if (resumo.pct > 0) return 'ok';
    return 'vazio';
  },

  // Avalia a atribuição de um recurso a uma tarefa (intervalo [inicioISO, fimISO]).
  // "projetoId" é necessário porque os IDs de tarefa só são únicos dentro do próprio projeto.
  // SIMULA esta tarefa como atribuída ao recurso mesmo que ainda não esteja — para que o modal
  // "Associar recursos" avise corretamente de conflitos antes de a atribuição ser confirmada, não
  // só depois. "taskId" é excluído da contagem de "outras tarefas" e recontado à parte, para não
  // duplicar quando já está atribuída.
  // "Crítico" só dispara em dois casos: (1) duplo agendamento real — noutra tarefa a mesma pessoa já
  // está comprometida a tempo inteiro no mesmo dia disponível; ou (2) o total de horas pedido no
  // período excede o total de horas realmente disponíveis nesse período (já descontando fins de
  // semana/feriados/ausências). Um simples dia de ausência isolado, dentro de uma tarefa cuja %
  // de alocação deixa folga (ex.: tarefa de 1 mês a 20%), NÃO bloqueia — a pessoa tem margem para
  // se organizar dentro do período.
  // O nível de "aviso" usa antes o(s) resumo(s) MENSAL(AIS) do recurso para o(s) mês(es) que a
  // tarefa atravessa — os mesmos números do heatmap da Capacidade — para a badge nunca poder
  // contradizer o que lá está mostrado.
  avaliarAtribuicao(recurso, projetoId, taskId, inicioISO, fimISO, pctTarefa) {
    pctTarefa = pctTarefa === undefined ? 100 : pctTarefa;
    const inicio = DateUtil.parseISO(inicioISO);
    const fim = DateUtil.parseISO(fimISO);

    // Além de contar os dias problemáticos, guarda o detalhe (datas exatas, motivo, e com que
    // outras tarefas colide) para o diagnóstico poder ser específico em vez de genérico.
    const detalheIndisponivel = [];
    const detalheSobreAlocado = [];
    let capacidadePeriodo = 0, demandaPeriodo = 0;
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      const cap = this.capacidadeDiaria(d, recurso);
      // IDs de tarefa são sequenciais POR PROJETO, não globalmente únicos — é preciso comparar o
      // par (projeto, tarefa) para excluir a tarefa em avaliação, senão uma tarefa de outro
      // projeto com o mesmo número de ID fica (erradamente) também excluída da soma.
      const outras = this.tarefasAtivasNoDia(d, recurso.id).filter(x => !(x.projeto.id === projetoId && x.tarefa.id === taskId));
      const outrasHoras = outras.reduce((soma, x) => soma + this.HORAS_DIA * (App.pctAlocacao(x.tarefa, recurso.id) / 100), 0);
      const estaHoras = this.HORAS_DIA * (pctTarefa / 100);
      capacidadePeriodo += cap;
      demandaPeriodo += outrasHoras + estaHoras;
      if (cap === 0) {
        let motivo = 'ausência';
        if (this.ehFeriado(d)) motivo = 'feriado';
        else if (this.ehAusente(d, recurso.id)) {
          const a = App.state.ausencias.find(x => x.recursoId === recurso.id && DateUtil.toISO(d) >= x.dataInicio && DateUtil.toISO(d) <= x.dataFim);
          motivo = a ? a.tipo.toLowerCase() : 'ausência';
        }
        detalheIndisponivel.push({ data: new Date(d), motivo });
        continue;
      }
      const totalSimulado = outrasHoras + estaHoras;
      if (totalSimulado > this.HORAS_DIA) {
        detalheSobreAlocado.push({ data: new Date(d), pctTotal: Math.round(totalSimulado / this.HORAS_DIA * 100), outras: outras.map(x => x.tarefa.nome) });
      }
    }
    const semFolgaNoPeriodo = demandaPeriodo > capacidadePeriodo;
    if (detalheSobreAlocado.length > 0 || (detalheIndisponivel.length > 0 && semFolgaNoPeriodo)) {
      return {
        nivel: 'critico', diasIndisponivel: detalheIndisponivel.length, diasSobreAlocado: detalheSobreAlocado.length,
        detalheIndisponivel, detalheSobreAlocado, semFolgaNoPeriodo,
        capacidade: capacidadePeriodo, alocado: demandaPeriodo,
        pct: capacidadePeriodo > 0 ? demandaPeriodo / capacidadePeriodo : Infinity, mesLabel: ''
      };
    }

    const meses = this.mesesEntre(inicio, fim).map(m => Object.assign({ resumo: this.resumoMes(recurso, m.ano, m.mes) }, m));
    const pior = meses.reduce((p, m) => (m.resumo.pct > p.resumo.pct ? m : p), meses[0]);
    const nivel = this.classeResumo(Object.assign({}, pior.resumo, { diasConflito: 0 }));
    return Object.assign({ nivel, diasIndisponivel: detalheIndisponivel.length, diasSobreAlocado: 0, mesLabel: pior.label }, pior.resumo);
  },
  descreverProblema(nomeRecurso, resultado) {
    if (resultado.nivel === 'critico') {
      const partes = [];
      if (resultado.diasIndisponivel > 0) {
        const lista = (resultado.detalheIndisponivel || []).map(d => `${DateUtil.formatShort(d.data)} (${d.motivo})`).join(', ');
        const semFolga = resultado.semFolgaNoPeriodo ? ` — sem folga no período para compensar (${resultado.alocado.toFixed(0)}h pedidas de ${resultado.capacidade.toFixed(0)}h disponíveis)` : '';
        partes.push(`indisponível em ${lista || resultado.diasIndisponivel + ' dia(s) úteis deste período'}${semFolga}`);
      }
      if (resultado.diasSobreAlocado > 0) {
        const outrasTarefas = new Set();
        (resultado.detalheSobreAlocado || []).forEach(x => x.outras.forEach(n => outrasTarefas.add(n)));
        const lista = (resultado.detalheSobreAlocado || []).map(x => `${DateUtil.formatShort(x.data)} (${x.pctTotal}%)`).join(', ');
        const comQuem = outrasTarefas.size ? ` — em simultâneo com: ${Array.from(outrasTarefas).join(', ')}` : '';
        partes.push(`sobre-alocado(a) em ${lista || resultado.diasSobreAlocado + ' dia(s)'}${comQuem}`);
      }
      return `${nomeRecurso} está ${partes.join(' e ')}.`;
    }
    if (resultado.nivel === 'aviso') {
      return `${nomeRecurso} está perto do limite de capacidade em ${resultado.mesLabel}: ${resultado.alocado.toFixed(0)}h alocadas de ${resultado.capacidade.toFixed(0)}h disponíveis (${Math.round(resultado.pct * 100)}%) — ver separador Capacidade.`;
    }
    return '';
  }
};

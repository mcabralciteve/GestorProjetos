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
  // Reparte "horasTotais" só pelos dias em que o recurso está disponível dentro de [inicioISO,
  // fimISO] — uma tarefa de poucas horas espalhada por um período longo (ex.: 16h entre julho e
  // dezembro) não obriga a trabalhar precisamente em cada dia do calendário, só nos dias em que a
  // pessoa está mesmo disponível; um dia de ausência/feriado nunca "recebe" horas. Exceção: se
  // NENHUM dia do período está disponível, reparte pelos dias úteis do calendário — o trabalho não
  // cabe de forma nenhuma, mas continua a aparecer nalgum lado em vez de desaparecer silenciosamente.
  horasNoDia(horasTotais, inicioISO, fimISO, recursoId, date) {
    if (horasTotais <= 0) return 0;
    const inicio = DateUtil.parseISO(inicioISO), fim = DateUtil.parseISO(fimISO);
    let diasUteis = 0, diasDisp = 0;
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      diasUteis++;
      if (this.capacidadeDiaria(d, { id: recursoId }) > 0) diasDisp++;
    }
    if (diasDisp === 0) return diasUteis > 0 ? horasTotais / diasUteis : 0;
    if (this.capacidadeDiaria(date, { id: recursoId }) === 0) return 0;
    return horasTotais / diasDisp;
  },
  horasTarefaNoDia(tarefa, recursoId, date) {
    return this.horasNoDia(App.horasAlocadas(tarefa, recursoId), tarefa.inicio, tarefa.fim, recursoId, date);
  },
  // Cada tarefa contribui as horas que lhe cabem neste dia, distribuídas apenas pelos dias
  // disponíveis da sua própria duração (ver horasNoDia) — não uma fração fixa de todos os dias
  // do calendário entre o início e o fim da tarefa.
  alocacaoDiaria(date, recursoId) {
    return this.tarefasAtivasNoDia(date, recursoId).reduce((soma, x) => {
      return soma + this.horasTarefaNoDia(x.tarefa, recursoId, date);
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
      const outrasHoras = outras.reduce((soma, x) => soma + this.horasTarefaNoDia(x.tarefa, recurso.id, d), 0);
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
  // Distingue dois problemas bem diferentes, que antes eram tratados como um só "diasConflito":
  // "diasSobreAlocado" — duplo agendamento real (mais do que 8h de tarefas no mesmo dia disponível);
  // "diasConflitoDisponibilidade" — trabalho agendado num dia sem disponibilidade (feriado/ausência),
  // que não é sobre-alocação, é a agenda a ignorar uma indisponibilidade já conhecida.
  resumoPeriodo(recurso, inicio, fim) {
    let capacidade = 0, alocado = 0;
    const datasSobreAlocado = [], datasConflitoDisponibilidade = [];
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      const cap = this.capacidadeDiaria(d, recurso);
      const aloc = this.alocacaoDiaria(d, recurso.id);
      capacidade += cap;
      alocado += aloc;
      if (cap === 0) { if (aloc > 0) datasConflitoDisponibilidade.push(DateUtil.toISO(d)); }
      else if (aloc > this.HORAS_DIA) datasSobreAlocado.push(DateUtil.toISO(d));
    }
    const pct = capacidade > 0 ? (alocado / capacidade) : (alocado > 0 ? Infinity : 0);
    return {
      capacidade, alocado, pct,
      diasSobreAlocado: datasSobreAlocado.length, diasConflitoDisponibilidade: datasConflitoDisponibilidade.length,
      datasSobreAlocado, datasConflitoDisponibilidade
    };
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

  // "mesInicio" ({ano, mes}, mes 0-indexado) deixa começar o horizonte num mês qualquer — inclui
  // meses passados — em vez de partir sempre de hoje; por omissão continua a ser o mês atual.
  horizonteMeses(nMeses, mesInicio) {
    const out = [];
    const base = mesInicio ? new Date(mesInicio.ano, mesInicio.mes, 1) : new Date();
    for (let i = 0; i < nMeses; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
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

  // Os 3 limiares (%) que separam as bandas de ocupação — parametrizáveis pelo Administrador em
  // Configurações → Definições (state.configuracoes); com valores por omissão sensatos caso ainda
  // não estejam definidos. Devolvidos já como frações (0..1) para comparar direto com "pct".
  limiaresOcupacao() {
    const c = (App.state && App.state.configuracoes) || {};
    return {
      baixo: (Number(c.ocupacaoLimiteBaixo) || 60) / 100,
      alto: (Number(c.ocupacaoLimiteAlto) || 80) / 100,
      critico: (Number(c.ocupacaoLimiteCritico) || 100) / 100
    };
  },
  // Classificação visual (heatmap/cartões/badges/calendário de Alocações) a partir de um resumo,
  // por ordem de gravidade — os mesmos 3 limiares e as mesmas cores em toda a app:
  // "crítico" (vermelho) — duplo agendamento real, OU a % total atinge/ultrapassa o limiar crítico;
  // "conflito" (laranja) — trabalho agendado num dia sem disponibilidade (feriado/ausência), não é
  // sobre-alocação, é a agenda a ignorar uma indisponibilidade conhecida;
  // "aviso" (laranja) — entre o limiar alto e o crítico, perto do limite;
  // "ok" (verde) — entre o limiar baixo e o alto, ocupação confortável;
  // "subutilizado" (amarelo) — acima de 0% mas abaixo do limiar baixo;
  // "vazio" (cinza) — 0%, sem alocação nenhuma.
  classeResumo(resumo) {
    const lim = this.limiaresOcupacao();
    if (resumo.diasSobreAlocado > 0 || resumo.pct >= lim.critico) return 'critico';
    if (resumo.diasConflitoDisponibilidade > 0) return 'conflito';
    if (resumo.pct >= lim.alto) return 'aviso';
    if (resumo.pct >= lim.baixo) return 'ok';
    if (resumo.pct > 0) return 'subutilizado';
    return 'vazio';
  },
  // Mesma classificação, mas para um único dia (usado no calendário de Alocações) — monta um
  // "resumo" de um dia só e reaproveita classeResumo, para nunca poder divergir da Capacidade.
  classeDia(date, recursoId) {
    const cap = this.capacidadeDiaria(date, { id: recursoId });
    const aloc = this.alocacaoDiaria(date, recursoId);
    const pct = cap > 0 ? aloc / cap : (aloc > 0 ? Infinity : 0);
    return this.classeResumo({
      pct,
      diasSobreAlocado: (cap > 0 && aloc > this.HORAS_DIA) ? 1 : 0,
      diasConflitoDisponibilidade: (cap === 0 && aloc > 0) ? 1 : 0
    });
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
    // Recupera o total de horas de "esta tarefa" a partir da percentagem média (o inverso do
    // cálculo em App.pctAlocacao) para poder repartir só pelos seus próprios dias disponíveis,
    // tal como as outras tarefas — não uma fração fixa de todos os dias do período.
    const diasUteisEstaTarefa = App.diasUteisEntre(inicioISO, fimISO);
    const estaHorasTotais = diasUteisEstaTarefa > 0 ? (pctTarefa / 100) * diasUteisEstaTarefa * this.HORAS_DIA : 0;

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
      const outrasHoras = outras.reduce((soma, x) => soma + this.horasTarefaNoDia(x.tarefa, recurso.id, d), 0);
      const estaHoras = this.horasNoDia(estaHorasTotais, inicioISO, fimISO, recurso.id, d);
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
        // "critico" só quando há duplo agendamento real; um dia indisponível sem folga para
        // compensar é "conflito" (agenda vs. disponibilidade), não sobre-alocação.
        nivel: detalheSobreAlocado.length > 0 ? 'critico' : 'conflito',
        diasIndisponivel: detalheIndisponivel.length, diasSobreAlocado: detalheSobreAlocado.length,
        detalheIndisponivel, detalheSobreAlocado, semFolgaNoPeriodo,
        capacidade: capacidadePeriodo, alocado: demandaPeriodo,
        pct: capacidadePeriodo > 0 ? demandaPeriodo / capacidadePeriodo : Infinity, mesLabel: ''
      };
    }

    const meses = this.mesesEntre(inicio, fim).map(m => Object.assign({ resumo: this.resumoMes(recurso, m.ano, m.mes) }, m));
    const pior = meses.reduce((p, m) => (m.resumo.pct > p.resumo.pct ? m : p), meses[0]);
    const nivel = this.classeResumo(Object.assign({}, pior.resumo, { diasSobreAlocado: 0, diasConflitoDisponibilidade: 0 }));
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
    if (resultado.nivel === 'conflito') {
      const lista = (resultado.detalheIndisponivel || []).map(d => `${DateUtil.formatShort(d.data)} (${d.motivo})`).join(', ');
      return `${nomeRecurso} tem trabalho agendado em dia(s) sem disponibilidade — indisponível em ${lista || resultado.diasIndisponivel + ' dia(s) úteis deste período'}, sem folga no período para compensar (${resultado.alocado.toFixed(0)}h pedidas de ${resultado.capacidade.toFixed(0)}h disponíveis).`;
    }
    if (resultado.nivel === 'aviso') {
      return `${nomeRecurso} está perto do limite de capacidade em ${resultado.mesLabel}: ${resultado.alocado.toFixed(0)}h alocadas de ${resultado.capacidade.toFixed(0)}h disponíveis (${Math.round(resultado.pct * 100)}%) — ver separador Capacidade.`;
    }
    return '';
  }
};

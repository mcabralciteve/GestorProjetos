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
  //
  // IMPORTANTE: isto é só uma distribuição ILUSTRATIVA para desenhar barras/blocos (Gantt,
  // Alocações) — não é uma afirmação de que a pessoa vai trabalhar exatamente estas horas neste
  // dia exato. Por isso NUNCA se usa isto para decidir "sobre-alocação real" — ver
  // intervalosCriticos() para essa pergunta, que é resolvida de forma completamente diferente.
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

  // ---------------------------------------------------------------------------------------------
  // Sobre-alocação REAL — o coração da questão "o meu consultor consegue mesmo encaixar tudo?".
  //
  // NÃO se responde perguntando "este dia, com a distribuição uniforme de cada tarefa, excede 8h?"
  // — isso dá falsos positivos: uma tarefa de 90h num prazo de 45 dias úteis não obriga a pessoa a
  // fazer exatamente 2h TODOS os dias; ela pode fazer 0h hoje e 4h amanhã, desde que cume o prazo.
  // Se noutro projeto houver 8h "a sério" marcadas para hoje, a pessoa simplesmente desloca as 2h
  // do primeiro projeto para outro dia dentro do seu próprio prazo — não há conflito nenhum.
  //
  // A pergunta certa é sobre SALDO ACUMULADO num intervalo, não sobre um dia isolado: "existe algum
  // período [a,b] em que a soma das horas de tarefas cujo prazo cabe inteiramente dentro de [a,b]
  // excede a soma da capacidade disponível nesse mesmo [a,b]?". Se a resposta for não para
  // qualquer [a,b] possível, existe SEMPRE alguma forma de arrumar os dias em que tudo cabe — a
  // pessoa não está realmente sobre-alocada, só tem menos folga. Só quando essa soma não cabe em
  // lado nenhum é que há um problema genuíno e inevitável, seja qual for o dia em que se olhe.
  //
  // Basta testar os pares (a,b) tirados das datas de início/fim das próprias tarefas — a procura e
  // a capacidade só mudam de "degrau" nesses pontos. Devolve só as violações MÍNIMAS (não contêm
  // nenhuma outra já encontrada) — são as mais específicas e acionáveis; uma janela maior que
  // contenha uma mais pequena é só sintoma do mesmo problema, reportá-la também seria redundante.
  //
  // "opts.excluir" tira uma tarefa já existente do cálculo (para não a contar em duplicado);
  // "opts.extra" acrescenta uma tarefa hipotética (para simular "e se eu atribuísse isto?" antes de
  // gravar — ver avaliarAtribuicao). Sem isto, o cálculo é só sobre as tarefas já atribuídas.
  intervalosCriticos(recurso, opts) {
    opts = opts || {};
    const tarefas = [];
    Object.values(App.state.projetos).forEach(p => {
      p.tarefas.forEach(t => {
        if (!t.recursoIds.includes(recurso.id)) return;
        if (App.temFilhos(p, t.id)) return;
        if (opts.excluir && opts.excluir.projetoId === p.id && opts.excluir.taskId === t.id) return;
        const horas = App.horasAlocadas(t, recurso.id);
        if (horas <= 0) return;
        tarefas.push({ inicio: DateUtil.parseISO(t.inicio), fim: DateUtil.parseISO(t.fim), horas, nome: t.nome });
      });
    });
    if (opts.extra && opts.extra.horas > 0) {
      tarefas.push({ inicio: opts.extra.inicio, fim: opts.extra.fim, horas: opts.extra.horas, nome: opts.extraNome || '(esta tarefa)' });
    }
    if (tarefas.length < 2) return []; // uma só tarefa nunca entra em conflito consigo própria

    const pontos = new Set();
    tarefas.forEach(t => { pontos.add(+t.inicio); pontos.add(+t.fim); });
    const datas = [...pontos].sort((a, b) => a - b).map(t => new Date(t));

    const violacoes = [];
    for (let i = 0; i < datas.length; i++) {
      const a = datas[i];
      let capacidadeAcumulada = 0;
      let cursor = new Date(a);
      for (let j = i; j < datas.length; j++) {
        const b = datas[j];
        while (cursor <= b) {
          if (!this.ehFimDeSemana(cursor)) capacidadeAcumulada += this.capacidadeDiaria(cursor, recurso);
          cursor = DateUtil.addDays(cursor, 1);
        }
        const envolvidas = tarefas.filter(t => t.inicio >= a && t.fim <= b);
        const demanda = envolvidas.reduce((s, t) => s + t.horas, 0);
        if (demanda > capacidadeAcumulada + 1e-9) {
          violacoes.push({
            inicio: a, fim: b, demanda, capacidade: capacidadeAcumulada, excesso: demanda - capacidadeAcumulada,
            tarefas: envolvidas.map(t => t.nome)
          });
        }
      }
    }
    // Só as mínimas: descarta qualquer violação que contenha estritamente outra já encontrada.
    return violacoes.filter(v => !violacoes.some(w => w !== v && w.inicio >= v.inicio && w.fim <= v.fim && (w.inicio > v.inicio || w.fim < v.fim)));
  },

  // Resume capacidade/alocação de um recurso num intervalo de dias (dias úteis apenas). Distingue
  // dois problemas bem diferentes: "diasSobreAlocado" (na prática, nº de intervalos críticos que
  // tocam este período — ver intervalosCriticos, é sobre-alocação real) e
  // "diasConflitoDisponibilidade" (trabalho agendado num dia sem disponibilidade — feriado/
  // ausência — que já por si não recebe horas na distribuição normal; só dispara no caso raro de a
  // tarefa não ter NENHUM dia disponível em todo o seu prazo, ver horasNoDia).
  // "intervalosPrecalculados" evita recalcular intervalosCriticos (O(n³), caro) uma vez por mês —
  // quem chama isto num ciclo por vários meses do MESMO recurso deve calcular uma vez só e passar
  // aqui (ver renderCapacidade em app.js).
  resumoPeriodo(recurso, inicio, fim, intervalosPrecalculados) {
    let capacidade = 0, alocado = 0;
    const datasConflitoDisponibilidade = [];
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      const cap = this.capacidadeDiaria(d, recurso);
      const aloc = this.alocacaoDiaria(d, recurso.id);
      capacidade += cap;
      alocado += aloc;
      if (cap === 0 && aloc > 0) datasConflitoDisponibilidade.push(DateUtil.toISO(d));
    }
    const pct = capacidade > 0 ? (alocado / capacidade) : (alocado > 0 ? Infinity : 0);
    const todosIntervalos = intervalosPrecalculados || this.intervalosCriticos(recurso);
    const intervalosSobreAlocados = todosIntervalos.filter(v => v.fim >= inicio && v.inicio <= fim);
    return {
      capacidade, alocado, pct,
      diasSobreAlocado: intervalosSobreAlocados.length, intervalosSobreAlocados,
      diasConflitoDisponibilidade: datasConflitoDisponibilidade.length, datasConflitoDisponibilidade
    };
  },
  resumoMes(recurso, ano, mes, intervalosPrecalculados) {
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    return this.resumoPeriodo(recurso, new Date(ano, mes, 1), new Date(ano, mes, diasNoMes), intervalosPrecalculados);
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
  // "crítico" (vermelho) — sobre-alocação real (ver intervalosCriticos), OU a % total atinge/
  // ultrapassa o limiar crítico;
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
  // "resumo" desse dia e reaproveita classeResumo, para nunca poder divergir da Capacidade.
  // "intervalosPrecalculados" evita recalcular intervalosCriticos uma vez por dia do calendário —
  // quem desenha um mês inteiro (30 dias) deve calcular uma vez só e passar aqui.
  classeDia(date, recursoId, intervalosPrecalculados) {
    const recurso = { id: recursoId };
    const cap = this.capacidadeDiaria(date, recurso);
    const aloc = this.alocacaoDiaria(date, recursoId);
    const lim = this.limiaresOcupacao();
    // "pct" aqui é só ilustrativo (distribuição uniforme de cada tarefa no seu próprio prazo, ver
    // horasNoDia) — pode passar de 100% num dia isolado sem existir sobre-alocação real nenhuma
    // (é exactamente o falso positivo que motivou tratar isto à parte, ver intervalosCriticos).
    // Por isso NUNCA deixa, sozinho, classificar como "crítico" — fica sempre logo abaixo desse
    // limiar; só um dia que toque mesmo um intervalo crítico real (abaixo) pode chegar a "crítico".
    const pctBruto = cap > 0 ? aloc / cap : (aloc > 0 ? Infinity : 0);
    const pct = Math.min(pctBruto, lim.critico - 0.0001);
    const intervalos = intervalosPrecalculados || this.intervalosCriticos(recurso);
    const tocaEsteDia = intervalos.some(v => date >= v.inicio && date <= v.fim);
    return this.classeResumo({
      pct,
      diasSobreAlocado: tocaEsteDia ? 1 : 0,
      diasConflitoDisponibilidade: (cap === 0 && aloc > 0) ? 1 : 0
    });
  },

  // Avalia a atribuição de um recurso a uma tarefa (intervalo [inicioISO, fimISO]).
  // "projetoId" é necessário porque os IDs de tarefa só são únicos dentro do próprio projeto.
  // SIMULA esta tarefa como atribuída ao recurso mesmo que ainda não esteja — para que o modal
  // "Associar recursos" avise corretamente de conflitos antes de a atribuição ser confirmada, não
  // só depois. "taskId" é excluído da contagem de "outras tarefas" e recontado à parte, para não
  // duplicar quando já está atribuída.
  // "Crítico" só dispara em dois casos: (1) sobre-alocação real — ver intervalosCriticos, com esta
  // tarefa incluída na simulação; ou (2) indisponibilidade (feriado/ausência) sem folga no período
  // para compensar. Um simples dia de ausência isolado, dentro de uma tarefa cuja % de alocação
  // deixa folga (ex.: tarefa de 1 mês a 20%), NÃO bloqueia — a pessoa tem margem para se organizar.
  // O nível de "aviso" usa antes o(s) resumo(s) MENSAL(AIS) do recurso para o(s) mês(es) que a
  // tarefa atravessa — os mesmos números do heatmap da Capacidade — para a badge nunca poder
  // contradizer o que lá está mostrado.
  avaliarAtribuicao(recurso, projetoId, taskId, inicioISO, fimISO, pctTarefa) {
    pctTarefa = pctTarefa === undefined ? 100 : pctTarefa;
    const inicio = DateUtil.parseISO(inicioISO);
    const fim = DateUtil.parseISO(fimISO);
    // Recupera o total de horas de "esta tarefa" a partir da percentagem média (o inverso do
    // cálculo em App.pctAlocacao) — é só o total que interessa para a simulação de conflitos, a
    // distribuição diária concreta já não entra na conta (ver nota grande em intervalosCriticos).
    const diasUteisEstaTarefa = App.diasUteisEntre(inicioISO, fimISO);
    const estaHorasTotais = diasUteisEstaTarefa > 0 ? (pctTarefa / 100) * diasUteisEstaTarefa * this.HORAS_DIA : 0;

    // Indisponibilidade (feriados/ausências) continua a ser avaliada dia a dia — é um facto do
    // calendário para ESTE dia específico, não uma suposição de distribuição.
    const detalheIndisponivel = [];
    let capacidadePeriodo = 0, demandaOutrasPeriodo = 0;
    for (let d = new Date(inicio); d <= fim; d = DateUtil.addDays(d, 1)) {
      if (this.ehFimDeSemana(d)) continue;
      const cap = this.capacidadeDiaria(d, recurso);
      capacidadePeriodo += cap;
      // IDs de tarefa são sequenciais POR PROJETO, não globalmente únicos — é preciso comparar o
      // par (projeto, tarefa) para excluir a tarefa em avaliação.
      const outras = this.tarefasAtivasNoDia(d, recurso.id).filter(x => !(x.projeto.id === projetoId && x.tarefa.id === taskId));
      demandaOutrasPeriodo += outras.reduce((soma, x) => soma + this.horasTarefaNoDia(x.tarefa, recurso.id, d), 0);
      if (cap === 0) {
        let motivo = 'ausência';
        if (this.ehFeriado(d)) motivo = 'feriado';
        else if (this.ehAusente(d, recurso.id)) {
          const a = App.state.ausencias.find(x => x.recursoId === recurso.id && DateUtil.toISO(d) >= x.dataInicio && DateUtil.toISO(d) <= x.dataFim);
          motivo = a ? a.tipo.toLowerCase() : 'ausência';
        }
        detalheIndisponivel.push({ data: new Date(d), motivo });
      }
    }
    const demandaPeriodo = demandaOutrasPeriodo + estaHorasTotais;
    const semFolgaNoPeriodo = demandaPeriodo > capacidadePeriodo;

    const projetoDaTarefa = App.state.projetos[projetoId];
    const tarefaAtual = projetoDaTarefa && projetoDaTarefa.tarefas.find(x => x.id === taskId);
    const intervalosSobreAlocados = this.intervalosCriticos(recurso, {
      excluir: { projetoId, taskId },
      extra: { inicio, fim, horas: estaHorasTotais },
      extraNome: tarefaAtual ? tarefaAtual.nome : '(esta tarefa)'
    }).filter(v => v.fim >= inicio && v.inicio <= fim);

    if (intervalosSobreAlocados.length > 0 || (detalheIndisponivel.length > 0 && semFolgaNoPeriodo)) {
      return {
        // "critico" só quando há sobre-alocação real; um dia indisponível sem folga para
        // compensar é "conflito" (agenda vs. disponibilidade), não sobre-alocação.
        nivel: intervalosSobreAlocados.length > 0 ? 'critico' : 'conflito',
        diasIndisponivel: detalheIndisponivel.length, intervalosSobreAlocados,
        detalheIndisponivel, semFolgaNoPeriodo,
        capacidade: capacidadePeriodo, alocado: demandaPeriodo,
        pct: capacidadePeriodo > 0 ? demandaPeriodo / capacidadePeriodo : Infinity, mesLabel: ''
      };
    }

    const meses = this.mesesEntre(inicio, fim).map(m => Object.assign({ resumo: this.resumoMes(recurso, m.ano, m.mes) }, m));
    const pior = meses.reduce((p, m) => (m.resumo.pct > p.resumo.pct ? m : p), meses[0]);
    const nivel = this.classeResumo(Object.assign({}, pior.resumo, { diasSobreAlocado: 0, diasConflitoDisponibilidade: 0 }));
    return Object.assign({ nivel, diasIndisponivel: detalheIndisponivel.length, intervalosSobreAlocados: [], mesLabel: pior.label }, pior.resumo);
  },
  descreverProblema(nomeRecurso, resultado) {
    if (resultado.nivel === 'critico') {
      const partes = [];
      if (resultado.diasIndisponivel > 0) {
        const lista = (resultado.detalheIndisponivel || []).map(d => `${DateUtil.formatShort(d.data)} (${d.motivo})`).join(', ');
        const semFolga = resultado.semFolgaNoPeriodo ? ` — sem folga no período para compensar (${resultado.alocado.toFixed(0)}h pedidas de ${resultado.capacidade.toFixed(0)}h disponíveis)` : '';
        partes.push(`indisponível em ${lista || resultado.diasIndisponivel + ' dia(s) úteis deste período'}${semFolga}`);
      }
      if ((resultado.intervalosSobreAlocados || []).length > 0) {
        const outrasTarefas = new Set();
        resultado.intervalosSobreAlocados.forEach(v => v.tarefas.forEach(n => outrasTarefas.add(n)));
        const lista = resultado.intervalosSobreAlocados.map(v => {
          const periodo = +v.inicio === +v.fim ? DateUtil.formatShort(v.inicio) : `${DateUtil.formatShort(v.inicio)}–${DateUtil.formatShort(v.fim)}`;
          return `${periodo} (excesso de ${v.excesso.toFixed(1)}h)`;
        }).join(', ');
        partes.push(`sobre-alocado(a) em ${lista} — em simultâneo com: ${Array.from(outrasTarefas).join(', ')}`);
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

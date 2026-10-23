// Integração de horas com o orcprev (lado do Gestor): transforma os registos de uma semana no "pacote" que se
// copia daqui e se importa no orcprev (ver js/orcprev-importar.js, que corre dentro do orcprev).
// Regras puras (sem DOM nem rede), testadas em tests/orcprev-logica.test.js. O ecrã está em App.abrirModalOrcprev.
//
// Princípios:
//  - o orcprev só conhece "dia + projeto (ou atividade) + horas" — por isso as horas de várias tarefas do mesmo
//    projeto no mesmo dia SOMAM-SE numa linha só (os nomes das tarefas vão para a nota);
//  - o orcprev trabalha em múltiplos de 0,25 h: arredonda-se por dia, repartindo a diferença (maior resto) para o
//    total do dia ficar o mais perto possível do que a pessoa registou;
//  - o que o Gestor envia vai marcado com "[Gestor]" na nota — é assim que um reenvio da mesma semana SUBSTITUI
//    o que veio do Gestor sem tocar no que a pessoa tenha lançado à mão no orcprev;
//  - tipos de trabalho sem atividade do orcprev definida NÃO são enviados (fica o aviso, nunca se adivinha);
//  - um projeto do Gestor pode corresponder, no orcprev, a um PROJETO (de I&D), a um SERVIÇO de consultoria/prototipagem
//    ou a uma ATIVIDADE (ex.: "Outras atividades", para serviços que ainda não existem lá). A correspondência guarda-se
//    como texto em projetos.orcprev_ref (ver alvoDe/codificarAlvo).
const OrcprevLogica = {
  MARCA: '[Gestor]',
  PASSO: 0.25,
  NOTA_MAX: 200,
  FORMATO: 'gestor-orcprev',
  VERSAO: 1,

  // Atividades fixas do orcprev (código → nome), tal como o ecrã do timesheet as oferece. "PROJECT" não está
  // aqui: é o caso das horas de projeto, que levam projeto em vez de atividade.
  ATIVIDADES: [
    ['COMMUNICATION', 'Comercial / Comunicação / Divulgação'],
    ['OPPORTUNITIES_PI', 'Exploração de oportunidades / PI'],
    ['PROPOSAL_DRAFT', 'Elaboração de propostas'],
    ['APPLICATION_PREP', 'Preparação de candidaturas'],
    ['TRAINING_GIVE', 'Dar formação'],
    ['TRAINING_RECEIVE', 'Receber formação'],
    ['MANAGEMENT', 'Gestão / coordenação'],
    ['INFORMATION_MANAGEMENT', 'Gestão de informação'],
    ['INFRASTRUCTURE_MANAGEMENT', 'Gestão de infraestrutura'],
    ['INTERNAL_MEETINGS', 'Reuniões internas'],
    ['INTERNAL_SERVICES', 'Serviços internos'],
    ['TECH_SUPPORT', 'Apoio técnico não associado a projeto'],
    ['PROTOTYPING', 'Prototipagem'],
    ['CONSULTING', 'Consultoria'],
    ['THESES_INTERNSHIPS', 'Teses e estágios'],
    ['LEAVE_ABSENCE', 'Férias / ausências'],
    ['OTHER', 'Outras atividades']
  ],
  nomeAtividade(codigo) {
    const a = this.ATIVIDADES.find(x => x[0] === codigo);
    return a ? a[1] : codigo;
  },

  // ---------- correspondência projeto do Gestor → orcprev (texto em projetos.orcprev_ref) ----------
  //   ""                          → projeto do orcprev com o mesmo nome (automático)
  //   "005323" ou "TEXP@CT"       → projeto do orcprev, por código ou nome
  //   "consultoria: Cliente · X"  → serviço de consultoria do orcprev
  //   "prototipagem: Cliente · X" → serviço de prototipagem do orcprev
  //   "atividade:OTHER"           → atividade (sem projeto) — "Outras atividades"
  alvoDe(ref) {
    const t = String(ref || '').trim();
    const m = /^(consultoria|prototipagem|atividade)\s*:\s*(.*)$/i.exec(t);
    if (!m) return { tipo: 'projeto', valor: t };
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'consultoria') return { tipo: 'servico', atividade: 'CONSULTING', valor: v };
    if (k === 'prototipagem') return { tipo: 'servico', atividade: 'PROTOTYPING', valor: v };
    return { tipo: 'atividade', atividade: (v || 'OTHER').toUpperCase(), valor: v };
  },
  // Inverso de alvoDe, a partir do que se escolhe no quadro: tipo = 'projeto' | 'consultoria' | 'prototipagem' | 'outras'.
  codificarAlvo(tipo, valor) {
    const v = String(valor || '').trim();
    if (tipo === 'consultoria') return 'consultoria:' + v;
    if (tipo === 'prototipagem') return 'prototipagem:' + v;
    if (tipo === 'outras') return 'atividade:OTHER';
    return v;
  },
  // Para o quadro: qual dos quatro tipos é este texto.
  tipoDoAlvo(ref) {
    const a = this.alvoDe(ref);
    if (a.tipo === 'servico') return a.atividade === 'PROTOTYPING' ? 'prototipagem' : 'consultoria';
    if (a.tipo === 'atividade') return 'outras';
    return 'projeto';
  },

  // ---------- datas (ISO "AAAA-MM-DD", sempre em UTC para não haver saltos de hora de verão) ----------
  _data(iso) { const [a, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); },
  _iso(dt) { return dt.toISOString().slice(0, 10); },
  somarDias(iso, n) { const dt = this._data(iso); dt.setUTCDate(dt.getUTCDate() + n); return this._iso(dt); },
  // Segunda-feira da semana que contém o dia (o orcprev começa a semana à segunda).
  segundaDaSemana(iso) {
    const dt = this._data(iso);
    const dow = dt.getUTCDay(); // 0 = domingo
    return this.somarDias(iso, dow === 0 ? -6 : 1 - dow);
  },

  // ---------- arredondamento ----------
  // Arredonda as horas de UM dia a múltiplos de 0,25 h, de modo a que a soma seja a soma original arredondada
  // a 0,25 h (maior resto primeiro). Devolve um array com a mesma ordem da entrada.
  arredondarDia(valores) {
    const q = valores.map(v => Math.max(0, Number(v) || 0) * 4);
    const base = q.map(x => Math.floor(x + 1e-9));
    const alvo = Math.round(q.reduce((s, x) => s + x, 0) + 1e-9);
    let falta = alvo - base.reduce((s, x) => s + x, 0);
    const ordem = q.map((x, i) => ({ i, resto: x - base[i] })).sort((a, b) => b.resto - a.resto || a.i - b.i);
    for (let k = 0; falta > 0 && k < ordem.length; k++, falta--) base[ordem[k].i] += 1;
    return base.map(x => x / 4);
  },

  // ---------- semana → linhas ----------
  // Entrada:
  //   registos       registos do Gestor DA PESSOA (já filtrados por pessoa e por permissão de leitura)
  //   inicioISO      qualquer dia da semana pretendida (usa-se a segunda-feira dessa semana)
  //   tipoPorId(id)  tipo de trabalho (null/undefined = "Projeto") com { nome, orcprevAtividade }
  //   projetoPorId   projeto pelo id (para ler orcprevRef); pode devolver undefined
  //   nomeTarefa(r)  nome atual da tarefa do registo
  // Saída: { inicio, fim, linhas, avisos, totalGestor, totalEnvio }
  linhasDaSemana({ registos, inicioISO, tipoPorId, projetoPorId, nomeTarefa }) {
    const inicio = this.segundaDaSemana(inicioISO);
    const fim = this.somarDias(inicio, 6);
    const grupos = new Map(); // chave → { data, tipo, atividade, projeto, horas, notas:Set }
    const semAtividade = new Map(); // nome do tipo → horas
    let totalGestor = 0;

    (registos || []).forEach(r => {
      if (!r || r.data < inicio || r.data > fim) return;
      const horas = Number(r.horas) || 0;
      if (horas <= 0) return;
      totalGestor += horas;
      const tipo = r.tipoTrabalhoId ? tipoPorId(r.tipoTrabalhoId) : null;
      let chave, grupo;
      if (!tipo) {
        const proj = (r.projetoId && projetoPorId && projetoPorId(r.projetoId)) || null;
        const idInterno = r.projetoIdInterno || (proj && proj.idInterno) || '';
        const nome = r.projetoNome || (proj && proj.nome) || '';
        const alvo = this.alvoDe(proj && proj.orcprevRef);
        if (alvo.tipo === 'atividade') {
          // Vai como atividade, sem projeto: o nome do projeto do Gestor fica na nota para se saber de onde vêm as horas.
          chave = `${r.data}|A|${alvo.atividade}`;
          grupo = grupos.get(chave) || { data: r.data, tipo: 'ACTIVITY', atividade: alvo.atividade, horas: 0, notas: new Set(), projeto: null };
          if (nome) grupo.notas.add(nome);
        } else if (alvo.tipo === 'servico') {
          chave = `${r.data}|S|${alvo.atividade}|${alvo.valor || r.projetoId || nome}`;
          grupo = grupos.get(chave) || { data: r.data, tipo: 'SERVICE', atividade: alvo.atividade, horas: 0, notas: new Set(),
            projeto: { ref: alvo.valor, nome, idInterno } };
        } else {
          chave = `${r.data}|P|${r.projetoId || idInterno || nome}`;
          grupo = grupos.get(chave) || { data: r.data, tipo: 'PROJECT', atividade: null, horas: 0, notas: new Set(),
            projeto: { ref: alvo.valor, nome, idInterno } };
        }
      } else if (!tipo.orcprevAtividade) {
        semAtividade.set(tipo.nome, (semAtividade.get(tipo.nome) || 0) + horas);
        return;
      } else {
        chave = `${r.data}|A|${tipo.orcprevAtividade}`;
        grupo = grupos.get(chave) || { data: r.data, tipo: 'ACTIVITY', atividade: tipo.orcprevAtividade, horas: 0, notas: new Set(), projeto: null };
      }
      grupo.horas += horas;
      const t = nomeTarefa ? String(nomeTarefa(r) || '').trim() : '';
      if (t) grupo.notas.add(t);
      if (tipo && r.cliente) grupo.notas.add(String(r.cliente).trim());
      grupos.set(chave, grupo);
    });

    // arredondar por dia
    const porDia = new Map();
    grupos.forEach(g => { if (!porDia.has(g.data)) porDia.set(g.data, []); porDia.get(g.data).push(g); });
    let semHoras = 0;
    porDia.forEach(lista => {
      const arred = this.arredondarDia(lista.map(g => g.horas));
      lista.forEach((g, i) => { g.horasGestor = g.horas; g.horas = arred[i]; if (g.horas === 0) semHoras++; });
    });

    const linhas = [...grupos.values()].filter(g => g.horas > 0).map(g => {
      const texto = [...g.notas].join('; ');
      const nota = (this.MARCA + (texto ? ' ' + texto : '')).slice(0, this.NOTA_MAX);
      return { data: g.data, tipo: g.tipo, atividade: g.atividade, projeto: g.projeto, horas: g.horas, nota };
    }).sort((a, b) => a.data.localeCompare(b.data)
      || (this._ordemTipo(a.tipo) - this._ordemTipo(b.tipo))
      || String((a.projeto && a.projeto.nome) || a.atividade || '').localeCompare(String((b.projeto && b.projeto.nome) || b.atividade || ''), 'pt'));

    const avisos = [];
    semAtividade.forEach((h, nome) => avisos.push(`O tipo "${nome}" não tem atividade do orcprev definida: ${this._fmt(h)} h não serão enviadas (Configurações → Tipos de Trabalho).`));
    if (semHoras) avisos.push(`${semHoras} linha(s) com menos de 0,25 h foram absorvidas no arredondamento do dia.`);
    const totalEnvio = linhas.reduce((s, l) => s + l.horas, 0);
    return { inicio, fim, linhas, avisos, totalGestor, totalEnvio };
  },
  _ordemTipo(t) { return t === 'PROJECT' ? 0 : t === 'SERVICE' ? 1 : 2; },
  _fmt(n) { return String(Math.round(n * 100) / 100).replace('.', ','); },

  // O texto que se copia (JSON) — o importador lê exatamente isto.
  pacote({ email, pessoa, semana, geradoEm }) {
    return {
      formato: this.FORMATO, versao: this.VERSAO, geradoEm: geradoEm || new Date().toISOString(),
      email: String(email || '').trim().toLowerCase(), pessoa: pessoa || '',
      semana: { inicio: semana.inicio, fim: semana.fim },
      linhas: semana.linhas, avisos: semana.avisos, totalGestor: semana.totalGestor, totalEnvio: semana.totalEnvio
    };
  },
  textoDoPacote(pacote) { return JSON.stringify(pacote); }
};

if (typeof module !== 'undefined') module.exports = OrcprevLogica;

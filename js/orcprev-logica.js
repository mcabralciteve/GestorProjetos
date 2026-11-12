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
  NOTA_MAX: 1000, // as notas escritas no Gestor passam todas; só um texto enorme é cortado (com "…")
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
  //   "candidatura: 005323"       → "Preparação de candidaturas" (atividade que leva um projeto do orcprev)
  alvoDe(ref) {
    const t = String(ref || '').trim();
    const m = /^(consultoria|prototipagem|atividade|candidatura)\s*:\s*(.*)$/i.exec(t);
    if (!m) return { tipo: 'projeto', valor: t };
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'consultoria') return { tipo: 'servico', atividade: 'CONSULTING', valor: v };
    if (k === 'prototipagem') return { tipo: 'servico', atividade: 'PROTOTYPING', valor: v };
    if (k === 'candidatura') return { tipo: 'candidatura', atividade: 'APPLICATION_PREP', valor: v };
    return { tipo: 'atividade', atividade: (v || 'OTHER').toUpperCase(), valor: v };
  },
  // Inverso de alvoDe, a partir do que se escolhe no quadro: tipo = 'projeto' | 'consultoria' | 'prototipagem' | 'outras'.
  codificarAlvo(tipo, valor) {
    const v = String(valor || '').trim();
    if (tipo === 'consultoria') return 'consultoria:' + v;
    if (tipo === 'prototipagem') return 'prototipagem:' + v;
    if (tipo === 'candidatura') return 'candidatura:' + v;
    if (tipo === 'outras') return 'atividade:OTHER';
    return v;
  },
  // Para o quadro: qual dos quatro tipos é este texto.
  tipoDoAlvo(ref) {
    const a = this.alvoDe(ref);
    if (a.tipo === 'servico') return a.atividade === 'PROTOTYPING' ? 'prototipagem' : 'consultoria';
    if (a.tipo === 'atividade') return 'outras';
    if (a.tipo === 'candidatura') return 'candidatura';
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
    const grupos = new Map(); // chave → { data, tipo, atividade, projeto, horas, tarefas:Set, projetos:Set, clientes:Set }
    const novoGrupo = (extra) => Object.assign({ horas: 0, tarefas: new Set(), projetos: new Set(), clientes: new Set(), origens: new Map() }, extra);
    // "origens" = de que projeto(s) do Gestor vêm as horas da linha: { nome, cliente, idInterno } (o nº GIAF ou interno).
    // Vai na nota e aparece no importador, para se identificar o projeto no orcprev (há projetos com o mesmo nome em clientes diferentes).
    const juntarOrigem = (grupo, nome, cliente, idInterno) => {
      const o = { nome: String(nome || '').trim(), cliente: String(cliente || '').trim(), idInterno: String(idInterno || '').trim() };
      if (o.nome || o.cliente || o.idInterno) grupo.origens.set(`${o.idInterno}|${o.nome}|${o.cliente}`, o);
    };
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
          grupo = grupos.get(chave) || novoGrupo({ data: r.data, tipo: 'ACTIVITY', atividade: alvo.atividade, projeto: null });
        } else if (alvo.tipo === 'candidatura') {
          chave = `${r.data}|C|${r.projetoId || idInterno || nome}`;
          grupo = grupos.get(chave) || novoGrupo({ data: r.data, tipo: 'APPLICATION', atividade: 'APPLICATION_PREP',
            projeto: { ref: alvo.valor, nome, idInterno } });
        } else if (alvo.tipo === 'servico') {
          chave = `${r.data}|S|${alvo.atividade}|${alvo.valor || r.projetoId || nome}`;
          grupo = grupos.get(chave) || novoGrupo({ data: r.data, tipo: 'SERVICE', atividade: alvo.atividade,
            projeto: { ref: alvo.valor, nome, idInterno } });
        } else {
          chave = `${r.data}|P|${r.projetoId || idInterno || nome}`;
          grupo = grupos.get(chave) || novoGrupo({ data: r.data, tipo: 'PROJECT', atividade: null,
            projeto: { ref: alvo.valor, nome, idInterno } });
        }
        // Projeto e cliente do Gestor ficam sempre guardados: se a pessoa mudar o destino no importador (ex.: de projeto
        // para "Outras atividades"), a nota passa a dizer de que projeto e cliente vêm as horas.
        if (nome) grupo.projetos.add(nome);
        const cli = String(r.cliente || (proj && proj.cliente) || '').trim();
        if (cli) grupo.clientes.add(cli);
        juntarOrigem(grupo, nome, cli, idInterno);
      } else if (!tipo.orcprevAtividade) {
        semAtividade.set(tipo.nome, (semAtividade.get(tipo.nome) || 0) + horas);
        return;
      } else {
        chave = `${r.data}|A|${tipo.orcprevAtividade}`;
        grupo = grupos.get(chave) || novoGrupo({ data: r.data, tipo: 'ACTIVITY', atividade: tipo.orcprevAtividade, projeto: null });
        if (r.cliente) { grupo.clientes.add(String(r.cliente).trim()); juntarOrigem(grupo, '', r.cliente, ''); }
      }
      grupo.horas += horas;
      // "tarefas" leva, por registo, "Tarefa: nota que escreveste no Gestor" (ou só um dos dois): as notas passam todas para o orcprev.
      const t = nomeTarefa ? String(nomeTarefa(r) || '').trim() : '';
      const n = String(r.notas || '').replace(/\s+/g, ' ').trim();
      const detalhe = t && n ? `${t}: ${n}` : (t || n);
      if (detalhe) grupo.tarefas.add(detalhe);
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
      const tarefas = [...g.tarefas], projetos = [...g.projetos], clientes = [...g.clientes], origens = [...g.origens.values()];
      const nota = this.montarNota(this.textoNota({ tarefas, projetos, clientes, origens }, g.tipo));
      return { data: g.data, tipo: g.tipo, atividade: g.atividade, projeto: g.projeto, horas: g.horas, nota, tarefas, projetos, clientes, origens };
    }).sort((a, b) => a.data.localeCompare(b.data)
      || (this._ordemTipo(a.tipo) - this._ordemTipo(b.tipo))
      || String((a.projeto && a.projeto.nome) || a.atividade || '').localeCompare(String((b.projeto && b.projeto.nome) || b.atividade || ''), 'pt'));

    const avisos = [];
    semAtividade.forEach((h, nome) => avisos.push(`O tipo "${nome}" não tem atividade do orcprev definida: ${this._fmt(h)} h não serão enviadas (Configurações → Tipos de Trabalho).`));
    if (semHoras) avisos.push(`${semHoras} linha(s) com menos de 0,25 h foram absorvidas no arredondamento do dia.`);
    const totalEnvio = linhas.reduce((s, l) => s + l.horas, 0);
    return { inicio, fim, linhas, avisos, totalGestor, totalEnvio };
  },
  // Texto da nota (sem a marca): o que foi feito (as tarefas) e, a seguir, de que projeto do Gestor vêm as horas:
  // "— Projeto · Cliente · nº do projeto" (GIAF ou interno), qualquer que seja o destino no orcprev — é assim que no orcprev
  // se identifica o projeto e o cliente. O importador (js/orcprev-importar.js) repete esta regra.
  // Sem "origens" (linha de um pacote antigo) vale a regra antiga: só nas atividades e serviços, "— Projeto (Cliente)".
  rotuloOrigem(o) { return [o && o.nome, o && o.cliente, o && o.idInterno].map(x => String(x || '').trim()).filter(Boolean).join(' · '); },
  textoNota(l, tipoFinal) {
    const tarefas = (l.tarefas || []).join('; ');
    if (Array.isArray(l.origens)) return [tarefas, l.origens.map(o => this.rotuloOrigem(o)).filter(Boolean).join('; ')].filter(Boolean).join(' — ');
    if (tipoFinal === 'PROJECT' || tipoFinal === 'APPLICATION') return tarefas;
    const projetos = l.projetos || [], clientes = l.clientes || [];
    const ctx = [];
    if (projetos.length) ctx.push(projetos.join('; '));
    if (clientes.length) ctx.push(projetos.length ? `(${clientes.join('; ')})` : clientes.join('; '));
    return [tarefas, ctx.join(' ')].filter(Boolean).join(' — ');
  },
  montarNota(texto) {
    const t = String(texto || '').trim();
    const nota = this.MARCA + (t ? ' ' + t : '');
    return nota.length > this.NOTA_MAX ? nota.slice(0, this.NOTA_MAX - 1) + '…' : nota;
  },
  _ordemTipo(t) { return t === 'PROJECT' ? 0 : t === 'APPLICATION' ? 1 : t === 'SERVICE' ? 2 : 3; },
  _fmt(n) { return String(Math.round(n * 100) / 100).replace('.', ','); },

  // O texto que se copia (JSON) — o importador lê exatamente isto.
  // "registo" (opcional): { url, chave, token } — com ele o importador avisa o Gestor, depois de gravar no orcprev, do que
  // foi carregado (ver supabase/orcprev_registo.sql). Sem ele o pacote funciona como antes.
  pacote({ email, pessoa, semana, geradoEm, registo }) {
    const p = {
      formato: this.FORMATO, versao: this.VERSAO, geradoEm: geradoEm || new Date().toISOString(),
      email: String(email || '').trim().toLowerCase(), pessoa: pessoa || '',
      semana: { inicio: semana.inicio, fim: semana.fim },
      linhas: semana.linhas, avisos: semana.avisos, totalGestor: semana.totalGestor, totalEnvio: semana.totalEnvio
    };
    if (registo && registo.url && registo.chave && registo.token) p.registo = { url: registo.url, chave: registo.chave, token: registo.token };
    return p;
  },
  textoDoPacote(pacote) { return JSON.stringify(pacote); },

  // ---------- o que já foi carregado no orcprev ----------
  // Um dia conta como carregado quando as horas gravadas no orcprev (último envio confirmado dessa semana) cobrem as horas
  // "enviáveis" que o Gestor tem nesse dia, com a folga do arredondamento a quartos de hora. ESPELHADO em
  // supabase/functions/lembrete-orcprev/logica.ts (o lembrete de sexta-feira) — se uma regra mudar, muda nas duas.
  TOLERANCIA_DIA: 0.25,
  // Horas do Gestor que seguem para o orcprev, por dia: registos de projeto, mais os tipos de trabalho que têm atividade
  // do orcprev definida (os outros nunca são enviados — ver linhasDaSemana). registos = da pessoa; tipoPorId(id) → tipo.
  horasEnviaveisPorDia(registos, tipoPorId, de, ate) {
    const m = {};
    (registos || []).forEach(r => {
      if (!r || !r.data || (de && r.data < de) || (ate && r.data > ate)) return;
      const h = Number(r.horas) || 0;
      if (h <= 0) return;
      const tipo = r.tipoTrabalhoId ? tipoPorId(r.tipoTrabalhoId) : null;
      if (tipo && !tipo.orcprevAtividade) return;
      m[r.data] = (m[r.data] || 0) + h;
    });
    return m;
  },
  // Estado de UMA semana. envios = os envios dessa pessoa e semana ({ confirmadoEm, criadoEm, dias, origem }).
  // estado: 'vazia' (sem horas para enviar) | 'carregada' | 'alterada' (já carregada, mas o Gestor tem mais horas desde então)
  //       | 'pendente' (nada carregado); 'copiada' = true se há uma cópia ainda por confirmar no orcprev.
  // desdeISO (opcional): dias antes desta data não contam (é a data "contar a partir de" das Definições do controlo).
  estadoSemana({ inicio, horasDia, envios, desdeISO }) {
    const ini = this.segundaDaSemana(inicio);
    const fim = this.somarDias(ini, 6);
    const lista = (envios || []).filter(e => e.semanaInicio ? e.semanaInicio === ini : true);
    const confirmados = lista.filter(e => e.confirmadoEm).sort((a, b) => String(b.confirmadoEm).localeCompare(String(a.confirmadoEm)));
    const ultimo = confirmados[0] || null;
    const copiada = lista.some(e => !e.confirmadoEm && (!ultimo || String(e.criadoEm) > String(ultimo.confirmadoEm)));
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const data = this.somarDias(ini, i);
      const gestor = (horasDia && horasDia[data]) || 0;
      if (gestor <= 0 || (desdeISO && data < desdeISO)) continue;
      const carregado = ultimo && ultimo.dias ? Number(ultimo.dias[data]) || 0 : 0;
      dias.push({ data, gestor, carregado, ok: carregado + this.TOLERANCIA_DIA + 1e-9 >= gestor });
    }
    const totalGestor = dias.reduce((s, d) => s + d.gestor, 0);
    const totalCarregado = dias.reduce((s, d) => s + Math.min(d.carregado, d.gestor), 0);
    const emFalta = dias.filter(d => !d.ok);
    const estado = !dias.length ? 'vazia' : !emFalta.length ? 'carregada' : ultimo ? 'alterada' : 'pendente';
    return { inicio: ini, fim, estado, dias, diasEmFalta: emFalta.map(d => d.data), totalGestor, totalCarregado, copiada, manual: !!(ultimo && ultimo.origem === 'manual'), carregadoEm: ultimo ? ultimo.confirmadoEm : null };
  },
  // As semanas, da mais recente para a mais antiga, desde "desdeISO" (ou as últimas "max" semanas), até à semana de hoje.
  semanasDoControlo({ hojeISO, desdeISO, max }) {
    const atual = this.segundaDaSemana(hojeISO);
    const limite = desdeISO ? this.segundaDaSemana(desdeISO) : null;
    const semanas = [];
    for (let i = 0; i < (max || 8); i++) {
      const ini = this.somarDias(atual, -7 * i);
      if (limite && ini < limite) break;
      semanas.push(ini);
    }
    return semanas;
  }
};

if (typeof module !== 'undefined') module.exports = OrcprevLogica;

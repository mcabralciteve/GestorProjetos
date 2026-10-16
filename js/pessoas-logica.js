// Pessoas inativas (saídas): regras puras, sem DOM nem rede — testadas em tests/pessoas-logica.test.js.
//
// Princípio: uma pessoa NUNCA se apaga por ter saído. Fica com "ativo = false" e/ou uma "data de saída"
// (último dia de trabalho); tudo o que é histórico (horas, tarefas passadas, ausências, equipa na data)
// mantém-se intacto. "Inativa" só afeta o que é FUTURO: listas de escolha, capacidade, lembretes, acesso.
const PessoasLogica = {
  // "hojeISO" é sempre injetado (aaaa-mm-dd) para as regras serem testáveis.
  // Inativa = marcada como inativa, OU a data de saída já passou (a pessoa trabalha até ao próprio dia).
  estaInativo(r, hojeISO) {
    if (!r) return false;
    return r.ativo === false || (!!r.dataSaida && r.dataSaida < hojeISO);
  },
  // 'ativo' | 'a-sair' (tem data de saída ainda por chegar) | 'inativo'
  estado(r, hojeISO) {
    if (this.estaInativo(r, hojeISO)) return 'inativo';
    return r && r.dataSaida && r.ativo !== false ? 'a-sair' : 'ativo';
  },

  // O que a pessoa "tem" na app — serve tanto para listar pendências como para decidir se pode ser
  // eliminada (só quem nunca teve nada). "horasRegistadas(projeto, tarefa, recursoId)" é injetada
  // (App.horasJaRegistadasTarefa) porque depende do índice de registos; "pendente(pp)" idem.
  pendencias(estado, recursoId, opcoes) {
    const o = opcoes || {};
    const horasRegistadas = o.horasRegistadas || (() => 0);
    const pendente = o.pendente || (pp => !pp.fechado && pp.estado !== 'concluido' && pp.estado !== 'abandonado' && !pp.dataReal);
    const projetos = Object.values(estado.projetos || {});
    const r2 = n => Math.round(n * 100) / 100;
    const tarefas = [], projetosGeridos = [], nextSteps = [];
    projetos.forEach(p => {
      if (p.gestorId === recursoId) projetosGeridos.push({ projetoId: p.id, idInterno: p.idInterno || '', nome: p.nome, cliente: p.cliente || '', suspenso: p.ativo === false });
      (p.tarefas || []).forEach(t => {
        if (!(t.recursoIds || []).includes(recursoId)) return;
        if ((t.progresso || 0) >= 100) return;
        const previstas = Number((t.alocacoesHoras || {})[recursoId]) || 0;
        const registadas = r2(horasRegistadas(p, t, recursoId) || 0);
        tarefas.push({ projetoId: p.id, idInterno: p.idInterno || '', projetoNome: p.nome, cliente: p.cliente || '',
          tarefaId: t.id, tarefaNome: t.nome, inicio: t.inicio, fim: t.fim, progresso: t.progresso || 0,
          previstas, registadas, restantes: Math.max(0, r2(previstas - registadas)) });
      });
      (p.proximosPassos || []).forEach(pp => {
        if (pp.responsavelId === recursoId && pendente(pp)) nextSteps.push({ projetoId: p.id, idInterno: p.idInterno || '', projetoNome: p.nome, ppId: pp.id, descricao: pp.descricao, dataPrevista: pp.dataPrevista || null });
      });
    });
    const equipasLideradas = (estado.equipas || []).filter(e => e.liderId === recursoId).map(e => ({ id: e.id, nome: e.nome }));
    const departamentosDirigidos = (estado.departamentos || []).filter(d => d.diretorId === recursoId).map(d => ({ id: d.id, nome: d.nome }));
    const total = tarefas.length + projetosGeridos.length + nextSteps.length + equipasLideradas.length + departamentosDirigidos.length;
    return { tarefas, projetosGeridos, nextSteps, equipasLideradas, departamentosDirigidos, total };
  },

  // O que a pessoa já teve (histórico) — se for tudo zero e não tiver conta, pode ser eliminada.
  historico(estado, recurso) {
    const projetos = Object.values(estado.projetos || {});
    const tarefas = projetos.reduce((n, p) => n + (p.tarefas || []).filter(t => (t.recursoIds || []).includes(recurso.id)).length, 0);
    const registos = (estado.registos || []).filter(x => x.pessoa === recurso.nome).length;
    const ausencias = (estado.ausencias || []).filter(a => a.recursoId === recurso.id).length;
    const geridos = projetos.filter(p => p.gestorId === recurso.id).length;
    const lidera = (estado.equipas || []).filter(e => e.liderId === recurso.id).length
      + (estado.departamentos || []).filter(d => d.diretorId === recurso.id).length;
    const conta = (estado.utilizadores || []).some(u => u.recursoId === recurso.id);
    const mudancasEquipa = (estado.historicoEquipas || []).filter(h => h.recursoId === recurso.id).length;
    const nextSteps = projetos.reduce((n, p) => n + (p.proximosPassos || []).filter(pp => pp.responsavelId === recurso.id).length, 0);
    const total = tarefas + registos + ausencias + geridos + lidera + nextSteps + (conta ? 1 : 0) + mudancasEquipa;
    return { tarefas, registos, ausencias, geridos, lidera, nextSteps, conta, mudancasEquipa, total };
  },
  // Eliminar só é seguro para quem nunca teve nada: apagar um recurso apaga em cascata as suas
  // ausências, histórico de equipas e atribuições, e deixa as horas registadas sem pessoa ligada.
  podeEliminar(estado, recurso) {
    const h = this.historico(estado, recurso);
    return { pode: h.total === 0, historico: h };
  },

  // Nunca deixar a plataforma sem Administrador ativo (nem o próprio se tirar o acesso).
  podeInativar(estado, recursoId, hojeISO) {
    const recurso = (estado.recursos || []).find(r => r.id === recursoId);
    if (!recurso) return { ok: false, motivo: 'Pessoa não encontrada.' };
    const eAdmin = (estado.utilizadores || []).some(u => u.recursoId === recursoId && u.papel === 'admin');
    if (eAdmin) {
      const outros = (estado.utilizadores || []).filter(u => u.papel === 'admin' && u.recursoId !== recursoId)
        .filter(u => !this.estaInativo((estado.recursos || []).find(r => r.id === u.recursoId), hojeISO));
      if (!outros.length) return { ok: false, motivo: 'É o único Administrador ativo. Atribui primeiro o acesso de Administrador a outra pessoa (em Pessoas → Acesso).' };
    }
    return { ok: true, motivo: '' };
  },

  // ---------- Substituição (Fase 2) ----------
  // Passa, num projeto, o trabalho por fazer de uma pessoa que sai para outra (ou deixa-o por atribuir).
  // Regras (decididas com o utilizador):
  //  - só passa o REMANESCENTE das horas previstas (previsto − já registado); o que a pessoa já fez fica com ela;
  //  - se a pessoa que sai já registou horas na tarefa, continua associada à tarefa com as horas feitas (o histórico
  //    mantém-se); se não registou nada, sai da tarefa;
  //  - tarefas concluídas (100%) nunca se tocam;
  //  - os next steps abertos da pessoa podem passar para o novo responsável.
  // "escolhas": { tarefas: { [tarefaId]: { acao: 'manter'|'passar'|'remover', paraId } }, nextSteps: { [ppId]: { acao: 'manter'|'passar', paraId } } }
  // "opcoes": { horasRegistadas(projeto, tarefa, recursoId), hojeISO }
  // Devolve { ops, nextSteps, erros }: nada é alterado aqui (ver aplicarSubstituicao).
  planearSubstituicao(estado, projetoId, deId, escolhas, opcoes) {
    const o = opcoes || {};
    const horasRegistadas = o.horasRegistadas || (() => 0);
    const r2 = n => Math.round(n * 100) / 100;
    const erros = [], ops = [], nextSteps = [];
    const p = (estado.projetos || {})[projetoId];
    if (!p) return { ops, nextSteps, erros: ['Projeto não encontrado.'] };
    const recursos = estado.recursos || [];
    const de = recursos.find(r => r.id === deId);
    if (!de) return { ops, nextSteps, erros: ['Pessoa não encontrada.'] };
    const destinoValido = (paraId) => {
      const para = recursos.find(r => r.id === paraId);
      if (!para) return 'Escolhe a pessoa que fica com o trabalho.';
      if (paraId === deId) return 'A pessoa que fica não pode ser a mesma que sai.';
      if (this.estaInativo(para, o.hojeISO || '9999-12-31') || (para.dataSaida && para.ativo !== false)) return `${para.nome} também sai da empresa — escolhe outra pessoa.`;
      return '';
    };
    const esc = escolhas || {};
    (p.tarefas || []).forEach(t => {
      const e = (esc.tarefas || {})[t.id];
      if (!e || e.acao === 'manter' || !e.acao) return;
      if (!(t.recursoIds || []).includes(deId) || (t.progresso || 0) >= 100) return;   // nada a fazer / concluída
      const previstas = Number((t.alocacoesHoras || {})[deId]) || 0;
      const registadas = r2(horasRegistadas(p, t, deId) || 0);
      const restantes = Math.max(0, r2(previstas - registadas));
      const op = { tarefaId: t.id, tarefaNome: t.nome, acao: e.acao, paraId: null, previstas, registadas, restantes, ficaComHoras: r2(previstas - restantes), sai: registadas <= 0 };
      if (e.acao === 'passar') {
        const motivo = destinoValido(e.paraId);
        if (motivo) { erros.push(`${t.nome}: ${motivo}`); return; }
        op.paraId = e.paraId;
      } else if (e.acao !== 'remover') { erros.push(`${t.nome}: ação desconhecida.`); return; }
      ops.push(op);
    });
    (p.proximosPassos || []).forEach(pp => {
      const e = (esc.nextSteps || {})[pp.id];
      if (!e || e.acao !== 'passar' || pp.responsavelId !== deId) return;
      const motivo = destinoValido(e.paraId);
      if (motivo) { erros.push(`Next step "${pp.descricao || ''}": ${motivo}`); return; }
      nextSteps.push({ ppId: pp.id, descricao: pp.descricao || '', paraId: e.paraId });
    });
    return { ops, nextSteps, erros };
  },
  // Aplica um plano (de planearSubstituicao, sem erros) ao estado. Devolve as linhas do registo de substituições.
  aplicarSubstituicao(estado, projetoId, deId, plano, quemFezId) {
    const p = estado.projetos[projetoId];
    const nome = id => ((estado.recursos || []).find(r => r.id === id) || {}).nome || '';
    const linhas = [];
    const base = { projetoId, projetoNome: p.nome, deId, deNome: nome(deId), feitoPor: quemFezId || null };
    plano.ops.forEach(op => {
      const t = p.tarefas.find(x => x.id === op.tarefaId);
      if (!t.alocacoesHoras) t.alocacoesHoras = {};
      if (op.paraId) {
        if (!(t.recursoIds || []).includes(op.paraId)) t.recursoIds.push(op.paraId);
        t.alocacoesHoras[op.paraId] = Math.round(((Number(t.alocacoesHoras[op.paraId]) || 0) + op.restantes) * 100) / 100;
      }
      if (op.sai) {
        t.recursoIds = t.recursoIds.filter(rid => rid !== deId);
        delete t.alocacoesHoras[deId];
      } else {
        t.alocacoesHoras[deId] = op.ficaComHoras;
      }
      linhas.push(Object.assign({}, base, { tipo: 'tarefa', tarefaId: op.tarefaId, tarefaNome: op.tarefaNome, paraId: op.paraId, paraNome: op.paraId ? nome(op.paraId) : '', horas: op.restantes,
        observacoes: op.paraId ? '' : 'Deixada por atribuir' }));
    });
    plano.nextSteps.forEach(n => {
      const pp = p.proximosPassos.find(x => x.id === n.ppId);
      pp.responsavelId = n.paraId;
      linhas.push(Object.assign({}, base, { tipo: 'next_step', tarefaId: null, tarefaNome: n.descricao, paraId: n.paraId, paraNome: nome(n.paraId), horas: 0, observacoes: '' }));
    });
    return linhas;
  },

  // Texto curto para a coluna "Estado" (dd/mm/aaaa a partir de aaaa-mm-dd).
  dataPT(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; },
  rotuloEstado(r, hojeISO) {
    const e = this.estado(r, hojeISO);
    if (e === 'a-sair') return `Sai a ${this.dataPT(r.dataSaida)}`;
    if (e === 'inativo') return r.dataSaida ? `Inativa desde ${this.dataPT(r.dataSaida)}` : 'Inativa';
    return 'Ativa';
  }
};
if (typeof module !== 'undefined') module.exports = PessoasLogica;

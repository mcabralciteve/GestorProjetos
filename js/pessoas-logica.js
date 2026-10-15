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

// Lógica pura da agenda do dia — espelha o cartão "A minha agenda de hoje" do Início (js/app.js,
// renderDashboard): tarefas-folha (sem subtarefas) de projetos ativos, atribuídas à pessoa, cujo
// período inclui hoje. Se uma das duas mudar, a outra tem de mudar também.

export interface Projeto { id: string; id_interno: string | null; nome: string; cliente: string | null; ativo: boolean | null }
export interface Tarefa { id: string; projeto_id: string; parent_id: string | null; nome: string; inicio: string; fim: string; progresso: number | null }
export interface TarefaRecurso { tarefa_id: string; recurso_id: string }
export interface Ausencia { recurso_id: string; data_inicio: string; data_fim: string; estado: string }
export interface ItemAgenda { projeto: string; tarefa: string; inicio: string; fim: string; progresso: number }

// Sempre "idInterno — nome (cliente)" — nunca só o código do projeto (ver memória do projeto).
export function rotuloProjeto(p: Projeto): string {
  return `${p.id_interno ? p.id_interno + ' — ' : ''}${p.nome}${p.cliente ? ` (${p.cliente})` : ''}`;
}

// Uma passagem por todas as tarefas: devolve, por pessoa, as suas tarefas-folha de projetos ativos.
export function indexarAgenda(projetos: Projeto[], tarefas: Tarefa[], atribuicoes: TarefaRecurso[]): Map<string, ItemAgenda[]> {
  const ativos = new Map(projetos.filter(p => p.ativo !== false).map(p => [p.id, p]));
  const temFilhos = new Set(tarefas.filter(t => t.parent_id).map(t => t.parent_id as string));
  const porTarefa = new Map(tarefas.map(t => [t.id, t]));
  const mapa = new Map<string, ItemAgenda[]>();
  for (const a of atribuicoes) {
    const t = porTarefa.get(a.tarefa_id);
    const p = t && ativos.get(t.projeto_id);
    if (!t || !p || temFilhos.has(t.id)) continue;
    const lista = mapa.get(a.recurso_id) ?? [];
    lista.push({ projeto: rotuloProjeto(p), tarefa: t.nome, inicio: t.inicio, fim: t.fim, progresso: t.progresso ?? 0 });
    mapa.set(a.recurso_id, lista);
  }
  return mapa;
}

// Tarefas de hoje de uma pessoa; [] se estiver ausente (não rejeitada) — não faz sentido mandar
// a agenda a quem está de férias.
export function agendaDoDia(recursoId: string, hojeISO: string, indice: Map<string, ItemAgenda[]>, ausencias: Ausencia[]): ItemAgenda[] {
  const ausente = ausencias.some(a => a.recurso_id === recursoId && a.estado !== 'rejeitada' && hojeISO >= a.data_inicio && hojeISO <= a.data_fim);
  if (ausente) return [];
  return (indice.get(recursoId) ?? [])
    .filter(i => hojeISO >= i.inicio && hojeISO <= i.fim)
    .sort((a, b) => a.projeto.localeCompare(b.projeto, 'pt') || a.tarefa.localeCompare(b.tarefa, 'pt'));
}

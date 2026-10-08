// Lógica pura do resumo diário por email. A secção "Tarefas de hoje" espelha o cartão "A minha agenda
// de hoje" do Início (js/app.js, renderDashboard): tarefas-folha (sem subtarefas) de projetos ativos,
// atribuídas à pessoa, cujo período inclui hoje. Se uma das duas mudar, a outra tem de mudar também.
// Além disso o email leva, por pessoa: tarefas em atraso, o que começa nos próximos dias e os
// next steps abertos de que é responsável (cada secção só aparece se tiver conteúdo).

export interface Projeto { id: string; id_interno: string | null; nome: string; cliente: string | null; ativo: boolean | null }
export interface Tarefa { id: string; projeto_id: string; parent_id: string | null; nome: string; inicio: string; fim: string; progresso: number | null }
export interface TarefaRecurso { tarefa_id: string; recurso_id: string; horas?: number | string | null }
import {
  aprovacoesPendentes, resumoComercial, temAcessoCrm,
  type ContextoAprovacao, type ContextoComercial, type ItemAprovacao, type ItemFollowup, type ItemOportunidade,
} from './extras.ts';

export interface Ausencia { recurso_id: string; data_inicio: string; data_fim: string; estado: string; tipo?: string | null }
export interface Passo {
  id: string; projeto_id: string; tarefa_id: string | null; descricao: string; estado: string;
  fechado: boolean | null; data_prevista: string | null; responsavel_id: string | null;
}
export interface RegistoHoras { tarefa_id: string | null; pessoa: string; horas: number | string | null }
export interface ItemAgenda {
  id: string; projeto: string; tarefa: string; inicio: string; fim: string; progresso: number;
  horasPrevistas: number | null; registadas: number;
}
export interface ItemPasso { descricao: string; projeto: string; tarefa: string | null; prazo: string | null; atrasado: boolean; estado: string }
export interface ResumoDia {
  hoje: ItemAgenda[]; atrasadas: ItemAgenda[]; proximas: ItemAgenda[]; passos: ItemPasso[];
  // Só para quem tem papel de chefia (ver extras.ts); em falta = vazio.
  aprovacoes?: ItemAprovacao[]; followups?: ItemFollowup[]; oportunidades?: ItemOportunidade[];
}

// Sempre "idInterno — nome (cliente)" — nunca só o código do projeto (ver memória do projeto).
export function rotuloProjeto(p: Projeto): string {
  return `${p.id_interno ? p.id_interno + ' — ' : ''}${p.nome}${p.cliente ? ` (${p.cliente})` : ''}`;
}

export function somarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
    lista.push({
      id: t.id, projeto: rotuloProjeto(p), tarefa: t.nome, inicio: t.inicio, fim: t.fim, progresso: t.progresso ?? 0,
      horasPrevistas: numero(a.horas), registadas: 0,
    });
    mapa.set(a.recurso_id, lista);
  }
  return mapa;
}

const estaAusente = (recursoId: string, dia: string, ausencias: Ausencia[]) =>
  ausencias.some(a => a.recurso_id === recursoId && a.estado !== 'rejeitada' && dia >= a.data_inicio && dia <= a.data_fim);

const porProjetoETarefa = (a: ItemAgenda, b: ItemAgenda) =>
  a.projeto.localeCompare(b.projeto, 'pt') || a.tarefa.localeCompare(b.tarefa, 'pt');

// Tarefas de hoje de uma pessoa; [] se estiver ausente (não rejeitada) — não faz sentido mandar
// a agenda a quem está de férias.
export function agendaDoDia(recursoId: string, hojeISO: string, indice: Map<string, ItemAgenda[]>, ausencias: Ausencia[]): ItemAgenda[] {
  if (estaAusente(recursoId, hojeISO, ausencias)) return [];
  return (indice.get(recursoId) ?? [])
    .filter(i => hojeISO >= i.inicio && hojeISO <= i.fim)
    .sort(porProjetoETarefa);
}

// Horas já registadas por (tarefa, pessoa) — só conta registos ligados a uma tarefa por id.
export function indexarRegistadas(registos: RegistoHoras[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of registos) {
    if (!r.tarefa_id) continue;
    const k = r.tarefa_id + '|' + r.pessoa;
    m.set(k, (m.get(k) ?? 0) + (numero(r.horas) ?? 0));
  }
  return m;
}

export interface ContextoResumo {
  indice: Map<string, ItemAgenda[]>;
  ausencias: Ausencia[];
  passos: Passo[];
  projetos: Projeto[];
  tarefas: Tarefa[];
  registadas: Map<string, number>;
  diasAFrente?: number;
  // Estrutura da organização (quem lidera quem) — para "por aprovar" e para saber quem vê o Comercial.
  org?: ContextoAprovacao;
  comercial?: ContextoComercial;
}

// Tudo o que a pessoa deve ver hoje. Tudo vazio se estiver ausente (de férias não se manda nada).
export function resumoDoDia(rec: { id: string; nome: string; acesso?: string | null }, hojeISO: string, c: ContextoResumo): ResumoDia {
  const vazio: ResumoDia = { hoje: [], atrasadas: [], proximas: [], passos: [] };
  if (estaAusente(rec.id, hojeISO, c.ausencias)) return vazio;
  const comRegistadas = (i: ItemAgenda): ItemAgenda => ({ ...i, registadas: c.registadas.get(i.id + '|' + rec.nome) ?? 0 });
  const minhas = c.indice.get(rec.id) ?? [];
  const limite = somarDias(hojeISO, c.diasAFrente ?? 7);

  const hoje = agendaDoDia(rec.id, hojeISO, c.indice, c.ausencias).map(comRegistadas);
  // Mais recentes primeiro: tarefas esquecidas há anos não escondem as que acabaram de falhar o prazo.
  const atrasadas = minhas.filter(i => i.fim < hojeISO && i.progresso < 100)
    .sort((a, b) => b.fim.localeCompare(a.fim) || porProjetoETarefa(a, b)).map(comRegistadas);
  const proximas = minhas.filter(i => i.inicio > hojeISO && i.inicio <= limite)
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || porProjetoETarefa(a, b)).map(comRegistadas);

  const ativos = new Map(c.projetos.filter(p => p.ativo !== false).map(p => [p.id, p]));
  const nomeTarefa = new Map(c.tarefas.map(t => [t.id, t.nome]));
  const passos: ItemPasso[] = [];
  for (const p of c.passos) {
    const proj = ativos.get(p.projeto_id);
    if (p.responsavel_id !== rec.id || !proj || p.fechado || !['aberto', 'em_curso'].includes(p.estado)) continue;
    passos.push({
      descricao: p.descricao, projeto: rotuloProjeto(proj), tarefa: p.tarefa_id ? (nomeTarefa.get(p.tarefa_id) ?? null) : null,
      prazo: p.data_prevista, atrasado: !!p.data_prevista && p.data_prevista < hojeISO, estado: p.estado,
    });
  }
  // Atrasados primeiro (o mais antigo no topo), depois por prazo; sem prazo no fim.
  passos.sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999') || a.projeto.localeCompare(b.projeto, 'pt'));
  const pessoa = { id: rec.id, nome: rec.nome, acesso: rec.acesso, equipa_id: null };
  const aprovacoes = c.org ? aprovacoesPendentes(pessoa, c.ausencias, c.org) : [];
  const comercial = c.org && c.comercial && temAcessoCrm(pessoa, c.org.equipas, c.org.departamentos)
    ? resumoComercial(rec, hojeISO, c.comercial, c.diasAFrente ?? 7) : { followups: [], oportunidades: [] };
  return { hoje, atrasadas, proximas, passos, aprovacoes, followups: comercial.followups, oportunidades: comercial.oportunidades };
}

// Aplica as escolhas da pessoa ("A minha conta"): uma secção marcada false fica vazia. Em falta = ligada.
export const CHAVES_SECCOES = ['hoje', 'atrasadas', 'passos', 'proximas', 'aprovacoes', 'followups', 'oportunidades'] as const;
export function aplicarPreferencias(r: ResumoDia, prefs: Record<string, boolean> | null | undefined): ResumoDia {
  if (!prefs) return r;
  const copia: ResumoDia = { ...r };
  for (const k of CHAVES_SECCOES) if (prefs[k] === false) (copia as unknown as Record<string, unknown[]>)[k] = [];
  return copia;
}

export const resumoVazio = (r: ResumoDia) =>
  !r.hoje.length && !r.atrasadas.length && !r.proximas.length && !r.passos.length &&
  !(r.aprovacoes?.length) && !(r.followups?.length) && !(r.oportunidades?.length);

export const totalItens = (r: ResumoDia) =>
  r.hoje.length + r.atrasadas.length + r.proximas.length + r.passos.length +
  (r.aprovacoes?.length ?? 0) + (r.followups?.length ?? 0) + (r.oportunidades?.length ?? 0);

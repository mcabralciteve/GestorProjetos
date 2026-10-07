// Secções do resumo diário só para quem tem papel de chefia: pedidos de ausência por aprovar e o
// Comercial (CRM). Lógica pura. As regras ESPELHAM a app e a base de dados — se mudarem lá, mudam aqui:
//  - quem decide uma ausência: App.podeDecidirAusencia (js/app.js) — o Administrador (qualquer uma) ou o
//    líder da equipa da pessoa / diretor do departamento dessa equipa; nunca a própria pessoa (exceto Admin);
//  - quem vê o Comercial: crm_tem_acesso() em supabase/crm_fase1.sql — Admin, diretor de algum departamento
//    ou líder de alguma equipa.

export interface Pessoa { id: string; nome: string; acesso?: string | null; equipa_id?: string | null }
export interface Equipa { id: string; lider_id: string | null; departamento_id: string | null }
export interface Departamento { id: string; diretor_id: string | null }
export interface AusenciaPedido { id?: string; recurso_id: string; data_inicio: string; data_fim: string; estado: string; tipo?: string | null }

export interface ContextoAprovacao { recursos: Pessoa[]; equipas: Equipa[]; departamentos: Departamento[] }
export interface ItemAprovacao { pessoa: string; tipo: string; inicio: string; fim: string }

const eAdmin = (rec: { acesso?: string | null }) => rec.acesso === 'admin';

// A equipa é liderada por esta pessoa se for o líder dela, ou o diretor do seu departamento.
function lideraEquipa(recId: string, eq: Equipa, deps: Departamento[]): boolean {
  if (eq.lider_id === recId) return true;
  return !!eq.departamento_id && deps.some(d => d.id === eq.departamento_id && d.diretor_id === recId);
}

export function eLiderOuDiretor(recId: string, equipas: Equipa[], deps: Departamento[]): boolean {
  return equipas.some(eq => lideraEquipa(recId, eq, deps)) || deps.some(d => d.diretor_id === recId);
}

export function temAcessoCrm(rec: Pessoa, equipas: Equipa[], deps: Departamento[]): boolean {
  return eAdmin(rec) || eLiderOuDiretor(rec.id, equipas, deps);
}

// Pedidos "pendentes" que esta pessoa pode decidir, os mais próximos primeiro.
export function aprovacoesPendentes(rec: Pessoa, pedidos: AusenciaPedido[], c: ContextoAprovacao): ItemAprovacao[] {
  const porId = new Map(c.recursos.map(r => [r.id, r]));
  const equipasLideradas = new Set(c.equipas.filter(eq => lideraEquipa(rec.id, eq, c.departamentos)).map(eq => eq.id));
  if (!eAdmin(rec) && !equipasLideradas.size) return [];
  return pedidos
    .filter(a => {
      if (a.estado !== 'pendente') return false;
      const alvo = porId.get(a.recurso_id);
      if (!alvo) return false;
      if (eAdmin(rec)) return true;
      return a.recurso_id !== rec.id && !!alvo.equipa_id && equipasLideradas.has(alvo.equipa_id);
    })
    .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))
    .map(a => ({ pessoa: porId.get(a.recurso_id)!.nome, tipo: a.tipo || 'Ausência', inicio: a.data_inicio, fim: a.data_fim }));
}

// ---------------- Comercial ----------------
export interface CrmTarefa { id: string; conta_id: string | null; oportunidade_id: string | null; descricao: string; responsavel_id: string | null; data_limite: string | null; concluida: boolean | null }
export interface CrmOportunidade { id: string; conta_id: string; titulo: string; etapa_id: string; valor_estimado: number | string | null; data_prevista_fecho: string | null; responsavel_id: string | null }
export interface CrmEtapa { id: string; nome: string; categoria: string }
export interface CrmConta { id: string; nome: string }
export interface ContextoComercial { tarefas: CrmTarefa[]; oportunidades: CrmOportunidade[]; etapas: CrmEtapa[]; contas: CrmConta[] }
export interface ItemFollowup { descricao: string; contexto: string; prazo: string; atrasado: boolean }
export interface ItemOportunidade { titulo: string; conta: string; etapa: string; valor: number; fecho: string; ultrapassado: boolean }
export interface ResumoComercial { followups: ItemFollowup[]; oportunidades: ItemOportunidade[] }

function somarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Só o que é DESTA pessoa (responsável): follow-ups por fazer até hoje (inclui os atrasados) e
// oportunidades em curso com fecho previsto ultrapassado ou nos próximos dias. A decisão de quem
// recebe (acesso ao Comercial) é de quem chama.
export function resumoComercial(rec: { id: string }, hojeISO: string, c: ContextoComercial, diasAFrente = 7): ResumoComercial {
  const conta = new Map(c.contas.map(x => [x.id, x.nome]));
  const etapa = new Map(c.etapas.map(x => [x.id, x]));
  const oportunidade = new Map(c.oportunidades.map(x => [x.id, x]));
  const limite = somarDias(hojeISO, diasAFrente);

  const followups: ItemFollowup[] = c.tarefas
    .filter(t => !t.concluida && t.responsavel_id === rec.id && !!t.data_limite && t.data_limite <= hojeISO)
    .sort((a, b) => (a.data_limite as string).localeCompare(b.data_limite as string))
    .map(t => {
      const op = t.oportunidade_id ? oportunidade.get(t.oportunidade_id) : undefined;
      const nomeConta = conta.get(t.conta_id ?? op?.conta_id ?? '');
      const contexto = [nomeConta, op?.titulo].filter(Boolean).join(' · ');
      return { descricao: t.descricao, contexto, prazo: t.data_limite as string, atrasado: (t.data_limite as string) < hojeISO };
    });

  const oportunidades: ItemOportunidade[] = c.oportunidades
    .filter(o => o.responsavel_id === rec.id && etapa.get(o.etapa_id)?.categoria === 'aberta' && !!o.data_prevista_fecho && o.data_prevista_fecho <= limite)
    .sort((a, b) => (a.data_prevista_fecho as string).localeCompare(b.data_prevista_fecho as string))
    .map(o => ({
      titulo: o.titulo, conta: conta.get(o.conta_id) ?? '', etapa: etapa.get(o.etapa_id)?.nome ?? '',
      valor: Number(o.valor_estimado) || 0, fecho: o.data_prevista_fecho as string, ultrapassado: (o.data_prevista_fecho as string) < hojeISO,
    }));
  return { followups, oportunidades };
}

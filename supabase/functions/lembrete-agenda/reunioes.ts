// Ações decididas em reuniões (módulo "Reuniões" da app) que são de uma pessoa: entram no resumo diário como "Ações de reuniões".
// Lógica pura. As regras ESPELHAM a app — se mudarem lá, mudam aqui (js/reunioes-logica.js, acoesDe):
//  - uma ação é um "ponto" da reunião com tipo 'acao', por fazer (concluida falso), cujo responsável é um colega da app
//    (responsavel_recurso_id); reuniões canceladas não contam;
//  - no email só entram as que têm prazo até daqui a 7 dias (as atrasadas primeiro) — as sem prazo ficam só na app (Início).

export interface Ponto {
  id: string; tipo: string; texto?: string | null; responsavel_recurso_id?: string | null; prazo?: string | null;
  concluida?: boolean | null; natureza?: string | null; tarefa_id?: string | null; tarefa_nome?: string | null;
}
export interface Reuniao {
  id: string; titulo: string; data_hora: string; estado: string; projeto_id?: string | null; projeto_nome?: string | null;
  cliente?: string | null; oportunidade_titulo?: string | null; pontos: Ponto[] | null;
}
export interface ItemAcao { descricao: string; contexto: string; prazo: string; atrasado: boolean; hoje: boolean }

function somarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "30/10" na hora de Lisboa (a reunião guarda o instante em UTC).
function diaMes(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit' });
}

// De onde vem a ação: "projeto › tarefa", "Comercial · cliente · oportunidade" ou o cliente — e a reunião em que nasceu.
// nomeTarefa: nome atual da tarefa (o que ficou escrito na reunião pode estar desatualizado).
function contextoDe(p: Ponto, r: Reuniao, nomeTarefa: (id: string) => string | undefined): string {
  let origem = '';
  if (p.natureza === 'projeto') {
    const tarefa = (p.tarefa_id ? nomeTarefa(p.tarefa_id) : undefined) ?? p.tarefa_nome ?? '';
    origem = [r.projeto_nome, tarefa].filter(Boolean).join(' › ') || 'Projeto';
  } else if (p.natureza === 'comercial') {
    origem = ['Comercial', r.cliente, r.oportunidade_titulo].filter(Boolean).join(' · ');
  } else origem = r.cliente ?? '';
  const quando = diaMes(r.data_hora);
  return [origem, `reunião "${r.titulo}"${quando ? ` (${quando})` : ''}`].filter(Boolean).join(' · ');
}

export function acoesDeReunioes(
  rec: { id: string }, hojeISO: string, reunioes: Reuniao[], nomeTarefa: (id: string) => string | undefined = () => undefined, diasAFrente = 7,
): ItemAcao[] {
  const limite = somarDias(hojeISO, diasAFrente);
  const itens: ItemAcao[] = [];
  for (const r of reunioes) {
    if (r.estado === 'cancelada') continue;
    for (const p of r.pontos ?? []) {
      if (p.tipo !== 'acao' || p.concluida || p.responsavel_recurso_id !== rec.id || !p.prazo || p.prazo > limite) continue;
      itens.push({
        descricao: p.texto ?? '', contexto: contextoDe(p, r, nomeTarefa), prazo: p.prazo, atrasado: p.prazo < hojeISO, hoje: p.prazo === hojeISO,
      });
    }
  }
  // Atrasadas primeiro (a mais antiga no topo), depois por prazo.
  return itens.sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || a.prazo.localeCompare(b.prazo) || a.descricao.localeCompare(b.descricao, 'pt'));
}

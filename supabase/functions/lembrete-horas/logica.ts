// Lógica pura (sem rede, sem base de dados) do lembrete de horas em falta — espelha
// App.diasIncompletosRecurso (js/app.js) para o servidor dar exatamente a mesma resposta que o
// Dashboard "Os meus dias por preencher". Se uma das duas mudar, a outra tem de mudar também.

export const HORAS_DIA = 8;
export const DIAS_JANELA = 10;

export interface Ausencia { recurso_id: string; data_inicio: string; data_fim: string; estado: string }
export interface Registo { pessoa: string; data: string; horas: number | string }
export interface DiaEmFalta { iso: string; faltam: number }

function paraUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function paraISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ehFimDeSemana(d: Date): boolean {
  const dia = d.getUTCDay();
  return dia === 0 || dia === 6;
}

// "Hoje" no fuso de Lisboa (o servidor corre em UTC — perto da meia-noite os dias divergem).
export function hojeEmLisboa(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export function ehDiaUtil(iso: string, feriados: Set<string>): boolean {
  return !ehFimDeSemana(paraUTC(iso)) && !feriados.has(iso);
}

// Últimos "nDias" dias úteis (sem fim de semana, feriado ou ausência não rejeitada) antes de
// "hojeISO" em que o total de horas registadas fica abaixo de HORAS_DIA. "hoje" nunca conta.
export function diasEmFalta(
  recursoId: string, nome: string, hojeISO: string, nDias: number,
  feriados: Set<string>, ausencias: Ausencia[], horasPorPessoaDia: Map<string, number>,
): DiaEmFalta[] {
  const minhas = ausencias.filter(a => a.recurso_id === recursoId && a.estado !== 'rejeitada');
  const dias: DiaEmFalta[] = [];
  let cursor = paraUTC(hojeISO);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  let vistos = 0, guarda = 0;
  while (vistos < nDias && guarda < nDias * 20 + 90) {
    guarda++;
    const iso = paraISO(cursor);
    const ausente = minhas.some(a => iso >= a.data_inicio && iso <= a.data_fim);
    if (!ehFimDeSemana(cursor) && !feriados.has(iso) && !ausente) {
      vistos++;
      const registadas = horasPorPessoaDia.get(nome + '|' + iso) || 0;
      if (registadas + 1e-9 < HORAS_DIA) dias.push({ iso, faltam: HORAS_DIA - registadas });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dias.sort((a, b) => a.iso.localeCompare(b.iso));
}

export function indexarHoras(registos: Registo[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const r of registos) {
    const chave = r.pessoa + '|' + r.data;
    mapa.set(chave, (mapa.get(chave) || 0) + (Number(r.horas) || 0));
  }
  return mapa;
}

export function formatarDia(iso: string): string {
  const [y, m, d] = iso.split('-');
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return `${dias[paraUTC(iso).getUTCDay()]}, ${d}/${m}/${y}`;
}

export function formatarHoras(h: number): string {
  return (Math.round(h * 100) / 100).toString().replace('.', ',') + 'h';
}

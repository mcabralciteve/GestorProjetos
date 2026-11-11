// Lógica pura (sem rede nem base de dados) do lembrete de sexta-feira "horas por carregar no orcprev".
// ESPELHA js/orcprev-logica.js (OrcprevLogica.horasEnviaveisPorDia / estadoSemana) — o ecrã "Horas → Orcprev" do Gestor e
// este email têm de dar a mesma resposta. Se uma regra mudar numa, muda na outra.
//
// Um dia conta como carregado quando as horas gravadas no orcprev (último envio CONFIRMADO dessa pessoa e semana) cobrem as
// horas "enviáveis" do Gestor nesse dia, com a folga do arredondamento a quartos de hora (0,25 h).

export const TOLERANCIA_DIA = 0.25;
export const SEMANAS_MAX = 8;

export interface RegistoOrc { pessoa: string; data: string; horas: number | string | null; tipo_trabalho_id: string | null }
export interface Envio {
  recurso_id: string; semana_inicio: string; criado_em: string; confirmado_em: string | null;
  dias: Record<string, number> | null; origem?: string | null;
}
export interface DiaPorCarregar { data: string; gestor: number; carregado: number }
export interface SemanaPorCarregar { inicio: string; fim: string; dias: DiaPorCarregar[] }

const paraUTC = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
export const somarDias = (iso: string, n: number): string => { const d = paraUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Segunda-feira da semana que contém o dia (o orcprev começa a semana à segunda; o domingo pertence à semana que acabou).
export const segundaDaSemana = (iso: string): string => { const dow = paraUTC(iso).getUTCDay(); return somarDias(iso, dow === 0 ? -6 : 1 - dow); };
export const ehSexta = (iso: string): boolean => paraUTC(iso).getUTCDay() === 5;

// Horas do Gestor que seguem para o orcprev, por dia: registos de projeto + os tipos de trabalho com atividade do orcprev
// definida (os que a não têm nunca são enviados). tiposSemAtividade = ids dos tipos SEM atividade.
export function horasEnviaveisPorDia(registos: RegistoOrc[], tiposSemAtividade: Set<string>, de: string, ate: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of registos) {
    if (!r.data || r.data < de || r.data > ate) continue;
    const h = Number(r.horas) || 0;
    if (h <= 0) continue;
    if (r.tipo_trabalho_id && tiposSemAtividade.has(r.tipo_trabalho_id)) continue;
    m[r.data] = (m[r.data] ?? 0) + h;
  }
  return m;
}

// Semanas (da mais antiga para a mais recente) com dias por carregar: de "desde" (ou das últimas SEMANAS_MAX semanas) até à
// semana de hoje. registos = só os DESTA pessoa; envios = só os DESTA pessoa.
export function semanasPorCarregar(
  hojeISO: string, desdeISO: string | null, registos: RegistoOrc[], envios: Envio[], tiposSemAtividade: Set<string>,
): SemanaPorCarregar[] {
  const atual = segundaDaSemana(hojeISO);
  const limite = desdeISO ? segundaDaSemana(desdeISO) : null;
  const resultado: SemanaPorCarregar[] = [];
  for (let i = 0; i < SEMANAS_MAX; i++) {
    const inicio = somarDias(atual, -7 * i);
    if (limite && inicio < limite) break;
    const fim = somarDias(inicio, 6);
    const horasDia = horasEnviaveisPorDia(registos, tiposSemAtividade, inicio, fim);
    const ultimo = envios
      .filter(e => e.semana_inicio === inicio && e.confirmado_em)
      .sort((a, b) => String(b.confirmado_em).localeCompare(String(a.confirmado_em)))[0];
    const dias: DiaPorCarregar[] = [];
    for (let k = 0; k < 7; k++) {
      const data = somarDias(inicio, k);
      const gestor = horasDia[data] ?? 0;
      if (gestor <= 0 || data > hojeISO || (desdeISO && data < desdeISO)) continue; // "desde": antes dessa data nada conta
      const carregado = Number(ultimo?.dias?.[data]) || 0;
      if (carregado + TOLERANCIA_DIA + 1e-9 < gestor) dias.push({ data, gestor, carregado });
    }
    if (dias.length) resultado.push({ inicio, fim, dias });
  }
  return resultado.reverse();
}

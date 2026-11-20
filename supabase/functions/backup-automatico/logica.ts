// Lógica pura (sem rede nem base de dados) do backup automático: nomes dos ficheiros, quais apagar (retenção) e deteção de
// quedas suspeitas no número de linhas em relação ao backup anterior.

export const BUCKET = 'backups-fio';
export const PASTA = 'diario';
export const DIAS_DIARIOS = 30;   // todos os backups dos últimos 30 dias
export const MESES_MENSAIS = 12;  // e, para trás disso, o primeiro de cada mês durante 12 meses
export const QUEDA_LIMITE = 0.2;  // uma tabela com menos 20% de linhas que ontem dá alerta…
export const QUEDA_MINIMO = 10;   // …se tinha pelo menos 10 linhas (em tabelas minúsculas, 3 → 2 não é um sinal)

export const nomeDoDia = (iso: string): string => `fio_${iso}.sql`;
export const dataDoNome = (nome: string): string | null => /^fio_(\d{4}-\d{2}-\d{2})\.sql$/.exec(nome)?.[1] ?? null;

const paraUTC = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d); };
export const diasEntre = (de: string, ate: string): number => Math.round((paraUTC(ate) - paraUTC(de)) / 86400000);

// Quais dos ficheiros da pasta se podem apagar. Fica sempre: o de hoje, os dos últimos DIAS_DIARIOS dias e, por cada mês
// (dos últimos MESES_MENSAIS), o ficheiro mais antigo desse mês. Ficheiros com nomes que não são os nossos nunca se apagam.
export function ficheirosAApagar(nomes: string[], hojeISO: string): string[] {
  const nossos = nomes.map(n => ({ nome: n, data: dataDoNome(n) })).filter((x): x is { nome: string; data: string } => !!x.data);
  const primeiroDoMes = new Map<string, string>(); // aaaa-mm → data mais antiga desse mês
  for (const f of nossos) {
    const mes = f.data.slice(0, 7);
    const atual = primeiroDoMes.get(mes);
    if (!atual || f.data < atual) primeiroDoMes.set(mes, f.data);
  }
  const apagar: string[] = [];
  for (const f of nossos) {
    const idade = diasEntre(f.data, hojeISO);
    if (idade <= DIAS_DIARIOS) continue; // recentes (e o futuro, por segurança)
    const ehPrimeiroDoMes = primeiroDoMes.get(f.data.slice(0, 7)) === f.data;
    const mesesAtras = (Number(hojeISO.slice(0, 4)) - Number(f.data.slice(0, 4))) * 12 + (Number(hojeISO.slice(5, 7)) - Number(f.data.slice(5, 7)));
    if (ehPrimeiroDoMes && mesesAtras <= MESES_MENSAIS) continue;
    apagar.push(f.nome);
  }
  return apagar;
}

// Contagens por tabela, lidas do cabeçalho do backup ("-- tabela registos: 1208").
export function lerContagens(texto: string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const m of texto.matchAll(/^-- tabela ([a-z0-9_]+): (\d+)$/gm)) r[m[1]] = Number(m[2]);
  return r;
}

export interface Queda { tabela: string; antes: number; depois: number }
// Tabelas que encolheram de forma suspeita desde o backup anterior (apagões em massa, leitura incompleta, etc.).
export function quedasSuspeitas(antes: Record<string, number>, depois: Record<string, number>): Queda[] {
  const r: Queda[] = [];
  for (const [tabela, n] of Object.entries(antes)) {
    const agora = depois[tabela] ?? 0;
    if (n >= QUEDA_MINIMO && agora < n * (1 - QUEDA_LIMITE)) r.push({ tabela, antes: n, depois: agora });
  }
  return r.sort((a, b) => a.tabela.localeCompare(b.tabela));
}

// O backup só é válido se tiver a marca de fim (a função SQL só a escreve no fim) e pelo menos uma tabela.
export const backupCompleto = (texto: string): boolean => texto.includes('-- FIM do backup') && Object.keys(lerContagens(texto)).length > 0;

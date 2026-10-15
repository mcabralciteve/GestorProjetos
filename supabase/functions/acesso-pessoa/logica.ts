// Acesso à plataforma de pessoas que saíram — regras puras (testadas em logica_test.ts).
// A conta de login NUNCA é apagada: só se "suspende" (ban no Supabase Auth) e, se a pessoa voltar, "restaura".
export interface RecursoAcesso {
  id: string; nome: string; auth_user_id: string | null; acesso: string | null;
  ativo: boolean | null; data_saida: string | null;
}

// Inativa = marcada como inativa OU a data de saída já passou (trabalha até ao próprio dia).
// Mesma regra de js/pessoas-logica.js (PessoasLogica.estaInativo).
export function estaInativo(r: Pick<RecursoAcesso, 'ativo' | 'data_saida'>, hojeISO: string): boolean {
  return r.ativo === false || (!!r.data_saida && r.data_saida < hojeISO);
}

function adminsAtivosComConta(todos: RecursoAcesso[], hojeISO: string): RecursoAcesso[] {
  return todos.filter((r) => r.acesso === 'admin' && !!r.auth_user_id && !estaInativo(r, hojeISO));
}

export type Decisao = { ok: true; semConta?: boolean } | { ok: false; motivo: string };

// Pedido explícito de um Administrador para suspender o acesso de "alvo".
export function podeRevogar(alvo: RecursoAcesso, todos: RecursoAcesso[], hojeISO: string, quemPedeAuthId: string | null): Decisao {
  if (!estaInativo(alvo, hojeISO)) return { ok: false, motivo: `${alvo.nome} não está inativa (confirma a data de saída).` };
  if (!alvo.auth_user_id) return { ok: true, semConta: true };
  if (quemPedeAuthId && alvo.auth_user_id === quemPedeAuthId) return { ok: false, motivo: 'Não podes suspender o teu próprio acesso — pede a outro Administrador.' };
  if (alvo.acesso === 'admin' && adminsAtivosComConta(todos, hojeISO).length === 0) {
    return { ok: false, motivo: 'Ficava a plataforma sem nenhum Administrador ativo.' };
  }
  return { ok: true };
}

// Pedido explícito de um Administrador para voltar a permitir o acesso.
export function podeRestaurar(alvo: RecursoAcesso, hojeISO: string): Decisao {
  if (estaInativo(alvo, hojeISO)) return { ok: false, motivo: `${alvo.nome} continua inativa — reativa-a primeiro na app.` };
  if (!alvo.auth_user_id) return { ok: true, semConta: true };
  return { ok: true };
}

// Rotina diária: contas a suspender (inativas, com conta). Nunca restaura nada sozinha — uma conta
// suspensa por outra razão no Supabase não pode ser reativada por uma rotina. Se não houver
// nenhum Administrador ativo, não suspende Administradores (ninguém conseguiria reativar).
export function paraSuspenderNaRotina(todos: RecursoAcesso[], hojeISO: string): RecursoAcesso[] {
  const haAdminAtivo = adminsAtivosComConta(todos, hojeISO).length > 0;
  return todos.filter((r) => !!r.auth_user_id && estaInativo(r, hojeISO) && (r.acesso !== 'admin' || haAdminAtivo));
}

export function hojeLisboa(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// Acesso à plataforma de quem saiu: suspende (ou restaura) a CONTA de login no Supabase Auth. Nunca apaga a conta,
// a pessoa nem nenhum dado — "suspender" é só um ban reversível (ban_duration). Duas formas de ser chamada:
//   1) pela app, por um Administrador autenticado: { recurso_id, acao: 'revogar' | 'restaurar' };
//   2) pela rotina diária (pg_cron, com x-cron-secret): suspende todas as contas de pessoas já inativas.
// A decisão é sempre tomada AQUI, com os dados da base de dados (nunca pelo que o browser diz).
// Implantar com --no-verify-jwt (a autenticação é feita no código: segredo da rotina ou sessão de Administrador).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { autorizado, criarDb } from '../_shared/comum.ts';
import { hojeLisboa, paraSuspenderNaRotina, podeRestaurar, podeRevogar, type RecursoAcesso } from './logica.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const BAN = '876000h'; // ~100 anos: efetivamente "até ser restaurada"

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não suportado.' }, 405);

  const db = criarDb();
  const hoje = hojeLisboa();
  const { data: linhas, error: erroLeitura } = await db.from('recursos').select('id,nome,auth_user_id,acesso,ativo,data_saida');
  if (erroLeitura) {
    return resposta({ erro: `Não consegui ler as pessoas (já correste supabase/pessoas_inativas.sql?): ${erroLeitura.message}` }, 500);
  }
  const todos = (linhas ?? []) as RecursoAcesso[];

  // --- Rotina diária (segredo) ---
  if (autorizado(req)) {
    const alvos = paraSuspenderNaRotina(todos, hoje);
    const suspensas: string[] = [], falhas: string[] = [];
    for (const a of alvos) {
      const { error } = await db.auth.admin.updateUserById(a.auth_user_id!, { ban_duration: BAN });
      if (error) falhas.push(`${a.nome}: ${error.message}`); else suspensas.push(a.nome);
    }
    return resposta({ ok: falhas.length === 0, rotina: true, hoje, suspensas, falhas });
  }

  // --- Pedido da app: sessão de um Administrador ativo ---
  const auth = req.headers.get('Authorization') ?? '';
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Sessão inválida — volta a entrar na app.' }, 401);
  const eu = todos.find((r) => r.auth_user_id === u.user.id);
  if (!eu || eu.acesso !== 'admin') return resposta({ erro: 'Só um Administrador pode alterar o acesso de uma pessoa.' }, 403);

  let pedido: { recurso_id?: string; acao?: string };
  try { pedido = await req.json(); } catch { return resposta({ erro: 'Pedido ilegível.' }, 400); }
  const alvo = todos.find((r) => r.id === pedido.recurso_id);
  if (!alvo) return resposta({ erro: 'Pessoa não encontrada.' }, 404);

  if (pedido.acao === 'revogar') {
    const d = podeRevogar(alvo, todos, hoje, u.user.id);
    if (!d.ok) return resposta({ ok: false, erro: d.motivo }, 409);
    if (d.semConta) return resposta({ ok: true, acao: 'revogar', semConta: true, nome: alvo.nome });
    const { error } = await db.auth.admin.updateUserById(alvo.auth_user_id!, { ban_duration: BAN });
    if (error) return resposta({ erro: `Não consegui suspender a conta: ${error.message}` }, 502);
    return resposta({ ok: true, acao: 'revogar', nome: alvo.nome });
  }
  if (pedido.acao === 'restaurar') {
    const d = podeRestaurar(alvo, hoje);
    if (!d.ok) return resposta({ ok: false, erro: d.motivo }, 409);
    if (d.semConta) return resposta({ ok: true, acao: 'restaurar', semConta: true, nome: alvo.nome });
    const { error } = await db.auth.admin.updateUserById(alvo.auth_user_id!, { ban_duration: 'none' });
    if (error) return resposta({ erro: `Não consegui restaurar a conta: ${error.message}` }, 502);
    return resposta({ ok: true, acao: 'restaurar', nome: alvo.nome });
  }
  return resposta({ erro: 'Ação desconhecida (usa "revogar" ou "restaurar").' }, 400);
});

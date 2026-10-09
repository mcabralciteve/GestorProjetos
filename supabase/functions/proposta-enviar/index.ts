// Envio de uma proposta ao cliente: (1) email com a proposta em anexo, pela caixa do sistema (com o responsável em cópia e
// como "responder para"); (2) cópia dos ficheiros para a pasta da proposta no SharePoint, criando-a se for preciso
// (<pasta CLIENTES>/<cliente>/<proposta>, com o orçamento interno na subpasta "Interno"). Chamada pela app, autenticada com a
// sessão da pessoa — só quem tem acesso ao CRM (crm_tem_acesso) pode enviar. O email e o SharePoint são independentes: se o
// SharePoint falhar (ex.: permissão por conceder), o email já foi e a resposta diz o que correu mal para a app avisar.
// Variáveis: as do lembrete-horas (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_EMAIL) + as do Supabase (automáticas).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { criarDb, enviarComAnexos, obterTokenGraph } from '../_shared/comum.ts';
import { copiarParaSharePoint, lerLinkSharePoint, validarPedido, type Chamar, type PedidoEnvio } from './logica.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function criarChamar(token: string): Chamar {
  return async (metodo, caminho, corpo, bytes) => {
    const r = await fetch(`https://graph.microsoft.com/v1.0${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(bytes ? { 'Content-Type': 'application/octet-stream' } : corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: bytes ? (bytes as unknown as BodyInit) : (corpo ? JSON.stringify(corpo) : undefined),
    });
    let json: unknown = null;
    try { json = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, json };
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não suportado.' }, 405);

  // 1) Quem é e se pode enviar propostas
  const auth = req.headers.get('Authorization') ?? '';
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Sessão inválida — volta a entrar na app.' }, 401);
  const { data: acesso } = await userDb.rpc('crm_tem_acesso');
  if (acesso !== true) return resposta({ erro: 'Sem permissão para enviar propostas.' }, 403);

  let pedido: PedidoEnvio & { verificar?: boolean };
  try { pedido = await req.json(); } catch { return resposta({ erro: 'Pedido ilegível.' }, 400); }

  // "teste": o email vai só para quem o pediu, com [TESTE] no assunto, e nada é copiado para o SharePoint.
  if (pedido.teste) pedido = { ...pedido, para: [u.user.email ?? ''], cc: [], assunto: `[TESTE] ${pedido.assunto}`, pasta: null };
  const erros = validarPedido(pedido);
  if (erros.length) return resposta({ erro: erros.join(' ') }, 400);
  if (pedido.verificar) return resposta({ ok: true, verificado: true });     // só valida (sem enviar nem copiar)

  // 2) Email
  try {
    await enviarComAnexos({ para: pedido.para, cc: pedido.cc, responderPara: pedido.responderPara, assunto: pedido.assunto, html: pedido.corpoHtml, anexos: pedido.anexos });
  } catch (err) {
    return resposta({ erro: `Não consegui enviar o email: ${String((err as Error).message ?? err)}` }, 502);
  }

  // 3) SharePoint (não bloqueia: o email já foi)
  let sharepoint: Record<string, unknown> = { estado: 'desligado' };
  if (pedido.pasta) {
    try {
      const { data: par } = await criarDb().from('crm_orc_parametros').select('sharepoint_url').eq('id', 1).maybeSingle();
      const local = lerLinkSharePoint(par?.sharepoint_url ?? '');
      if (!local) sharepoint = { estado: 'erro', erro: 'O link da pasta CLIENTES não está configurado (Configurações → Funil CRM).' };
      else {
        const r = await copiarParaSharePoint(criarChamar(await obterTokenGraph()), local, pedido.pasta);
        sharepoint = { estado: 'ok', url: r.url, copiados: r.copiados };
      }
    } catch (err) { sharepoint = { estado: 'erro', erro: String((err as Error).message ?? err) }; }
  }
  return resposta({ ok: true, teste: !!pedido.teste, email: { enviado: true, para: pedido.para }, sharepoint });
});

// Peças comuns às funções de lembrete (lembrete-horas, lembrete-agenda): autenticação por segredo
// partilhado, leitura paginada, envio pelo Microsoft Graph (Office 365, app-only via client
// credentials — ver obterTokenGraph) e os parâmetros de teste (?dry, ?apenas, ?destino, ?forcar).
// Cada função só decide QUEM recebe e O QUÊ.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const MS_TENANT_ID = Deno.env.get('MS_TENANT_ID') ?? '';
const MS_CLIENT_ID = Deno.env.get('MS_CLIENT_ID') ?? '';
const MS_CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET') ?? '';
const MS_SENDER_EMAIL = Deno.env.get('MS_SENDER_EMAIL') ?? '';
export const APP_URL = Deno.env.get('APP_URL') ?? 'https://mcabralciteve.github.io/GestorProjetos/';

export interface Email { assunto: string; texto: string; html: string }
export interface Recurso {
  id: string; nome: string; email: string; auth_user_id: string | null; lembretes_email: boolean | null;
  piloto_lembretes: boolean | null;
  acesso?: string | null; equipa_id?: string | null;
}

export const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

export const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function autorizado(req: Request): boolean {
  return !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;
}

export function criarDb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

export function lerParametros(url: URL) {
  return {
    dry: url.searchParams.get('dry') === '1',
    forcar: url.searchParams.get('forcar') === '1',
    apenas: (url.searchParams.get('apenas') ?? '').trim().toLowerCase(),
    destino: (url.searchParams.get('destino') ?? '').trim(),
  };
}

// O Supabase limita cada pedido a 1000 linhas por omissão — pagina até acabar.
export async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

// Quem pode receber lembretes: tem conta na app (auth_user_id), tem email, e não desligou os
// lembretes em "A minha conta" (lembretes_email = false). Em "modo piloto" (Configurações →
// Definições — enquanto a app ainda não está disseminada a toda a gente), só entra quem o
// Administrador marcou explicitamente em Pessoas (piloto_lembretes = true); tal como
// lembretes_email, isto NUNCA é contornado por "apenas" — "apenas" só aponta um lote já elegível a
// um endereço, nunca dispensa as próprias regras de elegibilidade.
export function elegiveis(recursos: Recurso[], apenas: string, pilotoAtivo: boolean): Recurso[] {
  return recursos.filter(r =>
    r.auth_user_id && (r.email ?? '').trim() && r.lembretes_email !== false &&
    (!pilotoAtivo || r.piloto_lembretes === true) &&
    (!apenas || r.email.trim().toLowerCase() === apenas));
}

// Token de acesso ao Microsoft Graph, obtido por "client credentials" (a própria app a autenticar-
// se como ela mesma junto do Azure AD — nenhum login de pessoa nenhuma está envolvido, é o fluxo
// "app-only" que o Azure exige em vez de OAuth interativo para um serviço automático como este).
// Guardado em memória e reaproveitado enquanto não estiver perto de expirar: sem isto, uma única
// execução que despache dezenas de emails pediria um token novo por cada um.
let tokenCache: { valor: string; expiraEm: number } | null = null;

async function obterTokenGraph(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiraEm) return tokenCache.valor;
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!r.ok) throw new Error(`Token Microsoft Graph ${r.status}: ${await r.text()}`);
  const j = await r.json();
  // 60s de margem antes do fim real do token — nunca o usa já à beira de expirar a meio de um envio.
  tokenCache = { valor: j.access_token, expiraEm: Date.now() + (j.expires_in - 60) * 1000 };
  return tokenCache.valor;
}

export async function enviar(para: string, email: Email) {
  const token = await obterTokenGraph();
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS_SENDER_EMAIL)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: email.assunto,
        body: { contentType: 'HTML', content: email.html },
        toRecipients: [{ emailAddress: { address: para } }],
      },
      saveToSentItems: false,
    }),
  });
  // sendMail devolve 202 sem corpo quando corre bem; qualquer outro código é erro (ex.: 403 se a
  // Application Access Policy do Exchange não deixar esta app enviar por MS_SENDER_EMAIL).
  if (!r.ok) throw new Error(`Microsoft Graph sendMail ${r.status}: ${await r.text()}`);
}

export interface Resultado { nome: string; email: string; itens: number; estado: string }

// Envia (ou simula, em ?dry=1) um email a uma pessoa e devolve a linha de resultado.
export async function despachar(
  r: Recurso, itens: number, email: Email, p: { dry: boolean; destino: string },
): Promise<Resultado> {
  if (p.dry) return { nome: r.nome, email: r.email, itens, estado: 'não enviado (dry)' };
  try {
    if (p.destino) email = { ...email, assunto: `[TESTE para ${r.nome}] ${email.assunto}` };
    await enviar(p.destino || r.email.trim(), email);
    return { nome: r.nome, email: r.email, itens, estado: 'enviado' };
  } catch (err) {
    return { nome: r.nome, email: r.email, itens, estado: 'erro: ' + String((err as Error).message) };
  }
}

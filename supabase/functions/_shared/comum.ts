// Peças comuns às funções de lembrete (lembrete-horas, lembrete-agenda): autenticação por segredo
// partilhado, leitura paginada, envio pelo Resend e os parâmetros de teste (?dry, ?apenas,
// ?destino, ?forcar). Cada função só decide QUEM recebe e O QUÊ.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? '';
export const APP_URL = Deno.env.get('APP_URL') ?? 'https://mcabralciteve.github.io/GestorProjetos/';

export interface Email { assunto: string; texto: string; html: string }
export interface Recurso { id: string; nome: string; email: string; auth_user_id: string | null; lembretes_email: boolean | null }

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
// lembretes em "A minha conta" (lembretes_email = false). "apenas" restringe a um endereço (testes).
export function elegiveis(recursos: Recurso[], apenas: string): Recurso[] {
  return recursos.filter(r =>
    r.auth_user_id && (r.email ?? '').trim() && r.lembretes_email !== false &&
    (!apenas || r.email.trim().toLowerCase() === apenas));
}

export async function enviar(para: string, email: Email) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [para], subject: email.assunto, text: email.texto, html: email.html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
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

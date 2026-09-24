// Lembrete diário de horas em falta — corre no Supabase (Edge Function), chamada todos os dias
// úteis por um agendamento pg_cron (ver LEIAME.md). Nunca é chamada pelo browser: usa a chave
// service_role (lê tudo, ignora a RLS), por isso só aceita pedidos com o segredo partilhado.
//
// Parâmetros (querystring), úteis para testar sem incomodar ninguém:
//   ?dry=1              não envia nada, devolve só a lista de quem receberia e o quê
//   ?apenas=a@b.pt      só considera esse endereço (envia a essa pessoa, se tiver dias em falta)
//   ?forcar=1           corre mesmo num fim de semana/feriado e mesmo com o interruptor desligado
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  DIAS_JANELA, diasEmFalta, ehDiaUtil, formatarDia, formatarHoras, hojeEmLisboa, indexarHoras,
  type Ausencia, type Registo,
} from './logica.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://mcabralciteve.github.io/GestorProjetos/';

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// O Supabase limita cada pedido a 1000 linhas por omissão — pagina até acabar.
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

function montarEmail(nome: string, dias: { iso: string; faltam: number }[]) {
  const primeiro = nome.split(' ')[0];
  const total = dias.reduce((s, d) => s + d.faltam, 0);
  const assunto = `Tens ${dias.length} dia(s) por preencher no registo de horas`;
  const linhasTxt = dias.map(d => `  • ${formatarDia(d.iso)} — faltam ${formatarHoras(d.faltam)}`).join('\n');
  const linhasHtml = dias.map(d => `<li>${escapar(formatarDia(d.iso))} — faltam <b>${formatarHoras(d.faltam)}</b></li>`).join('');
  const texto = `Olá ${primeiro},\n\nNos últimos ${DIAS_JANELA} dias úteis há ${dias.length} dia(s) com menos de 8h registadas (${formatarHoras(total)} em falta):\n\n${linhasTxt}\n\nRegista as horas em ${APP_URL}\n\n(Mensagem automática do Gestor de Projetos. Feriados, fins de semana e ausências já não contam.)`;
  const html = `<p>Olá ${escapar(primeiro)},</p><p>Nos últimos ${DIAS_JANELA} dias úteis há <b>${dias.length} dia(s)</b> com menos de 8h registadas (${formatarHoras(total)} em falta):</p><ul>${linhasHtml}</ul><p><a href="${APP_URL}">Registar as horas</a></p><p style="color:#888;font-size:12px">Mensagem automática do Gestor de Projetos. Feriados, fins de semana e ausências já não contam.</p>`;
  return { assunto, texto, html };
}

async function enviar(para: string, email: { assunto: string; texto: string; html: string }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [para], subject: email.assunto, text: email.texto, html: email.html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return resposta({ erro: 'não autorizado' }, 401);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const forcar = url.searchParams.get('forcar') === '1';
  const apenas = (url.searchParams.get('apenas') ?? '').trim().toLowerCase();

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const hoje = hojeEmLisboa();

  const { data: cfg, error: erroCfg } = await db.from('configuracoes').select('lembrete_horas_ativo').eq('id', 1).maybeSingle();
  if (erroCfg) return resposta({ erro: String(erroCfg.message ?? erroCfg) }, 500);
  if (!cfg?.lembrete_horas_ativo && !forcar) return resposta({ hoje, enviados: 0, motivo: 'interruptor desligado nas Definições' });

  const [{ data: feriadosRaw }, ausencias, recursos] = await Promise.all([
    db.from('feriados').select('data'),
    lerTudo<Ausencia>((de, ate) => db.from('ausencias').select('recurso_id,data_inicio,data_fim,estado').range(de, ate)),
    lerTudo<{ id: string; nome: string; email: string; auth_user_id: string | null }>((de, ate) => db.from('recursos').select('id,nome,email,auth_user_id').range(de, ate)),
  ]);
  const feriados = new Set((feriadosRaw ?? []).map((f: { data: string }) => f.data));
  if (!ehDiaUtil(hoje, feriados) && !forcar) return resposta({ hoje, enviados: 0, motivo: 'hoje não é dia útil' });

  // Janela: 10 dias úteis cabem sempre em ~60 dias corridos, mesmo com muitas ausências/feriados.
  const desde = new Date(Date.parse(hoje) - 60 * 86400000).toISOString().slice(0, 10);
  const registos = await lerTudo<Registo>((de, ate) => db.from('registos').select('pessoa,data,horas').gte('data', desde).range(de, ate));
  const horas = indexarHoras(registos);

  // Só pessoas com conta na app (auth_user_id) e email — quem não tem login não regista horas por si.
  const candidatos = recursos.filter(r => r.auth_user_id && (r.email ?? '').trim() && (!apenas || r.email.trim().toLowerCase() === apenas));

  const resultado: { nome: string; email: string; diasEmFalta: number; estado: string }[] = [];
  for (const r of candidatos) {
    const dias = diasEmFalta(r.id, r.nome, hoje, DIAS_JANELA, feriados, ausencias, horas);
    if (!dias.length) continue;
    if (dry) { resultado.push({ nome: r.nome, email: r.email, diasEmFalta: dias.length, estado: 'não enviado (dry)' }); continue; }
    try {
      await enviar(r.email.trim(), montarEmail(r.nome, dias));
      resultado.push({ nome: r.nome, email: r.email, diasEmFalta: dias.length, estado: 'enviado' });
    } catch (err) {
      resultado.push({ nome: r.nome, email: r.email, diasEmFalta: dias.length, estado: 'erro: ' + String((err as Error).message) });
    }
  }
  return resposta({ hoje, dry, candidatos: candidatos.length, enviados: resultado.filter(x => x.estado === 'enviado').length, resultado });
});

// Lembrete diário de horas em falta — corre no Supabase (Edge Function), chamada todos os dias
// úteis por um agendamento pg_cron (ver LEIAME.md). Nunca é chamada pelo browser: usa a chave
// service_role (lê tudo, ignora a RLS), por isso só aceita pedidos com o segredo partilhado.
//
// Parâmetros (querystring), úteis para testar sem incomodar ninguém:
//   ?dry=1              não envia nada, devolve só a lista de quem receberia e o quê
//   ?apenas=a@b.pt      só considera esse endereço (envia a essa pessoa, se tiver dias em falta)
//   ?destino=eu@b.pt    envia TODOS os emails calculados para este endereço (com [TESTE] no assunto),
//                       em vez de para cada pessoa — combina com ?apenas= para veres o email de um colega
//   ?forcar=1           corre mesmo num fim de semana/feriado e mesmo com o interruptor desligado
import {
  APP_URL, autorizado, criarDb, despachar, elegiveis, escapar, lerParametros, lerTudo, resposta,
  type Email, type Recurso, type Resultado,
} from '../_shared/comum.ts';
import {
  DIAS_JANELA, diasEmFalta, ehDiaUtil, formatarDia, formatarHoras, hojeEmLisboa, indexarHoras,
  type Ausencia, type Registo,
} from './logica.ts';

function montarEmail(nome: string, dias: { iso: string; faltam: number }[]): Email {
  const primeiro = nome.split(' ')[0];
  const total = dias.reduce((s, d) => s + d.faltam, 0);
  const assunto = `Tens ${dias.length} dia(s) por preencher no registo de horas`;
  const linhasTxt = dias.map(d => `  • ${formatarDia(d.iso)} — faltam ${formatarHoras(d.faltam)}`).join('\n');
  const linhasHtml = dias.map(d => `<li>${escapar(formatarDia(d.iso))} — faltam <b>${formatarHoras(d.faltam)}</b></li>`).join('');
  const texto = `Olá ${primeiro},\n\nNos últimos ${DIAS_JANELA} dias úteis há ${dias.length} dia(s) com menos de 8h registadas (${formatarHoras(total)} em falta):\n\n${linhasTxt}\n\nRegista as horas em ${APP_URL}\n\n(Mensagem automática do Gestor de Projetos — podes desligá-la em "A minha conta". Feriados, fins de semana e ausências já não contam.)`;
  const html = `<p>Olá ${escapar(primeiro)},</p><p>Nos últimos ${DIAS_JANELA} dias úteis há <b>${dias.length} dia(s)</b> com menos de 8h registadas (${formatarHoras(total)} em falta):</p><ul>${linhasHtml}</ul><p><a href="${APP_URL}">Registar as horas</a></p><p style="color:#888;font-size:12px">Mensagem automática do Gestor de Projetos — podes desligá-la em "A minha conta". Feriados, fins de semana e ausências já não contam.</p>`;
  return { assunto, texto, html };
}

Deno.serve(async (req) => {
  if (!autorizado(req)) return resposta({ erro: 'não autorizado' }, 401);
  const p = lerParametros(new URL(req.url));
  const db = criarDb();
  const hoje = hojeEmLisboa();

  const { data: cfg, error: erroCfg } = await db.from('configuracoes').select('lembrete_horas_ativo').eq('id', 1).maybeSingle();
  if (erroCfg) return resposta({ erro: String(erroCfg.message ?? erroCfg) }, 500);
  if (!cfg?.lembrete_horas_ativo && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'interruptor desligado nas Definições' });

  const [{ data: feriadosRaw }, ausencias, recursos] = await Promise.all([
    db.from('feriados').select('data'),
    lerTudo<Ausencia>((de, ate) => db.from('ausencias').select('recurso_id,data_inicio,data_fim,estado').range(de, ate)),
    lerTudo<Recurso>((de, ate) => db.from('recursos').select('id,nome,email,auth_user_id,lembretes_email').range(de, ate)),
  ]);
  const feriados = new Set((feriadosRaw ?? []).map((f: { data: string }) => f.data));
  if (!ehDiaUtil(hoje, feriados) && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'hoje não é dia útil' });

  // Janela: 10 dias úteis cabem sempre em ~60 dias corridos, mesmo com muitas ausências/feriados.
  const desde = new Date(Date.parse(hoje) - 60 * 86400000).toISOString().slice(0, 10);
  const registos = await lerTudo<Registo>((de, ate) => db.from('registos').select('pessoa,data,horas').gte('data', desde).range(de, ate));
  const horas = indexarHoras(registos);

  const candidatos = elegiveis(recursos, p.apenas);
  const resultado: Resultado[] = [];
  for (const r of candidatos) {
    const dias = diasEmFalta(r.id, r.nome, hoje, DIAS_JANELA, feriados, ausencias, horas);
    if (dias.length) resultado.push(await despachar(r, dias.length, montarEmail(r.nome, dias), p));
  }
  return resposta({ hoje, dry: p.dry, candidatos: candidatos.length, enviados: resultado.filter(x => x.estado === 'enviado').length, resultado });
});

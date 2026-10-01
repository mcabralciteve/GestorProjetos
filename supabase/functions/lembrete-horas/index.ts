// Lembrete diário de horas em falta — corre no Supabase (Edge Function), chamada todos os dias
// úteis por um agendamento pg_cron (ver LEIAME.md). Nunca é chamada pelo browser: usa a chave
// service_role (lê tudo, ignora a RLS), por isso só aceita pedidos com o segredo partilhado.
//
// Parâmetros (querystring), úteis para testar sem incomodar ninguém:
//   ?dry=1              não envia nada, devolve só a lista de quem receberia e o quê
//   ?apenas=a@b.pt      só considera esse endereço (envia a essa pessoa, se tiver dias em falta)
//   ?destino=eu@b.pt    envia TODOS os emails calculados para este endereço (com [TESTE] no assunto),
//                       em vez de para cada pessoa — combina com ?apenas= para veres o email de um colega
//   ?forcar=1           corre mesmo num fim de semana/feriado, com o interruptor desligado, antes da
//                       hora configurada, ou já tendo corrido hoje — e nunca marca "já enviado hoje"
//                       (um teste manual nunca pode silenciar o envio automático real desse dia)
//
// Agendamento: o pg_cron chama esta função de 10 em 10 minutos (ver agendar_lembrete_horas.sql),
// não só uma vez — é esta função que decide, a cada chamada, se já é a hora configurada em
// Definições (lembrete_horas_hora) e se ainda não correu hoje (lembrete_horas_ultimo_envio); isto é
// o que torna a hora configurável pelo Administrador sem nunca mais mexer no SQL do agendamento.
import {
  APP_URL, autorizado, criarDb, despachar, elegiveis, escapar, lerParametros, lerTudo, resposta,
  type Email, type Recurso, type Resultado,
} from '../_shared/comum.ts';
import {
  DIAS_JANELA, diasEmFalta, ehDiaUtil, formatarDia, formatarHoras, hojeEmLisboa, horaAtualEmLisboa, indexarHoras,
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

  const { data: cfg, error: erroCfg } = await db.from('configuracoes')
    .select('lembrete_horas_ativo,lembretes_piloto_ativo,lembrete_horas_hora,lembrete_horas_ultimo_envio').eq('id', 1).maybeSingle();
  if (erroCfg) return resposta({ erro: String(erroCfg.message ?? erroCfg) }, 500);
  if (!cfg?.lembrete_horas_ativo && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'interruptor desligado nas Definições' });

  const horaConfigurada = cfg?.lembrete_horas_hora || '08:00';
  const jaEnviadoHoje = cfg?.lembrete_horas_ultimo_envio === hoje;
  if (!p.forcar) {
    if (jaEnviadoHoje) return resposta({ hoje, enviados: 0, motivo: 'já enviado hoje' });
    if (horaAtualEmLisboa() < horaConfigurada) {
      return resposta({ hoje, enviados: 0, motivo: `ainda não é a hora configurada (${horaConfigurada})` });
    }
  }
  // Às 12:00 ou mais tarde, o dia de trabalho já vai avançado — passa a contar também o próprio dia
  // nos "dias em falta" (ver a nota grande em diasEmFalta); antes disso, mantém-se o critério de
  // sempre ignorar "hoje" (ainda a decorrer, como no Dashboard).
  const incluirHoje = horaConfigurada >= '12:00';

  const [{ data: feriadosRaw }, ausencias, recursos] = await Promise.all([
    db.from('feriados').select('data'),
    lerTudo<Ausencia>((de, ate) => db.from('ausencias').select('recurso_id,data_inicio,data_fim,estado').range(de, ate)),
    lerTudo<Recurso>((de, ate) => db.from('recursos').select('id,nome,email,auth_user_id,lembretes_email,piloto_lembretes').range(de, ate)),
  ]);
  const feriados = new Set((feriadosRaw ?? []).map((f: { data: string }) => f.data));
  if (!ehDiaUtil(hoje, feriados) && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'hoje não é dia útil' });

  // Janela: 10 dias úteis cabem sempre em ~60 dias corridos, mesmo com muitas ausências/feriados.
  const desde = new Date(Date.parse(hoje) - 60 * 86400000).toISOString().slice(0, 10);
  const registos = await lerTudo<Registo>((de, ate) => db.from('registos').select('pessoa,data,horas').gte('data', desde).range(de, ate));
  const horas = indexarHoras(registos);

  const candidatos = elegiveis(recursos, p.apenas, cfg?.lembretes_piloto_ativo === true);
  const resultado: Resultado[] = [];
  for (const r of candidatos) {
    const dias = diasEmFalta(r.id, r.nome, hoje, DIAS_JANELA, feriados, ausencias, horas, incluirHoje);
    if (dias.length) resultado.push(await despachar(r, dias.length, montarEmail(r.nome, dias), p));
  }
  // Só uma chamada "a sério" (nem de teste/forçada, nem dry) marca o dia como feito — um teste
  // manual a meio do dia nunca pode impedir o envio automático real de correr mais tarde.
  if (!p.dry && !p.forcar) await db.from('configuracoes').update({ lembrete_horas_ultimo_envio: hoje }).eq('id', 1);
  return resposta({ hoje, dry: p.dry, horaConfigurada, incluirHoje, candidatos: candidatos.length, enviados: resultado.filter(x => x.estado === 'enviado').length, resultado });
});

// Lembrete semanal: horas registadas no Gestor que ainda não foram carregadas no orcprev, por pessoa, com o link direto
// para a cópia de cada semana. Mesma proteção, agendamento e parâmetros de teste do lembrete-horas (ver o cabeçalho desse
// index.ts): ?dry=1, ?apenas=, ?destino=, ?forcar=1. Só corre no dia da semana configurado (?forcar=1 corre em qualquer dia, sem marcar o dia).
// Configuração em Horas → Orcprev (Administrador): interruptor, dia da semana, hora, e a data a partir da qual se conta (lembrete_orcprev_*,
// orcprev_controlo_desde). Quem não tem nada por carregar não recebe nada.
import {
  APP_URL, autorizado, criarDb, despachar, elegiveis, lerParametros, lerTudo, resposta,
  type Recurso, type Resultado,
} from '../_shared/comum.ts';
import { hojeEmLisboa, horaAtualEmLisboa } from '../lembrete-horas/logica.ts';
import { montarEmail, totalDias } from './email.ts';
import { diaConfigurado, diaDaSemana, NOMES_DIA_SEMANA, semanasPorCarregar, somarDias, SEMANAS_MAX, type Envio, type RegistoOrc } from './logica.ts';

Deno.serve(async (req) => {
  if (!autorizado(req)) return resposta({ erro: 'não autorizado' }, 401);
  const p = lerParametros(new URL(req.url));
  const db = criarDb();
  const hoje = hojeEmLisboa();

  const { data: cfg, error: erroCfg } = await db.from('configuracoes')
    .select('lembrete_orcprev_ativo,lembretes_piloto_ativo,lembrete_orcprev_dia,lembrete_orcprev_hora,lembrete_orcprev_ultimo_envio,orcprev_controlo_desde').eq('id', 1).maybeSingle();
  if (erroCfg) return resposta({ erro: String(erroCfg.message ?? erroCfg), dica: 'corre supabase/orcprev_registo.sql' }, 500);
  if (!cfg?.lembrete_orcprev_ativo && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'interruptor desligado' });
  const diaCfg = diaConfigurado(cfg?.lembrete_orcprev_dia);
  if (diaDaSemana(hoje) !== diaCfg && !p.forcar) return resposta({ hoje, enviados: 0, motivo: `só se envia à ${NOMES_DIA_SEMANA[diaCfg]}` });

  const horaConfigurada = cfg?.lembrete_orcprev_hora || '09:00';
  if (!p.forcar) {
    if (cfg?.lembrete_orcprev_ultimo_envio === hoje) return resposta({ hoje, enviados: 0, motivo: 'já enviado hoje' });
    if (horaAtualEmLisboa() < horaConfigurada) return resposta({ hoje, enviados: 0, motivo: `ainda não é a hora configurada (${horaConfigurada})` });
  }

  const desde: string | null = cfg?.orcprev_controlo_desde ?? null;
  // Janela de leitura: as últimas SEMANAS_MAX semanas (ou desde a data configurada, se for mais recente).
  const janela = somarDias(hoje, -7 * (SEMANAS_MAX + 1));
  const lerDesde = desde && desde > janela ? desde : janela;

  let tiposSemAtividade: Set<string>, envios: Envio[], registos: RegistoOrc[], recursos: Recurso[];
  try {
    const [tipos, ee, rr, rc] = await Promise.all([
      lerTudo<{ id: string; orcprev_atividade: string | null }>((de, ate) => db.from('tipos_trabalho').select('id,orcprev_atividade').range(de, ate)),
      lerTudo<Envio>((de, ate) => db.from('orcprev_envios').select('recurso_id,semana_inicio,criado_em,confirmado_em,dias,origem').gte('semana_inicio', somarDias(lerDesde, -6)).range(de, ate)),
      lerTudo<RegistoOrc>((de, ate) => db.from('registos').select('pessoa,data,horas,tipo_trabalho_id').gte('data', lerDesde).range(de, ate)),
      lerTudo<Recurso>((de, ate) => db.from('recursos').select('id,nome,email,auth_user_id,lembretes_email,piloto_lembretes,ativo,data_saida').range(de, ate)),
    ]);
    tiposSemAtividade = new Set(tipos.filter(t => !t.orcprev_atividade).map(t => t.id));
    envios = ee; registos = rr; recursos = rc;
  } catch (err) {
    return resposta({ erro: String((err as { message?: string }).message ?? err), dica: 'falta correr supabase/orcprev_registo.sql (e orcprev_integracao.sql)?' }, 500);
  }

  const candidatos = elegiveis(recursos, p.apenas, cfg?.lembretes_piloto_ativo === true);
  const resultado: Resultado[] = [];
  for (const r of candidatos) {
    const semanas = semanasPorCarregar(hoje, desde, registos.filter(x => x.pessoa === r.nome), envios.filter(e => e.recurso_id === r.id), tiposSemAtividade);
    if (!semanas.length) continue;
    resultado.push(await despachar(r, totalDias(semanas), montarEmail(r.nome, semanas, APP_URL), p));
  }
  // Só uma chamada "a sério" marca o dia como feito — ver a mesma nota em lembrete-horas/index.ts.
  if (!p.dry && !p.forcar) await db.from('configuracoes').update({ lembrete_orcprev_ultimo_envio: hoje }).eq('id', 1);
  return resposta({ hoje, dry: p.dry, dia: NOMES_DIA_SEMANA[diaCfg], horaConfigurada, desde, candidatos: candidatos.length, enviados: resultado.filter(x => x.estado === 'enviado').length, resultado });
});

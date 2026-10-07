// Resumo diário por email — todos os dias úteis, cada pessoa com conta recebe: tarefas de hoje (as
// mesmas do cartão "A minha agenda de hoje" do Início, com horas previstas/registadas), tarefas em
// atraso, next steps abertos de que é responsável e o que começa nos próximos dias. Cada secção só
// aparece se tiver conteúdo. Mesma proteção e parâmetros de teste do lembrete-horas (ver o cabeçalho
// desse index.ts): ?dry=1, ?apenas=, ?destino=, ?forcar=1. Nada é enviado a quem não tem nada para
// ver, nem a quem está ausente/de férias. Hora configurável pelo Administrador (lembrete_agenda_hora) e um só envio por
// dia (lembrete_agenda_ultimo_envio) — mesmo mecanismo de polling pelo pg_cron do lembrete-horas.
import {
  APP_URL, autorizado, criarDb, despachar, elegiveis, lerParametros, lerTudo, resposta,
  type Recurso, type Resultado,
} from '../_shared/comum.ts';
import { ehDiaUtil, formatarDia, hojeEmLisboa, horaAtualEmLisboa } from '../lembrete-horas/logica.ts';
import { montarEmail } from './email.ts';
import {
  indexarAgenda, indexarRegistadas, resumoDoDia, resumoVazio,
  type Ausencia, type Passo, type Projeto, type RegistoHoras, type Tarefa, type TarefaRecurso,
} from './logica.ts';

Deno.serve(async (req) => {
  if (!autorizado(req)) return resposta({ erro: 'não autorizado' }, 401);
  const p = lerParametros(new URL(req.url));
  const db = criarDb();
  const hoje = hojeEmLisboa();

  const { data: cfg, error: erroCfg } = await db.from('configuracoes')
    .select('lembrete_agenda_ativo,lembretes_piloto_ativo,lembrete_agenda_hora,lembrete_agenda_ultimo_envio').eq('id', 1).maybeSingle();
  if (erroCfg) return resposta({ erro: String(erroCfg.message ?? erroCfg) }, 500);
  if (!cfg?.lembrete_agenda_ativo && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'interruptor desligado nas Definições' });

  const horaConfigurada = cfg?.lembrete_agenda_hora || '07:30';
  const jaEnviadoHoje = cfg?.lembrete_agenda_ultimo_envio === hoje;
  if (!p.forcar) {
    if (jaEnviadoHoje) return resposta({ hoje, enviados: 0, motivo: 'já enviado hoje' });
    if (horaAtualEmLisboa() < horaConfigurada) {
      return resposta({ hoje, enviados: 0, motivo: `ainda não é a hora configurada (${horaConfigurada})` });
    }
  }

  const { data: feriadosRaw } = await db.from('feriados').select('data');
  const feriados = new Set((feriadosRaw ?? []).map((f: { data: string }) => f.data));
  if (!ehDiaUtil(hoje, feriados) && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'hoje não é dia útil' });

  const [ausencias, recursos, projetos, tarefas, atribuicoes, passos, registos] = await Promise.all([
    lerTudo<Ausencia>((de, ate) => db.from('ausencias').select('recurso_id,data_inicio,data_fim,estado').range(de, ate)),
    lerTudo<Recurso>((de, ate) => db.from('recursos').select('id,nome,email,auth_user_id,lembretes_email,piloto_lembretes').range(de, ate)),
    lerTudo<Projeto>((de, ate) => db.from('projetos').select('id,id_interno,nome,cliente,ativo').range(de, ate)),
    lerTudo<Tarefa>((de, ate) => db.from('tarefas').select('id,projeto_id,parent_id,nome,inicio,fim,progresso').range(de, ate)),
    lerTudo<TarefaRecurso>((de, ate) => db.from('tarefa_recursos').select('tarefa_id,recurso_id,horas').range(de, ate)),
    lerTudo<Passo>((de, ate) => db.from('proximos_passos').select('id,projeto_id,tarefa_id,descricao,estado,fechado,data_prevista,responsavel_id').range(de, ate)),
    lerTudo<RegistoHoras>((de, ate) => db.from('registos').select('tarefa_id,pessoa,horas').not('tarefa_id', 'is', null).range(de, ate)),
  ]);
  const contexto = { indice: indexarAgenda(projetos, tarefas, atribuicoes), ausencias, passos, projetos, tarefas, registadas: indexarRegistadas(registos) };

  const candidatos = elegiveis(recursos, p.apenas, cfg?.lembretes_piloto_ativo === true);
  const resultado: Resultado[] = [];
  for (const r of candidatos) {
    const resumo = resumoDoDia(r, hoje, contexto);
    if (resumoVazio(resumo)) continue;
    const itens = resumo.hoje.length + resumo.atrasadas.length + resumo.passos.length + resumo.proximas.length;
    resultado.push(await despachar(r, itens, montarEmail(r.nome, formatarDia(hoje), resumo, APP_URL), p));
  }
  // Só uma chamada "a sério" marca o dia como feito — ver a mesma nota em lembrete-horas/index.ts.
  if (!p.dry && !p.forcar) await db.from('configuracoes').update({ lembrete_agenda_ultimo_envio: hoje }).eq('id', 1);
  return resposta({ hoje, dry: p.dry, horaConfigurada, candidatos: candidatos.length, enviados: resultado.filter(x => x.estado === 'enviado').length, resultado });
});

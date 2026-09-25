// Agenda do dia por email — todos os dias úteis de manhã, cada pessoa com conta que tenha tarefas
// previstas para hoje recebe a lista (as mesmas do cartão "A minha agenda de hoje" do Início).
// Mesma proteção, agendamento e parâmetros de teste do lembrete-horas (ver LEIAME.md dessa pasta):
// ?dry=1, ?apenas=, ?destino=, ?forcar=1. Nada é enviado a quem não tem tarefas hoje, nem a quem
// está ausente/de férias.
import {
  APP_URL, autorizado, criarDb, despachar, elegiveis, escapar, lerParametros, lerTudo, resposta,
  type Email, type Recurso, type Resultado,
} from '../_shared/comum.ts';
import { ehDiaUtil, formatarDia, hojeEmLisboa } from '../lembrete-horas/logica.ts';
import {
  agendaDoDia, indexarAgenda, type Ausencia, type ItemAgenda, type Projeto, type Tarefa, type TarefaRecurso,
} from './logica.ts';

function montarEmail(nome: string, hoje: string, itens: ItemAgenda[]): Email {
  const primeiro = nome.split(' ')[0];
  const dia = formatarDia(hoje);
  const assunto = `A tua agenda de hoje — ${itens.length} tarefa(s)`;
  const periodo = (i: ItemAgenda) => `${i.inicio.slice(8)}/${i.inicio.slice(5, 7)} a ${i.fim.slice(8)}/${i.fim.slice(5, 7)}`;
  const linhasTxt = itens.map(i => `  • ${i.tarefa}\n      ${i.projeto} · ${periodo(i)} · ${i.progresso}% concluída`).join('\n');
  const linhasHtml = itens.map(i =>
    `<li><b>${escapar(i.tarefa)}</b><br><span style="color:#666">${escapar(i.projeto)} · ${periodo(i)} · ${i.progresso}% concluída</span></li>`).join('');
  const rodape = 'Mensagem automática do Gestor de Projetos — podes desligá-la em "A minha conta".';
  const texto = `Olá ${primeiro},\n\nTarefas previstas para hoje, ${dia}:\n\n${linhasTxt}\n\nAbre a app: ${APP_URL}\n\n(${rodape})`;
  const html = `<p>Olá ${escapar(primeiro)},</p><p>Tarefas previstas para hoje, <b>${escapar(dia)}</b>:</p><ul>${linhasHtml}</ul><p><a href="${APP_URL}">Abrir a app</a></p><p style="color:#888;font-size:12px">${rodape}</p>`;
  return { assunto, texto, html };
}

Deno.serve(async (req) => {
  if (!autorizado(req)) return resposta({ erro: 'não autorizado' }, 401);
  const p = lerParametros(new URL(req.url));
  const db = criarDb();
  const hoje = hojeEmLisboa();

  const { data: cfg, error: erroCfg } = await db.from('configuracoes').select('lembrete_agenda_ativo').eq('id', 1).maybeSingle();
  if (erroCfg) return resposta({ erro: String(erroCfg.message ?? erroCfg) }, 500);
  if (!cfg?.lembrete_agenda_ativo && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'interruptor desligado nas Definições' });

  const { data: feriadosRaw } = await db.from('feriados').select('data');
  const feriados = new Set((feriadosRaw ?? []).map((f: { data: string }) => f.data));
  if (!ehDiaUtil(hoje, feriados) && !p.forcar) return resposta({ hoje, enviados: 0, motivo: 'hoje não é dia útil' });

  const [ausencias, recursos, projetos, tarefas, atribuicoes] = await Promise.all([
    lerTudo<Ausencia>((de, ate) => db.from('ausencias').select('recurso_id,data_inicio,data_fim,estado').range(de, ate)),
    lerTudo<Recurso>((de, ate) => db.from('recursos').select('id,nome,email,auth_user_id,lembretes_email').range(de, ate)),
    lerTudo<Projeto>((de, ate) => db.from('projetos').select('id,id_interno,nome,cliente,ativo').range(de, ate)),
    lerTudo<Tarefa>((de, ate) => db.from('tarefas').select('id,projeto_id,parent_id,nome,inicio,fim,progresso').range(de, ate)),
    lerTudo<TarefaRecurso>((de, ate) => db.from('tarefa_recursos').select('tarefa_id,recurso_id').range(de, ate)),
  ]);
  const indice = indexarAgenda(projetos, tarefas, atribuicoes);

  const candidatos = elegiveis(recursos, p.apenas);
  const resultado: Resultado[] = [];
  for (const r of candidatos) {
    const itens = agendaDoDia(r.id, hoje, indice, ausencias);
    if (itens.length) resultado.push(await despachar(r, itens.length, montarEmail(r.nome, hoje, itens), p));
  }
  return resposta({ hoje, dry: p.dry, candidatos: candidatos.length, enviados: resultado.filter(x => x.estado === 'enviado').length, resultado });
});

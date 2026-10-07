import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { indexarAgenda, indexarRegistadas, resumoDoDia, resumoVazio, somarDias, type ContextoResumo } from './logica.ts';
import { assuntoDoResumo, montarEmail } from './email.ts';

const HOJE = '2026-10-07';
const projetos = [
  { id: 'p1', id_interno: '2026/006', nome: 'SIG@IA', cliente: 'CITEVE', ativo: true },
  { id: 'p2', id_interno: '2026/999', nome: 'Suspenso', cliente: '', ativo: false },
];
const T = (id: string, projeto_id: string, nome: string, inicio: string, fim: string, progresso: number, parent_id: string | null = null) =>
  ({ id, projeto_id, parent_id, nome, inicio, fim, progresso });
const tarefas = [
  T('hoje', 'p1', 'Preparar sessão', '2026-10-06', '2026-10-08', 40),
  T('atrasada', 'p1', 'Relatório', '2026-09-20', '2026-10-02', 60),
  T('velhaConcluida', 'p1', 'Já feita', '2026-09-01', '2026-09-10', 100),
  T('proxima', 'p1', 'Sessão 6', '2026-10-12', '2026-10-13', 0),
  T('longe', 'p1', 'Daqui a um mês', '2026-11-20', '2026-11-21', 0),
  T('pai', 'p1', 'Fase (tem filhos)', '2026-10-01', '2026-10-31', 0),
  T('filho', 'p1', 'Filho', '2026-10-07', '2026-10-07', 0, 'pai'),
  T('suspensa', 'p2', 'De projeto suspenso', '2026-10-01', '2026-10-30', 0),
];
const atrib = tarefas.map(t => ({ tarefa_id: t.id, recurso_id: 'r1', horas: t.id === 'hoje' ? 6 : null }));
const passo = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projeto_id: 'p1', tarefa_id: 'hoje', descricao: 'Passo ' + id, estado: 'aberto', fechado: false,
  data_prevista: null as string | null, responsavel_id: 'r1', ...extra,
});
const base = (extra: Partial<ContextoResumo> = {}): ContextoResumo => ({
  indice: indexarAgenda(projetos, tarefas, atrib), ausencias: [], passos: [], projetos, tarefas,
  registadas: indexarRegistadas([{ tarefa_id: 'hoje', pessoa: 'Milton Cabral', horas: '2.5' }, { tarefa_id: 'hoje', pessoa: 'Outra', horas: 9 }, { tarefa_id: null, pessoa: 'Milton Cabral', horas: 4 }]),
  ...extra,
});
const eu = { id: 'r1', nome: 'Milton Cabral' };

Deno.test('somarDias atravessa meses', () => {
  assertEquals(somarDias('2026-10-28', 7), '2026-11-04');
});

Deno.test('hoje: horas previstas e registadas só da própria pessoa e da própria tarefa', () => {
  const r = resumoDoDia(eu, HOJE, base());
  assertEquals(r.hoje.map(i => i.tarefa), ['Filho', 'Preparar sessão']);
  const prep = r.hoje.find(i => i.id === 'hoje')!;
  assertEquals([prep.horasPrevistas, prep.registadas], [6, 2.5]);
  assertEquals(r.hoje.find(i => i.id === 'filho')!.horasPrevistas, null);
});

Deno.test('atrasadas: só não concluídas e fim passado; suspensos fora; próximas: só 7 dias', () => {
  const r = resumoDoDia(eu, HOJE, base());
  assertEquals(r.atrasadas.map(i => i.tarefa), ['Relatório']);
  assertEquals(r.proximas.map(i => i.tarefa), ['Sessão 6']);
});

Deno.test('next steps: só os da pessoa, abertos, de projetos ativos; atrasados primeiro', () => {
  const passos = [
    passo('semData'), passo('futuro', { data_prevista: '2026-10-20' }), passo('atrasado', { data_prevista: '2026-10-01' }),
    passo('concluido', { estado: 'concluido' }), passo('fechado', { fechado: true }), passo('abandonado', { estado: 'abandonado' }),
    passo('deOutro', { responsavel_id: 'r2' }), passo('projSuspenso', { projeto_id: 'p2' }), passo('emCurso', { estado: 'em_curso', data_prevista: '2026-10-15' }),
  ];
  const r = resumoDoDia(eu, HOJE, base({ passos }));
  assertEquals(r.passos.map(x => x.descricao), ['Passo atrasado', 'Passo emCurso', 'Passo futuro', 'Passo semData']);
  assertEquals(r.passos[0].atrasado, true);
  assertEquals(r.passos[0].tarefa, 'Preparar sessão');
});

Deno.test('ausente (aprovada ou pendente) não recebe nada; rejeitada recebe', () => {
  const aus = (estado: string) => [{ recurso_id: 'r1', data_inicio: '2026-10-06', data_fim: '2026-10-08', estado }];
  assert(resumoVazio(resumoDoDia(eu, HOJE, base({ ausencias: aus('aprovada'), passos: [passo('a')] }))));
  assert(resumoVazio(resumoDoDia(eu, HOJE, base({ ausencias: aus('pendente') }))));
  assert(!resumoVazio(resumoDoDia(eu, HOJE, base({ ausencias: aus('rejeitada') }))));
});

Deno.test('quem não tem nada recebe resumo vazio (não se envia)', () => {
  assert(resumoVazio(resumoDoDia({ id: 'r9', nome: 'Ninguém' }, HOJE, base())));
});

Deno.test('só next steps também gera email (sem tarefas)', () => {
  const r = resumoDoDia({ id: 'r2', nome: 'Rita Leal' }, HOJE, base({ passos: [passo('x', { responsavel_id: 'r2', data_prevista: '2026-10-09' })] }));
  assertEquals([r.hoje.length, r.passos.length], [0, 1]);
  assertEquals(assuntoDoResumo(r), 'O teu resumo de hoje — 1 next step(s)');
});

Deno.test('email: secções só com conteúdo, escapa HTML, corta listas longas', () => {
  const muitos = Array.from({ length: 12 }, (_, i) => passo('p' + i, { descricao: i === 0 ? 'Rever <b>contrato</b> & enviar' : 'Passo ' + i, data_prevista: '2026-10-0' + (i % 9 + 1) }));
  const r = resumoDoDia(eu, HOJE, base({ passos: muitos }));
  const e = montarEmail('Milton Cabral', 'quarta, 7 de outubro', r, 'https://app/');
  assertStringIncludes(e.assunto, '2 tarefa(s) hoje');
  assertStringIncludes(e.html, 'Tarefas de hoje');
  assertStringIncludes(e.html, 'Em atraso');
  assertStringIncludes(e.html, 'Next steps abertos');
  assertStringIncludes(e.html, 'Nos próximos dias');
  assertStringIncludes(e.html, 'Rever &lt;b&gt;contrato&lt;/b&gt; &amp; enviar');
  assertStringIncludes(e.html, '… e mais 2');
  assertStringIncludes(e.texto, '6h previstas · 2,5h registadas');
  assertStringIncludes(e.texto, 'Olá Milton');
  const soHoje = montarEmail('Milton', 'x', { hoje: r.hoje, atrasadas: [], proximas: [], passos: [] }, 'https://app/');
  assert(!soHoje.html.includes('Em atraso') && !soHoje.html.includes('Next steps'));
});

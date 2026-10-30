import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { acoesDeReunioes, type Reuniao } from './reunioes.ts';
import { aplicarPreferencias, indexarAgenda, indexarRegistadas, resumoDoDia, resumoVazio, totalItens, type ContextoResumo } from './logica.ts';
import { assuntoDoResumo, montarEmail } from './email.ts';

const HOJE = '2026-11-02';
const acao = (texto: string, extra: Record<string, unknown> = {}) => ({
  id: 'p-' + texto, tipo: 'acao', texto, responsavel_recurso_id: 'r1', prazo: null as string | null, concluida: false, natureza: '', ...extra,
});
const reuniao = (id: string, pontos: unknown[], extra: Record<string, unknown> = {}): Reuniao => ({
  id, titulo: 'Reunião ' + id, data_hora: '2026-10-30T10:00:00Z', estado: 'realizada', projeto_id: null, projeto_nome: '', cliente: '',
  oportunidade_titulo: '', pontos, ...extra,
} as Reuniao);
const eu = { id: 'r1', nome: 'Milton Cabral' };

Deno.test('só as ações por fazer desta pessoa, com prazo até 7 dias; atrasadas primeiro', () => {
  const reunioes = [
    reuniao('1', [
      acao('daquiA5Dias', { prazo: '2026-11-07' }), acao('daquiA8Dias', { prazo: '2026-11-10' }), acao('semPrazo'),
      acao('feita', { prazo: '2026-11-01', concluida: true }), acao('deOutra', { prazo: '2026-11-02', responsavel_recurso_id: 'r2' }),
      { id: 'dec', tipo: 'decisao', texto: 'decisão', responsavel_recurso_id: 'r1', prazo: '2026-11-02' },
    ]),
    reuniao('2', [acao('atrasadaVelha', { prazo: '2026-10-01' }), acao('hoje', { prazo: HOJE })]),
    reuniao('3', [acao('atrasadaRecente', { prazo: '2026-11-01' })]),
    reuniao('4', [acao('deReuniaoCancelada', { prazo: '2026-10-05' })], { estado: 'cancelada' }),
  ];
  const itens = acoesDeReunioes(eu, HOJE, reunioes);
  assertEquals(itens.map(i => i.descricao), ['atrasadaVelha', 'atrasadaRecente', 'hoje', 'daquiA5Dias']);
  assertEquals(itens.map(i => [i.atrasado, i.hoje]), [[true, false], [true, false], [false, true], [false, false]]);
});

Deno.test('contexto: tarefa do projeto (nome atual), comercial e cliente; a reunião vem sempre', () => {
  const reunioes = [
    reuniao('1', [acao('A', { prazo: HOJE, natureza: 'projeto', tarefa_id: 't1', tarefa_nome: 'Nome antigo' })], { projeto_nome: '2026/001 — SIG (CITEVE)' }),
    reuniao('2', [acao('B', { prazo: HOJE, natureza: 'comercial' })], { cliente: 'Barcelcom', oportunidade_titulo: 'Proposta 2027' }),
    reuniao('3', [acao('C', { prazo: HOJE })], { cliente: 'Outro' }),
    reuniao('4', [acao('D', { prazo: HOJE, natureza: 'projeto', tarefa_id: 'apagada', tarefa_nome: 'Guardada' })], { projeto_nome: 'P' }),
  ];
  const itens = acoesDeReunioes(eu, HOJE, reunioes, id => id === 't1' ? 'Relatório final' : undefined);
  const por = Object.fromEntries(itens.map(i => [i.descricao, i.contexto]));
  assertEquals(por.A, '2026/001 — SIG (CITEVE) › Relatório final · reunião "Reunião 1" (30/10)');
  assertEquals(por.B, 'Comercial · Barcelcom · Proposta 2027 · reunião "Reunião 2" (30/10)');
  assertEquals(por.C, 'Outro · reunião "Reunião 3" (30/10)');
  assertEquals(por.D, 'P › Guardada · reunião "Reunião 4" (30/10)');
});

Deno.test('pontos em falta ou nulos não rebentam', () => {
  assertEquals(acoesDeReunioes(eu, HOJE, [reuniao('1', null as unknown as unknown[])]), []);
  assertEquals(acoesDeReunioes(eu, HOJE, []), []);
});

const ctx = (reunioes?: Reuniao[]): ContextoResumo => ({
  indice: indexarAgenda([], [], []), ausencias: [], passos: [], projetos: [], tarefas: [], registadas: indexarRegistadas([]), reunioes,
});

Deno.test('o resumo do dia leva as ações; sem o módulo (reunioes em falta) não há secção; só ações também gera email', () => {
  const r = resumoDoDia(eu, HOJE, ctx([reuniao('1', [acao('Enviar proposta', { prazo: '2026-11-01', natureza: 'comercial' })], { cliente: 'Barcelcom' })]));
  assertEquals(r.acoes?.length, 1);
  assert(!resumoVazio(r));
  assertEquals(totalItens(r), 1);
  assertEquals(assuntoDoResumo(r), 'O teu resumo de hoje — 1 ação(ões) de reuniões');
  assert(resumoVazio(resumoDoDia(eu, HOJE, ctx(undefined))));
  assert(resumoVazio(resumoDoDia({ id: 'r9', nome: 'Outra' }, HOJE, ctx([reuniao('1', [acao('x', { prazo: HOJE })])]))));
});

Deno.test('ausente não recebe as ações', () => {
  const c = { ...ctx([reuniao('1', [acao('x', { prazo: HOJE })])]), ausencias: [{ recurso_id: 'r1', data_inicio: '2026-11-01', data_fim: '2026-11-05', estado: 'aprovada' }] };
  assert(resumoVazio(resumoDoDia(eu, HOJE, c)));
});

Deno.test('preferências: "acoes" false desliga a secção; as outras ficam', () => {
  const r = resumoDoDia(eu, HOJE, ctx([reuniao('1', [acao('x', { prazo: HOJE })])]));
  assert(resumoVazio(aplicarPreferencias(r, { acoes: false })));
  assertEquals(totalItens(aplicarPreferencias(r, { hoje: false })), 1);
});

Deno.test('email: secção "Ações de reuniões" com atraso destacado, prazo e contexto; escapa HTML', () => {
  const r = resumoDoDia(eu, HOJE, ctx([reuniao('1', [
    acao('Rever <contrato>', { prazo: '2026-10-28', natureza: 'comercial' }), acao('Marcar sessão', { prazo: HOJE }), acao('Preparar slides', { prazo: '2026-11-06' }),
  ], { cliente: 'Barcelcom' })]));
  const e = montarEmail('Milton Cabral', 'segunda, 2 de novembro', r, 'https://app/');
  assertStringIncludes(e.html, 'Ações de reuniões');
  assertStringIncludes(e.html, 'Rever &lt;contrato&gt;');
  assertStringIncludes(e.texto, 'prazo 28/10 — em atraso · Comercial · Barcelcom · reunião "Reunião 1" (30/10)');
  assertStringIncludes(e.texto, 'prazo hoje');
  assertStringIncludes(e.texto, 'prazo 06/11');
  assertStringIncludes(e.html, 'color:#b91c1c');
});

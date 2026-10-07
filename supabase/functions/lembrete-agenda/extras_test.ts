import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { aprovacoesPendentes, eLiderOuDiretor, resumoComercial, temAcessoCrm } from './extras.ts';
import { indexarAgenda, resumoDoDia, resumoVazio, totalItens } from './logica.ts';
import { assuntoDoResumo, montarEmail } from './email.ts';

const HOJE = '2026-10-07';
// Organização: departamento D1 (diretor Dina) com equipas E1 (líder Leo) e E2 (líder Lia); E3 sem departamento (líder Ivo).
const recursos = [
  { id: 'adm', nome: 'Admin', acesso: 'admin', equipa_id: null },
  { id: 'dina', nome: 'Dina Diretora', acesso: 'user', equipa_id: 'E1' },
  { id: 'leo', nome: 'Leo Líder', acesso: 'user', equipa_id: 'E1' },
  { id: 'lia', nome: 'Lia Líder', acesso: 'user', equipa_id: 'E2' },
  { id: 'ivo', nome: 'Ivo Isolado', acesso: 'user', equipa_id: 'E3' },
  { id: 'ana', nome: 'Ana Consultora', acesso: 'user', equipa_id: 'E1' },
  { id: 'rui', nome: 'Rui Consultor', acesso: 'user', equipa_id: 'E2' },
  { id: 'sem', nome: 'Sem Equipa', acesso: 'user', equipa_id: null },
];
const equipas = [
  { id: 'E1', lider_id: 'leo', departamento_id: 'D1' }, { id: 'E2', lider_id: 'lia', departamento_id: 'D1' },
  { id: 'E3', lider_id: 'ivo', departamento_id: null },
];
const departamentos = [{ id: 'D1', diretor_id: 'dina' }];
const org = { recursos, equipas, departamentos };
const pessoa = (id: string) => recursos.find(r => r.id === id)!;
const pedido = (recurso_id: string, extra: Record<string, unknown> = {}) =>
  ({ recurso_id, data_inicio: '2026-10-20', data_fim: '2026-10-22', estado: 'pendente', tipo: 'Férias', ...extra });

Deno.test('por aprovar: líder só da sua equipa; diretor de todo o departamento; admin tudo; nunca o próprio', () => {
  const pedidos = [pedido('ana'), pedido('rui', { data_inicio: '2026-10-10', data_fim: '2026-10-10' }), pedido('ivo'), pedido('leo'), pedido('ana', { estado: 'aprovada' }), pedido('ana', { estado: 'rejeitada' })];
  const nomes = (id: string) => aprovacoesPendentes(pessoa(id), pedidos, org).map(i => i.pessoa);
  assertEquals(nomes('leo'), ['Ana Consultora']);                                           // Ana (E1); não o próprio nem Rui (E2)
  assertEquals(nomes('lia'), ['Rui Consultor']);
  assertEquals(nomes('dina'), ['Rui Consultor', 'Ana Consultora', 'Leo Líder']);            // diretor: E1+E2, ordenado por data; Leo é da E1
  assertEquals(nomes('ivo'), []);                                                           // lidera E3, mas o pedido dele é dele
  assertEquals(nomes('adm').length, 4);                                                     // admin: todos os pendentes (ana, rui, ivo, leo)
  assertEquals(nomes('ana'), []);                                                           // consultora não decide
  assertEquals(aprovacoesPendentes(pessoa('dina'), [pedido('dina')], org), []);             // nem o diretor o seu próprio
});

Deno.test('acesso ao Comercial: admin, diretor, líder; consultor não', () => {
  const acesso = (id: string) => temAcessoCrm(pessoa(id), equipas, departamentos);
  assertEquals(['adm', 'dina', 'leo', 'ivo'].map(acesso), [true, true, true, true]);
  assertEquals(['ana', 'rui', 'sem'].map(acesso), [false, false, false]);
  assert(eLiderOuDiretor('dina', equipas, departamentos));
});

const comercial = {
  contas: [{ id: 'c1', nome: 'Têxtil do Ave' }, { id: 'c2', nome: 'Energia Verde' }],
  etapas: [{ id: 'aberta', nome: 'Proposta enviada', categoria: 'aberta' }, { id: 'ganha', nome: 'Ganha', categoria: 'ganha' }],
  oportunidades: [
    { id: 'o1', conta_id: 'c1', titulo: 'Auditoria', etapa_id: 'aberta', valor_estimado: '12600', data_prevista_fecho: '2026-10-09', responsavel_id: 'leo' },
    { id: 'o2', conta_id: 'c2', titulo: 'Lean', etapa_id: 'aberta', valor_estimado: 8000, data_prevista_fecho: '2026-09-30', responsavel_id: 'leo' },
    { id: 'o3', conta_id: 'c1', titulo: 'Longe', etapa_id: 'aberta', valor_estimado: 1, data_prevista_fecho: '2026-12-01', responsavel_id: 'leo' },
    { id: 'o4', conta_id: 'c1', titulo: 'Ganha já', etapa_id: 'ganha', valor_estimado: 1, data_prevista_fecho: '2026-10-08', responsavel_id: 'leo' },
    { id: 'o5', conta_id: 'c1', titulo: 'De outro', etapa_id: 'aberta', valor_estimado: 1, data_prevista_fecho: '2026-10-08', responsavel_id: 'lia' },
    { id: 'o6', conta_id: 'c1', titulo: 'Sem data', etapa_id: 'aberta', valor_estimado: 1, data_prevista_fecho: null, responsavel_id: 'leo' },
  ],
  tarefas: [
    { id: 't1', conta_id: 'c1', oportunidade_id: 'o1', descricao: 'Ligar ao cliente', responsavel_id: 'leo', data_limite: '2026-10-07', concluida: false },
    { id: 't2', conta_id: 'c2', oportunidade_id: null, descricao: 'Enviar proposta', responsavel_id: 'leo', data_limite: '2026-10-01', concluida: false },
    { id: 't3', conta_id: 'c1', oportunidade_id: null, descricao: 'Futuro', responsavel_id: 'leo', data_limite: '2026-10-20', concluida: false },
    { id: 't4', conta_id: 'c1', oportunidade_id: null, descricao: 'Feita', responsavel_id: 'leo', data_limite: '2026-10-01', concluida: true },
    { id: 't5', conta_id: 'c1', oportunidade_id: null, descricao: 'De outra pessoa', responsavel_id: 'lia', data_limite: '2026-10-01', concluida: false },
    { id: 't6', conta_id: 'c1', oportunidade_id: null, descricao: 'Sem prazo', responsavel_id: 'leo', data_limite: null, concluida: false },
  ],
};

Deno.test('comercial: follow-ups até hoje (atrasados primeiro) e oportunidades abertas a fechar, só do responsável', () => {
  const r = resumoComercial({ id: 'leo' }, HOJE, comercial);
  assertEquals(r.followups.map(f => [f.descricao, f.atrasado]), [['Enviar proposta', true], ['Ligar ao cliente', false]]);
  assertEquals(r.followups[1].contexto, 'Têxtil do Ave · Auditoria');
  assertEquals(r.oportunidades.map(o => [o.titulo, o.ultrapassado]), [['Lean', true], ['Auditoria', false]]);
  assertEquals(r.oportunidades[1].valor, 12600);
});

Deno.test('resumo: Comercial só para quem tem acesso; consultor com tarefas CRM no seu nome não as vê', () => {
  const ctx = { indice: indexarAgenda([], [], []), ausencias: [], passos: [], projetos: [], tarefas: [], registadas: new Map(), org, comercial };
  const leo = resumoDoDia(pessoa('leo'), HOJE, ctx);
  assertEquals([leo.followups?.length, leo.oportunidades?.length], [2, 2]);
  const dados = { ...comercial, tarefas: comercial.tarefas.map(t => ({ ...t, responsavel_id: 'ana' })) };
  const ana = resumoDoDia(pessoa('ana'), HOJE, { ...ctx, comercial: dados });
  assert(resumoVazio(ana));
});

Deno.test('resumo: ausente não recebe nem aprovações; sem comercial/org corre como antes', () => {
  const ausencias = [{ recurso_id: 'leo', data_inicio: '2026-10-06', data_fim: '2026-10-08', estado: 'aprovada' }, pedido('ana')];
  const base = { indice: indexarAgenda([], [], []), ausencias, passos: [], projetos: [], tarefas: [], registadas: new Map() };
  assert(resumoVazio(resumoDoDia(pessoa('leo'), HOJE, { ...base, org, comercial })));
  assert(resumoVazio(resumoDoDia(pessoa('leo'), HOJE, { ...base, ausencias: [] })));
});

Deno.test('email: secções novas, destaque dos atrasados, valor em euros e assunto', () => {
  const ctx = { indice: indexarAgenda([], [], []), ausencias: [pedido('ana')], passos: [], projetos: [], tarefas: [], registadas: new Map(), org, comercial };
  const r = resumoDoDia(pessoa('leo'), HOJE, ctx);
  assertEquals(totalItens(r), 5);
  assertEquals(assuntoDoResumo(r), 'O teu resumo de hoje — 1 por aprovar, 2 follow-up(s)');
  const e = montarEmail('Leo Líder', 'quarta, 7 de outubro', r, 'https://app/');
  for (const t of ['Pedidos de ausência por aprovar', 'Comercial — follow-ups', 'Comercial — oportunidades a fechar']) assertStringIncludes(e.html, t);
  assertStringIncludes(e.texto, 'Ana Consultora');
  assertStringIncludes(e.texto, 'Férias · 20/10 a 22/10');
  assertStringIncludes(e.texto, '12 600 €');
  assertStringIncludes(e.texto, 'prazo 01/10 — em atraso');
  assertStringIncludes(e.texto, 'fecho previsto 30/09 — ultrapassado');
  assertStringIncludes(e.texto, 'prazo hoje');
});

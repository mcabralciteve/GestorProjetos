// Ações das reuniões como tarefas das pessoas (projeto / comercial) — correr com: node --test tests/reunioes-acoes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reunioes-logica.js');
const Ata = require('../js/reunioes-ata.js');

const HOJE = '2026-11-02';
const acao = (texto, extra) => Object.assign({ id: 'p-' + texto, tipo: 'acao', texto, responsavel: '', responsavel_recurso_id: null, prazo: null, concluida: false, natureza: '', tarefa_id: null, tarefa_nome: '' }, extra);
const reu = (id, pontos, extra) => Object.assign({ id, titulo: 'Reunião ' + id, data_hora: '2026-10-30T10:00:00Z', estado: 'realizada', projeto_id: null, projeto_nome: '', cliente: '', oportunidade_titulo: '', participantes: [], pontos }, extra);

test('normalizarPonto: pontos antigos ficam "geral"; a tarefa só vale com natureza "projeto"; decisões nunca têm natureza', () => {
  const antigo = R.normalizarPonto({ id: 'a', tipo: 'acao', texto: 'x', concluida: false });
  assert.deepEqual([antigo.natureza, antigo.tarefa_id, antigo.tarefa_nome], ['', null, '']);
  const proj = R.normalizarPonto({ tipo: 'acao', natureza: 'projeto', tarefa_id: 't1', tarefa_nome: 'Relatório' });
  assert.deepEqual([proj.natureza, proj.tarefa_id, proj.tarefa_nome], ['projeto', 't1', 'Relatório']);
  const com = R.normalizarPonto({ tipo: 'acao', natureza: 'comercial', tarefa_id: 't1', tarefa_nome: 'Relatório' });
  assert.deepEqual([com.natureza, com.tarefa_id, com.tarefa_nome], ['comercial', null, '']);
  assert.equal(R.normalizarPonto({ tipo: 'acao', natureza: 'inventada' }).natureza, '');
  assert.equal(R.normalizarPonto({ tipo: 'decisao', natureza: 'projeto', tarefa_id: 't1' }).natureza, '');
});

test('normalizar: as ações vindas da base de dados já trazem os campos novos', () => {
  const r = R.normalizar({ id: 'r', pontos: [{ id: 'a', tipo: 'acao', texto: 'x' }] });
  assert.equal(r.pontos[0].natureza, '');
  assert.equal(r.pontos[0].tarefa_id, null);
});

test('novoPonto: ação com a natureza pedida; decisão sem natureza', () => {
  assert.equal(R.novoPonto('acao', 'comercial').natureza, 'comercial');
  assert.equal(R.novoPonto('acao').natureza, '');
  assert.equal(R.novoPonto('decisao', 'projeto').natureza, '');
});

test('naturezaPorOmissao: projeto → projeto; só conta/oportunidade → comercial; nada → geral', () => {
  assert.equal(R.naturezaPorOmissao({ projeto_id: 'p1', conta_id: 'c1' }), 'projeto');
  assert.equal(R.naturezaPorOmissao({ conta_id: 'c1' }), 'comercial');
  assert.equal(R.naturezaPorOmissao({ oportunidade_id: 'o1' }), 'comercial');
  assert.equal(R.naturezaPorOmissao({}), '');
});

test('resolverResponsaveis: liga o nome ao colega ativo, mantém a ligação, limpa quando o nome some ou não existe', () => {
  const recursos = [{ id: 'r1', nome: 'Ana Sofia' }, { id: 'r2', nome: 'Rui Costa', ativo: false }, { id: 'r3', nome: 'João Álvaro' }];
  const pontos = [
    acao('a', { responsavel: 'ana sofia' }),                                         // liga (sem acentos/maiúsculas)
    acao('b', { responsavel: 'Rui Costa' }),                                         // inativo: não liga
    acao('c', { responsavel: 'Maria Externa', responsavel_recurso_id: 'r1' }),       // o nome já não é o do colega: desliga
    acao('d', { responsavel: '', responsavel_recurso_id: 'r1' }),                    // nome apagado: desliga
    acao('e', { responsavel: 'Rui Costa', responsavel_recurso_id: 'r2' }),           // já ligado a esse (agora inativo): mantém
    acao('f', { responsavel: 'Joao Alvaro' }),
    { id: 'g', tipo: 'decisao', texto: 'g', responsavel_recurso_id: 'r1' }           // decisões não se mexem
  ];
  R.resolverResponsaveis(pontos, recursos);
  assert.deepEqual(pontos.map(p => p.responsavel_recurso_id), ['r1', null, null, null, 'r2', 'r3', 'r1']);
});

test('acoesDe: só as ações por fazer dessa pessoa, de reuniões não canceladas; atrasadas primeiro', () => {
  const lista = [
    reu('1', [acao('futura', { responsavel_recurso_id: 'r1', prazo: '2026-11-20' }), acao('semPrazo', { responsavel_recurso_id: 'r1' }),
      acao('feita', { responsavel_recurso_id: 'r1', concluida: true }), acao('deOutra', { responsavel_recurso_id: 'r2' }),
      { id: 'dec', tipo: 'decisao', texto: 'decisão', responsavel_recurso_id: 'r1' }]),
    reu('2', [acao('atrasadaVelha', { responsavel_recurso_id: 'r1', prazo: '2026-10-01' }), acao('hoje', { responsavel_recurso_id: 'r1', prazo: HOJE })]),
    reu('3', [acao('atrasadaRecente', { responsavel_recurso_id: 'r1', prazo: '2026-11-01' })]),
    reu('4', [acao('deReuniaoCancelada', { responsavel_recurso_id: 'r1', prazo: '2026-10-05' })], { estado: 'cancelada' })
  ];
  const a = R.acoesDe(lista, 'r1', HOJE);
  assert.deepEqual(a.map(x => x.texto), ['atrasadaVelha', 'atrasadaRecente', 'hoje', 'futura', 'semPrazo']);
  assert.deepEqual(a.map(x => x.atrasada), [true, true, false, false, false]);
  assert.equal(R.contarAtrasadas(lista, 'r1', HOJE), 2);
  assert.deepEqual(R.acoesDe(lista, null, HOJE), []);
  assert.deepEqual(R.acoesDe(lista, 'r9', HOJE), []);
});

test('acoesDe: cada ação leva o contexto (reunião, projeto, tarefa, cliente)', () => {
  const lista = [reu('1', [acao('Enviar relatório', { responsavel_recurso_id: 'r1', prazo: '2026-11-10', natureza: 'projeto', tarefa_id: 't1', tarefa_nome: 'Relatório final' })],
    { projeto_id: 'p1', projeto_nome: '2026/001 — SIG', cliente: 'Barcelcom' })];
  const [a] = R.acoesDe(lista, 'r1', HOJE);
  assert.deepEqual([a.reuniaoId, a.pontoId, a.natureza, a.tarefaId, a.projetoId, a.reuniaoTitulo, a.cliente],
    ['1', 'p-Enviar relatório', 'projeto', 't1', 'p1', 'Reunião 1', 'Barcelcom']);
  assert.equal(R.origemAcao(a), '2026/001 — SIG › Relatório final');
  assert.equal(R.origemAcao(a, 'Relatório (renomeado)'), '2026/001 — SIG › Relatório (renomeado)');
});

test('origemAcao: comercial e geral', () => {
  assert.equal(R.origemAcao({ natureza: 'comercial', cliente: 'Barcelcom', oportunidadeTitulo: 'Proposta 2027' }), 'Comercial · Barcelcom · Proposta 2027');
  assert.equal(R.origemAcao({ natureza: 'comercial' }), 'Comercial');
  assert.equal(R.origemAcao({ natureza: '', cliente: 'Barcelcom' }), 'Barcelcom');
  assert.equal(R.origemAcao({ natureza: 'projeto', projetoNome: '', tarefaNome: '' }), 'Projeto');
});

test('acoesComerciais: só as comerciais por fazer (qualquer responsável); filtro opcional por colega', () => {
  const lista = [reu('1', [
    acao('c1', { natureza: 'comercial', responsavel_recurso_id: 'r1', prazo: '2026-11-05' }),
    acao('c2', { natureza: 'comercial', responsavel: 'Cliente (externo)' }),
    acao('c3', { natureza: 'comercial', responsavel_recurso_id: 'r2', concluida: true }),
    acao('p1', { natureza: 'projeto', responsavel_recurso_id: 'r1' }),
    acao('g1', { responsavel_recurso_id: 'r1' })
  ])];
  assert.deepEqual(R.acoesComerciais(lista, HOJE).map(a => a.texto), ['c1', 'c2']);
  assert.deepEqual(R.acoesComerciais(lista, HOJE, 'r1').map(a => a.texto), ['c1']);
});

test('quem tem uma ação atribuída vê a reunião (mas não a edita)', () => {
  const r = reu('1', [acao('x', { responsavel_recurso_id: 'r7' })], { criado_por_user: 'outro' });
  const ctx = { userId: 'u1', recursoId: 'r7', admin: false, crmVer: false, veProjeto: () => false };
  assert.equal(R.podeVer(r, ctx), true);
  assert.equal(R.podeEditar(r, ctx), false);
  assert.equal(R.podeVer(r, Object.assign({}, ctx, { recursoId: 'r8' })), false);
  assert.equal(R.podeVer(reu('2', [{ id: 'd', tipo: 'decisao', texto: 'd', responsavel_recurso_id: 'r7' }], { criado_por_user: 'outro' }), ctx), false); // decisões não dão acesso
});

test('ata: a ação indica a tarefa ou "Ação comercial"; sem natureza fica como antes', () => {
  const r = reu('1', [], { projeto_nome: '2026/001 — SIG' });
  assert.equal(Ata.textoAcao(acao('A'), r), 'A');
  assert.equal(Ata.textoAcao(acao('A', { natureza: 'projeto', tarefa_id: 't1', tarefa_nome: 'Relatório' }), r), 'A\nTarefa: Relatório');
  assert.equal(Ata.textoAcao(acao('A', { natureza: 'projeto' }), r), 'A\nProjeto: 2026/001 — SIG');
  assert.equal(Ata.textoAcao(acao('A', { natureza: 'comercial' }), r), 'A\nAção comercial');
  const xml = Ata.corpo(Object.assign(reu('1', [acao('Enviar', { natureza: 'projeto', tarefa_id: 't1', tarefa_nome: 'Relatório <final>' })]), { participantes: [], ficheiros: [], notas: '', ordem_trabalhos: '' }), { versao: 1 });
  assert.ok(xml.includes('Tarefa: Relatório &lt;final&gt;'));
});

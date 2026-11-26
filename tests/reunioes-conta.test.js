// Reuniões na ficha do cliente (CRM) — correr com: node --test tests/reunioes-conta.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reunioes-logica.js');

const reu = (id, extra) => Object.assign({ id, titulo: 'R' + id, data_hora: '2026-10-30T10:00:00Z', criado_por_user: 'outro', participantes: [], conta_id: null, oportunidade_id: null, projeto_id: null }, extra);

test('daConta: ligadas à conta, a uma das suas oportunidades ou a um dos seus projetos', () => {
  const lista = [reu('a', { conta_id: 'c1' }), reu('b', { oportunidade_id: 'o1' }), reu('c', { projeto_id: 'p1' }),
    reu('d', { conta_id: 'c2' }), reu('e', { oportunidade_id: 'o9' }), reu('f', { projeto_id: 'p9' }), reu('g')];
  const ids = R.daConta(lista, { contaId: 'c1', opIds: ['o1'], projetoIds: ['p1'] }).map(r => r.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.deepEqual(R.daConta(lista, { contaId: 'c1' }).map(r => r.id), ['a']);   // sem listas: só a ligação direta
  assert.deepEqual(R.daConta(null, { contaId: 'c1' }), []);
});

test('daOportunidade: só as ligadas a essa oportunidade', () => {
  const lista = [reu('a', { oportunidade_id: 'o1' }), reu('b', { conta_id: 'c1' }), reu('c', { oportunidade_id: 'o2' })];
  assert.deepEqual(R.daOportunidade(lista, 'o1').map(r => r.id), ['a']);
});

test('daOportunidade: com projetoId inclui também as reuniões do projeto que nasceu da oportunidade', () => {
  const lista = [reu('a', { oportunidade_id: 'o1' }), reu('b', { projeto_id: 'p1' }), reu('c', { projeto_id: 'p9' }), reu('d', { oportunidade_id: 'o2' })];
  assert.deepEqual(R.daOportunidade(lista, 'o1', 'p1').map(r => r.id), ['a', 'b']);
  assert.deepEqual(R.daOportunidade(lista, 'o1', null).map(r => r.id), ['a']);
});

test('doProjeto: reuniões do projeto e das oportunidades que lhe deram origem', () => {
  const lista = [reu('a', { projeto_id: 'p1' }), reu('b', { oportunidade_id: 'o1' }), reu('c', { oportunidade_id: 'o9' }), reu('d', { projeto_id: 'p9' }), reu('e')];
  assert.deepEqual(R.doProjeto(lista, 'p1', ['o1']).map(r => r.id), ['a', 'b']);
  assert.deepEqual(R.doProjeto(lista, 'p1').map(r => r.id), ['a']);
  assert.deepEqual(R.doProjeto(null, 'p1', ['o1']), []);
});

test('filtrar por oportunidade, e por projeto com as oportunidades de origem', () => {
  const lista = [reu('a', { projeto_id: 'p1', estado: 'agendada' }), reu('b', { oportunidade_id: 'o1', estado: 'agendada' }), reu('c', { oportunidade_id: 'o2', estado: 'agendada' })];
  const ids = f => R.filtrar(lista, f).map(r => r.id).sort();
  assert.deepEqual(ids({ oportunidade: 'o1' }), ['b']);
  assert.deepEqual(ids({ projeto: 'p1' }), ['a']);
  assert.deepEqual(ids({ projeto: 'p1', opsDoProjeto: ['o1'] }), ['a', 'b']);
});

test('oportunidadesDasReunioes: distintas, por título', () => {
  const lista = [reu('a', { oportunidade_id: 'o2', oportunidade_titulo: 'Zeta' }), reu('b', { oportunidade_id: 'o1', oportunidade_titulo: 'Alfa' }), reu('c', { oportunidade_id: 'o1', oportunidade_titulo: 'Alfa' }), reu('d')];
  assert.deepEqual(R.oportunidadesDasReunioes(lista), [{ id: 'o1', titulo: 'Alfa' }, { id: 'o2', titulo: 'Zeta' }]);
});

test('quem tem acesso ao CRM vê as reuniões ligadas a uma conta; os outros não', () => {
  const sem = { userId: 'u1', recursoId: 'r1', admin: false, crmVer: false, veProjeto: () => false };
  const com = Object.assign({}, sem, { crmVer: true });
  const r = reu('a', { conta_id: 'c1' });
  assert.equal(R.podeVer(r, sem), false);
  assert.equal(R.podeVer(r, com), true);
  assert.equal(R.podeVer(reu('b'), com), false); // sem ligação nenhuma ao CRM: continua privada
});

test('o responsável da conta edita as reuniões da conta; ver não dá o direito de editar', () => {
  const ctx = { userId: 'u1', recursoId: 'r1', admin: false, crmVer: true, souResponsavelConta: id => id === 'c1' };
  assert.equal(R.podeEditar(reu('a', { conta_id: 'c1' }), ctx), true);
  assert.equal(R.podeEditar(reu('b', { conta_id: 'c2' }), ctx), false);
  assert.equal(R.podeEditar(reu('c', { conta_id: 'c1' }), Object.assign({}, ctx, { souResponsavelConta: () => false })), false);
});

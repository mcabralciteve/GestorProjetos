// Comentários nas tarefas — correr com: node --test tests/comentarios-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/comentarios-logica.js');

const com = (id, tarefaId, autor, criadoEm) => ({ id, tarefaId, autorUserId: autor, criadoEm });

test('limparTexto: tira espaços, recusa vazio, corta o excesso', () => {
  assert.equal(C.limparTexto('  olá \r\n mundo  '), 'olá \n mundo');
  assert.equal(C.limparTexto('   '), null);
  assert.equal(C.limparTexto(null), null);
  assert.equal(C.limparTexto('x'.repeat(C.MAX_TEXTO + 50)).length, C.MAX_TEXTO);
});

test('deLinha converte a linha da tabela', () => {
  const c = C.deLinha({ id: 'a', projeto_id: 'p', tarefa_id: 't', autor_user_id: 'u', autor_nome: 'Ana', texto: 'ok', criado_em: '2026-10-29T10:00:00Z', editado_em: null });
  assert.deepEqual(c, { id: 'a', projetoId: 'p', tarefaId: 't', autorUserId: 'u', autorNome: 'Ana', texto: 'ok', criadoEm: '2026-10-29T10:00:00Z', editadoEm: null });
});

test('agruparPorTarefa: por tarefa, do mais antigo para o mais recente', () => {
  const g = C.agruparPorTarefa([com('3', 't1', 'u', '2026-10-29T12:00:00Z'), com('1', 't1', 'u', '2026-10-29T09:00:00Z'), com('2', 't2', 'u', '2026-10-29T10:00:00Z')]);
  assert.deepEqual(g.t1.map(c => c.id), ['1', '3']);
  assert.deepEqual(g.t2.map(c => c.id), ['2']);
  assert.deepEqual(C.agruparPorTarefa(null), {});
});

test('permissões: só o autor edita; autor, admin e gestor apagam', () => {
  const c = com('1', 't', 'ana', '2026-10-29T10:00:00Z');
  assert.equal(C.podeEditar(c, 'ana'), true);
  assert.equal(C.podeEditar(c, 'rui'), false);
  assert.equal(C.podeEditar(c, null), false);
  assert.equal(C.podeApagar(c, { userId: 'ana' }), true);
  assert.equal(C.podeApagar(c, { userId: 'rui' }), false);
  assert.equal(C.podeApagar(c, { userId: 'rui', admin: true }), true);
  assert.equal(C.podeApagar(c, { userId: 'rui', gestor: true }), true);
  // comentário sem autor conhecido: nunca é "do" utilizador sem sessão
  assert.equal(C.podeEditar(com('2', 't', null, 'x'), null), false);
});

test('porLer: só os de outros, depois da última vez que abri', () => {
  const l = [com('1', 't', 'ana', '2026-10-29T09:00:00Z'), com('2', 't', 'rui', '2026-10-29T10:00:00Z'), com('3', 't', 'rui', '2026-10-29T12:00:00Z')];
  assert.equal(C.porLer(l, 'ana', null), 2);
  assert.equal(C.porLer(l, 'ana', '2026-10-29T11:00:00Z'), 1);
  assert.equal(C.porLer(l, 'ana', '2026-10-29T13:00:00Z'), 0);
  assert.equal(C.porLer(l, 'rui', null), 1);
  assert.equal(C.porLer([], 'ana', null), 0);
});

test('quando: relativo no próprio dia, data completa depois', () => {
  const agora = new Date(2026, 9, 29, 15, 0, 0);
  const a = (dias, h, m) => new Date(2026, 9, 29 - dias, h, m, 0).toISOString();
  assert.equal(C.quando(new Date(2026, 9, 29, 14, 59, 40).toISOString(), agora), 'agora mesmo');
  assert.equal(C.quando(new Date(2026, 9, 29, 14, 55, 0).toISOString(), agora), 'há 5 min');
  assert.equal(C.quando(a(0, 9, 5), agora), 'hoje às 09:05');
  assert.equal(C.quando(a(1, 14, 30), agora), 'ontem às 14:30');
  assert.equal(C.quando(a(3, 9, 10), agora), '26/10/2026 09:10');
  assert.equal(C.quando('lixo', agora), '');
});

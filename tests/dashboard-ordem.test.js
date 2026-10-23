// Ordem dos cartões do Início — correr com: node --test tests/dashboard-ordem.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/dashboard-ordem.js');

test('sem ordem guardada mantém a ordem por omissão', () => {
  assert.deepEqual(D.ordenar(['a', 'b', 'c'], []), ['a', 'b', 'c']);
  assert.deepEqual(D.ordenar(['a', 'b', 'c'], undefined), ['a', 'b', 'c']);
});

test('segue a ordem guardada; cartões novos vão à frente; chaves que já não existem são ignoradas', () => {
  assert.deepEqual(D.ordenar(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.deepEqual(D.ordenar(['a', 'b', 'c', 'novo'], ['c', 'a', 'b']), ['novo', 'c', 'a', 'b']);
  assert.deepEqual(D.ordenar(['a', 'c'], ['x', 'c', 'y', 'a']), ['c', 'a']);
  assert.deepEqual(D.ordenar(['a', 'b'], ['b', 'b', 'a']), ['b', 'a']);        // repetidos não duplicam
});

test('guardar: ordem visível primeiro, depois as chaves escondidas que já estavam guardadas', () => {
  assert.deepEqual(D.paraGuardar(['b', 'a'], ['a', 'x', 'b', 'y']), ['b', 'a', 'x', 'y']);
  assert.deepEqual(D.paraGuardar(['a', 'b'], undefined), ['a', 'b']);
});

test('mover antes/depois de um alvo', () => {
  assert.deepEqual(D.mover(['a', 'b', 'c', 'd'], 'd', 'b', false), ['a', 'd', 'b', 'c']);
  assert.deepEqual(D.mover(['a', 'b', 'c', 'd'], 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepEqual(D.mover(['a', 'b'], 'a', 'a', true), ['a', 'b']);
  assert.deepEqual(D.mover(['a', 'b'], 'x', 'a', true), ['a', 'b']);
});

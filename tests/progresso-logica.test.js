// % de conclusão automática — correr com: node --test tests/progresso-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/progresso-logica.js');

test('reais ÷ previstas, arredondado', () => {
  assert.equal(P.auto(0, 40), 0);
  assert.equal(P.auto(10, 40), 25);
  assert.equal(P.auto(1, 3), 33);
  assert.equal(P.auto('10', '40'), 25);
});

test('o automático nunca passa dos 99%: o 100% só à mão', () => {
  assert.equal(P.auto(40, 40), 99);
  assert.equal(P.auto(39.9, 40), 99);
  assert.equal(P.auto(80, 40), 99);
});

test('sem horas previstas não há fórmula', () => {
  assert.equal(P.auto(5, 0), null);
  assert.equal(P.auto(5, null), null);
  assert.equal(P.auto(5, undefined), null);
});

test('reprevisão em automático: o maior entre previstas e reais', () => {
  assert.equal(P.eacAuto(2, 10), 10);
  assert.equal(P.eacAuto(14, 10), 14);
  assert.equal(P.eacAuto(0, 0), 0);
});

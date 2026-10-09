// O valor de uma proposta é o reflexo dos seus orçamentos — correr com: node --test tests/orcamento-valor-proposta.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/orcamento-logica.js');

const o = (versao, estado, total) => ({ versao, estado, total });

test('sem orçamentos a proposta não tem valor', () => {
  assert.deepEqual(O.valorDaProposta([]), { valor: 0, versao: null, estado: null });
  assert.deepEqual(O.valorDaProposta(undefined), { valor: 0, versao: null, estado: null });
});

test('com um validado, vale o validado (mesmo que haja versões mais recentes)', () => {
  const r = O.valorDaProposta([o(1, 'enviado', 1000), o(2, 'validado', 2000), o(3, 'rascunho', 9999)]);
  assert.deepEqual(r, { valor: 2000, versao: 2, estado: 'validado' });
});

test('sem validado, vale a versão mais recente que não esteja rejeitada', () => {
  assert.equal(O.valorDaProposta([o(1, 'enviado', 1000), o(2, 'rascunho', 1500)]).valor, 1500);
  assert.equal(O.valorDaProposta([o(1, 'enviado', 1000), o(2, 'rejeitado', 1500)]).valor, 1000);
  assert.equal(O.valorDaProposta([o(1, 'rejeitado', 1000)]).valor, 0);          // só rejeitados: sem valor
});

test('totais em texto também se leem (vêm da base de dados como string)', () => {
  assert.equal(O.valorDaProposta([o(1, 'validado', '1234.5')]).valor, 1234.5);
});

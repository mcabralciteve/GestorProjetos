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

test('resumo: média das % das filhas pesada pelas horas previstas', () => {
  // 10h a 100% e 30h a 0% → 25% (e não a média simples, 50%, nem a dos dias)
  assert.equal(P.mediaResumo([{ progresso: 100, previstas: 10, dias: 20 }, { progresso: 0, previstas: 30, dias: 1 }]), 25);
  assert.equal(P.mediaResumo([{ progresso: 80, previstas: 5, dias: 3 }]), 80);
});

test('resumo: as filhas sem horas previstas ficam de fora', () => {
  assert.equal(P.mediaResumo([{ progresso: 100, previstas: 0, dias: 50 }, { progresso: 50, previstas: 8, dias: 1 }]), 50);
  assert.equal(P.mediaResumo([{ progresso: 100, dias: 50 }, { progresso: 40, previstas: '10', dias: 1 }]), 40);
});

test('resumo: sem nenhuma hora previstas pesa pela duração (como antes) e sem filhas dá 0', () => {
  // 10 dias a 100% + 30 dias a 0% → 25%
  assert.equal(P.mediaResumo([{ progresso: 100, previstas: 0, dias: 10 }, { progresso: 0, dias: 30 }]), 25);
  assert.equal(P.mediaResumo([]), 0);
  assert.equal(P.mediaResumo([{ progresso: 70, previstas: 0, dias: 0 }]), 0);
});

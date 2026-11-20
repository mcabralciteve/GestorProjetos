// Intervalo de horas das ausências — correr com: node --test tests/intervalo-horas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../js/intervalo-horas.js');

test('horas entre dois instantes, com 2 casas decimais', () => {
  assert.equal(I.horas('14:00', '16:30'), 2.5);
  assert.equal(I.horas('09:00', '09:15'), 0.25);
  assert.equal(I.horas('09:10', '10:00'), 0.83);
  assert.equal(I.horas('00:00', '24:00'), 24);
  assert.equal(I.horas('9:30', '11:00'), 1.5); // sem zero à esquerda
});

test('inválidos: fim não depois do início, horas impossíveis, vazios', () => {
  assert.equal(I.horas('16:00', '14:00'), null);
  assert.equal(I.horas('14:00', '14:00'), null);
  assert.equal(I.horas('25:00', '26:00'), null);
  assert.equal(I.horas('10:60', '11:00'), null);
  assert.equal(I.horas('24:30', '24:45'), null);
  assert.equal(I.horas('', '10:00'), null);
  assert.equal(I.horas(null, undefined), null);
  assert.equal(I.horas('ab:cd', '10:00'), null);
  assert.equal(I.valido('10:00', '11:00'), true);
  assert.equal(I.valido('11:00', '10:00'), false);
});

test('rótulo só existe para intervalos válidos', () => {
  assert.equal(I.rotulo('14:00', '16:30'), '14:00–16:30');
  assert.equal(I.rotulo('16:30', '14:00'), '');
  assert.equal(I.rotulo('', ''), '');
});

test('sobreposição: encostados não contam; contidos e cruzados contam', () => {
  assert.equal(I.sobrepoe('09:00', '10:00', '10:00', '11:00'), false);
  assert.equal(I.sobrepoe('09:00', '10:30', '10:00', '11:00'), true);
  assert.equal(I.sobrepoe('09:00', '12:00', '10:00', '11:00'), true);
  assert.equal(I.sobrepoe('10:00', '11:00', '09:00', '12:00'), true);
  assert.equal(I.sobrepoe('09:00', '10:00', '', '11:00'), false);
});

test('conflito: só com registos da mesma pessoa e dia que tenham intervalo; ignora o próprio', () => {
  const regs = [
    { id: 'a', pessoa: 'Ana', data: '2026-11-20', horaInicio: '10:00', horaFim: '12:00' },
    { id: 'b', pessoa: 'Ana', data: '2026-11-21', horaInicio: '10:00', horaFim: '12:00' },   // outro dia
    { id: 'c', pessoa: 'Rui', data: '2026-11-20', horaInicio: '10:00', horaFim: '12:00' },   // outra pessoa
    { id: 'd', pessoa: 'Ana', data: '2026-11-20', horaInicio: '', horaFim: '', horas: 3 },    // só horas, sem intervalo
  ];
  const q = { pessoa: 'Ana', data: '2026-11-20', ini: '11:00', fim: '13:00' };
  assert.equal(I.conflito(regs, q).id, 'a');
  assert.equal(I.conflito(regs, { ...q, ini: '12:00', fim: '13:00' }), null);
  assert.equal(I.conflito(regs, { ...q, ignorarId: 'a' }), null); // a editar o próprio registo
  assert.equal(I.conflito([], q), null);
});

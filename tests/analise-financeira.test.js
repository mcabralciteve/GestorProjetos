// Testes do modelo de reconhecimento de proveito (POC) — correr com:
// node --test tests/analise-financeira.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/analise-financeira.js');

test('mesesEntre e fimDoMes', () => {
  assert.deepEqual(F.mesesEntre('2026-07-15', '2026-09-05'), ['2026-07', '2026-08', '2026-09']);
  assert.equal(F.fimDoMes('2026-02'), '2026-02-28'); // 2026 não é bissexto
  assert.equal(F.fimDoMes('2024-02'), '2024-02-29'); // 2024 é bissexto
  assert.equal(F.fimDoMes('2026-04'), '2026-04-30');
});

test('sem horas vendidas -> projeto excluído (null)', () => {
  assert.equal(F.curvaProjeto({ valorVendido: 1000, horasVendidas: 0, horas: [], faturas: [], meses: ['2026-01'] }), null);
  assert.equal(F.curvaProjeto({ valorVendido: 1000, horas: [], faturas: [], meses: ['2026-01'] }), null);
});

test('reconhecido acompanha as horas reais, proporcional ao vendido, sem ultrapassar 100%', () => {
  const c = F.curvaProjeto({
    valorVendido: 10000, horasVendidas: 100,
    horas: [
      { data: '2026-01-10', equipaId: 'E1', valor: 20 },
      { data: '2026-02-10', equipaId: 'E1', valor: 30 },
      { data: '2026-03-10', equipaId: 'E1', valor: 80 } // total 130h > 100h vendidas -> capado a 100%
    ],
    faturas: [],
    meses: ['2026-01', '2026-02', '2026-03']
  });
  assert.equal(c.porMes['2026-01'].horasTotal, 20);
  assert.equal(c.porMes['2026-01'].reconhecido, 2000); // 20/100 * 10000
  assert.equal(c.porMes['2026-02'].horasTotal, 50);
  assert.equal(c.porMes['2026-02'].reconhecido, 5000);
  assert.equal(c.porMes['2026-03'].horasTotal, 130);
  assert.equal(c.porMes['2026-03'].reconhecido, 10000); // capado a 100% do valorVendido, não 13000
});

test('planeado e faturado só contam faturas até ao fim de cada mês', () => {
  const c = F.curvaProjeto({
    valorVendido: 10000, horasVendidas: 100,
    horas: [{ data: '2026-01-05', equipaId: 'E1', valor: 10 }],
    faturas: [
      { dataPrevista: '2026-01-15', valor: 3000, emitida: true, dataEmissao: '2026-01-20' },
      { dataPrevista: '2026-03-01', valor: 7000, emitida: false, dataEmissao: '' }
    ],
    meses: ['2026-01', '2026-02', '2026-03']
  });
  assert.equal(c.porMes['2026-01'].planeado, 3000);
  assert.equal(c.porMes['2026-01'].faturado, 3000);
  assert.equal(c.porMes['2026-02'].planeado, 3000);   // a 2ª fatura só está prevista para março
  assert.equal(c.porMes['2026-02'].faturado, 3000);
  assert.equal(c.porMes['2026-03'].planeado, 10000);  // já conta as duas
  assert.equal(c.porMes['2026-03'].faturado, 3000);   // a 2ª nunca foi emitida
});

test('repartição por equipa acompanha a quota de horas de cada uma, nas três curvas', () => {
  const c = F.curvaProjeto({
    valorVendido: 10000, horasVendidas: 100,
    horas: [
      { data: '2026-01-05', equipaId: 'E1', valor: 30 },
      { data: '2026-01-10', equipaId: 'E2', valor: 10 } // E1: 75%, E2: 25%
    ],
    faturas: [{ dataPrevista: '2026-01-01', valor: 4000, emitida: true, dataEmissao: '2026-01-01' }],
    meses: ['2026-01']
  });
  const m = c.porMes['2026-01'];
  assert.equal(m.horasTotal, 40);
  assert.equal(m.reconhecido, 4000); // 40/100 * 10000
  assert.ok(Math.abs(m.porEquipa.E1.reconhecido - 3000) < 1e-9); // 75% de 4000
  assert.ok(Math.abs(m.porEquipa.E2.reconhecido - 1000) < 1e-9); // 25% de 4000
  assert.ok(Math.abs(m.porEquipa.E1.planeado - 3000) < 1e-9);
  assert.ok(Math.abs(m.porEquipa.E2.faturado - 1000) < 1e-9);
  // nada se perde na repartição
  assert.ok(Math.abs((m.porEquipa.E1.reconhecido + m.porEquipa.E2.reconhecido) - m.reconhecido) < 1e-9);
});

test('sem nenhuma hora lançada mas já com fatura -> vai para a equipa própria do projeto', () => {
  const c = F.curvaProjeto({
    valorVendido: 10000, horasVendidas: 100, equipaIdProjeto: 'E9',
    horas: [],
    faturas: [{ dataPrevista: '2026-01-01', valor: 2000, emitida: false }],
    meses: ['2026-01']
  });
  const m = c.porMes['2026-01'];
  assert.equal(m.reconhecido, 0);
  assert.equal(m.planeado, 2000);
  assert.deepEqual(Object.keys(m.porEquipa), ['E9']);
  assert.equal(m.porEquipa.E9.planeado, 2000);
});

test('sem hora nem fatura nenhuma -> mês sem nenhuma equipa (nada para repartir)', () => {
  const c = F.curvaProjeto({ valorVendido: 10000, horasVendidas: 100, horas: [], faturas: [], meses: ['2026-01'] });
  assert.deepEqual(c.porMes['2026-01'].porEquipa, {});
});

test('horas sem equipaId (pessoa sem equipa) caem em SEM_EQUIPA, não se perdem', () => {
  const c = F.curvaProjeto({
    valorVendido: 10000, horasVendidas: 100,
    horas: [{ data: '2026-01-05', equipaId: null, valor: 10 }],
    faturas: [], meses: ['2026-01']
  });
  const m = c.porMes['2026-01'];
  assert.deepEqual(Object.keys(m.porEquipa), [F.SEM_EQUIPA]);
  assert.equal(m.porEquipa[F.SEM_EQUIPA].reconhecido, m.reconhecido);
});

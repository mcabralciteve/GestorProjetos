// Projeção de horas das oportunidades na Capacidade — correr com: node --test tests/capacidade-comercial.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/capacidade-comercial.js');

const MESES = ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'];
const ctx = (extra) => Object.assign({
  categoriaDe: op => op.cat || 'aberta', probabilidade: op => op.prob == null ? 0.5 : op.prob, valorDe: op => op.valor,
  defeitosDoTipo: () => ({ apos: 1, duracao: 4 }), temProjeto: op => !!op.projeto, equipasIds: null, valorHora: 50, meses: MESES, hojeISO: '2026-12-15'
}, extra);
const op = (id, extra) => Object.assign({ id, equipa_id: 'DCS', tipo_id: 't', valor: 20000, data_prevista_fecho: '2026-12-31' }, extra);

test('valor/hora médio: só consultores com preço de venda', () => {
  assert.deepEqual(C.valorHoraMedio([{ precoVenda: 60 }, { precoVenda: 40 }, { precoVenda: 0 }, {}, { precoVenda: null }]), { valor: 50, n: 2 });
  assert.deepEqual(C.valorHoraMedio([]), { valor: 0, n: 0 });
  assert.deepEqual(C.valorHoraMedio(null), { valor: 0, n: 0 });
});

test('horas = valor ÷ valor/hora × probabilidade, repartidas em partes iguais pela duração (início = N meses depois do fecho)', () => {
  // 20000 € ÷ 50 €/h = 400 h × 50% = 200 h; fecho dez/2026 + 1 mês = jan/2027; 4 meses → 50 h por mês (jan–abr)
  const r = C.projetar([op('a')], ctx());
  assert.deepEqual(MESES.map(m => r.porMes[m]), [50, 50, 50, 50, 0, 0]);
  assert.equal(r.total, 200);
  assert.equal(r.foraDoHorizonte, 0);
  assert.equal(r.linhas.length, 1);
  assert.deepEqual([r.linhas[0].horas, r.linhas[0].peso, r.linhas[0].inicio, r.linhas[0].duracao], [200, 0.5, '2027-01', 4]);
});

test('início e duração definidos na oportunidade mandam; o que cai fora do horizonte fica à parte', () => {
  const r = C.projetar([op('a', { inicio_previsto: '2027-05-01', duracao_meses: 4, prob: 1 })], ctx()); // 400 h em mai–ago; só mai–jun cabem
  assert.deepEqual(MESES.map(m => r.porMes[m]), [0, 0, 0, 0, 100, 100]);
  assert.equal(r.total, 400);
  assert.equal(r.foraDoHorizonte, 200);
});

test('um trabalho cujo início já passou conta só a partir do mês atual', () => {
  const r = C.projetar([op('a', { inicio_previsto: '2026-06-01', duracao_meses: 12, prob: 1 })], ctx({ hojeISO: '2026-12-15' }));
  // 400 h; fim em mai/2027; de dez/2026 a mai/2027 são 6 meses → 66,67 h/mês, e o horizonte cobre jan–mai/2027 (5 dos 6)
  assert.ok(Math.abs(r.porMes['2027-01'] - 400 / 6) < 1e-9);
  assert.ok(Math.abs(r.foraDoHorizonte - 400 / 6) < 1e-9); // o de dezembro/2026 fica antes do horizonte
});

test('só a(s) equipa(s) no ecrã; sem área responsável não entra (e conta à parte); sem filtro entram todas', () => {
  const ops = [op('dcs'), op('outra', { equipa_id: 'DAI' }), op('semArea', { equipa_id: null })];
  const dcs = C.projetar(ops, ctx({ equipasIds: new Set(['DCS']) }));
  assert.deepEqual(dcs.linhas.map(l => l.op.id), ['dcs']);
  assert.equal(dcs.semArea, 1);
  const duas = C.projetar(ops, ctx({ equipasIds: new Set(['DCS', 'DAI']) }));
  assert.deepEqual(duas.linhas.map(l => l.op.id), ['dcs', 'outra']);
  const todas = C.projetar(ops, ctx({ equipasIds: null }));
  assert.equal(todas.linhas.length, 3);
  assert.equal(todas.semArea, 0);
});

test('ficam de fora: perdidas, as que já são projeto, probabilidade zero e sem valor; ganhas sem projeto valem 100%', () => {
  const ops = [op('perdida', { cat: 'perdida' }), op('comProjeto', { projeto: 'p1' }), op('ganhaComProjeto', { cat: 'ganha', projeto: 'p1' }),
    op('zero', { prob: 0 }), op('semValor', { valor: 0 }), op('ganha', { cat: 'ganha', prob: 0.1 })];
  const r = C.projetar(ops, ctx());
  assert.deepEqual(r.linhas.map(l => l.op.id), ['ganha']);
  assert.equal(r.linhas[0].peso, 1);
  assert.equal(r.total, 400);
  assert.equal(r.semValor, 1);
});

test('incluir: só entram as oportunidades que cumprem o critério (ex.: Serviços), e as outras nem contam como "sem área"', () => {
  const ops = [op('serv'), op('id', { tipo_id: 'id' }), op('idSemArea', { tipo_id: 'id', equipa_id: null })];
  const r = C.projetar(ops, ctx({ incluir: o => o.tipo_id === 't', equipasIds: new Set(['DCS']) }));
  assert.deepEqual(r.linhas.map(l => l.op.id), ['serv']);
  assert.equal(r.semArea, 0);
});

test('sem valor/hora de referência não há projeção', () => {
  const r = C.projetar([op('a')], ctx({ valorHora: 0 }));
  assert.equal(r.total, 0);
  assert.equal(r.linhas.length, 0);
});

test('soma várias oportunidades mês a mês', () => {
  const r = C.projetar([op('a', { prob: 1 }), op('b', { prob: 1, inicio_previsto: '2027-03-01', duracao_meses: 2 })], ctx());
  // a: 400 h em jan–abr (100/mês); b: 400 h em mar–abr (200/mês)
  assert.deepEqual(MESES.map(m => r.porMes[m]), [100, 100, 300, 300, 0, 0]);
});

// Testes do cruzamento CRM <-> projetos (Fase 3) — correr com: node --test tests/crm-projetos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/crm-logica.js');

const etapaPorId = new Map([
  ['aberta', { id: 'aberta', categoria: 'aberta' }], ['ganha', { id: 'ganha', categoria: 'ganha' }], ['perdida', { id: 'perdida', categoria: 'perdida' }]
]);
const op = (id, extra) => Object.assign({ id, conta_id: 'c1', etapa_id: 'ganha', titulo: 'Op ' + id, projeto_id: null, data_fecho: '2026-09-01' }, extra);
const proj = (id, extra) => Object.assign({ id, idInterno: '2026/' + id, nome: 'P' + id, cliente: 'Têxtil do Ave, Lda.', dataInicio: '2026-01-01' }, extra);

test('ganhas sem projeto: só ganhas, sem projeto, mais recentes primeiro', () => {
  const ops = [op('a', { data_fecho: '2026-03-01' }), op('b', { data_fecho: '2026-08-01' }), op('c', { projeto_id: 'p1' }), op('d', { etapa_id: 'aberta' }), op('e', { etapa_id: 'perdida' })];
  assert.deepEqual(C.ganhasSemProjeto(ops, etapaPorId).map(o => o.id), ['b', 'a']);
});

test('projetos da conta: por oportunidade primeiro, depois pelo nome do cliente, sem repetir', () => {
  const conta = { id: 'c1', nome: 'Têxtil do Ave' };
  const projetos = [proj('1', { dataInicio: '2026-02-01' }), proj('2', { cliente: 'Têxtil do Ave Lda', dataInicio: '2026-05-01' }), proj('3', { cliente: 'Outro cliente' }), proj('4', { cliente: 'Outro', dataInicio: '2026-09-01' })];
  const ops = [op('a', { projeto_id: '4' }), op('b', { projeto_id: '4' }), op('c', { conta_id: 'c2', projeto_id: '3' }), op('d', { projeto_id: 'inexistente' })];
  const r = C.projetosDaConta(conta, ops, projetos);
  assert.deepEqual(r.map(x => [x.projeto.id, x.origem]), [['4', 'oportunidade'], ['2', 'cliente'], ['1', 'cliente']]);   // 3 é de outra conta; 4 só uma vez
  assert.equal(r[0].op.id, 'a');
});

test('sugerir projetos: referência GIAF e mesmo cliente primeiro; os ligados a outra oportunidade ficam de fora', () => {
  const conta = { id: 'c1', nome: 'Têxtil do Ave' };
  const o = op('x');
  const projetos = [proj('384', { cliente: 'Outro' }), proj('10'), proj('11', { cliente: 'Nada a ver' }), proj('12')];
  const propostas = [{ oportunidade_id: 'x', referencia_giaf: '2026/0384' }, { oportunidade_id: 'y', referencia_giaf: '2026/0011' }];
  const ops = [o, op('z', { projeto_id: '12' }), op('w', { projeto_id: '11' })];
  const s = C.sugerirProjetos(o, conta, propostas, ops, projetos);
  assert.deepEqual(s.sugeridos.map(x => [x.projeto.id, x.motivo]), [['384', 'mesma referência GIAF'], ['10', 'mesmo cliente']]);
  assert.deepEqual(s.outros.map(x => x.projeto.id), []);                                   // 11 e 12 estão ligados a outras oportunidades
  // a própria oportunidade já ligada a um projeto não o "ocupa" contra si mesma
  const proprio = C.sugerirProjetos(op('x', { projeto_id: '10' }), conta, propostas, [op('x', { projeto_id: '10' })], projetos);
  assert.ok(proprio.sugeridos.some(x => x.projeto.id === '10'));
});

test('totais: só contam os projetos que a pessoa pode ver em detalhe', () => {
  const t = C.totaisProjetos([
    { visivel: true, valorVendido: 10000, horasVendidas: 100, horasReais: 40.5, faturado: 4000 },
    { visivel: true, valorVendido: '5000', horasVendidas: 0, horasReais: 10, faturado: 5000 },
    { visivel: false }
  ]);
  assert.deepEqual(t, { n: 3, nVisiveis: 2, valorVendido: 15000, horasVendidas: 100, horasReais: 50.5, faturado: 9000 });
});

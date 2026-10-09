// Faturação sobre o orçamento validado — correr com: node --test tests/orcamento-faturacao.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/orcamento-logica.js');

const linha = (seccao, dados, descricao) => ({ id: 'l' + Math.random(), seccao, descricao: descricao || '', dados });
const orc = {
  id: 'O1', versao: 2, aluguer_saida: 45, custo_km: 0.16,
  areas: [{ id: 'a', nome: 'DCS', custos_especificos: 100, linhas: [
    linha('consultoria', { horas: 20, valor_hora: 70, custo_hora: 48 }),
    linha('formacao', { horas_sessao: 4, horas_prep: 16, valor_hora: 55, custo_hora: 40 }),
    linha('deslocacao', { saidas: 1, km: 100, horas: 2, valor_hora: 70, custo_hora: 48 }),
    linha('consumivel', { valor: 50 }),
    linha('produto', { quantidade: 1, preco_custo: 200, preco_venda: 300, desconto: 0 })
  ] }]
};

test('horas do orçamento: consultoria + (sessão + preparação) + horas de deslocação', () => {
  assert.equal(O.horasOrcamento(orc), 20 + 4 + 16 + 2);
});

test('base do orçamento: total, horas e valor por rubrica (as rubricas somam o total)', () => {
  const b = O.baseDoOrcamento(orc);
  assert.equal(b.orcamentoId, 'O1'); assert.equal(b.versao, 2); assert.equal(b.horas, 42);
  assert.deepEqual(b.rubricas.map(r => r.k), ['consultoria', 'formacao', 'deslocacoes', 'consumiveis', 'produtos']);
  assert.equal(b.total, O.arred(b.rubricas.reduce((s, r) => s + r.valor, 0)));
  assert.equal(b.total, O.propostaCliente(orc).total);
});

const rub = [{ k: 'consultoria', valor: 1000 }, { k: 'formacao', valor: 500 }, { k: 'produtos', valor: 300 }];

test('valor de uma fatura por rubricas: % da rubrica ou valor fixo, somados', () => {
  assert.equal(O.valorLinhaRubrica({ k: 'consultoria', tipo: 'percentagem', percentagem: 40 }, rub), 400);
  assert.equal(O.valorLinhaRubrica({ k: 'formacao', tipo: 'valor', valor: 123.456 }, rub), 123.46);
  assert.equal(O.valorLinhaRubrica({ k: 'inexistente', tipo: 'percentagem', percentagem: 50 }, rub), 0);
  assert.equal(O.valorRubricas([{ k: 'consultoria', tipo: 'percentagem', percentagem: 40 }, { k: 'produtos', tipo: 'percentagem', percentagem: 100 }, { k: 'formacao', tipo: 'valor', valor: 100 }], rub), 800);
  assert.equal(O.valorRubricas([], rub), 0); assert.equal(O.valorRubricas(undefined, rub), 0);
});

test('já previsto por rubrica: só faturas "por rubricas", sem a que se está a editar', () => {
  const faturas = [
    { id: 'f1', tipo: 'rubricas', rubricas: [{ k: 'consultoria', tipo: 'percentagem', percentagem: 30 }] },
    { id: 'f2', tipo: 'rubricas', rubricas: [{ k: 'consultoria', tipo: 'valor', valor: 200 }, { k: 'formacao', tipo: 'percentagem', percentagem: 50 }] },
    { id: 'f3', tipo: 'percentagem', percentagem: 50, rubricas: null },
    { id: 'f4', tipo: 'valor', valor: 999 }
  ];
  assert.deepEqual(O.planeadoPorRubrica(faturas, rub), { consultoria: 500, formacao: 250, produtos: 0 });
  assert.deepEqual(O.planeadoPorRubrica(faturas, rub, 'f2'), { consultoria: 300, formacao: 0, produtos: 0 });
});

test('excesso: avisa as rubricas em que as faturas (já previstas + esta) passam do orçamento', () => {
  const faturas = [{ id: 'f1', tipo: 'rubricas', rubricas: [{ k: 'consultoria', tipo: 'percentagem', percentagem: 80 }] }];
  const nesta = [{ k: 'consultoria', tipo: 'percentagem', percentagem: 30 }, { k: 'formacao', tipo: 'percentagem', percentagem: 100 }];
  assert.deepEqual(O.excessosRubricas(nesta, rub, faturas, 'nova').map(e => [e.k, e.excesso]), [['consultoria', 100]]);
  assert.deepEqual(O.excessosRubricas([{ k: 'consultoria', tipo: 'percentagem', percentagem: 20 }], rub, faturas, 'nova'), []);   // 80 + 20 = 100%: exato
  // ao editar a própria f1, ela não conta duas vezes
  assert.deepEqual(O.excessosRubricas([{ k: 'consultoria', tipo: 'percentagem', percentagem: 100 }], rub, faturas, 'f1'), []);
});

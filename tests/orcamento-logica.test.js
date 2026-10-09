// Testes das regras de cálculo da Orçamentação — correr com: node --test tests/orcamento-logica.test.js
// Os números de exemplo vêm da própria "Folha de Orçamentação — DTD" (ex.: formação 4h + 16h de preparação a 30 €/h = 150 €/h).
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/orcamento-logica.js');

const P = { aluguer_saida: 45, custo_km: 0.16 };
const linha = (seccao, dados, extra) => ({ id: 'x', seccao, ordem: 0, descricao: '', dados, ...extra });
const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('consultoria: horas × valor/hora; margem com o custo/hora', () => {
  const c = O.calcLinha(linha('consultoria', { horas: 20, valor_hora: 55, custo_hora: 40 }), P);
  assert.equal(c.valor, 1100); assert.equal(c.margem, 300);
});

test('formação com preparação: 4h de sessão + 16h de preparação a 30 € = 600 € e 150 €/h efetivos', () => {
  const c = O.calcLinha(linha('formacao', { horas_sessao: 4, horas_prep: 16, valor_hora: 30, custo_hora: 24 }), P);
  assert.equal(c.custoTotal, 600); assert.equal(c.vhEfetivo, 150); assert.equal(c.valor, 600);
  assert.equal(c.margem, (4 + 16) * (30 - 24));                       // a margem conta as horas de preparação também
  assert.equal(O.calcLinha(linha('formacao', { horas_sessao: 0, horas_prep: 5, valor_hora: 30 }), P).valor, 0);   // sem horas de sessão não há nada a faturar
});

test('deslocação: saídas × aluguer + km × custo/km + despesas reais; horas ao valor/hora do perfil', () => {
  const c = O.calcLinha(linha('deslocacao', { saidas: 2, km: 300, portagens: 20, refeicoes: 30, estadias: 80, outros: 10, horas: 2, valor_hora: 30, custo_hora: 20 }), P);
  assert.equal(c.despesas, 2 * 45 + 300 * 0.16 + 20 + 30 + 80 + 10);   // 90 + 48 + 140 = 278
  assert.equal(c.despesas, 278); assert.equal(c.valorHoras, 60); assert.equal(c.margemHoras, 20);
});

test('produtos: o desconto reduz o preço de venda final e a margem; margem nominal é a antes do desconto', () => {
  const c = O.calcLinha(linha('produto', { quantidade: 3, preco_custo: 100, preco_venda: 150, desconto: 10 }), P);
  perto(c.pvFinal, 135); perto(c.valor, 405); perto(c.custo, 300); perto(c.margem, 105);
  perto(c.margemPct, 105 / 405); perto(c.margemNominalPct, 50 / 150);
  assert.equal(O.calcLinha(linha('consumivel', { valor: '12,5' }), P).valor, 12.5);       // aceita vírgula decimal
});

const orcamento = (extra) => ({
  id: 'o1', proposta_id: 'p1', versao: 1, estado: 'rascunho', validade_dias: 30, aluguer_saida: 45, custo_km: 0.16,
  areas: [{
    id: 'a1', nome: 'DCS', custos_especificos: 100, linhas: [
      linha('consultoria', { horas: 20, valor_hora: 55, custo_hora: 40 }, { descricao: 'Diagnóstico' }),
      linha('formacao', { horas_sessao: 4, horas_prep: 16, valor_hora: 30, custo_hora: 24 }, { descricao: 'Formação em IA' }),
      linha('deslocacao', { saidas: 1, km: 100, horas: 2, valor_hora: 30, custo_hora: 20 }),
      linha('consumivel', { valor: 50 }),
      linha('produto', { quantidade: 1, preco_custo: 200, preco_venda: 300, desconto: 0 }, { descricao: 'Sensor X' })
    ]
  }], ...extra
});

test('área: preço final = horas vendáveis + produtos + deslocações + consumíveis + custos específicos (sem novo overhead)', () => {
  const a = O.calcArea(orcamento().areas[0], P);
  assert.equal(a.horasVendaveis, 1100 + 600 + 60);                      // consultoria + formação + horas de deslocação
  assert.equal(a.despesas, 45 + 16);                                    // 1 saída + 100 km
  assert.equal(a.precoFinal, 1760 + 300 + 61 + 50 + 100);               // 2271
  assert.equal(a.margem, 300 + 120 + 20 + 100);                         // horas (consultoria+formação+desloc.) + produtos
  perto(a.margemPct, 540 / (1760 + 300));
});

test('orçamento = soma das áreas', () => {
  const o = orcamento();
  o.areas.push({ id: 'a2', nome: 'ROB', custos_especificos: 0, linhas: [linha('consultoria', { horas: 10, valor_hora: 70, custo_hora: 50 })] });
  const c = O.calcOrcamento(o);
  assert.equal(c.total, 2271 + 700); assert.equal(c.areas.length, 2);
});

test('proposta cliente: custos específicos repartidos pelas rubricas; total = preço final; sem margem nem valores/hora', () => {
  const o = orcamento();
  const pc = O.propostaCliente(o);
  assert.equal(pc.total, 2271);
  // fator = 2271 / (1100 + 600 + (60+61) + 50 + 300) = 2271 / 2171
  const f = 2271 / 2171;
  assert.equal(pc.investimento.consultoria, O.arred(1100 * f)); assert.equal(pc.investimento.formacao, O.arred(600 * f));
  assert.equal(pc.investimento.deslocacoes, O.arred(121 * f)); assert.equal(pc.investimento.consumiveis, O.arred(50 * f)); assert.equal(pc.investimento.produtos, O.arred(300 * f));
  assert.deepEqual(pc.escopo.consultoria, ['Diagnóstico']); assert.deepEqual(pc.escopo.formacao, ['Formação em IA']); assert.deepEqual(pc.escopo.produtos, ['Sensor X']);
  assert.equal(JSON.stringify(pc).includes('margem'), false);
  assert.equal(JSON.stringify(pc).includes('valor_hora'), false);
});

test('proposta cliente: várias áreas somam; área só com custos específicos vai para consultoria', () => {
  const o = orcamento();
  o.areas.push({ id: 'a2', nome: 'Outros', custos_especificos: 80, linhas: [] });
  const pc = O.propostaCliente(o);
  assert.equal(pc.total, 2271 + 80);
  assert.deepEqual(pc.porArea.map(a => a.nome), ['DCS', 'Outros']);
});

test('consultor: o valor/hora (venda e custo) fica copiado para a linha', () => {
  const l = O.aplicarConsultor(linha('consultoria', O.dadosNovos('consultoria')), { id: 'R1', precoVenda: 55, precoCusto: 40 });
  assert.equal(l.recurso_id, 'R1'); assert.equal(l.dados.valor_hora, 55); assert.equal(l.dados.custo_hora, 40);
  const c = O.aplicarConsultor(linha('consumivel', { valor: 5 }), { id: 'R1', precoVenda: 55, precoCusto: 40 });
  assert.deepEqual(c.dados, { valor: 5 });                                  // secções sem horas não levam valor/hora
});

test('estados: só um validado por proposta; validado só o Admin anula; só o rascunho se edita', () => {
  assert.ok(O.podeTransitar('rascunho', 'enviado')); assert.ok(O.podeTransitar('enviado', 'validado'));
  assert.equal(O.podeTransitar('enviado', 'validado', { outroValidado: true }), false);
  assert.equal(O.podeTransitar('validado', 'enviado', { souAdmin: false }), false);
  assert.ok(O.podeTransitar('validado', 'enviado', { souAdmin: true }));
  assert.equal(O.podeTransitar('rejeitado', 'validado'), false);
  assert.ok(O.editavel({ estado: 'rascunho' })); assert.equal(O.editavel({ estado: 'enviado' }), false);
});

test('versões, verificação e duplicação', () => {
  assert.equal(O.proximaVersao([{ proposta_id: 'p1', versao: 1 }, { proposta_id: 'p1', versao: 3 }, { proposta_id: 'p2', versao: 9 }], 'p1'), 4);
  assert.equal(O.verificar({ areas: [] }).erros.length, 2);              // sem áreas e preço final 0
  assert.equal(O.verificar(orcamento()).erros.length, 0);
  const sem = orcamento(); sem.areas[0].linhas[0].dados.valor_hora = 0;
  assert.equal(O.verificar(sem).avisos.length, 1);
  let n = 0; const copia = O.duplicar(orcamento({ estado: 'validado' }), () => 'id' + (++n), 2);
  assert.equal(copia.estado, 'rascunho'); assert.equal(copia.versao, 2); assert.notEqual(copia.areas[0].id, 'a1');
  assert.equal(O.calcOrcamento(copia).total, 2271);
  copia.areas[0].linhas[0].dados.horas = 1;                                    // não altera o original
  assert.equal(O.calcOrcamento(orcamento()).total, 2271);
});

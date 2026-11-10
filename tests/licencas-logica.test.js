// Licenças (Ativos) — correr com: node --test tests/licencas-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/licencas-logica.js');

const lic = (extra) => L.normalizar(Object.assign(L.nova({ id: 'x', nome: 'Office', departamento_id: 'd1', valor: 120 }), extra));

test('valor anual: anual fica igual, mensal × 12, perpétua não se repete', () => {
  assert.equal(L.valorAnual(lic({ periodicidade: 'anual', valor: 1200 })), 1200);
  assert.equal(L.valorAnual(lic({ periodicidade: 'mensal', valor: 10 })), 120);
  assert.equal(L.valorAnual(lic({ tipo: 'perpetua', periodicidade: 'unica', valor: 500 })), 0);
  assert.equal(L.valorBase(lic({ tipo: 'perpetua', periodicidade: 'unica', valor: 500 })), 500);
});

test('financiado e líquido: base × taxa; a taxa fica entre 0 e 100', () => {
  const a = lic({ periodicidade: 'anual', valor: 1000, taxa_financiamento: 40 });
  assert.equal(L.valorFinanciado(a), 400);
  assert.equal(L.valorLiquido(a), 600);
  assert.equal(L.valorFinanciado(lic({ valor: 1000, taxa_financiamento: 150 })), 1000);
  assert.equal(L.valorFinanciado(lic({ valor: 1000, taxa_financiamento: -5 })), 0);
  assert.equal(L.valorFinanciado(lic({ periodicidade: 'mensal', valor: 33.33, taxa_financiamento: 50 })), 199.98);
});

test('somarMeses: fim de mês fica no último dia e passa o ano', () => {
  assert.equal(L.somarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(L.somarMeses('2024-01-31', 1), '2024-02-29');
  assert.equal(L.somarMeses('2026-11-15', 3), '2027-02-15');
  assert.equal(L.somarMeses('2026-03-31', 12), '2027-03-31');
  assert.equal(L.somarMeses('lixo', 1), null);
});

test('proximaRenovacao: automática avança sozinha; manual fica na data guardada', () => {
  assert.equal(L.proximaRenovacao(lic({ data_renovacao: '2025-03-10', periodicidade: 'anual', renovacao_automatica: true }), '2026-11-06'), '2027-03-10');
  assert.equal(L.proximaRenovacao(lic({ data_renovacao: '2026-09-31'.replace('31', '30'), periodicidade: 'mensal', renovacao_automatica: true }), '2026-11-06'), '2026-11-30');
  assert.equal(L.proximaRenovacao(lic({ data_renovacao: '2026-10-01', periodicidade: 'anual', renovacao_automatica: false }), '2026-11-06'), '2026-10-01');
  assert.equal(L.proximaRenovacao(lic({ data_renovacao: '2026-12-01', periodicidade: 'anual' }), '2026-11-06'), '2026-12-01');
  assert.equal(L.proximaRenovacao(lic({ data_renovacao: null }), '2026-11-06'), null);
  // dia 31 não se perde: a partir da data original, janeiro (31) → fevereiro (28) → março volta a 31
  assert.equal(L.proximaRenovacao(lic({ data_renovacao: '2026-01-31', periodicidade: 'mensal' }), '2026-03-01'), '2026-03-31');
});

test('situação da renovação: sem, atrasada, próxima, ok; cancelada não alerta', () => {
  const hoje = '2026-11-06';
  const m = (extra) => lic(Object.assign({ renovacao_automatica: false }, extra));
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: null }), hoje), 'sem');
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: '2026-11-01' }), hoje), 'atrasada');
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: '2026-11-06' }), hoje), 'proxima');
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: '2026-12-06' }), hoje), 'proxima');
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: '2026-12-07' }), hoje), 'ok');
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: '2026-12-07' }), hoje, 60), 'proxima');
  assert.equal(L.situacaoRenovacao(m({ data_renovacao: '2026-11-10', estado: 'cancelada' }), hoje), 'sem');
});

test('filtrar: departamento, projeto, renovação e texto (sem acentos)', () => {
  const hoje = '2026-11-06';
  const a = lic({ id: 'a', nome: 'Adobe Ação', departamento_id: 'd1', projeto_id: 'p1', data_renovacao: '2026-11-20', renovacao_automatica: false });
  const b = lic({ id: 'b', nome: 'Matlab', departamento_id: 'd2', data_renovacao: '2026-10-01', renovacao_automatica: false });
  const c = lic({ id: 'c', nome: 'Zoom', departamento_id: 'd1', data_renovacao: '2027-06-01', renovacao_automatica: false });
  const todas = [a, b, c], ctx = { hoje };
  assert.deepEqual(L.filtrar(todas, { departamento: 'd1' }, ctx).map(x => x.id), ['a', 'c']);
  assert.deepEqual(L.filtrar(todas, { projeto: 'p1' }, ctx).map(x => x.id), ['a']);
  assert.deepEqual(L.filtrar(todas, { projeto: '_sem' }, ctx).map(x => x.id), ['b', 'c']);
  assert.deepEqual(L.filtrar(todas, { renovacao: 'atrasadas' }, ctx).map(x => x.id), ['b']);
  assert.deepEqual(L.filtrar(todas, { renovacao: '30' }, ctx).map(x => x.id), ['a']);
  assert.deepEqual(L.filtrar(todas, { texto: 'acao' }, ctx).map(x => x.id), ['a']);
  assert.deepEqual(L.filtrar(todas, { texto: 'joao' }, { hoje, nomeResponsavel: l => l.id === 'c' ? 'João' : '' }).map(x => x.id), ['c']);
});

test('ordenar: renovação mais próxima primeiro, sem data no fim', () => {
  const hoje = '2026-11-06';
  const a = lic({ id: 'a', nome: 'A', data_renovacao: '2026-12-01', renovacao_automatica: false });
  const b = lic({ id: 'b', nome: 'B', data_renovacao: '2026-10-01', renovacao_automatica: false });
  const c = lic({ id: 'c', nome: 'C', data_renovacao: null });
  assert.deepEqual(L.ordenar([c, a, b], hoje).map(x => x.id), ['b', 'a', 'c']);
});

test('resumo: só as ativas contam; renovações por janela com o valor de um período', () => {
  const hoje = '2026-11-06';
  const l1 = lic({ id: '1', periodicidade: 'mensal', valor: 100, taxa_financiamento: 50, data_renovacao: '2026-11-20', renovacao_automatica: false });
  const l2 = lic({ id: '2', periodicidade: 'anual', valor: 1000, taxa_financiamento: 0, data_renovacao: '2027-01-15', renovacao_automatica: false });
  const l3 = lic({ id: '3', tipo: 'perpetua', periodicidade: 'unica', valor: 800, taxa_financiamento: 25 });
  const l4 = lic({ id: '4', periodicidade: 'anual', valor: 9999, estado: 'cancelada', data_renovacao: '2026-11-10', renovacao_automatica: false });
  const l5 = lic({ id: '5', periodicidade: 'anual', valor: 300, data_renovacao: '2026-10-01', renovacao_automatica: false });
  const r = L.resumo([l1, l2, l3, l4, l5], hoje);
  assert.equal(r.n, 4);
  assert.equal(r.anual, 1200 + 1000 + 300);
  assert.equal(r.aquisicoes, 800);
  assert.equal(r.financiado, 600 + 0 + 200 + 0);
  assert.equal(r.liquido, r.anual + r.aquisicoes - r.financiado);
  assert.deepEqual(r.atrasadas, { n: 1, valor: 300 });
  assert.deepEqual(r.ate30, { n: 1, valor: 100 });
  assert.deepEqual(r.ate60, { n: 1, valor: 100 });
  assert.deepEqual(r.ate90, { n: 2, valor: 1100 });
});

test('agrupar por departamento e por projeto (ativas; projeto só em texto agrupa pelo texto)', () => {
  const a = lic({ id: 'a', departamento_id: 'd1', projeto_id: 'p1', valor: 100, taxa_financiamento: 50 });
  const b = lic({ id: 'b', departamento_id: 'd1', projeto_id: null, projeto_nome: 'Projeto Externo', valor: 300 });
  const c = lic({ id: 'c', departamento_id: 'd2', valor: 200 });
  const d = lic({ id: 'd', departamento_id: 'd2', valor: 999, estado: 'expirada' });
  const dep = L.agrupar([a, b, c, d], 'departamento', id => 'Dep ' + id);
  assert.deepEqual(dep.map(g => [g.nome, g.n, g.base]), [['Dep d1', 2, 400], ['Dep d2', 1, 200]]);
  const proj = L.agrupar([a, b, c, d], 'projeto', id => 'Proj ' + id);
  assert.deepEqual(proj.map(g => [g.nome, g.base]), [['Projeto Externo', 300], ['(sem projeto)', 200], ['Proj p1', 100]]);
  assert.equal(proj.find(g => g.nome === 'Proj p1').financiado, 50);
});

test('validar: obrigatórios, taxa, coerência tipo/periodicidade, datas e ligação', () => {
  assert.deepEqual(L.validar(lic({ ligacao: 'https://citeve.sharepoint.com/x' })), []);
  assert.ok(L.validar(lic({ nome: '  ' })).length);
  assert.ok(L.validar(lic({ departamento_id: null })).length);
  assert.ok(L.validar(lic({ taxa_financiamento: 101 })).length);
  assert.ok(L.validar(lic({ tipo: 'perpetua', periodicidade: 'anual' })).length);
  assert.ok(L.validar(lic({ tipo: 'subscricao', periodicidade: 'unica' })).length);
  assert.ok(L.validar(lic({ data_inicio: '2026-05-01', data_renovacao: '2026-04-01' })).length);
  assert.ok(L.validar(lic({ ligacao: 'javascript:alert(1)' })).length);
  assert.ok(L.validar(Object.assign(lic(), { valor: '' })).length);   // campo do formulário em branco (sem normalizar)
});

test('formatação de data e de euros', () => {
  assert.equal(L.formatarData('2026-11-06'), '06/11/2026');
  assert.equal(L.formatarData(null), '—');
  assert.match(L.eur(1234.5), /1\s?234,50\s?€/);
  assert.equal(L.nomeFicheiroExcel('2026-11-06'), 'Licencas_20261106.xlsx');
});

// ---------- Ciclo: por aprovar → em processo de aquisição → ativa ----------
test('estados: por aprovar e em aquisição não contam para os custos mas aparecem como previsão, por esta ordem na lista', () => {
  const a = lic({ id: 'a', valor: 100 });
  const p1 = lic({ id: 'p1', estado: 'por_aprovar', periodicidade: 'mensal', valor: 18, taxa_financiamento: 50 });
  const p2 = lic({ id: 'p2', estado: 'em_aquisicao', periodicidade: 'anual', valor: 155.21, taxa_financiamento: 85 });
  const r = L.resumo([a, p1, p2], '2026-11-09');
  assert.equal(r.n, 1);
  assert.equal(r.anual, 100);                      // as previstas não entram
  assert.equal(r.previsto.n, 2);
  assert.equal(r.previsto.base, 371.21);           // 18×12 + 155,21
  assert.equal(r.previsto.financiado, 239.93);     // 108 + 131,93 (155,21×85% arredondado por licença)
  assert.deepEqual([r.porAprovar.n, r.porAprovar.base, r.emAquisicao.n, r.emAquisicao.base], [1, 216, 1, 155.21]);
  assert.deepEqual(L.ordenar([a, p2, p1], '2026-11-09').map(x => x.id), ['p1', 'p2', 'a']);
  assert.equal(L.diasParaRenovacao(Object.assign({}, p1, { data_renovacao: '2026-12-01' }), '2026-11-09'), null); // sem alertas de renovação
});

test('filtrar por estado: "abertas" = ativas + por aprovar + em aquisição; os outros filtram um só', () => {
  const todas = ['ativa', 'por_aprovar', 'em_aquisicao', 'recusada', 'cancelada', 'expirada'].map(e => lic({ id: e, estado: e }));
  assert.deepEqual(L.filtrar(todas, { estado: 'abertas' }, {}).map(x => x.id), ['ativa', 'por_aprovar', 'em_aquisicao']);
  assert.deepEqual(L.filtrar(todas, { estado: 'recusada' }, {}).map(x => x.id), ['recusada']);
  assert.equal(L.filtrar(todas, { estado: '' }, {}).length, 6);
  assert.deepEqual(L.paraAprovar(todas).map(x => x.id), ['por_aprovar']);     // só estas vão para o sino do Diretor
  assert.deepEqual(L.paraAdquirir(todas).map(x => x.id), ['em_aquisicao']);
});

test('agrupar: por aprovar e em aquisição somam à parte (nPend/basePend) sem tocar nos totais das ativas', () => {
  const a = lic({ id: 'a', departamento_id: 'd1', valor: 100 });
  const p = lic({ id: 'p', departamento_id: 'd1', valor: 50, estado: 'por_aprovar' });
  const q = lic({ id: 'q', departamento_id: 'd2', valor: 70, estado: 'em_aquisicao' });
  const g = L.agrupar([a, p, q], 'departamento', id => id);
  assert.deepEqual(g.map(x => [x.nome, x.n, x.base, x.nPend, x.basePend]), [['d1', 1, 100, 1, 50], ['d2', 0, 0, 1, 70]]);
});

test('aprovar: só passa a "em aquisição" e regista a decisão; ainda não mexe em datas nem em custos', () => {
  assert.deepEqual(L.patchAprovar('Ana', 'T'), { estado: 'em_aquisicao', decisao_por_nome: 'Ana', decisao_em: 'T', motivo_decisao: '' });
});

test('adquirir: passa a ativa, início hoje e primeira renovação um período depois; mantém datas já preenchidas', () => {
  const m = lic({ estado: 'em_aquisicao', periodicidade: 'mensal', valor: 18 });
  assert.deepEqual(L.patchAdquirir(m, '2026-11-09'), { estado: 'ativa', data_inicio: '2026-11-09', data_renovacao: '2026-12-09' });
  const an = lic({ estado: 'em_aquisicao', periodicidade: 'anual' });
  assert.equal(L.patchAdquirir(an, '2026-11-30').data_renovacao, '2027-11-30');
  const jaTem = lic({ estado: 'em_aquisicao', data_inicio: '2026-12-01', data_renovacao: '2027-12-01' });
  const p = L.patchAdquirir(jaTem, '2026-11-09');
  assert.equal(p.data_inicio, '2026-12-01'); assert.equal(p.data_renovacao, '2027-12-01');
  const perp = lic({ estado: 'em_aquisicao', tipo: 'perpetua', periodicidade: 'unica', valor: 500 });
  assert.equal(L.patchAdquirir(perp, '2026-11-09').data_renovacao, null);   // perpétua: sem renovação inventada
});

test('recusar: guarda o motivo sem espaços; linha de pedido para o email', () => {
  assert.deepEqual(L.patchRecusar('  Sem orçamento ', 'Ana', 'T'), { estado: 'recusada', decisao_por_nome: 'Ana', decisao_em: 'T', motivo_decisao: 'Sem orçamento' });
  const l = lic({ nome: 'Claude Team', periodicidade: 'mensal', valor: 18, taxa_financiamento: 50 });
  const txt = L.linhaPedido(l, 'Milton Cabral', 'DIH 2.0');
  assert.match(txt, /^• Claude Team — Milton Cabral — 18,00\s?€ \/ mês \(216,00\s?€\/ano\) — financiada a 50% — DIH 2\.0$/);
  assert.match(L.linhaPedido(lic({ n_licencas: 6, periodicidade: 'anual', valor: 408 }), '', ''), /^• Office \(6 lic\.\) — sem responsável — 408,00\s?€ \/ ano$/);
});

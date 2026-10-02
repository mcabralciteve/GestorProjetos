// Testes das regras do CRM — correr com: node --test tests/crm-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/crm-logica.js');

const etapas = [
  { id: 'e1', tipo_id: 'T1', nome: 'Lead', probabilidade: 10, categoria: 'aberta', ordem: 0, ativo: true },
  { id: 'e2', tipo_id: 'T1', nome: 'Proposta', probabilidade: 50, categoria: 'aberta', ordem: 1, ativo: true },
  { id: 'e3', tipo_id: 'T1', nome: 'Ganha', probabilidade: 100, categoria: 'ganha', ordem: 2, ativo: true },
  { id: 'e4', tipo_id: 'T1', nome: 'Perdida', probabilidade: 0, categoria: 'perdida', ordem: 3, ativo: true },
  { id: 'e5', tipo_id: 'T1', nome: 'Antiga', probabilidade: 30, categoria: 'aberta', ordem: 4, ativo: false },
  { id: 'x1', tipo_id: 'T2', nome: 'Outra', probabilidade: 20, categoria: 'aberta', ordem: 0, ativo: true }
];
const porId = C.indexarPorId(etapas);
const op = (id, etapa, valor, extra) => Object.assign({ id, tipo_id: 'T1', etapa_id: etapa, valor_estimado: valor }, extra || {});

test('etapas do tipo: só ativas, por ordem; inclui inativas se pedido', () => {
  assert.deepEqual(C.etapasDoTipo(etapas, 'T1').map(e => e.id), ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual(C.etapasDoTipo(etapas, 'T1', false).map(e => e.id), ['e1', 'e2', 'e3', 'e4', 'e5']);
  assert.deepEqual(C.etapasDoTipo(etapas, 'T2').map(e => e.id), ['x1']);
});

test('valor ponderado: aberta usa a probabilidade da etapa, ganha vale tudo, perdida zero', () => {
  assert.equal(C.valorPonderado(op('a', 'e2', 10000), porId), 5000);
  assert.equal(C.valorPonderado(op('b', 'e1', 10000), porId), 1000);
  assert.equal(C.valorPonderado(op('c', 'e3', 10000), porId), 10000);
  assert.equal(C.valorPonderado(op('d', 'e4', 10000), porId), 0);
  // a categoria manda, mesmo que alguém configure uma probabilidade absurda numa etapa ganha/perdida
  const estranhas = C.indexarPorId([{ id: 'g', categoria: 'ganha', probabilidade: 5 }, { id: 'p', categoria: 'perdida', probabilidade: 90 }]);
  assert.equal(C.probabilidadeDe({ etapa_id: 'g' }, estranhas), 100);
  assert.equal(C.probabilidadeDe({ etapa_id: 'p' }, estranhas), 0);
  // probabilidade fora de 0-100 é limitada
  const fora = C.indexarPorId([{ id: 'f', categoria: 'aberta', probabilidade: 250 }]);
  assert.equal(C.probabilidadeDe({ etapa_id: 'f' }, fora), 100);
  assert.equal(C.valorPonderado({ etapa_id: 'inexistente', valor_estimado: 100 }, porId), 0);
});

test('resumo do funil e taxa de conversão', () => {
  const ops = [op('1', 'e1', 1000), op('2', 'e2', 2000), op('3', 'e3', 4000), op('4', 'e4', 500), op('5', 'e3', 1000)];
  const r = C.resumoFunil(ops, porId);
  assert.deepEqual(r.abertas, { n: 2, valor: 3000, ponderado: 100 + 1000 });
  assert.deepEqual(r.ganhas, { n: 2, valor: 5000 });
  assert.deepEqual(r.perdidas, { n: 1, valor: 500 });
  assert.equal(C.taxaConversao(ops, porId), 2 / 3);
  assert.equal(C.taxaConversao([op('9', 'e1', 1)], porId), null);
});

test('agrupar por etapa: colunas vazias existem, oportunidades de outras etapas ficam de fora', () => {
  const g = C.agruparPorEtapa([op('1', 'e1', 1), op('2', 'e1', 1), op('3', 'e3', 1), op('4', 'x1', 1)], C.etapasDoTipo(etapas, 'T1'));
  assert.deepEqual([...g.keys()], ['e1', 'e2', 'e3', 'e4']);
  assert.equal(g.get('e1').length, 2);
  assert.equal(g.get('e2').length, 0);
  assert.equal(g.get('e3').length, 1);
});

test('mudança de etapa: mesmo tipo, perdida exige motivo válido', () => {
  const o = op('1', 'e1', 100);
  assert.equal(C.validarMudancaEtapa(o, porId.get('e2'), null).ok, true);
  assert.equal(C.validarMudancaEtapa(o, porId.get('x1'), null).ok, false);               // outro tipo
  assert.equal(C.validarMudancaEtapa(o, porId.get('e4'), null).ok, false);               // perdida sem motivo
  assert.equal(C.validarMudancaEtapa(o, porId.get('e4'), 'm1', ['m1', 'm2']).ok, true);
  assert.equal(C.validarMudancaEtapa(o, porId.get('e4'), 'mX', ['m1', 'm2']).ok, false); // motivo de outro tipo
  assert.equal(C.validarMudancaEtapa(o, null, null).ok, false);
});

test('tarefas de follow-up: estados e agrupamento', () => {
  const hoje = '2026-10-05';
  const t = (id, limite, concluida, resp) => ({ id, data_limite: limite, concluida: !!concluida, responsavel_id: resp });
  const lista = [t('a', '2026-10-01'), t('b', '2026-10-05'), t('c', '2026-10-09'), t('d', null), t('e', '2026-09-01', true), t('f', '2026-10-02', false, 'R2')];
  assert.equal(C.estadoTarefa(lista[0], hoje), 'atrasada');
  assert.equal(C.estadoTarefa(lista[1], hoje), 'hoje');
  assert.equal(C.estadoTarefa(lista[2], hoje), 'proxima');
  assert.equal(C.estadoTarefa(lista[3], hoje), 'sem-data');
  assert.equal(C.estadoTarefa(lista[4], hoje), 'concluida'); // concluída nunca é atrasada
  const g = C.agruparTarefas(lista, hoje);
  assert.deepEqual(g.atrasada.map(x => x.id), ['a', 'f']); // por data limite
  assert.equal(C.contarAtrasadas(lista, hoje), 2);
  assert.equal(C.contarAtrasadas(lista, hoje, 'R2'), 1);
});

test('duplicados de conta: por NIF (só dígitos) ou por nome normalizado', () => {
  const contas = [
    { id: '1', nome: 'Têxtil do Ave, Lda.', nif: '500 123 456' },
    { id: '2', nome: 'Outra Empresa SA', nif: '' }
  ];
  assert.equal(C.duplicadoConta(contas, { nome: 'Qualquer', nif: '500123456' }).id, '1');
  assert.equal(C.duplicadoConta(contas, { nome: 'textil do ave', nif: '' }).id, '1');
  assert.equal(C.duplicadoConta(contas, { nome: 'OUTRA EMPRESA S.A.', nif: '' }).id, '2');
  assert.equal(C.duplicadoConta(contas, { nome: 'Totalmente nova', nif: '999999999' }), null);
  assert.equal(C.duplicadoConta(contas, { nome: 'Têxtil do Ave Lda', nif: '' }, '1'), null); // ignora a própria
  assert.equal(C.duplicadoConta(contas, { nome: '', nif: '' }), null);                       // vazio nunca bate
});

test('propostas: versão seguinte, validações e proposta vigente', () => {
  const ps = [
    { id: 'p1', oportunidade_id: 'o1', versao: 1, estado: 'rejeitada' },
    { id: 'p2', oportunidade_id: 'o1', versao: 2, estado: 'enviada' },
    { id: 'p3', oportunidade_id: 'o2', versao: 1, estado: 'aceite' }
  ];
  assert.equal(C.proximaVersao(ps, 'o1'), 3);
  assert.equal(C.proximaVersao(ps, 'novo'), 1);
  assert.equal(C.propostaVigente(ps, 'o1').id, 'p2');   // sem aceite -> a de versão mais alta
  assert.equal(C.propostaVigente(ps, 'o2').id, 'p3');
  assert.equal(C.propostaVigente(ps, 'nada'), null);
  assert.deepEqual(C.validarProposta({ valor: 100, versao: 1, estado: 'rascunho' }), []);
  assert.equal(C.validarProposta({ valor: -1, versao: 1 }).length, 1);
  assert.equal(C.validarProposta({ valor: 1, versao: 0 }).length, 1);
  assert.equal(C.validarProposta({ valor: 1, versao: 1, data_envio: '2026-10-10', data_validade: '2026-10-01' }).length, 1);
  assert.equal(C.validarProposta({ valor: 1, versao: 1, estado: 'enviada' }).length, 1);
});

test('caminho do documento: ligação abre-se, caminho de rede só se mostra', () => {
  assert.deepEqual(C.tipoCaminho('https://citeve.sharepoint.com/x'), { tipo: 'url', texto: 'https://citeve.sharepoint.com/x', href: 'https://citeve.sharepoint.com/x' });
  assert.equal(C.tipoCaminho('\\\\servidor\\propostas\\2026').tipo, 'caminho');
  assert.equal(C.tipoCaminho('C:\\Users\\x\\OneDrive\\p.docx').tipo, 'caminho');
  assert.equal(C.tipoCaminho('javascript:alert(1)').tipo, 'caminho'); // nunca vira href
  assert.equal(C.tipoCaminho('  ').tipo, 'vazio');
});

test('formatação', () => {
  assert.equal(C.data('2026-10-05'), '05/10/2026');
  assert.equal(C.data(null), '—');
  assert.match(C.euro(1234.5), /1\s?235\s?€|1\s?234\s?€|1\.235|1235/);
});

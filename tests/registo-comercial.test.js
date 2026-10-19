// Registo comercial (cliente + oportunidade) — correr com: node --test tests/registo-comercial.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/registo-comercial.js');

const contas = [{ id: 'c2', nome: 'Zeta, Lda.' }, { id: 'c1', nome: 'Alfa SA' }];
const etapas = new Map([['e1', { categoria: 'aberta' }], ['e2', { categoria: 'ganha' }], ['e3', { categoria: 'perdida' }]]);
const ops = [
  { id: 'o1', conta_id: 'c1', titulo: 'Projeto B', etapa_id: 'e1' }, { id: 'o2', conta_id: 'c1', titulo: 'Auditoria', etapa_id: 'e1' },
  { id: 'o3', conta_id: 'c1', titulo: 'Ganha já', etapa_id: 'e2' }, { id: 'o4', conta_id: 'c1', titulo: 'Perdida', etapa_id: 'e3' },
  { id: 'o5', conta_id: 'c2', titulo: 'Outra conta', etapa_id: 'e1' }, { id: 'o6', conta_id: 'c1', titulo: 'Sem etapa conhecida', etapa_id: 'xx' }
];

test('contas por nome; oportunidades só as abertas da conta (etapa desconhecida conta como aberta)', () => {
  assert.deepEqual(R.contasOrdenadas(contas).map(c => c.nome), ['Alfa SA', 'Zeta, Lda.']);
  assert.deepEqual(R.oportunidadesAbertas('c1', ops, etapas).map(o => o.titulo), ['Auditoria', 'Projeto B', 'Sem etapa conhecida']);
  assert.deepEqual(R.oportunidadesAbertas('c2', ops, etapas).map(o => o.id), ['o5']);
  assert.deepEqual(R.oportunidadesAbertas('zz', ops, etapas), []);
});

test('resolver: sem associação, cliente do CRM, oportunidade do CRM, texto livre', () => {
  const vazio = { crmContaId: null, crmOportunidadeId: null, cliente: '', oportunidadeTexto: '' };
  assert.deepEqual(R.resolver({ conta: '' }, contas, ops), vazio);
  assert.deepEqual(R.resolver({ conta: 'c1', op: '' }, contas, ops), { crmContaId: 'c1', crmOportunidadeId: null, cliente: 'Alfa SA', oportunidadeTexto: '' });
  assert.deepEqual(R.resolver({ conta: 'c1', op: 'o2' }, contas, ops), { crmContaId: 'c1', crmOportunidadeId: 'o2', cliente: 'Alfa SA', oportunidadeTexto: 'Auditoria' });
  assert.deepEqual(R.resolver({ conta: 'c1', op: R.OUTRA, opTxt: '  Nova ideia ' }, contas, ops), { crmContaId: 'c1', crmOportunidadeId: null, cliente: 'Alfa SA', oportunidadeTexto: 'Nova ideia' });
  assert.deepEqual(R.resolver({ conta: R.OUTRO, clienteTxt: ' Cliente Novo ', opTxt: 'Feira' }, contas, ops), { crmContaId: null, crmOportunidadeId: null, cliente: 'Cliente Novo', oportunidadeTexto: 'Feira' });
  // uma oportunidade de OUTRA conta nunca é aceite, nem uma conta que já não existe
  assert.equal(R.resolver({ conta: 'c1', op: 'o5' }, contas, ops).crmOportunidadeId, null);
  assert.deepEqual(R.resolver({ conta: 'apagada' }, contas, ops), vazio);
});

test('estado inicial ao editar: oportunidade, só cliente, ou texto livre', () => {
  assert.deepEqual(R.estadoInicial({}, contas, ops), { conta: '', op: '', clienteTxt: '', opTxt: '' });
  assert.deepEqual(R.estadoInicial({ crmOportunidadeId: 'o2' }, contas, ops), { conta: 'c1', op: 'o2', clienteTxt: '', opTxt: '' });
  assert.deepEqual(R.estadoInicial({ crmContaId: 'c2' }, contas, ops), { conta: 'c2', op: '', clienteTxt: '', opTxt: '' });
  assert.deepEqual(R.estadoInicial({ crmContaId: 'c2', oportunidadeTexto: 'Ideia' }, contas, ops), { conta: 'c2', op: R.OUTRA, clienteTxt: '', opTxt: 'Ideia' });
  // ligações que já não existem (oportunidade apagada) → cai para o texto guardado no registo
  assert.deepEqual(R.estadoInicial({ crmOportunidadeId: 'apagada', cliente: 'Alfa SA', oportunidadeTexto: 'Auditoria' }, contas, ops),
    { conta: R.OUTRO, op: '', clienteTxt: 'Alfa SA', opTxt: 'Auditoria' });
});

test('sem acesso ao CRM: texto livre; se nada mudou, mantém as ligações já existentes', () => {
  const ini = { crmContaId: 'c1', crmOportunidadeId: 'o2', cliente: 'Alfa SA', oportunidadeTexto: 'Auditoria' };
  assert.deepEqual(R.resolverTexto('Alfa SA', 'Auditoria', ini), ini);
  assert.deepEqual(R.resolverTexto('Alfa SA', 'Outra coisa', ini), { crmContaId: null, crmOportunidadeId: null, cliente: 'Alfa SA', oportunidadeTexto: 'Outra coisa' });
  assert.deepEqual(R.resolverTexto('  ', '', {}), { crmContaId: null, crmOportunidadeId: null, cliente: '', oportunidadeTexto: '' });
});

test('rótulo e horas associadas a uma oportunidade / conta', () => {
  assert.equal(R.rotulo({ cliente: 'Alfa', oportunidadeTexto: 'Auditoria' }), 'Alfa — Auditoria');
  assert.equal(R.rotulo({ cliente: 'Alfa' }), 'Alfa'); assert.equal(R.rotulo({}), '');
  const regs = [{ pessoa: 'Ana', horas: 3, crmOportunidadeId: 'o2', crmContaId: 'c1' }, { pessoa: 'Bruno', horas: '1.5', crmOportunidadeId: 'o2', crmContaId: 'c1' },
    { pessoa: 'Ana', horas: 2, crmOportunidadeId: null, crmContaId: 'c1' }, { pessoa: 'Cris', horas: 9, crmOportunidadeId: 'o5', crmContaId: 'c2' }];
  assert.deepEqual(R.horasAssociadas(regs, { oportunidadeId: 'o2' }), { horas: 4.5, pessoas: [{ pessoa: 'Ana', horas: 3 }, { pessoa: 'Bruno', horas: 1.5 }] });
  assert.equal(R.horasAssociadas(regs, { contaId: 'c1' }).horas, 6.5);          // a conta inclui os registos só com o cliente
  assert.equal(R.horasAssociadas(regs, {}).horas, 0);
});

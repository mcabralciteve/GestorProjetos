// Referência GIAF herdada pela proposta — correr com: node --test tests/crm-referencia.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/crm-logica.js');

test('a proposta herda a referência GIAF da oportunidade e acrescenta o nº sequencial (2 dígitos)', () => {
  assert.equal(C.referenciaProposta('2026/829', 1), '2026/829-01');
  assert.equal(C.referenciaProposta('2026/0829', 2), '2026/829-02');            // zeros à esquerda normalizados
  assert.equal(C.referenciaProposta('2026/829', 12), '2026/829-12');
  assert.equal(C.referenciaProposta('2026/829', 0), '2026/829-01');             // nunca 00
  assert.equal(C.referenciaProposta('', 1), '');                                 // sem referência: preenche-se à mão
  assert.equal(C.referenciaProposta('texto livre', 1), '');
});

test('referência-base: tira o nº sequencial e os zeros; formatos inválidos dão vazio', () => {
  assert.equal(C.baseRefProposta('2026/829-01'), '2026/829');
  assert.equal(C.baseRefProposta(' 2026 / 0829 - 03 '), '2026/829');
  assert.equal(C.baseRefProposta('2026/829'), '2026/829');
  assert.equal(C.baseRefProposta('2026/0000'), '');
  assert.equal(C.baseRefProposta('P2026/045'), '');
  assert.equal(C.baseRefProposta(null), '');
});

test('oportunidade: usa a sua referência; senão a do projeto ligado (só do tipo GIAF)', () => {
  assert.equal(C.refGiafDaOportunidade({ referencia_giaf: '2026/829' }, null), '2026/829');
  assert.equal(C.refGiafDaOportunidade({ referencia_giaf: '' }, { idInterno: '2026/384', tipoReferencia: 'giaf' }), '2026/384');
  assert.equal(C.refGiafDaOportunidade({ referencia_giaf: '' }, { idInterno: 'INT-2026-001', tipoReferencia: 'interno' }), '');
  assert.equal(C.refGiafDaOportunidade({}, undefined), '');
  assert.equal(C.refGiafDaOportunidade({ referencia_giaf: '2026/1' }, { idInterno: '2026/384', tipoReferencia: 'giaf' }), '2026/1');
});

test('sugerir projetos: a referência da proposta (com sufixo) e da oportunidade casam com o ID do projeto', () => {
  const op = { id: 'x', referencia_giaf: '2026/384' };
  const projetos = [{ id: 'P1', idInterno: '2026/384', cliente: 'Outro' }, { id: 'P2', idInterno: '2026/10', cliente: 'Alfa' }];
  const s = C.sugerirProjetos(op, { nome: 'Beta' }, [], [op], projetos);
  assert.deepEqual(s.sugeridos.map(x => [x.projeto.id, x.motivo]), [['P1', 'mesma referência GIAF']]);
  const porProposta = C.sugerirProjetos({ id: 'y' }, { nome: 'Beta' }, [{ oportunidade_id: 'y', referencia_giaf: '2026/10-02' }], [], projetos);
  assert.deepEqual(porProposta.sugeridos.map(x => x.projeto.id), ['P2']);
});

// ---------- importação ----------
const tipos = [{ id: 'T2', nome: 'Serviços', ativo: true }];
const etapas = [{ id: 's1', tipo_id: 'T2', nome: 'Lead', probabilidade: 10, categoria: 'aberta', ordem: 0, ativo: true }];
const CAB = 'Opportunity Name;Account Name;Opportunity Amount;Expected Close Date;Sales Stage;Probability (%);Type;Ano/Obra (Referência GIAF);Deleted\n';
const correr = (linhas, ops = [], projetos) => {
  const m = C.parseCsv(CAB + linhas.join('\n'));
  return C.prepararOportunidades(m, C.autoMapear(m[0], C.CAMPOS_OPORTUNIDADE),
    { contas: [{ id: 'C1', nome: 'Alfa' }], oportunidades: ops, tipos, etapas, recursos: [], projetos: projetos || [] }, { criarContas: true, atualizarExistentes: true });
};

test('importação: a referência GIAF vai para o campo da oportunidade (e já não para a descrição)', () => {
  const r = correr(['Op A;Alfa;100;;Qualificação | Ideia;10;Serviços;2026/0829;0', 'Op B;Alfa;100;;Qualificação | Ideia;10;Serviços;2026/0000;0']);
  assert.equal(r.novas[0].referencia_giaf, '2026/829'); assert.equal(r.novas[0].descricao, '');
  assert.equal(r.novas[1].referencia_giaf, '');                                   // "2026/0000" não é referência
});

test('importação: atualiza a referência de uma oportunidade existente quando difere', () => {
  const ex = { id: 'O1', conta_id: 'C1', tipo_id: 'T2', etapa_id: 's1', titulo: 'Op A', descricao: '', valor_estimado: 100, referencia_giaf: '', origem: '' };
  const r = correr(['Op A;Alfa;100;;Qualificação | Ideia;10;Serviços;2026/829;0'], [ex]);
  assert.deepEqual(r.atualizar[0].patch, { referencia_giaf: '2026/829' });
  assert.equal(correr(['Op A;Alfa;100;;Qualificação | Ideia;10;Serviços;2026/829;0'], [Object.assign({}, ex, { referencia_giaf: '2026/829' })]).iguais, 1);
});

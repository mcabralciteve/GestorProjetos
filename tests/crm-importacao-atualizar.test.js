// Importação de oportunidades que JÁ EXISTEM: valida a existência e atualiza só o que mudou.
// Correr com: node --test tests/crm-importacao-atualizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/crm-logica.js');

const recursos = [{ id: 'R1', nome: 'Milton Cabral', email: 'mcabral@citeve.pt' }, { id: 'R2', nome: 'Ana Sousa', email: 'asousa@citeve.pt' }];
const E = (id, tipo, nome, prob, cat) => ({ id, tipo_id: tipo, nome, probabilidade: prob, categoria: cat, ordem: 0, ativo: true });
const tipos = [{ id: 'T2', nome: 'Serviços', ativo: true }];
const etapas = [E('s1', 'T2', 'Lead', 10, 'aberta'), E('s2', 'T2', 'Ganha', 100, 'ganha'), E('s3', 'T2', 'Perdida', 0, 'perdida')];
const CAB = 'Opportunity Name;Account Name;Opportunity Amount;Expected Close Date;Sales Stage;Probability (%);Next Step;Type;Assigned to;Lead Source;Description;Deleted\n';
const existente = (extra) => Object.assign({
  id: 'O1', conta_id: 'C1', tipo_id: 'T2', etapa_id: 's1', titulo: 'Auditoria', descricao: 'Texto original', valor_estimado: 8000,
  data_prevista_fecho: '2026-09-30', responsavel_id: 'R2', origem: 'Website', motivo_perda_id: null, motivo_perda_notas: '', data_fecho: null, projeto_id: null
}, extra);
const correr = (linhas, ops, opts, tarefas) => {
  const m = C.parseCsv(CAB + linhas.join('\n'));
  const ctx = { contas: [{ id: 'C1', nome: 'Alfa, Lda.' }], oportunidades: ops, tipos, etapas, recursos, projetos: [], tarefas: tarefas || [] };
  return C.prepararOportunidades(m, C.autoMapear(m[0], C.CAMPOS_OPORTUNIDADE), ctx, Object.assign({ formatoData: 'mdy', criarContas: true }, opts));
};

test('sem a opção de atualizar, as existentes continuam a ser ignoradas como duplicadas', () => {
  const r = correr(['Auditoria;Alfa Lda;12600;;Qualificação | Ideia;10;;Serviços;;;;0'], [existente()], {});
  assert.equal(r.duplicadas.length, 1); assert.equal(r.atualizar.length, 0); assert.equal(r.novas.length, 0);
});

test('existente com dados diferentes: atualiza só o que o ficheiro traz e é diferente', () => {
  const r = correr(['auditoria;Alfa Lda;€12.600,00;10/31/2026;Qualificação | Ideia;10;;Serviços;mcabral;Existing Customer;Texto original;0'], [existente()], { atualizarExistentes: true });
  assert.equal(r.novas.length, 0); assert.equal(r.duplicadas.length, 0); assert.equal(r.atualizar.length, 1);
  const u = r.atualizar[0];
  assert.equal(u.op.id, 'O1');
  assert.deepEqual(u.patch, { valor_estimado: 12600, data_prevista_fecho: '2026-10-31', responsavel_id: 'R1', origem: 'Cliente existente' });
  assert.deepEqual(u.mudancas.map(m => [m.k, m.de, m.para]), [['valor_estimado', 8000, 12600], ['data_prevista_fecho', '2026-09-30', '2026-10-31'], ['responsavel_id', 'R2', 'R1'], ['origem', 'Website', 'Cliente existente']]);
  assert.equal(u.reabre, false);
});

test('campos vazios (ou valor 0) no ficheiro nunca apagam o que já existe', () => {
  const r = correr(['Auditoria;Alfa Lda;0;;Qualificação | Ideia;10;;Serviços;;;;0'], [existente()], { atualizarExistentes: true });
  assert.equal(r.atualizar.length, 0); assert.equal(r.iguais, 1);   // nada diferente -> "já igual"
});

test('mesma oportunidade, mesmos dados: conta como igual, sem escrever nada', () => {
  const r = correr(['Auditoria;Alfa Lda;8000;09/30/2026;Qualificação | Ideia;10;;Serviços;asousa;Website;Texto   original;0'], [existente()], { atualizarExistentes: true });
  assert.equal(r.iguais, 1); assert.equal(r.atualizar.length, 0);
});

test('mudar de etapa: ganha fecha com data; perdida leva o motivo por omissão; voltar a aberta limpa o fecho e avisa que reabre', () => {
  const ganha = correr(['Auditoria;Alfa Lda;;10/15/2026;Ganho | Aprovada;100;;Serviços;;;;0'], [existente()], { atualizarExistentes: true }).atualizar[0];
  assert.equal(ganha.patch.etapa_id, 's2'); assert.equal(ganha.patch.data_fecho, '2026-10-15'); assert.equal(ganha.patch.motivo_perda_id, null); assert.equal(ganha.reabre, false);
  const perdida = correr(['Auditoria;Alfa Lda;;;Abandonado | Rejeitada;0;;Serviços;;;;0'], [existente()], { atualizarExistentes: true, motivoPadrao: { T2: 'mp1' } }).atualizar[0];
  assert.equal(perdida.patch.etapa_id, 's3'); assert.equal(perdida.patch.motivo_perda_id, 'mp1');
  const reabre = correr(['Auditoria;Alfa Lda;;;Qualificação | Ideia;10;;Serviços;;;;0'], [existente({ etapa_id: 's2', data_fecho: '2026-08-01' })], { atualizarExistentes: true }).atualizar[0];
  assert.equal(reabre.reabre, true); assert.equal(reabre.patch.data_fecho, null);
});

test('repetida no próprio ficheiro: só a primeira conta; as outras são duplicadas', () => {
  const r = correr(['Auditoria;Alfa Lda;9000;;Qualificação | Ideia;10;;Serviços;;;;0', 'Auditoria;Alfa Lda;9500;;Qualificação | Ideia;10;;Serviços;;;;0'], [existente()], { atualizarExistentes: true });
  assert.equal(r.atualizar.length, 1); assert.equal(r.atualizar[0].patch.valor_estimado, 9000);
  assert.deepEqual(r.duplicadas.map(d => d.noFicheiro), [true]);
});

test('follow-up do "Próximo passo" em existente: cria só se ainda não houver um igual em aberto', () => {
  const linha = ['Auditoria;Alfa Lda;9000;;Qualificação | Ideia;10;Ligar ao cliente;Serviços;;;;0'];
  const novo = correr(linha, [existente()], { atualizarExistentes: true, criarFollowups: true });
  assert.equal(novo.followups, 1); assert.equal(novo.followupsExistentes[0].descricao, 'Ligar ao cliente');
  const jaTem = correr(linha, [existente()], { atualizarExistentes: true, criarFollowups: true }, [{ oportunidade_id: 'O1', descricao: 'ligar ao cliente', concluida: false }]);
  assert.equal(jaTem.followups, 0);
  const concluido = correr(linha, [existente()], { atualizarExistentes: true, criarFollowups: true }, [{ oportunidade_id: 'O1', descricao: 'Ligar ao cliente', concluida: true }]);
  assert.equal(concluido.followups, 1);                                  // um já concluído não impede um novo
});

test('novas e existentes no mesmo ficheiro: cada uma vai para o seu lado', () => {
  const r = correr(['Auditoria;Alfa Lda;9000;;Qualificação | Ideia;10;;Serviços;;;;0', 'Outra;Alfa Lda;100;;Qualificação | Ideia;10;;Serviços;;;;0'], [existente()], { atualizarExistentes: true });
  assert.deepEqual([r.novas.length, r.atualizar.length], [1, 1]);
});

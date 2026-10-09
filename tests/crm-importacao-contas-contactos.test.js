// Importação de contas e contactos que JÁ EXISTEM: atualiza só o que mudou.
// Correr com: node --test tests/crm-importacao-contas-contactos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/crm-logica.js');

const recursos = [{ id: 'R1', nome: 'Milton Cabral', email: 'mcabral@citeve.pt' }];
const conta = (extra) => Object.assign({ id: 'C1', nome: 'Alfa, Lda.', nif: '501234567', setor: 'Têxtil', dimensao: '', morada: '', website: '', estado: 'prospeto', responsavel_id: null, notas: '' }, extra);
const contas = (cabecalho, linhas, existentes, opts) => {
  const m = C.parseCsv(cabecalho + '\n' + linhas.join('\n'));
  return C.prepararContas(m, C.autoMapear(m[0], C.CAMPOS_CONTA), existentes, Object.assign({ recursos }, opts));
};
const CAB_C = 'Name;NIF;Sector;Dimension;Billing Street;Billing Postal Code;Billing City;Website;Assigned to;Description;Deleted';

test('contas: sem a opção, as existentes continuam ignoradas como duplicadas', () => {
  const r = contas(CAB_C, ['Alfa Lda;501234567;Calçado;;;;;;;;0'], [conta()], {});
  assert.equal(r.duplicadas.length, 1); assert.equal(r.atualizar.length, 0);
});

test('contas: atualiza só o que o ficheiro traz e é diferente (vazio nunca apaga)', () => {
  const r = contas(CAB_C, ['alfa lda;501234567;Calçado;PME;Rua A, 1;4000-100;Porto;www.alfa.pt;mcabral;Notas novas;0'], [conta({ notas: '' })], { atualizarExistentes: true });
  assert.equal(r.novas.length, 0); assert.equal(r.duplicadas.length, 0); assert.equal(r.atualizar.length, 1);
  assert.deepEqual(r.atualizar[0].patch, { setor: 'Calçado', dimensao: 'PME', morada: 'Rua A, 1, 4000-100 Porto', website: 'https://www.alfa.pt', responsavel_id: 'R1', notas: 'Notas novas' });
  const igual = contas(CAB_C, ['Alfa Lda;501234567;;;;;;;;;0'], [conta()], { atualizarExistentes: true });
  assert.equal(igual.atualizar.length, 0); assert.equal(igual.iguais, 1);        // campos vazios: nada a mudar
});

test('contas: notas escritas na app nunca são sobrepostas; NIF só se preenche quando falta', () => {
  const r = contas(CAB_C, ['Alfa Lda;999999999;;;;;;;;Outras notas;0'], [conta({ notas: 'Minhas notas' })], { atualizarExistentes: true });
  assert.equal(r.atualizar.length, 0);                                              // nem notas nem NIF mudam
  assert.equal(r.avisos.length, 1); assert.match(r.avisos[0].motivo, /NIF/);
  const semNif = contas(CAB_C, ['Alfa Lda;501234567;;;;;;;;;0'], [conta({ nif: '' })], { atualizarExistentes: true });
  assert.deepEqual(semNif.atualizar[0].patch, { nif: '501234567' });
});

test('contas: encontra por NIF mesmo com nome diferente; repetida no ficheiro conta uma só vez', () => {
  const r = contas(CAB_C, ['Outro nome qualquer;501234567;Calçado;;;;;;;;0', 'Alfa Lda;501234567;Lã;;;;;;;;0'], [conta()], { atualizarExistentes: true });
  assert.equal(r.atualizar.length, 1); assert.equal(r.atualizar[0].patch.setor, 'Calçado');
  assert.deepEqual(r.duplicadas.map(d => d.noFicheiro), [true]);
});

test('contas: o estado só muda se o ficheiro o traz e o reconhece', () => {
  const cab = 'Name;NIF;Estado;Deleted';
  const reconhecido = contas(cab, ['Alfa Lda;501234567;Ativo;0'], [conta()], { atualizarExistentes: true });
  assert.deepEqual(reconhecido.atualizar[0].patch, { estado: 'ativo' });
  const desconhecido = contas(cab, ['Alfa Lda;501234567;qualquer coisa;0'], [conta({ estado: 'ativo' })], { atualizarExistentes: true, estadoPadrao: 'prospeto' });
  assert.equal(desconhecido.atualizar.length, 0);                                    // não assume o estado por omissão
});

const contacto = (extra) => Object.assign({ id: 'K1', conta_id: 'C1', nome: 'Ana Silva', cargo: '', email: 'ana@alfa.pt', telefone: '', papel_decisao: '', notas: '' }, extra);
const contactos = (linhas, existentes, opts) => {
  const m = C.parseCsv('First Name;Last Name;Account Name;Job Title;Email Address;Mobile;Office Phone;Description;Deleted\n' + linhas.join('\n'));
  return C.prepararContactos(m, C.autoMapear(m[0], C.CAMPOS_CONTACTO), [conta()], existentes, Object.assign({ criarContas: true }, opts));
};

test('contactos: sem a opção são ignorados como duplicados; com ela atualizam o que mudou', () => {
  const linha = 'Ana;Silva;Alfa Lda;Diretora;ana@alfa.pt;;\'+351 252 000 000;;0';
  assert.equal(contactos([linha], [contacto()], {}).duplicados.length, 1);
  const r = contactos([linha], [contacto()], { atualizarExistentes: true });
  assert.equal(r.novos.length, 0); assert.equal(r.atualizar.length, 1);
  assert.deepEqual(r.atualizar[0].patch, { cargo: 'Diretora', telefone: '+351 252 000 000' });
  assert.equal(r.atualizar[0].existente.id, 'K1');
});

test('contactos: mesmo email com o nome escrito de outra forma atualiza o nome; encontrado pelo nome não o muda', () => {
  const porEmail = contactos(['Ana Maria;Silva;Alfa Lda;;ana@alfa.pt;;;;0'], [contacto()], { atualizarExistentes: true });
  assert.deepEqual(porEmail.atualizar[0].patch, { nome: 'Ana Maria Silva' });
  const porNome = contactos(['Ana;Silva;Alfa Lda;;novo@alfa.pt;;;;0'], [contacto()], { atualizarExistentes: true });
  assert.deepEqual(porNome.atualizar[0].patch, { email: 'novo@alfa.pt' });
});

test('contactos: iguais não fazem nada; novos e existentes no mesmo ficheiro vão cada um para o seu lado; repetidos contam uma vez', () => {
  const r = contactos(['Ana;Silva;Alfa Lda;;ana@alfa.pt;;;;0', 'Rui;Lopes;Alfa Lda;Técnico;rui@alfa.pt;;;;0', 'Ana;Silva;Alfa Lda;Chefe;ana@alfa.pt;;;;0'], [contacto()], { atualizarExistentes: true });
  assert.equal(r.iguais, 1); assert.equal(r.novos.length, 1); assert.equal(r.atualizar.length, 0);
  assert.equal(r.duplicados.length, 1);                                              // 2.ª linha da Ana
});

test('contactos: notas só se preenchem quando o contacto ainda não tem', () => {
  const r = contactos(['Ana;Silva;Alfa Lda;;ana@alfa.pt;;;Nota do CRM;0'], [contacto({ notas: 'Minha nota' })], { atualizarExistentes: true });
  assert.equal(r.atualizar.length, 0);
  const r2 = contactos(['Ana;Silva;Alfa Lda;;ana@alfa.pt;;;Nota do CRM;0'], [contacto()], { atualizarExistentes: true });
  assert.deepEqual(r2.atualizar[0].patch, { notas: 'Nota do CRM' });
});

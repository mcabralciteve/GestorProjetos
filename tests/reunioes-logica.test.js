// Módulo Reuniões (regras puras) — correr com: node --test tests/reunioes-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reunioes-logica.js');

const reuniao = (extra) => Object.assign(R.nova({ agoraISO: '2026-10-30T10:20:00Z' }), { id: 'r1', titulo: 'Arranque' }, extra);

test('nova: hora redonda seguinte, 1 hora, e já com o projeto/cliente do contexto', () => {
  const r = R.nova({ agoraISO: '2026-10-30T10:20:00Z', projeto: { id: 'p1', idInterno: '2026/12', nome: 'Lean', cliente: 'Têxtil do Ave' } });
  assert.equal(new Date(r.data_hora).getMinutes(), 0);
  assert.ok(new Date(r.data_hora) > new Date('2026-10-30T10:20:00Z'));
  assert.equal(r.duracao_min, 60);
  assert.equal(r.projeto_id, 'p1');
  assert.equal(r.cliente, 'Têxtil do Ave');
  assert.equal(r.projeto_nome, '2026/12 — Lean'); // nunca só o código
  assert.deepEqual(r.participantes, []);
});

test('normalizar: listas sempre presentes, números certos', () => {
  const r = R.normalizar({ id: 'x', participantes: null, pontos: undefined, ata_versao: '2', versao: null });
  assert.deepEqual([r.participantes, r.ficheiros, r.pontos], [[], [], []]);
  assert.equal(r.ata_versao, 2);
  assert.equal(r.versao, 1);
});

test('validar: título, data, duração, ligações e pontos vazios', () => {
  assert.deepEqual(R.validar(reuniao()), []);
  assert.equal(R.validar(reuniao({ titulo: '  ' }))[0], 'Indica o título da reunião.');
  assert.ok(R.validar(reuniao({ data_hora: 'lixo' })).some(e => /data e a hora/.test(e)));
  assert.ok(R.validar(reuniao({ duracao_min: 0 })).some(e => /duração/.test(e)));
  assert.deepEqual(R.validar(reuniao({ duracao_min: null })), []);
  assert.ok(R.validar(reuniao({ ficheiros: [{ nome: 'Proposta', ligacao: 'proposta.docx' }] })).some(e => /ligação/.test(e)));
  assert.deepEqual(R.validar(reuniao({ ficheiros: [{ nome: 'P', ligacao: 'https://citeve.sharepoint.com/x' }, { nome: 'Q', ligacao: '' }] })), []);
  assert.ok(R.validar(reuniao({ pontos: [{ tipo: 'acao', texto: ' ' }, { tipo: 'decisao', texto: '' }] })).length === 1); // sem repetir a mesma frase
});

test('quem vê: admin, criador, participante, quem vê o projeto, CRM numa oportunidade', () => {
  const base = { userId: 'u1', recursoId: 'rec1', admin: false, crmVer: false, veProjeto: () => false };
  const r = reuniao({ criado_por_user: 'outro', participantes: [{ tipo: 'recurso', ref_id: 'rec9', nome: 'X' }] });
  assert.equal(R.podeVer(r, base), false);
  assert.equal(R.podeVer(r, Object.assign({}, base, { admin: true })), true);
  assert.equal(R.podeVer(Object.assign({}, r, { criado_por_user: 'u1' }), base), true);
  assert.equal(R.podeVer(Object.assign({}, r, { participantes: [{ tipo: 'recurso', ref_id: 'rec1', nome: 'Eu' }] }), base), true);
  // um contacto do cliente com o mesmo id não conta como "colega"
  assert.equal(R.podeVer(Object.assign({}, r, { participantes: [{ tipo: 'contacto', ref_id: 'rec1', nome: 'Eu' }] }), base), false);
  assert.equal(R.podeVer(Object.assign({}, r, { projeto_id: 'p1' }), Object.assign({}, base, { veProjeto: id => id === 'p1' })), true);
  assert.equal(R.podeVer(Object.assign({}, r, { projeto_id: 'p2' }), Object.assign({}, base, { veProjeto: id => id === 'p1' })), false);
  assert.equal(R.podeVer(Object.assign({}, r, { oportunidade_id: 'o1' }), Object.assign({}, base, { crmVer: true })), true);
  assert.equal(R.podeVer(Object.assign({}, r, { oportunidade_id: 'o1' }), base), false);
});

test('quem edita: admin, criador, quem edita o projeto, responsável da oportunidade — participantes não', () => {
  const base = { userId: 'u1', recursoId: 'rec1', admin: false, editaProjeto: () => false, souResponsavelOp: () => false };
  const r = reuniao({ criado_por_user: 'outro', projeto_id: 'p1', oportunidade_id: 'o1', participantes: [{ tipo: 'recurso', ref_id: 'rec1', nome: 'Eu' }] });
  assert.equal(R.podeEditar(r, base), false);
  assert.equal(R.podeEditar(r, Object.assign({}, base, { admin: true })), true);
  assert.equal(R.podeEditar(Object.assign({}, r, { criado_por_user: 'u1' }), base), true);
  assert.equal(R.podeEditar(r, Object.assign({}, base, { editaProjeto: id => id === 'p1' })), true);
  assert.equal(R.podeEditar(r, Object.assign({}, base, { souResponsavelOp: id => id === 'o1' })), true);
});

test('filtrar: texto sem acentos (inclui participantes), estado, projeto, período; ordem', () => {
  const agora = new Date('2026-10-30T12:00:00Z').getTime();
  const lista = [
    reuniao({ id: 'a', titulo: 'Reunião de arranque', cliente: 'Têxtil do Ave', data_hora: '2026-10-01T09:00:00Z', estado: 'realizada', projeto_id: 'p1' }),
    reuniao({ id: 'b', titulo: 'Ponto de situação', cliente: 'Energia Verde', data_hora: '2026-11-10T09:00:00Z', participantes: [{ nome: 'João Conceição' }] }),
    reuniao({ id: 'c', titulo: 'Follow-up', data_hora: '2026-11-20T09:00:00Z', estado: 'cancelada' })
  ];
  const ids = f => R.filtrar(lista, f, agora).map(r => r.id);
  assert.deepEqual(ids({}), ['c', 'b', 'a']);                      // mais recentes primeiro
  assert.deepEqual(ids({ texto: 'textil' }), ['a']);               // sem acentos
  assert.deepEqual(ids({ texto: 'joao conceicao' }), ['b']);       // nome de participante
  assert.deepEqual(ids({ estado: 'cancelada' }), ['c']);
  assert.deepEqual(ids({ projeto: 'p1' }), ['a']);
  assert.deepEqual(ids({ periodo: 'proximas' }), ['b', 'c']);      // próximas: a mais próxima primeiro
  assert.deepEqual(ids({ periodo: 'passadas' }), ['a']);
});

test('adicionarParticipante: não repete a mesma pessoa (por id, ou pelo nome sem id)', () => {
  const l = [];
  assert.equal(R.adicionarParticipante(l, { tipo: 'recurso', ref_id: 'r1', nome: 'Ana Silva' }), true);
  assert.equal(R.adicionarParticipante(l, { tipo: 'recurso', ref_id: 'r1', nome: 'Ana Silva' }), false);
  assert.equal(R.adicionarParticipante(l, { tipo: 'externo', nome: '  ana  silva'.replace(/ +/g, ' ').trim() }), false); // mesmo nome, sem id → já está
  assert.equal(R.adicionarParticipante(l, { tipo: 'externo', nome: 'Rui Costa', organizacao: 'Parceiro' }), true);
  assert.equal(R.adicionarParticipante(l, { tipo: 'externo', nome: 'RUI COSTA' }), false);
  assert.equal(R.adicionarParticipante(l, { tipo: 'externo', nome: '   ' }), false);
  assert.equal(l.length, 2);
  assert.equal(l[0].presente, true);
});

test('pontos: novo ponto e resumo', () => {
  const d = R.novoPonto('decisao'), a = R.novoPonto('qualquer');
  assert.equal(d.tipo, 'decisao'); assert.equal(a.tipo, 'acao'); assert.notEqual(d.id, a.id);
  const r = reuniao({ pontos: [d, a, Object.assign(R.novoPonto('acao'), { concluida: true })] });
  assert.deepEqual(R.resumoPontos(r), { decisoes: 1, acoes: 2, acoesPorFechar: 1 });
});

test('datas: ida e volta com o campo datetime-local, e formatos pt-PT', () => {
  const iso = new Date(2026, 10, 5, 14, 30).toISOString(); // 05/11/2026 14:30 locais
  assert.equal(R.paraInputLocal(iso), '2026-11-05T14:30');
  assert.equal(R.deInputLocal('2026-11-05T14:30'), iso);
  assert.equal(R.deInputLocal('lixo'), null);
  assert.equal(R.formatarDataHora(iso), '05/11/2026 14:30');
  assert.equal(R.formatarData(iso), '05/11/2026');
  assert.equal(R.formatarDia('2026-11-05'), '05/11/2026');
  assert.equal(R.formatarDia(null), '');
  assert.deepEqual([90, 60, 45, 0, null].map(m => R.duracaoTexto(m)), ['1 h 30 min', '1 h', '45 min', '', '']);
});

test('nome do ficheiro da ata: sem acentos nem espaços, com data e versão', () => {
  const r = reuniao({ titulo: 'Reunião de Arranque — Têxtil/Ave!', data_hora: new Date(2026, 10, 5, 14, 30).toISOString() });
  assert.equal(R.nomeFicheiroAta(r, 2), 'Ata_20261105_reuniao_de_arranque_textil_ave_v2.docx');
  assert.equal(R.nomeFicheiroAta(reuniao({ titulo: '???', data_hora: 'x' }), 1), 'Ata_reuniao_v1.docx');
});

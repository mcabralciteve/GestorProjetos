// Integração orcprev (importador que corre dentro do orcprev) — correr com: node --test tests/orcprev-importar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../js/orcprev-importar.js');

const projetos = [
  { id: 1, project_code: '005363', name: '+DIGITALIZAÇÃO', project_status_code: 'execution', status_name: 'Em execução' },
  { id: 2, project_code: '005323', name: 'TEXP@CT', project_status_code: 'execution', status_name: 'Em execução' },
  { id: 3, project_code: '', name: 'ALMA', project_status_code: 'rejected', status_name: 'Rejeitado' },
  { id: 4, project_code: '', name: 'ALMA', project_status_code: 'rejected', status_name: 'Rejeitado' },
  { id: 5, project_code: '005400', name: 'FMC24', project_status_code: 'execution', status_name: 'Em execução' },
  { id: 6, project_code: '', name: 'FMC24', project_status_code: 'completed', status_name: 'Concluído' }
];
const dados = (entries, extra) => Object.assign({
  week_start: '2026-10-19', read_only: false, employee: { employee_code: '591' }, projects: projetos, entries: entries || [],
  activities: [{ code: 'INTERNAL_MEETINGS' }, { code: 'PROTOTYPING' }, { code: 'APPLICATION_PREP' }, { code: 'OTHER' }], service_activity_codes: ['PROTOTYPING', 'CONSULTING']
}, extra);
const pacote = (linhas) => ({ formato: 'gestor-orcprev', versao: 1, email: 'a@citeve.pt', pessoa: 'Ana', semana: { inicio: '2026-10-19', fim: '2026-10-25' }, linhas });
const lp = (nome, extra) => Object.assign({ data: '2026-10-19', tipo: 'PROJECT', atividade: null, horas: 2, nota: '[Gestor] t', projeto: { ref: '', nome, idInterno: '2026/1' } }, extra);

test('lerPacote: aceita o formato certo e recusa o resto com mensagem clara', () => {
  assert.equal(I.lerPacote(JSON.stringify(pacote([]))).ok, true);
  assert.equal(I.lerPacote('olá').ok, false);
  assert.equal(I.lerPacote('{"formato":"outro"}').ok, false);
  assert.equal(I.lerPacote(JSON.stringify(Object.assign(pacote([]), { versao: 2 }))).ok, false);
  assert.equal(I.lerPacote(JSON.stringify(Object.assign(pacote([]), { semana: { inicio: 'x' } }))).ok, false);
});

test('casarProjeto: por nome, ignorando acentos/maiúsculas/pontuação', () => {
  assert.equal(I.casarProjeto({ nome: 'texp@ct' }, projetos).id, 2);
  assert.equal(I.casarProjeto({ nome: '+Digitalizacao' }, projetos).id, 1);
  assert.equal(I.casarProjeto({ nome: 'Inexistente' }, projetos).como, 'sem-correspondencia');
});

test('casarProjeto: a referência definida no Gestor ganha (código, depois nome); inválida não cai no nome', () => {
  assert.equal(I.casarProjeto({ ref: '005363', nome: 'qualquer' }, projetos).id, 1);
  assert.equal(I.casarProjeto({ ref: '005363', nome: 'qualquer' }, projetos).como, 'codigo');
  assert.equal(I.casarProjeto({ ref: 'texp@ct', nome: 'qualquer' }, projetos).como, 'ref-nome');
  const inv = I.casarProjeto({ ref: '999999', nome: 'TEXP@CT' }, projetos);
  assert.equal(inv.id, null); assert.equal(inv.como, 'ref-invalida');
});

test('casarProjeto: nomes repetidos — desempata por "em execução"; senão fica ambíguo e não adivinha', () => {
  assert.equal(I.casarProjeto({ nome: 'FMC24' }, projetos).id, 5);
  const amb = I.casarProjeto({ nome: 'ALMA' }, projetos);
  assert.equal(amb.id, null); assert.equal(amb.como, 'ambiguo'); assert.deepEqual(amb.candidatos.map(p => p.id), [3, 4]);
});

test('casarProjeto: escolha feita agora > memória; memória usa-se quando não há referência', () => {
  assert.equal(I.casarProjeto({ nome: 'ALMA' }, projetos, {}, 4).id, 4);
  assert.equal(I.casarProjeto({ nome: 'Nome diferente', idInterno: '2026/9' }, projetos, { '2026/9': 2 }).como, 'memorizado');
  assert.equal(I.casarProjeto({ nome: 'Nome diferente', idInterno: '2026/9' }, projetos, { '2026/9': 999 }).id, null); // memória de projeto que já não existe
});

test('planear: substitui só as linhas marcadas [Gestor]; as manuais ficam e contam como conflito', () => {
  const ent = [
    { id: 10, work_date: '2026-10-19', project_id: 2, hours: 3, note: '[Gestor] antigo' },
    { id: 11, work_date: '2026-10-19', project_id: 1, hours: 1, note: 'à mão' },
    { id: 12, work_date: '2026-10-20', project_id: 1, hours: 2, note: '' }
  ];
  const p = I.planear({ pacote: pacote([lp('TEXP@CT', { horas: 4 })]), dados: dados(ent), memoria: {}, escolhas: {} });
  assert.deepEqual(p.apagar, [10]);
  assert.equal(p.totalEnviar, 4); assert.equal(p.horasMarcadasAnteriores, 3); assert.equal(p.horasManuais, 3);
  const seg = p.dias[0];
  assert.deepEqual([seg.data, seg.enviar, seg.substitui, seg.manual], ['2026-10-19', 4, 3, 1]);
  assert.equal(p.dias.length, 7);
});

test('planear: atividade simples vai; atividade com serviço/projeto fica à mão; projeto por escolher não é enviado', () => {
  const linhas = [
    lp('', { tipo: 'ACTIVITY', atividade: 'INTERNAL_MEETINGS', projeto: null, horas: 1 }),
    lp('', { tipo: 'ACTIVITY', atividade: 'PROTOTYPING', projeto: null, horas: 2 }),
    lp('', { tipo: 'ACTIVITY', atividade: 'APPLICATION_PREP', projeto: null, horas: 1 }),
    lp('', { tipo: 'ACTIVITY', atividade: 'NAO_EXISTE', projeto: null, horas: 1 }),
    lp('ALMA', { horas: 1.5 })
  ];
  const p = I.planear({ pacote: pacote(linhas), dados: dados(), memoria: {}, escolhas: {} });
  assert.deepEqual(p.linhas.map(l => l.estado), ['ok', 'manual', 'manual', 'manual', 'escolher']);
  assert.equal(p.totalEnviar, 1); assert.equal(p.totalPendente, 5.5);
  // depois de escolher o projeto, passa a ok
  const p2 = I.planear({ pacote: pacote(linhas), dados: dados(), memoria: {}, escolhas: { '2026/1': 3 } });
  assert.equal(p2.linhas[4].estado, 'ok'); assert.equal(p2.linhas[4].projetoId, 3);
});

test('corpoGravacao: mesmo formato do ecrã do orcprev (projeto sem atividade; atividade sem projeto; ids a apagar)', () => {
  const pac = pacote([lp('TEXP@CT', { horas: 4 }), lp('', { tipo: 'ACTIVITY', atividade: 'INTERNAL_MEETINGS', projeto: null, horas: 1, data: '2026-10-20' }), lp('ALMA')]);
  const d = dados([{ id: 10, work_date: '2026-10-19', project_id: 2, hours: 3, note: '[Gestor] x' }]);
  const plano = I.planear({ pacote: pac, dados: d, memoria: {}, escolhas: {} });
  const corpo = I.corpoGravacao(plano, d, pac);
  assert.equal(corpo.employee_code, '591'); assert.equal(corpo.week_start, '2026-10-19');
  assert.deepEqual(corpo.delete_ids, [10]);
  assert.deepEqual(corpo.entries, [
    { id: null, work_date: '2026-10-19', project_id: 2, service_id: null, activity_code: null, hours: 4, note: '[Gestor] t' },
    { id: null, work_date: '2026-10-20', project_id: null, service_id: null, activity_code: 'INTERNAL_MEETINGS', hours: 1, note: '[Gestor] t' }
  ]); // "ALMA" ambíguo: não vai
});

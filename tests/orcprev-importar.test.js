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
  assert.deepEqual(p.linhas.map(l => l.estado), ['ok', 'manual', 'escolher', 'manual', 'escolher']); // candidaturas: o orcprev pede projeto, escolhe-se em "Alterar"
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

const servicos = [
  { id: 7, client_name: 'Alfa, Lda.', name: 'Auditoria energética', active: 1 },
  { id: 8, client_name: 'Alfa, Lda.', name: 'Ensaios', active: 1 },
  { id: 9, client_name: 'Beta SA', name: 'Ensaios', active: 1 },
  { id: 10, client_name: 'Gama', name: 'Antigo', active: 0 }
];

test('casarServico: "Cliente · Serviço", nome ou cliente únicos; ambíguo e inativos não se adivinham', () => {
  assert.equal(I.casarServico({ ref: 'Alfa, Lda. · Auditoria energética' }, servicos).id, 7);
  assert.equal(I.casarServico({ ref: 'auditoria energetica' }, servicos).id, 7);
  assert.equal(I.casarServico({ ref: 'Beta SA' }, servicos).id, 9); // só um serviço do cliente
  const amb = I.casarServico({ ref: 'Ensaios' }, servicos);
  assert.equal(amb.id, null); assert.equal(amb.como, 'ambiguo'); assert.deepEqual(amb.candidatos.map(x => x.id), [8, 9]);
  assert.equal(I.casarServico({ ref: 'Alfa, Lda.' }, servicos).como, 'ambiguo'); // dois serviços do mesmo cliente
  assert.equal(I.casarServico({ ref: 'Gama' }, servicos).como, 'ref-invalida'); // inativo não conta
  assert.equal(I.casarServico({ ref: 'Alfa, Lda. · Ensaios' }, servicos).id, 8);
});

test('casarServico: sem referência usa memória e depois o nome do projeto do Gestor; escolha manda', () => {
  assert.equal(I.casarServico({ nome: 'Auditoria energética', idInterno: '2026/5' }, servicos).id, 7);
  assert.equal(I.casarServico({ nome: 'Qualquer', idInterno: '2026/5' }, servicos, { 's:2026/5': 9 }).como, 'memorizado');
  assert.equal(I.casarServico({ ref: 'Ensaios' }, servicos, {}, 9).id, 9);
  assert.equal(I.casarServico({ nome: 'Nada a ver' }, servicos).como, 'sem-correspondencia');
});

test('planear/corpoGravacao: serviço casado vai com service_id; sem serviços fica à mão', () => {
  const lin = [{ data: '2026-10-19', tipo: 'SERVICE', atividade: 'CONSULTING', horas: 2, nota: '[Gestor] Visita', projeto: { ref: 'Alfa, Lda. · Auditoria energética', nome: 'Auditoria Alfa', idInterno: '2026/50' } }];
  const d = dados([], { services: servicos, activities: [{ code: 'CONSULTING' }, { code: 'PROTOTYPING' }] });
  const p = I.planear({ pacote: pacote(lin), dados: d, memoria: {}, escolhas: {} });
  assert.equal(p.linhas[0].estado, 'ok'); assert.equal(p.linhas[0].servicoId, 7);
  assert.deepEqual(I.corpoGravacao(p, d, pacote(lin)).entries, [{ id: null, work_date: '2026-10-19', project_id: null, service_id: 7, activity_code: 'CONSULTING', hours: 2, note: '[Gestor] Visita' }]);
  const semServicos = I.planear({ pacote: pacote(lin), dados: dados([], { services: [], activities: [{ code: 'CONSULTING' }] }), memoria: {}, escolhas: {} });
  assert.equal(semServicos.linhas[0].estado, 'manual'); assert.match(semServicos.linhas[0].motivo, /Outras atividades/);
  const amb = I.planear({ pacote: pacote([Object.assign({}, lin[0], { projeto: { ref: 'Ensaios', nome: 'X', idInterno: '2026/9' } })]), dados: d, memoria: {}, escolhas: {} });
  assert.equal(amb.linhas[0].estado, 'escolher');
  const escolhido = I.planear({ pacote: pacote([Object.assign({}, lin[0], { projeto: { ref: 'Ensaios', nome: 'X', idInterno: '2026/9' } })]), dados: d, memoria: {}, escolhas: { 's:2026/9': 8 } });
  assert.equal(escolhido.linhas[0].servicoId, 8);
});

test('atividade "Outras atividades" (OTHER) vai sem projeto nem serviço', () => {
  const lin = [{ data: '2026-10-19', tipo: 'ACTIVITY', atividade: 'OTHER', horas: 1.5, nota: '[Gestor] Estudo Beta', projeto: null }];
  const d = dados([]);
  const p = I.planear({ pacote: pacote(lin), dados: d, memoria: {}, escolhas: {} });
  assert.equal(p.linhas[0].estado, 'ok');
  assert.deepEqual(I.corpoGravacao(p, d, pacote(lin)).entries[0], { id: null, work_date: '2026-10-19', project_id: null, service_id: null, activity_code: 'OTHER', hours: 1.5, note: '[Gestor] Estudo Beta' });
});

// ---------- reajustes na pré-visualização ----------
const linhaProj = (extra) => lp('Roadmapping Digital', Object.assign({ tarefas: ['Reunião com cliente'], projetos: ['Roadmapping Digital'], clientes: ['Alfa, Lda.'], horas: 2 }, extra));

test('reajuste: linha de projeto do Gestor passa a "Outras atividades", com tarefa, projeto e cliente na nota', () => {
  const d = dados([], { activities: [{ code: 'OTHER' }, { code: 'CONSULTING' }] });
  const base = I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, escolhas: {} });
  assert.equal(base.linhas[0].estado, 'escolher'); // não existe no orcprev
  assert.equal(base.linhas[0].nota, '[Gestor] Reunião com cliente');
  const p = I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes: { 0: { destino: 'atividade', atividade: 'OTHER' } } });
  assert.equal(p.linhas[0].estado, 'ok'); assert.equal(p.linhas[0].tipo, 'ACTIVITY'); assert.equal(p.linhas[0].origem, 'editado');
  assert.equal(p.linhas[0].nota, '[Gestor] Reunião com cliente — Roadmapping Digital (Alfa, Lda.)');
  assert.deepEqual(I.corpoGravacao(p, d, pacote([linhaProj()])).entries[0], { id: null, work_date: '2026-10-19', project_id: null, service_id: null, activity_code: 'OTHER', hours: 2, note: '[Gestor] Reunião com cliente — Roadmapping Digital (Alfa, Lda.)' });
});

test('reajuste: corrigir uma linha que casou com o projeto errado; a nota editada à mão mantém a marca [Gestor]', () => {
  const d = dados([]);
  const errada = I.planear({ pacote: pacote([lp('TEXP@CT')]), dados: d, memoria: {}, edicoes: {} });
  assert.equal(errada.linhas[0].projetoId, 2);
  const p = I.planear({ pacote: pacote([lp('TEXP@CT')]), dados: d, memoria: {}, edicoes: { 0: { destino: 'projeto', id: 1, nota: 'Texto meu' } } });
  assert.equal(p.linhas[0].projetoId, 1); assert.equal(p.linhas[0].nota, '[Gestor] Texto meu');
  const vazia = I.planear({ pacote: pacote([lp('TEXP@CT')]), dados: d, memoria: {}, edicoes: { 0: { destino: 'projeto', id: 1, nota: '   ' } } });
  assert.equal(vazia.linhas[0].nota, '[Gestor]'); // sem a marca, o reenvio não saberia substituir esta linha
  assert.equal(I.montarNota('x'.repeat(500)).length, 200);
});

test('reajuste: serviço escolhido; destino inválido fica por escolher; editor aberto sem mudanças não conta', () => {
  const d = dados([], { services: servicos, activities: [{ code: 'CONSULTING' }, { code: 'PROTOTYPING' }, { code: 'OTHER' }] });
  const sv = I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes: { 0: { destino: 'servico', id: 7, atividade: 'CONSULTING' } } });
  assert.equal(sv.linhas[0].estado, 'ok'); assert.equal(sv.linhas[0].tipo, 'SERVICE'); assert.equal(sv.linhas[0].servicoId, 7);
  assert.equal(sv.linhas[0].nota, '[Gestor] Reunião com cliente — Roadmapping Digital (Alfa, Lda.)');
  assert.equal(I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes: { 0: { destino: 'servico', id: null, atividade: 'CONSULTING' } } }).linhas[0].estado, 'escolher');
  assert.equal(I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes: { 0: { destino: 'atividade', atividade: 'PROTOTYPING' } } }).linhas[0].estado, 'escolher'); // pede serviço
  assert.equal(I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes: { 0: { destino: 'atividade', atividade: 'OTHER', soAberto: true } } }).linhas[0].origem, 'automatico');
});

test('lembrar: guarda o destino por projeto do Gestor e aplica-o nos envios seguintes (sem referência definida no Gestor)', () => {
  const d = dados([], { activities: [{ code: 'OTHER' }] });
  const edicoes = { 0: { destino: 'atividade', atividade: 'OTHER', lembrar: true } };
  const p = I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes });
  const mem = I.memorizar({}, p, edicoes);
  assert.deepEqual(mem['d:2026/1'], { t: 'atividade', atividade: 'OTHER' });
  const depois = I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: mem, edicoes: {} });
  assert.equal(depois.linhas[0].tipo, 'ACTIVITY'); assert.equal(depois.linhas[0].origem, 'memorizado'); assert.equal(depois.linhas[0].estado, 'ok');
  // sem "lembrar" não guarda; com referência definida no Gestor, a memória não manda
  assert.deepEqual(I.memorizar({}, p, { 0: { destino: 'atividade', atividade: 'OTHER' } }), {});
  const comRef = linhaProj({ projeto: { ref: '005323', nome: 'Roadmapping Digital', idInterno: '2026/1' } });
  assert.equal(I.planear({ pacote: pacote([comRef]), dados: d, memoria: mem, edicoes: {} }).linhas[0].tipo, 'PROJECT');
});

// ---------- Preparação de candidaturas (atividade que leva projeto) ----------
const dadosCand = (extra) => dados([], Object.assign({ activities: [{ code: 'APPLICATION_PREP', name: 'Preparação de candidaturas' }, { code: 'OTHER' }] }, extra));

test('candidatura: casa o projeto e envia project_id + activity_code APPLICATION_PREP', () => {
  const lin = [lp('', { tipo: 'APPLICATION', atividade: 'APPLICATION_PREP', projeto: { ref: '005323', nome: 'Candidatura X', idInterno: '2026/60' }, horas: 3, nota: '[Gestor] Formulário' })];
  const d = dadosCand();
  const p = I.planear({ pacote: pacote(lin), dados: d, memoria: {}, edicoes: {} });
  assert.equal(p.linhas[0].estado, 'ok'); assert.equal(p.linhas[0].tipo, 'APPLICATION'); assert.equal(p.linhas[0].projetoId, 2);
  assert.deepEqual(I.corpoGravacao(p, d, pacote(lin)).entries[0], { id: null, work_date: '2026-10-19', project_id: 2, service_id: null, activity_code: 'APPLICATION_PREP', hours: 3, note: '[Gestor] Formulário' });
});

test('candidatura: tipo de trabalho com esta atividade fica por escolher o projeto (não "à mão"); escolhido em "Alterar" segue', () => {
  const lin = [lp('', { tipo: 'ACTIVITY', atividade: 'APPLICATION_PREP', projeto: null, horas: 2, nota: '[Gestor]' })];
  const d = dadosCand();
  const antes = I.planear({ pacote: pacote(lin), dados: d, memoria: {}, edicoes: {} });
  assert.equal(antes.linhas[0].estado, 'escolher'); assert.equal(antes.linhas[0].tipo, 'APPLICATION');
  const depois = I.planear({ pacote: pacote(lin), dados: d, memoria: {}, edicoes: { 0: { destino: 'candidatura', id: 1 } } });
  assert.equal(depois.linhas[0].estado, 'ok'); assert.equal(I.corpoGravacao(depois, d, pacote(lin)).entries[0].project_id, 1);
});

test('candidatura: qualquer linha de projeto pode ser reajustada para candidatura; sem a atividade no orcprev não deixa', () => {
  const d = dadosCand();
  const p = I.planear({ pacote: pacote([linhaProj()]), dados: d, memoria: {}, edicoes: { 0: { destino: 'candidatura', id: 2 } } });
  assert.equal(p.linhas[0].tipo, 'APPLICATION'); assert.equal(p.linhas[0].atividade, 'APPLICATION_PREP'); assert.equal(p.linhas[0].nota, '[Gestor] Reunião com cliente');
  const semAtividade = I.planear({ pacote: pacote([linhaProj()]), dados: dados([], { activities: [{ code: 'OTHER' }] }), memoria: {}, edicoes: { 0: { destino: 'candidatura', id: 2 } } });
  assert.equal(semAtividade.linhas[0].estado, 'escolher');
  assert.deepEqual(I.atividadesComProjeto(d), ['APPLICATION_PREP']);
  assert.deepEqual(I.atividadesLivres(d).map(a => a.code), ['OTHER']); // as livres nunca incluem as que pedem projeto ou serviço
  const mem = I.memorizar({}, p, { 0: { destino: 'candidatura', id: 2, lembrar: true } });
  assert.deepEqual(mem['d:2026/1'], { t: 'candidatura', id: 2 });
});

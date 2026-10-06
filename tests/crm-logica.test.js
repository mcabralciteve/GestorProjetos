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

// ============================ Fase 2 ============================
test('períodos predefinidos', () => {
  assert.deepEqual(C.periodoPreset('ano', '2026-10-06'), { de: '2026-01-01', ate: '2026-12-31' });
  assert.deepEqual(C.periodoPreset('trimestre', '2026-10-06'), { de: '2026-10-01', ate: '2026-12-31' });
  assert.deepEqual(C.periodoPreset('trimestre', '2026-05-31'), { de: '2026-04-01', ate: '2026-06-30' });
  assert.deepEqual(C.periodoPreset('12m', '2026-10-06'), { de: '2025-10-07', ate: '2026-10-06' });
  assert.deepEqual(C.periodoPreset('todo', '2026-10-06'), { de: null, ate: null });
});

test('pipeline por etapa só tem as abertas e pondera pela probabilidade da etapa', () => {
  const ops = [op('1', 'e1', 1000), op('2', 'e1', 3000), op('3', 'e2', 2000), op('4', 'e3', 9999)];
  const r = C.pipelinePorEtapa(ops, C.etapasDoTipo(etapas, 'T1'));
  assert.deepEqual(r.map(x => x.etapa.id), ['e1', 'e2']);
  assert.deepEqual([r[0].n, r[0].valor, r[0].ponderado], [2, 4000, 400]);
  assert.deepEqual([r[1].n, r[1].valor, r[1].ponderado], [1, 2000, 1000]);
});

test('previsão por mês: ponderado, atrasadas e sem data à parte; ganhas/perdidas fora', () => {
  const ops = [
    op('1', 'e2', 1000, { data_prevista_fecho: '2026-11-15' }), op('2', 'e1', 2000, { data_prevista_fecho: '2026-11-30' }),
    op('3', 'e2', 4000, { data_prevista_fecho: '2026-12-01' }), op('4', 'e2', 500, { data_prevista_fecho: '2026-09-01' }),
    op('5', 'e1', 800, {}), op('6', 'e3', 7000, { data_prevista_fecho: '2026-11-01' })
  ];
  const r = C.previsaoPorMes(ops, porId, '2026-10-06');
  assert.deepEqual(r.meses.map(m => [m.mes, m.n, m.valor, m.ponderado]), [['2026-11', 2, 3000, 500 + 200], ['2026-12', 1, 4000, 2000]]);
  assert.deepEqual([r.atrasadas.n, r.atrasadas.ponderado], [1, 250]);
  assert.deepEqual([r.semData.n, r.semData.valor], [1, 800]);
});

test('fechadas no período, por mês, conversão e motivos de perda', () => {
  const motivos = C.indexarPorId([{ id: 'm1', nome: 'Preço' }, { id: 'm2', nome: 'Prazo' }]);
  const ops = [
    op('1', 'e3', 1000, { data_fecho: '2026-09-10' }), op('2', 'e3', 2000, { data_fecho: '2026-10-02' }),
    op('3', 'e4', 500, { data_fecho: '2026-09-20', motivo_perda_id: 'm1' }), op('4', 'e4', 700, { data_fecho: '2026-10-03', motivo_perda_id: 'm1' }),
    op('5', 'e4', 100, { data_fecho: '2026-10-04', motivo_perda_id: 'm2' }), op('6', 'e4', 50, { data_fecho: '2026-10-05' }),
    op('7', 'e3', 9000, { data_fecho: '2025-01-01' }), op('8', 'e1', 10, {})
  ];
  const r = C.resumoFechadas(ops, porId, '2026-01-01', '2026-12-31');
  assert.deepEqual([r.ganhas.n, r.ganhas.valor, r.perdidas.n, r.perdidas.valor], [2, 3000, 4, 1350]);
  assert.equal(r.conversao, 2 / 6);
  assert.equal(C.resumoFechadas(ops, porId, null, null).ganhas.n, 3);
  assert.deepEqual(C.fechadasPorMes(ops, porId, '2026-01-01', '2026-12-31').map(m => [m.mes, m.ganhas.n, m.perdidas.n]), [['2026-09', 1, 1], ['2026-10', 1, 3]]);
  assert.deepEqual(C.motivosDePerda(ops, motivos, porId, '2026-01-01', '2026-12-31').map(m => [m.nome, m.n]), [['Preço', 2], ['Prazo', 1], ['Sem motivo registado', 1]]);
});

test('oportunidades em risco: fecho ultrapassado e/ou sem follow-up pendente', () => {
  const ops = [
    op('a', 'e1', 100, { data_prevista_fecho: '2026-09-01' }),       // atrasada e sem follow-up
    op('b', 'e1', 900, { data_prevista_fecho: '2026-12-01' }),       // sem follow-up
    op('c', 'e2', 500, { data_prevista_fecho: '2026-12-01' }),       // tem follow-up pendente
    op('d', 'e3', 500, {})                                            // ganha: não conta
  ];
  const tarefas = [{ oportunidade_id: 'c', concluida: false }, { oportunidade_id: 'b', concluida: true }];
  const r = C.emRisco(ops, porId, tarefas, '2026-10-06');
  assert.deepEqual(r.map(x => x.op.id), ['a', 'b']);                  // a (2 motivos) antes de b (maior valor, 1 motivo)
  assert.deepEqual(r[0].motivos, ['fecho previsto ultrapassado', 'sem follow-up marcado']);
});

test('CSV: separador ; , tab, aspas, vírgulas dentro de aspas, BOM e linhas vazias', () => {
  assert.deepEqual(C.parseCsv('﻿nome;nif\r\nAna;123\r\n\r\n"Silva; Lda";456\r\n'), [['nome', 'nif'], ['Ana', '123'], ['Silva; Lda', '456']]);
  assert.deepEqual(C.parseCsv('a,b\n"x, y","diz ""olá"""\n'), [['a', 'b'], ['x, y', 'diz "olá"']]);
  assert.deepEqual(C.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('mapeamento automático de colunas (PT e EN), cada coluna serve um só campo', () => {
  const m = C.autoMapear(['Razão Social', 'NIPC', 'Setor de Atividade', 'Dimensão', 'Cidade', 'Website', 'Estado', 'Observações'], C.CAMPOS_CONTA);
  assert.deepEqual([m.nome, m.nif, m.setor, m.dimensao, m.morada, m.website, m.estado, m.notas], [0, 1, 2, 3, 4, 5, 6, 7]);
  const c = C.autoMapear(['Full Name', 'Company', 'VAT', 'Job Title', 'E-mail', 'Mobile'], C.CAMPOS_CONTACTO);
  assert.deepEqual([c.nome, c.conta_nome, c.conta_nif, c.cargo, c.email, c.telefone], [0, 1, 2, 3, 4, 5]);
  const vazio = C.autoMapear(['X', 'Y'], C.CAMPOS_CONTA);
  assert.equal(vazio.nome, -1);
});

test('importar contas: novas, duplicadas (existentes e no ficheiro) e inválidas', () => {
  const existentes = [{ id: 'c1', nome: 'Têxtil do Ave, Lda.', nif: '500123456' }];
  const matriz = [
    ['Empresa', 'NIF', 'Estado', 'Dimensão'],
    ['Nova Um', '999111222', 'Cliente', 'pequena'],
    ['textil do ave', '', '', ''],                  // duplicada de existente (nome)
    ['Outra', '500 123 456', '', ''],              // duplicada de existente (NIF)
    ['Nova um', '', '', ''],                         // duplicada dentro do ficheiro
    ['', '123', '', ''],                             // sem nome
    ['', '', '', ''],                                // linha vazia ignora-se
    ['Nova Dois', '', 'lead', 'Grande']
  ];
  const mapa = C.autoMapear(matriz[0], C.CAMPOS_CONTA);
  const r = C.prepararContas(matriz, mapa, existentes, { estadoPadrao: 'prospeto' });
  assert.deepEqual(r.novas.map(x => [x.nome, x.estado, x.dimensao]), [['Nova Um', 'ativo', 'Pequena'], ['Nova Dois', 'prospeto', 'Grande']]);
  assert.deepEqual(r.duplicadas.map(x => [x.linha, x.noFicheiro]), [[3, false], [4, false], [5, true]]);
  assert.deepEqual(r.invalidas, [{ linha: 6, motivo: 'Sem nome' }]);
});

test('importar contactos: liga por NIF ou nome, cria contas se pedido, duplicados e emails inválidos', () => {
  const contas = [{ id: 'c1', nome: 'Têxtil do Ave, Lda.', nif: '500123456' }, { id: 'c2', nome: 'Energia Verde SA', nif: '' }];
  const existentes = [{ conta_id: 'c1', nome: 'Ana Martins', email: 'ana@x.pt' }];
  const matriz = [
    ['Nome', 'Empresa', 'NIF', 'Email', 'Cargo'],
    ['Rui Costa', 'energia verde', '', 'rui@ev.pt', 'CEO'],
    ['Ana Martins', '', '500123456', '', ''],                     // já existe (nome) na conta c1
    ['Outra Ana', '', '500123456', 'ana@x.pt', ''],               // já existe (email) na conta c1
    ['Maria', 'Empresa Nova', '', 'email-invalido', ''],
    ['Pedro', 'Empresa Nova', '', 'p@nova.pt', ''],
    ['Sem Empresa', '', '', '', ''],
    ['', 'Energia Verde SA', '', '', '']
  ];
  const mapa = C.autoMapear(matriz[0], C.CAMPOS_CONTACTO);
  const sem = C.prepararContactos(matriz, mapa, contas, existentes, { criarContas: false });
  assert.deepEqual(sem.novos.map(x => x.nome), ['Rui Costa']);
  assert.equal(sem.novos[0].conta_id, 'c2');
  assert.deepEqual(sem.semConta.map(x => x.nome), ['Maria', 'Pedro', 'Sem Empresa']);
  assert.deepEqual(sem.duplicados.map(x => x.linha), [3, 4]);
  const com = C.prepararContactos(matriz, mapa, contas, existentes, { criarContas: true });
  assert.deepEqual(com.contasACriar.map(x => x.nome), ['Empresa Nova']);   // uma só conta para os dois
  assert.deepEqual(com.novos.map(x => x.nome), ['Rui Costa', 'Maria', 'Pedro']);
  assert.equal(com.novos[1].conta_ref, com.novos[2].conta_ref);
  assert.equal(com.novos[1].email, '');                                      // inválido ignorado, com aviso
  assert.equal(com.avisos.length, 1);
  assert.deepEqual(com.invalidos.map(x => x.linha), [8]);
});

test('clientes dos projetos sem conta: junta grafias, ignora vazios e os que já têm conta', () => {
  const projetos = [
    { cliente: 'Têxtil do Ave' }, { cliente: 'Textil do Ave, Lda' }, { cliente: 'Calçado Norte' },
    { cliente: 'Calçado Norte' }, { cliente: 'Calçado Norte' }, { cliente: '' }, { cliente: 'Energia Verde SA' }
  ];
  const contas = [{ nome: 'Energia Verde S.A.' }];
  const r = C.clientesDosProjetos(projetos, contas);
  assert.deepEqual(r.map(x => [x.nome, x.projetos]), [['Calçado Norte', 3], ['Têxtil do Ave', 2]]);
});

test('grupos de contas duplicadas (transitivo por NIF e por nome)', () => {
  const contas = [
    { id: '1', nome: 'Alfa Lda', nif: '111', criado_em: '2026-01-02' },
    { id: '2', nome: 'Alfa, Lda.', nif: '', criado_em: '2026-01-01' },        // mesmo nome normalizado de 1
    { id: '3', nome: 'Alfa Industria', nif: '111', criado_em: '2026-01-03' },  // mesmo NIF de 1 -> liga ao grupo
    { id: '4', nome: 'Beta', nif: '', criado_em: '2026-01-01' },
    { id: '5', nome: 'Gama', nif: '222', criado_em: '2026-01-01' }
  ];
  const g = C.gruposDuplicados(contas);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].map(x => x.id), ['2', '1', '3']);                       // a mais antiga primeiro
});

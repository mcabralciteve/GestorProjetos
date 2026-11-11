// Previsão de reconhecimento e faturação (Fase A) — correr com: node --test tests/previsao-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/previsao-logica.js');

const HOJE = '2026-10-26';                              // segunda-feira
const meses = P.mesesHorizonte(HOJE, 4);
const arred = n => Math.round(n * 100) / 100;

test('meses do horizonte começam no mês atual', () => {
  assert.deepEqual(meses, ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(P.mesesHorizonte('2026-12-15', 3), ['2026-12', '2027-01', '2027-02']);
});

test('horas de uma tarefa repartidas pelos dias úteis, por mês', () => {
  // 26/10 a 6/11: 10 dias úteis (5 em outubro, 5 em novembro)
  const d = P.distribuirHorasPorMes('2026-10-20', '2026-11-06', 60, HOJE);
  assert.deepEqual(Object.fromEntries(Object.entries(d).map(([m, h]) => [m, arred(h)])), { '2026-10': 30, '2026-11': 30 });
  // tarefa futura: começa na data de início
  const f = P.distribuirHorasPorMes('2026-12-01', '2026-12-04', 8, HOJE);
  assert.deepEqual(Object.keys(f), ['2026-12']);
  // atrasada (fim no passado) com horas por fazer: mês atual
  assert.deepEqual(P.distribuirHorasPorMes('2026-09-01', '2026-09-30', 12, HOJE), { '2026-10': 12 });
  assert.deepEqual(P.distribuirHorasPorMes('2026-10-30', '2026-11-02', 0, HOJE), {});
  // só fim de semana: não se perde
  assert.deepEqual(P.distribuirHorasPorMes('2026-10-31', '2026-11-01', 5, HOJE), { '2026-10': 5 });
});

test('backlog: valor por reconhecer repartido pelas horas que faltam, a €/h do projeto', () => {
  const r = P.reconhecimentoBacklog({
    valorVendido: 100000, horasVendidas: 100, horasRegistadas: 40,
    tarefas: [{ inicio: '2026-10-20', fim: '2026-11-06', horasPorFazer: 60 }], hojeISO: HOJE, meses
  });
  assert.equal(r.euroHora, 1000); assert.equal(r.reconhecidoHoje, 40000); assert.equal(r.porReconhecer, 60000);
  assert.deepEqual(Object.fromEntries(Object.entries(r.porMes).map(([m, v]) => [m, arred(v)])), { '2026-10': 30000, '2026-11': 30000, '2026-12': 0, '2027-01': 0 });
  assert.equal(r.cobertura, 1); assert.equal(r.naoCalendarizado, 0);
});

test('backlog: o plano nunca reconhece mais do que o valor que falta', () => {
  const r = P.reconhecimentoBacklog({
    valorVendido: 100000, horasVendidas: 100, horasRegistadas: 40,
    tarefas: [{ inicio: '2026-10-26', fim: '2026-11-06', horasPorFazer: 120 }], hojeISO: HOJE, meses
  });
  assert.equal(arred(P.total(r.porMes, meses)), 60000);          // 120 h × 1000 = 120 k€ → reduzido a 60 k€
  assert.equal(r.cobertura, 1);
});

test('backlog: plano curto deixa backlog sem calendário e cobertura < 1; sem plano, tudo por calendarizar', () => {
  const curto = P.reconhecimentoBacklog({ valorVendido: 100000, horasVendidas: 100, horasRegistadas: 40,
    tarefas: [{ inicio: '2026-10-26', fim: '2026-11-06', horasPorFazer: 30 }], hojeISO: HOJE, meses });
  assert.equal(arred(P.total(curto.porMes, meses)), 30000); assert.equal(arred(curto.cobertura), 0.5); assert.equal(arred(curto.naoCalendarizado), 30000);
  const sem = P.reconhecimentoBacklog({ valorVendido: 50000, horasVendidas: 50, horasRegistadas: 0, tarefas: [], hojeISO: HOJE, meses });
  assert.equal(P.total(sem.porMes, meses), 0); assert.equal(sem.naoCalendarizado, 50000); assert.equal(sem.cobertura, 0);
});

test('backlog: projeto concluído em horas (ou acima) não tem nada por reconhecer; sem valor/horas vendidas → null', () => {
  const feito = P.reconhecimentoBacklog({ valorVendido: 10000, horasVendidas: 100, horasRegistadas: 130, tarefas: [{ inicio: '2026-10-26', fim: '2026-11-06', horasPorFazer: 20 }], hojeISO: HOJE, meses });
  assert.equal(feito.porReconhecer, 0); assert.equal(P.total(feito.porMes, meses), 0); assert.equal(feito.cobertura, 1);
  assert.equal(P.reconhecimentoBacklog({ valorVendido: 0, horasVendidas: 100, horasRegistadas: 0, tarefas: [], hojeISO: HOJE, meses }), null);
  assert.equal(P.reconhecimentoBacklog({ valorVendido: 100, horasVendidas: 0, horasRegistadas: 0, tarefas: [], hojeISO: HOJE, meses }), null);
});

test('faturas por emitir: no mês previsto; em atraso → mês atual; fora do horizonte e sem data à parte; emitidas ignoradas', () => {
  const r = P.faturacaoContratada({ hojeISO: HOJE, meses, faturas: [
    { dataPrevista: '2026-12-10', valor: 5000, emitida: false },
    { dataPrevista: '2026-09-15', valor: 2000, emitida: false },       // em atraso
    { dataPrevista: '2026-11-05', valor: 9999, emitida: true },        // já emitida
    { dataPrevista: '2027-06-01', valor: 7000, emitida: false },       // depois do horizonte
    { dataPrevista: '', valor: 1000, emitida: false },                 // sem data
    { dataPrevista: '2026-11-20', valor: 0, emitida: false }
  ] });
  assert.deepEqual(r.porMes, { '2026-10': 2000, '2026-11': 0, '2026-12': 5000, '2027-01': 0 });
  assert.equal(r.emAtraso, 2000); assert.equal(r.nEmAtraso, 1); assert.equal(r.foraDoHorizonte, 7000); assert.equal(r.semData, 1000); assert.equal(r.total, 15000);
});

test('somar, acumular e total de séries mensais', () => {
  const a = { '2026-10': 1, '2026-11': 2 }, b = { '2026-10': 10, '2026-12': 5 };
  const s = P.somar([a, b, null], meses);
  assert.deepEqual(s, { '2026-10': 11, '2026-11': 2, '2026-12': 5, '2027-01': 0 });
  assert.deepEqual(P.acumular(s, meses), { '2026-10': 11, '2026-11': 13, '2026-12': 18, '2027-01': 18 });
  assert.equal(P.total(s, meses), 18);
});

test('tipo do projeto: o definido no projeto manda; senão o do CRM pelo nome; senão sem tipo', () => {
  assert.deepEqual(P.tipoDeProjeto({ tipoProjeto: 'servicos', tipoCrmNome: 'Projetos de I&D' }), { codigo: 'servicos', rotulo: 'Serviços', origem: 'projeto' });
  assert.deepEqual(P.tipoDeProjeto({ tipoProjeto: 'id' }), { codigo: 'id', rotulo: 'I&D', origem: 'projeto' });
  assert.deepEqual(P.tipoDeProjeto({ tipoProjeto: '', tipoCrmNome: 'Projetos de I&D' }), { codigo: 'id', rotulo: 'I&D', origem: 'crm' });
  assert.deepEqual(P.tipoDeProjeto({ tipoCrmNome: 'Serviços' }), { codigo: 'servicos', rotulo: 'Serviços', origem: 'crm' });
  assert.deepEqual(P.tipoDeProjeto({ tipoCrmNome: 'Formação' }), { codigo: '', rotulo: 'Formação', origem: 'crm' });
  assert.deepEqual(P.tipoDeProjeto({ tipoProjeto: 'xpto' }), { codigo: '', rotulo: 'Sem tipo', origem: 'nenhuma' });
  assert.deepEqual(P.tipoDeProjeto({}), { codigo: '', rotulo: 'Sem tipo', origem: 'nenhuma' });
});

// ---------- Fase B: oportunidades ----------
const arr2 = (o, ms) => ms.map(m => arred(o[m]));

test('meses: somar e diferença', () => {
  assert.equal(P.addMeses('2026-11', 3), '2027-02'); assert.equal(P.addMeses('2026-01', -1), '2025-12'); assert.equal(P.addMeses('2026-12', 1), '2027-01');
  assert.equal(P.diffMeses('2026-10', '2027-02'), 4); assert.equal(P.diffMeses('2027-02', '2026-10'), -4);
});

test('início da oportunidade: o previsto; senão fecho + N meses; senão mês seguinte ao atual', () => {
  assert.deepEqual(P.inicioDaOportunidade({ inicioPrevisto: '2026-12-01', dataFecho: '2026-10-30', aposFecho: 1, hojeISO: HOJE }), { mes: '2026-12', origem: 'definido' });
  assert.deepEqual(P.inicioDaOportunidade({ dataFecho: '2026-10-30', aposFecho: 2, hojeISO: HOJE }), { mes: '2026-12', origem: 'defeito' });
  assert.deepEqual(P.inicioDaOportunidade({ dataFecho: '2026-12-15', hojeISO: HOJE }), { mes: '2027-01', origem: 'defeito' });
  assert.deepEqual(P.inicioDaOportunidade({ hojeISO: HOJE }), { mes: '2026-11', origem: 'sem-fecho' });
});

test('oportunidade: valor × peso repartido em partes iguais pela duração; faturação acompanha o trabalho com 1 mês de atraso', () => {
  const ms = P.mesesHorizonte(HOJE, 6);                       // out … mar
  const r = P.oportunidadeNoMapa({ valor: 20000, peso: .5, inicioMes: '2026-11', duracao: 4, plano: [], atrasoFat: 1, hojeISO: HOJE, meses: ms });
  assert.deepEqual(arr2(r.rec, ms), [0, 2500, 2500, 2500, 2500, 0]);
  assert.deepEqual(arr2(r.fat, ms), [0, 0, 2500, 2500, 2500, 2500]);
  assert.equal(r.total, 10000); assert.equal(r.temPlano, false);
});

test('oportunidade: com plano de faturas usa os meses e percentagens; plano que não soma 100% fica assinalado', () => {
  const ms = P.mesesHorizonte(HOJE, 6);
  const r = P.oportunidadeNoMapa({ valor: 18000, peso: 1, inicioMes: '2026-12', duracao: 4, plano: [{ mes: '2027-01', pct: 50 }, { mes: '2027-04', pct: 50 }], atrasoFat: 1, hojeISO: HOJE, meses: ms });
  assert.deepEqual(arr2(r.fat, ms), [0, 0, 0, 9000, 0, 0]);   // abril (2027-04) está fora das 6 mensalidades? out..mar → fica fora
  assert.equal(arred(r.fatFora), 9000);
  const r2 = P.oportunidadeNoMapa({ valor: 1000, peso: 1, inicioMes: '2026-11', duracao: 1, plano: [{ mes: '2026-11', pct: 60 }], hojeISO: HOJE, meses: ms });
  assert.equal(r2.planoSoma, 60);
});

test('oportunidade: início no passado conta só os meses que faltam; trabalho que já devia ter acabado fica no mês atual; plano no passado → mês atual', () => {
  const ms = P.mesesHorizonte(HOJE, 4);
  const a = P.oportunidadeNoMapa({ valor: 12000, peso: 1, inicioMes: '2026-08', duracao: 5, plano: [], hojeISO: HOJE, meses: ms });       // ago..dez: faltam out, nov, dez
  assert.deepEqual(arr2(a.rec, ms), [4000, 4000, 4000, 0]);
  const b = P.oportunidadeNoMapa({ valor: 3000, peso: 1, inicioMes: '2026-05', duracao: 2, plano: [{ mes: '2026-08', pct: 100 }], hojeISO: HOJE, meses: ms });
  assert.deepEqual(arr2(b.rec, ms), [3000, 0, 0, 0]); assert.deepEqual(arr2(b.fat, ms), [3000, 0, 0, 0]);
});

test('oportunidade: o que cai depois do horizonte não entra, mas fica contabilizado', () => {
  const ms = P.mesesHorizonte(HOJE, 3);                       // out, nov, dez
  const r = P.oportunidadeNoMapa({ valor: 12000, peso: 1, inicioMes: '2026-12', duracao: 4, plano: [], hojeISO: HOJE, meses: ms });
  assert.deepEqual(arr2(r.rec, ms), [0, 0, 3000]); assert.equal(arred(r.recFora), 9000);
});

test('datas do trabalho para o projeto: dia 1 do mês de início ao último dia do último mês', () => {
  assert.equal(P.ultimoDiaDoMes('2027-02'), '2027-02-28'); assert.equal(P.ultimoDiaDoMes('2028-02'), '2028-02-29'); assert.equal(P.ultimoDiaDoMes('2026-12'), '2026-12-31');
  assert.deepEqual(P.datasDoTrabalho('2026-12', 4), { inicio: '2026-12-01', fim: '2027-03-31' });
  assert.deepEqual(P.datasDoTrabalho('2026-11', 1), { inicio: '2026-11-01', fim: '2026-11-30' });
});

// ---------- Repartição do reconhecimento pelas equipas dos consultores ----------
const somaPartes = (partes, k) => Object.values(partes).reduce((s, p) => s + p[k], 0);

test('repartir por equipa: a soma das partes é o projeto inteiro e cada mês segue as horas dessa equipa', () => {
  // 10000 € / 100 h = 100 €/h; tarefa de 26/10 a 6/11 (10 dias úteis) com 40 h da DCS e 20 h da RPA; nada registado
  const tarefas = [{ inicio: '2026-10-26', fim: '2026-11-06', horasPorFazer: 60, horasPorEquipa: { DCS: 40, RPA: 20 } }];
  const rec = P.reconhecimentoBacklog({ valorVendido: 10000, horasVendidas: 100, horasRegistadas: 0, tarefas, hojeISO: HOJE, meses });
  const r = P.repartirPorEquipa({ rec, tarefas, equipaProjeto: 'DCS', hojeISO: HOJE, meses });
  assert.equal(arred(r.DCS.porMes['2026-10']), 2000);       // 5 dias de outubro: 30 h × 100 €/h, 2/3 da DCS = 20 h
  assert.equal(arred(r.RPA.porMes['2026-10']), 1000);
  assert.equal(arred(r.DCS.porMes['2026-11']), 2000);
  assert.equal(arred(r.RPA.porMes['2026-11']), 1000);
  assert.equal(arred(somaPartes(r, 'porReconhecer')), arred(rec.porReconhecer));
  assert.equal(arred(somaPartes(r, 'dentroDoHorizonte')), arred(rec.dentroDoHorizonte));
  // 6000 € calendarizados (60 h) + 4000 € sem horas previstas, que ficam na equipa do projeto
  assert.equal(arred(r.DCS.calendarizado), 4000);
  assert.equal(arred(r.RPA.calendarizado), 2000);
  assert.equal(arred(r.DCS.naoCalendarizado), 4000);
  assert.equal(r.RPA.naoCalendarizado, 0);
  assert.equal(arred(r.DCS.porReconhecer), 8000);
  assert.equal(arred(r.RPA.porReconhecer), 2000);
});

test('repartir por equipa: horas em meses diferentes por equipa (a RPA só trabalha em novembro)', () => {
  const tarefas = [
    { inicio: '2026-10-26', fim: '2026-10-30', horasPorFazer: 20, horasPorEquipa: { DCS: 20 } },
    { inicio: '2026-11-02', fim: '2026-11-06', horasPorFazer: 20, horasPorEquipa: { RPA: 20 } }
  ];
  const rec = P.reconhecimentoBacklog({ valorVendido: 4000, horasVendidas: 40, horasRegistadas: 0, tarefas, hojeISO: HOJE, meses });
  const r = P.repartirPorEquipa({ rec, tarefas, equipaProjeto: 'DCS', hojeISO: HOJE, meses });
  assert.equal(arred(r.DCS.porMes['2026-10']), 2000);
  assert.equal(r.DCS.porMes['2026-11'], 0);
  assert.equal(arred(r.RPA.porMes['2026-11']), 2000);
  assert.equal(r.RPA.porMes['2026-10'], 0);
});

test('repartir por equipa: sem horas por consultor, tudo fica na equipa do projeto; sem equipa = chave vazia', () => {
  const rec = P.reconhecimentoBacklog({ valorVendido: 5000, horasVendidas: 50, horasRegistadas: 10, tarefas: [], hojeISO: HOJE, meses });
  const r = P.repartirPorEquipa({ rec, tarefas: [], equipaProjeto: 'DCS', hojeISO: HOJE, meses });
  assert.deepEqual(Object.keys(r), ['DCS']);
  assert.equal(arred(r.DCS.porReconhecer), 4000);
  assert.equal(arred(r.DCS.naoCalendarizado), 4000);
  assert.deepEqual(Object.keys(P.repartirPorEquipa({ rec, tarefas: [], equipaProjeto: '', hojeISO: HOJE, meses })), ['']);
  assert.deepEqual(P.repartirPorEquipa({ rec: null, tarefas: [], equipaProjeto: 'DCS', hojeISO: HOJE, meses }), {});
});

test('repartir por equipa: o teto do backlog mantém-se (plano maior que o valor que falta reduz todas as equipas)', () => {
  const tarefas = [{ inicio: '2026-10-26', fim: '2026-10-30', horasPorFazer: 100, horasPorEquipa: { DCS: 50, RPA: 50 } }];
  const rec = P.reconhecimentoBacklog({ valorVendido: 1000, horasVendidas: 50, horasRegistadas: 0, tarefas, hojeISO: HOJE, meses });
  const r = P.repartirPorEquipa({ rec, tarefas, equipaProjeto: 'DCS', hojeISO: HOJE, meses });
  assert.equal(arred(r.DCS.porMes['2026-10'] + r.RPA.porMes['2026-10']), 1000);
  assert.equal(arred(r.DCS.porReconhecer), 500);
  assert.equal(arred(r.RPA.porReconhecer), 500);
});

test('recDasPartes: soma só as equipas escolhidas e recalcula a cobertura; sem partes dá zeros', () => {
  const tarefas = [{ inicio: '2026-10-26', fim: '2026-11-06', horasPorFazer: 60, horasPorEquipa: { DCS: 40, RPA: 20 } }];
  const rec = P.reconhecimentoBacklog({ valorVendido: 10000, horasVendidas: 100, horasRegistadas: 0, tarefas, hojeISO: HOJE, meses });
  const r = P.repartirPorEquipa({ rec, tarefas, equipaProjeto: 'DCS', hojeISO: HOJE, meses });
  const soRpa = P.recDasPartes(rec, [r.RPA], meses);
  assert.equal(arred(soRpa.porReconhecer), 2000);
  assert.equal(soRpa.cobertura, 1);
  assert.equal(soRpa.euroHora, rec.euroHora);
  const todas = P.recDasPartes(rec, Object.values(r), meses);
  assert.equal(arred(todas.porReconhecer), arred(rec.porReconhecer));
  assert.equal(arred(P.total(todas.porMes, meses)), arred(P.total(rec.porMes, meses)));
  const nenhuma = P.recDasPartes(rec, [], meses);
  assert.equal(nenhuma.porReconhecer, 0);
  assert.equal(nenhuma.cobertura, 1);
});

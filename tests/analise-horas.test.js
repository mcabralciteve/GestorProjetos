// Testes das agregações do separador Análise — correr com: node --test tests/analise-horas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/analise-horas.js');

const item = (data, horas, pessoa, equipa, projeto, tipo = 'Projeto') => ({ data, horas, pessoa, equipa, dept: 'D', projeto, tipo, emProjeto: tipo === 'Projeto' });

test('segunda-feira e períodos', () => {
  assert.equal(A.segunda('2026-09-24'), '2026-09-21');   // quinta -> segunda
  assert.equal(A.segunda('2026-09-27'), '2026-09-21');   // domingo pertence à semana anterior
  assert.equal(A.segunda('2026-09-28'), '2026-09-28');
  assert.equal(A.chavePeriodo('2026-09-24', 'mes'), '2026-09');
  assert.deepEqual(A.periodosEntre('2026-09-10', '2026-09-30', 'semana'), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  assert.deepEqual(A.periodosEntre('2026-11-15', '2027-02-01', 'mes'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(A.rotuloPeriodo('2026-09-21', 'semana'), '21/09');
  assert.equal(A.rotuloPeriodo('2026-09', 'mes'), '09/26');
});

test('intervalos predefinidos', () => {
  assert.deepEqual(A.intervaloPreset('mes', '2026-02-10'), { de: '2026-02-01', ate: '2026-02-28' });
  assert.deepEqual(A.intervaloPreset('mesAnt', '2026-01-05'), { de: '2025-12-01', ate: '2025-12-31' });
  assert.deepEqual(A.intervaloPreset('trimestre', '2026-08-15'), { de: '2026-07-01', ate: '2026-09-30' });
  assert.deepEqual(A.intervaloPreset('ano', '2026-08-15'), { de: '2026-01-01', ate: '2026-12-31' });
  assert.equal(A.intervaloPreset('custom', '2026-08-15'), null);
});

test('totais por chave, ordenados, e KPIs', () => {
  const itens = [item('2026-09-01', 3, 'Ana', 'DCS', 'P1'), item('2026-09-02', 5, 'Bruno', 'DCS', 'P2'), item('2026-09-02', 2, 'Cris', 'ROB', 'P1'), item('2026-09-03', 4, 'Ana', 'DCS', '', 'Formação')];
  assert.deepEqual(A.totaisPor(itens, i => i.equipa), [{ chave: 'DCS', horas: 12 }, { chave: 'ROB', horas: 2 }]);
  const k = A.kpis(itens);
  assert.equal(k.horas, 14); assert.equal(k.pessoas, 3); assert.equal(k.projetos, 2); assert.equal(k.horasProjeto, 10);
  assert.ok(Math.abs(k.pctProjeto - 10 / 14) < 1e-9);
  assert.equal(A.kpis([]).pctProjeto, 0);
});

test('série empilhada: top N com cor, resto em "Outros", períodos vazios presentes', () => {
  const itens = [];
  for (let i = 0; i < 9; i++) itens.push(item('2026-09-08', 10 - i, 'P' + i, 'E' + i, 'X')); // 9 equipas: E0..E8
  itens.push(item('2026-09-22', 1, 'Z', 'E0', 'X'));
  const s = A.seriePorCategoria(itens, 'semana', i => i.equipa, '2026-09-07', '2026-09-27');
  assert.deepEqual(s.periodos, ['2026-09-07', '2026-09-14', '2026-09-21']);
  assert.equal(s.categorias.length, A.MAX_CATEGORIAS + 1);
  assert.equal(s.categorias[0].chave, 'E0');
  assert.equal(s.categorias.at(-1).chave, 'Outros');
  assert.equal(s.categorias.at(-1).cor, A.COR_OUTROS);
  assert.equal(s.categorias.at(-1).total, 3 + 2);            // E7 (3h) + E8 (2h)
  assert.equal(s.totais['2026-09-14'], 0);                    // semana sem registos existe, vazia
  assert.equal(s.valores['2026-09-07'].E0, 10);
  assert.equal(s.valores['2026-09-21'].E0, 1);
  const soma = Object.values(s.totais).reduce((a, b) => a + b, 0);
  assert.equal(soma, itens.reduce((a, i) => a + i.horas, 0)); // nada se perde
});

test('registos fora do intervalo não entram na série', () => {
  const s = A.seriePorCategoria([item('2026-08-01', 5, 'A', 'E', 'P'), item('2026-09-08', 2, 'A', 'E', 'P')], 'mes', i => i.equipa, '2026-09-01', '2026-09-30');
  assert.deepEqual(s.periodos, ['2026-09']);
  assert.equal(s.totais['2026-09'], 2);
});

// ---------- Painéis extra: tipo de atividade, projeto vs outras por pessoa, por cliente ----------
const it2 = (pessoa, horas, tipo, cliente = '') => ({ data: '2026-09-01', horas, pessoa, tipo, emProjeto: tipo === 'Projeto', cliente });

test('composição: maiores com cor própria, resto em "Outros", percentagens somam 1', () => {
  const itens = [it2('A', 10, 'Projeto'), it2('A', 4, 'Formação'), it2('B', 3, 'Comercial'), it2('B', 2, 'Interno'), it2('C', 1, 'Reunião')];
  const c = A.composicao(itens, i => i.tipo, 3);
  assert.deepEqual(c.map(x => x.chave), ['Projeto', 'Formação', 'Comercial', 'Outros']);
  assert.deepEqual(c.map(x => x.horas), [10, 4, 3, 3]);
  assert.equal(c[3].cor, A.COR_OUTROS); assert.equal(c[0].cor, A.PALETA[0]);
  assert.ok(Math.abs(c.reduce((s, x) => s + x.pct, 0) - 1) < 1e-9);
  assert.deepEqual(A.composicao([], i => i.tipo), []);
});

test('projeto vs outras por pessoa: ordenado por horas, com os que ficaram de fora', () => {
  const itens = [it2('Ana', 6, 'Projeto'), it2('Ana', 2, 'Formação'), it2('Bruno', 10, 'Projeto'), it2('Cris', 1, 'Interno')];
  const r = A.projetoVsOutras(itens, 2);
  assert.deepEqual(r.linhas.map(l => l.pessoa), ['Bruno', 'Ana']);
  assert.deepEqual(r.linhas[1], { pessoa: 'Ana', projeto: 6, outras: 2, total: 8 });
  assert.equal(r.restantes, 1);
  assert.equal(A.projetoVsOutras([], 5).linhas.length, 0);
});

test('por cliente: só registos em projeto; sem cliente agrupa-se; fatias circulares seguidas', () => {
  const itens = [it2('A', 5, 'Projeto', 'Alfa'), it2('B', 3, 'Projeto', 'Alfa'), it2('B', 2, 'Projeto', ''), it2('C', 9, 'Formação')];
  const c = A.porCliente(itens, 5);
  assert.deepEqual(c.map(x => [x.chave, x.horas]), [['Alfa', 8], ['Sem cliente', 2]]);
  const fatias = A.fatiasCirculares(c);
  assert.equal(fatias[0].inicio, 0); assert.ok(Math.abs(fatias[1].inicio - 0.8) < 1e-9);
  assert.equal(A.fatiasCirculares([{ chave: 'x', cor: '#000', pct: 0 }]).length, 0);
});

// ---------- Mais gráficos ----------
test('preenchimento: menor primeiro, sem as pessoas sem horas esperadas, e percentagem global', () => {
  const r = A.preenchimento([
    { nome: 'Ana', esperado: 80, registado: 80 }, { nome: 'Bruno', esperado: 80, registado: 40 },
    { nome: 'Cris', esperado: 0, registado: 5 }, { nome: 'Dani', esperado: 40, registado: 44 }], 2);
  assert.deepEqual(r.linhas.map(l => l.nome), ['Bruno', 'Ana']);
  assert.equal(r.linhas[0].pct, 0.5); assert.equal(r.restantes, 1);
  assert.equal(r.esperado, 200); assert.equal(r.registado, 164); assert.ok(Math.abs(r.pctGlobal - 0.82) < 1e-9);
  assert.equal(A.preenchimento([], 5).pctGlobal, 0);
});

test('previsto vs real: mais horas reais primeiro; pct só com previsto', () => {
  const r = A.previstoVsReal([{ chave: 'a', rotulo: 'A', real: 10, previsto: 20, vendido: 30 }, { chave: 'b', rotulo: 'B', real: 50, previsto: 0, vendido: null }, { chave: 'c', rotulo: 'C', real: 5, previsto: 5, vendido: 5 }], 2);
  assert.deepEqual(r.linhas.map(l => l.chave), ['b', 'a']);
  assert.equal(r.linhas[0].pct, null); assert.equal(r.linhas[1].pct, 0.5); assert.equal(r.restantes, 1);
});

test('mapa de calor: horas por pessoa e semana, só as pessoas com mais horas', () => {
  const itens = [it2('Ana', 8, 'Projeto'), { ...it2('Ana', 4, 'Projeto'), data: '2026-09-09' }, { ...it2('Bruno', 3, 'Projeto'), data: '2026-09-09' }, { ...it2('Cris', 1, 'Projeto'), data: '2026-09-30' }];
  const m = A.matrizPessoaSemana(itens, '2026-08-31', '2026-09-30', 'semana', 2);
  assert.deepEqual(m.periodos, ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  assert.deepEqual(m.linhas.map(l => l.pessoa), ['Ana', 'Bruno']);
  assert.deepEqual(m.linhas[0].valores, [8, 4, 0, 0, 0]);       // 1 set (terça) na semana de 31/08; 9 set na de 07/09
  assert.equal(m.restantes, 1);
});

test('dia da semana: segunda = 0, domingo = 6', () => {
  const d = A.porDiaSemana([{ ...it2('A', 2, 'Projeto'), data: '2026-09-21' }, { ...it2('A', 3, 'Projeto'), data: '2026-09-27' }, { ...it2('A', 1, 'Projeto'), data: '2026-09-23' }]);
  assert.deepEqual(d.map(x => x.horas), [2, 0, 1, 0, 0, 0, 3]);
  assert.equal(d[0].rotulo, 'Seg'); assert.equal(d[6].rotulo, 'Dom');
});

test('acumulado semanal: previsto reparte pelos dias úteis; real pára na semana de hoje', () => {
  const r = A.acumuladoSemanal({
    registos: [{ data: '2026-09-22', horas: 6 }, { data: '2026-09-29', horas: 4 }],
    tarefas: [{ inicio: '2026-09-21', fim: '2026-10-02', horas: 20 }],     // 10 dias úteis, 2 h/dia → 10 h por semana
    hojeISO: '2026-09-24'
  });
  assert.deepEqual(r.semanas, ['2026-09-21', '2026-09-28']);
  assert.deepEqual(r.previsto.map(x => Math.round(x * 100) / 100), [10, 20]);
  assert.deepEqual(r.real, [6, null]);                                      // 2.ª semana é futura: sem linha real
  assert.equal(r.semanaHoje, '2026-09-21');
  assert.deepEqual(A.acumuladoSemanal({ registos: [], tarefas: [], hojeISO: '2026-09-24' }).semanas, []);
  // fim de semana dentro do prazo não recebe horas
  const fds = A.acumuladoSemanal({ registos: [], tarefas: [{ inicio: '2026-09-26', fim: '2026-09-28', horas: 8 }], hojeISO: '2026-09-30' });
  assert.deepEqual(fds.previsto.map(x => Math.round(x * 100) / 100), [0, 8]);
});

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

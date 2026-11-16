// Calendário de Ausências — correr com: node --test tests/ausencias-calendario.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/ausencias-calendario.js');

// Novembro de 2026: dia 2 é segunda-feira; 7-8, 14-15, 21-22 são fins de semana. Feriado inventado a 11 (quarta).
const FERIADOS = new Set(['2026-11-11']);
const bloqueado = iso => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 || d === 6 || FERIADOS.has(iso); };
const aus = (id, tipo, ini, fim, estado) => ({ id, recursoId: 'r1', tipo, dataInicio: ini, dataFim: fim, estado: estado || 'aprovada' });
const per = l => l.map(x => `${x.tipo} ${x.dataInicio}..${x.dataFim}`);

test('categoria: os nomes dos tipos de trabalho caem numa das quatro categorias', () => {
  assert.equal(C.categoria('Férias'), 'Férias');
  assert.equal(C.categoria('Baixa Médica'), 'Baixa');
  assert.equal(C.categoria('Formação'), 'Formação');
  assert.equal(C.categoria('Ausência justificada'), 'Outro');
  assert.equal(C.categoria(''), 'Outro');
  assert.equal(C.classe('Baixa Médica'), 'baixa');
});

test('seleção inicial: todos os dias dos registos não rejeitados, com o tipo de cada um', () => {
  const s = C.selecaoDeAusencias([aus('a', 'Férias', '2026-11-02', '2026-11-03'), aus('b', 'Baixa Médica', '2026-11-05', '2026-11-05', 'pendente'), aus('c', 'Férias', '2026-11-09', '2026-11-10', 'rejeitada')]);
  assert.deepEqual([...s.entries()], [['2026-11-02', 'Férias'], ['2026-11-03', 'Férias'], ['2026-11-05', 'Baixa Médica']]);
});

test('intervalos: fim de semana e feriado não partem o período; outro tipo ou um dia útil livre partem', () => {
  const m = new Map([['2026-11-05', 'Férias'], ['2026-11-06', 'Férias'], ['2026-11-09', 'Férias'], ['2026-11-10', 'Férias'], ['2026-11-12', 'Férias'],
    ['2026-11-13', 'Baixa'], ['2026-11-17', 'Baixa']]);
  assert.deepEqual(per(C.intervalos(m, bloqueado)), ['Férias 2026-11-05..2026-11-12', 'Baixa 2026-11-13..2026-11-13', 'Baixa 2026-11-17..2026-11-17']);
  // dias bloqueados marcados (vêm dentro de um período gravado) não iniciam nem terminam períodos
  const fds = new Map([['2026-11-07', 'Férias'], ['2026-11-08', 'Férias'], ['2026-11-09', 'Férias']]);
  assert.deepEqual(per(C.intervalos(fds, bloqueado)), ['Férias 2026-11-09..2026-11-09']);
  assert.deepEqual(C.intervalos(new Map(), bloqueado), []);
});

test('diff: sem cliques não há nada a submeter, mesmo com registos seguidos ou a acabar ao fim de semana', () => {
  const base = [aus('a', 'Férias', '2026-11-02', '2026-11-03'), aus('b', 'Férias', '2026-11-04', '2026-11-08'), aus('c', 'Baixa', '2026-11-09', '2026-11-09', 'pendente')];
  const d = C.diff(base, C.selecaoDeAusencias(base), bloqueado);
  assert.deepEqual(d, { aCriar: [], aEliminar: [] });
});

test('diff: marcar dias novos cria só esses períodos — o que já estava aprovado não se toca', () => {
  const base = [aus('a', 'Férias', '2026-11-02', '2026-11-04')];
  const s = C.selecaoDeAusencias(base);
  s.set('2026-11-05', 'Férias');            // dia colado ao período aprovado
  s.set('2026-11-16', 'Formação'); s.set('2026-11-17', 'Formação');
  const d = C.diff(base, s, bloqueado);
  assert.deepEqual(d.aEliminar, []);
  assert.deepEqual(per(d.aCriar), ['Férias 2026-11-05..2026-11-05', 'Formação 2026-11-16..2026-11-17']);
});

test('diff: desmarcar um dia a meio elimina esse registo e recria o que sobra; os outros registos ficam', () => {
  const base = [aus('a', 'Férias', '2026-11-02', '2026-11-06'), aus('b', 'Férias', '2026-11-16', '2026-11-17')];
  const s = C.selecaoDeAusencias(base);
  s.delete('2026-11-04');
  const d = C.diff(base, s, bloqueado);
  assert.deepEqual(d.aEliminar.map(a => a.id), ['a']);
  assert.deepEqual(per(d.aCriar), ['Férias 2026-11-02..2026-11-03', 'Férias 2026-11-05..2026-11-06']);
});

test('diff: mudar o tipo de um dia (desmarcar e marcar outro) substitui o registo e mantém o nome do tipo no resto', () => {
  const base = [aus('a', 'Baixa Médica', '2026-11-02', '2026-11-04')];
  const s = C.selecaoDeAusencias(base);
  s.set('2026-11-04', 'Férias');
  const d = C.diff(base, s, bloqueado);
  assert.deepEqual(d.aEliminar.map(a => a.id), ['a']);
  assert.deepEqual(per(d.aCriar), ['Baixa Médica 2026-11-02..2026-11-03', 'Férias 2026-11-04..2026-11-04']);
});

test('diff: desmarcar tudo elimina sem criar; mexer só em dias bloqueados não conta', () => {
  const base = [aus('a', 'Férias', '2026-11-06', '2026-11-09')];
  const s = C.selecaoDeAusencias(base);
  s.delete('2026-11-07');                    // sábado
  assert.deepEqual(C.diff(base, s, bloqueado), { aCriar: [], aEliminar: [] });
  const d = C.diff(base, new Map(), bloqueado);
  assert.deepEqual(d.aEliminar.map(a => a.id), ['a']);
  assert.deepEqual(d.aCriar, []);
});

test('resumo: dias úteis do ano por categoria, aprovados e em aprovação; rejeitadas e outros anos ficam de fora', () => {
  const base = [
    aus('a', 'Férias', '2026-11-02', '2026-11-10'),                // 2-6 e 9-10 = 7 dias úteis
    aus('b', 'Férias', '2026-11-16', '2026-11-17', 'pendente'),    // 2
    aus('c', 'Baixa Médica', '2026-11-11', '2026-11-12'),          // 11 é feriado → 1
    aus('d', 'Formação', '2026-11-23', '2026-11-23', 'rejeitada'),
    aus('e', 'Férias', '2025-12-30', '2026-01-02')                 // só 1 e 2 de janeiro de 2026 contam
  ];
  const r = C.resumo(base, 2026, bloqueado);
  assert.deepEqual(r.linhas, [{ categoria: 'Férias', aprovados: 9, pendentes: 2 }, { categoria: 'Baixa', aprovados: 1, pendentes: 0 }]);
  assert.equal(r.periodos.length, 4);
  assert.deepEqual(r.periodos[0], { tipo: 'Férias', dataInicio: '2025-12-30', dataFim: '2026-01-02', estado: 'aprovada' });
  // sem ausências: a linha das Férias aparece na mesma, a zeros
  assert.deepEqual(C.resumo([], 2026, bloqueado).linhas, [{ categoria: 'Férias', aprovados: 0, pendentes: 0 }]);
});

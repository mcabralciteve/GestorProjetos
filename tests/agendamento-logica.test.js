// Agendamento pelas dependências — correr com: node --test tests/agendamento-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/agendamento-logica.js');

// 2026-11-09 é segunda-feira.
const tarefa = (id, inicio, fim, extra) => Object.assign({ id, inicio, fim, predecessores: [], modoData: null }, extra || {});
const agendar = (tarefas, feriados) => {
  const mapa = new Map(tarefas.map(t => [t.id, t]));
  return A.relaxar(tarefas, mapa, { feriados: feriados ? new Set(feriados) : null });
};

test('dias úteis: fim de semana, feriados, somar e voltar atrás', () => {
  assert.equal(A.fimDeSemana('2026-11-14'), true);   // sábado
  assert.equal(A.fimDeSemana('2026-11-13'), false);  // sexta
  const fer = new Set(['2026-12-01', '2026-12-08']);
  assert.equal(A.proximoDiaUtil('2026-11-14'), '2026-11-16');
  assert.equal(A.proximoDiaUtil('2026-12-01', fer), '2026-12-02');
  assert.equal(A.somarDiasUteis('2026-11-13', 1), '2026-11-16');
  assert.equal(A.somarDiasUteis('2026-11-16', -1), '2026-11-13');
  assert.equal(A.somarDiasUteis('2026-11-30', 1, fer), '2026-12-02');
  assert.equal(A.diasUteisDaTarefa('2026-11-13', '2026-11-17'), 3);      // sex, seg, ter
  assert.equal(A.diasUteisDaTarefa('2026-11-14', '2026-11-15'), 1);      // só fim de semana: conta 1
  assert.equal(A.fimPorDiasUteis('2026-11-13', 3), '2026-11-17');
  assert.equal(A.inicioPorFim('2026-11-17', 3), '2026-11-13');
});

test('o cenário pedido: 2.ª tarefa posta por engano a 12/12 passa para o dia útil a seguir à 1.ª (modo automático)', () => {
  const a = tarefa('a', '2026-11-09', '2026-11-09');
  const b = tarefa('b', '2026-12-12', '2026-12-12', { predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }], modoData: 'auto' });
  agendar([a, b]);
  assert.deepEqual([b.inicio, b.fim], ['2026-11-10', '2026-11-10']);
});

test('automático: a seguir a uma sexta-feira vai para segunda; salta feriados; mantém a duração em dias úteis', () => {
  const a = tarefa('a', '2026-11-11', '2026-11-13');  // quarta a sexta
  const b = tarefa('b', '2026-11-30', '2026-12-02', { predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }], modoData: 'auto' }); // 3 dias úteis
  agendar([a, b], ['2026-11-16']);   // segunda é feriado
  assert.deepEqual([b.inicio, b.fim], ['2026-11-17', '2026-11-19']);
  const c = tarefa('c', '2026-12-30', '2026-12-30', { predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }], modoData: 'auto' });
  agendar([a, c]);
  assert.equal(c.inicio, '2026-11-16');   // sem feriado: segunda
});

test('automático: atraso em dias úteis, várias predecessoras (a mais tardia manda), SS e FF', () => {
  const a = tarefa('a', '2026-11-09', '2026-11-10');
  const x = tarefa('x', '2026-11-09', '2026-11-13');
  const b = tarefa('b', '2027-01-04', '2027-01-04', { modoData: 'auto', predecessores: [{ id: 'a', tipo: 'FS', atraso: 2 }, { id: 'x', tipo: 'FS', atraso: 0 }] });
  agendar([a, x, b]);
  assert.equal(b.inicio, '2026-11-16');                   // x acaba sexta 13 → segunda 16; a +2 dias úteis = 13 → vence 16
  const ss = tarefa('ss', '2027-01-04', '2027-01-05', { modoData: 'auto', predecessores: [{ id: 'a', tipo: 'SS', atraso: 1 }] });
  agendar([a, ss]);
  assert.deepEqual([ss.inicio, ss.fim], ['2026-11-10', '2026-11-11']);
  const ff = tarefa('ff', '2027-01-04', '2027-01-06', { modoData: 'auto', predecessores: [{ id: 'x', tipo: 'FF', atraso: 0 }] }); // 3 dias úteis
  agendar([x, ff]);
  assert.deepEqual([ff.inicio, ff.fim], ['2026-11-11', '2026-11-13']);
});

test('automático: cadeias — mover o início da primeira arrasta as outras, para a frente e para trás', () => {
  const a = tarefa('a', '2026-11-09', '2026-11-09');
  const b = tarefa('b', '2026-11-10', '2026-11-11', { modoData: 'auto', predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }] });
  const c = tarefa('c', '2026-11-12', '2026-11-12', { modoData: 'auto', predecessores: [{ id: 'b', tipo: 'FS', atraso: 0 }] });
  agendar([c, b, a]);   // ordem trocada de propósito
  assert.deepEqual([b.inicio, b.fim, c.inicio, c.fim], ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-12']);
  a.inicio = a.fim = '2026-11-16';
  agendar([c, b, a]);
  assert.deepEqual([b.inicio, b.fim, c.inicio], ['2026-11-17', '2026-11-18', '2026-11-19']);
  a.inicio = a.fim = '2026-11-02';
  agendar([c, b, a]);
  assert.deepEqual([b.inicio, b.fim, c.inicio], ['2026-11-03', '2026-11-04', '2026-11-05']);
});

test('data fixa: nunca é movida; o conflito é assinalado só quando a predecessora acaba depois', () => {
  const a = tarefa('a', '2026-11-09', '2026-11-13');
  const ok = tarefa('ok', '2026-12-12', '2026-12-12', { modoData: 'fixa', predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }] });
  const mau = tarefa('mau', '2026-11-12', '2026-11-12', { modoData: 'fixa', predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }] });
  const c = agendar([a, ok, mau]);
  assert.deepEqual([ok.inicio, mau.inicio], ['2026-12-12', '2026-11-12']);
  assert.deepEqual(c, [{ tarefaId: 'mau', predId: 'a', tipo: 'FS' }]);
  const mapa = new Map([a, ok, mau].map(t => [t.id, t]));
  assert.equal(A.linkEmConflito(ok, ok.predecessores[0], mapa), false);
  assert.equal(A.linkEmConflito(mau, mau.predecessores[0], mapa), true);
  assert.equal(A.linkEmConflito(Object.assign({}, mau, { modoData: 'auto' }), mau.predecessores[0], mapa), false);
});

test('como até aqui (sem modo): só empurra para a frente, em dias de calendário, e nunca puxa para trás', () => {
  const a = tarefa('a', '2026-11-09', '2026-11-13');
  const tarde = tarefa('tarde', '2026-12-12', '2026-12-12', { predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }] });
  const cedo = tarefa('cedo', '2026-11-10', '2026-11-11', { predecessores: [{ id: 'a', tipo: 'FS', atraso: 0 }] });
  agendar([a, tarde, cedo]);
  assert.equal(tarde.inicio, '2026-12-12');                                  // fica onde está (como hoje)
  assert.deepEqual([cedo.inicio, cedo.fim], ['2026-11-14', '2026-11-15']);   // empurrada, tal como hoje (calendário: sábado)
});

test('pré-visualização para uma ligação nova e predecessora inexistente', () => {
  const a = tarefa('a', '2026-11-09', '2026-11-09');
  const b = tarefa('b', '2026-12-12', '2026-12-12');
  const mapa = new Map([[a.id, a], [b.id, b]]);
  assert.deepEqual(A.alvoAuto(b, mapa, null, [{ id: 'a', tipo: 'FS', atraso: 0 }]), { inicio: '2026-11-10', fim: '2026-11-10' });
  assert.equal(A.alvoAuto(b, mapa, null, [{ id: 'nao-existe', tipo: 'FS', atraso: 0 }]), null);
  const sem = tarefa('s', '2026-12-12', '2026-12-12', { modoData: 'auto', predecessores: [{ id: 'nao-existe', tipo: 'FS', atraso: 0 }] });
  agendar([sem]);
  assert.equal(sem.inicio, '2026-12-12');
});

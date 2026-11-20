// Sync: o intervalo de horas (hora_inicio/hora_fim) só segue para a base de dados se as colunas existirem, e lê-se de volta.
// Correr com: node --test tests/sync-registo-intervalo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar() {
  const inseridos = [];
  const supabaseClient = { from: () => ({ insert: async (linhas) => { inseridos.push(...linhas); return { error: null }; }, delete: () => ({ in: async () => ({ error: null }) }) }) };
  const ctx = { supabaseClient, App: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8'), ctx);
  return { Sync: vm.runInContext('Sync', ctx), inseridos };
}
const registo = (extra) => Object.assign({ id: 'r1', data: '2026-11-20', pessoa: 'Hugo', projetoId: null, projetoIdInterno: '', projetoNome: '', tarefaNome: '', horas: 2.5, notas: '', origem: 'app' }, extra);

test('com as colunas: o intervalo vai na linha; sem intervalo vai null', async () => {
  const { Sync, inseridos } = montar();
  Sync.temIntervalo = true;
  await Sync.sincronizarRegistos([], [registo({ horaInicio: '14:00', horaFim: '16:30' }), registo({ id: 'r2' })]);
  assert.equal(inseridos[0].hora_inicio, '14:00');
  assert.equal(inseridos[0].hora_fim, '16:30');
  assert.equal(inseridos[1].hora_inicio, null);
  assert.equal(inseridos[1].hora_fim, null);
});

test('sem as colunas na base de dados: nada disto é enviado (para não rebentar a gravação)', async () => {
  const { Sync, inseridos } = montar();
  Sync.temIntervalo = false;
  await Sync.sincronizarRegistos([], [registo({ horaInicio: '14:00', horaFim: '16:30' })]);
  assert.equal('hora_inicio' in inseridos[0], false);
  assert.equal('hora_fim' in inseridos[0], false);
});

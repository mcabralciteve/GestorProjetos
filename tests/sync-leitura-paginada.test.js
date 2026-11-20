// Sync.lerTudo: o Supabase corta cada pedido às 1000 linhas — lê-se por páginas até acabar.
// Correr com: node --test tests/sync-leitura-paginada.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Servidor de mentira: uma tabela de N linhas, que respeita a ordem pedida e devolve no máximo 1000 por pedido (como o real).
function montar(linhas, { erroNaPagina } = {}) {
  const pedidos = [];
  const supabaseClient = {
    from(tabela) {
      const p = { tabela, ordens: [] };
      const q = {
        select() { return q; },
        order(col, opc) { p.ordens.push(col + (opc && opc.ascending === false ? ' desc' : '')); return q; },
        range(de, ate) {
          p.de = de; p.ate = ate; pedidos.push(p);
          if (erroNaPagina !== undefined && pedidos.length === erroNaPagina) return Promise.resolve({ data: null, error: { message: 'falhou' } });
          return Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null });
        }
      };
      return q;
    }
  };
  const ctx = { supabaseClient, App: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8'), ctx);
  return { Sync: vm.runInContext('Sync', ctx), pedidos };
}
const tabela = n => Array.from({ length: n }, (_, i) => ({ id: 'id' + String(i).padStart(5, '0') }));

test('1208 linhas (mais do que o limite de 1000): vêm todas, sem repetir', async () => {
  const { Sync, pedidos } = montar(tabela(1208));
  const r = await Sync.lerTudo('registos');
  assert.equal(r.error, null);
  assert.equal(r.data.length, 1208);
  assert.equal(new Set(r.data.map(x => x.id)).size, 1208);
  assert.equal(pedidos.length, 2);
  assert.deepEqual(pedidos.map(p => [p.de, p.ate]), [[0, 999], [1000, 1999]]);
});

test('múltiplo exato de 1000: faz um pedido a mais, vazio, e acaba', async () => {
  const { Sync, pedidos } = montar(tabela(2000));
  const r = await Sync.lerTudo('registos');
  assert.equal(r.data.length, 2000);
  assert.equal(pedidos.length, 3);
});

test('tabela pequena ou vazia: um só pedido', async () => {
  for (const n of [0, 5, 999]) {
    const { Sync, pedidos } = montar(tabela(n));
    const r = await Sync.lerTudo('faturas');
    assert.equal(r.data.length, n);
    assert.equal(pedidos.length, 1);
  }
});

test('ordem estável: as ordens pedidas e depois a chave (id por omissão, ou a chave composta)', async () => {
  const { Sync, pedidos } = montar(tabela(3));
  await Sync.lerTudo('tarefas', ['ordem']);
  await Sync.lerTudo('tarefa_recursos', [], ['tarefa_id', 'recurso_id']);
  await Sync.lerTudo('x', [{ col: 'data', asc: false }]);
  assert.deepEqual(pedidos.map(p => p.ordens), [['ordem', 'id'], ['tarefa_id', 'recurso_id'], ['data desc', 'id']]);
});

test('erro numa página: devolve o erro (não dados incompletos)', async () => {
  const { Sync } = montar(tabela(2500), { erroNaPagina: 2 });
  const r = await Sync.lerTudo('registos');
  assert.equal(r.data, null);
  assert.equal(r.error.message, 'falhou');
});

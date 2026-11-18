// Sync: ao mover uma fatura de um projeto para outro, grava-se primeiro o que ganhou — correr com: node --test tests/sync-fatura-ordem.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar() {
  const log = [];
  const supabaseClient = {
    from: () => ({
      upsert: async (row) => { log.push('projeto ' + row.id); return { error: null }; },
      delete: () => ({ in: async () => ({ error: null }) })
    }),
    rpc: async (nome, args) => { log.push('filhos ' + args.p_projeto_id + ' [' + args.p_faturas.map(f => f.id).join(',') + ']'); return { error: null }; }
  };
  const ctx = { supabaseClient, App: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8'), ctx);
  return { Sync: vm.runInContext('Sync', ctx), log };
}
const proj = (id, faturas) => ({ id, idInterno: id, nome: id, cliente: '', tarefas: [], faturas: faturas.map(i => ({ id: i, dataPrevista: '2026-12-01', tipo: 'valor', percentagem: 0, valor: 100, emitida: false })) });

test('fatura movida de A para B: B (que ganhou a fatura) grava-se antes de A, mesmo vindo depois na lista', async () => {
  const { Sync, log } = montar();
  const antes = { A: proj('A', ['f1', 'f2']), B: proj('B', ['f9']) };
  const depois = { A: proj('A', ['f2']), B: proj('B', ['novo', 'f9']) };
  await Sync.sincronizarProjetos(antes, depois);
  assert.deepEqual(log.filter(l => l.startsWith('filhos')), ['filhos B [novo,f9]', 'filhos A [f2]']);
});

test('sem faturas movidas a ordem não muda; projetos iguais não se gravam', async () => {
  const { Sync, log } = montar();
  const antes = { A: proj('A', ['f1']), B: proj('B', ['f2']), C: proj('C', []) };
  const depois = { A: proj('A', ['f1', 'f3']), B: proj('B', ['f2']), C: proj('C', ['f4']) };
  depois.A.nome = 'A2';
  await Sync.sincronizarProjetos(antes, depois);
  assert.deepEqual(log.filter(l => l.startsWith('projeto')), ['projeto A', 'projeto C']);
  const iguais = montar();
  await iguais.Sync.sincronizarProjetos(antes, JSON.parse(JSON.stringify(antes)));
  assert.deepEqual(iguais.log, []);
});

// Horas reais por tarefa, calculadas de uma vez — correr com: node --test tests/horas-reais-logica.test.js
// Compara com a versão antiga (tarefa a tarefa), copiada tal como era em App.horasReaisTarefa, em muitos casos aleatórios.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/horas-reais-logica.js');

// Referência: a lógica original de App.horasReaisTarefa.
function referencia(p, t, registos, recursos) {
  const normalizar = (s) => String(s || '').trim().toLowerCase();
  const temFilhos = (id) => p.tarefas.some(x => x.parentId === id);
  const filhosDe = (id) => p.tarefas.filter(x => x.parentId === id);
  const registoPertenceAoProjeto = (r) => r.projetoId ? r.projetoId === p.id : (!!p.idInterno && r.projetoIdInterno === p.idInterno);
  const nomeTarefa = normalizar(t.nome);
  const idsTarefas = new Set(p.tarefas.map(x => x.id));
  const ligado = (r) => !!r.tarefaId && idsTarefas.has(r.tarefaId);
  const registosProjeto = registos.filter(registoPertenceAoProjeto);
  const nomesTodasTarefas = new Set(p.tarefas.map(x => normalizar(x.nome)));
  const nomeUnico = p.tarefas.filter(x => normalizar(x.nome) === nomeTarefa).length === 1;
  const diretas = registosProjeto.reduce((soma, r) => {
    if (ligado(r)) return r.tarefaId === t.id ? soma + (parseFloat(r.horas) || 0) : soma;
    const nomeRegisto = normalizar(r.tarefaNome);
    return nomeUnico && nomeRegisto && nomeRegisto === nomeTarefa ? soma + (parseFloat(r.horas) || 0) : soma;
  }, 0);
  if (temFilhos(t.id)) return diretas + filhosDe(t.id).reduce((soma, filho) => soma + referencia(p, filho, registos, recursos), 0);
  const semCorrespondencia = registosProjeto.reduce((soma, r) => {
    if (ligado(r)) return soma;
    const nomeRegisto = normalizar(r.tarefaNome);
    if (nomeRegisto && nomesTodasTarefas.has(nomeRegisto)) return soma;
    const recurso = recursos.find(x => normalizar(x.nome) === normalizar(r.pessoa));
    if (!recurso || !t.recursoIds.includes(recurso.id)) return soma;
    const outras = p.tarefas.filter(x => x.id !== t.id && !temFilhos(x.id) && x.recursoIds.includes(recurso.id));
    return outras.length === 0 ? soma + (parseFloat(r.horas) || 0) : soma;
  }, 0);
  return diretas + semCorrespondencia;
}

// Gerador pseudo-aleatório com semente (resultados repetíveis).
function gerador(semente) { let s = semente; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

function cenario(semente) {
  const rnd = gerador(semente), esc = (a) => a[Math.floor(rnd() * a.length)];
  const recursos = ['Ana Sofia', 'Rui Costa', 'João Álvaro', 'Maria Leal'].map((nome, i) => ({ id: 'r' + i, nome }));
  const nomes = ['Relatório', 'Auditoria', 'Sessão', 'Formação', 'Análise', 'Revisão'];
  const tarefas = [];
  const nFases = 1 + Math.floor(rnd() * 3);
  for (let f = 0; f < nFases; f++) tarefas.push({ id: 'f' + f, nome: 'Fase ' + f, parentId: null, recursoIds: rnd() < 0.3 ? [esc(recursos).id] : [] });
  const nT = 3 + Math.floor(rnd() * 10);
  for (let i = 0; i < nT; i++) {
    const pai = rnd() < 0.8 ? 'f' + Math.floor(rnd() * nFases) : (tarefas.length && rnd() < 0.5 ? esc(tarefas).id : null);
    const rec = []; if (rnd() < 0.8) rec.push(esc(recursos).id); if (rnd() < 0.3) rec.push(esc(recursos).id);
    tarefas.push({ id: 't' + i, nome: esc(nomes) + (rnd() < 0.5 ? ' ' + Math.floor(rnd() * 3) : ''), parentId: pai, recursoIds: rec });
  }
  const p = { id: 'p1', idInterno: '2026/001', nome: 'P', tarefas };
  const registos = [];
  for (let i = 0; i < 60; i++) {
    const tipo = rnd();
    const nomePessoa = esc(recursos).nome;
    const r = { id: 'x' + i, pessoa: rnd() < 0.3 ? nomePessoa.toLowerCase() : nomePessoa, horas: esc([1, 2.5, 4, 7.5, '3', '', null]), tarefaNome: '', tarefaId: null };
    if (tipo < 0.25) r.projetoId = esc(['p1', 'p1', 'p2']); else if (tipo < 0.4) r.projetoIdInterno = esc(['2026/001', '2026/999']); else r.projetoId = 'p1';
    const q = rnd();
    if (q < 0.45) r.tarefaId = esc(tarefas).id;
    else if (q < 0.55) r.tarefaId = 'fantasma';
    else if (q < 0.8) r.tarefaNome = esc(tarefas).nome + (rnd() < 0.3 ? '  ' : '');
    else if (q < 0.9) r.tarefaNome = 'Texto livre ' + Math.floor(rnd() * 3);
    registos.push(r);
  }
  return { p, registos, recursos };
}

test('igual à versão tarefa a tarefa em 300 cenários aleatórios', () => {
  for (let semente = 1; semente <= 300; semente++) {
    const { p, registos, recursos } = cenario(semente);
    const todas = H.porTarefa(p, registos, recursos);
    p.tarefas.forEach(t => {
      const esperado = referencia(p, t, registos, recursos);
      assert.ok(Math.abs(todas.get(t.id) - esperado) < 1e-9, `cenário ${semente}, tarefa ${t.id}: ${todas.get(t.id)} ≠ ${esperado}`);
    });
  }
});

test('casos concretos: nome único conta, repetido não; só a única tarefa da pessoa recebe os registos soltos; resumo soma as filhas', () => {
  const recursos = [{ id: 'r1', nome: 'Ana' }];
  const p = { id: 'p', idInterno: 'I', tarefas: [
    { id: 'fase', nome: 'Fase', parentId: null, recursoIds: [] },
    { id: 'a', nome: 'Relatório', parentId: 'fase', recursoIds: ['r1'] },
    { id: 'b', nome: 'Sessão', parentId: 'fase', recursoIds: [] },
    { id: 'c', nome: 'Sessão', parentId: 'fase', recursoIds: [] }
  ] };
  const reg = (extra) => Object.assign({ projetoId: 'p', horas: 2, pessoa: 'ana', tarefaNome: '', tarefaId: null }, extra);
  const m = H.porTarefa(p, [reg({ tarefaId: 'a' }), reg({ tarefaNome: ' relatório ' }), reg({ tarefaNome: 'Sessão' }), reg({ tarefaNome: 'texto solto' }), reg({ projetoId: 'outro' })], recursos);
  assert.equal(m.get('a'), 2 + 2 + 2);   // por id + por nome (único) + solto (única tarefa da Ana)
  assert.equal(m.get('b'), 0); assert.equal(m.get('c'), 0); // "Sessão" repete-se: fica por atribuir
  assert.equal(m.get('fase'), 6);
  const duas = { id: 'p', idInterno: 'I', tarefas: p.tarefas.map(t => t.id === 'b' ? Object.assign({}, t, { recursoIds: ['r1'] }) : t) };
  assert.equal(H.porTarefa(duas, [reg({ tarefaNome: 'texto solto' })], recursos).get('a'), 0); // a Ana tem duas folhas: o registo solto não se atribui
});

test('projeto sem tarefas ou sem registos não rebenta', () => {
  assert.equal(H.porTarefa({ id: 'p', tarefas: [] }, [], []).size, 0);
  assert.equal(H.porTarefa({ id: 'p', tarefas: [{ id: 'a', nome: 'x', parentId: null, recursoIds: [] }] }, null, null).get('a'), 0);
});

// Pessoas inativas — correr com: node --test tests/pessoas-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pessoas-logica.js');

const HOJE = '2026-10-15';
const estado = () => ({
  recursos: [
    { id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }, { id: 'c', nome: 'Carla' },
    { id: 'adm1', nome: 'Admin 1' }, { id: 'adm2', nome: 'Admin 2', dataSaida: '2026-10-01' }
  ],
  utilizadores: [
    { id: 'u1', recursoId: 'adm1', papel: 'admin' }, { id: 'u2', recursoId: 'adm2', papel: 'admin' }, { id: 'u3', recursoId: 'a', papel: 'user' }
  ],
  equipas: [{ id: 'e1', nome: 'DCS', liderId: 'a' }, { id: 'e2', nome: 'ROB', liderId: null }],
  departamentos: [{ id: 'd1', nome: 'DTD', diretorId: 'b' }],
  historicoEquipas: [{ recursoId: 'a', equipaId: 'e1' }],
  registos: [{ pessoa: 'Ana', horas: 4 }, { pessoa: 'Ana', horas: 2 }, { pessoa: 'Bruno', horas: 1 }],
  ausencias: [{ recursoId: 'a' }],
  projetos: {
    p1: { id: 'p1', idInterno: '2026/1', nome: 'Alfa', cliente: 'Cli', gestorId: 'a',
      tarefas: [
        { id: 't1', nome: 'Diagnóstico', recursoIds: ['a', 'b'], alocacoesHoras: { a: 20, b: 5 }, progresso: 40, inicio: '2026-10-01', fim: '2026-11-01' },
        { id: 't2', nome: 'Relatório', recursoIds: ['a'], alocacoesHoras: { a: 8 }, progresso: 100 },
        { id: 't3', nome: 'Sem horas', recursoIds: ['a'], alocacoesHoras: {}, progresso: 0 }
      ],
      proximosPassos: [{ id: 'n1', responsavelId: 'a', descricao: 'Enviar', estado: 'aberto' }, { id: 'n2', responsavelId: 'a', descricao: 'Feito', estado: 'concluido' }] },
    p2: { id: 'p2', nome: 'Beta', gestorId: 'b', ativo: false, tarefas: [{ id: 't4', nome: 'X', recursoIds: ['c'], progresso: 0 }], proximosPassos: [] }
  }
});

test('estado: ativa, a sair (data futura), inativa (marcada ou data passada)', () => {
  assert.equal(P.estado({ id: 'x' }, HOJE), 'ativo');
  assert.equal(P.estado({ dataSaida: '2026-10-31' }, HOJE), 'a-sair');
  assert.equal(P.estado({ dataSaida: HOJE }, HOJE), 'a-sair');            // trabalha até ao próprio dia
  assert.equal(P.estado({ dataSaida: '2026-10-14' }, HOJE), 'inativo');   // passou
  assert.equal(P.estado({ ativo: false }, HOJE), 'inativo');
  assert.equal(P.estado({ ativo: false, dataSaida: '2026-12-01' }, HOJE), 'inativo');
  assert.equal(P.estaInativo(null, HOJE), false);
  assert.equal(P.rotuloEstado({ dataSaida: '2026-10-31' }, HOJE), 'Sai a 31/10/2026');
  assert.equal(P.rotuloEstado({ ativo: false }, HOJE), 'Inativa');
  assert.equal(P.rotuloEstado({}, HOJE), 'Ativa');
});

test('pendências: tarefas por concluir com remanescente, projetos geridos, next steps abertos, liderança', () => {
  const horas = (p, t, rid) => (t.id === 't1' && rid === 'a' ? 12 : 0);
  const r = P.pendencias(estado(), 'a', { horasRegistadas: horas });
  assert.deepEqual(r.tarefas.map(t => t.tarefaNome), ['Diagnóstico', 'Sem horas']);     // a concluída (100%) fica de fora
  const t1 = r.tarefas[0];
  assert.equal(t1.previstas, 20); assert.equal(t1.registadas, 12); assert.equal(t1.restantes, 8);
  assert.equal(r.tarefas[1].restantes, 0);
  assert.deepEqual(r.projetosGeridos.map(p => p.nome), ['Alfa']);
  assert.deepEqual(r.nextSteps.map(n => n.descricao), ['Enviar']);                       // o concluído não conta
  assert.deepEqual(r.equipasLideradas.map(e => e.nome), ['DCS']);
  assert.equal(r.departamentosDirigidos.length, 0);
  assert.equal(r.total, 2 + 1 + 1 + 1 + 0);
  const b = P.pendencias(estado(), 'b', {});
  assert.deepEqual(b.departamentosDirigidos.map(d => d.nome), ['DTD']);
  assert.equal(b.projetosGeridos[0].suspenso, true);
  assert.equal(b.tarefas[0].restantes, 5);                                               // sem registos injetados: previstas
  assert.equal(P.pendencias(estado(), 'zzz', {}).total, 0);
});

test('eliminar: só quem nunca teve nada', () => {
  const e = estado();
  const ana = P.podeEliminar(e, e.recursos[0]);
  assert.equal(ana.pode, false);
  assert.equal(ana.historico.registos, 2); assert.equal(ana.historico.tarefas, 3); assert.equal(ana.historico.conta, true);
  e.recursos.push({ id: 'novo', nome: 'Novo' });
  assert.equal(P.podeEliminar(e, e.recursos[e.recursos.length - 1]).pode, true);
  // só por ter horas registadas (mesmo sem tarefas) já não pode
  e.registos.push({ pessoa: 'Novo', horas: 1 });
  assert.equal(P.podeEliminar(e, e.recursos[e.recursos.length - 1]).pode, false);
});

test('inativar: nunca o único Administrador ativo', () => {
  const e = estado();
  // adm2 já tem data de saída passada (inativo) → adm1 é o único ativo
  assert.equal(P.podeInativar(e, 'adm1', HOJE).ok, false);
  assert.match(P.podeInativar(e, 'adm1', HOJE).motivo, /único Administrador/);
  assert.equal(P.podeInativar(e, 'a', HOJE).ok, true);
  e.recursos.find(r => r.id === 'adm2').dataSaida = null;
  assert.equal(P.podeInativar(e, 'adm1', HOJE).ok, true);                                // há outro ativo
  assert.equal(P.podeInativar(e, 'nao-existe', HOJE).ok, false);
});

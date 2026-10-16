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

// ---------- Substituição (Fase 2) ----------
const cenario = () => {
  const e = estado();
  e.recursos.push({ id: 'n', nome: 'Nuno' }, { id: 'sai2', nome: 'Sofia', dataSaida: '2026-12-01' });
  e.projetos.p1.tarefas.push({ id: 't5', nome: 'Workshop', recursoIds: ['a', 'n'], alocacoesHoras: { a: 6, n: 2 }, progresso: 10 });
  return e;
};
const reg = (p, t, rid) => (rid === 'a' ? ({ t1: 12, t5: 0, t3: 0 }[t.id] || 0) : 0);
const O = { horasRegistadas: reg, hojeISO: HOJE };

test('substituir: passa só o remanescente; quem já registou horas fica na tarefa com as horas feitas', () => {
  const e = cenario();
  const plano = P.planearSubstituicao(e, 'p1', 'a', { tarefas: { t1: { acao: 'passar', paraId: 'b' } } }, O);
  assert.deepEqual(plano.erros, []);
  assert.equal(plano.ops.length, 1);
  assert.equal(plano.ops[0].restantes, 8); assert.equal(plano.ops[0].sai, false);
  const linhas = P.aplicarSubstituicao(e, 'p1', 'a', plano, 'adm1');
  const t1 = e.projetos.p1.tarefas[0];
  assert.deepEqual(t1.recursoIds.sort(), ['a', 'b']);
  assert.equal(t1.alocacoesHoras.a, 12);            // o que já fez
  assert.equal(t1.alocacoesHoras.b, 13);            // 5 que já tinha + 8 do remanescente
  assert.equal(linhas.length, 1); assert.equal(linhas[0].paraNome, 'Bruno'); assert.equal(linhas[0].horas, 8); assert.equal(linhas[0].feitoPor, 'adm1');
});

test('substituir: sem horas registadas sai da tarefa; o novo entra com as horas por fazer', () => {
  const e = cenario();
  const plano = P.planearSubstituicao(e, 'p1', 'a', { tarefas: { t5: { acao: 'passar', paraId: 'c' } } }, O);
  P.aplicarSubstituicao(e, 'p1', 'a', plano);
  const t5 = e.projetos.p1.tarefas.find(t => t.id === 't5');
  assert.deepEqual(t5.recursoIds.sort(), ['c', 'n']);
  assert.equal(t5.alocacoesHoras.a, undefined); assert.equal(t5.alocacoesHoras.c, 6); assert.equal(t5.alocacoesHoras.n, 2);
});

test('substituir: "deixar por atribuir" não dá as horas a ninguém; "manter" e tarefas concluídas não se tocam', () => {
  const e = cenario();
  const plano = P.planearSubstituicao(e, 'p1', 'a', { tarefas: { t5: { acao: 'remover' }, t1: { acao: 'manter' }, t2: { acao: 'passar', paraId: 'b' } } }, O);
  assert.deepEqual(plano.erros, []);
  assert.deepEqual(plano.ops.map(o => o.tarefaId), ['t5']);            // t2 está 100% e t1 fica
  const linhas = P.aplicarSubstituicao(e, 'p1', 'a', plano);
  const t5 = e.projetos.p1.tarefas.find(t => t.id === 't5');
  assert.deepEqual(t5.recursoIds, ['n']);
  assert.equal(linhas[0].paraId, null); assert.equal(linhas[0].observacoes, 'Deixada por atribuir');
  assert.deepEqual(e.projetos.p1.tarefas.find(t => t.id === 't2').recursoIds, ['a']);
});

test('substituir: destino inválido (a mesma pessoa, inexistente, ou também de saída) → erro e nada muda', () => {
  const e = cenario();
  const antes = JSON.stringify(e);
  for (const paraId of ['a', 'zzz', 'sai2', undefined]) {
    const plano = P.planearSubstituicao(e, 'p1', 'a', { tarefas: { t1: { acao: 'passar', paraId } } }, O);
    assert.equal(plano.erros.length, 1, String(paraId)); assert.equal(plano.ops.length, 0);
  }
  const ina = P.planearSubstituicao(e, 'p1', 'a', { tarefas: { t1: { acao: 'passar', paraId: 'adm2' } } }, O);   // adm2 já saiu
  assert.equal(ina.erros.length, 1);
  assert.equal(JSON.stringify(e), antes);                                // o planeamento nunca altera o estado
});

test('substituir: next steps abertos passam para o novo responsável', () => {
  const e = cenario();
  const plano = P.planearSubstituicao(e, 'p1', 'a', { nextSteps: { n1: { acao: 'passar', paraId: 'b' }, n2: { acao: 'passar', paraId: 'b' } } }, O);
  assert.equal(plano.nextSteps.length, 2);
  P.aplicarSubstituicao(e, 'p1', 'a', plano);
  assert.equal(e.projetos.p1.proximosPassos[0].responsavelId, 'b');
});

test('substituir: horas ultrapassadas (registado > previsto) → remanescente 0, a pessoa mantém as previstas', () => {
  const e = cenario();
  const plano = P.planearSubstituicao(e, 'p1', 'a', { tarefas: { t1: { acao: 'passar', paraId: 'c' } } }, { horasRegistadas: () => 30, hojeISO: HOJE });
  assert.equal(plano.ops[0].restantes, 0);
  P.aplicarSubstituicao(e, 'p1', 'a', plano);
  const t1 = e.projetos.p1.tarefas[0];
  assert.equal(t1.alocacoesHoras.a, 20); assert.equal(t1.alocacoesHoras.c, 0);
});

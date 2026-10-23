// Integração orcprev (lado do Gestor) — correr com: node --test tests/orcprev-logica.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/orcprev-logica.js');

const tipos = {
  reun: { id: 'reun', nome: 'Reuniões', orcprevAtividade: 'INTERNAL_MEETINGS' },
  form: { id: 'form', nome: 'Formação interna', orcprevAtividade: '' }
};
const projetos = { p1: { id: 'p1', idInterno: '2026/1', nome: 'TEXP@CT', orcprevRef: '005323' }, p2: { id: 'p2', idInterno: '2026/2', nome: 'Outro', orcprevRef: '' } };
const reg = (extra) => Object.assign({ data: '2026-10-19', horas: 1, projetoId: 'p1', projetoNome: 'TEXP@CT', projetoIdInterno: '2026/1', tipoTrabalhoId: null, tarefaNome: 'T1' }, extra);
const ctx = (registos, inicioISO) => ({ registos, inicioISO: inicioISO || '2026-10-21', tipoPorId: id => tipos[id], projetoPorId: id => projetos[id], nomeTarefa: r => r.tarefaNome });

test('segundaDaSemana: qualquer dia → segunda-feira (domingo pertence à semana que acabou)', () => {
  assert.equal(L.segundaDaSemana('2026-10-19'), '2026-10-19');
  assert.equal(L.segundaDaSemana('2026-10-21'), '2026-10-19');
  assert.equal(L.segundaDaSemana('2026-10-25'), '2026-10-19');
  assert.equal(L.segundaDaSemana('2026-10-26'), '2026-10-26');
  assert.equal(L.segundaDaSemana('2026-03-30'), '2026-03-30'); // mudança de hora não interfere
});

test('arredondarDia: múltiplos de 0,25, soma preservada, maior resto primeiro', () => {
  assert.deepEqual(L.arredondarDia([2, 3, 3]), [2, 3, 3]);
  assert.deepEqual(L.arredondarDia([1.1, 1.1, 1.1]), [1.25, 1, 1]); // 3,3 → 3,25
  const r = L.arredondarDia([2.6, 2.6, 2.8]);
  assert.equal(r.reduce((a, b) => a + b, 0), 8);
  r.forEach(x => assert.equal((x * 4) % 1, 0));
  assert.deepEqual(L.arredondarDia([0.1, 0.1]), [0.25, 0]); // 0,2 h → 0,25 h, numa linha só
  assert.deepEqual(L.arredondarDia([0.05, 0.05]), [0, 0]);
  assert.deepEqual(L.arredondarDia([]), []);
});

test('várias tarefas do mesmo projeto no mesmo dia somam-se; nomes das tarefas vão para a nota', () => {
  const s = L.linhasDaSemana(ctx([reg({ horas: 2, tarefaNome: 'Análise' }), reg({ horas: 1.5, tarefaNome: 'Relatório' }), reg({ horas: 1, tarefaNome: 'Análise' })]));
  assert.equal(s.linhas.length, 1);
  assert.equal(s.linhas[0].horas, 4.5);
  assert.equal(s.linhas[0].nota, '[Gestor] Análise; Relatório');
  assert.deepEqual(s.linhas[0].projeto, { ref: '005323', nome: 'TEXP@CT', idInterno: '2026/1' });
  assert.equal(s.inicio, '2026-10-19'); assert.equal(s.fim, '2026-10-25');
});

test('dias e projetos diferentes ficam em linhas separadas; fora da semana ignora-se', () => {
  const s = L.linhasDaSemana(ctx([reg({ data: '2026-10-19' }), reg({ data: '2026-10-20' }), reg({ data: '2026-10-19', projetoId: 'p2', projetoNome: 'Outro', projetoIdInterno: '2026/2' }),
    reg({ data: '2026-10-26' }), reg({ data: '2026-10-18' })]));
  assert.equal(s.linhas.length, 3);
  assert.deepEqual(s.linhas.map(l => l.data), ['2026-10-19', '2026-10-19', '2026-10-20']);
  assert.equal(s.totalGestor, 3);
});

test('tipo com atividade vai como atividade; tipo sem atividade não é enviado e gera aviso', () => {
  const s = L.linhasDaSemana(ctx([reg({ tipoTrabalhoId: 'reun', projetoId: null, projetoNome: '', projetoIdInterno: '', horas: 1, tarefaNome: '' }),
    reg({ tipoTrabalhoId: 'form', projetoId: null, projetoNome: '', horas: 2, tarefaNome: '' })]));
  assert.equal(s.linhas.length, 1);
  assert.equal(s.linhas[0].tipo, 'ACTIVITY'); assert.equal(s.linhas[0].atividade, 'INTERNAL_MEETINGS'); assert.equal(s.linhas[0].projeto, null);
  assert.equal(s.linhas[0].nota, '[Gestor]');
  assert.equal(s.totalGestor, 3); assert.equal(s.totalEnvio, 1);
  assert.match(s.avisos[0], /Formação interna.*2 h não serão enviadas/);
});

test('horas a zero ou negativas ignoram-se; notas longas são cortadas', () => {
  const s = L.linhasDaSemana(ctx([reg({ horas: 0 }), reg({ horas: 3, tarefaNome: 'x'.repeat(500) })]));
  assert.equal(s.linhas.length, 1);
  assert.equal(s.linhas[0].nota.length, 200);
  assert.ok(s.linhas[0].nota.startsWith('[Gestor] x'));
});

test('arredondamento por dia mantém o total do dia (0,25 h)', () => {
  const s = L.linhasDaSemana(ctx([reg({ horas: 3.4 }), reg({ projetoId: 'p2', projetoNome: 'Outro', projetoIdInterno: '2026/2', horas: 4.3 })]));
  assert.equal(s.linhas.reduce((a, l) => a + l.horas, 0), 7.75); // 7,7 → 7,75
  s.linhas.forEach(l => assert.equal((l.horas * 4) % 1, 0));
});

test('pacote: formato, email em minúsculas, semana', () => {
  const s = L.linhasDaSemana(ctx([reg({ horas: 2 })]));
  const p = L.pacote({ email: ' Ana@CITEVE.pt ', pessoa: 'Ana', semana: s, geradoEm: 'x' });
  assert.equal(p.formato, 'gestor-orcprev'); assert.equal(p.versao, 1); assert.equal(p.email, 'ana@citeve.pt');
  assert.deepEqual(p.semana, { inicio: '2026-10-19', fim: '2026-10-25' });
  assert.deepEqual(JSON.parse(L.textoDoPacote(p)), p);
});

test('alvoDe/codificarAlvo: projeto, consultoria, prototipagem e outras atividades', () => {
  assert.deepEqual(L.alvoDe(''), { tipo: 'projeto', valor: '' });
  assert.deepEqual(L.alvoDe(' 005323 '), { tipo: 'projeto', valor: '005323' });
  assert.deepEqual(L.alvoDe('Consultoria : Alfa · Auditoria'), { tipo: 'servico', atividade: 'CONSULTING', valor: 'Alfa · Auditoria' });
  assert.deepEqual(L.alvoDe('prototipagem:Beta'), { tipo: 'servico', atividade: 'PROTOTYPING', valor: 'Beta' });
  assert.equal(L.alvoDe('atividade:OTHER').atividade, 'OTHER');
  assert.equal(L.alvoDe('atividade:').atividade, 'OTHER');
  assert.equal(L.codificarAlvo('projeto', ' X '), 'X');
  assert.equal(L.codificarAlvo('consultoria', 'Alfa'), 'consultoria:Alfa');
  assert.equal(L.codificarAlvo('prototipagem', 'Beta'), 'prototipagem:Beta');
  assert.equal(L.codificarAlvo('outras', 'ignorado'), 'atividade:OTHER');
  ['', 'X', 'consultoria:A', 'prototipagem:B', 'atividade:OTHER'].forEach(r => assert.equal(L.codificarAlvo(L.tipoDoAlvo(r), L.alvoDe(r).tipo === 'atividade' ? '' : L.alvoDe(r).valor), r));
});

test('projeto de consultoria → serviço do orcprev; sem serviço → "Outras atividades" com o nome do projeto na nota', () => {
  projetos.c1 = { id: 'c1', idInterno: '2026/50', nome: 'Auditoria Alfa', orcprevRef: 'consultoria:Alfa · Auditoria' };
  projetos.c2 = { id: 'c2', idInterno: '2026/51', nome: 'Estudo Beta', orcprevRef: 'atividade:OTHER' };
  projetos.c3 = { id: 'c3', idInterno: '2026/52', nome: 'Estudo Gama', orcprevRef: 'atividade:OTHER' };
  const s = L.linhasDaSemana(ctx([
    reg({ projetoId: 'c1', projetoNome: 'Auditoria Alfa', projetoIdInterno: '2026/50', horas: 2, tarefaNome: 'Visita' }),
    reg({ projetoId: 'c2', projetoNome: 'Estudo Beta', projetoIdInterno: '2026/51', horas: 1, tarefaNome: 'Relatório' }),
    reg({ projetoId: 'c3', projetoNome: 'Estudo Gama', projetoIdInterno: '2026/52', horas: 1, tarefaNome: '' }),
    reg({ horas: 1 })
  ]));
  assert.deepEqual(s.linhas.map(l => l.tipo), ['PROJECT', 'SERVICE', 'ACTIVITY']);
  const sv = s.linhas[1];
  assert.equal(sv.atividade, 'CONSULTING'); assert.deepEqual(sv.projeto, { ref: 'Alfa · Auditoria', nome: 'Auditoria Alfa', idInterno: '2026/50' });
  const outras = s.linhas[2];
  assert.equal(outras.atividade, 'OTHER'); assert.equal(outras.projeto, null); assert.equal(outras.horas, 2);
  assert.equal(outras.nota, '[Gestor] Relatório — Estudo Beta; Estudo Gama');
});

test('cada linha leva tarefas, projetos e clientes — para o importador poder refazer a nota se o destino mudar', () => {
  projetos.p1.cliente = 'Têxtil X';
  const s = L.linhasDaSemana(ctx([reg({ horas: 1, tarefaNome: 'Análise' }), reg({ horas: 1, tarefaNome: 'Relatório', cliente: 'Têxtil X' })]));
  assert.deepEqual([s.linhas[0].tarefas, s.linhas[0].projetos, s.linhas[0].clientes], [['Análise', 'Relatório'], ['TEXP@CT'], ['Têxtil X']]);
  assert.equal(s.linhas[0].nota, '[Gestor] Análise; Relatório'); // num projeto do orcprev basta o que foi feito
  assert.equal(L.textoNota(s.linhas[0], 'ACTIVITY'), 'Análise; Relatório — TEXP@CT (Têxtil X)');
  assert.equal(L.textoNota({ tarefas: [], projetos: [], clientes: ['Alfa'] }, 'ACTIVITY'), 'Alfa');
  assert.equal(L.montarNota('  '), '[Gestor]');
  delete projetos.p1.cliente;
});

test('Preparação de candidaturas: atividade simples, sem projeto no orcprev; o projeto e o cliente vão na nota', () => {
  assert.deepEqual(L.alvoDe('atividade:APPLICATION_PREP'), { tipo: 'atividade', atividade: 'APPLICATION_PREP', valor: 'APPLICATION_PREP' });
  assert.equal(L.alvoDe('candidatura: 005400').atividade, 'APPLICATION_PREP'); // forma antiga
  assert.equal(L.codificarAlvo('candidatura', 'ignorado'), 'atividade:APPLICATION_PREP');
  assert.equal(L.tipoDoAlvo('atividade:APPLICATION_PREP'), 'candidatura');
  assert.equal(L.tipoDoAlvo('atividade:OTHER'), 'outras');
  projetos.k1 = { id: 'k1', idInterno: '2026/60', nome: 'Candidatura AI Factory', cliente: 'Alfa', orcprevRef: 'atividade:APPLICATION_PREP' };
  const s = L.linhasDaSemana(ctx([reg({ projetoId: 'k1', projetoNome: 'Candidatura AI Factory', projetoIdInterno: '2026/60', horas: 3, tarefaNome: 'Formulário' }), reg({ horas: 1 })]));
  assert.deepEqual(s.linhas.map(l => [l.tipo, l.atividade]), [['PROJECT', null], ['ACTIVITY', 'APPLICATION_PREP']]);
  assert.equal(s.linhas[1].projeto, null);
  assert.equal(s.linhas[1].nota, '[Gestor] Formulário — Candidatura AI Factory (Alfa)');
  delete projetos.k1;
});

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
  assert.equal(s.linhas[0].nota, '[Gestor] Análise; Relatório — TEXP@CT · 2026/1'); // tarefas + projeto e nº do projeto no Gestor
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
  const s = L.linhasDaSemana(ctx([reg({ horas: 0 }), reg({ horas: 3, tarefaNome: 'x'.repeat(3000) })]));
  assert.equal(s.linhas.length, 1);
  assert.equal(s.linhas[0].nota.length, 1000);
  assert.ok(s.linhas[0].nota.endsWith('…'));
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
  assert.equal(outras.nota, '[Gestor] Relatório — Estudo Beta · 2026/51; Estudo Gama · 2026/52');
});

test('cada linha leva tarefas, projetos e clientes — para o importador poder refazer a nota se o destino mudar', () => {
  projetos.p1.cliente = 'Têxtil X';
  const s = L.linhasDaSemana(ctx([reg({ horas: 1, tarefaNome: 'Análise' }), reg({ horas: 1, tarefaNome: 'Relatório', cliente: 'Têxtil X' })]));
  assert.deepEqual([s.linhas[0].tarefas, s.linhas[0].projetos, s.linhas[0].clientes], [['Análise', 'Relatório'], ['TEXP@CT'], ['Têxtil X']]);
  assert.deepEqual(s.linhas[0].origens, [{ nome: 'TEXP@CT', cliente: 'Têxtil X', idInterno: '2026/1' }]);
  assert.equal(s.linhas[0].nota, '[Gestor] Análise; Relatório — TEXP@CT · Têxtil X · 2026/1'); // projeto, cliente e nº, qualquer que seja o destino
  assert.equal(L.textoNota(s.linhas[0], 'ACTIVITY'), 'Análise; Relatório — TEXP@CT · Têxtil X · 2026/1');
  // linha de um pacote antigo (sem "origens"): regra antiga
  assert.equal(L.textoNota({ tarefas: ['T'], projetos: ['P'], clientes: ['C'] }, 'PROJECT'), 'T');
  assert.equal(L.textoNota({ tarefas: ['T'], projetos: ['P'], clientes: ['C'] }, 'ACTIVITY'), 'T — P (C)');
  assert.equal(L.textoNota({ tarefas: [], projetos: [], clientes: ['Alfa'] }, 'ACTIVITY'), 'Alfa');
  assert.equal(L.montarNota('  '), '[Gestor]');
  delete projetos.p1.cliente;
});

test('candidatura: projeto do Gestor que corresponde a "Preparação de candidaturas" do orcprev', () => {
  assert.deepEqual(L.alvoDe('Candidatura: 005400'), { tipo: 'candidatura', atividade: 'APPLICATION_PREP', valor: '005400' });
  assert.equal(L.codificarAlvo('candidatura', ' AI FACTORY '), 'candidatura:AI FACTORY');
  assert.equal(L.tipoDoAlvo('candidatura:X'), 'candidatura');
  projetos.k1 = { id: 'k1', idInterno: '2026/60', nome: 'Candidatura AI Factory', orcprevRef: 'candidatura:AI FACTORY' };
  const s = L.linhasDaSemana(ctx([reg({ projetoId: 'k1', projetoNome: 'Candidatura AI Factory', projetoIdInterno: '2026/60', horas: 3, tarefaNome: 'Formulário' }), reg({ horas: 1 })]));
  assert.deepEqual(s.linhas.map(l => l.tipo), ['PROJECT', 'APPLICATION']);
  assert.equal(s.linhas[1].atividade, 'APPLICATION_PREP');
  assert.deepEqual(s.linhas[1].projeto, { ref: 'AI FACTORY', nome: 'Candidatura AI Factory', idInterno: '2026/60' });
  assert.equal(s.linhas[1].nota, '[Gestor] Formulário — Candidatura AI Factory · 2026/60');
});

test('as notas escritas no Gestor passam para a nota do orcprev (junto da tarefa a que pertencem)', () => {
  const s = L.linhasDaSemana(ctx([
    reg({ horas: 1, tarefaNome: 'Análise', notas: 'revi o   relatório\nfinal' }),
    reg({ horas: 1, tarefaNome: 'Reunião', notas: '' }),
    reg({ horas: 1, tarefaNome: '', notas: 'só uma nota' }),
    reg({ horas: 1, tarefaNome: 'Análise', notas: 'revi o relatório final' }) // repetida: não duplica
  ]));
  assert.equal(s.linhas[0].nota, '[Gestor] Análise: revi o relatório final; Reunião; só uma nota — TEXP@CT · 2026/1');
  // num serviço / atividade é igual: tarefas e notas, depois o projeto
  const o = L.linhasDaSemana(ctx([reg({ projetoId: 'c2', projetoNome: 'Estudo Beta', projetoIdInterno: '2026/51', horas: 1, tarefaNome: 'Relatório', notas: 'entregue ao cliente' })]));
  assert.equal(o.linhas[0].nota, '[Gestor] Relatório: entregue ao cliente — Estudo Beta · 2026/51');
});

// ---------- o que já foi carregado no orcprev ----------
test('horasEnviaveisPorDia: projeto e tipos com atividade contam; tipo sem atividade não; limites de datas', () => {
  const h = L.horasEnviaveisPorDia([
    reg({ data: '2026-10-19', horas: 3 }), reg({ data: '2026-10-19', horas: 2, tipoTrabalhoId: 'reun' }),
    reg({ data: '2026-10-19', horas: 1, tipoTrabalhoId: 'form' }), reg({ data: '2026-10-20', horas: 0 }), reg({ data: '2026-10-30', horas: 4 })
  ], id => tipos[id], '2026-10-19', '2026-10-25');
  assert.deepEqual(h, { '2026-10-19': 5 });
});

test('estadoSemana: sem envios é pendente; com envio confirmado e dias cobertos é carregada', () => {
  const horasDia = { '2026-10-19': 8, '2026-10-20': 7.9 };
  const p = L.estadoSemana({ inicio: '2026-10-21', horasDia, envios: [] });
  assert.equal(p.estado, 'pendente'); assert.equal(p.inicio, '2026-10-19'); assert.deepEqual(p.diasEmFalta, ['2026-10-19', '2026-10-20']);
  const ok = L.estadoSemana({ inicio: '2026-10-19', horasDia, envios: [{ semanaInicio: '2026-10-19', criadoEm: '2026-10-23T09:00:00Z', confirmadoEm: '2026-10-23T09:05:00Z', dias: { '2026-10-19': 8, '2026-10-20': 8 } }] });
  assert.equal(ok.estado, 'carregada'); assert.equal(ok.diasEmFalta.length, 0); assert.equal(ok.totalCarregado, 15.9);
});

test('estadoSemana: folga de 0,25 h por dia; acima disso a semana fica "alterada"', () => {
  const envio = { semanaInicio: '2026-10-19', criadoEm: 'a', confirmadoEm: 'b', dias: { '2026-10-19': 8 } };
  assert.equal(L.estadoSemana({ inicio: '2026-10-19', horasDia: { '2026-10-19': 8.2 }, envios: [envio] }).estado, 'carregada');
  const alt = L.estadoSemana({ inicio: '2026-10-19', horasDia: { '2026-10-19': 8.5 }, envios: [envio] });
  assert.equal(alt.estado, 'alterada'); assert.deepEqual(alt.diasEmFalta, ['2026-10-19']);
});

test('estadoSemana: usa o último envio confirmado; cópia por confirmar fica assinalada; manual também', () => {
  const horasDia = { '2026-10-19': 8 };
  const velho = { semanaInicio: '2026-10-19', criadoEm: '2026-10-20T08:00:00Z', confirmadoEm: '2026-10-20T08:10:00Z', dias: { '2026-10-19': 4 } };
  const novo = { semanaInicio: '2026-10-19', criadoEm: '2026-10-22T08:00:00Z', confirmadoEm: '2026-10-22T08:10:00Z', dias: { '2026-10-19': 8 }, origem: 'manual' };
  const r = L.estadoSemana({ inicio: '2026-10-19', horasDia, envios: [velho, novo] });
  assert.equal(r.estado, 'carregada'); assert.equal(r.manual, true);
  const c = L.estadoSemana({ inicio: '2026-10-19', horasDia, envios: [{ semanaInicio: '2026-10-19', criadoEm: '2026-10-21T08:00:00Z', confirmadoEm: null, dias: {} }] });
  assert.equal(c.estado, 'pendente'); assert.equal(c.copiada, true);
  assert.equal(L.estadoSemana({ inicio: '2026-10-19', horasDia: {}, envios: [] }).estado, 'vazia');
});

test('estadoSemana: dias antes de "desde" não contam', () => {
  const r = L.estadoSemana({ inicio: '2026-10-19', horasDia: { '2026-10-19': 8, '2026-10-21': 8 }, envios: [], desdeISO: '2026-10-20' });
  assert.deepEqual(r.diasEmFalta, ['2026-10-21']);
  assert.equal(L.estadoSemana({ inicio: '2026-10-19', horasDia: { '2026-10-19': 8 }, envios: [], desdeISO: '2026-10-20' }).estado, 'vazia');
});

test('semanasDoControlo: da semana atual para trás, respeitando "desde" e o máximo', () => {
  assert.deepEqual(L.semanasDoControlo({ hojeISO: '2026-11-13', max: 3 }), ['2026-11-09', '2026-11-02', '2026-10-26']);
  assert.deepEqual(L.semanasDoControlo({ hojeISO: '2026-11-13', desdeISO: '2026-11-04', max: 8 }), ['2026-11-09', '2026-11-02']);
});

test('pacote: leva o registo só se estiver completo', () => {
  const semana = { inicio: '2026-10-19', fim: '2026-10-25', linhas: [], avisos: [], totalGestor: 0, totalEnvio: 0 };
  assert.equal(L.pacote({ email: 'a@b.pt', pessoa: 'A', semana }).registo, undefined);
  assert.equal(L.pacote({ email: 'a@b.pt', pessoa: 'A', semana, registo: { url: 'u', chave: 'k' } }).registo, undefined);
  assert.deepEqual(L.pacote({ email: 'a@b.pt', pessoa: 'A', semana, registo: { url: 'u', chave: 'k', token: 't' } }).registo, { url: 'u', chave: 'k', token: 't' });
});

// ---------- identificação do projeto no orcprev: projeto · cliente · nº ----------
test('origens: projetos com o mesmo nome em clientes diferentes ficam distinguíveis na nota; tipo de trabalho leva só o cliente', () => {
  projetos.i1 = { id: 'i1', idInterno: '2026/830', nome: 'Acompanhamento IFIC', cliente: 'Oldtrading, Lda', orcprevRef: '' };
  projetos.i2 = { id: 'i2', idInterno: 'INT-2026-007', nome: 'Acompanhamento IFIC', cliente: 'Cordeiro e Campos, S.A', orcprevRef: '' };
  const s = L.linhasDaSemana(ctx([
    reg({ projetoId: 'i1', projetoNome: 'Acompanhamento IFIC', projetoIdInterno: '2026/830', horas: 2, tarefaNome: 'Reunião de Acompanhamento' }),
    reg({ projetoId: 'i2', projetoNome: 'Acompanhamento IFIC', projetoIdInterno: 'INT-2026-007', horas: 1, tarefaNome: 'Reunião de Acompanhamento' }),
    reg({ tipoTrabalhoId: 'reun', projetoId: null, projetoNome: '', projetoIdInterno: '', horas: 1, tarefaNome: '', cliente: 'Valmet, Lda' })
  ]));
  assert.deepEqual(s.linhas.map(l => l.nota).sort(), [
    '[Gestor] Reunião de Acompanhamento — Acompanhamento IFIC · Cordeiro e Campos, S.A · INT-2026-007',
    '[Gestor] Reunião de Acompanhamento — Acompanhamento IFIC · Oldtrading, Lda · 2026/830',
    '[Gestor] Valmet, Lda'
  ]);
  assert.equal(L.rotuloOrigem({ nome: ' A ', cliente: '', idInterno: '2026/1' }), 'A · 2026/1');
  assert.equal(L.rotuloOrigem(null), '');
  delete projetos.i1; delete projetos.i2;
});

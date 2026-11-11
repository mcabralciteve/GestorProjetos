// Previsão: reconhecimento repartido pelas equipas dos consultores, com o filtro Área (js/previsao.js num vm com App de mentira).
// Correr com: node --test tests/previsao-equipas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HOJE = '2026-10-26';
function montar() {
  const S = {
    departamentos: [{ id: 'dtd', nome: 'DTD' }],
    equipas: [{ id: 'DCS', nome: 'DCS', departamentoId: 'dtd' }, { id: 'RPA', nome: 'RPA', departamentoId: 'dtd' }],
    recursos: [{ id: 'ana', equipaId: 'DCS' }, { id: 'rui', equipaId: 'RPA' }, { id: 'sem', equipaId: '' }],
    registos: [],
    projetos: {
      p1: {
        id: 'p1', nome: 'Piloto Célula Robótica', equipaId: 'DCS', estado: 'Em curso', valorVendido: 10000, horasVendidas: 100, tipoProjeto: 'servicos',
        faturas: [{ dataPrevista: '2026-11-15', valor: 3000, emitida: false }],
        // 40 h da Ana (DCS), 20 h do Rui (RPA) e 10 h de alguém sem equipa (conta na DCS), de 26/10 a 6/11
        tarefas: [{ id: 't1', inicio: '2026-10-26', fim: '2026-11-06', progresso: 0, recursoIds: ['ana', 'rui', 'sem'], horas: { ana: 40, rui: 20, sem: 10 } }]
      }
    }
  };
  const App = {
    state: S, souAdmin: () => true,
    temFilhos: () => false, horasAlocadas: (t, rid) => t.horas[rid] || 0, horasJaRegistadasTarefa: () => 0,
    registoPertenceAoProjeto: () => false, rotuloProjeto: p => p.nome, valorFatura: f => f.valor
  };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ctx = { App, Crm: { carregado: false }, console, escapeHtml: esc, escapeAttr: esc, DateUtil: { todayISO: () => HOJE }, document: { getElementById: () => null, querySelectorAll: () => [] }, module: undefined };
  vm.createContext(ctx);
  const ler = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8').replace(/if \(typeof module[^\n]*\n?/g, '');
  vm.runInContext(ler('previsao-logica.js'), ctx);
  vm.runInContext(ler('previsao.js'), ctx);
  return { Previsao: vm.runInContext('Previsao', ctx), PL: vm.runInContext('PrevisaoLogica', ctx) };
}
const arred = n => Math.round(n * 100) / 100;

test('sem filtro: uma linha por projeto, com as duas equipas na coluna Área e o total do projeto inteiro', () => {
  const { Previsao, PL } = montar();
  const meses = PL.mesesHorizonte(HOJE, 4);
  const { linhas } = Previsao.calcular(HOJE, meses);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].equipa, 'DCS + RPA');
  assert.equal(arred(linhas[0].rec.porReconhecer), 10000);
  assert.equal(Previsao.filtrar(linhas).length, 1);
});

test('Área = RPA: o projeto é da DCS mas a RPA vê a sua parte do reconhecimento (e não as faturas)', () => {
  const { Previsao, PL } = montar();
  const meses = PL.mesesHorizonte(HOJE, 4);
  const { linhas } = Previsao.calcular(HOJE, meses);
  Previsao.filtros.equipa = 'RPA';
  const f = Previsao.filtrar(linhas);
  assert.equal(f.length, 1);
  assert.equal(f[0].equipa, 'RPA');
  // 70 h previstas, 20 h da RPA: 2/7 das horas calendarizadas (7000 €) = 2000 €; nada "sem calendário" nesta parte
  assert.equal(arred(f[0].rec.porReconhecer), 2000);
  assert.equal(arred(f[0].rec.naoCalendarizado), 0);
  assert.equal(f[0].fat.total, 0);
  assert.equal(arred(PL.total(f[0].rec.porMes, meses)), 2000);
});

test('Área = DCS: fica com a parte dos seus consultores (incluindo quem não tem equipa), o backlog sem calendário e as faturas', () => {
  const { Previsao, PL } = montar();
  const meses = PL.mesesHorizonte(HOJE, 4);
  const { linhas } = Previsao.calcular(HOJE, meses);
  Previsao.filtros.equipa = 'DCS';
  const f = Previsao.filtrar(linhas);
  assert.equal(f.length, 1);
  assert.equal(arred(f[0].rec.porReconhecer), 8000);         // 5000 (50/70 de 7000) + 3000 sem horas previstas
  assert.equal(arred(f[0].rec.naoCalendarizado), 3000);
  assert.equal(f[0].fat.total, 3000);
  // RPA + DCS = projeto inteiro
  Previsao.filtros.equipa = 'RPA';
  const r = Previsao.filtrar(linhas);
  assert.equal(arred(r[0].rec.porReconhecer + f[0].rec.porReconhecer), 10000);
});

test('Área sem nada neste projeto: o projeto sai da lista', () => {
  const { Previsao, PL } = montar();
  Previsao.filtros.equipa = 'RPA';
  const S = Previsao.filtrar.call(Previsao, []);
  assert.equal(S.length, 0);
  const meses = PL.mesesHorizonte(HOJE, 4);
  const { linhas } = Previsao.calcular(HOJE, meses);
  // a RPA deixa de ter horas: só a DCS trabalha → a RPA não vê o projeto (e as faturas são da DCS)
  linhas[0].partes = linhas[0].partes.filter(p => p.equipaId === 'DCS');
  assert.equal(Previsao.filtrar(linhas).length, 0);
});

test('os pressupostos explicam a repartição por equipa', () => {
  const { Previsao, PL } = montar();
  const meses = PL.mesesHorizonte(HOJE, 4);
  const { linhas } = Previsao.calcular(HOJE, meses);
  const txt = Previsao.pressupostos(linhas[0], 100);
  assert.match(txt, /por equipa/);
  assert.match(txt, /DCS 80%/);
  assert.match(txt, /RPA 20%/);
});

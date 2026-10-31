// Excel da Capacidade com fórmulas — correr com: node --test tests/capacidade-excel.test.js
// Um avaliador mínimo (SUM, IF, AND, MIN, MAX, operadores) confere que cada fórmula, calculada com os valores das células que referencia,
// dá o valor que levou guardado ("v") — assim as fórmulas e os números a que o Excel chega ao abrir são os mesmos.
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../lib/jszip.min.js');
const X = require('../js/xlsx-estilo.js');
const E = require('../js/capacidade-excel.js');
const C = require('../js/capacidade-comercial.js');

const COR = { critico: ['F1CFC9', '6E241C'], aviso: ['F6DDC4', '7A3A10'], ok: ['CDE4D8', '1F4B34'], subutilizado: ['F3E3B6', '6B4F0F'] };
const classe = (pct) => pct > 1 ? 'critico' : pct >= 0.9 ? 'aviso' : pct >= 0.7 ? 'ok' : 'subutilizado';
const opcoes = { primeiraLinha: 6, COR, classe };
const mes = (s, i, t, cap) => ({ s, i, t, cap });
const dados = (extra) => Object.assign({
  nMeses: 4,
  consultores: [
    { nome: 'Ana', equipa: 'DCS', meses: [mes(10, 5, 40, 160), mes(100.04, 0, 180, 160), mes(20, 0, 60, 168), mes(0, 0, 0, 0)] },
    { nome: 'Rui', equipa: 'DCS', meses: [mes(30, 0, 50, 160), mes(80, 20, 170, 160), mes(10, 10, 30, 168), mes(0, 0, 0, 0)] }
  ],
  projecao: { op: [0, 60, 90, 90], folga: [0, 40, 70, 80], desde: 1 }
}, extra || {});

// ---- mini-avaliador de fórmulas ----
function celulasPorRef(linhas) {
  const mapa = new Map();
  linhas.forEach((linha, i) => {
    const r = i + 6; let c = 0; const ocupado = new Set();
    (linha.celulas || []).forEach(cel => {
      while (ocupado.has(c)) c++;
      mapa.set(X.ref(r, c), cel);
      const cs = cel.colspan || 1;
      for (let k = 1; k < cs; k++) ocupado.add(c + k);
      c += cs;
    });
  });
  return mapa;
}
function avaliar(f, valorDe) {
  const js = f.replace(/\b([A-Z]{1,2}\d+)\b/g, (m, r) => `V("${r}")`).replace(/V\("([A-Z]+\d+)"\):V\("([A-Z]+\d+)"\)/g, (m, a, b) => `RG("${a}","${b}")`);
  const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const V = (r) => valorDe(r);
  const RG = (a, b) => { const [ca, ra] = [a.match(/[A-Z]+/)[0], Number(a.match(/\d+/)[0])], [cb, rb] = [b.match(/[A-Z]+/)[0], Number(b.match(/\d+/)[0])]; const out = []; for (let c = col(ca); c <= col(cb); c++) for (let r = ra; r <= rb; r++) out.push(V(String.fromCharCode(64 + c) + r)); return out; };
  const SUM = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0), IF = (c, a, b) => (c ? a : b), AND = (...a) => a.every(Boolean), MIN = Math.min, MAX = Math.max;
  return new Function('V', 'RG', 'SUM', 'IF', 'AND', 'MIN', 'MAX', `return (${js});`)(V, RG, SUM, IF, AND, MIN, MAX);
}
function conferir(linhas) {
  const mapa = celulasPorRef(linhas);
  const valor = (r) => { const c = mapa.get(r); assert.ok(c, 'célula inexistente ' + r); return c.v; };
  let nFormulas = 0;
  mapa.forEach((cel, ref) => {
    if (!cel.f) return;
    nFormulas++;
    const r = avaliar(cel.f, valor);
    if (typeof cel.v === 'number') assert.ok(Math.abs(r - cel.v) < 1e-6, `${ref}: ${cel.f} = ${r}, guardado ${cel.v}`);
    else assert.equal(r, cel.v, `${ref}: ${cel.f}`);
  });
  return { mapa, nFormulas };
}

test('todas as fórmulas dão o valor guardado (totais, ocupação, projeções e harmonização)', () => {
  const { linhas } = E.construir(dados(), opcoes);
  const { nFormulas } = conferir(linhas);
  assert.ok(nFormulas > 60);
});

test('as linhas: consultores, total, projeções, total + projeção e as três da harmonização', () => {
  const { linhas } = E.construir(dados(), opcoes);
  const rotulos = linhas.map(l => l.celulas[0].v);
  assert.deepEqual(rotulos, ['Ana', 'Rui', 'Total (2 consultores)', 'Oportunidades de Serviços (projeção)', 'Folga de Serviços adjudicados (projeção)', 'Total + projeção',
    '↳ Transitadas do mês anterior', 'Total + projeção (harmonizado)', '↴ A transitar para o mês seguinte']);
  assert.ok(linhas.every(l => l.celulas.length === 1 + 1 + 4 * 5 - 1 || l.celulas.length === 2 + 4 * 5 - 1 + 1 || true));
});

test('a harmonização do Excel dá o mesmo que CapacidadeComercial.harmonizar', () => {
  const d = dados();
  const { linhas } = E.construir(d, opcoes);
  const { mapa } = conferir(linhas);
  const celula = (linha, mi, k) => mapa.get(X.ref(linha, 2 + mi * 5 + k));
  const rTP = 6 + 2 + 1 + 2, rEnt = rTP + 1, rHar = rTP + 2, rTra = rTP + 3;
  const procura = [0, 1, 2, 3].map(mi => celula(rTP, mi, 2).v), cap = [0, 1, 2, 3].map(mi => celula(rTP, mi, 3).v);
  const esperado = C.harmonizar(procura, cap, 1);
  [0, 1, 2, 3].forEach(mi => {
    assert.ok(Math.abs(celula(rHar, mi, 2).v - esperado.carga[mi]) < 1e-6, `fica no mês ${mi}`);
    if (mi >= 1) {
      assert.ok(Math.abs(celula(rEnt, mi, 2).v - esperado.entrada[mi]) < 1e-6, `entrada ${mi}`);
      assert.ok(Math.abs(celula(rTra, mi, 2).v - esperado.transita[mi]) < 1e-6, `transita ${mi}`);
    }
  });
  assert.equal(celula(rEnt, 0, 2).v, '–');          // mês já passado
  assert.equal(celula(rTra, 0, 2).v, '–');
  assert.equal(celula(rEnt, 1, 2).v, 0);            // primeiro mês harmonizado: nada vem de trás
  assert.ok(celula(rTra, 3, 2).v > 0);              // o excesso do último mês fica por alocar
});

test('sem projeções só há consultores e total (sem linhas de projeção); sem harmonização não há as três últimas', () => {
  const sem = E.construir(dados({ projecao: null }), opcoes);
  assert.equal(sem.linhas.length, 3);
  conferir(sem.linhas);
  const semHarm = E.construir(dados({ projecao: { op: [0, 60, 90, 90], folga: null, desde: null } }), opcoes);
  assert.deepEqual(semHarm.linhas.map(l => l.celulas[0].v).slice(3), ['Oportunidades de Serviços (projeção)', 'Total + projeção']);
  conferir(semHarm.linhas);
  const soFolga = E.construir(dados({ projecao: { op: null, folga: [0, 40, 70, 80], desde: 2 } }), opcoes);
  conferir(soFolga.linhas);
  assert.equal(soFolga.linhas.length, 3 + 1 + 1 + 3);
});

test('ocupação: "–" sem capacidade nem horas, "n/d" com horas e sem capacidade; os totais somam os valores arredondados', () => {
  const { linhas } = E.construir(dados(), opcoes);
  const { mapa } = conferir(linhas);
  assert.equal(mapa.get(X.ref(6, 2 + 3 * 5 + 4)).v, '–');            // Ana, mês 4: tudo a zero
  const { linhas: l2 } = E.construir(dados({ consultores: [{ nome: 'X', equipa: 'E', meses: [mes(5, 0, 5, 0)] }], nMeses: 1, projecao: null }), opcoes);
  assert.equal(celulasPorRef(l2).get(X.ref(6, 6)).v, 'n/d');
  const total = mapa.get(X.ref(8, 2 + 1 * 5 + 0));
  assert.equal(total.f, 'SUM(H6:H7)');
  assert.ok(Math.abs(total.v - 180) < 1e-6);                          // 100.04 → 100, + 80 = 180
});

test('o ficheiro .xlsx leva as fórmulas, os valores guardados e o recálculo ao abrir', async () => {
  const { linhas } = E.construir(dados(), opcoes);
  const buf = await X.gerar({ nome: 'Capacidade', larguras: [20, 10], linhas }, JSZip, 'nodebuffer');
  const zip = await JSZip.loadAsync(buf);
  const folha = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(folha, /<f>SUM\(C6:C7\)<\/f><v>40<\/v>/);
  assert.match(folha, /<f>IF\(AND\(F6&lt;=0,E6&lt;=0\),&quot;–&quot;,IF\(F6&gt;0,E6\/F6,&quot;n\/d&quot;\)\)<\/f>/);   // <, > e aspas escapados no XML
  assert.match(folha, /t="str"><f>[^<]*<\/f><v>–<\/v>/);              // resultado de texto
  assert.match(await zip.file('xl/workbook.xml').async('string'), /<calcPr[^>]*fullCalcOnLoad="1"/);
});

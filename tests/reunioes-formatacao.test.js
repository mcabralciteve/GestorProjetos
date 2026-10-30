// Notas com formatação (Reuniões) — correr com: node --test tests/reunioes-formatacao.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../lib/jszip.min.js');
const L = require('../js/reunioes-logica.js');
const A = require('../js/reunioes-ata.js');

test('limparHtml: mantém a formatação permitida e normaliza as etiquetas equivalentes', () => {
  assert.equal(L.limparHtml('<div><strong>Negrito</strong> e <em>itálico</em> e <u>sub</u> e <strike>riscado</strike></div>'),
    '<div><b>Negrito</b> e <i>itálico</i> e <u>sub</u> e <s>riscado</s></div>');
  assert.equal(L.limparHtml('<font size="5" color="#C0392B">grande</font>'), '<font size="5" color="#c0392b">grande</font>');
  assert.equal(L.limparHtml('<h2>Título</h2><ul><li>um</li><li>dois</li></ul><ol><li>a</li></ol>'), '<h3>Título</h3><ul><li>um</li><li>dois</li></ul><ol><li>a</li></ol>');
});

test('limparHtml: descarta scripts, estilos, atributos, ligações e imagens (XSS)', () => {
  const sujo = '<div onclick="x()" style="color:red"><script>alert(1)</script><b onmouseover="y()">ok</b>'
    + '<a href="javascript:alert(2)">link</a><img src=x onerror=alert(3)><iframe src="//evil"></iframe>'
    + '<font size="9" color="red" face="Comic">x</font><style>body{display:none}</style></div>';
  const limpo = L.limparHtml(sujo);
  assert.equal(limpo, '<div><b>ok</b>linkx</div>'); // o texto do <font> inválido fica, sem a etiqueta
  assert.ok(!/script|onclick|onerror|javascript|iframe|style|href|img/i.test(limpo));
});

test('limparHtml: tamanho e cor só com valores válidos; texto nunca vira etiqueta', () => {
  assert.equal(L.limparHtml('<font size="3" color="#fff">a</font>'), '<font size="3" color="#fff">a</font>');
  assert.equal(L.limparHtml('<font color="url(x)">a</font>'), '<div>a</div>');
  assert.equal(L.limparHtml('a &lt;script&gt;alert(1)&lt;/script&gt; &amp; b'), '<div>a &lt;script&gt;alert(1)&lt;/script&gt; &amp; b</div>');
  assert.equal(L.limparHtml('1 < 2 e 3 > 2'), '<div>1 &lt; 2 e 3 &gt; 2</div>');
});

test('limparHtml: etiquetas desemparelhadas ficam bem formadas; Google Docs não põe tudo a negrito', () => {
  assert.equal(L.limparHtml('<b>aberto <i>sem fechar'), '<b>aberto <i>sem fechar</i></b>');
  assert.equal(L.limparHtml('texto</b></div>solto'), '<div>textosolto</div>');
  assert.equal(L.limparHtml('<b style="font-weight:normal" id="docs"><div>normal</div></b>'), '<div>normal</div>');
  assert.equal(L.limparHtml('<p>a<br/>b</p>'), '<p>a<br>b</p>');
});

test('limparHtml: vazio fica vazio; idempotente', () => {
  assert.equal(L.limparHtml(''), '');
  assert.equal(L.limparHtml(null), '');
  assert.equal(L.limparHtml('<div><br></div>'), '');
  assert.equal(L.limparHtml('<div>&nbsp;</div>'), '');
  const x = '<div><b>a</b> &amp; <font size="4">b</font></div><ul><li>x</li></ul>';
  assert.equal(L.limparHtml(L.limparHtml(x)), L.limparHtml(x));
});

test('texto sem etiquetas (uma só linha) não é confundido com uma nota antiga: não se escapa duas vezes', () => {
  const guardado = L.limparHtml('a &amp; b &lt; c');             // o que o editor devolve para "a & b < c"
  assert.ok(L.ehHtml(guardado));
  assert.equal(L.notasParaEditor(guardado), guardado);            // reabrir não muda nada
  assert.equal(L.notasParaEditor(L.notasParaEditor(guardado)), guardado);
  assert.equal(L.notasParaEditor('a & b < c'), '<div>a &amp; b &lt; c</div>'); // a nota antiga, essa sim, é convertida uma vez
});

test('notas antigas em texto simples são convertidas; HTML é só limpo', () => {
  assert.equal(L.ehHtml('só texto\ncom linhas'), false);
  assert.equal(L.ehHtml('<div>com html</div>'), true);
  assert.equal(L.textoParaHtml('a & b\n\nc <d>'), '<div>a &amp; b</div><div><br></div><div>c &lt;d&gt;</div>');
  assert.equal(L.textoParaHtml('   '), '');
  assert.equal(L.notasParaEditor('linha 1\nlinha 2'), '<div>linha 1</div><div>linha 2</div>');
  assert.equal(L.notasParaEditor('<div onclick=x><b>ok</b></div>'), '<div><b>ok</b></div>');
});

test('htmlParaBlocos: formatos, títulos, listas numeradas e linhas em branco', () => {
  const b = L.htmlParaBlocos('<h3>Decisões</h3><div>Texto <b>forte</b> <font size="5" color="#2a6a9a">grande</font></div><div><br></div>'
    + '<ul><li>um</li><li>dois</li></ul><ol><li>a</li><li>b</li></ol>');
  assert.equal(b[0].titulo, true);
  assert.equal(b[0].runs[0].t, 'Decisões');
  assert.deepEqual(b[1].runs.map(r => [r.t, r.b, r.tam, r.cor]), [['Texto ', false, null, null], ['forte', true, null, null], [' ', false, null, null], ['grande', false, 30, '#2a6a9a']]);
  assert.deepEqual(b[2].runs, []);                                     // linha em branco
  assert.deepEqual(b.slice(3).map(x => [x.lista.tipo, x.lista.n, x.runs[0].t]), [['ul', 1, 'um'], ['ul', 2, 'dois'], ['ol', 1, 'a'], ['ol', 2, 'b']]);
});

test('htmlParaBlocos: um div com uma lista dentro não deixa linha em branco; <div><br></div> deixa', () => {
  assert.equal(L.htmlParaBlocos('<div><ul><li>a</li></ul></div>').length, 1);
  assert.equal(L.htmlParaBlocos('<div>x</div><div></div><div>y</div>').length, 2);
  const b = L.htmlParaBlocos('<div>x</div><div><br></div><div>y</div>');
  assert.equal(b.length, 3);
  assert.deepEqual(b[1].runs, []);
});

test('ata: as notas formatadas chegam ao Word com negrito, tamanho, cor, títulos e listas', () => {
  const xml = A.paragrafosRicos('<h3>Resumo</h3><div>Isto é <b>importante</b>, <i>muito</i>, <u>mesmo</u> e <s>não</s> <font size="5" color="#C0392B">grande</font></div>'
    + '<ul><li>ponto um</li></ul><ol><li>passo um</li><li>passo dois</li></ol>');
  ['<w:b/>', '<w:i/>', '<w:u w:val="single"/>', '<w:strike/>', '<w:sz w:val="30"/>', '<w:color w:val="C0392B"/>', '<w:keepNext/>', '•', '>1.<', '>2.<', '<w:tab/>', 'passo dois'].forEach(t => assert.ok(xml.includes(t), 'falta: ' + t));
  assert.ok(xml.indexOf('<w:sz w:val="26"/>') >= 0, 'o título tem tamanho próprio');
});

test('ata: notas antigas em texto simples continuam a funcionar e o texto malicioso fica inofensivo', () => {
  const xmlAntigo = A.paragrafosRicos('linha 1\n\nlinha 3');
  assert.equal((xmlAntigo.match(/<w:p>/g) || []).length, 3);
  const xml = A.paragrafosRicos('<div><script>alert(1)</script>&lt;b&gt;x&lt;/b&gt;</div><img src=x onerror=alert(1)>');
  assert.ok(!xml.includes('script') && !xml.includes('onerror'));
  assert.ok(xml.includes('&lt;b&gt;x&lt;/b&gt;'));   // o que o utilizador escreveu como texto continua a ser texto
});

test('ata completa com notas formatadas: .docx bem formado', async () => {
  const r = { titulo: 'Reunião', data_hora: new Date(2026, 10, 5, 14, 30).toISOString(), participantes: [], pontos: [], ficheiros: [],
    notas: '<h3>Título &amp; co</h3><div>Texto <b>forte</b> <font size="6" color="#1f8a5b">verde</font></div><ul><li>a</li><li>b <i>c</i></li></ul>' };
  const buf = await A.gerar(r, { versao: 1, emitidaEm: '2026-11-05T16:00:00Z', emitidaPor: 'Ana' }, JSZip, 'nodebuffer');
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml').async('string');
  assert.ok(doc.includes('Título &amp; co') && doc.includes('<w:color w:val="1F8A5B"/>'));
  // etiquetas equilibradas
  const pilha = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(doc.replace(/<\?xml[^>]*\?>/, '')))) { if (m[4]) continue; if (!m[1]) pilha.push(m[2]); else assert.equal(pilha.pop(), m[2]); }
  assert.equal(pilha.length, 0);
});

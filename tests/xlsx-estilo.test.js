// Gerador de .xlsx com estilos — correr com: node --test tests/xlsx-estilo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../lib/jszip.min.js');
const X = require('../js/xlsx-estilo.js');

const spec = () => ({
  nome: 'Capacidade', larguras: [20, 10, 10], congelar: { linhas: 2, colunas: 1 }, paisagem: true,
  autofiltro: { linha: 2, de: 0, ate: 2, ultimaLinha: 3 },
  linhas: [
    { altura: 24, celulas: [{ v: 'Título & "teste"', e: { negrito: true, tam: 16, cor: '1F3A5F' }, colspan: 3 }] },
    { celulas: [{ v: 'Consultor', e: { negrito: true, fundo: 'DCE8F3', borda: 'fina' } }, { v: 'Horas', e: { negrito: true, fundo: 'DCE8F3', borda: 'fina' } }, { v: 'Ocupação', e: { negrito: true, fundo: 'DCE8F3', borda: 'fina' } }] },
    { celulas: [{ v: 'Ana', e: { borda: 'fina' } }, { v: 12.5, e: { formato: '#,##0.0;-#,##0.0;"–"', borda: 'fina' } }, { v: 0.85, e: { formato: '0%', borda: 'fina', fundo: 'CDE4D8' } }] },
  ]
});

test('gera um ficheiro zip com as partes do Excel e estilos', async () => {
  const buf = await X.gerar(spec(), JSZip, 'nodebuffer');
  const zip = await JSZip.loadAsync(buf);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(zip.file(p), p);
  const folha = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(folha, /<mergeCell ref="A1:C1"\/>/);
  assert.match(folha, /state="frozen"/);
  assert.match(folha, /<autoFilter ref="A2:C3"\/>/);
  assert.match(folha, /Título &amp; &quot;teste&quot;/);
  const estilos = await zip.file('xl/styles.xml').async('string');
  assert.match(estilos, /FFDCE8F3/);       // fundo
  assert.match(estilos, /<b\/>/);          // negrito
  assert.match(estilos, /numFmtId="9"/);   // percentagem
  assert.match(estilos, /formatCode="#,##0.0;-#,##0.0;&quot;–&quot;"/);
});

test('o ficheiro lê-se de volta com os valores certos (SheetJS)', async () => {
  const XLSX = require('../lib/xlsx.full.min.js');
  const buf = await X.gerar(spec(), JSZip, 'nodebuffer');
  const wb = XLSX.read(buf, { cellNF: true });
  assert.deepEqual(wb.SheetNames, ['Capacidade']);
  const ws = wb.Sheets['Capacidade'];
  assert.equal(ws['A1'].v, 'Título & "teste"');
  assert.equal(ws['A3'].v, 'Ana');
  assert.equal(ws['B3'].v, 12.5);
  assert.equal(ws['C3'].v, 0.85);
  assert.equal(ws['C3'].z, '0%');
});

test('uniões: as células cobertas saltam e a seguinte cai no sítio certo', async () => {
  const s = { nome: 'T', larguras: [5, 5, 5, 5], linhas: [
    { celulas: [{ v: 'A', colspan: 2 }, { v: 'C' }, { v: 'D' }] },
    { celulas: [{ v: 'x' }, { v: 'y' }] }] };
  const zip = await JSZip.loadAsync(await X.gerar(s, JSZip, 'nodebuffer'));
  const folha = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(folha, /<c r="C1"[^>]*><is><t[^>]*>C<\/t>/);
  assert.match(folha, /<c r="D1"[^>]*><is><t[^>]*>D<\/t>/);
  assert.match(folha, /<c r="B2"[^>]*><is><t[^>]*>y<\/t>/);
});

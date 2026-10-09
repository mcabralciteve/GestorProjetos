// Exportação da Proposta Cliente — correr com: node --test tests/orcamento-export.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../js/orcamento-logica.js');
global.JSZip = require('../lib/jszip.min.js');
const E = require('../js/orcamento-export.js');

const modelo = fs.readFileSync(path.join(__dirname, '..', 'assets', 'orcamentos', 'Proposta_Cliente_Template.xlsx'));
const linha = (seccao, dados, descricao) => ({ id: 'x' + Math.random(), seccao, descricao: descricao || '', dados });
const orc = (areas) => ({ aluguer_saida: 45, custo_km: 0.16, areas });
const area = (nome, linhas, ce) => ({ id: nome, nome, custos_especificos: ce || 0, linhas });
const dados = (o) => ({ cliente: 'Têxtil <do> Ave & Filhos', projeto: 'Auditoria IA', data: '2026-10-09', validadeDias: 30, responsavel: 'Milton Cabral', pc: O.propostaCliente(o) });

async function celulasDe(buf) {
  const zip = await JSZip.loadAsync(buf);
  return await zip.file('xl/worksheets/sheet1.xml').async('string');
}
const celula = (xml, ref) => (xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`)) || [''])[0];

test('células: cabeçalho, investimento por rubrica, total e listas do âmbito', () => {
  const o = orc([area('DCS', [linha('consultoria', { horas: 10, valor_hora: 50, custo_hora: 30 }, 'Diagnóstico'), linha('consumivel', { valor: 100 })])]);
  const c = E.celulas(dados(o));
  assert.equal(c.B4.v, 'Têxtil <do> Ave & Filhos'); assert.equal(c.B6.v, '09/10/2026'); assert.equal(c.D6.v, 30);
  assert.equal(c.C11.v, 500); assert.equal(c.C15.v, 0); assert.equal(c.C14.v, 100); assert.equal(c.C16.v, 600);
  assert.equal(c.A22.v, '• Diagnóstico');
  assert.equal(c.A50, undefined);                                   // uma só área: sem quadro por área
});

test('listas longas: indica quantas ficaram de fora; várias áreas: quadro por área', () => {
  const muitas = Array.from({ length: 12 }, (_, i) => linha('consultoria', { horas: 1, valor_hora: 10, custo_hora: 5 }, 'Tarefa ' + (i + 1)));
  const c = E.celulas(dados(orc([area('DCS', muitas), area('ROB', [linha('consumivel', { valor: 10 })])])));
  assert.equal(c.A22.v, '• Tarefa 1'); assert.equal(c.A30.v, '• Tarefa 9'); assert.equal(c.A31.v, '… e mais 3');
  assert.equal(c.A50.v, 'Investimento por área'); assert.equal(c.A51.v, 'DCS'); assert.equal(c.C52.v, 10);
});

test('ficheiro gerado: valores nas células certas, estilo do modelo mantido, texto escapado, nada de margem', async () => {
  const o = orc([area('DCS', [linha('consultoria', { horas: 10, valor_hora: 50, custo_hora: 30 }, 'Diagnóstico & análise')], 100)]);
  const blob = await E.gerar(dados(o), modelo);
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(path.join(require('node:os').tmpdir(), 'proposta_teste.xlsx'), buf);
  const xml = await celulasDe(buf);
  assert.match(celula(xml, 'C16'), /<v>600<\/v>/);
  assert.match(celula(xml, 'C11'), /s="\d+"/);                      // mantém o formato monetário do modelo
  assert.match(celula(xml, 'B4'), /Têxtil &lt;do&gt; Ave &amp; Filhos/);
  assert.match(celula(xml, 'A22'), /• Diagnóstico &amp; análise/);
  assert.equal(/margem|overhead|valor_hora/i.test(xml), false);
  const antigo = await celulasDe(modelo);
  assert.match(celula(antigo, 'C16'), /<c r="C16" s="\d+" t="n" \/>/);   // o modelo original não foi alterado
});

test('modelo sem a célula esperada: erro claro', () => {
  assert.throws(() => E.preencherXml('<worksheet></worksheet>', { B4: { t: 's', v: 'x' } }), /não tem a célula B4/);
});

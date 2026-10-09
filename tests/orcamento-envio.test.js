// Envio da proposta ao cliente — correr com: node --test tests/orcamento-envio.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/orcamento-envio.js');

const LINK = 'https://citeve2.sharepoint.com/:f:/r/sites/CITEVEDEPTD/Documentos%20Partilhados/Comercial/CLIENTES?d=w4ba4efd9a0bb462987726d1e64d2f503&csf=1&web=1&e=rYfbQ0';

test('link do SharePoint: site, biblioteca e pasta base', () => {
  assert.deepEqual(E.lerLinkSharePoint(LINK), { host: 'citeve2.sharepoint.com', sitio: '/sites/CITEVEDEPTD', biblioteca: 'Documentos Partilhados', pasta: ['Comercial', 'CLIENTES'] });
  assert.equal(E.lerLinkSharePoint('https://exemplo.com/sites/x/y'), null);
  assert.equal(E.lerLinkSharePoint('não é link'), null);
});

test('nomes de pastas e ficheiros', () => {
  assert.equal(E.limparNome('Têxtil do Ave, Lda.'), 'Têxtil do Ave, Lda');
  assert.equal(E.nomePastaProposta('2026/829-01', 'Auditoria IA'), '2026-829-01 - Auditoria IA');
  assert.equal(E.nomePastaProposta('', 'Só título'), 'Só título');
  assert.deepEqual(E.nomesFicheiros({ cliente: 'Têxtil do Ave, Lda.', referencia: '2026/829-01', versao: 2 }),
    { excel: 'Proposta_Textil_do_Ave_Lda_2026_829-01_v2.xlsx', word: 'Proposta_Textil_do_Ave_Lda_2026_829-01.docx', interno: 'Orcamento_interno_Textil_do_Ave_Lda_2026_829-01_v2.xlsx' });
  assert.equal(E.nomesFicheiros({ cliente: '', referencia: '', versao: 1 }).excel, 'Proposta_cliente_v1.xlsx');
});

test('email: assunto, mensagem editável e HTML escapado', () => {
  const ctx = { referencia: '2026/829-01', titulo: 'Auditoria IA', contacto: 'Ana Silva', validadeDias: 45, responsavel: 'Milton Cabral' };
  assert.equal(E.assuntoPadrao(ctx), 'Proposta 2026/829-01 — Auditoria IA');
  const m = E.mensagemPadrao(ctx);
  assert.match(m, /^Exmo\(a\)\. Sr\(a\)\. Ana Silva,/); assert.match(m, /"Auditoria IA"/); assert.match(m, /ref\. 2026\/829-01/); assert.match(m, /válida por 45 dias/); assert.match(m, /Milton Cabral\nCITEVE/);
  assert.match(E.mensagemPadrao({}), /^Exmos\. Senhores,/);
  const h = E.htmlDoTexto('Olá <b>Ana</b> & amigos\nlinha 2\n\nSegundo parágrafo');
  assert.match(h, /Olá &lt;b&gt;Ana&lt;\/b&gt; &amp; amigos<br>linha 2/); assert.equal((h.match(/<p /g) || []).length, 2);
});

test('pré-requisitos: preço, contacto com email; avisos de referência e SharePoint', () => {
  assert.deepEqual(E.verificar({ total: 1000, contactos: [{ email: 'a@b.pt' }] }), []);
  assert.equal(E.verificar({ total: 0, contactos: [{ email: 'a@b.pt' }] }).length, 1);
  assert.equal(E.verificar({ total: 1000, contactos: [{ email: '' }, { email: 'sem-arroba' }] }).length, 1);
  assert.equal(E.verificar({ total: 1000, contactos: [] }).length, 1);
  assert.equal(E.avisos({ referencia: '2026/1-01', sharepointConfigurado: true }).length, 0);
  assert.equal(E.avisos({ referencia: '', sharepointConfigurado: false }).length, 2);
});

test('endereços: lista sem repetidos e validação', () => {
  assert.deepEqual(E.listaEmails('a@b.pt; c@d.pt, a@b.pt  e@f.pt'), ['a@b.pt', 'c@d.pt', 'e@f.pt']);
  assert.deepEqual(E.listaEmails(''), []);
  assert.ok(E.emailValido('a@b.pt')); assert.equal(E.emailValido('a@b'), false);
  assert.equal(E.base64DeBuffer(new TextEncoder().encode('olá').buffer), Buffer.from('olá').toString('base64'));
  assert.match(E.resumoInteracao({ referencia: '2026/829-01', versao: 2, totalTexto: '12 600 €', para: ['a@b.pt'], anexos: ['p.xlsx', 'p.docx'], pastaUrl: 'https://sp/x' }),
    /enviada a a@b\.pt\. Anexos: p\.xlsx, p\.docx\. Pasta: https:\/\/sp\/x$/);
});

// Proposta em Word (DG015) — correr com: node --test tests/orcamento-word.test.js
// O modelo de teste é construído aqui com a mesma estrutura de campos do DG015; se o modelo real existir neste computador também se
// confirma que ele fica preenchido (sem o copiar para o repositório).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.JSZip = require('../lib/jszip.min.js');
const W = require('../js/orcamento-word.js');

const RPR = '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:szCs w:val="40"/></w:rPr>';
const campo = (nome, padrao) => `<w:r>${RPR}<w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${nome}"/><w:enabled/><w:textInput><w:default w:val="${padrao}"/></w:textInput></w:ffData></w:fldChar></w:r><w:bookmarkStart w:id="0" w:name="${nome}"/><w:r>${RPR}<w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r>${RPR}</w:r><w:r>${RPR}<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:noProof/></w:rPr><w:t>${padrao}</w:t></w:r><w:r>${RPR}<w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="0"/>`;
const DOC = `<w:document><w:body><w:p>${campo('TrabReal', 'Nome do trabalho a realizar')}</w:p><w:p>${campo('NomeEmpresa', 'Nome da Empresa')}</w:p>` +
  `<w:p>${campo('Ano', 'Ano')} / ${campo('NObra', 'Obra')} / ${campo('DepUn', 'Dept-Unidade')} / ${campo('NRev', '0')}</w:p>` +
  `<w:p>${campo('DDia', 'dia')} de ${campo('DMes', 'mês')} de ${campo('DAno', 'ano')}</w:p>` +
  `<w:p w14:paraId="1"><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr><w:t>O valor a cobrar pelo CITEVE é de #.###,## €. Acrescido de IVA à taxa em vigor.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Eventuais custos…</w:t></w:r></w:p></w:body></w:document>`;
const CAB = '<w:hdr><w:t>Nome do trabalho a realizar</w:t><w:t>Cliente: Nome da Empresa</w:t></w:hdr>';
async function modelo() {
  const z = new JSZip(); z.file('word/document.xml', DOC); z.file('word/header1.xml', CAB); z.file('[Content_Types].xml', '<Types/>');
  return z.generateAsync({ type: 'nodebuffer' });
}
const ctx = { titulo: 'Auditoria IA & dados', cliente: 'Têxtil <do> Ave', referencia: '2026/0829-02', areas: ['DCS', 'ROB'], versaoProposta: 2, hojeISO: '2026-10-09', total: 12600.5, validadeDias: 30,
  rubricas: [{ rotulo: 'Consultoria e Diagnóstico', valor: 10000 }, { rotulo: 'Formação', valor: 2600.5 }, { rotulo: 'Produtos e Equipamentos', valor: 0 }] };
const lerDoc = async (blobOuBuf) => { const buf = blobOuBuf.arrayBuffer ? Buffer.from(await blobOuBuf.arrayBuffer()) : blobOuBuf; const z = await JSZip.loadAsync(buf); return { doc: await z.file('word/document.xml').async('string'), cab: await z.file('word/header1.xml').async('string') }; };
const textos = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);

test('valores sugeridos: ano/obra da referência GIAF, áreas, revisão = versão − 1, data por extenso, honorários', () => {
  const v = W.valoresPadrao(ctx);
  assert.deepEqual([v.Ano, v.NObra, v.DepUn, v.NRev, v.DDia, v.DMes, v.DAno], ['2026', '829', 'DCS/ROB', '1', '9', 'outubro', '2026']);
  assert.equal(v.honorarios, '12.600,50'); assert.equal(v.rubricas.length, 2);        // rubricas a zero ficam de fora
  assert.equal(W.eur(1234567.891), '1.234.567,89'); assert.equal(W.eur(0), '0,00');
});

test('preenche os 9 campos da capa, mantém o formato e escapa o texto', async () => {
  const { blob, avisos } = await W.gerar(await modelo(), W.valoresPadrao(ctx));
  const { doc, cab } = await lerDoc(blob);
  assert.deepEqual(avisos, []);
  const t = textos(doc);
  ['Auditoria IA &amp; dados', 'Têxtil &lt;do&gt; Ave', '2026', '829', 'DCS/ROB', '1', '9', 'outubro'].forEach(x => assert.ok(t.includes(x), 'falta ' + x));
  ['Nome do trabalho a realizar', 'Nome da Empresa', 'dia', 'mês', 'ano'].forEach(x => assert.equal(t.includes(x), false, 'sobrou o texto de exemplo ' + x));
  assert.match(doc, /<w:szCs w:val="40"\/>[\s\S]*Auditoria IA/);            // o resultado herda o formato do campo
  assert.match(cab, /Auditoria IA &amp; dados/); assert.match(cab, /Têxtil &lt;do&gt; Ave/);
  assert.equal(doc.split('FORMTEXT').length - 1, 9);                          // os campos continuam a ser campos
});

test('honorários: valor na frase e, a seguir, o detalhe por rubricas e a validade', async () => {
  const { blob } = await W.gerar(await modelo(), W.valoresPadrao(ctx));
  const t = textos((await lerDoc(blob)).doc);
  assert.ok(t.some(x => x.startsWith('O valor a cobrar pelo CITEVE é de 12.600,50 €.')));
  const i = t.findIndex(x => x.startsWith('O valor a cobrar'));
  assert.deepEqual(t.slice(i + 1, i + 4), ['Investimento por área de serviço:', '• Consultoria e Diagnóstico: 10.000,00 €', '• Formação: 2.600,50 €']);
  assert.equal(t[i + 4], 'Eventuais custos…');                                  // o resto do documento fica igual
  assert.equal(t.includes('#.###,##'), false);
});

test('validade: o texto do modelo ("válida por 30 dias") acompanha a validade do orçamento', async () => {
  const z = new JSZip(); z.file('word/document.xml', DOC.replace('Eventuais custos…', '- Esta proposta é válida por 30 dias.')); z.file('word/header1.xml', CAB);
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  const t45 = textos((await lerDoc((await W.gerar(buf, { ...W.valoresPadrao(ctx), validadeDias: 45 })).blob)).doc);
  assert.ok(t45.includes('- Esta proposta é válida por 45 dias.'));
  const t30 = textos((await lerDoc((await W.gerar(buf, W.valoresPadrao(ctx))).blob)).doc);
  assert.ok(t30.includes('- Esta proposta é válida por 30 dias.'));
});

test('um ficheiro que não é o DG015 dá um erro claro; um .docx sem a frase dos honorários dá aviso', async () => {
  const z = new JSZip(); z.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Outra coisa</w:t></w:r></w:p></w:body></w:document>');
  await assert.rejects(W.gerar(await z.generateAsync({ type: 'nodebuffer' }), W.valoresPadrao(ctx)), /não é o DG015/);
  const z2 = new JSZip(); z2.file('x.txt', 'não é Word');
  await assert.rejects(W.gerar(await z2.generateAsync({ type: 'nodebuffer' }), W.valoresPadrao(ctx)), /não parece um documento Word/);
});

test('modelo DG015 real (se existir neste computador): os 9 campos e os honorários são preenchidos', { skip: !fs.existsSync(process.env.DG015 || 'C:/Users/mcabral/OneDrive - CITEVE/DTD@CITEVE/Comercial/Templates/DG015_Rev07_Proposta.docx') }, async () => {
  const buf = fs.readFileSync(process.env.DG015 || 'C:/Users/mcabral/OneDrive - CITEVE/DTD@CITEVE/Comercial/Templates/DG015_Rev07_Proposta.docx');
  const { blob, avisos } = await W.gerar(buf, W.valoresPadrao(ctx));
  assert.deepEqual(avisos, []);
  const { doc, cab } = await lerDoc(blob);
  const t = textos(doc);
  assert.ok(t.includes('Auditoria IA &amp; dados')); assert.ok(t.some(x => x.includes('12.600,50 €')));
  assert.equal(t.includes('Nome do trabalho a realizar'), false); assert.match(cab, /Auditoria IA/);
  fs.writeFileSync(require('node:os').tmpdir() + '/proposta_dg015_teste.docx', Buffer.from(await blob.arrayBuffer()));
});

// Ata de reunião em Word — correr com: node --test tests/reunioes-ata.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../lib/jszip.min.js');
const A = require('../js/reunioes-ata.js');

const reuniao = {
  titulo: 'Arranque — Têxtil & Ave <1>', data_hora: new Date(2026, 10, 5, 14, 30).toISOString(), duracao_min: 90, local: 'Sala 2 / Teams',
  cliente: 'Têxtil do Ave, Lda.', projeto_nome: '2026/12 — Lean', oportunidade_titulo: '',
  ordem_trabalhos: '1. Apresentação\n2. Calendário',
  notas: 'Falámos do âmbito.\n\nFicou combinada a visita à fábrica.',
  participantes: [
    { nome: 'Ana Silva', organizacao: 'CITEVE', cargo: 'Gestora', presente: true },
    { nome: 'Rui Costa', organizacao: 'Têxtil do Ave', cargo: 'Diretor', presente: false }
  ],
  pontos: [
    { tipo: 'decisao', texto: 'Arrancar a 1 de dezembro' },
    { tipo: 'acao', texto: 'Enviar calendário', responsavel: 'Ana Silva', prazo: '2026-11-12', concluida: false },
    { tipo: 'acao', texto: 'Confirmar visita', responsavel: '', prazo: null, concluida: true }
  ],
  ficheiros: [{ nome: 'Proposta', ligacao: 'https://citeve.sharepoint.com/p' }]
};

// Verificação mínima de que o XML está bem formado: as etiquetas abrem e fecham por ordem.
function bemFormado(xml) {
  const pilha = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  const semDecl = xml.replace(/<\?xml[^>]*\?>/, '');
  while ((m = re.exec(semDecl))) {
    const [, fecha, nome, , autoFecha] = m;
    if (autoFecha) continue;
    if (!fecha) pilha.push(nome);
    else if (pilha.pop() !== nome) return false;
  }
  return pilha.length === 0;
}

test('esc: escapa XML e tira caracteres de controlo', () => {
  assert.equal(A.esc('a & b <c> "d"\u0001'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
  assert.equal(A.esc(null), '');
});

test('o documento tem todas as secções e os dados da reunião', () => {
  const xml = A.documentoXml(reuniao, { versao: 2, emitidaEm: '2026-11-05T16:00:00Z', emitidaPor: 'Milton Cabral' });
  assert.ok(bemFormado(xml), 'document.xml mal formado');
  ['Ata de reunião', 'Versão 2', 'Participantes', 'Ordem de trabalhos', 'Assuntos tratados', 'Decisões', 'Ações', 'Documentos',
    'Têxtil &amp; Ave &lt;1&gt;', 'Têxtil do Ave, Lda.', '2026/12 — Lean', 'Sala 2 / Teams', '(duração: 1 h 30 min)',
    'Ana Silva', 'Ausente', 'Presente', '1. Arrancar a 1 de dezembro', 'Enviar calendário', '12/11/2026', 'Por fazer', 'Concluída',
    'https://citeve.sharepoint.com/p', 'por Milton Cabral'].forEach(t => assert.ok(xml.includes(t), 'falta: ' + t));
  assert.ok(!xml.includes('RASCUNHO'));
  assert.ok(!xml.includes('>Oportunidade<'), 'linhas vazias não aparecem');
});

test('rascunho: marcado como não emitido; secções vazias omitidas', () => {
  const xml = A.documentoXml({ titulo: 'Só título', data_hora: reuniao.data_hora, participantes: [], pontos: [], ficheiros: [] }, { rascunho: true });
  assert.ok(bemFormado(xml));
  assert.ok(xml.includes('RASCUNHO — ata ainda não emitida'));
  ['Participantes', 'Ordem de trabalhos', 'Decisões', 'Ações', 'Documentos'].forEach(t => assert.ok(!xml.includes(`>${t}<`), 'não devia ter: ' + t));
});

test('parágrafos: uma linha por parágrafo, linhas vazias preservadas', () => {
  const xml = A.paragrafos('a\n\nb');
  assert.equal((xml.match(/<w:p>/g) || []).length, 3);
});

test('gerar: um .docx válido (zip com as partes certas, todas bem formadas)', async () => {
  const buf = await A.gerar(reuniao, { versao: 1, emitidaEm: '2026-11-05T16:00:00Z', emitidaPor: 'Ana' }, JSZip, 'nodebuffer');
  const zip = await JSZip.loadAsync(buf);
  const nomes = Object.keys(zip.files).sort();
  assert.deepEqual(nomes.filter(n => !n.endsWith('/')), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml', 'word/styles.xml']);
  for (const n of nomes.filter(n => !n.endsWith('/'))) assert.ok(bemFormado(await zip.file(n).async('string')), n + ' mal formado');
  const doc = await zip.file('word/document.xml').async('string');
  assert.ok(doc.includes('Arranque'));
});

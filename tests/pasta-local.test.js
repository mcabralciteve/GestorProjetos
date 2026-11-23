// Guardar o Excel na pasta da proposta (neste computador): leitura do link e descida pelas subpastas. node --test tests/pasta-local.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pasta-local.js');
const Envio = require('../js/orcamento-envio.js');
const ler = u => Envio.lerLinkSharePoint(u);

const BASE = 'https://citeve2.sharepoint.com/sites/CITEVEDEPTD/Documentos Partilhados/Comercial/CLIENTES';

test('segmentosRelativos: a pasta da proposta depois de CLIENTES (link direto e link com ?id=)', () => {
  assert.deepEqual(P.segmentosRelativos(BASE + '/Cliente%20X/2026-829%20-%20Titulo', BASE, ler), ['Cliente X', '2026-829 - Titulo']);
  const comId = 'https://citeve2.sharepoint.com/sites/CITEVEDEPTD/Documentos%20Partilhados/Forms/AllItems.aspx?id=' + encodeURIComponent('/sites/CITEVEDEPTD/Documentos Partilhados/Comercial/CLIENTES/Cliente X/2026-829 - Titulo');
  assert.deepEqual(P.segmentosRelativos(comId, BASE, ler), ['Cliente X', '2026-829 - Titulo']);
});
test('segmentosRelativos: fora de CLIENTES, a própria CLIENTES, caminho de disco ou vazio → null', () => {
  assert.equal(P.segmentosRelativos('https://citeve2.sharepoint.com/sites/CITEVEDEPTD/Documentos Partilhados/Outro/Cliente', BASE, ler), null);
  assert.equal(P.segmentosRelativos(BASE, BASE, ler), null);
  assert.equal(P.segmentosRelativos('C:\Pastas\Proposta', BASE, ler), null);
  assert.equal(P.segmentosRelativos('', BASE, ler), null);
  assert.equal(P.segmentosRelativos(BASE + '/A/B', '', ler), null);
});

// Pastas de mentira com a mesma forma da API do browser.
function pasta(filhos, opcoes) {
  opcoes = opcoes || {};
  const escritos = [];
  const h = {
    escritos, permissao: opcoes.permissao || 'granted',
    async queryPermission() { return h.permissao; }, async requestPermission() { return opcoes.aoPedir || h.permissao; },
    async getDirectoryHandle(nome, o) { if (o && o.create) throw new Error('nunca deve criar'); if (!filhos[nome]) throw new Error('não existe'); return filhos[nome]; },
    async getFileHandle(nome) { return { async createWritable() { return { async write(b) { escritos.push({ nome, b }); }, async close() {} }; } }; }
  };
  return h;
}

test('guardar: escreve na pasta da proposta quando existe e há permissão', async () => {
  const proposta = pasta({});
  const raiz = pasta({ 'Cliente X': pasta({ '2026-829 - T': proposta }) });
  const r = await P.guardar(raiz, ['Cliente X', '2026-829 - T'], 'a.xlsx', 'blob');
  assert.equal(r.ok, true);
  assert.deepEqual(proposta.escritos, [{ nome: 'a.xlsx', b: 'blob' }]);
});
test('guardar: sem pasta CLIENTES, sem link válido, sem permissão ou pasta inexistente → ok:false com o motivo (nunca cria pastas)', async () => {
  assert.equal((await P.guardar(null, ['A'], 'a', 'b')).motivo, 'sem-pasta-clientes');
  assert.equal((await P.guardar(pasta({}), null, 'a', 'b')).motivo, 'sem-link-valido');
  assert.equal((await P.guardar(pasta({ A: pasta({}) }, { permissao: 'prompt', aoPedir: 'denied' }), ['A'], 'a', 'b')).motivo, 'sem-permissao');
  assert.equal((await P.guardar(pasta({ A: pasta({}) }), ['A', 'B'], 'a', 'b')).motivo, 'pasta-nao-existe');
  assert.equal((await P.guardar(pasta({ A: pasta({}) }, { permissao: 'prompt', aoPedir: 'granted' }), ['A'], 'a', 'b')).ok, true);   // pede e recebe
});

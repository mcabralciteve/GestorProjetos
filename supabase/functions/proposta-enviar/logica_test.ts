import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { copiarParaSharePoint, garantirPasta, lerLinkSharePoint, limparNome, nomePastaProposta, validarPedido, type Chamar, type PedidoEnvio } from './logica.ts';

const LINK = 'https://citeve2.sharepoint.com/:f:/r/sites/CITEVEDEPTD/Documentos%20Partilhados/Comercial/CLIENTES?d=w4ba4efd9a0bb462987726d1e64d2f503&csf=1&web=1&e=rYfbQ0';

Deno.test('link do SharePoint: site, biblioteca e pasta base (link de partilha e link de navegador)', () => {
  const esperado = { host: 'citeve2.sharepoint.com', sitio: '/sites/CITEVEDEPTD', biblioteca: 'Documentos Partilhados', pasta: ['Comercial', 'CLIENTES'] };
  assertEquals(lerLinkSharePoint(LINK), esperado);
  assertEquals(lerLinkSharePoint('https://citeve2.sharepoint.com/sites/CITEVEDEPTD/Documentos%20Partilhados/Forms/AllItems.aspx?id=%2Fsites%2FCITEVEDEPTD%2FDocumentos%20Partilhados%2FComercial%2FCLIENTES'), esperado);
  assertEquals(lerLinkSharePoint('https://citeve2.sharepoint.com/sites/CITEVEDEPTD/Documentos%20Partilhados')?.pasta, []);
  assertEquals(lerLinkSharePoint('https://exemplo.com/sites/x/y'), null);
  assertEquals(lerLinkSharePoint('isto não é um link'), null);
  assertEquals(lerLinkSharePoint('https://citeve2.sharepoint.com/sites/CITEVEDEPTD'), null);        // falta a biblioteca
});

Deno.test('nomes de pastas aceites pelo SharePoint', () => {
  assertEquals(limparNome('Têxtil do Ave, Lda.'), 'Têxtil do Ave, Lda');                 // sem ponto final
  assertEquals(limparNome('A/B:C*D?E"F<G>H|I#J%K'), 'A-B-C-D-E-F-G-H-I-J-K');
  assertEquals(limparNome('   '), 'Sem nome');
  assertEquals(limparNome('x'.repeat(300)).length, 100);
  assertEquals(nomePastaProposta('2026/829-01', 'Auditoria IA'), '2026-829-01 - Auditoria IA');
  assertEquals(nomePastaProposta('', 'Auditoria IA'), 'Auditoria IA');
  assertEquals(nomePastaProposta('2026/829-01', ''), '2026-829-01');
});

const b64 = (t: string) => btoa(t);
const pedidoBase = (): PedidoEnvio => ({
  para: ['cliente@empresa.pt'], cc: ['milton@citeve.pt'], responderPara: ['milton@citeve.pt'], assunto: 'Proposta', corpoHtml: '<p>Olá</p>',
  anexos: [{ nome: 'p.xlsx', tipo: 'application/octet-stream', base64: b64('conteudo') }],
  pasta: { cliente: 'Alfa', proposta: '2026-829-01', ficheiros: [{ nome: 'p.xlsx', base64: b64('conteudo') }, { nome: 'interno.xlsx', base64: b64('margens'), subpasta: 'Interno' }] },
});

Deno.test('validação do pedido: destinatário, endereços, assunto, anexos e tamanho', () => {
  assertEquals(validarPedido(pedidoBase()), []);
  assert(validarPedido({ ...pedidoBase(), para: [] }).some(e => e.includes('destinatário')));
  assert(validarPedido({ ...pedidoBase(), para: ['sem-arroba'] }).some(e => e.includes('inválido')));
  assert(validarPedido({ ...pedidoBase(), cc: ['x@'] }).some(e => e.includes('inválido')));
  assert(validarPedido({ ...pedidoBase(), assunto: ' ' }).some(e => e.includes('assunto')));
  assert(validarPedido({ ...pedidoBase(), anexos: [] }).some(e => e.includes('anexos')));
  const grande = btoa('a'.repeat(4 * 1024 * 1024));
  assert(validarPedido({ ...pedidoBase(), pasta: { cliente: 'A', proposta: 'B', ficheiros: [{ nome: 'g.docx', base64: grande }] } }).some(e => e.includes('3,5 MB')));
  const enorme = btoa('a'.repeat(7 * 1024 * 1024));
  assert(validarPedido({ ...pedidoBase(), anexos: [{ nome: 'a', tipo: 'x', base64: enorme }, { nome: 'b', tipo: 'x', base64: enorme }] }).some(e => e.includes('12 MB')));
});

// Graph simulado: pastas existentes e registo dos pedidos
function graphSimulado(existentes: string[], falhas: Record<string, number> = {}) {
  const pastas = new Set(existentes.map(p => p.toLowerCase()));
  const pedidos: string[] = [];
  const chamar: Chamar = async (metodo, caminho, corpo, bytes) => {
    pedidos.push(`${metodo} ${decodeURIComponent(caminho)}`);
    for (const [k, st] of Object.entries(falhas)) if (caminho.includes(encodeURIComponent(k))) return { status: st, json: { error: { message: 'simulado' } } };
    if (caminho.startsWith('/sites/citeve2.sharepoint.com:')) return { status: 200, json: { id: 'SITE' } };
    if (caminho.startsWith('/sites/SITE/drives')) return { status: 200, json: { value: [{ id: 'D0', name: 'Documentos', webUrl: 'https://x/Documentos' }, { id: 'D1', name: 'Documentos Partilhados', webUrl: 'https://x/Documentos%20Partilhados' }] } };
    const m = caminho.match(/^\/drives\/(\w+)\/root:\/(.+?)(:\/children|:\/content.*)?$/);
    if (metodo === 'GET' && m) { const p = decodeURIComponent(m[2]).toLowerCase(); return pastas.has(p) ? { status: 200, json: { webUrl: `https://sp/${decodeURIComponent(m[2])}` } } : { status: 404, json: null }; }
    if (metodo === 'POST') {
      const pai = m ? decodeURIComponent(m[2]) : '';
      const novo = (pai ? pai + '/' : '') + (corpo as { name: string }).name;
      if (pastas.has(novo.toLowerCase())) return { status: 409, json: null };
      pastas.add(novo.toLowerCase()); return { status: 201, json: { webUrl: `https://sp/${novo}` } };
    }
    if (metodo === 'PUT') { assert(bytes && bytes.length > 0); return { status: 201, json: {} }; }
    return { status: 500, json: null };
  };
  return { chamar, pedidos, pastas };
}

Deno.test('SharePoint: cria cliente e proposta que faltam, copia os ficheiros (interno em subpasta) e devolve o link da proposta', async () => {
  const local = lerLinkSharePoint(LINK)!;
  const g = graphSimulado(['Comercial', 'Comercial/CLIENTES']);
  const r = await copiarParaSharePoint(g.chamar, local, pedidoBase().pasta!);
  assertEquals(r.url, 'https://sp/Comercial/CLIENTES/Alfa/2026-829-01');
  assertEquals(r.copiados, ['p.xlsx', 'Interno/interno.xlsx']);
  assert(g.pastas.has('comercial/clientes/alfa/2026-829-01/interno'));
  assert(g.pedidos.some(p => p.startsWith('PUT') && p.includes('Alfa/2026-829-01/Interno/interno.xlsx')));
});

Deno.test('SharePoint: pasta do cliente já existente não se recria; segunda vez substitui os ficheiros', async () => {
  const local = lerLinkSharePoint(LINK)!;
  const g = graphSimulado(['Comercial', 'Comercial/CLIENTES', 'Comercial/CLIENTES/Alfa', 'Comercial/CLIENTES/Alfa/2026-829-01']);
  await copiarParaSharePoint(g.chamar, local, pedidoBase().pasta!);
  assertEquals(g.pedidos.filter(p => p.startsWith('POST')).length, 1);                      // só a subpasta Interno (as outras já existiam)
  assert(g.pedidos.some(p => p.includes('conflictBehavior=replace')));
});

Deno.test('SharePoint: erros claros (sem permissão, site inexistente, biblioteca em falta)', async () => {
  const local = lerLinkSharePoint(LINK)!;
  await assertRejects(() => copiarParaSharePoint(graphSimulado([], { 'citeve2.sharepoint.com': 403 }).chamar, local, pedidoBase().pasta!), Error, 'site');
  await assertRejects(() => copiarParaSharePoint(graphSimulado([]).chamar, { ...local, biblioteca: 'Outra' }, pedidoBase().pasta!), Error, 'biblioteca');
  await assertRejects(() => garantirPasta(graphSimulado([], { Comercial: 500 }).chamar, 'D1', ['Comercial']), Error, 'Erro ao ler a pasta');
});

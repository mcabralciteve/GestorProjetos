// Lógica pura do envio de propostas: endereços do SharePoint, nomes de pastas/ficheiros e cópia dos ficheiros para o
// SharePoint (a chamada à rede é injetada, por isso testa-se sem Microsoft 365).

export interface LocalSharePoint { host: string; sitio: string; biblioteca: string; pasta: string[] }

// "https://citeve2.sharepoint.com/:f:/r/sites/CITEVEDEPTD/Documentos%20Partilhados/Comercial/CLIENTES?d=…"
//   -> { host: 'citeve2.sharepoint.com', sitio: '/sites/CITEVEDEPTD', biblioteca: 'Documentos Partilhados', pasta: ['Comercial', 'CLIENTES'] }
// Aceita também os links de navegador (".../Forms/AllItems.aspx?id=%2Fsites%2F…").
export function lerLinkSharePoint(url: string): LocalSharePoint | null {
  let u: URL;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/\.sharepoint\.com$/i.test(u.hostname)) return null;
  let caminho = u.searchParams.get('id') ?? decodeURIComponent(u.pathname);
  caminho = caminho.replace(/^\/:[a-z]:\/[a-z]\//i, '/');                   // "/:f:/r/" dos links de partilha
  const segs = caminho.split('/').filter(Boolean);
  if (segs.length < 3 || !['sites', 'teams'].includes(segs[0].toLowerCase())) return null;
  return { host: u.hostname, sitio: `/${segs[0]}/${segs[1]}`, biblioteca: segs[2], pasta: segs.slice(3) };
}

// Nomes aceites pelo SharePoint: sem \ / : * ? " < > | # %, sem pontos/espaços no fim, no máximo ~100 caracteres.
export function limparNome(nome: string, maximo = 100): string {
  const t = String(nome ?? '').replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (t.length > maximo ? t.slice(0, maximo).trim() : t) || 'Sem nome';
}

// 2026/829-01 + "Auditoria IA" -> "2026-829-01 - Auditoria IA"
export function nomePastaProposta(referencia: string, titulo: string): string {
  const ref = limparNome(String(referencia ?? '').replace(/\//g, '-'), 40);
  const t = String(titulo ?? '').trim();
  return referencia ? limparNome(t ? `${ref} - ${t}` : ref) : limparNome(t || 'Proposta');
}

export interface Ficheiro { nome: string; tipo?: string; base64: string; subpasta?: string }
export interface PedidoEnvio {
  para: string[]; cc?: string[]; responderPara?: string[]; assunto: string; corpoHtml: string;
  anexos: { nome: string; tipo: string; base64: string }[];
  pasta?: { cliente: string; proposta: string; ficheiros: Ficheiro[] } | null;
  teste?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LIMITE_TOTAL = 12 * 1024 * 1024;          // bytes (aprox.) somando anexos e ficheiros da pasta
export const LIMITE_FICHEIRO_SHAREPOINT = 3.5 * 1024 * 1024;   // envio simples do Graph vai até 4 MB

export function tamanhoBase64(b64: string): number { return Math.floor((b64.length * 3) / 4); }

// Devolve a lista de problemas do pedido (vazia = pode seguir).
export function validarPedido(p: PedidoEnvio): string[] {
  const erros: string[] = [];
  if (!p || typeof p !== 'object') return ['Pedido inválido.'];
  if (!Array.isArray(p.para) || !p.para.length) erros.push('Falta o destinatário.');
  [...(p.para ?? []), ...(p.cc ?? []), ...(p.responderPara ?? [])].forEach(a => { if (!EMAIL.test(String(a))) erros.push(`Endereço inválido: ${a}`); });
  if (!String(p.assunto ?? '').trim()) erros.push('Falta o assunto.');
  if (!String(p.corpoHtml ?? '').trim()) erros.push('Falta o texto do email.');
  const todos = [...(p.anexos ?? []), ...(p.pasta?.ficheiros ?? [])];
  if (!(p.anexos ?? []).length) erros.push('O email não tem anexos.');
  todos.forEach(f => { if (!f.nome || !f.base64) erros.push('Um ficheiro está vazio.'); });
  const total = todos.reduce((s, f) => s + tamanhoBase64(f.base64 ?? ''), 0);
  if (total > LIMITE_TOTAL) erros.push('Os ficheiros somam mais de 12 MB.');
  (p.pasta?.ficheiros ?? []).forEach(f => { if (tamanhoBase64(f.base64 ?? '') > LIMITE_FICHEIRO_SHAREPOINT) erros.push(`"${f.nome}" é maior do que 3,5 MB.`); });
  return erros;
}

// ---------- Cópia para o SharePoint ----------
// "chamar" faz o pedido ao Microsoft Graph (injetado). Devolve { status, json }.
export type Chamar = (metodo: string, caminho: string, corpo?: unknown, bytes?: Uint8Array) => Promise<{ status: number; json: any }>;
const enc = (segmentos: string[]) => segmentos.map(encodeURIComponent).join('/');

export async function resolverBiblioteca(chamar: Chamar, local: LocalSharePoint): Promise<string> {
  const s = await chamar('GET', `/sites/${local.host}:${local.sitio}`);
  if (s.status >= 300) throw new Error(`Não encontrei o site ${local.sitio} (${s.status}${s.json?.error?.message ? ': ' + s.json.error.message : ''}).`);
  const d = await chamar('GET', `/sites/${s.json.id}/drives?$select=id,name,webUrl`);
  if (d.status >= 300) throw new Error(`Não consegui listar as bibliotecas do site (${d.status}).`);
  const alvo = local.biblioteca.toLowerCase();
  const lib = (d.json.value ?? []).find((x: any) => String(x.name).toLowerCase() === alvo || decodeURIComponent(String(x.webUrl)).toLowerCase().endsWith('/' + alvo));
  if (!lib) throw new Error(`Não encontrei a biblioteca "${local.biblioteca}" no site.`);
  return lib.id;
}

// Garante que a pasta existe (cria o que faltar, nível a nível). Devolve o item da última pasta.
export async function garantirPasta(chamar: Chamar, drive: string, segmentos: string[]): Promise<any> {
  let item: any = null;
  for (let i = 0; i < segmentos.length; i++) {
    const ate = segmentos.slice(0, i + 1);
    const g = await chamar('GET', `/drives/${drive}/root:/${enc(ate)}`);
    if (g.status === 200) { item = g.json; continue; }
    if (g.status !== 404) throw new Error(`Erro ao ler a pasta "${ate.join('/')}" (${g.status}).`);
    const pai = i === 0 ? `/drives/${drive}/root/children` : `/drives/${drive}/root:/${enc(segmentos.slice(0, i))}:/children`;
    const c = await chamar('POST', pai, { name: segmentos[i], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
    if (c.status === 409) { const r = await chamar('GET', `/drives/${drive}/root:/${enc(ate)}`); item = r.json; continue; }
    if (c.status >= 300) throw new Error(`Não consegui criar a pasta "${segmentos[i]}" (${c.status}${c.json?.error?.message ? ': ' + c.json.error.message : ''}).`);
    item = c.json;
  }
  return item;
}

export function bytesDe(base64: string): Uint8Array {
  const bin = atob(base64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// Copia os ficheiros para <pasta base>/<cliente>/<proposta>[/<subpasta>]. Devolve o link da pasta da PROPOSTA.
export async function copiarParaSharePoint(chamar: Chamar, local: LocalSharePoint, pasta: NonNullable<PedidoEnvio['pasta']>): Promise<{ url: string; copiados: string[] }> {
  const drive = await resolverBiblioteca(chamar, local);
  const raiz = [...local.pasta, limparNome(pasta.cliente), limparNome(pasta.proposta)];
  const itemProposta = await garantirPasta(chamar, drive, raiz);
  const copiados: string[] = [];
  const subpastasFeitas = new Set<string>();
  for (const f of pasta.ficheiros) {
    const sub = f.subpasta ? limparNome(f.subpasta) : '';
    if (sub && !subpastasFeitas.has(sub)) { await garantirPasta(chamar, drive, [...raiz, sub]); subpastasFeitas.add(sub); }
    const destino = [...raiz, ...(sub ? [sub] : []), limparNome(f.nome, 150)];
    const u = await chamar('PUT', `/drives/${drive}/root:/${enc(destino)}:/content?@microsoft.graph.conflictBehavior=replace`, undefined, bytesDe(f.base64));
    if (u.status >= 300) throw new Error(`Não consegui copiar "${f.nome}" (${u.status}${u.json?.error?.message ? ': ' + u.json.error.message : ''}).`);
    copiados.push(destino.slice(raiz.length).join('/'));
  }
  return { url: String(itemProposta?.webUrl ?? ''), copiados };
}

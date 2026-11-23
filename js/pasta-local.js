// Guardar um ficheiro (o Excel da proposta) na pasta da proposta DENTRO DO COMPUTADOR — a pasta do SharePoint/OneDrive sincronizada.
// Um site não pode escrever num caminho nem num link: só numa pasta que a pessoa escolheu (API do browser "showDirectoryPicker",
// Chrome/Edge). Escolhe-se UMA vez a pasta CLIENTES deste computador; a app guarda-a no browser (IndexedDB) e, para cada proposta,
// segue o link da pasta da proposta (campo "Documento") até à subpasta certa. Se a pasta não existir ou não houver permissão,
// quem chama descarrega para as Transferências. Nada disto vai para o servidor. Testado em tests/pasta-local.test.js.
const PastaLocal = {
  BD: 'gp_pasta_local', LOJA: 'pastas', CHAVE: 'clientes',

  suportado() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined'; },

  // Segmentos da pasta da proposta DEPOIS da pasta base CLIENTES (link do SharePoint de cada uma). null = o link não está dentro da base.
  // lerLink: lê um link do SharePoint (OrcEnvio.lerLinkSharePoint) → { host, sitio, biblioteca, pasta: [...] } | null.
  segmentosRelativos(linkProposta, linkBase, lerLink) {
    const p = lerLink(linkProposta), b = lerLink(linkBase);
    if (!p || !b) return null;
    const igual = (x, y) => String(x).toLowerCase() === String(y).toLowerCase();
    if (!igual(p.host, b.host) || !igual(p.sitio, b.sitio) || !igual(p.biblioteca, b.biblioteca)) return null;
    if (p.pasta.length <= b.pasta.length || !b.pasta.every((s, i) => igual(s, p.pasta[i]))) return null;
    return p.pasta.slice(b.pasta.length);
  },

  // Desce pelas subpastas SEM criar nenhuma (a pasta da proposta tem de existir). Devolve a pasta final ou null.
  async descer(raiz, segmentos) {
    let atual = raiz;
    for (const seg of segmentos) {
      try { atual = await atual.getDirectoryHandle(seg, { create: false }); } catch (e) { return null; }
    }
    return atual;
  },

  // Pede (ou confirma) a permissão de escrita. Tem de correr dentro de um clique da pessoa (o botão do Excel serve).
  async permissao(pasta) {
    const opcoes = { mode: 'readwrite' };
    try {
      if ((await pasta.queryPermission(opcoes)) === 'granted') return true;
      return (await pasta.requestPermission(opcoes)) === 'granted';
    } catch (e) { return false; }
  },

  async escreverFicheiro(pasta, nome, blob) {
    const ficheiro = await pasta.getFileHandle(nome, { create: true });
    const w = await ficheiro.createWritable();
    try { await w.write(blob); } finally { await w.close(); }
  },

  // Tenta guardar na pasta da proposta. { ok: true, onde } | { ok: false, motivo } — o motivo diz porque se foi para as Transferências.
  async guardar(raiz, segmentos, nome, blob) {
    if (!raiz) return { ok: false, motivo: 'sem-pasta-clientes' };
    if (!segmentos || !segmentos.length) return { ok: false, motivo: 'sem-link-valido' };
    if (!(await this.permissao(raiz))) return { ok: false, motivo: 'sem-permissao' };
    const pasta = await this.descer(raiz, segmentos);
    if (!pasta) return { ok: false, motivo: 'pasta-nao-existe' };
    try { await this.escreverFicheiro(pasta, nome, blob); } catch (e) { return { ok: false, motivo: 'erro-escrita' }; }
    return { ok: true, onde: segmentos.join(' / ') };
  },

  MOTIVOS: {
    'sem-pasta-clientes': 'ainda não ligaste a pasta CLIENTES deste computador',
    'sem-link-valido': 'a proposta não tem em "Documento" o link de uma pasta dentro de CLIENTES',
    'sem-permissao': 'o browser não deu permissão para escrever na pasta',
    'pasta-nao-existe': 'a pasta da proposta não existe na pasta CLIENTES deste computador (ou ainda não sincronizou)',
    'erro-escrita': 'não consegui escrever na pasta'
  },

  // ---- A pasta CLIENTES escolhida fica guardada no browser (IndexedDB), só neste computador ----
  _abrir() {
    return new Promise((resolver, rejeitar) => {
      const pedido = indexedDB.open(this.BD, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore(this.LOJA);
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
  },
  async _com(modo, fazer) {
    const bd = await this._abrir();
    try {
      return await new Promise((resolver, rejeitar) => {
        const t = bd.transaction(this.LOJA, modo), r = fazer(t.objectStore(this.LOJA));
        t.oncomplete = () => resolver(r.result);
        t.onerror = () => rejeitar(t.error);
      });
    } finally { bd.close(); }
  },
  async raizGuardada() {
    if (!this.suportado()) return null;
    try { return (await this._com('readonly', s => s.get(this.CHAVE))) || null; } catch (e) { return null; }
  },
  async escolherRaiz() {
    const pasta = await window.showDirectoryPicker({ mode: 'readwrite', id: 'fio-clientes' });
    try { await this._com('readwrite', s => s.put(pasta, this.CHAVE)); } catch (e) { /* sem IndexedDB: vale só até fechar a página */ }
    return pasta;
  },
  async esquecerRaiz() { try { await this._com('readwrite', s => s.delete(this.CHAVE)); } catch (e) { /* nada */ } }
};
if (typeof module !== 'undefined') module.exports = PastaLocal;

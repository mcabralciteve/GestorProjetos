// Envio da proposta ao cliente: regras puras (texto do email, nomes de ficheiros, pré-requisitos, link do SharePoint). O envio em si
// (email com anexos + cópia para o SharePoint) faz-se na função do servidor "proposta-enviar" — ver supabase/functions/proposta-enviar.
// Testado em tests/orcamento-envio.test.js.
const OrcEnvio = {
  _esc(t) { return String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },

  // Mesma leitura do link que a função do servidor faz (aqui só para mostrar ao Administrador o que foi percebido).
  lerLinkSharePoint(url) {
    let u;
    try { u = new URL(String(url).trim()); } catch (e) { return null; }
    if (!/\.sharepoint\.com$/i.test(u.hostname)) return null;
    let caminho = u.searchParams.get('id') || decodeURIComponent(u.pathname);
    caminho = caminho.replace(/^\/:[a-z]:\/[a-z]\//i, '/');
    const segs = caminho.split('/').filter(Boolean);
    if (segs.length < 3 || !['sites', 'teams'].includes(segs[0].toLowerCase())) return null;
    return { host: u.hostname, sitio: `/${segs[0]}/${segs[1]}`, biblioteca: segs[2], pasta: segs.slice(3) };
  },
  limparNome(nome, maximo) {
    maximo = maximo || 100;
    const t = String(nome === null || nome === undefined ? '' : nome).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    return (t.length > maximo ? t.slice(0, maximo).trim() : t) || 'Sem nome';
  },
  nomePastaProposta(referencia, titulo) {
    const ref = this.limparNome(String(referencia || '').replace(/\//g, '-'), 40), t = String(titulo || '').trim();
    return referencia ? this.limparNome(t ? `${ref} - ${t}` : ref) : this.limparNome(t || 'Proposta');
  },
  semAcentos(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); },
  // Nomes dos ficheiros: sem acentos nem espaços (seguem em anexo e ficam no SharePoint).
  nomesFicheiros(ctx) {
    const cli = this.semAcentos(ctx.cliente || 'cliente').replace(/[^\w\-]+/g, '_').slice(0, 40).replace(/^_+|_+$/g, '') || 'cliente';
    const ref = String(ctx.referencia || '').replace(/[^\w\-]+/g, '_');
    const base = `${cli}${ref ? '_' + ref : ''}`;
    return { excel: `Proposta_${base}_v${ctx.versao}.xlsx`, word: `Proposta_${base}.docx`, interno: `Orcamento_interno_${base}_v${ctx.versao}.xlsx` };
  },

  assuntoPadrao(ctx) { return `Proposta${ctx.referencia ? ' ' + ctx.referencia : ''}${ctx.titulo ? ' — ' + ctx.titulo : ''}`; },
  // Texto do email (editável antes de enviar).
  mensagemPadrao(ctx) {
    const nome = String(ctx.contacto || '').trim();
    return `${nome ? `Exmo(a). Sr(a). ${nome},` : 'Exmos. Senhores,'}\n\n` +
      `Agradecemos o contacto e o interesse no CITEVE. Segue em anexo a nossa proposta${ctx.titulo ? ` para "${ctx.titulo}"` : ''}${ctx.referencia ? ` (ref. ${ctx.referencia})` : ''}.\n\n` +
      `A proposta é válida por ${ctx.validadeDias || 30} dias. Ficamos ao dispor para qualquer esclarecimento.\n\n` +
      `Com os melhores cumprimentos,\n${ctx.responsavel || 'CITEVE'}\nCITEVE — Centro Tecnológico das Indústrias Têxtil e do Vestuário`;
  },
  htmlDoTexto(texto) {
    return String(texto || '').split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;">${this._esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  },

  // Lista de problemas que impedem o envio (vazia = pode enviar). contacto: { nome, email } | null.
  verificar(ctx) {
    const erros = [];
    if (!(ctx.total > 0)) erros.push('O orçamento tem preço final 0 €.');
    if (!ctx.contactos || !ctx.contactos.some(c => /^\S+@\S+\.\S+$/.test(String(c.email || '')))) erros.push('A conta não tem nenhum contacto com email — acrescenta-o no CRM (Contactos).');
    return erros;
  },
  avisos(ctx) {
    const a = [];
    if (!ctx.referencia) a.push('A proposta ainda não tem referência GIAF — a pasta no SharePoint ficará só com o título.');
    if (!ctx.sharepointConfigurado) a.push('O link da pasta CLIENTES do SharePoint não está configurado (Configurações → Funil CRM): os ficheiros não serão copiados.');
    return a;
  },
  // Endereços separados por vírgula/ponto e vírgula -> lista sem repetidos.
  listaEmails(texto) {
    return [...new Set(String(texto || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean))];
  },
  emailValido(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); },
  base64DeBuffer(buffer) {
    const u8 = new Uint8Array(buffer); let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  // Texto da interação registada na conta depois de enviar.
  resumoInteracao(ctx) {
    return `Proposta${ctx.referencia ? ' ' + ctx.referencia : ''} (orçamento v${ctx.versao}, ${ctx.totalTexto}) enviada a ${ctx.para.join(', ')}. Anexos: ${ctx.anexos.join(', ')}.${ctx.pastaUrl ? ' Pasta: ' + ctx.pastaUrl : ''}`;
  }
};
if (typeof module !== 'undefined') module.exports = OrcEnvio;

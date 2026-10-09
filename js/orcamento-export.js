// Exportação da "Proposta Cliente" para Excel: preenche o modelo assets/orcamentos/Proposta_Cliente_Template.xlsx
// (a página para o cliente da folha de orçamentação — sem overhead, custos específicos, margem nem valores/hora).
// O modelo guarda o aspeto; aqui só se escrevem valores nas células (mesma técnica da reserva de viatura: JSZip).
const OrcExport = {
  TEMPLATE: 'assets/orcamentos/Proposta_Cliente_Template.xlsx',
  // Quantas linhas de lista o modelo tem (o excedente é indicado com "… e mais N").
  LISTAS: { consultoria: { primeira: 22, n: 10 }, formacao: { primeira: 34, n: 5 }, produtos: { primeira: 41, n: 8 } },
  AREAS: { titulo: 'A50', primeira: 51, n: 5 },
  RUBRICAS: ['consultoria', 'formacao', 'deslocacoes', 'consumiveis', 'produtos'],   // linhas 11..15 do modelo

  dataPT(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; },

  // dados: { cliente, projeto, data (ISO), validadeDias, responsavel, pc }  (pc = OrcLogica.propostaCliente(orc))
  // Devolve { ref: { t: 's'|'n', v } } — só as células a preencher.
  celulas(dados) {
    const c = {}, pc = dados.pc;
    const s = (ref, v) => { c[ref] = { t: 's', v: String(v === null || v === undefined ? '' : v) }; };
    const n = (ref, v) => { c[ref] = { t: 'n', v: Number(v) || 0 }; };
    s('B4', dados.cliente); s('B5', dados.projeto); s('B6', this.dataPT(dados.data)); n('D6', dados.validadeDias); s('B7', dados.responsavel);
    this.RUBRICAS.forEach((k, i) => n(`C${11 + i}`, pc.investimento[k]));
    n('C16', pc.total);
    Object.entries(this.LISTAS).forEach(([k, { primeira, n: max }]) => {
      const itens = pc.escopo[k] || [];
      const visiveis = itens.length > max ? itens.slice(0, max - 1) : itens;
      visiveis.forEach((t, i) => s(`A${primeira + i}`, `• ${t}`));
      if (itens.length > max) s(`A${primeira + max - 1}`, `… e mais ${itens.length - (max - 1)}`);
    });
    if (pc.porArea.length > 1) {
      s(this.AREAS.titulo, 'Investimento por área');
      pc.porArea.slice(0, this.AREAS.n).forEach((a, i) => { s(`A${this.AREAS.primeira + i}`, a.nome); n(`C${this.AREAS.primeira + i}`, a.total); });
    }
    return c;
  },

  esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  // Troca o conteúdo das células indicadas, mantendo o estilo (s="…") que o modelo lá tem.
  preencherXml(xml, celulas) {
    let resultado = xml;
    Object.entries(celulas).forEach(([ref, { t, v }]) => {
      const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
      const m = resultado.match(re);
      if (!m) throw new Error(`O modelo da proposta não tem a célula ${ref}.`);
      const estilo = (m[1].match(/\ss="(\d+)"/) || [])[1];
      const attr = estilo !== undefined ? ` s="${estilo}"` : '';
      const nova = t === 'n' ? `<c r="${ref}"${attr}><v>${Number.isFinite(v) ? v : 0}</v></c>`
        : (v === '' ? `<c r="${ref}"${attr}/>` : `<c r="${ref}"${attr} t="inlineStr"><is><t xml:space="preserve">${this.esc(v)}</t></is></c>`);
      resultado = resultado.replace(m[0], () => nova);
    });
    return resultado;
  },

  async gerar(dados, buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const f = zip.file('xl/worksheets/sheet1.xml');
    if (!f) throw new Error('O modelo da proposta está corrompido.');
    zip.file('xl/worksheets/sheet1.xml', this.preencherXml(await f.async('string'), this.celulas(dados)));
    // O Excel recalcula ao abrir; nada de fórmulas no modelo, por isso não há cache a invalidar.
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  },
  async descarregar(dados, nomeFicheiro) {
    const r = await fetch(this.TEMPLATE, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Não consegui abrir o modelo da proposta.');
    const blob = await this.gerar(dados, await r.arrayBuffer());
    App.descarregarBlob(blob, nomeFicheiro);
  }
};
if (typeof module !== 'undefined') module.exports = OrcExport;

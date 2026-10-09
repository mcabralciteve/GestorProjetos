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
  // Orçamento INTERNO (com margens, custos específicos e valores/hora) — só para arquivo: nunca vai para o cliente.
  // ctx: { cliente, projeto, referencia, estado, data }. Devolve o ficheiro .xlsx (ArrayBuffer). Precisa da biblioteca XLSX carregada.
  interno(orc, ctx) {
    const O = OrcLogica, E = O.euro;
    const calc = O.calcOrcamento(orc), pc = O.propostaCliente(orc), par = { aluguer_saida: orc.aluguer_saida, custo_km: orc.custo_km };
    const wb = XLSX.utils.book_new();
    const folha = (nome, aoa, larguras) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = (larguras || []).map(w => ({ wch: w }));
      let n = String(nome).replace(/[\/?*\[\]:]/g, '-').slice(0, 31) || 'Folha', i = 2;
      while (wb.SheetNames.includes(n)) n = `${String(nome).slice(0, 27)}-${i++}`;
      XLSX.utils.book_append_sheet(wb, ws, n);
    };
    const r2 = v => O.arred(v);
    folha('Resumo', [
      ['ORÇAMENTO INTERNO — não enviar ao cliente'], [],
      ['Cliente', ctx.cliente || ''], ['Projeto / proposta', ctx.projeto || ''], ['Referência', ctx.referencia || ''], ['Versão', orc.versao], ['Estado', O.ESTADOS[orc.estado] || orc.estado], ['Data', ctx.data || ''],
      ['Aluguer por saída (€)', orc.aluguer_saida], ['Custo por km (€)', orc.custo_km], [],
      ['Área', 'Horas vendáveis', 'Produtos', 'Despesas de deslocação', 'Consumíveis', 'Custos específicos', 'Preço final', 'Margem (€)', 'Margem (%)'],
      ...calc.areas.map(a => [a.area.nome, r2(a.horasVendaveis), r2(a.produtos), r2(a.despesas), r2(a.consumiveis), r2(a.custosEspecificos), r2(a.precoFinal), r2(a.margem), r2(a.margemPct * 100)]),
      ['TOTAL', r2(calc.horasVendaveis), r2(calc.produtos), r2(calc.despesas), r2(calc.consumiveis), r2(calc.custosEspecificos), r2(calc.total), r2(calc.margem), r2(calc.margemPct * 100)], [],
      ['Vista do cliente (custos específicos já repartidos)', 'Investimento (€)'],
      ...O.RUBRICAS.map(r => [r.rotulo, pc.investimento[r.k]]), ['INVESTIMENTO TOTAL', pc.total]
    ], [34, 16, 14, 22, 14, 18, 14, 12, 12]);
    orc.areas.forEach(area => {
      const linhas = [[`Área ${area.nome}`], []];
      O.SECCOES.forEach(sec => {
        const ls = (area.linhas || []).filter(l => l.seccao === sec.k);
        if (!ls.length) return;
        const consultor = l => (l.recurso_id ? (typeof App !== 'undefined' && App.state.recursos.find(r => r.id === l.recurso_id) || {}).nome : '') || '';
        linhas.push([sec.rotulo.toUpperCase()]);
        if (sec.k === 'consultoria') { linhas.push(['Descrição', 'Consultor', 'Horas', 'Valor/hora', 'Custo/hora', 'Subtotal', 'Margem']); ls.forEach(l => { const c = O.calcLinha(l, par); linhas.push([l.descricao, consultor(l), O.n(l.dados.horas), O.n(l.dados.valor_hora), O.n(l.dados.custo_hora), r2(c.valor), r2(c.margem)]); }); }
        else if (sec.k === 'formacao') { linhas.push(['Ação', 'Consultor', 'Horas sessão', 'Horas preparação', 'Valor/hora base', 'Custo/hora', 'Valor/hora efetivo', 'A faturar', 'Margem']); ls.forEach(l => { const c = O.calcLinha(l, par), d = l.dados; linhas.push([l.descricao, consultor(l), O.n(d.horas_sessao), O.n(d.horas_prep), O.n(d.valor_hora), O.n(d.custo_hora), r2(c.vhEfetivo), r2(c.valor), r2(c.margem)]); }); }
        else if (sec.k === 'deslocacao') { linhas.push(['Motivo', 'Saídas', 'Km', 'Portagens', 'Refeições', 'Estadias', 'Outros', 'Horas desloc.', 'Consultor', 'Valor/hora', 'Despesas', 'Custo horas', 'Margem horas']); ls.forEach(l => { const c = O.calcLinha(l, par), d = l.dados; linhas.push([l.descricao, O.n(d.saidas), O.n(d.km), O.n(d.portagens), O.n(d.refeicoes), O.n(d.estadias), O.n(d.outros), O.n(d.horas), consultor(l), O.n(d.valor_hora), r2(c.despesas), r2(c.valorHoras), r2(c.margemHoras)]); }); }
        else if (sec.k === 'consumivel') { linhas.push(['Descrição', 'Valor']); ls.forEach(l => linhas.push([l.descricao, O.n(l.dados.valor)])); }
        else { linhas.push(['Produto', 'Quantidade', 'Preço custo', 'Preço venda', 'Desconto %', 'Venda final unit.', 'Subtotal venda', 'Margem €', 'Margem %']); ls.forEach(l => { const c = O.calcLinha(l, par), d = l.dados; linhas.push([l.descricao, O.n(d.quantidade), O.n(d.preco_custo), O.n(d.preco_venda), O.n(d.desconto), r2(c.pvFinal), r2(c.valor), r2(c.margem), r2(c.margemPct * 100)]); }); }
        linhas.push([]);
      });
      const a = calc.areas.find(x => x.area === area) || {};
      linhas.push(['Custos específicos do departamento', O.n(area.custos_especificos)], ['PREÇO FINAL DA ÁREA', r2(a.precoFinal || 0)], ['Margem (€)', r2(a.margem || 0)], ['Margem (%)', r2((a.margemPct || 0) * 100)]);
      folha(area.nome || 'Área', linhas, [34, 18, 12, 12, 12, 14, 14, 12, 14, 12, 12, 12, 12]);
    });
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  },
  // A proposta do cliente como ficheiro (para anexar ao email) em vez de descarregar.
  async blobDaProposta(dados) {
    const r = await fetch(this.TEMPLATE, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Não consegui abrir o modelo da proposta.');
    return this.gerar(dados, await r.arrayBuffer());
  },
  async descarregar(dados, nomeFicheiro) {
    const r = await fetch(this.TEMPLATE, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Não consegui abrir o modelo da proposta.');
    const blob = await this.gerar(dados, await r.arrayBuffer());
    App.descarregarBlob(blob, nomeFicheiro);
  }
};
if (typeof module !== 'undefined') module.exports = OrcExport;

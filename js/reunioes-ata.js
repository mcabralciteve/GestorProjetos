// Ata de reunião em Word (.docx), montada de raiz a partir dos dados da reunião — sem modelo. Um .docx é um ZIP de ficheiros XML;
// aqui escreve-se o XML mínimo (documento, estilos, rodapé com o número da página) e comprime-se com JSZip.
// As funções de XML são puras (testadas em tests/reunioes-ata.test.js); só gerar() precisa do construtor JSZip.
const ReunioesAta = {
  L() { return typeof ReunioesLogica !== 'undefined' ? ReunioesLogica : require('./reunioes-logica.js'); },
  LARGURA: 9638, // A4 com margens de 2 cm, em twips

  // Texto seguro para XML: escapa e tira caracteres de controlo que tornam o ficheiro inválido.
  esc(t) {
    return String(t == null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  // Um parágrafo. o: { negrito, italico, tam (meios-pontos), cor, estilo, alinhar, depois (twips), antes }
  par(texto, o) {
    o = o || {};
    const ppr = [
      o.estilo ? `<w:pStyle w:val="${o.estilo}"/>` : '',
      (o.antes != null || o.depois != null) ? `<w:spacing${o.antes != null ? ` w:before="${o.antes}"` : ''}${o.depois != null ? ` w:after="${o.depois}"` : ''}/>` : '',
      o.alinhar ? `<w:jc w:val="${o.alinhar}"/>` : ''
    ].join('');
    const rpr = [o.negrito ? '<w:b/>' : '', o.italico ? '<w:i/>' : '', o.cor ? `<w:color w:val="${o.cor}"/>` : '', o.tam ? `<w:sz w:val="${o.tam}"/>` : ''].join('');
    const run = texto === '' || texto == null ? '' : `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${this.esc(texto)}</w:t></w:r>`;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${run}</w:p>`;
  },
  // Texto com várias linhas → um parágrafo por linha (linhas vazias ficam como espaço).
  paragrafos(texto, o) {
    return String(texto == null ? '' : texto).replace(/\r\n/g, '\n').split('\n').map(l => this.par(l, Object.assign({ depois: 60 }, o))).join('');
  },
  // Texto formatado das notas (HTML limpo de ReunioesLogica) → parágrafos do Word com negrito, itálico, sublinhado, riscado,
  // tamanho, cor, títulos e listas. Notas antigas, em texto simples, são convertidas primeiro.
  paragrafosRicos(notas) {
    const L = this.L();
    const blocos = L.htmlParaBlocos(L.notasParaEditor(notas));
    return blocos.map(b => {
      const nivel = b.lista ? b.lista.nivel : 0;
      const ppr = `<w:pPr>${b.titulo ? '<w:keepNext/>' : ''}<w:spacing w:before="${b.titulo ? 160 : 0}" w:after="60"/>${b.lista ? `<w:ind w:left="${360 * nivel + 200}" w:hanging="300"/>` : ''}</w:pPr>`;
      const marca = b.lista ? this.run(b.lista.tipo === 'ol' ? `${b.lista.n}.` : '•', {}) + '<w:r><w:tab/></w:r>' : '';
      const runs = b.runs.map(r => r.br ? '<w:r><w:br/></w:r>' : this.run(r.t, b.titulo ? Object.assign({}, r, { b: true, tam: r.tam || 26 }) : r)).join('');
      return `<w:p>${ppr}${marca}${runs}</w:p>`;
    }).join('');
  },
  // Um trecho de texto com o seu formato: f = { b, i, u, s, tam (meios-pontos), cor (#rrggbb) }
  run(texto, f) {
    f = f || {};
    const rpr = [f.b ? '<w:b/>' : '', f.i ? '<w:i/>' : '', f.s ? '<w:strike/>' : '', f.u ? '<w:u w:val="single"/>' : '',
      f.cor ? `<w:color w:val="${String(f.cor).replace('#', '').replace(/^([0-9a-f])([0-9a-f])([0-9a-f])$/i, '$1$1$2$2$3$3').toUpperCase()}"/>` : '',
      f.tam ? `<w:sz w:val="${f.tam}"/><w:szCs w:val="${f.tam}"/>` : ''].join('');
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${this.esc(texto)}</w:t></w:r>`;
  },
  // O texto da ação e, numa segunda linha, a que se refere (tarefa do projeto ou ação comercial), quando foi indicado.
  textoAcao(p, r) {
    let ref = '';
    if (p.natureza === 'projeto') ref = p.tarefa_nome ? `Tarefa: ${p.tarefa_nome}` : `Projeto${r.projeto_nome ? ': ' + r.projeto_nome : ''}`;
    else if (p.natureza === 'comercial') ref = 'Ação comercial';
    return ref ? `${p.texto}\n${ref}` : p.texto;
  },
  titulo(texto) { return this.par(texto, { estilo: 'Heading1' }); },
  celula(texto, largura, o) {
    o = o || {};
    const linhas = String(texto == null ? '' : texto).split('\n').map(l => this.par(l, { negrito: o.negrito, cor: o.cor, tam: o.tam, depois: 40 })).join('');
    return `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${o.fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fundo}"/>` : ''}</w:tcPr>${linhas || this.par('')}</w:tc>`;
  },
  // linhas: [[texto, texto, ...]] — a primeira é o cabeçalho se cabecalho=true. larguras: twips (somam LARGURA).
  tabela(linhas, larguras, cabecalho) {
    const trs = linhas.map((cols, i) => {
      const cab = cabecalho && i === 0;
      return `<w:tr>${cab ? '<w:trPr><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${cols.map((c, j) => this.celula(c, larguras[j], cab ? { negrito: true, fundo: 'DCE8F2' } : {})).join('')}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${this.LARGURA}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${larguras.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${trs}</w:tbl>${this.par('', { depois: 80 })}`;
  },

  // Corpo do documento. meta: { versao, emitidaEm (ISO), emitidaPor, rascunho }
  corpo(r, meta) {
    const L = this.L();
    meta = meta || {};
    const partes = [];
    partes.push(this.par('CITEVE', { negrito: true, cor: '1F4E79', tam: 20, depois: 0 }));
    partes.push(this.par('Ata de reunião', { estilo: 'Title' }));
    partes.push(this.par(meta.rascunho ? 'RASCUNHO — ata ainda não emitida' : `Versão ${meta.versao || 1}${meta.emitidaEm ? ` · emitida em ${L.formatarDataHora(meta.emitidaEm)}` : ''}`,
      { italico: true, cor: meta.rascunho ? 'B42318' : '5B6B78', depois: 200 }));

    const quando = [L.formatarDataHora(r.data_hora), L.duracaoTexto(r.duracao_min) ? `(duração: ${L.duracaoTexto(r.duracao_min)})` : ''].filter(Boolean).join(' ');
    const info = [['Reunião', r.titulo], ['Data e hora', quando], ['Local / ligação', r.local], ['Cliente', r.cliente], ['Projeto', r.projeto_nome], ['Oportunidade', r.oportunidade_titulo]]
      .filter(l => String(l[1] || '').trim());
    partes.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${this.LARGURA}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="${this.LARGURA - 2200}"/></w:tblGrid>${
      info.map(l => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${this.celula(l[0], 2200, { negrito: true, fundo: 'EEF3F8' })}${this.celula(l[1], this.LARGURA - 2200)}</w:tr>`).join('')}</w:tbl>${this.par('', { depois: 80 })}`);

    const parts = r.participantes || [];
    if (parts.length) {
      partes.push(this.titulo('Participantes'));
      partes.push(this.tabela(
        [['Nome', 'Organização / cargo', 'Presença']].concat(parts.map(p => [p.nome, [p.organizacao, p.cargo].filter(Boolean).join(' · '), p.presente === false ? 'Ausente' : 'Presente'])),
        [3600, 4238, 1800], true));
    }
    if (String(r.ordem_trabalhos || '').trim()) { partes.push(this.titulo('Ordem de trabalhos')); partes.push(this.paragrafos(r.ordem_trabalhos)); }
    if (L.notasParaEditor(r.notas)) { partes.push(this.titulo('Assuntos tratados')); partes.push(this.paragrafosRicos(r.notas)); }

    const decisoes = (r.pontos || []).filter(p => p.tipo === 'decisao');
    if (decisoes.length) { partes.push(this.titulo('Decisões')); decisoes.forEach((p, i) => partes.push(this.par(`${i + 1}. ${p.texto}`, { depois: 80 }))); }
    const acoes = (r.pontos || []).filter(p => p.tipo === 'acao');
    if (acoes.length) {
      partes.push(this.titulo('Ações'));
      partes.push(this.tabela(
        [['Ação', 'Responsável', 'Prazo', 'Estado']].concat(acoes.map(p => [this.textoAcao(p, r), p.responsavel || '—', p.prazo ? L.formatarDia(p.prazo) : '—', p.concluida ? 'Concluída' : 'Por fazer'])),
        [4338, 2200, 1500, 1600], true));
    }
    const ficheiros = r.ficheiros || [];
    if (ficheiros.length) {
      partes.push(this.titulo('Documentos'));
      ficheiros.forEach(f => partes.push(this.par([f.nome, f.ligacao].filter(Boolean).join(' — '), { depois: 60 })));
    }
    partes.push(this.par(`Ata elaborada${meta.emitidaPor ? ` por ${meta.emitidaPor}` : ''}${meta.emitidaEm ? ` em ${L.formatarData(meta.emitidaEm)}` : ''} no Gestor de Projetos.`, { italico: true, cor: '5B6B78', tam: 18, antes: 240 }));
    return partes.join('');
  },

  documentoXml(r, meta) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${this.corpo(r, meta)}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  },
  estilosXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="pt-PT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="40"/></w:pPr><w:rPr><w:b/><w:color w:val="12222F"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="2A6A9A"/></w:pBdr><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B8C7D3"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8C7D3"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8C7D3"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8C7D3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8C7D3"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8C7D3"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  },
  rodapeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="5B6B78"/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">Página </w:t></w:r><w:r><w:rPr><w:color w:val="5B6B78"/><w:sz w:val="17"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="5B6B78"/><w:sz w:val="17"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="5B6B78"/><w:sz w:val="17"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="5B6B78"/><w:sz w:val="17"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="5B6B78"/><w:sz w:val="17"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  },
  tiposXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  },
  relsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  },
  docRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  },

  // Devolve o .docx (tipo: 'blob' no browser, 'nodebuffer' em Node). JSZipCtor = o construtor JSZip.
  async gerar(r, meta, JSZipCtor, tipo) {
    const zip = new JSZipCtor();
    const ficheiro = (nome, xml) => zip.file(nome, xml, { createFolders: false }); // sem entradas de pasta: o Word é mais exigente que o ZIP
    ficheiro('[Content_Types].xml', this.tiposXml());
    ficheiro('_rels/.rels', this.relsXml());
    ficheiro('word/document.xml', this.documentoXml(r, meta));
    ficheiro('word/styles.xml', this.estilosXml());
    ficheiro('word/footer1.xml', this.rodapeXml());
    ficheiro('word/_rels/document.xml.rels', this.docRelsXml());
    return zip.generateAsync({ type: tipo || 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
};
if (typeof module !== 'undefined') module.exports = ReunioesAta;

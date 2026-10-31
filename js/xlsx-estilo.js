// Gerador de ficheiros .xlsx COM formatação (cores, tipos de letra, bordas, células unidas, painéis fixos): a biblioteca
// SheetJS que a app traz não escreve estilos, por isso monta-se aqui o XML do Excel diretamente e comprime-se com JSZip.
// Lógica pura, sem DOM — testada em tests/xlsx-estilo.test.js.
//
// spec = {
//   nome: 'Folha', larguras: [26, 16, ...],                 // largura de cada coluna (em carateres)
//   congelar: { linhas: 5, colunas: 2 },                    // opcional: painéis fixos
//   autofiltro: { linha: 5, de: 0, ate: 6, ultimaLinha: 20 },   // opcional (linhas 1-based, colunas 0-based)
//   paisagem: true,
//   linhas: [ { altura: 20, celulas: [ { v: 'texto' | 123 | null, f: 'SUM(A1:A3)', e: estilo, colspan: 2, rowspan: 1 }, ... ] }, ... ]
//   "f" (opcional) = fórmula do Excel, sem o "=" inicial; "v" passa a ser o valor já calculado (texto ou número), para quem abre o ficheiro
//   sem recalcular — o Excel recalcula tudo ao abrir.
// }
// estilo e = { negrito, italico, tam, cor: 'RRGGBB', fundo: 'RRGGBB', alinha: 'left'|'center'|'right', quebra: true,
//              formato: '0.0' | '0%' | '#,##0.0;-#,##0.0;"–"', borda: 'fina' | 'topo' }
// Uma célula com colspan/rowspan fica unida; as células que ela cobre saltam-se (não se escrevem na linha).
const XlsxEstilo = {
  MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  _letras(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; },
  ref(linha1, col0) { return this._letras(col0) + linha1; },

  // Registo de estilos: cada combinação distinta vira uma entrada (fonte, preenchimento, borda, formato) e um índice.
  _novoRegisto() {
    const fontes = [], fundos = [], bordas = [], formatos = [], xfs = [];
    const idx = (lista, chave) => { let i = lista.indexOf(chave); if (i < 0) { lista.push(chave); i = lista.length - 1; } return i; };
    const FORMATOS_BASE = { 'General': 0, '0': 1, '0.00': 2, '0%': 9 };
    idx(fontes, JSON.stringify({ tam: 10 }));                 // fonte 0 = por omissão
    fundos.push('none', 'gray125');                            // reservados pelo Excel
    idx(bordas, 'nenhuma');
    xfs.push({ f: 0, p: 0, b: 0, n: 0, a: '' });               // estilo 0 = por omissão
    return {
      fontes, fundos, bordas, formatos, xfs,
      estilo: (e) => {
        if (!e) return 0;
        const f = idx(fontes, JSON.stringify({ b: !!e.negrito, i: !!e.italico, tam: e.tam || 10, cor: e.cor || '' }));
        const p = e.fundo ? idx(fundos, e.fundo) : 0;
        const b = idx(bordas, e.borda || 'nenhuma');
        let n = 0;
        if (e.formato) n = e.formato in FORMATOS_BASE ? FORMATOS_BASE[e.formato] : 164 + idx(formatos, e.formato);
        const a = JSON.stringify({ h: e.alinha || '', q: !!e.quebra });
        const chave = JSON.stringify({ f, p, b, n, a });
        let i = xfs.findIndex(x => JSON.stringify({ f: x.f, p: x.p, b: x.b, n: x.n, a: x.a }) === chave);
        if (i < 0) { xfs.push({ f, p, b, n, a }); i = xfs.length - 1; }
        return i;
      }
    };
  },

  _estilosXml(reg) {
    const cor = (rgb) => `<color rgb="FF${rgb}"/>`;
    const fontes = reg.fontes.map(s => { const o = JSON.parse(s);
      return `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}<sz val="${o.tam}"/>${o.cor ? cor(o.cor) : '<color theme="1"/>'}<name val="Arial"/><family val="2"/></font>`; }).join('');
    const fundos = reg.fundos.map(f => f === 'none' || f === 'gray125'
      ? `<fill><patternFill patternType="${f}"/></fill>`
      : `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
    const lado = (nome, estilo, rgb) => `<${nome} style="${estilo}">${cor(rgb)}</${nome}>`;
    const bordas = reg.bordas.map(b => {
      if (b === 'nenhuma') return '<border><left/><right/><top/><bottom/><diagonal/></border>';
      const fina = 'D5DBE3';
      const topo = b === 'topo' ? lado('top', 'medium', '1F3A5F') : lado('top', 'thin', fina);
      return `<border>${lado('left', 'thin', fina)}${lado('right', 'thin', fina)}${topo}${lado('bottom', 'thin', fina)}<diagonal/></border>`;
    }).join('');
    const nums = reg.formatos.length
      ? `<numFmts count="${reg.formatos.length}">${reg.formatos.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${this._esc(f)}"/>`).join('')}</numFmts>` : '';
    const xfs = reg.xfs.map(x => {
      const a = JSON.parse(x.a || '{"h":"","q":false}');
      const alinha = `<alignment${a.h ? ` horizontal="${a.h}"` : ''} vertical="center"${a.q ? ' wrapText="1"' : ''}/>`;
      return `<xf numFmtId="${x.n}" fontId="${x.f}" fillId="${x.p}" borderId="${x.b}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${alinha}</xf>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + nums
      + `<fonts count="${reg.fontes.length}">${fontes}</fonts>`
      + `<fills count="${reg.fundos.length}">${fundos}</fills>`
      + `<borders count="${reg.bordas.length}">${bordas}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${reg.xfs.length}">${xfs}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  },

  _folhaXml(spec, reg) {
    const ocupado = new Set();          // "linha,coluna" cobertos por uma união vinda de cima/da esquerda
    const unioes = [];
    let maxCol = (spec.larguras || []).length - 1;
    const linhasXml = spec.linhas.map((linha, i) => {
      const r = i + 1;
      let c = 0;
      const celulas = [];
      (linha.celulas || []).forEach(cel => {
        while (ocupado.has(r + ',' + c)) c++;
        const s = reg.estilo(cel.e);
        const cs = cel.colspan || 1, rs = cel.rowspan || 1;
        const ref = this.ref(r, c);
        const v = cel.v;
        let conteudo = '';
        if (cel.f) {
          const fx = `<f>${this._esc(cel.f)}</f>`;
          if (typeof v === 'number' && isFinite(v)) conteudo = `<c r="${ref}" s="${s}">${fx}<v>${v}</v></c>`;
          else if (typeof v === 'string' && v !== '') conteudo = `<c r="${ref}" s="${s}" t="str">${fx}<v>${this._esc(v)}</v></c>`;
          else conteudo = `<c r="${ref}" s="${s}">${fx}</c>`;
        } else if (typeof v === 'number' && isFinite(v)) conteudo = `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        else if (v !== null && v !== undefined && v !== '') conteudo = `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${this._esc(v)}</t></is></c>`;
        else conteudo = `<c r="${ref}" s="${s}"/>`;
        celulas.push(conteudo);
        // As células cobertas por uma união também levam o estilo (para a cor/borda ocupar a união inteira).
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0) continue;
          ocupado.add((r + dr) + ',' + (c + dc));
          if (dr === 0) celulas.push(`<c r="${this.ref(r, c + dc)}" s="${s}"/>`);
        }
        if (cs > 1 || rs > 1) unioes.push(`${ref}:${this.ref(r + rs - 1, c + cs - 1)}`);
        c += cs;
        maxCol = Math.max(maxCol, c - 1);
      });
      const alt = linha.altura ? ` ht="${linha.altura}" customHeight="1"` : '';
      return `<row r="${r}"${alt}>${celulas.join('')}</row>`;
    });
    const larguras = (spec.larguras || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const cg = spec.congelar;
    const painel = cg ? `<pane${cg.colunas ? ` xSplit="${cg.colunas}"` : ''}${cg.linhas ? ` ySplit="${cg.linhas}"` : ''} topLeftCell="${this.ref(cg.linhas + 1, cg.colunas)}" activePane="${cg.linhas && cg.colunas ? 'bottomRight' : (cg.linhas ? 'bottomLeft' : 'topRight')}" state="frozen"/>` : '';
    const af = spec.autofiltro
      ? `<autoFilter ref="${this.ref(spec.autofiltro.linha, spec.autofiltro.de)}:${this.ref(spec.autofiltro.ultimaLinha, spec.autofiltro.ate)}"/>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
      + `<dimension ref="A1:${this.ref(spec.linhas.length, Math.max(maxCol, 0))}"/>`
      + `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${painel}</sheetView></sheetViews>`
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + (larguras ? `<cols>${larguras}</cols>` : '')
      + `<sheetData>${linhasXml.join('')}</sheetData>`
      + af
      + (unioes.length ? `<mergeCells count="${unioes.length}">${unioes.map(u => `<mergeCell ref="${u}"/>`).join('')}</mergeCells>` : '')
      + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
      + `<pageSetup paperSize="9" orientation="${spec.paisagem ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
      + '</worksheet>';
  },

  // Devolve o ficheiro .xlsx (tipo: 'blob' no browser, 'nodebuffer' em Node). "JSZipCtor" = o construtor JSZip.
  async gerar(spec, JSZipCtor, tipo) {
    const reg = this._novoRegisto();
    const folha = this._folhaXml(spec, reg);       // antes dos estilos: é aqui que se registam
    const nome = this._esc(String(spec.nome || 'Folha').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    const zip = new JSZipCtor();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>');
    const nomesDefinidos = spec.autofiltro
      ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nome}'!$${this._letras(spec.autofiltro.de)}$${spec.autofiltro.linha}:$${this._letras(spec.autofiltro.ate)}$${spec.autofiltro.ultimaLinha}</definedName></definedNames>` : '';
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${nome}" sheetId="1" r:id="rId1"/></sheets>${nomesDefinidos}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>');
    zip.file('xl/worksheets/sheet1.xml', folha);
    zip.file('xl/styles.xml', this._estilosXml(reg));
    return zip.generateAsync({ type: tipo || 'blob', compression: 'DEFLATE', mimeType: this.MIME });
  }
};
if (typeof module !== 'undefined') module.exports = XlsxEstilo;

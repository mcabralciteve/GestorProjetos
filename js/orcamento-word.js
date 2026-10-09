// Proposta em Word (modelo DG015 do CITEVE): preenche o modelo que a pessoa escolhe — capa (campos de formulário
// TrabReal, NomeEmpresa, Ano, NObra, DepUn, NRev, DDia, DMes, DAno), o título/empresa em cache no cabeçalho, e o valor dos
// honorários (com o detalhe por rubricas). O texto das restantes secções (objetivo, metodologia, equipa…) é redação
// humana e fica como está. O modelo NUNCA é guardado no servidor da app: escolhe-se do disco (e pode ficar guardado só neste
// browser). Pura nas funções de XML; testada em tests/orcamento-word.test.js.
const OrcWord = {
  CAMPOS: ['TrabReal', 'NomeEmpresa', 'Ano', 'NObra', 'DepUn', 'NRev', 'DDia', 'DMes', 'DAno'],
  MESES: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  CHAVE_LOCAL: 'gp_modelo_dg015',

  esc(t) { return String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  // 12600 -> "12.600,00" (formato dos honorários na proposta)
  eur(v) {
    const [i, d] = (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).split('.');
    return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
  },

  // Valores sugeridos para a capa a partir da proposta/orçamento (a pessoa corrige-os antes de gerar).
  // ctx: { titulo, cliente, referencia (ex. "2026/829-01"), areas ["DCS"], versaoProposta, hojeISO, total, rubricas: [{rotulo, valor}], validadeDias }
  valoresPadrao(ctx) {
    const m = String(ctx.referencia || '').match(/^(\d{4})\s*\/\s*0*(\d+)/);
    const [a, mm, d] = String(ctx.hojeISO || '').split('-');
    return {
      TrabReal: ctx.titulo || '', NomeEmpresa: ctx.cliente || '', Ano: m ? m[1] : (a || ''), NObra: m ? m[2] : '',
      DepUn: (ctx.areas || []).join('/'), NRev: String(Math.max(0, (Number(ctx.versaoProposta) || 1) - 1)),
      DDia: d ? String(Number(d)) : '', DMes: mm ? this.MESES[Number(mm) - 1] : '', DAno: a || '',
      honorarios: this.eur(ctx.total), validadeDias: ctx.validadeDias || 30, rubricas: (ctx.rubricas || []).filter(r => Number(r.valor) > 0)
    };
  },

  // Troca o resultado de um campo de formulário (FORMTEXT) pelo valor, mantendo o formato do texto que lá estava.
  preencherCampo(xml, nome, valor) {
    const marca = `<w:ffData><w:name w:val="${nome}"/>`;
    const i = xml.indexOf(marca);
    if (i < 0) return { xml, achou: false };
    const sep = xml.indexOf('w:fldCharType="separate"/></w:r>', i);
    const fim = sep < 0 ? -1 : xml.indexOf('w:fldCharType="end"/>', sep);
    if (sep < 0 || fim < 0) return { xml, achou: false };
    const inicioResultado = sep + 'w:fldCharType="separate"/></w:r>'.length;
    const inicioFim = Math.max(xml.lastIndexOf('<w:r ', fim), xml.lastIndexOf('<w:r>', fim));
    const antigo = xml.slice(inicioResultado, inicioFim);
    const rPr = (antigo.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    const novo = `<w:r>${rPr}<w:t xml:space="preserve">${this.esc(valor)}</w:t></w:r>`;
    return { xml: xml.slice(0, inicioResultado) + novo + xml.slice(inicioFim), achou: true };
  },

  // "O valor a cobrar pelo CITEVE é de #.###,## €…": põe o valor e, a seguir, o detalhe por rubricas e a validade.
  preencherHonorarios(xml, v) {
    const ph = '#.###,##';
    const i = xml.indexOf(ph);
    if (i < 0) return { xml, achou: false };
    let r = xml.slice(0, i) + this.esc(v.honorarios) + xml.slice(i + ph.length);
    const ini = r.lastIndexOf('<w:p ', i);
    const fim = r.indexOf('</w:p>', i) + '</w:p>'.length;
    const par = r.slice(ini, fim);
    const pPr = (par.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0], rPr = (par.match(/<w:r[ >][\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)/) || [])[1] || '';
    const linha = (t) => `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${this.esc(t)}</w:t></w:r></w:p>`;
    const extra = [];
    if (v.rubricas && v.rubricas.length) { extra.push('Investimento por área de serviço:'); v.rubricas.forEach(x => extra.push(`• ${x.rotulo}: ${this.eur(x.valor)} €`)); }
    return { xml: r.slice(0, fim) + extra.map(linha).join('') + r.slice(fim), achou: true };
  },

  // O modelo já diz "Esta proposta é válida por 30 dias": acerta o número com a validade do orçamento.
  preencherValidade(xml, dias) {
    const n = Math.round(Number(dias));
    return n > 0 && n !== 30 ? xml.replace('válida por 30 dias', `válida por ${n} dias`) : xml;
  },

  // O cabeçalho repete o título e a empresa (STYLEREF) com o texto em cache; o Word atualiza-o ao imprimir, mas assim já abre certo.
  preencherCabecalho(xml, v) {
    return xml.replace('Nome do trabalho a realizar', this.esc(v.TrabReal || 'Nome do trabalho a realizar')).replace('Nome da Empresa', this.esc(v.NomeEmpresa || 'Nome da Empresa'));
  },

  async gerar(buffer, v) {
    const zip = await JSZip.loadAsync(buffer);
    const doc = zip.file('word/document.xml');
    if (!doc) throw new Error('Este ficheiro não parece um documento Word (.docx).');
    let xml = await doc.async('string');
    const avisos = [];
    this.CAMPOS.forEach(c => { const r = this.preencherCampo(xml, c, v[c]); xml = r.xml; if (!r.achou) avisos.push(`Campo "${c}" não encontrado no modelo.`); });
    const h = this.preencherHonorarios(xml, v); xml = this.preencherValidade(h.xml, v.validadeDias);
    if (!h.achou) avisos.push('Não encontrei a frase dos honorários ("#.###,## €") — o valor não foi escrito.');
    zip.file('word/document.xml', xml);
    const cab = zip.file('word/header1.xml');
    if (cab) zip.file('word/header1.xml', this.preencherCabecalho(await cab.async('string'), v));
    if (avisos.length >= 6) throw new Error('Este modelo não é o DG015 (não tem os campos da capa). Escolhe o ficheiro DG015_Rev07_Proposta.docx.');
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
    return { blob, avisos };
  },

  // Modelo guardado só neste browser (opcional) — o conteúdo do modelo nunca vai para o servidor da app.
  modeloGuardado() { try { const s = localStorage.getItem(this.CHAVE_LOCAL); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  guardarModelo(nome, buffer) {
    try {
      let bin = ''; const u8 = new Uint8Array(buffer);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      localStorage.setItem(this.CHAVE_LOCAL, JSON.stringify({ nome, dados: btoa(bin) })); return true;
    } catch (e) { return false; }
  },
  esquecerModelo() { try { localStorage.removeItem(this.CHAVE_LOCAL); } catch (e) { /* ignora */ } },
  bufferDoModelo(m) { const bin = atob(m.dados), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; }
};
if (typeof module !== 'undefined') module.exports = OrcWord;

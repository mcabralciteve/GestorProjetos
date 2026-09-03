// Geração do Excel oficial "Mapa de Despesas" (DFRH-008/12) para pedidos de reserva de viatura.
//
// Princípio (definido no schema fornecido pelo colega que criou o modelo original — ver
// assets/reserva-viatura/): NUNCA reconstruir o ficheiro. O template oficial (com logótipo,
// molduras, validações e controlos ActiveX) é preservado byte a byte; só se troca o CONTEÚDO de
// 11 células, mantendo o estilo (atributo "s") que já lá está. Um .xlsx é um ZIP de ficheiros XML
// — por isso basta descompactar, trocar um único nó <c> dentro de "xl/worksheets/sheet1.xml", e
// recompactar sem tocar em mais nada (JSZip mantém os restantes ficheiros, incluindo as imagens,
// exatamente como foram lidos).
//
// O template original fornecido é um .xls (formato antigo, binário) — foi convertido uma única
// vez para .xlsx via automação do Excel (mesma técnica do "Método A" do schema, só que para
// mudar de formato, não para preencher valores) e fica guardado já em .xlsx dentro do repositório
// (assets/reserva-viatura/Reserva_Viatura_TEMPLATE.xlsx), com as 11 células-alvo em branco. É esse
// ficheiro que este módulo edita em runtime, no browser, sem precisar do Excel instalado.
const ReservaViatura = {
  TEMPLATE_URL: 'assets/reserva-viatura/Reserva_Viatura_TEMPLATE.xlsx',
  FOLHA_XML: 'xl/worksheets/sheet1.xml',

  // Mapeamento campo -> célula, igual ao schema fornecido (reserva_viatura.schema.json).
  CAMPOS: {
    area: { celula: 'H12', tipo: 'texto' },
    requisitante: { celula: 'P12', tipo: 'texto' },
    chefia: { celula: 'P15', tipo: 'texto' },
    gestor: { celula: 'G17', tipo: 'texto' },
    projeto: { celula: 'F15', tipo: 'texto' },
    justificacao: { celula: 'D24', tipo: 'texto' },
    data_pedido: { celula: 'I19', tipo: 'data' },
    data_inicio: { celula: 'Q28', tipo: 'data' },
    hora_inicio: { celula: 'T28', tipo: 'hora' },
    data_fim: { celula: 'Q30', tipo: 'data' },
    hora_fim: { celula: 'T30', tipo: 'hora' }
  },

  // Número de série de data do Excel (sistema 1900): nº de dias desde 1899-12-30. Escreve-se o
  // NÚMERO puro (não uma data nativa) para não haver deslocações de fuso horário.
  serialExcel(isoData) {
    const [y, m, d] = isoData.split('-').map(Number);
    const utcAlvo = Date.UTC(y, m - 1, d);
    const utcEpoca = Date.UTC(1899, 11, 30);
    return Math.round((utcAlvo - utcEpoca) / 86400000);
  },
  // Hora como fração de um dia (0..1).
  fracaoDia(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h * 3600 + m * 60) / 86400;
  },
  escaparXmlTexto(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // Troca o conteúdo da célula "endereco" no XML da folha, preservando o "s=" (estilo) que já lá
  // estiver — seja a célula vazia (<c r="H12" s="170"/>) ou já tiver conteúdo. "montar(sAttr)"
  // recebe o atributo de estilo pronto a colar (ex.: ' s="170"', ou '' se a célula não tiver
  // estilo definido) e devolve o novo elemento <c>...</c> completo.
  substituirCelula(xml, endereco, montar) {
    const re = new RegExp(`<c r="${endereco}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
    const m = xml.match(re);
    if (!m) throw new Error(`Célula ${endereco} não encontrada no template do Mapa de Despesas.`);
    const sMatch = m[1].match(/\ss="(\d+)"/);
    const sAttr = sMatch ? ` s="${sMatch[1]}"` : '';
    const novaCelula = montar(sAttr);
    return xml.slice(0, m.index) + novaCelula + xml.slice(m.index + m[0].length);
  },

  // dados: objeto com os 11 campos de CAMPOS (strings — datas em "aaaa-mm-dd", horas em "HH:MM").
  // Devolve { blob, nomeFicheiro }, pronto a descarregar.
  async gerarBlob(dados) {
    const resp = await fetch(this.TEMPLATE_URL);
    if (!resp.ok) throw new Error('Não foi possível carregar o modelo Excel (' + resp.status + ').');
    const buffer = await resp.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const ficheiroFolha = zip.file(this.FOLHA_XML);
    if (!ficheiroFolha) throw new Error('Modelo Excel inesperado: não tem ' + this.FOLHA_XML + '.');
    let xml = await ficheiroFolha.async('string');

    Object.entries(this.CAMPOS).forEach(([id, def]) => {
      const valor = dados[id];
      xml = this.substituirCelula(xml, def.celula, (sAttr) => {
        if (def.tipo === 'texto') {
          const texto = this.escaparXmlTexto(valor || '');
          return `<c r="${def.celula}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
        }
        const numero = def.tipo === 'data' ? this.serialExcel(valor) : this.fracaoDia(valor);
        return `<c r="${def.celula}"${sAttr}><v>${numero}</v></c>`;
      });
    });

    zip.file(this.FOLHA_XML, xml);
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Sem isto o JSZip guarda tudo sem compressão (ZIP "STORE") por omissão — o conteúdo fica
      // igual, mas o ficheiro sai bem maior do que precisa de ser.
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    return { blob, nomeFicheiro: this.nomeFicheiro(dados.data_inicio) };
  },

  // DFRH008_rev12_Mapa_despesas_{DDMMAAAA}.xlsx — {DDMMAAAA} vem de data_inicio. Extensão .xlsx
  // (não .xls): o ficheiro gerado é mesmo OOXML/.xlsx (edição cirúrgica, sem Excel instalado no
  // computador de quem usa a app) — dar-lhe extensão .xls, como no documento original em papel,
  // faria o Excel avisar de um "formato diferente da extensão" ao abrir.
  nomeFicheiro(dataInicioIso) {
    const [y, m, d] = dataInicioIso.split('-');
    return `DFRH008_rev12_Mapa_despesas_${d}${m}${y}.xlsx`;
  }
};

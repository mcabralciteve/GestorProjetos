// Importação de orçamentos feitos na "Folha de Orçamentação — DTD" (Excel): lê os separadores por departamento (DCS, ROB,
// DAT, DPC, Outros), os Parâmetros (valor/hora por perfil, aluguer por saída, €/km) e o Cálculo Valor-Hora (só para obter o
// custo/hora de cada perfil — os salários lidos nunca se guardam, fica apenas o custo/hora resultante). Puro: recebe as
// folhas já lidas como matrizes (SheetJS: sheet_to_json com header:1) e devolve um orçamento para rever; nada vai para a
// base de dados daqui. Testado em tests/orcamento-importar.test.js.
const OrcImportar = {
  SEPARADORES: ['DCS', 'ROB', 'DAT', 'DPC', 'Outros'],

  _n(v) { const x = typeof v === 'number' ? v : Number(String(v === null || v === undefined ? '' : v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; },
  _t(v) { return v === null || v === undefined ? '' : String(v).trim(); },
  _norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); },
  // Célula (linha/coluna 1-based, como no Excel) de uma matriz.
  _c(aoa, r, c) { const l = aoa[r - 1]; return l ? l[c - 1] : undefined; },
  _col(letra) { return letra.toUpperCase().charCodeAt(0) - 64; },

  // Procura um separador pelo nome (sem maiúsculas/acentos).
  _folha(folhas, nome) {
    const alvo = this._norm(nome);
    const k = Object.keys(folhas).find(x => this._norm(x) === alvo);
    return k ? folhas[k] : null;
  },

  // ---------- Parâmetros ----------
  lerParametros(aoa) {
    const r = { perfis: [], aluguer_saida: null, custo_km: null, overhead: null };
    if (!aoa) return r;
    for (let i = 1; i <= aoa.length; i++) {
      const a = this._t(this._c(aoa, i, 1)), b = this._c(aoa, i, 2);
      const n = this._norm(a);
      if (/^aluguer de viatura/.test(n)) r.aluguer_saida = this._n(b);
      else if (/^custo por km/.test(n)) r.custo_km = this._n(b);
      else if (/^custos gerais/.test(n)) r.overhead = this._n(b);
    }
    // Perfis: tabela logo abaixo de "Perfil | Valor/Hora" até à linha em branco.
    const cab = aoa.findIndex(l => l && this._norm(l[0]) === 'perfil' && /valor/.test(this._norm(l[1])));
    if (cab >= 0) {
      for (let i = cab + 1; i < aoa.length; i++) {
        const nome = this._t(aoa[i] && aoa[i][0]);
        if (!nome) break;
        r.perfis.push({ nome, valor_hora: this._n(aoa[i][1]) });
      }
    }
    return r;
  },

  // ---------- Custo/hora de cada perfil (mesmas contas do "Cálculo Valor-Hora": custo direto por hora faturável + overhead) ----------
  lerCustos(aoa, overhead) {
    const custos = [];
    if (!aoa) return custos;
    const p = {};   // parâmetros gerais: B5.. (linhas 5 a 13)
    for (let i = 1; i <= 16; i++) { const n = this._norm(this._c(aoa, i, 1)); const v = this._c(aoa, i, 2); if (n) p[n] = v; }
    const get = (inicio) => { const k = Object.keys(p).find(x => x.startsWith(inicio)); return k ? p[k] : undefined; };
    const meses = this._n(get('n de meses')) || 14, diasUteis = this._n(get('dias uteis')) || 220, horasDia = this._n(get('horas de trabalho')) || 8;
    const subsDia = this._n(get('valor diario subsidio')), tsu = this._n(get('tsu')), seguro = this._n(get('seguro de acidentes')), fct = this._n(get('fundo de compensacao'));
    const absent = this._n(get('taxa de absentismo'));
    let oh = this._n(get('custos indiretos'));        // pode vir de uma fórmula sem valor guardado: usa o dos Parâmetros
    if (!oh && overhead) oh = this._n(overhead);
    // linhas de perfis: a partir do cabeçalho "Perfil | Salário Bruto…"
    const cab = aoa.findIndex(l => l && this._norm(l[0]) === 'perfil' && /salario/.test(this._norm(l[1])));
    if (cab < 0) return custos;
    for (let i = cab + 1; i < aoa.length; i++) {
      const l = aoa[i] || [];
      const salario = this._n(l[1]);
      if (!salario && !this._t(l[0])) break;
      const retribuicao = salario * meses;
      const anual = retribuicao + retribuicao * tsu + retribuicao * seguro + retribuicao * fct + diasUteis * subsDia + this._n(l[7]) + this._n(l[8]);
      const horasFaturaveis = diasUteis * horasDia * (1 - absent) * (this._n(l[12]) || 0);
      custos.push({ ordem: i - cab - 1, custo_hora: horasFaturaveis ? (anual / horasFaturaveis) * (1 + oh) : 0 });
    }
    return custos;
  },

  // ---------- Um separador de departamento ----------
  // Procura as secções pelos títulos ("1. Horas…", "2. Horas de Formação", …) em vez de posições fixas.
  lerArea(aoa) {
    const titulo = (re) => aoa.findIndex(l => l && re.test(this._norm(l[0])));
    const ini = { 1: titulo(/^1 horas de consultoria/), 2: titulo(/^2 horas de formacao/), 3: titulo(/^3 deslocacoes/), 4: titulo(/^4 consumiveis/), 5: titulo(/^5 produtos/) };
    if (Object.values(ini).some(i => i < 0)) return null;
    const dados = (n) => {                                  // linhas de dados: depois do cabeçalho da tabela, antes de "TOTAL SECÇÃO"
      const a = ini[n]; let i = a + 1;
      while (i < aoa.length && !/^(tarefa|acao|motivo|descricao|produto)/.test(this._norm(aoa[i] && aoa[i][0]))) i++;
      const linhas = [];
      for (i += 1; i < aoa.length && !/^total seccao/.test(this._norm(aoa[i] && aoa[i][0])); i++) linhas.push(aoa[i] || []);
      return linhas;
    };
    const t = (l, c) => this._t(l[c]), n = (l, c) => this._n(l[c]);
    const vazia = (l, cols) => !t(l, 0) && cols.every(c => !this._t(l[c]));
    const linhas = [];
    dados(1).forEach(l => { if (vazia(l, [1, 2])) return; linhas.push({ seccao: 'consultoria', descricao: t(l, 0), perfil: t(l, 1), dados: { horas: n(l, 2) } }); });
    dados(2).forEach(l => { if (vazia(l, [1, 2, 3])) return; linhas.push({ seccao: 'formacao', descricao: t(l, 0), perfil: t(l, 1), dados: { horas_sessao: n(l, 2), horas_prep: n(l, 3) } }); });
    dados(3).forEach(l => { if (vazia(l, [1, 2, 3, 4, 5, 6, 7, 8])) return; linhas.push({ seccao: 'deslocacao', descricao: t(l, 0), perfil: t(l, 8), dados: { saidas: n(l, 1), km: n(l, 2), portagens: n(l, 3), refeicoes: n(l, 4), estadias: n(l, 5), outros: n(l, 6), horas: n(l, 7) } }); });
    dados(4).forEach(l => { if (vazia(l, [1])) return; linhas.push({ seccao: 'consumivel', descricao: t(l, 0), perfil: '', dados: { valor: n(l, 1) } }); });
    dados(5).forEach(l => {
      if (vazia(l, [1, 2, 3])) return;
      const desc = n(l, 5);                                  // a folha guarda o desconto como fração (10% = 0,1)
      linhas.push({ seccao: 'produto', descricao: t(l, 0), perfil: '', dados: { quantidade: n(l, 1), preco_custo: n(l, 2), preco_venda: n(l, 3), desconto: desc > 0 && desc <= 1 ? Math.round(desc * 10000) / 100 : desc } });
    });
    const iCE = aoa.findIndex(l => l && /^custos especificos do departamento/.test(this._norm(l[0])));
    const iPF = aoa.findIndex(l => l && /^preco final ao cliente/.test(this._norm(l[0])));
    return {
      linhas, custos_especificos: iCE >= 0 ? this._n(aoa[iCE][4]) : 0,
      totalFicheiro: iPF >= 0 && aoa[iPF] && aoa[iPF][4] !== undefined && aoa[iPF][4] !== '' ? this._n(aoa[iPF][4]) : null    // valor guardado pelo Excel (pode faltar)
    };
  },

  // Cliente / Projeto / Data / Responsável: pelas etiquetas ("Cliente:", "Projeto / Proposta:", "Data:", "Responsável:") — não por posição fixa.
  lerCabecalho(aoa) {
    const r = { cliente: '', projeto: '', data: '', responsavel: '' };
    for (let i = 0; i < Math.min(aoa.length, 12); i++) {
      const l = aoa[i] || [];
      l.forEach((cel, j) => {
        const n = this._norm(cel), valor = (c) => this._t(l[c]);
        if (n === 'cliente' && !r.cliente) r.cliente = valor(j + 1);
        else if (/^projeto/.test(n) && !r.projeto) r.projeto = valor(j + 1);
        else if (n === 'data' && !r.data) r.data = valor(j + 1);
        else if (n === 'responsavel' && !r.responsavel) r.responsavel = valor(j + 1);
      });
    }
    return r;
  },

  // ---------- O ficheiro todo ----------
  // folhas: { nomeDoSeparador: matriz }. Devolve { meta, parametros, perfis, areas, avisos } ou lança Error se não for a folha DTD.
  interpretar(folhas) {
    const avisos = [];
    const params = this.lerParametros(this._folha(folhas, 'Parâmetros'));
    const custos = this.lerCustos(this._folha(folhas, 'Cálculo Valor-Hora'), params.overhead);
    const perfis = params.perfis.map((p, i) => ({ nome: p.nome, valor_hora: p.valor_hora, custo_hora: this._arred((custos[i] || {}).custo_hora || 0) }));
    if (perfis.length && !custos.length) avisos.push('Não encontrei o "Cálculo Valor-Hora": o custo/hora dos perfis fica a 0 (a margem não é fiável até escolheres os consultores).');
    const areas = [];
    let meta = null;
    this.SEPARADORES.forEach(nome => {
      const aoa = this._folha(folhas, nome);
      if (!aoa) return;
      const a = this.lerArea(aoa);
      if (!a) { avisos.push(`O separador "${nome}" não tem a estrutura da folha DTD — ignorado.`); return; }
      if (!a.linhas.length && !a.custos_especificos) return;                       // separador por preencher
      if (!meta) meta = this.lerCabecalho(aoa);
      areas.push({ nome, ...a });
    });
    if (!areas.length) throw new Error('Não encontrei nenhum orçamento preenchido neste ficheiro (separadores DCS, ROB, DAT, DPC ou Outros com linhas).');
    // Perfis em falta na tabela de parâmetros
    const conhecidos = new Set(perfis.map(p => this._norm(p.nome)));
    areas.forEach(a => a.linhas.forEach(l => {
      if (l.perfil && !conhecidos.has(this._norm(l.perfil))) { avisos.push(`${a.nome}: perfil "${l.perfil}" não existe nos Parâmetros — fica sem valor/hora.`); conhecidos.add(this._norm(l.perfil)); }
    }));
    return { meta, parametros: { aluguer_saida: params.aluguer_saida, custo_km: params.custo_km }, perfis, areas, avisos };
  },
  _arred(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; },

  // Orçamento (formato do editor) a partir do que se interpretou. mapaPerfis: { nomeDoPerfil: recurso|null } — um consultor escolhido
  // pelo utilizador substitui o valor/hora do ficheiro pelo das Pessoas.
  construir(interp, opcoes) {
    opcoes = opcoes || {};
    const mapa = opcoes.mapaPerfis || {}, equipas = opcoes.equipas || [], gerarId = opcoes.gerarId || (() => crypto.randomUUID());
    const perfilPorNome = new Map(interp.perfis.map(p => [this._norm(p.nome), p]));
    const areas = interp.areas.map((a, i) => {
      const equipa = equipas.find(e => this._norm(e.nome) === this._norm(a.nome));
      return {
        id: gerarId(), equipa_id: equipa ? equipa.id : null, nome: equipa ? equipa.nome : a.nome, ordem: i, custos_especificos: a.custos_especificos,
        linhas: a.linhas.map((l, j) => {
          const dados = { ...l.dados };
          let recurso_id = null;
          if (['consultoria', 'formacao', 'deslocacao'].includes(l.seccao)) {
            const perfil = perfilPorNome.get(this._norm(l.perfil));
            const rec = mapa[l.perfil] || null;
            if (rec) { recurso_id = rec.id; dados.valor_hora = Number(rec.precoVenda) || 0; dados.custo_hora = Number(rec.precoCusto) || 0; }
            else { dados.valor_hora = perfil ? perfil.valor_hora : 0; dados.custo_hora = perfil ? perfil.custo_hora : 0; }
            if (l.perfil) dados.perfil = l.perfil;
          }
          return { id: gerarId(), seccao: l.seccao, ordem: j, descricao: l.descricao, recurso_id, dados };
        })
      };
    });
    return {
      id: gerarId(), proposta_id: opcoes.propostaId, versao: opcoes.versao || 1, titulo: opcoes.titulo || '', estado: 'rascunho',
      validade_dias: opcoes.validadeDias || 30,
      aluguer_saida: interp.parametros.aluguer_saida !== null && interp.parametros.aluguer_saida !== 0 ? interp.parametros.aluguer_saida : (opcoes.aluguerPadrao ?? 45),
      custo_km: interp.parametros.custo_km !== null && interp.parametros.custo_km !== 0 ? interp.parametros.custo_km : (opcoes.custoKmPadrao ?? 0.16),
      notas: `Importado da folha de Excel${opcoes.nomeFicheiro ? ' "' + opcoes.nomeFicheiro + '"' : ''}.`, criado_por: opcoes.criadoPor || null, areas, _novo: true
    };
  }
};
if (typeof module !== 'undefined') module.exports = OrcImportar;

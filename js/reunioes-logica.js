// Módulo "Reuniões": regras puras, sem DOM nem rede — testadas em tests/reunioes-logica.test.js.
//
// Uma reunião (linha da tabela "reunioes", snake_case como vem da base de dados):
//   { id, titulo, data_hora (ISO), duracao_min, local, estado, projeto_id, conta_id, oportunidade_id, cliente, projeto_nome,
//     oportunidade_titulo, ordem_trabalhos, notas, participantes[], ficheiros[], pontos[], ata_versao, versao, ... }
//   participante: { id, tipo: 'recurso'|'contacto'|'externo', ref_id, nome, organizacao, cargo, email, presente }
//   ficheiro:     { id, nome, ligacao }
//   ponto:        { id, tipo: 'decisao'|'acao', texto, responsavel, responsavel_recurso_id, prazo, concluida,
//                   natureza ('' geral | 'projeto' | 'comercial'), tarefa_id + tarefa_nome (só com natureza 'projeto') }
//   Uma ação cujo responsável é um colega da app (responsavel_recurso_id) entra nas tarefas dessa pessoa (Início, sino) e no resumo diário.
const ReunioesLogica = {
  ESTADOS: { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' },
  TIPOS_PONTO: { decisao: 'Decisão', acao: 'Ação' },
  TIPOS_PARTICIPANTE: { recurso: 'Colega', contacto: 'Cliente', externo: 'Externo' },
  // A que se refere uma ação: ao projeto da reunião (opcionalmente a uma das suas tarefas) ou ao trabalho comercial (conta/oportunidade).
  NATUREZAS: { '': 'Geral', projeto: 'Tarefa do projeto', comercial: 'Comercial' },

  novoId() { return globalThis.crypto.randomUUID(); },

  // Sem acentos e em minúsculas — para procurar e para comparar nomes.
  norm(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); },

  // Linha da base de dados → reunião com as listas sempre presentes.
  normalizar(l) {
    const lista = v => Array.isArray(v) ? v : [];
    return Object.assign({}, l, {
      participantes: lista(l.participantes), ficheiros: lista(l.ficheiros), pontos: lista(l.pontos).map(p => this.normalizarPonto(p)),
      ata_versao: Number(l.ata_versao) || 0, versao: Number(l.versao) || 1
    });
  },

  // Reunião nova, por omissão para daqui a pouco (hora redonda seguinte), 1 hora.
  nova({ agoraISO, projeto, titulo } = {}) {
    const d = new Date(agoraISO || Date.now());
    d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    return {
      id: null, titulo: titulo || '', data_hora: d.toISOString(), duracao_min: 60, local: '', estado: 'agendada',
      projeto_id: projeto ? projeto.id : null, conta_id: null, oportunidade_id: null,
      cliente: projeto ? (projeto.cliente || '') : '', projeto_nome: projeto ? this.nomeProjeto(projeto) : '', oportunidade_titulo: '',
      ordem_trabalhos: '', notas: '', participantes: [], ficheiros: [], pontos: [], ata_versao: 0, versao: 1
    };
  },
  // "2026/123 — Nome do projeto" (nunca só o código — ver a regra de identificação dos projetos)
  nomeProjeto(p) { return [p.idInterno, p.nome].filter(Boolean).join(' — ') || p.nome || ''; },

  // Lista de problemas a corrigir antes de gravar (vazia = pode gravar).
  validar(r) {
    const erros = [];
    if (!String(r.titulo || '').trim()) erros.push('Indica o título da reunião.');
    if (!r.data_hora || isNaN(new Date(r.data_hora))) erros.push('Indica a data e a hora.');
    if (r.duracao_min != null && r.duracao_min !== '' && !(Number(r.duracao_min) > 0)) erros.push('A duração tem de ser um número de minutos maior que zero.');
    (r.ficheiros || []).forEach(f => {
      if (String(f.ligacao || '').trim() && !/^(https?:\/\/|\\\\|[a-z]:\\)/i.test(String(f.ligacao).trim())) erros.push(`A ligação do ficheiro "${f.nome || f.ligacao}" deve começar por https:// ou ser um caminho de rede.`);
    });
    (r.pontos || []).forEach(p => { if (!String(p.texto || '').trim()) erros.push('Há uma decisão ou ação sem texto — preenche-a ou remove-a.'); });
    return [...new Set(erros)];
  },

  // ---------- Quem vê / edita ----------
  // ctx: { userId, recursoId, admin, crmVer, veProjeto(id), editaProjeto(id), souResponsavelOp(id), souResponsavelConta(id) }
  // Vê: o Administrador, quem criou, quem é participante (colega), quem é responsável por uma das ações (colega), quem vê o
  // projeto ligado, quem tem acesso ao CRM numa reunião ligada a uma oportunidade ou a uma conta. Edita: Administrador, quem criou, quem edita o projeto ligado, o responsável
  // da oportunidade ou da conta.
  podeVer(r, ctx) {
    if (ctx.admin) return true;
    if (ctx.userId && r.criado_por_user === ctx.userId) return true;
    if (ctx.recursoId && (r.participantes || []).some(p => p.tipo === 'recurso' && p.ref_id === ctx.recursoId)) return true;
    if (ctx.recursoId && (r.pontos || []).some(p => p.tipo === 'acao' && p.responsavel_recurso_id === ctx.recursoId)) return true;
    if (r.projeto_id && ctx.veProjeto && ctx.veProjeto(r.projeto_id)) return true;
    if ((r.oportunidade_id || r.conta_id) && ctx.crmVer) return true;
    return false;
  },
  podeEditar(r, ctx) {
    if (ctx.admin) return true;
    if (ctx.userId && r.criado_por_user === ctx.userId) return true;
    if (r.projeto_id && ctx.editaProjeto && ctx.editaProjeto(r.projeto_id)) return true;
    if (r.oportunidade_id && ctx.souResponsavelOp && ctx.souResponsavelOp(r.oportunidade_id)) return true;
    if (r.conta_id && ctx.souResponsavelConta && ctx.souResponsavelConta(r.conta_id)) return true;
    return false;
  },
  // Reuniões que pertencem a uma conta (ficha do cliente): ligadas à conta, a uma das suas oportunidades ou a um dos seus projetos.
  daConta(lista, { contaId, opIds, projetoIds }) {
    const ops = new Set(opIds || []), projs = new Set(projetoIds || []);
    return (lista || []).filter(r => r.conta_id === contaId || (r.oportunidade_id && ops.has(r.oportunidade_id)) || (r.projeto_id && projs.has(r.projeto_id)));
  },
  daOportunidade(lista, opId) { return (lista || []).filter(r => r.oportunidade_id === opId); },

  // ---------- Lista: filtros e ordem ----------
  // f: { texto, estado ('' = todos), projeto (id ou ''), periodo ('' | 'proximas' | 'passadas') }
  filtrar(lista, f, agoraMs) {
    const agora = agoraMs == null ? Date.now() : agoraMs;
    const q = this.norm(f && f.texto);
    const sai = (lista || []).filter(r => {
      if (f && f.estado && r.estado !== f.estado) return false;
      if (f && f.projeto && r.projeto_id !== f.projeto) return false;
      const t = new Date(r.data_hora).getTime();
      if (f && f.periodo === 'proximas' && !(t >= agora)) return false;
      if (f && f.periodo === 'passadas' && !(t < agora)) return false;
      if (q) {
        const palheiro = this.norm([r.titulo, r.cliente, r.projeto_nome, r.oportunidade_titulo, r.local, ...(r.participantes || []).map(p => p.nome)].join(' '));
        if (!palheiro.includes(q)) return false;
      }
      return true;
    });
    const asc = f && f.periodo === 'proximas';
    return sai.sort((a, b) => (asc ? 1 : -1) * (new Date(a.data_hora) - new Date(b.data_hora)));
  },

  // ---------- Participantes ----------
  chaveParticipante(p) { return p.ref_id ? `${p.tipo}:${p.ref_id}` : `x:${this.norm(p.nome)}`; },
  // Acrescenta sem repetir (mesma pessoa pelo id, ou pelo nome se não tiver id). Devolve true se acrescentou.
  adicionarParticipante(lista, p) {
    const novo = { id: p.id || this.novoId(), tipo: p.tipo || 'externo', ref_id: p.ref_id || null, nome: String(p.nome || '').trim(), organizacao: p.organizacao || '', cargo: p.cargo || '', email: p.email || '', presente: p.presente !== false };
    if (!novo.nome) return false;
    // Duplicado: a mesma pessoa pelo id; ou o mesmo nome quando um dos dois foi escrito à mão (sem id) — quase de certeza o mesmo.
    const k = this.chaveParticipante(novo), nome = this.norm(novo.nome);
    if (lista.some(x => this.chaveParticipante(x) === k || ((!novo.ref_id || !x.ref_id) && this.norm(x.nome) === nome))) return false;
    lista.push(novo);
    return true;
  },

  // ---------- Pontos (decisões e ações) ----------
  novoPonto(tipo, natureza) {
    const acao = tipo !== 'decisao';
    return this.normalizarPonto({ id: this.novoId(), tipo: acao ? 'acao' : 'decisao', texto: '', responsavel: '', responsavel_recurso_id: null, prazo: null, concluida: false, natureza: acao ? natureza : '' });
  },
  // Ponto com os campos de ligação sempre presentes e coerentes (os pontos antigos não tinham "natureza"; a tarefa só vale em ações do projeto).
  normalizarPonto(p) {
    const acao = p.tipo === 'acao';
    const natureza = acao && Object.prototype.hasOwnProperty.call(this.NATUREZAS, p.natureza) ? p.natureza : '';
    const tarefa = natureza === 'projeto' && p.tarefa_id ? String(p.tarefa_id) : null;
    return Object.assign({}, p, { natureza, tarefa_id: tarefa, tarefa_nome: tarefa ? String(p.tarefa_nome || '') : '' });
  },
  // Natureza sugerida para uma ação nova, pelo que a reunião já tem ligado: projeto → do projeto; só conta/oportunidade → comercial.
  naturezaPorOmissao(r) { return r.projeto_id ? 'projeto' : ((r.conta_id || r.oportunidade_id) ? 'comercial' : ''); },
  // Liga o responsável de cada ação (o nome escrito) ao colega da app — é isso que a põe nas tarefas dessa pessoa e nos seus lembretes.
  // Mantém a ligação que já existe enquanto o nome for o desse colega; senão procura o nome entre os colegas ativos. Altera e devolve "pontos".
  resolverResponsaveis(pontos, recursos) {
    (pontos || []).forEach(p => {
      if (p.tipo !== 'acao') return;
      const nome = this.norm(p.responsavel);
      if (!nome) { p.responsavel_recurso_id = null; return; }
      const atual = p.responsavel_recurso_id && (recursos || []).find(x => x.id === p.responsavel_recurso_id);
      if (atual && this.norm(atual.nome) === nome) return;
      const colega = (recursos || []).find(x => x.ativo !== false && this.norm(x.nome) === nome);
      p.responsavel_recurso_id = colega ? colega.id : null;
    });
    return pontos;
  },
  resumoPontos(r) {
    const pontos = r.pontos || [];
    return { decisoes: pontos.filter(p => p.tipo === 'decisao').length, acoes: pontos.filter(p => p.tipo === 'acao').length, acoesPorFechar: pontos.filter(p => p.tipo === 'acao' && !p.concluida).length };
  },

  // ---------- Ações como tarefas a executar ----------
  // Ações por fazer, em todas as reuniões que não foram canceladas, que cumprem filtro(ponto, reunião) — as atrasadas primeiro (a mais antiga
  // no topo), depois por prazo (sem prazo no fim). hojeISO = 'AAAA-MM-DD'. Não olha a quem pode ler a reunião: isso é do chamador.
  acoesAbertas(lista, hojeISO, filtro) {
    const sai = [];
    (lista || []).forEach(r => {
      if (r.estado === 'cancelada') return;
      (r.pontos || []).forEach(p => {
        if (p.tipo !== 'acao' || p.concluida || !filtro(p, r)) return;
        sai.push({
          reuniaoId: r.id, pontoId: p.id, texto: p.texto || '', prazo: p.prazo || null, atrasada: !!p.prazo && p.prazo < hojeISO,
          natureza: p.natureza || '', tarefaId: p.tarefa_id || null, tarefaNome: p.tarefa_nome || '',
          responsavel: p.responsavel || '', responsavelId: p.responsavel_recurso_id || null,
          reuniaoTitulo: r.titulo || '', reuniaoData: r.data_hora, projetoId: r.projeto_id || null, projetoNome: r.projeto_nome || '',
          cliente: r.cliente || '', oportunidadeTitulo: r.oportunidade_titulo || ''
        });
      });
    });
    return sai.sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || (a.prazo || '9999').localeCompare(b.prazo || '9999') || new Date(b.reuniaoData) - new Date(a.reuniaoData));
  },
  // As ações por fazer de um colega (entram na sua lista de tarefas, no sino e no resumo diário).
  acoesDe(lista, recursoId, hojeISO) {
    return recursoId ? this.acoesAbertas(lista, hojeISO, p => p.responsavel_recurso_id === recursoId) : [];
  },
  contarAtrasadas(lista, recursoId, hojeISO) { return this.acoesDe(lista, recursoId, hojeISO).filter(a => a.atrasada).length; },
  // As ações comerciais por fazer (de qualquer responsável, colega ou não) — para o separador Follow-ups do CRM.
  acoesComerciais(lista, hojeISO, recursoId) {
    return this.acoesAbertas(lista, hojeISO, p => p.natureza === 'comercial' && (!recursoId || p.responsavel_recurso_id === recursoId));
  },
  // "Projeto › tarefa", "Comercial · cliente · oportunidade" ou o cliente — de onde vem a ação. nomeTarefa: nome atual da tarefa, se a app o souber.
  origemAcao(a, nomeTarefa) {
    if (a.natureza === 'projeto') return [a.projetoNome, nomeTarefa || a.tarefaNome].filter(Boolean).join(' › ') || 'Projeto';
    if (a.natureza === 'comercial') return ['Comercial', a.cliente, a.oportunidadeTitulo].filter(Boolean).join(' · ');
    return a.cliente || '';
  },

  // ---------- Datas ----------
  // ISO (UTC) ↔ valor de <input type="datetime-local"> (hora local de quem está a usar a app)
  paraInputLocal(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  deInputLocal(txt) {
    const d = new Date(txt);
    return isNaN(d) ? null : d.toISOString();
  },
  formatarData(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  },
  formatarDataHora(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${this.formatarData(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  // "2026-11-05" (só dia, sem fuso) → "05/11/2026"
  formatarDia(dia) {
    const m = String(dia || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  },
  duracaoTexto(min) {
    const m = Number(min) || 0;
    if (!m) return '';
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
  },

  // ---------- Texto formatado (notas) ----------
  // As notas guardam um HTML MUITO limitado: negrito, itálico, sublinhado, riscado, tamanho e cor do texto, título, listas e parágrafos.
  // Tudo o resto (scripts, estilos, atributos, ligações, imagens…) é descartado por limparHtml — é ele que protege quem lê as notas
  // de outras pessoas, por isso o resultado é SEMPRE reconstruído só a partir de etiquetas permitidas, nunca copiado do original.
  ETIQUETAS: { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's', del: 's', br: 'br', p: 'p', div: 'div', ul: 'ul', ol: 'ol', li: 'li', h1: 'h3', h2: 'h3', h3: 'h3', h4: 'h3', font: 'font' },
  IGNORAR_CONTEUDO: ['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'textarea', 'select'],
  TAMANHOS_PT: { 1: 15, 2: 18, 3: 21, 4: 24, 5: 30, 6: 36, 7: 48 }, // tamanho 1-7 do HTML → meios-pontos do Word (3 = normal)

  _entidades(t) {
    const nomes = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(t).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : '';
      }
      return Object.prototype.hasOwnProperty.call(nomes, e.toLowerCase()) ? nomes[e.toLowerCase()] : m;
    });
  },
  _escHtml(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); },
  // Parte o HTML em fichas: { t: 'abre'|'fecha'|'texto', nome, attrs, texto }. Comentários e declarações são ignorados.
  _fichas(html) {
    const fichas = [];
    const re = /<!--[\s\S]*?-->|<!\w[^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;
    const texto = String(html == null ? '' : html);
    let m;
    while ((m = re.exec(texto))) {
      if (m[2]) fichas.push({ t: m[1] ? 'fecha' : 'abre', nome: m[2].toLowerCase(), attrs: m[3] || '' });
      else if (m[4] !== undefined) fichas.push({ t: 'texto', texto: this._entidades(m[4]) });
      else if (m[0] === '<') fichas.push({ t: 'texto', texto: '<' }); // um "<" solto é só texto (ex.: 1 < 2)
    }
    return fichas;
  },
  // Só o que interessa de <font>: tamanho 1-7 e cor #rgb/#rrggbb.
  _attrsFont(attrs) {
    const o = {};
    attrs.replace(/\b(size|color)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, k, a, b, c) => {
      const v = String(a !== undefined ? a : (b !== undefined ? b : c)).trim();
      if (k.toLowerCase() === 'size' && /^[1-7]$/.test(v)) o.size = v;
      if (k.toLowerCase() === 'color' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) o.color = v.toLowerCase();
      return m;
    });
    return o;
  },
  // <b style="font-weight:normal"> (o que o Google Docs põe à volta de tudo o que se copia) não é negrito.
  _naoNegrito(attrs) { return /font-weight\s*:\s*(normal|400|lighter)/i.test(attrs); },

  limparHtml(html) {
    const sai = [], pilha = []; // pilha: { orig, saida } — saida é a etiqueta emitida (ou null se a original foi descartada)
    let ignorar = null, nivelIgnorar = 0;
    for (const f of this._fichas(html)) {
      if (ignorar) {
        if (f.nome === ignorar) { if (f.t === 'abre') nivelIgnorar++; else if (--nivelIgnorar === 0) ignorar = null; }
        continue;
      }
      if (f.t === 'texto') { sai.push(this._escHtml(f.texto)); continue; }
      if (f.t === 'abre' && this.IGNORAR_CONTEUDO.includes(f.nome)) { ignorar = f.nome; nivelIgnorar = 1; continue; }
      const nome = this.ETIQUETAS[f.nome];
      if (f.t === 'abre') {
        if (nome === 'br') { sai.push('<br>'); continue; }
        let aberta = null;
        if (nome === 'font') {
          const a = this._attrsFont(f.attrs);
          if (a.size || a.color) { aberta = 'font'; sai.push(`<font${a.size ? ` size="${a.size}"` : ''}${a.color ? ` color="${a.color}"` : ''}>`); }
        } else if (nome && !(nome === 'b' && this._naoNegrito(f.attrs))) { aberta = nome; sai.push(`<${nome}>`); }
        if (/\/\s*$/.test(f.attrs)) { if (aberta) sai.push(`</${aberta}>`); } // <x/>
        else pilha.push({ orig: f.nome, saida: aberta });
      } else { // fecha
        if (nome === 'br') continue;
        let i = pilha.length - 1;
        while (i >= 0 && pilha[i].orig !== f.nome) i--;
        if (i < 0) continue; // fecho sem abertura: ignora
        while (pilha.length > i) { const e = pilha.pop(); if (e.saida) sai.push(`</${e.saida}>`); }
      }
    }
    while (pilha.length) { const e = pilha.pop(); if (e.saida) sai.push(`</${e.saida}>`); }
    const r = sai.join('');
    if (/^(?:<\/?(?:br|p|div)>|\s|&nbsp;)*$/i.test(r)) return '';
    // Texto sem nenhuma etiqueta ficaria igual a uma nota antiga em texto simples (ver ehHtml) e seria escapado duas vezes: embrulha-se.
    return r.includes('<') ? r : `<div>${r}</div>`;
  },
  ehHtml(t) { return /<\/?(?:p|div|br|b|i|u|s|ul|ol|li|h3|font|strong|em)\b[^>]*>/i.test(String(t == null ? '' : t)); },
  // Texto simples (notas escritas antes de haver formatação) → HTML, uma linha por <div>.
  textoParaHtml(t) {
    const s = String(t == null ? '' : t).replace(/\r\n/g, '\n');
    return s.trim() === '' ? '' : s.split('\n').map(l => `<div>${l === '' ? '<br>' : this._escHtml(l)}</div>`).join('');
  },
  // O que o editor mostra para o valor guardado (HTML limpo, ou texto antigo convertido).
  notasParaEditor(t) { return this.ehHtml(t) ? this.limparHtml(t) : this.textoParaHtml(t); },
  // HTML limpo → blocos para a ata: [{ lista: {tipo:'ul'|'ol', n, nivel}|null, titulo: bool, runs: [{t, b, i, u, s, tam, cor} | {br:true}] }]
  htmlParaBlocos(html) {
    const blocos = [], listas = [], fmt = { b: 0, i: 0, u: 0, s: 0, fontes: [] };
    let atual = null, liAberto = null;
    const abrirBloco = (extra) => { atual = Object.assign({ lista: null, titulo: false, runs: [] }, extra || {}); };
    const fechar = () => {
      if (!atual) return;
      const tinhaBr = atual.runs.some(r => r.br);
      while (atual.runs.length && atual.runs[atual.runs.length - 1].br) atual.runs.pop();
      // um <div> só com uma lista dentro (ou vazio, sem <br>) não é uma linha em branco; só <div><br></div> é
      if (!atual.runs.length && !tinhaBr && !atual.lista) { atual = null; return; }
      blocos.push(atual); atual = null;
    };
    const garantirBloco = () => { if (!atual) abrirBloco(liAberto ? { lista: liAberto } : {}); };
    for (const f of this._fichas(this.limparHtml(html))) {
      if (f.t === 'texto') {
        if (f.texto === '') continue;
        garantirBloco();
        const fo = fmt.fontes[fmt.fontes.length - 1] || {};
        atual.runs.push({ t: f.texto, b: fmt.b > 0, i: fmt.i > 0, u: fmt.u > 0, s: fmt.s > 0, tam: fo.size ? this.TAMANHOS_PT[fo.size] : null, cor: fo.color || null });
        continue;
      }
      const nome = f.nome, abre = f.t === 'abre';
      if (nome === 'br') { garantirBloco(); atual.runs.push({ br: true }); continue; }
      if (['b', 'i', 'u', 's'].includes(nome)) { fmt[nome] += abre ? 1 : -1; continue; }
      if (nome === 'font') { if (abre) fmt.fontes.push(Object.assign({}, fmt.fontes[fmt.fontes.length - 1] || {}, this._attrsFont(f.attrs))); else fmt.fontes.pop(); continue; }
      if (nome === 'ul' || nome === 'ol') { fechar(); if (abre) listas.push({ tipo: nome, n: 0 }); else listas.pop(); continue; }
      if (nome === 'li') {
        fechar();
        if (abre) { const l = listas[listas.length - 1] || { tipo: 'ul', n: 0 }; l.n++; liAberto = { tipo: l.tipo, n: l.n, nivel: Math.max(1, listas.length) }; abrirBloco({ lista: liAberto }); }
        else liAberto = null;
        continue;
      }
      if (nome === 'h3') { fechar(); if (abre) abrirBloco({ titulo: true }); continue; }
      if (nome === 'p' || nome === 'div') { fechar(); if (abre && !liAberto) abrirBloco(); continue; }
    }
    fechar();
    // um bloco só com quebras de linha é uma linha em branco
    return blocos.map(b => (b.runs.length && b.runs.every(r => r.br)) ? Object.assign(b, { runs: [] }) : b);
  },

  // Nome de ficheiro seguro (sem acentos nem espaços) para a ata.
  nomeFicheiroAta(r, versao) {
    const slug = this.norm(r.titulo).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'reuniao';
    const d = new Date(r.data_hora);
    const dia = isNaN(d) ? '' : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`;
    return `Ata_${dia}${slug}_v${versao || 1}.docx`;
  }
};
if (typeof module !== 'undefined') module.exports = ReunioesLogica;

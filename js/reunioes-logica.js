// Módulo "Reuniões": regras puras, sem DOM nem rede — testadas em tests/reunioes-logica.test.js.
//
// Uma reunião (linha da tabela "reunioes", snake_case como vem da base de dados):
//   { id, titulo, data_hora (ISO), duracao_min, local, estado, projeto_id, conta_id, oportunidade_id, cliente, projeto_nome,
//     oportunidade_titulo, ordem_trabalhos, notas, participantes[], ficheiros[], pontos[], ata_versao, versao, ... }
//   participante: { id, tipo: 'recurso'|'contacto'|'externo', ref_id, nome, organizacao, cargo, email, presente }
//   ficheiro:     { id, nome, ligacao }
//   ponto:        { id, tipo: 'decisao'|'acao', texto, responsavel, responsavel_recurso_id, prazo, concluida }
const ReunioesLogica = {
  ESTADOS: { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' },
  TIPOS_PONTO: { decisao: 'Decisão', acao: 'Ação' },
  TIPOS_PARTICIPANTE: { recurso: 'Colega', contacto: 'Cliente', externo: 'Externo' },

  novoId() { return globalThis.crypto.randomUUID(); },

  // Sem acentos e em minúsculas — para procurar e para comparar nomes.
  norm(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); },

  // Linha da base de dados → reunião com as listas sempre presentes.
  normalizar(l) {
    const lista = v => Array.isArray(v) ? v : [];
    return Object.assign({}, l, {
      participantes: lista(l.participantes), ficheiros: lista(l.ficheiros), pontos: lista(l.pontos),
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
  // ctx: { userId, recursoId, admin, crmVer, veProjeto(id), editaProjeto(id), souResponsavelOp(id) }
  // Vê: o Administrador, quem criou, quem é participante (colega), quem vê o projeto ligado, quem tem acesso ao CRM numa
  // reunião ligada a uma oportunidade. Edita: Administrador, quem criou, quem edita o projeto ligado, o responsável da oportunidade.
  podeVer(r, ctx) {
    if (ctx.admin) return true;
    if (ctx.userId && r.criado_por_user === ctx.userId) return true;
    if (ctx.recursoId && (r.participantes || []).some(p => p.tipo === 'recurso' && p.ref_id === ctx.recursoId)) return true;
    if (r.projeto_id && ctx.veProjeto && ctx.veProjeto(r.projeto_id)) return true;
    if (r.oportunidade_id && ctx.crmVer) return true;
    return false;
  },
  podeEditar(r, ctx) {
    if (ctx.admin) return true;
    if (ctx.userId && r.criado_por_user === ctx.userId) return true;
    if (r.projeto_id && ctx.editaProjeto && ctx.editaProjeto(r.projeto_id)) return true;
    if (r.oportunidade_id && ctx.souResponsavelOp && ctx.souResponsavelOp(r.oportunidade_id)) return true;
    return false;
  },

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
  novoPonto(tipo) { return { id: this.novoId(), tipo: tipo === 'decisao' ? 'decisao' : 'acao', texto: '', responsavel: '', responsavel_recurso_id: null, prazo: null, concluida: false }; },
  resumoPontos(r) {
    const pontos = r.pontos || [];
    return { decisoes: pontos.filter(p => p.tipo === 'decisao').length, acoes: pontos.filter(p => p.tipo === 'acao').length, acoesPorFechar: pontos.filter(p => p.tipo === 'acao' && !p.concluida).length };
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

  // Nome de ficheiro seguro (sem acentos nem espaços) para a ata.
  nomeFicheiroAta(r, versao) {
    const slug = this.norm(r.titulo).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'reuniao';
    const d = new Date(r.data_hora);
    const dia = isNaN(d) ? '' : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`;
    return `Ata_${dia}${slug}_v${versao || 1}.docx`;
  }
};
if (typeof module !== 'undefined') module.exports = ReunioesLogica;

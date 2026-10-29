// Comentários nas tarefas dos projetos: regras puras, sem DOM nem rede — testadas em tests/comentarios-logica.test.js.
//
// Um comentário: { id, projetoId, tarefaId, autorUserId, autorNome, texto, criadoEm, editadoEm }.
// Quem vê o projeto lê e escreve; o autor edita e apaga o seu; o Administrador e os Gestores do projeto apagam qualquer um
// (mas só o autor altera o texto: ninguém fala por outra pessoa).
const ComentariosLogica = {
  MAX_TEXTO: 2000,

  // Linha da tabela tarefa_comentarios → objeto da app.
  deLinha(l) {
    return {
      id: l.id, projetoId: l.projeto_id, tarefaId: l.tarefa_id, autorUserId: l.autor_user_id || null,
      autorNome: l.autor_nome || '', texto: l.texto || '', criadoEm: l.criado_em, editadoEm: l.editado_em || null
    };
  },

  // Texto aceite (sem espaços nas pontas, no máximo MAX_TEXTO caracteres), ou null se estiver vazio.
  limparTexto(texto) {
    const t = String(texto == null ? '' : texto).replace(/\r\n/g, '\n').trim();
    return t ? t.slice(0, this.MAX_TEXTO) : null;
  },

  // { [tarefaId]: [comentários do mais antigo para o mais recente] }
  agruparPorTarefa(lista) {
    const porTarefa = {};
    (lista || []).forEach(c => { (porTarefa[c.tarefaId] = porTarefa[c.tarefaId] || []).push(c); });
    Object.values(porTarefa).forEach(l => l.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm))));
    return porTarefa;
  },

  podeEditar(c, userId) {
    return !!userId && c.autorUserId === userId;
  },
  podeApagar(c, { userId, admin, gestor }) {
    return this.podeEditar(c, userId) || !!admin || !!gestor;
  },

  // Quantos comentários a pessoa ainda não viu: os de outros, posteriores ao instante em que abriu a tarefa pela última vez
  // (ultimaVista = ISO, ou null se nunca abriu — nesse caso contam todos os de outros).
  porLer(lista, userId, ultimaVista) {
    return (lista || []).filter(c => c.autorUserId !== userId && (!ultimaVista || String(c.criadoEm) > String(ultimaVista))).length;
  },

  // "há 5 min", "ontem às 14:30", "12/03/2026 09:10" — agora/criadoEm em ISO.
  quando(iso, agora) {
    const d = new Date(iso), n = new Date(agora || Date.now());
    if (isNaN(d)) return '';
    const p2 = x => String(x).padStart(2, '0');
    const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const mins = Math.round((n - d) / 60000);
    if (mins < 1) return 'agora mesmo';
    if (mins < 60) return `há ${mins} min`;
    const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (mesmoDia(d, n)) return `hoje às ${hora}`;
    const ontem = new Date(n); ontem.setDate(ontem.getDate() - 1);
    if (mesmoDia(d, ontem)) return `ontem às ${hora}`;
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${hora}`;
  }
};
if (typeof module !== 'undefined') module.exports = ComentariosLogica;

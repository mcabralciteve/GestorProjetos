// Registo de horas em atividades comerciais: associação opcional a um cliente e a uma oportunidade em curso do CRM.
// Regras puras (sem DOM nem rede), testadas em tests/registo-comercial.test.js. O ecrã está em App.montarAssociacaoComercial.
//
// Princípios:
//  - a associação é OPCIONAL (sem escolha, o registo fica como sempre foi);
//  - se o cliente ou a oportunidade não existirem no CRM, escrevem-se à mão (texto livre);
//  - o NOME do cliente e o TÍTULO da oportunidade ficam sempre guardados no registo, em texto, para o histórico
//    continuar legível mesmo que a oportunidade seja apagada ou renomeada no CRM.
const RegistoComercial = {
  OUTRO: '__outro__',      // cliente que não existe na lista
  OUTRA: '__outra__',      // oportunidade que não existe na lista

  contasOrdenadas(contas) {
    return (contas || []).slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt'));
  },
  // Oportunidades ainda em curso (etapa de categoria "aberta") de uma conta, por título.
  oportunidadesAbertas(contaId, oportunidades, etapaPorId) {
    return (oportunidades || [])
      .filter(o => o.conta_id === contaId && (((etapaPorId && etapaPorId.get(o.etapa_id)) || {}).categoria || 'aberta') === 'aberta')
      .sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt'));
  },

  // Estado do seletor a partir de um registo já existente (ou {} para um novo).
  estadoInicial(reg, contas, oportunidades) {
    const r = reg || {};
    const op = r.crmOportunidadeId ? (oportunidades || []).find(o => o.id === r.crmOportunidadeId) : null;
    if (op && (contas || []).some(c => c.id === op.conta_id)) return { conta: op.conta_id, op: op.id, clienteTxt: '', opTxt: '' };
    const conta = r.crmContaId ? (contas || []).find(c => c.id === r.crmContaId) : null;
    if (conta) return { conta: conta.id, op: r.oportunidadeTexto ? this.OUTRA : '', clienteTxt: '', opTxt: r.oportunidadeTexto || '' };
    if (r.cliente || r.oportunidadeTexto) return { conta: this.OUTRO, op: '', clienteTxt: r.cliente || '', opTxt: r.oportunidadeTexto || '' };
    return { conta: '', op: '', clienteTxt: '', opTxt: '' };
  },

  // O que se grava no registo, a partir do que está escolhido. Com CRM disponível:
  resolver(sel, contas, oportunidades) {
    const vazio = { crmContaId: null, crmOportunidadeId: null, cliente: '', oportunidadeTexto: '' };
    const s = sel || {};
    if (!s.conta) return vazio;
    if (s.conta === this.OUTRO) return Object.assign({}, vazio, { cliente: String(s.clienteTxt || '').trim(), oportunidadeTexto: String(s.opTxt || '').trim() });
    const conta = (contas || []).find(c => c.id === s.conta);
    if (!conta) return vazio;
    const base = Object.assign({}, vazio, { crmContaId: conta.id, cliente: conta.nome });
    if (!s.op) return base;
    if (s.op === this.OUTRA) return Object.assign(base, { oportunidadeTexto: String(s.opTxt || '').trim() });
    const op = (oportunidades || []).find(o => o.id === s.op && o.conta_id === conta.id);
    return op ? Object.assign(base, { crmOportunidadeId: op.id, oportunidadeTexto: op.titulo || '' }) : base;
  },
  // Sem acesso ao CRM (só texto livre): se o registo já tinha ligação ao CRM e o texto não mudou, mantém-na.
  resolverTexto(clienteTxt, opTxt, inicial) {
    const cliente = String(clienteTxt || '').trim(), oportunidadeTexto = String(opTxt || '').trim();
    const ini = inicial || {};
    const igual = cliente === (ini.cliente || '') && oportunidadeTexto === (ini.oportunidadeTexto || '');
    return { crmContaId: igual ? (ini.crmContaId || null) : null, crmOportunidadeId: igual ? (ini.crmOportunidadeId || null) : null, cliente, oportunidadeTexto };
  },

  // Texto curto para listas e barras: "Cliente — Oportunidade".
  rotulo(reg) {
    return [reg.cliente, reg.oportunidadeTexto].filter(Boolean).join(' — ');
  },

  // Horas comerciais já registadas numa oportunidade (ou numa conta, incluindo registos só com o cliente).
  // registos: App.state.registos (já com crmContaId/crmOportunidadeId). Devolve { horas, pessoas:[{pessoa,horas}] } por horas.
  horasAssociadas(registos, { oportunidadeId, contaId }) {
    const por = new Map();
    let horas = 0;
    (registos || []).forEach(r => {
      const bate = oportunidadeId ? r.crmOportunidadeId === oportunidadeId : (contaId ? r.crmContaId === contaId : false);
      if (!bate) return;
      const h = parseFloat(r.horas) || 0;
      horas += h;
      por.set(r.pessoa, (por.get(r.pessoa) || 0) + h);
    });
    const pessoas = [...por.entries()].map(([pessoa, h]) => ({ pessoa, horas: h })).sort((a, b) => b.horas - a.horas || a.pessoa.localeCompare(b.pessoa, 'pt'));
    return { horas, pessoas };
  }
};
if (typeof module !== 'undefined') module.exports = RegistoComercial;

// Horas reais de TODAS as tarefas de um projeto, calculadas de uma só vez (uma passagem pelos registos). A conta é a mesma de
// App.horasReaisTarefa (que, chamada tarefa a tarefa, percorria todos os registos de horas da empresa por cada tarefa — num projeto
// longo, com centenas de tarefas e dezenas de milhares de registos, isso custava segundos a cada alteração). Testada contra a versão
// lenta em tests/horas-reais-logica.test.js.
//
// Regras (as mesmas de sempre):
//  - um registo ligado por id a uma tarefa do projeto conta para ela;
//  - sem ligação por id, conta pelo NOME da tarefa, mas só se o nome for único no projeto;
//  - uma tarefa-resumo soma as suas próprias horas diretas e as das filhas;
//  - registos sem correspondência a nenhuma tarefa (em branco, ou texto livre) só se atribuem a uma tarefa-folha se for a ÚNICA
//    tarefa-folha dessa pessoa no projeto; havendo mais que uma, ficam por atribuir.
const HorasReaisLogica = {
  normalizar(s) { return String(s || '').trim().toLowerCase(); },

  // p: { id, idInterno, tarefas: [{ id, nome, parentId, recursoIds }] }; registos: [{ projetoId, projetoIdInterno, tarefaId, tarefaNome, pessoa, horas }];
  // recursos: [{ id, nome }]. Devolve Map: id da tarefa → horas reais.
  porTarefa(p, registos, recursos) {
    const n = s => this.normalizar(s);
    const horasDe = r => parseFloat(r.horas) || 0;
    const pertence = r => r.projetoId ? r.projetoId === p.id : (!!p.idInterno && r.projetoIdInterno === p.idInterno);
    const tarefas = p.tarefas || [];
    const idsTarefas = new Set(tarefas.map(x => x.id));
    const nomesTodas = new Set(), contagemNome = new Map(), filhos = new Map();
    tarefas.forEach(x => {
      const k = n(x.nome);
      nomesTodas.add(k); contagemNome.set(k, (contagemNome.get(k) || 0) + 1);
      if (x.parentId !== null && x.parentId !== undefined) { if (!filhos.has(x.parentId)) filhos.set(x.parentId, []); filhos.get(x.parentId).push(x); }
    });
    const recursoPorNome = new Map();
    (recursos || []).forEach(x => { const k = n(x.nome); if (!recursoPorNome.has(k)) recursoPorNome.set(k, x.id); });

    // Uma passagem pelos registos do projeto: por id, por nome (sem ligação) e "sem correspondência" por pessoa.
    const porId = new Map(), porNome = new Map(), semCorrespondencia = new Map();
    const somar = (m, k, h) => m.set(k, (m.get(k) || 0) + h);
    (registos || []).forEach(r => {
      if (!pertence(r)) return;
      const h = horasDe(r);
      if (r.tarefaId && idsTarefas.has(r.tarefaId)) { somar(porId, r.tarefaId, h); return; }
      const nr = n(r.tarefaNome);
      if (nr) somar(porNome, nr, h);
      if (nr && nomesTodas.has(nr)) return;
      const rid = recursoPorNome.get(n(r.pessoa));
      if (rid !== undefined) somar(semCorrespondencia, rid, h);
    });

    // Quantas tarefas-folha tem cada pessoa neste projeto.
    const folhasDaPessoa = new Map();
    tarefas.forEach(x => { if (!filhos.has(x.id)) new Set(x.recursoIds || []).forEach(rid => somar(folhasDaPessoa, rid, 1)); });

    const diretas = t => (porId.get(t.id) || 0) + (contagemNome.get(n(t.nome)) === 1 ? (porNome.get(n(t.nome)) || 0) : 0);
    const resultado = new Map();
    const calcular = t => {
      if (resultado.has(t.id)) return resultado.get(t.id);
      let total = diretas(t);
      if (filhos.has(t.id)) filhos.get(t.id).forEach(f => { total += calcular(f); });
      else new Set(t.recursoIds || []).forEach(rid => { if (folhasDaPessoa.get(rid) === 1) total += semCorrespondencia.get(rid) || 0; });
      resultado.set(t.id, total);
      return total;
    };
    tarefas.forEach(calcular);
    return resultado;
  }
};
if (typeof module !== 'undefined') module.exports = HorasReaisLogica;

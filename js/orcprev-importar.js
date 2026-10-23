// Importador de horas do Gestor para o orcprev. CORRE DENTRO DO ORCPREV (https://orcprev.citeve.pt), carregado por
// um marcador do browser (ver App.abrirModalOrcprev, no Gestor) — usa a sessão da própria pessoa, com os mesmos
// pedidos que o ecrã do Timesheet do orcprev já faz (GET /api/timesheet e POST /api/timesheet-bulk-save).
// O Gestor não consegue falar com o orcprev a partir do seu próprio site (o orcprev não aceita pedidos de outros
// sites), por isso o caminho é: copiar a semana no Gestor → clicar no marcador no orcprev → rever → enviar.
//
// Regras:
//  - nada é enviado sem pré-visualização e sem a pessoa carregar em "Enviar";
//  - só importa para a conta com que se está autenticado no orcprev SE o email do pacote for o mesmo;
//  - reenviar a mesma semana substitui APENAS as linhas que vieram do Gestor (nota começa por "[Gestor]");
//    o que a pessoa lançou à mão no orcprev nunca é apagado nem alterado;
//  - projetos que não se conseguem casar com certeza ficam por escolher (nunca se adivinha);
//  - QUALQUER linha pode ser reajustada na pré-visualização: enviar como projeto de I&D, serviço (consultoria/
//    prototipagem) ou atividade (ex.: "Outras atividades"), e editar a nota. A mudança vale só para este envio, a
//    não ser que se marque "lembrar" (guarda-se neste browser, por projeto do Gestor);
//  - sem serviços no orcprev, a consultoria vai como atividade (ex.: "Outras atividades") com o projeto e o cliente na nota;
//  - "Preparação de candidaturas" é uma atividade que leva também um projeto do orcprev (linha do tipo APPLICATION).
// A lógica pura (sem DOM) está testada em tests/orcprev-importar.test.js.
(function (raiz) {
  'use strict';
  const MARCA = '[Gestor]';
  const NOTA_MAX = 200;
  const FORMATO = 'gestor-orcprev';
  const ATIVIDADES_COM_PROJETO = ['APPLICATION_PREP'];
  const CHAVE_MEMORIA = 'gestorOrcprevMemoria';

  const Imp = {
    MARCA,

    normalizar(s) {
      return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },

    // Lê o texto copiado do Gestor. Devolve { ok:true, pacote } ou { ok:false, erro }.
    lerPacote(texto) {
      let p;
      try { p = JSON.parse(String(texto || '').trim()); } catch (e) { return { ok: false, erro: 'O texto colado não é o que o Gestor copia. Volta ao Gestor e carrega em "Copiar semana".' }; }
      if (!p || p.formato !== FORMATO) return { ok: false, erro: 'Este texto não veio do Gestor (formato desconhecido).' };
      if (p.versao !== 1) return { ok: false, erro: 'Versão do pacote não suportada — atualiza o marcador a partir do Gestor.' };
      if (!p.semana || !/^\d{4}-\d{2}-\d{2}$/.test(p.semana.inicio || '') || !Array.isArray(p.linhas)) return { ok: false, erro: 'O pacote está incompleto.' };
      return { ok: true, pacote: p };
    },

    // Chave com que se lembra a escolha de um projeto do Gestor (por browser).
    chaveProjeto(proj) { return String((proj && (proj.idInterno || proj.nome)) || ''); },

    // Procura o projeto do orcprev que corresponde a um projeto do Gestor.
    // Devolve { id, como, candidatos }:
    //   como = 'escolhido' | 'codigo' | 'ref-nome' | 'memorizado' | 'nome' | 'ambiguo' | 'ref-invalida' | 'sem-correspondencia'
    // Ordem: escolha feita agora → referência definida no Gestor (código, depois nome) → escolha memorizada → nome igual.
    casarProjeto(proj, projetosOrcprev, memoria, escolhaId) {
      const lista = projetosOrcprev || [];
      const porId = id => lista.find(p => Number(p.id) === Number(id));
      const desempatar = cands => {
        if (cands.length <= 1) return cands;
        const emExec = cands.filter(p => p.project_status_code === 'execution');
        if (emExec.length === 1) return emExec;
        const comCodigo = (emExec.length ? emExec : cands).filter(p => p.project_code);
        return comCodigo.length === 1 ? comCodigo : cands;
      };
      const resultado = (cands, como) => {
        const c = desempatar(cands);
        return c.length === 1 ? { id: c[0].id, como, candidatos: [] } : { id: null, como: c.length ? 'ambiguo' : 'sem-correspondencia', candidatos: c };
      };
      if (escolhaId && porId(escolhaId)) return { id: porId(escolhaId).id, como: 'escolhido', candidatos: [] };
      const ref = String((proj && proj.ref) || '').trim();
      if (ref) {
        const porCodigo = lista.filter(p => p.project_code && String(p.project_code).trim() === ref);
        if (porCodigo.length) return resultado(porCodigo, 'codigo');
        const n = this.normalizar(ref);
        const porNome = lista.filter(p => this.normalizar(p.name) === n);
        if (porNome.length) return resultado(porNome, 'ref-nome');
        return { id: null, como: 'ref-invalida', candidatos: [] };
      }
      const mem = memoria && memoria[this.chaveProjeto(proj)];
      if (mem && porId(mem)) return { id: porId(mem).id, como: 'memorizado', candidatos: [] };
      const nome = this.normalizar(proj && proj.nome);
      if (!nome) return { id: null, como: 'sem-correspondencia', candidatos: [] };
      return resultado(lista.filter(p => this.normalizar(p.name) === nome), 'nome');
    },

    // Procura o serviço do orcprev (cliente + nome) que corresponde ao texto escrito no Gestor.
    // Aceita "Cliente · Serviço", só o nome do serviço ou só o cliente — desde que seja único. Mesmo formato de resultado
    // que casarProjeto (id, como, candidatos); a escolha memorizada usa a chave "s:" + projeto do Gestor.
    casarServico(proj, servicos, memoria, escolhaId) {
      const lista = (servicos || []).filter(x => Number(x.active) !== 0);
      const porId = id => lista.find(x => Number(x.id) === Number(id));
      const unico = (c, como) => c.length === 1 ? { id: c[0].id, como, candidatos: [] } : { id: null, como: c.length ? 'ambiguo' : 'sem-correspondencia', candidatos: c };
      const procurar = texto => {
        const n = this.normalizar(texto);
        if (!n) return null;
        const passos = [
          [x => this.normalizar((x.client_name || '') + (x.name || '')) === n, 'completo'],
          [x => this.normalizar(x.name) === n, 'nome'],
          [x => this.normalizar(x.client_name) === n, 'cliente']
        ];
        for (const [fn, como] of passos) { const c = lista.filter(fn); if (c.length) return unico(c, como); }
        return null;
      };
      if (escolhaId && porId(escolhaId)) return { id: porId(escolhaId).id, como: 'escolhido', candidatos: [] };
      const ref = String((proj && proj.ref) || '').trim();
      if (ref) return procurar(ref) || { id: null, como: 'ref-invalida', candidatos: [] };
      const mem = memoria && memoria['s:' + this.chaveProjeto(proj)];
      if (mem && porId(mem)) return { id: porId(mem).id, como: 'memorizado', candidatos: [] };
      return procurar(proj && proj.nome) || { id: null, como: 'sem-correspondencia', candidatos: [] };
    },

    // ---------- nota ----------
    // Mesma regra do Gestor (OrcprevLogica.textoNota): num projeto do orcprev, só as tarefas; numa atividade ou serviço,
    // acrescenta-se "— Projeto (Cliente)". Sem dados estruturados (pacote antigo), usa-se a nota que veio.
    textoNota(l, tipoFinal) {
      if (!Array.isArray(l.tarefas)) return String(l.nota || '').replace(/^\[Gestor\]\s*/, '');
      const tarefas = l.tarefas.join('; ');
      if (tipoFinal === 'PROJECT' || tipoFinal === 'APPLICATION') return tarefas;
      const projetos = l.projetos || [], clientes = l.clientes || [];
      const ctx = [];
      if (projetos.length) ctx.push(projetos.join('; '));
      if (clientes.length) ctx.push(projetos.length ? `(${clientes.join('; ')})` : clientes.join('; '));
      return [tarefas, ctx.join(' ')].filter(Boolean).join(' — ');
    },
    montarNota(texto) {
      const t = String(texto || '').trim();
      return (MARCA + (t ? ' ' + t : '')).slice(0, NOTA_MAX);
    },

    // Atividades que se podem escolher como "atividade" (as que não pedem serviço nem projeto).
    atividadesLivres(dados) {
      const comServico = new Set(dados.service_activity_codes || []);
      return (dados.activities || []).filter(a => !comServico.has(a.code) && !ATIVIDADES_COM_PROJETO.includes(a.code));
    },
    // "Preparação de candidaturas": atividade que leva um projeto do orcprev.
    atividadesComProjeto(dados) {
      const atividades = new Set((dados.activities || []).map(a => a.code));
      return ATIVIDADES_COM_PROJETO.filter(c => atividades.has(c));
    },
    // Atividades que levam serviço (consultoria, prototipagem), as que o orcprev indicar.
    atividadesDeServico(dados) {
      const cod = new Set(dados.service_activity_codes || []);
      return (dados.activities || []).filter(a => cod.has(a.code));
    },

    // Aplica um destino escolhido pela pessoa (ou memorizado) a uma linha.
    //   ov = { destino: 'projeto'|'servico'|'atividade', id, atividade }
    // Devolve os campos que mudam na linha, ou null se o destino for desconhecido.
    aplicarDestino(ov, dados) {
      const atividades = new Set((dados.activities || []).map(a => a.code));
      const comServico = new Set(dados.service_activity_codes || []);
      if (ov.destino === 'projeto') {
        const p = ov.id ? (dados.projects || []).find(x => Number(x.id) === Number(ov.id)) : null;
        return p ? { tipo: 'PROJECT', atividade: null, projetoId: p.id, projetoNomeOrcprev: p.name, estado: 'ok' }
          : { tipo: 'PROJECT', atividade: null, projetoId: null, projetoNomeOrcprev: '', estado: 'escolher' };
      }
      if (ov.destino === 'candidatura') {
        const p = ov.id ? (dados.projects || []).find(x => Number(x.id) === Number(ov.id)) : null;
        const disponivel = atividades.has('APPLICATION_PREP');
        return p && disponivel ? { tipo: 'APPLICATION', atividade: 'APPLICATION_PREP', projetoId: p.id, projetoNomeOrcprev: p.name, estado: 'ok' }
          : { tipo: 'APPLICATION', atividade: 'APPLICATION_PREP', projetoId: null, projetoNomeOrcprev: '', estado: 'escolher' };
      }
      if (ov.destino === 'servico') {
        const codigo = ov.atividade || 'CONSULTING';
        const sv = ov.id ? (dados.services || []).filter(x => Number(x.active) !== 0).find(x => Number(x.id) === Number(ov.id)) : null;
        const valido = sv && atividades.has(codigo) && comServico.has(codigo);
        return valido ? { tipo: 'SERVICE', atividade: codigo, servicoId: sv.id, servicoNomeOrcprev: `${sv.client_name || ''} · ${sv.name || ''}`, estado: 'ok' }
          : { tipo: 'SERVICE', atividade: codigo, servicoId: null, servicoNomeOrcprev: '', estado: 'escolher' };
      }
      if (ov.destino === 'atividade') {
        const codigo = ov.atividade || '';
        const valido = atividades.has(codigo) && !comServico.has(codigo) && !ATIVIDADES_COM_PROJETO.includes(codigo);
        return { tipo: 'ACTIVITY', atividade: codigo || null, estado: valido ? 'ok' : 'escolher' };
      }
      return null;
    },

    // Junta o pacote do Gestor com o que o orcprev já tem nessa semana.
    //   dados     resposta de GET /api/timesheet?week_start=...
    //   escolhas  { [chaveProjeto]: idProjetoOrcprev } (forma antiga de escolher projeto/serviço)
    //   edicoes   { [indiceDaLinha]: { destino, id, atividade, nota, lembrar } } reajustes feitos na pré-visualização
    // Devolve { linhas, apagar, dias, totalEnviar, totalPendente }
    planear({ pacote, dados, memoria, escolhas, edicoes }) {
      const projetos = dados.projects || [];
      const atividades = new Set((dados.activities || []).map(a => a.code));
      const comServico = new Set(dados.service_activity_codes || []);
      const entradas = dados.entries || [];
      const marcadas = entradas.filter(e => String(e.note || '').startsWith(MARCA));
      const manuais = entradas.filter(e => !String(e.note || '').startsWith(MARCA));

      const automatico = (l, base) => {
        if (l.tipo === 'PROJECT' || l.tipo === 'APPLICATION') {
          const chave = this.chaveProjeto(l.projeto);
          const m = this.casarProjeto(l.projeto, projetos, memoria, escolhas && escolhas[chave]);
          const proj = m.id ? projetos.find(p => Number(p.id) === Number(m.id)) : null;
          const semAtividade = l.tipo === 'APPLICATION' && !atividades.has('APPLICATION_PREP');
          return Object.assign(base, { chave, projetoId: m.id, projetoNomeOrcprev: proj ? proj.name : '', como: m.como, candidatos: m.candidatos,
            estado: semAtividade ? 'manual' : (m.id ? 'ok' : 'escolher'), motivo: semAtividade ? 'O orcprev não tem a atividade "Preparação de candidaturas".' : undefined });
        }
        if (!atividades.has(l.atividade)) return Object.assign(base, { estado: 'manual', motivo: 'Atividade desconhecida no orcprev.' });
        if (l.tipo === 'SERVICE') {
          const servicos = (dados.services || []).filter(x => Number(x.active) !== 0);
          const chave = this.chaveProjeto(l.projeto);
          if (!servicos.length) return Object.assign(base, { chave, estado: 'manual', motivo: 'Não há serviços no orcprev — escolhe "Atividade" (ex.: Outras atividades) em "Alterar", ou cria o serviço lá (Serviços TimeSheet).' });
          const m = this.casarServico(l.projeto, servicos, memoria, escolhas && escolhas['s:' + chave]);
          const sv = m.id ? servicos.find(x => Number(x.id) === Number(m.id)) : null;
          return Object.assign(base, { chave, chaveEscolha: 's:' + chave, servicoId: m.id, servicoNomeOrcprev: sv ? `${sv.client_name || ''} · ${sv.name || ''}` : '', como: m.como, candidatos: m.candidatos, estado: m.id ? 'ok' : 'escolher' });
        }
        if (ATIVIDADES_COM_PROJETO.includes(l.atividade)) {
          // ex.: tipo de trabalho "Candidaturas" → o orcprev pede o projeto da candidatura: escolhe-se em "Alterar".
          return Object.assign(base, { tipo: 'APPLICATION', projetoId: null, projetoNomeOrcprev: '', candidatos: [], estado: 'escolher' });
        }
        if (comServico.has(l.atividade)) {
          return Object.assign(base, { estado: 'manual', motivo: 'O orcprev pede um serviço nesta atividade — escolhe o destino em "Alterar" ou preenche-a à mão.' });
        }
        return Object.assign(base, { estado: 'ok' });
      };

      const linhas = (pacote.linhas || []).map((l, i) => {
        const chave = this.chaveProjeto(l.projeto);
        const base = { indice: i, data: l.data, tipo: l.tipo, tipoOriginal: l.tipo, atividade: l.atividade || null, horas: Number(l.horas) || 0, projeto: l.projeto || null,
          tarefas: l.tarefas || null, projetos: l.projetos || null, clientes: l.clientes || null, chave, origem: 'automatico' };
        let r = automatico(l, base);
        // "soAberto": o editor foi aberto mas ainda não se mudou nada — conta como se não houvesse reajuste.
        const ov = edicoes && edicoes[i] && !edicoes[i].soAberto ? edicoes[i] : null;
        // Destino lembrado neste browser (só se o Gestor não definir uma correspondência para este projeto).
        const mem = !ov && chave && !(l.projeto && l.projeto.ref) && memoria && memoria['d:' + chave];
        const efetivo = ov && ov.destino ? ov : (mem && mem.t ? { destino: mem.t, id: mem.id, atividade: mem.atividade } : null);
        if (efetivo) {
          const d = this.aplicarDestino(efetivo, dados);
          if (d) { r = Object.assign(r, d); r.origem = ov ? 'editado' : 'memorizado'; r.como = r.origem; }
        }
        r.textoNotaPadrao = this.textoNota(l, r.tipo);
        r.nota = this.montarNota(ov && typeof ov.nota === 'string' ? ov.nota : r.textoNotaPadrao);
        r.notaEditada = !!(ov && typeof ov.nota === 'string');
        return r;
      });

      // resumo por dia (7 dias da semana)
      const dias = [];
      const inicio = pacote.semana.inicio;
      for (let i = 0; i < 7; i++) {
        const dt = new Date(inicio + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + i);
        const data = dt.toISOString().slice(0, 10);
        const soma = arr => arr.filter(x => (x.work_date || x.data) === data).reduce((s, x) => s + (Number(x.hours != null ? x.hours : x.horas) || 0), 0);
        dias.push({ data, enviar: soma(linhas.filter(l => l.estado === 'ok')), pendente: soma(linhas.filter(l => l.estado !== 'ok')), substitui: soma(marcadas), manual: soma(manuais) });
      }
      const total = ls => ls.reduce((s, l) => s + l.horas, 0);
      return {
        linhas, apagar: marcadas.map(e => e.id).filter(Boolean), dias,
        totalEnviar: total(linhas.filter(l => l.estado === 'ok')), totalPendente: total(linhas.filter(l => l.estado !== 'ok')),
        horasMarcadasAnteriores: marcadas.reduce((s, e) => s + (Number(e.hours) || 0), 0), horasManuais: manuais.reduce((s, e) => s + (Number(e.hours) || 0), 0)
      };
    },

    // Corpo do POST /api/timesheet-bulk-save — o mesmo formato que o ecrã do Timesheet envia.
    corpoGravacao(plano, dados, pacote) {
      return {
        employee_code: (dados.employee && dados.employee.employee_code) || null,
        week_start: pacote.semana.inicio,
        entries: plano.linhas.filter(l => l.estado === 'ok').map(l => ({
          id: null, work_date: l.data,
          project_id: l.tipo === 'PROJECT' || l.tipo === 'APPLICATION' ? Number(l.projetoId) : null,
          service_id: l.tipo === 'SERVICE' ? Number(l.servicoId) : null,
          activity_code: l.tipo === 'PROJECT' ? null : l.atividade,
          hours: l.horas, note: l.nota
        })),
        delete_ids: plano.apagar
      };
    },

    // O que se guarda no browser quando a pessoa marca "lembrar" numa linha reajustada.
    memorizar(memoria, plano, edicoes) {
      const mem = Object.assign({}, memoria);
      plano.linhas.forEach(l => {
        const ov = edicoes && edicoes[l.indice];
        if (!ov || ov.soAberto || !ov.lembrar || l.estado !== 'ok' || !l.chave) return;
        mem['d:' + l.chave] = l.tipo === 'PROJECT' ? { t: 'projeto', id: l.projetoId } : l.tipo === 'APPLICATION' ? { t: 'candidatura', id: l.projetoId } : l.tipo === 'SERVICE' ? { t: 'servico', id: l.servicoId, atividade: l.atividade } : { t: 'atividade', atividade: l.atividade };
      });
      return mem;
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = Imp; return; }
  if (typeof document === 'undefined') return;

  // ==========================================================================================================
  // Interface (só no browser, dentro do orcprev)
  // ==========================================================================================================
  if (raiz.__gestorOrcprev && raiz.__gestorOrcprev.abrir) { raiz.__gestorOrcprev.abrir(); return; }

  const h = (tag, attrs, ...filhos) => {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'style') el.style.cssText = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'value') el.value = v; else el.setAttribute(k, v);
    });
    filhos.flat(Infinity).forEach(f => { if (f != null && f !== false) el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return el;
  };
  const fmtH = n => (Math.round(n * 100) / 100).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' h';
  const fmtData = iso => { const [a, m, d] = iso.split('-'); return `${d}/${m}`; };
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const diaSemana = iso => DIAS[new Date(iso + 'T00:00:00Z').getUTCDay()];
  const lerMemoria = () => { try { return JSON.parse(localStorage.getItem(CHAVE_MEMORIA) || '{}') || {}; } catch (e) { return {}; } };
  const gravarMemoria = m => { try { localStorage.setItem(CHAVE_MEMORIA, JSON.stringify(m)); } catch (e) { /* sem armazenamento: só não se lembra */ } };

  let perfil = 'COLLABORATOR';
  const api = async (caminho, opt) => {
    const r = await fetch('/api' + caminho, Object.assign({ credentials: 'same-origin' }, opt, {
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-ORCPREV-Profile': perfil }, (opt && opt.headers) || {})
    }));
    const txt = await r.text();
    let v = null; try { v = txt ? JSON.parse(txt) : null; } catch (e) { /* não é JSON */ }
    if (!r.ok) throw new Error((v && (v.error || v.message || v.detail)) || ('Erro ' + r.status));
    return v;
  };

  let painel = null;
  const fechar = () => { if (painel) { painel.remove(); painel = null; } };
  const abrir = () => {
    fechar();
    painel = h('div', { id: 'gestor-orcprev-painel', style: 'position:fixed;top:0;right:0;bottom:0;width:min(820px,100vw);z-index:2147483647;background:#fff;color:#1e293b;box-shadow:-8px 0 30px rgba(0,0,0,.25);font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif;display:flex;flex-direction:column;' });
    document.body.appendChild(painel);
    ecraEntrada();
  };
  const moldura = (titulo, corpo, rodape) => {
    painel.replaceChildren(
      h('div', { style: 'display:flex;align-items:center;gap:10px;padding:14px 18px;background:#0f2a4a;color:#fff;' },
        h('strong', { style: 'font-size:16px;flex:1;' }, titulo),
        h('button', { type: 'button', onclick: fechar, style: 'background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;', title: 'Fechar' }, '×')),
      h('div', { id: 'gestor-orcprev-corpo', style: 'padding:16px 18px;overflow:auto;flex:1;' }, corpo),
      rodape ? h('div', { style: 'padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;' }, rodape) : null);
  };
  const botao = (texto, onclick, primario, desativado) => h('button', { type: 'button', onclick, ...(desativado ? { disabled: 'disabled' } : {}),
    style: `padding:8px 16px;border-radius:8px;border:1px solid ${primario ? '#0f2a4a' : '#cbd5e1'};background:${primario ? '#0f2a4a' : '#fff'};color:${primario ? '#fff' : '#1e293b'};font:inherit;font-weight:600;cursor:${desativado ? 'not-allowed' : 'pointer'};opacity:${desativado ? '.45' : '1'};` }, texto);
  const aviso = (texto, cor) => h('div', { style: `margin:8px 0;padding:9px 12px;border-radius:8px;background:${cor === 'erro' ? '#fee2e2' : cor === 'ok' ? '#dcfce7' : '#fef3c7'};color:${cor === 'erro' ? '#991b1b' : cor === 'ok' ? '#166534' : '#92400e'};` }, texto);

  function ecraEntrada(mensagem) {
    const area = h('textarea', { rows: '8', placeholder: 'Cola aqui o que copiaste no Gestor (Registo do Dia → Orcprev → Copiar semana)…', style: 'width:100%;box-sizing:border-box;font:12px/1.4 ui-monospace,Consolas,monospace;padding:8px;border:1px solid #cbd5e1;border-radius:8px;' });
    const seguir = () => {
      const r = Imp.lerPacote(area.value);
      if (!r.ok) { ecraEntrada(r.erro); return; }
      ecraPrevia(r.pacote);
    };
    moldura('Importar horas do Gestor', [
      h('p', { style: 'margin:0 0 10px;' }, 'No Gestor, em Registo do Dia, abre "Orcprev" e carrega em "Copiar semana". Depois cola aqui.'),
      mensagem ? aviso(mensagem, 'erro') : null, area],
      [botao('Cancelar', fechar), botao('Ler e pré-visualizar', seguir, true)]);
    // Tenta ler a área de transferência (o browser pode pedir licença uma vez; se não deixar, cola-se à mão).
    if (!mensagem && navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(t => {
        const r = Imp.lerPacote(t);
        if (r.ok && painel) { area.value = t; ecraPrevia(r.pacote); }
      }).catch(() => { /* sem permissão: fica a caixa para colar */ });
    }
  }

  // est = { dados, eu, edicoes: {indice: {...}}, abertos: Set(indice) } — guardado entre redesenhos para não voltar a
  // consultar o orcprev a cada alteração.
  async function ecraPrevia(pacote, est) {
    est = est || { edicoes: {}, abertos: new Set() };
    if (!est.dados) {
      moldura('Importar horas do Gestor', h('p', {}, 'A consultar o orcprev…'));
      try {
        est.eu = await api('/auth/me');
        if (est.eu && est.eu.profiles && est.eu.profiles[0] && est.eu.profiles[0].code) perfil = est.eu.profiles[0].code;
        est.dados = await api('/timesheet?week_start=' + encodeURIComponent(pacote.semana.inicio));
      } catch (e) { moldura('Importar horas do Gestor', aviso('Não consegui falar com o orcprev: ' + e.message + '. Confirma que a sessão está iniciada.', 'erro'), [botao('Fechar', fechar)]); return; }
    }
    const { dados, eu } = est;
    const scrollAntes = (document.getElementById('gestor-orcprev-corpo') || {}).scrollTop || 0;

    const emailOrcprev = String((eu && eu.user && (eu.user.email || eu.user.upn)) || '').trim().toLowerCase();
    const bloqueios = [];
    if (!pacote.email || emailOrcprev !== String(pacote.email).trim().toLowerCase()) bloqueios.push(`Estas horas são de ${pacote.pessoa || pacote.email || 'outra pessoa'} (${pacote.email || 'sem email'}) e a sessão do orcprev é de ${emailOrcprev || 'desconhecido'}. Só se importa para a própria conta.`);
    if (dados.read_only) bloqueios.push('Esta semana está fechada no orcprev (só de leitura).');
    if (dados.week_start !== pacote.semana.inicio) bloqueios.push(`O orcprev devolveu a semana ${dados.week_start}, e não ${pacote.semana.inicio}.`);

    const memoria = lerMemoria();
    const calcular = () => Imp.planear({ pacote, dados, memoria, edicoes: est.edicoes });
    const plano = calcular();
    const nok = plano.linhas.filter(l => l.estado === 'ok').length;
    const redesenhar = () => ecraPrevia(pacote, est);

    const projetosOrdenados = (dados.projects || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt'));
    const servicosAtivos = (dados.services || []).filter(x => Number(x.active) !== 0);
    const atividadesLivres = Imp.atividadesLivres(dados);
    const atividadesServico = Imp.atividadesDeServico(dados);
    const atividadesComProjeto = Imp.atividadesComProjeto(dados);
    const nomeAtividade = cod => ((dados.activities || []).find(a => a.code === cod) || {}).name || cod;

    const estilo = { td: 'padding:5px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top;', sel: 'padding:4px;max-width:100%;font:inherit;' };

    // O destino atual de uma linha, em texto.
    const destinoTexto = l => {
      if (l.tipo === 'PROJECT') return [h('div', { style: 'color:#64748b;font-size:12px;' }, 'Projeto'), h('b', {}, l.projetoNomeOrcprev || 'por escolher')];
      if (l.tipo === 'APPLICATION') return [h('div', { style: 'color:#64748b;font-size:12px;' }, 'Preparação de candidaturas · projeto'), h('b', {}, l.projetoNomeOrcprev || 'por escolher')];
      if (l.tipo === 'SERVICE') return [h('div', { style: 'color:#64748b;font-size:12px;' }, l.atividade === 'PROTOTYPING' ? 'Serviço · Prototipagem' : 'Serviço · Consultoria'), h('b', {}, l.servicoNomeOrcprev || 'por escolher')];
      return [h('div', { style: 'color:#64748b;font-size:12px;' }, 'Atividade'), h('b', {}, l.atividade ? nomeAtividade(l.atividade) : 'por escolher')];
    };
    const origemTexto = l => l.projeto && l.projeto.nome ? l.projeto.nome : (l.tipoOriginal === 'ACTIVITY' ? 'Tipo de trabalho' : '');

    // Editor de uma linha: destino (projeto / serviço / atividade), alvo, nota e "lembrar".
    const editor = l => {
      const i = l.indice;
      const ov = est.edicoes[i] || (est.edicoes[i] = { destino: l.tipo === 'PROJECT' ? 'projeto' : l.tipo === 'APPLICATION' ? 'candidatura' : l.tipo === 'SERVICE' ? 'servico' : 'atividade',
        id: l.tipo === 'PROJECT' || l.tipo === 'APPLICATION' ? l.projetoId : l.tipo === 'SERVICE' ? l.servicoId : null, atividade: l.atividade, lembrar: l.estado !== 'ok' && !!l.chave, soAberto: true });
      // Depois de mexer, o editor fica aberto até a pessoa o fechar (mesmo que a linha já fique "pronta").
      const mudou = () => { delete ov.soAberto; est.abertos.add(i); redesenhar(); };
      const selDestino = h('select', { style: estilo.sel, onchange: ev => {
        ov.destino = ev.target.value; ov.id = null;
        ov.atividade = ov.destino === 'servico' ? ((atividadesServico[0] || {}).code || 'CONSULTING') : ov.destino === 'atividade' ? (atividadesLivres.some(a => a.code === 'OTHER') ? 'OTHER' : '') : null;
        mudou();
      } },
        h('option', { value: 'projeto' }, 'Projeto de I&D'),
        atividadesComProjeto.length ? h('option', { value: 'candidatura' }, `${nomeAtividade('APPLICATION_PREP')} (com projeto)`) : null,
        h('option', { value: 'servico' }, 'Serviço (consultoria / prototipagem)'), h('option', { value: 'atividade' }, 'Atividade (ex.: Outras atividades)'));
      selDestino.value = ov.destino;
      let alvo;
      if (ov.destino === 'projeto' || ov.destino === 'candidatura') {
        alvo = h('select', { style: estilo.sel, onchange: ev => { ov.id = ev.target.value ? Number(ev.target.value) : null; mudou(); } },
          h('option', { value: '' }, ov.destino === 'candidatura' ? 'Escolhe o projeto da candidatura…' : 'Escolhe o projeto…'),
          projetosOrdenados.map(p => h('option', { value: String(p.id) }, `${p.name}${p.project_code ? ' (' + p.project_code + ')' : ''} — ${p.status_name || ''}`)));
        alvo.value = ov.id ? String(ov.id) : '';
      } else if (ov.destino === 'servico') {
        if (!servicosAtivos.length) alvo = h('span', { style: 'color:#92400e;' }, 'O orcprev não tem serviços — usa "Atividade" (ex.: Outras atividades).');
        else {
          const selAt = h('select', { style: estilo.sel, onchange: ev => { ov.atividade = ev.target.value; mudou(); } }, atividadesServico.map(a => h('option', { value: a.code }, a.name)));
          selAt.value = ov.atividade || (atividadesServico[0] || {}).code || '';
          const selSv = h('select', { style: estilo.sel, onchange: ev => { ov.id = ev.target.value ? Number(ev.target.value) : null; mudou(); } },
            h('option', { value: '' }, 'Escolhe o serviço…'), servicosAtivos.map(x => h('option', { value: String(x.id) }, `${x.client_name || ''} · ${x.name || ''}`)));
          selSv.value = ov.id ? String(ov.id) : '';
          alvo = [selAt, ' ', selSv];
        }
      } else {
        alvo = h('select', { style: estilo.sel, onchange: ev => { ov.atividade = ev.target.value; mudou(); } },
          h('option', { value: '' }, 'Escolhe a atividade…'), atividadesLivres.map(a => h('option', { value: a.code }, a.name)));
        alvo.value = ov.atividade || '';
      }
      const campoNota = h('input', { type: 'text', value: typeof ov.nota === 'string' ? ov.nota : l.textoNotaPadrao, maxlength: String(NOTA_MAX - MARCA.length - 1),
        style: 'width:100%;box-sizing:border-box;padding:5px;font:inherit;border:1px solid #cbd5e1;border-radius:6px;', oninput: ev => { ov.nota = ev.target.value; delete ov.soAberto; } });
      const lembrar = l.chave ? h('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px;color:#475569;' },
        h('input', { type: 'checkbox', onchange: ev => { ov.lembrar = ev.target.checked; } }), `Lembrar este destino para "${l.projeto && l.projeto.nome || l.chave}" (neste browser)`) : null;
      if (lembrar) lembrar.firstChild.checked = !!ov.lembrar;
      return h('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;display:grid;gap:8px;' },
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;' }, h('span', { style: 'min-width:92px;color:#475569;' }, 'Enviar como'), selDestino, alvo),
        h('div', { style: 'display:flex;gap:8px;align-items:center;' }, h('span', { style: 'min-width:92px;color:#475569;' }, `Nota ${MARCA}`), campoNota),
        h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;' }, lembrar,
          h('button', { type: 'button', style: 'background:none;border:0;color:#0f2a4a;text-decoration:underline;cursor:pointer;font:inherit;', onclick: () => { delete est.edicoes[i]; est.abertos.delete(i); redesenhar(); } }, 'Repor o automático'),
          h('button', { type: 'button', style: 'background:none;border:0;color:#0f2a4a;text-decoration:underline;cursor:pointer;font:inherit;', onclick: () => { est.abertos.delete(i); redesenhar(); } }, 'Fechar')));
    };

    const linhasTabela = [];
    plano.linhas.forEach(l => {
      const aberto = est.abertos.has(l.indice) || (l.estado !== 'ok' && !(est.edicoes[l.indice] && !est.edicoes[l.indice].soAberto));
      const estado = l.estado === 'ok'
        ? h('span', { style: 'color:#166534;' }, l.origem === 'editado' ? '✓ alterado' : l.origem === 'memorizado' ? '✓ lembrado' : '✓ pronto')
        : h('span', { style: 'color:#92400e;' }, l.estado === 'escolher' ? 'Escolhe o destino' : (l.motivo || 'Preencher à mão'));
      linhasTabela.push(h('tr', {},
        h('td', { style: estilo.td + 'white-space:nowrap;' }, `${diaSemana(l.data)} ${fmtData(l.data)}`),
        h('td', { style: estilo.td }, h('div', { style: 'color:#64748b;font-size:12px;' }, 'Gestor: ' + (origemTexto(l) || '—')), destinoTexto(l)),
        h('td', { style: estilo.td + 'white-space:nowrap;' }, fmtH(l.horas)),
        h('td', { style: estilo.td }, estado),
        h('td', { style: estilo.td }, h('button', { type: 'button', title: 'Mudar o destino ou a nota desta linha', style: 'padding:3px 9px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font:inherit;',
          onclick: () => { if (est.abertos.has(l.indice)) est.abertos.delete(l.indice); else est.abertos.add(l.indice); redesenhar(); } }, aberto ? 'Fechar' : 'Alterar'))));
      if (aberto) linhasTabela.push(h('tr', {}, h('td', { colspan: '5', style: 'padding:4px 6px 10px;border-bottom:1px solid #f1f5f9;' }, editor(l))));
      else linhasTabela.push(h('tr', {}, h('td', { colspan: '5', style: 'padding:0 6px 6px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;' }, 'Nota: ' + l.nota)));
    });

    const tabela = h('table', { style: 'border-collapse:collapse;width:100%;font-size:13px;' },
      h('thead', {}, h('tr', {}, ['Dia', 'Destino no orcprev', 'Horas', 'Estado', ''].map(t => h('th', { style: 'text-align:left;padding:5px 6px;border-bottom:2px solid #e2e8f0;' }, t)))),
      h('tbody', {}, linhasTabela));

    const diasComConflito = plano.dias.filter(d => d.manual > 0 && d.enviar > 0);
    const pendentes = plano.linhas.filter(l => l.estado !== 'ok').length;
    const corpo = [
      h('div', { style: 'margin-bottom:6px;' }, h('b', {}, `Semana ${fmtData(pacote.semana.inicio)} a ${fmtData(pacote.semana.fim)}`), ` · ${pacote.pessoa || ''}`),
      h('div', { style: 'color:#475569;' }, `${fmtH(plano.totalEnviar)} a enviar${plano.totalPendente ? ` · ${fmtH(plano.totalPendente)} ficam por enviar` : ''}${plano.apagar.length ? ` · substitui ${fmtH(plano.horasMarcadasAnteriores)} enviadas antes pelo Gestor` : ''}`),
      bloqueios.map(b => aviso(b, 'erro')),
      (pacote.avisos || []).map(a => aviso(a)),
      diasComConflito.length ? aviso(`Nestes dias já tens horas lançadas à mão no orcprev (não vou mexer nelas): ${diasComConflito.map(d => `${diaSemana(d.data)} ${fmtData(d.data)} (${fmtH(d.manual)})`).join(', ')}. Confirma que não ficam duplicadas.`) : null,
      h('div', { style: 'color:#64748b;margin:6px 0;' }, 'Podes mudar qualquer linha em "Alterar": enviar como projeto, serviço ou atividade (ex.: Outras atividades) e editar a nota. Só vale para este envio, a menos que marques "Lembrar".'),
      plano.linhas.length ? tabela : aviso('O pacote não tem linhas para enviar.'),
      pendentes ? aviso('As linhas por escolher não são enviadas, a menos que escolhas o destino.') : null
    ];
    const enviar = async () => {
      const planoFinal = calcular(); // com os reajustes mais recentes (inclui notas escritas há pouco)
      moldura('Importar horas do Gestor', h('p', {}, 'A gravar no orcprev…'));
      try {
        const corpoPedido = Imp.corpoGravacao(planoFinal, dados, pacote);
        const r = await api('/timesheet-bulk-save', { method: 'POST', body: JSON.stringify(corpoPedido) });
        gravarMemoria(Imp.memorizar(lerMemoria(), planoFinal, est.edicoes));
        moldura('Importar horas do Gestor',
          [aviso(`Gravado no orcprev: ${r && r.inserted != null ? r.inserted : corpoPedido.entries.length} linha(s) novas${r && r.deleted ? `, ${r.deleted} substituídas` : ''}.`, 'ok'),
            planoFinal.totalPendente ? aviso(`${fmtH(planoFinal.totalPendente)} ficaram por enviar — preenche-as à mão no orcprev.`) : null],
          [botao('Fechar', fechar), botao('Recarregar o orcprev', () => location.reload(), true)]);
      } catch (e) {
        moldura('Importar horas do Gestor', aviso('O orcprev não gravou: ' + e.message + '. Nada foi alterado por mim além disto.', 'erro'), [botao('Voltar', () => ecraPrevia(pacote, est)), botao('Fechar', fechar)]);
      }
    };
    moldura('Importar horas do Gestor', corpo, [
      botao('Voltar', () => ecraEntrada()), botao('Cancelar', fechar),
      botao(`Enviar ${fmtH(plano.totalEnviar)} para o orcprev`, enviar, true, bloqueios.length > 0 || nok === 0)]);
    const corpoEl = document.getElementById('gestor-orcprev-corpo');
    if (corpoEl) corpoEl.scrollTop = scrollAntes;
  }

  raiz.__gestorOrcprev = { abrir };
  abrir();
})(typeof window !== 'undefined' ? window : globalThis);

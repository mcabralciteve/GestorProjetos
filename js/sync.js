// Sincronização entre o estado local (App.state) e o Supabase. Só esta camada fala com o
// Supabase — o resto da app (app.js) chama só Sync.carregarDeSupabase() / Sync.sincronizarComSupabase(...)
// sem saber nada sobre nomes de tabelas, colunas snake_case, ou a forma normalizada dos dados.
const Sync = {
  // ---------- Escrita: comparação antes/depois ----------
  // Recebe os dois snapshots que o próprio App já mantém (o estado anterior e o atual, como
  // strings JSON) e escreve só o que mudou. Chamado sempre em "fire-and-forget" — nunca bloqueia
  // a interface à espera da rede.
  async sincronizarComSupabase(anteriorStr, atualStr) {
    const antes = anteriorStr ? JSON.parse(anteriorStr) : App.estadoVazio();
    const depois = JSON.parse(atualStr);

    // Equipas antes de recursos, recursos antes do resto — "recursos.equipa_id" e
    // "ausencias.recurso_id"/"tarefa_recursos.recurso_id" dependem de já existirem.
    await this.sincronizarListaSimples('equipas', antes.equipas, depois.equipas,
      eq => ({ id: eq.id, nome: eq.nome }));
    await this.sincronizarListaSimples('recursos', antes.recursos, depois.recursos,
      r => ({ id: r.id, nome: r.nome, email: r.email || '', papel: r.papel, equipa_id: r.equipaId || null, preco_custo: r.precoCusto, preco_venda: r.precoVenda }));

    await Promise.all([
      this.sincronizarListaSimples('feriados', antes.feriados, depois.feriados,
        f => ({ id: f.id, data: f.data, descricao: f.descricao })),
      this.sincronizarListaSimples('ausencias', antes.ausencias, depois.ausencias,
        a => ({ id: a.id, recurso_id: a.recursoId, data_inicio: a.dataInicio, data_fim: a.dataFim, tipo: a.tipo, notas: a.notas })),
      this.sincronizarRegistos(antes.registos, depois.registos),
      this.sincronizarProjetos(antes.projetos || {}, depois.projetos || {})
    ]);
  },

  // Tabelas pequenas (equipas/recursos/feriados/ausências): se a lista mudou, apaga os IDs que
  // desapareceram e volta a enviar a lista inteira — simples e barato a este tamanho (dezenas de
  // linhas), sem precisar de calcular exatamente qual o campo que mudou em cada uma.
  async sincronizarListaSimples(tabela, listaAntes, listaDepois, paraLinha) {
    listaAntes = listaAntes || [];
    listaDepois = listaDepois || [];
    const idsAntes = new Set(listaAntes.map(x => x.id));
    const idsDepois = new Set(listaDepois.map(x => x.id));
    const removidos = [...idsAntes].filter(id => !idsDepois.has(id));
    if (removidos.length) {
      const { error } = await supabaseClient.from(tabela).delete().in('id', removidos);
      if (error) throw error;
    }
    if (listaDepois.length && JSON.stringify(listaAntes) !== JSON.stringify(listaDepois)) {
      const { error } = await supabaseClient.from(tabela).upsert(listaDepois.map(paraLinha));
      if (error) throw error;
    }
  },

  // Registos podem crescer para centenas/milhares — ao contrário das tabelas acima, nunca reenvia
  // os que já existiam (raramente são editados depois de criados), só insere os novos e apaga os
  // removidos.
  async sincronizarRegistos(listaAntes, listaDepois) {
    listaAntes = listaAntes || [];
    listaDepois = listaDepois || [];
    const idsAntes = new Set(listaAntes.map(x => x.id));
    const idsDepois = new Set(listaDepois.map(x => x.id));
    const removidos = [...idsAntes].filter(id => !idsDepois.has(id));
    if (removidos.length) {
      const { error } = await supabaseClient.from('registos').delete().in('id', removidos);
      if (error) throw error;
    }
    const novos = listaDepois.filter(r => !idsAntes.has(r.id));
    if (novos.length) {
      const linhas = novos.map(r => ({
        id: r.id, data: r.data, pessoa: r.pessoa, projeto_id: r.projetoId || null,
        projeto_id_interno: r.projetoIdInterno, projeto_nome: r.projetoNome, cliente: r.cliente || '', tarefa_nome: r.tarefaNome,
        horas: r.horas, notas: r.notas, origem: r.origem, user_id: r.userId || null, submetido_em: r.submetidoEm
      }));
      const { error } = await supabaseClient.from('registos').insert(linhas);
      if (error) throw error;
    }
  },

  // Um projeto de cada vez, e só os que realmente mudaram (normalmente é só o projeto ativo) —
  // compara o bloco inteiro (projeto + tarefas + faturas, tudo o que já vem embutido no objeto
  // local) antes/depois; se for byte a byte igual, nem toca na rede.
  async sincronizarProjetos(antesMap, depoisMap) {
    const idsAntes = new Set(Object.keys(antesMap));
    const idsDepois = new Set(Object.keys(depoisMap));
    const removidos = [...idsAntes].filter(id => !idsDepois.has(id));
    if (removidos.length) {
      const { error } = await supabaseClient.from('projetos').delete().in('id', removidos);
      if (error) throw error; // a cascata trata de tarefas/faturas/tarefa_recursos desse projeto
    }
    const alterados = Object.keys(depoisMap).filter(id => JSON.stringify(antesMap[id]) !== JSON.stringify(depoisMap[id]));
    for (const id of alterados) {
      await this.sincronizarUmProjeto(depoisMap[id]);
    }
  },

  // Substitui por completo as tarefas/faturas/alocações de UM projeto — apaga tudo o que lá
  // estava e insere a lista atual. Simples e correto ao tamanho real de um projeto (dezenas de
  // tarefas, não milhares); o preço é uma janela curtíssima em que o projeto fica sem tarefas na
  // base de dados, inofensivo com uma pessoa a editar de cada vez.
  async sincronizarUmProjeto(projeto) {
    const linhaProjeto = {
      id: projeto.id, id_interno: projeto.idInterno, nome: projeto.nome, cliente: projeto.cliente,
      descricao: projeto.descricao, data_inicio: projeto.dataInicio || null, data_fim: projeto.dataFim || null,
      horas_vendidas: projeto.horasVendidas, valor_vendido: projeto.valorVendido, estado: projeto.estado,
      gestor_id: projeto.gestorId || null, atualizado_em: new Date().toISOString()
    };
    let r = await supabaseClient.from('projetos').upsert(linhaProjeto);
    if (r.error) throw r.error;

    r = await supabaseClient.from('tarefas').delete().eq('projeto_id', projeto.id);
    if (r.error) throw r.error;
    const tarefas = projeto.tarefas || [];
    if (tarefas.length) {
      // Duas passagens por causa da auto-referência tarefas.parent_id → tarefas.id: insere tudo
      // com parent_id nulo primeiro (ordem do array não importa), só depois liga cada tarefa à
      // sua mãe — evita ter de ordenar topologicamente a árvore antes de gravar.
      const linhasBase = tarefas.map((t, idx) => ({
        id: t.id, projeto_id: projeto.id, parent_id: null, nome: t.nome, ordem: idx,
        inicio: t.inicio, fim: t.fim, progresso: t.progresso, predecessores: t.predecessores || [],
        negrito: !!t.negrito, italico: !!t.italico, cor: t.cor || null
      }));
      r = await supabaseClient.from('tarefas').upsert(linhasBase);
      if (r.error) throw r.error;

      const comPai = tarefas.filter(t => t.parentId);
      if (comPai.length) {
        const resultados = await Promise.all(
          comPai.map(t => supabaseClient.from('tarefas').update({ parent_id: t.parentId }).eq('id', t.id))
        );
        const falhou = resultados.find(x => x.error);
        if (falhou) throw falhou.error;
      }

      const linhasTR = [];
      tarefas.forEach(t => {
        (t.recursoIds || []).forEach(rid => {
          const horas = (t.alocacoesHoras && t.alocacoesHoras[rid] !== undefined) ? t.alocacoesHoras[rid] : null;
          linhasTR.push({ tarefa_id: t.id, recurso_id: rid, horas });
        });
      });
      if (linhasTR.length) {
        r = await supabaseClient.from('tarefa_recursos').upsert(linhasTR, { onConflict: 'tarefa_id,recurso_id' });
        if (r.error) throw r.error;
      }
    }

    r = await supabaseClient.from('faturas').delete().eq('projeto_id', projeto.id);
    if (r.error) throw r.error;
    const faturas = projeto.faturas || [];
    if (faturas.length) {
      const linhasFat = faturas.map(f => ({
        id: f.id, projeto_id: projeto.id, data_prevista: f.dataPrevista || null, tipo: f.tipo,
        percentagem: f.percentagem, valor: f.valor, emitida: !!f.emitida,
        data_emissao: f.dataEmissao || null, emitido_por: f.emitidoPor, numero_registo: f.numeroRegisto
      }));
      r = await supabaseClient.from('faturas').upsert(linhasFat);
      if (r.error) throw r.error;
    }

    // "proximos_passos" referencia "pontos_situacao" — apaga-se primeiro (não deixa fk pendurada
    // por um instante) e insere-se depois de "pontos_situacao" já lá estar.
    r = await supabaseClient.from('proximos_passos').delete().eq('projeto_id', projeto.id);
    if (r.error) throw r.error;
    r = await supabaseClient.from('pontos_situacao').delete().eq('projeto_id', projeto.id);
    if (r.error) throw r.error;

    const pontosSituacao = projeto.pontosSituacao || [];
    if (pontosSituacao.length) {
      const linhasPS = pontosSituacao.map(ps => ({
        id: ps.id, projeto_id: projeto.id, data: ps.data, feedback: ps.feedback,
        criado_por: ps.criadoPor || null, criado_em: ps.criadoEm
      }));
      r = await supabaseClient.from('pontos_situacao').insert(linhasPS);
      if (r.error) throw r.error;
    }

    const proximosPassos = projeto.proximosPassos || [];
    if (proximosPassos.length) {
      const linhasPP = proximosPassos.map(pp => ({
        id: pp.id, projeto_id: projeto.id, tarefa_id: pp.tarefaId || null, ponto_situacao_id: pp.pontoSituacaoId || null,
        responsavel_id: pp.responsavelId || null, data_prevista: pp.dataPrevista || null, data_real: pp.dataReal || null,
        descricao: pp.descricao, estado: pp.estado, notas: pp.notas, fechado: !!pp.fechado, fechado_em: pp.fechadoEm || null,
        criado_por: pp.criadoPor || null, criado_em: pp.criadoEm, atualizado_em: pp.atualizadoEm
      }));
      r = await supabaseClient.from('proximos_passos').insert(linhasPP);
      if (r.error) throw r.error;
    }
  },

  // ---------- Leitura: reconstrói App.state a partir das 10 tabelas ----------
  async carregarDeSupabase() {
    const [eq, rec, fer, aus, reg, proj, tar, tr, fat, ps, pp] = await Promise.all([
      supabaseClient.from('equipas').select('*'),
      supabaseClient.from('recursos').select('*'),
      supabaseClient.from('feriados').select('*'),
      supabaseClient.from('ausencias').select('*'),
      supabaseClient.from('registos').select('*'),
      supabaseClient.from('projetos').select('*'),
      supabaseClient.from('tarefas').select('*').order('ordem', { ascending: true }),
      supabaseClient.from('tarefa_recursos').select('*'),
      supabaseClient.from('faturas').select('*'),
      supabaseClient.from('pontos_situacao').select('*'),
      supabaseClient.from('proximos_passos').select('*')
    ]);
    [eq, rec, fer, aus, reg, proj, tar, tr, fat, ps, pp].forEach(r => { if (r.error) throw r.error; });

    const equipas = eq.data.map(r => ({ id: r.id, nome: r.nome }));
    const recursos = rec.data.map(r => ({
      id: r.id, nome: r.nome, email: r.email || '', papel: r.papel, equipaId: r.equipa_id,
      precoCusto: Number(r.preco_custo) || 0, precoVenda: Number(r.preco_venda) || 0,
      authUserId: r.auth_user_id, acesso: r.acesso
    }));
    // "Utilizadores" não é uma tabela à parte — é só os recursos que já têm conta na plataforma
    // (auth_user_id preenchido), vistos com a forma que o resto da app já espera (perfilAtual,
    // seletor de Gestor, etc.).
    const utilizadores = recursos.filter(r => r.authUserId).map(r => ({
      id: r.authUserId, nome: r.nome, email: r.email, papel: r.acesso, recursoId: r.id
    }));
    const feriados = fer.data.map(r => ({ id: r.id, data: r.data, descricao: r.descricao }));
    const ausencias = aus.data.map(r => ({
      id: r.id, recursoId: r.recurso_id, dataInicio: r.data_inicio, dataFim: r.data_fim, tipo: r.tipo, notas: r.notas
    }));
    const registos = reg.data.map(r => ({
      id: r.id, data: r.data, pessoa: r.pessoa, projetoIdInterno: r.projeto_id_interno, projetoId: r.projeto_id,
      projetoNome: r.projeto_nome, cliente: r.cliente || '', tarefaNome: r.tarefa_nome, horas: Number(r.horas) || 0,
      notas: r.notas, origem: r.origem, userId: r.user_id, submetidoEm: r.submetido_em
    }));

    const projetos = {};
    proj.data.forEach(p => {
      projetos[p.id] = {
        id: p.id, idInterno: p.id_interno, nome: p.nome, cliente: p.cliente, descricao: p.descricao,
        dataInicio: p.data_inicio, dataFim: p.data_fim, horasVendidas: Number(p.horas_vendidas) || 0,
        valorVendido: Number(p.valor_vendido) || 0, estado: p.estado, gestorId: p.gestor_id,
        versao: p.atualizado_em || new Date().toISOString(), tarefas: [], faturas: [],
        pontosSituacao: [], proximosPassos: []
      };
    });
    const tarefaPorId = {};
    tar.data.forEach(t => {
      const tarefa = {
        id: t.id, parentId: t.parent_id, nome: t.nome, inicio: t.inicio, fim: t.fim,
        progresso: t.progresso, recursoIds: [], alocacoesHoras: {}, predecessores: t.predecessores || [],
        negrito: !!t.negrito, italico: !!t.italico, cor: t.cor || null
      };
      tarefaPorId[t.id] = tarefa;
      if (projetos[t.projeto_id]) projetos[t.projeto_id].tarefas.push(tarefa);
    });
    tr.data.forEach(row => {
      const tarefa = tarefaPorId[row.tarefa_id];
      if (!tarefa) return;
      tarefa.recursoIds.push(row.recurso_id);
      if (row.horas !== null && row.horas !== undefined) tarefa.alocacoesHoras[row.recurso_id] = Number(row.horas);
    });
    fat.data.forEach(f => {
      if (!projetos[f.projeto_id]) return;
      projetos[f.projeto_id].faturas.push({
        id: f.id, dataPrevista: f.data_prevista, tipo: f.tipo, percentagem: Number(f.percentagem) || 0,
        valor: Number(f.valor) || 0, emitida: !!f.emitida, dataEmissao: f.data_emissao || '',
        emitidoPor: f.emitido_por, numeroRegisto: f.numero_registo
      });
    });
    ps.data.forEach(p => {
      if (!projetos[p.projeto_id]) return;
      projetos[p.projeto_id].pontosSituacao.push({
        id: p.id, data: p.data, feedback: p.feedback, criadoPor: p.criado_por, criadoEm: p.criado_em
      });
    });
    pp.data.forEach(p => {
      if (!projetos[p.projeto_id]) return;
      projetos[p.projeto_id].proximosPassos.push({
        id: p.id, tarefaId: p.tarefa_id, pontoSituacaoId: p.ponto_situacao_id, responsavelId: p.responsavel_id,
        dataPrevista: p.data_prevista, dataReal: p.data_real,
        descricao: p.descricao, estado: p.estado, notas: p.notas, fechado: !!p.fechado, fechadoEm: p.fechado_em,
        criadoPor: p.criado_por, criadoEm: p.criado_em, atualizadoEm: p.atualizado_em
      });
    });

    App.state = { equipas, recursos, feriados, ausencias, registos, projetos, utilizadores, projetoAtivoId: Object.keys(projetos)[0] || null };
  },

  // ---------- Edição direta de acesso (fora do fluxo de diff/undo do resto da app) ----------
  // Usado no separador Pessoas para promover/despromover alguém a Administrador. "id" é o
  // auth_user_id (o id que o resto da app trata como "id do utilizador"), não o id do recurso.
  // Não faz sentido ter "desfazer" para isto, por isso escreve logo no Supabase em vez de passar
  // por persist()/sincronizarComSupabase().
  async atualizarUtilizador(id, campos) {
    if (!('papel' in campos)) return;
    const { error } = await supabaseClient.from('recursos').update({ acesso: campos.papel }).eq('auth_user_id', id);
    if (error) throw error;
  },

  // ---------- "A minha conta" (nome/password próprios) ----------
  // "nome" vive em dois sítios: user_metadata (é o que a topbar mostra, via Auth.atualizarUI) e
  // recursos.nome (é o que o resto da app usa — tabelas, seletor de gestor, etc.). Escrevem-se os
  // dois; a password só se mexe se vier preenchida.
  async atualizarConta({ nome, password, recursoId }) {
    const payloadAuth = {};
    if (password) payloadAuth.password = password;
    if (nome) payloadAuth.data = { nome };
    if (Object.keys(payloadAuth).length) {
      const { error } = await supabaseClient.auth.updateUser(payloadAuth);
      if (error) throw error;
    }
    if (nome && recursoId) {
      const { error } = await supabaseClient.from('recursos').update({ nome }).eq('id', recursoId);
      if (error) throw error;
    }
  },

  // ---------- Edição direta de um registo já existente (só Administrador) ----------
  // Registos, por design, só entram/saem da sincronização normal como "novo" ou "apagado"
  // (ver sincronizarListaSimples/sincronizarRegistos) — editar um campo de um já existente nunca
  // passou por aí, por isso escreve logo na Supabase, como atualizarUtilizador/atualizarConta.
  async atualizarRegisto(id, campos) {
    const { error } = await supabaseClient.from('registos').update(campos).eq('id', id);
    if (error) throw error;
  }
};

// Backup manual dos dados (a app não tem acesso ao backup automático pago do Supabase).
// Gera, a partir do App.state já carregado (é o mesmo que está na Supabase, sincronizado em
// tempo real — não faz falta ir lá buscar outra vez), dois ficheiros complementares:
//
//  1) Um ".sql" com "insert into ..." para todas as tabelas, na ordem certa das referências
//     (chaves estrangeiras) — é este que serve para RECRIAR a base de dados: corre-se no SQL
//     Editor do Supabase, sobre um projeto novo onde já se tenha corrido o supabase/schema.sql
//     (a estrutura em si já está guardada nesse ficheiro, versionado no repositório — não muda
//     de projeto para projeto, só os dados mudam).
//  2) Um ".xlsx" com uma folha por tabela, só para leitura/auditoria humana — mais fácil de abrir
//     e verificar visualmente do que o .sql, mas não é o caminho de restauro (datas/jsonb/etc.
//     perdem fidelidade a ir e voltar do Excel).
//
// Fora do backup, por decisão consciente: contas de login (auth.users, gerido pelo Supabase Auth,
// não é uma tabela normal) — cada pessoa tem de voltar a criar conta com o MESMO email; o trigger
// handle_new_user (ver schema.sql) liga-a automaticamente ao recurso já existente por email, sem
// passo manual. Por isso "recursos.auth_user_id" e "registos.user_id" saem sempre em branco.
const Backup = {
  TABELAS_EM_ORDEM: [
    'equipas', 'recursos', 'feriados', 'ausencias', 'projetos', 'tarefas', 'tarefa_recursos',
    'faturas', 'pontos_situacao', 'proximos_passos', 'registos', 'reservas_viatura'
  ],
  // Composta pelas mesmas transformações já usadas em js/sync.js para escrever cada tabela — se o
  // formato de alguma tabela mudar lá, tem de mudar aqui também (é o preço de não haver um único
  // sítio partilhado; mantém-se por agora porque sync.js já não pode "exportar" isto sem mexer no
  // seu próprio fluxo de diff/undo).
  construirLinhasPorTabela(state) {
    const linhas = {};

    linhas.equipas = (state.equipas || []).map(eq => ({
      id: eq.id, nome: eq.nome, departamento: eq.departamento || '', team_leader: eq.teamLeader || '', diretor: eq.diretor || ''
    }));

    linhas.recursos = (state.recursos || []).map(r => ({
      id: r.id, nome: r.nome, email: r.email || '', papel: r.papel || '', equipa_id: r.equipaId || null,
      preco_custo: r.precoCusto || 0, preco_venda: r.precoVenda || 0,
      auth_user_id: null, // ver nota grande no topo do ficheiro — religa-se sozinho por email
      acesso: r.acesso || 'user'
    }));

    linhas.feriados = (state.feriados || []).map(f => ({ id: f.id, data: f.data, descricao: f.descricao || '' }));

    linhas.ausencias = (state.ausencias || []).map(a => ({
      id: a.id, recurso_id: a.recursoId, data_inicio: a.dataInicio, data_fim: a.dataFim,
      tipo: a.tipo || 'Férias', notas: a.notas || ''
    }));

    const projetos = Object.values(state.projetos || {});
    linhas.projetos = projetos.map(p => ({
      id: p.id, id_interno: p.idInterno || '', nome: p.nome, cliente: p.cliente || '', descricao: p.descricao || '',
      data_inicio: p.dataInicio || null, data_fim: p.dataFim || null, horas_vendidas: p.horasVendidas || 0,
      valor_vendido: p.valorVendido || 0, estado: p.estado || 'Por iniciar', gestor_id: p.gestorId || null,
      atualizado_em: p.versao || null
    }));

    linhas.tarefas = [];
    linhas.tarefa_recursos = [];
    projetos.forEach(p => {
      (p.tarefas || []).forEach((t, idx) => {
        linhas.tarefas.push({
          id: t.id, projeto_id: p.id, parent_id: t.parentId || null, nome: t.nome, inicio: t.inicio, fim: t.fim,
          progresso: t.progresso || 0, ordem: idx, predecessores: JSON.stringify(t.predecessores || []),
          negrito: !!t.negrito, italico: !!t.italico, cor: t.cor || null
        });
        (t.recursoIds || []).forEach(rid => {
          const horas = (t.alocacoesHoras && t.alocacoesHoras[rid] !== undefined) ? t.alocacoesHoras[rid] : null;
          linhas.tarefa_recursos.push({ tarefa_id: t.id, recurso_id: rid, horas });
        });
      });
    });

    linhas.faturas = [];
    projetos.forEach(p => (p.faturas || []).forEach(f => linhas.faturas.push({
      id: f.id, projeto_id: p.id, data_prevista: f.dataPrevista || null, tipo: f.tipo || 'percentagem',
      percentagem: f.percentagem || 0, valor: f.valor || 0, emitida: !!f.emitida,
      data_emissao: f.dataEmissao || null, emitido_por: f.emitidoPor || '', numero_registo: f.numeroRegisto || ''
    })));

    linhas.registos = (state.registos || []).map(r => ({
      id: r.id, data: r.data, pessoa: r.pessoa, projeto_id: r.projetoId || null,
      projeto_id_interno: r.projetoIdInterno || '', projeto_nome: r.projetoNome || '', tarefa_nome: r.tarefaNome || '',
      horas: r.horas, notas: r.notas || '', origem: r.origem || 'app',
      user_id: null, // ver nota grande no topo do ficheiro
      submetido_em: r.submetidoEm || null, cliente: r.cliente || ''
    }));

    linhas.pontos_situacao = [];
    projetos.forEach(p => (p.pontosSituacao || []).forEach(ps => linhas.pontos_situacao.push({
      id: ps.id, projeto_id: p.id, data: ps.data, feedback: ps.feedback || '',
      criado_por: ps.criadoPor || null, criado_em: ps.criadoEm || null
    })));

    linhas.proximos_passos = [];
    projetos.forEach(p => (p.proximosPassos || []).forEach(pp => linhas.proximos_passos.push({
      id: pp.id, projeto_id: p.id, tarefa_id: pp.tarefaId || null, ponto_situacao_id: pp.pontoSituacaoId || null,
      responsavel_id: pp.responsavelId || null, data_prevista: pp.dataPrevista || null, data_real: pp.dataReal || null,
      descricao: pp.descricao || '', estado: pp.estado || 'aberto', notas: pp.notas || '', fechado: !!pp.fechado,
      fechado_em: pp.fechadoEm || null, criado_por: pp.criadoPor || null, criado_em: pp.criadoEm || null,
      atualizado_em: pp.atualizadoEm || null
    })));

    linhas.reservas_viatura = (state.reservasViatura || []).map(rv => ({
      id: rv.id, projeto_id: rv.projetoId || null, projeto_nome: rv.projetoNome || '',
      requisitante_id: rv.requisitanteId || null, requisitante_nome: rv.requisitanteNome || '',
      area: rv.area || '', chefia: rv.chefia || '', gestor: rv.gestor || '', justificacao: rv.justificacao || '',
      data_pedido: rv.dataPedido, data_inicio: rv.dataInicio, hora_inicio: rv.horaInicio || '',
      data_fim: rv.dataFim, hora_fim: rv.horaFim || '', nome_ficheiro: rv.nomeFicheiro || '', criado_em: rv.criadoEm || null
    }));

    const cfg = state.configuracoes || {};
    linhas.configuracoes = [{
      id: 1, email_viaturas_1: cfg.emailViaturas1 || '', email_viaturas_2: cfg.emailViaturas2 || '',
      ocupacao_limite_baixo: cfg.ocupacaoLimiteBaixo ?? 60, ocupacao_limite_alto: cfg.ocupacaoLimiteAlto ?? 80,
      ocupacao_limite_critico: cfg.ocupacaoLimiteCritico ?? 100
    }];

    return linhas;
  },

  sqlValor(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
  },
  linhaParaInsert(tabela, linha, onConflict) {
    const colunas = Object.keys(linha);
    const valores = colunas.map(c => {
      if (tabela === 'tarefas' && c === 'predecessores') return `'${String(linha[c]).replace(/'/g, "''")}'::jsonb`;
      return this.sqlValor(linha[c]);
    });
    return `insert into public.${tabela} (${colunas.join(', ')}) values (${valores.join(', ')}) on conflict ${onConflict} do nothing;`;
  },

  // Devolve o texto completo do ".sql" de restauro — só dados, a estrutura já vem do
  // supabase/schema.sql (versionado no repositório, corre-se esse primeiro numa base de dados nova).
  gerarSQL(state) {
    const linhas = this.construirLinhasPorTabela(state);
    const agora = new Date().toISOString();
    const partes = [
      '-- ============================================================================',
      `-- Backup de DADOS do GestorProjetos — gerado em ${agora}`,
      '-- ============================================================================',
      '-- Como restaurar:',
      '--   1) Num projeto Supabase novo (ou a limpar), corre primeiro o supabase/schema.sql',
      '--      inteiro (cria as tabelas, tudo vazio) — está no repositório do GitHub.',
      '--   2) Cola este ficheiro inteiro no SQL Editor e corre.',
      '--   3) Cada pessoa tem de criar conta de novo (mesmo email) — liga-se sozinha ao',
      "--      'recurso' já aqui restaurado (ver handle_new_user em schema.sql). O primeiro",
      '--      Administrador tem de se promover à mão (ver o comentário no fim do schema.sql).',
      '-- Seguro correr duas vezes (todos os inserts têm "on conflict ... do nothing").',
      '-- ============================================================================',
      '',
      'begin;'
    ];

    this.TABELAS_EM_ORDEM.forEach(tabela => {
      const linhasTabela = linhas[tabela] || [];
      if (!linhasTabela.length) return;
      partes.push(`\n-- ---------- ${tabela} (${linhasTabela.length} linha(s)) ----------`);
      const onConflict = tabela === 'tarefa_recursos' ? '(tarefa_id, recurso_id)' : '(id)';
      linhasTabela.forEach(l => {
        // As tarefas entram sem parent_id (2ª passagem mais abaixo liga pai/filho) — evita
        // depender da ordem de inserção entre uma tarefa-mãe e as suas subtarefas.
        const linhaParaInserir = tabela === 'tarefas' ? Object.assign({}, l, { parent_id: null }) : l;
        partes.push(this.linhaParaInsert(tabela, linhaParaInserir, onConflict));
      });
    });

    const tarefasComPai = (linhas.tarefas || []).filter(t => t.parent_id);
    if (tarefasComPai.length) {
      partes.push(`\n-- ---------- tarefas: liga parent_id (2ª passagem) ----------`);
      tarefasComPai.forEach(t => {
        partes.push(`update public.tarefas set parent_id = ${this.sqlValor(t.parent_id)} where id = ${this.sqlValor(t.id)};`);
      });
    }

    const cfg = linhas.configuracoes[0];
    partes.push(`\n-- ---------- configuracoes (linha única, id=1 — já existe por omissão, por isso "update") ----------`);
    partes.push(
      `update public.configuracoes set email_viaturas_1 = ${this.sqlValor(cfg.email_viaturas_1)}, ` +
      `email_viaturas_2 = ${this.sqlValor(cfg.email_viaturas_2)}, ocupacao_limite_baixo = ${this.sqlValor(cfg.ocupacao_limite_baixo)}, ` +
      `ocupacao_limite_alto = ${this.sqlValor(cfg.ocupacao_limite_alto)}, ocupacao_limite_critico = ${this.sqlValor(cfg.ocupacao_limite_critico)} where id = 1;`
    );

    partes.push('\ncommit;');
    return partes.join('\n');
  },

  // Workbook .xlsx com uma folha por tabela — só para leitura/auditoria, ver nota no topo.
  gerarExcelBlob(state) {
    const linhas = this.construirLinhasPorTabela(state);
    const wb = XLSX.utils.book_new();
    this.TABELAS_EM_ORDEM.concat(['configuracoes']).forEach(tabela => {
      const dados = linhas[tabela] || [];
      const ws = XLSX.utils.json_to_sheet(dados.length ? dados : [{}]);
      XLSX.utils.book_append_sheet(wb, ws, tabela.substring(0, 31));
    });
    const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
};

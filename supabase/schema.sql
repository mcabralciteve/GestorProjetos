-- ============================================================================
-- GestorProjetos — esquema da base de dados (Supabase / Postgres)
-- ============================================================================
-- Como aplicar: Supabase Dashboard -> SQL Editor -> New query -> cola este
-- ficheiro inteiro -> Run. Pode ser corrido de novo em segurança (usa
-- "if not exists" / "or replace" em todo o lado), incluindo a migração
-- pontual de "profiles" para "recursos" mais abaixo (só corre uma vez).
--
-- Modelo: todas as tabelas ficam acessíveis a qualquer utilizador autenticado
-- (ler + escrever tudo) — é a opção "por agora todos veem/editam tudo".
-- Mais tarde dá para apertar isto por projeto/equipa sem mudar a estrutura,
-- só as políticas de RLS abaixo.
-- ============================================================================

-- ---------- Equipas ----------
-- "unidade" (Área/Unidade) é sinónimo do nome da equipa — não é uma coluna à parte, usa-se
-- sempre equipas.nome (DCS, ROB, DPC, etc. já SÃO as unidades/áreas). "departamento" é um nível
-- acima da Área — várias equipas/áreas podem pertencer ao mesmo departamento — e é esse o valor
-- que sai impresso no Mapa de Despesas da Reserva de Viatura (campo "Área/Unidade" do formulário
-- em papel refere-se, na prática, ao Departamento, não à Área/equipa). "diretor" é sempre o
-- diretor DESSA área — usado como "Chefia" (obrigatória) no mesmo formulário. "diretor" e
-- "departamento" já vêm com o valor de hoje por omissão só para poupar trabalho ao Administrador
-- ao criar equipas novas (continuam editáveis); "team_leader" fica sem omissão — é mesmo por
-- equipa, sem valor razoável para adivinhar à partida. Sem valor conhecido para "departamento" da
-- equipa DCS já existente — fica em branco, o Administrador preenche em Configurações → Pessoas.
create table if not exists public.equipas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  departamento text not null default '',
  team_leader text not null default '',
  diretor text not null default 'João Oliveira'
);
alter table public.equipas drop column if exists unidade;
alter table public.equipas add column if not exists departamento text not null default '';
alter table public.equipas add column if not exists team_leader text not null default '';
alter table public.equipas add column if not exists diretor text not null default 'João Oliveira';
-- A equipa DCS já existia antes destas colunas — a omissão da coluna já lhe deu o Diretor certo ao
-- adicionar a coluna, só falta o Team Leader (sem omissão nenhuma a dar).
update public.equipas set team_leader = 'Milton Cabral' where nome = 'DCS' and team_leader = '';

-- ---------- Recursos (pessoas) ----------
-- Tabela única para todas as pessoas: consultores/gestores puramente de custo/capacidade (sem
-- conta) e utilizadores da plataforma (com conta) são a MESMA linha — não há uma tabela de
-- "utilizadores" à parte. "auth_user_id" fica vazio enquanto a pessoa não cria conta; assim que
-- cria (ver handle_new_user), liga-se sozinho por email. "acesso" só é relevante para quem já tem
-- conta (admin/user); "papel" é o cargo/função da pessoa (texto livre, ex.: "Dev", "PM").
create table if not exists public.recursos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null default '',
  papel text not null default '',
  equipa_id uuid references public.equipas(id) on delete set null,
  preco_custo numeric not null default 0,
  preco_venda numeric not null default 0,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  acesso text not null default 'user' check (acesso in ('admin', 'user'))
);

alter table public.recursos add column if not exists email text not null default '';
alter table public.recursos add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.recursos add column if not exists acesso text not null default 'user';
alter table public.recursos drop constraint if exists recursos_acesso_check;
alter table public.recursos add constraint recursos_acesso_check check (acesso in ('admin', 'user'));

-- "equipas.lider_id" substitui "team_leader" (texto livre, acima) por uma referência real a
-- recursos — só texto não dava para usar em permissões (o mesmo problema de "casar por nome" já
-- resolvido para tarefas/registos nesta app: um team_leader que mude de nome perdia a associação).
-- "team_leader" fica na tabela, sem ser lido pela app a partir de agora, só para não perder o
-- histórico do que lá estava. Backfill automático: só resolve os casos em que o nome já bate certo
-- com um recurso existente; os que não baterem ficam por preencher — o Administrador atribui à mão
-- em Configurações → Pessoas → Equipas.
alter table public.equipas add column if not exists lider_id uuid references public.recursos(id) on delete set null;
update public.equipas eq set lider_id = r.id
  from public.recursos r
  where eq.lider_id is null and eq.team_leader <> '' and r.nome = eq.team_leader;

-- ---------- Histórico de equipa de cada recurso ----------
-- "recursos.equipa_id" só guarda a equipa ATUAL — sem isto, um projeto que atravesse a mudança de
-- equipa de um consultor via essa mudança "reescrever" retroativamente as horas antigas dele para a
-- equipa nova (grave para o Acompanhamento Financeiro por equipa/departamento, que reparte proveito
-- reconhecido/faturado pelas horas de cada equipa: as contas passavam a bater mal a partir do dia
-- da mudança). Uma linha por período: data_fim NULL = ainda em vigor. data_inicio NULL = "desde
-- sempre" (só a primeira linha de cada pessoa, criada automaticamente na primeira mudança de
-- equipa registada depois desta tabela existir — ver App.registarMudancaEquipa/
-- equipaIdDoRecursoEm). Pessoas que nunca mudaram de equipa não têm nenhuma linha aqui: assume-se
-- que sempre estiveram na equipa atual (não há como saber melhor sem este histórico).
create table if not exists public.historico_equipas (
  id uuid primary key default gen_random_uuid(),
  recurso_id uuid not null references public.recursos(id) on delete cascade,
  equipa_id uuid references public.equipas(id) on delete set null,
  data_inicio date,
  data_fim date
);
create index if not exists historico_equipas_recurso_id_idx on public.historico_equipas(recurso_id);

-- ---------- Departamentos ----------
-- Um departamento agrupa várias equipas ("unidades") — uma unidade só pode pertencer a UM
-- departamento (equipas.departamento_id). Cada departamento tem um Diretor (recursos.id), com
-- acesso equivalente a admin mas só dentro do seu departamento (ver App.souDiretorDe/
-- recursosDaMinhaLideranca — um Diretor é tratado como "líder" de todas as equipas do seu
-- departamento ao mesmo tempo). Antes disto, "departamento" e "diretor" eram só texto livre POR
-- EQUIPA (podiam divergir entre equipas do "mesmo" departamento, sem ligação nenhuma a um login) —
-- a partir de agora são uma entidade própria, com referência real.
create table if not exists public.departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  diretor_id uuid references public.recursos(id) on delete set null
);
-- Backfill automático a partir do texto livre já existente: um departamento novo por cada nome
-- distinto (não vazio) em equipas.departamento; o diretor só fica preenchido quando o texto já
-- bate certo com um recurso existente — os restantes casos, o Administrador atribui à mão no novo
-- ecrã "Departamentos" (Configurações → Pessoas).
insert into public.departamentos (nome)
select distinct eq.departamento from public.equipas eq
where eq.departamento <> '' and not exists (
  select 1 from public.departamentos d where d.nome = eq.departamento
);
update public.departamentos d set diretor_id = r.id
from public.equipas eq
join public.recursos r on r.nome = eq.diretor
where d.diretor_id is null and eq.departamento = d.nome and eq.diretor <> '';

alter table public.equipas add column if not exists departamento_id uuid references public.departamentos(id) on delete set null;
update public.equipas eq set departamento_id = d.id
  from public.departamentos d
  where eq.departamento_id is null and eq.departamento = d.nome;

-- ---------- Feriados ----------
create table if not exists public.feriados (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  descricao text not null default ''
);

-- ---------- Ausências ----------
create table if not exists public.ausencias (
  id uuid primary key default gen_random_uuid(),
  recurso_id uuid not null references public.recursos(id) on delete cascade,
  data_inicio date not null,
  data_fim date not null,
  tipo text not null default 'Férias',
  notas text not null default ''
);
-- Aprovação: uma ausência criada pela própria pessoa nasce "pendente" (só o Team Leader/Diretor/
-- Administrador aprova); criada por quem já a pode aprovar nasce "aprovada" — ver App.adicionarAusencia.
-- Registos anteriores a esta coluna ficam "aprovada" (já contavam como indisponibilidade, sem passar
-- por nenhum pedido — não faz sentido pedirem-se a si próprios agora).
alter table public.ausencias add column if not exists estado text not null default 'aprovada';
alter table public.ausencias drop constraint if exists ausencias_estado_check;
alter table public.ausencias add constraint ausencias_estado_check check (estado in ('pendente','aprovada','rejeitada'));
alter table public.ausencias add column if not exists criado_por uuid references public.recursos(id) on delete set null;
alter table public.ausencias add column if not exists decidido_por uuid references public.recursos(id) on delete set null;
alter table public.ausencias add column if not exists decidido_em timestamptz;
alter table public.ausencias add column if not exists motivo_rejeicao text not null default '';

-- ---------- Projetos ----------
create table if not exists public.projetos (
  id uuid primary key default gen_random_uuid(),
  id_interno text not null default '',
  nome text not null,
  cliente text not null default '',
  descricao text not null default '',
  data_inicio date,
  data_fim date,
  horas_vendidas numeric not null default 0,
  valor_vendido numeric not null default 0,
  estado text not null default 'Por iniciar',
  gestor_id uuid references public.recursos(id) on delete set null, -- gestor de projeto, atribuído pelo administrador
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.projetos add column if not exists gestor_id uuid references public.recursos(id) on delete set null;
-- Suspender/fechar um projeto (só o Administrador — ver App.possoEditarProjeto/atualizarProjetoAtivo):
-- congela-o para toda a gente (ninguém edita tarefas/faturas/next steps nem regista horas nele, e
-- as suas tarefas deixam de contar para a Capacidade/Alocações de quem lá está), sem o eliminar nem
-- mexer no campo "estado" (que continua a descrever a fase do projeto, coisas diferentes).
alter table public.projetos add column if not exists ativo boolean not null default true;
-- Equipa "dona" do projeto (editável, só Administrador — ver App.renderGestorConsultores) — usada
-- só para pré-selecionar Departamento/Equipa no modal "Associar consultores" (ver
-- App.abrirModalRecursos), para não ter de se escolher isso à mão sempre que se associa alguém.
-- Todos os projetos já existentes arrancam associados à equipa "DCS" (pedido explícito do
-- utilizador); ajusta manualmente os que não forem mesmo dessa equipa, no cartão "Dados do
-- Projeto" do Gantt. Se a equipa "DCS" não existir com este nome exato, a atualização abaixo não
-- faz nada (fica null em todos, tal como ficaria sem esta migração).
alter table public.projetos add column if not exists equipa_id uuid references public.equipas(id) on delete set null;
update public.projetos set equipa_id = (select id from public.equipas where nome = 'DCS' limit 1)
where equipa_id is null;

-- Tipo da referência (id_interno): 'giaf' = referência do sistema de faturação (escrita à mão);
-- 'interno' = projeto sem GIAF, com código gerado pela app (INT-AAAA-NNN). Os 6 internos que já
-- existiam (2026/001 a 2026/006) são marcados 'interno' UMA ÚNICA VEZ — só na execução que cria a
-- coluna — para correr este ficheiro outra vez nunca repor o tipo de um projeto entretanto mudado.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projetos' and column_name = 'tipo_referencia') then
    alter table public.projetos add column tipo_referencia text not null default 'giaf' check (tipo_referencia in ('giaf', 'interno'));
    update public.projetos set tipo_referencia = 'interno'
    where id_interno in ('2026/001', '2026/002', '2026/003', '2026/004', '2026/005', '2026/006');
  end if;
end $$;

-- Consultor de um projeto não é uma lista à parte: é quem já tem o recurso ligado ao seu login
-- atribuído a alguma tarefa desse projeto (tabela "tarefa_recursos" já cobre isso).
drop table if exists public.projeto_consultores;

-- ---------- Tarefas ----------
-- "ordem" guarda a posição da tarefa na lista (a app usa-a para saber a ordem das tarefas-irmãs no
-- Gantt) — sem isto, o Postgres pode devolver as linhas por qualquer ordem física, que não reflete
-- reordenações feitas na app (Subir/Descer/Indentar/Promover não mudam nenhuma outra coluna).
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  parent_id uuid references public.tarefas(id) on delete cascade,
  nome text not null,
  inicio date not null,
  fim date not null,
  progresso int not null default 0,
  ordem int not null default 0,
  -- predecessoras guardadas como jsonb: [{"id": "<uuid da tarefa predecessora>", "tipo": "FS", "atraso": 0}, ...]
  predecessores jsonb not null default '[]'::jsonb
);
create index if not exists tarefas_projeto_id_idx on public.tarefas(projeto_id);
create index if not exists tarefas_parent_id_idx on public.tarefas(parent_id);

alter table public.tarefas add column if not exists ordem int not null default 0;
-- Formatação do rótulo no Gantt/tabela — só o nome inteiro (negrito/itálico/cor), não texto rico
-- dentro do nome.
alter table public.tarefas add column if not exists negrito boolean not null default false;
alter table public.tarefas add column if not exists italico boolean not null default false;
alter table public.tarefas add column if not exists cor text;

-- ---------- Alocação de recursos a tarefas (substitui "recursoIds" + "alocacoesHoras") ----------
create table if not exists public.tarefa_recursos (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  recurso_id uuid not null references public.recursos(id) on delete cascade,
  horas numeric, -- null = tempo inteiro (calculado a partir da duração da tarefa), como hoje na app
  primary key (tarefa_id, recurso_id)
);

-- ---------- Faturas ----------
create table if not exists public.faturas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  data_prevista date,
  tipo text not null default 'percentagem',
  percentagem numeric not null default 0,
  valor numeric not null default 0,
  emitida boolean not null default false,
  data_emissao date,
  emitido_por text not null default '',
  numero_registo text not null default ''
);
create index if not exists faturas_projeto_id_idx on public.faturas(projeto_id);

-- ---------- Registos de horas ----------
-- "user_id" substitui todo o fluxo de email/Power Automate: o registo já fica associado a quem
-- tem sessão iniciada no momento em que o submete.
create table if not exists public.registos (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  pessoa text not null,
  projeto_id uuid references public.projetos(id) on delete set null,
  projeto_id_interno text not null default '',
  projeto_nome text not null default '',
  tarefa_nome text not null default '',
  horas numeric not null,
  notas text not null default '',
  origem text not null default 'app',
  user_id uuid references auth.users(id) on delete set null,
  submetido_em timestamptz not null default now()
);
create index if not exists registos_projeto_id_idx on public.registos(projeto_id);
-- Cliente do projeto associado, copiado tal como projeto_nome/projeto_id_interno (denormalizado,
-- não é uma referência viva) — segue sempre o Projeto escolhido, nunca se edita à parte.
alter table public.registos add column if not exists cliente text not null default '';
-- Referência direta à tarefa (além de "tarefa_nome", que fica para pessoas/mostra) — usada para
-- somar com confiança "quantas horas já foram registadas nesta tarefa" (ver
-- Capacidade.horasRestantesTarefa/App.horasJaRegistadasTarefa), sem depender de o nome nunca mudar.
-- Nula em registos anteriores a este campo — para esses, o cálculo cai para trás no nome + projeto.
alter table public.registos add column if not exists tarefa_id uuid references public.tarefas(id) on delete set null;

-- ---------- Tipos de Trabalho (Registo do Dia) ----------
-- Categorias de como uma pessoa gasta o seu tempo, além de "Projeto" — que NÃO é uma linha desta
-- tabela: é um tipo especial tratado só no lado do cliente (App.TIPO_TRABALHO_PROJETO), sempre
-- disponível, correspondendo a tipo_trabalho_id = null em "registos" (o mesmo que já significava
-- "registo num projeto" antes desta tabela existir — por isso nenhum registo antigo precisa de
-- migração). Esta tabela só guarda os OUTROS tipos (Ausência justificada, Formação interna, etc.),
-- geridos pelo Administrador no separador "Tipos de Trabalho".
create table if not exists public.tipos_trabalho (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cor text not null default '#64748b',
  ativo boolean not null default true,
  ordem int not null default 0
);
-- Semente inicial (só insere se a tabela ainda estiver vazia — não repõe tipos entretanto apagados
-- ou renomeados pelo Administrador).
insert into public.tipos_trabalho (nome, cor, ordem)
select * from (values
  ('Ausência justificada', '#f59e0b', 0),
  ('Formação interna', '#10b981', 1),
  ('Atividade comercial', '#8b5cf6', 2),
  ('Administrativo/Interno', '#64748b', 3)
) as seed(nome, cor, ordem)
where not exists (select 1 from public.tipos_trabalho);
-- Um tipo com cria_ausencia=true não gera uma linha em "registos" (nunca pede horas/projeto): o
-- Registo do Dia cria/atualiza, por baixo, uma linha em "ausencias" (a mesma tabela que a
-- Capacidade já lê) com um período de dias em vez de uma duração — ver App.abrirModalBlocoDia
-- (campo tipo.criaAusencia) e App.abrirModalAusenciaDia. Nenhum tipo vem com isto ligado por
-- omissão — o Administrador ativa-o nos que fizerem sentido (ex.: "Ausência justificada", ou um
-- tipo novo "Férias"/"Baixa").
alter table public.tipos_trabalho add column if not exists cria_ausencia boolean not null default false;

-- Nulo = "Projeto" (ver nota acima). Preenchido = uma das linhas de tipos_trabalho.
alter table public.registos add column if not exists tipo_trabalho_id uuid references public.tipos_trabalho(id) on delete set null;

-- ---------- Acompanhamento: pontos de situação e next steps por projeto ----------
-- Pontos de situação: só o Administrador cria/edita/apaga (registados numa reunião com o Gestor).
-- Next steps: Administrador e Gestor do projeto podem criar (sempre associados a uma sessão de
-- ponto de situação, com um consultor do projeto como responsável); cada um só edita/apaga os que
-- criou, exceto o Administrador que pode editar/apagar qualquer um. Visível só para Administrador
-- + Gestor desse projeto — a app trata a visibilidade e a autoria, não há RLS reforçado (mesma
-- decisão do resto do esquema).
create table if not exists public.pontos_situacao (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  data date not null default current_date,
  feedback text not null default '',
  criado_por uuid references public.recursos(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists pontos_situacao_projeto_id_idx on public.pontos_situacao(projeto_id);

create table if not exists public.proximos_passos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  ponto_situacao_id uuid references public.pontos_situacao(id) on delete set null,
  descricao text not null,
  estado text not null default 'aberto' check (estado in ('aberto', 'em_curso', 'concluido')),
  notas text not null default '',
  fechado boolean not null default false,
  fechado_em timestamptz,
  criado_por uuid references public.recursos(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists proximos_passos_projeto_id_idx on public.proximos_passos(projeto_id);
-- Responsável pelo next step: um consultor do projeto (recurso já atribuído a alguma tarefa), não
-- necessariamente quem o criou (Administrador ou Gestor).
alter table public.proximos_passos add column if not exists responsavel_id uuid references public.recursos(id) on delete set null;
-- Data prevista de execução e data em que foi de facto executado, além do "estado" (fase) e do
-- "fechado" (revisto e arrumado pelo Administrador numa reunião seguinte) — são conceitos
-- independentes: um next step pode estar "concluído" sem ainda ter sido formalmente fechado.
alter table public.proximos_passos add column if not exists data_prevista date;
alter table public.proximos_passos add column if not exists data_real date;
alter table public.proximos_passos drop constraint if exists proximos_passos_estado_check;
alter table public.proximos_passos add constraint proximos_passos_estado_check check (estado in ('aberto', 'em_curso', 'concluido', 'abandonado'));

-- ============================================================================
-- Gravar de um projeto (tarefas/tarefa_recursos/faturas/pontos_situacao/
-- proximos_passos) numa ÚNICA transação — ver App/js/sync.js, Sync.sincronizarUmProjeto.
--
-- Antes disto, a app apagava e voltava a inserir cada tabela com pedidos SEPARADOS
-- (delete tarefas -> insert tarefas -> insert tarefa_recursos -> ...), sem nada a
-- juntá-los: se a ligação caísse ou a pessoa saísse a meio (ex.: com o Supabase
-- lento), o apagar já tinha sido gravado mas o reescrever não, perdendo dados de
-- forma permanente e silenciosa. Foi exatamente isto que aconteceu ao projeto
-- 2026/765 em 2026-09-28 — perdeu-se toda a "tarefa_recursos" desse projeto.
--
-- Uma função do Postgres corre sempre dentro de UMA transação implícita: ou tudo
-- o que está lá dentro fica gravado, ou (se cair a ligação, ou a função levantar
-- um erro) nada fica — nunca um resultado a meio. Chamada via supabaseClient.rpc(...).
-- ============================================================================
create or replace function public.gravar_filhos_projeto(
  p_projeto_id uuid,
  p_tarefas jsonb,           -- [{id,parent_id,nome,ordem,inicio,fim,progresso,predecessores,negrito,italico,cor}]
  p_tarefa_recursos jsonb,   -- [{tarefa_id,recurso_id,horas}]
  p_faturas jsonb,           -- [{id,data_prevista,tipo,percentagem,valor,emitida,data_emissao,emitido_por,numero_registo}]
  p_pontos_situacao jsonb,   -- [{id,data,feedback,criado_por,criado_em}]
  p_proximos_passos jsonb    -- [{id,tarefa_id,ponto_situacao_id,responsavel_id,data_prevista,data_real,descricao,estado,notas,fechado,fechado_em,criado_por,criado_em,atualizado_em}]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ordem de apagar: "proximos_passos" antes de "pontos_situacao" (referencia-o), e antes de
  -- "tarefas" (também o referencia) — nunca deixa uma FK pendurada, mesmo por um instante.
  delete from proximos_passos where projeto_id = p_projeto_id;
  delete from pontos_situacao where projeto_id = p_projeto_id;
  delete from faturas where projeto_id = p_projeto_id;
  delete from tarefas where projeto_id = p_projeto_id; -- cascata: apaga também tarefa_recursos

  -- Tarefas em duas fases (como já era do lado da app): parent_id fica de fora na primeira
  -- inserção porque pode referenciar outra tarefa do mesmo lote, ainda por criar.
  insert into tarefas (id, projeto_id, parent_id, nome, ordem, inicio, fim, progresso, predecessores, negrito, italico, cor)
  select
    (x->>'id')::uuid, p_projeto_id, null, x->>'nome', coalesce((x->>'ordem')::int, 0),
    (x->>'inicio')::date, (x->>'fim')::date, coalesce((x->>'progresso')::int, 0),
    coalesce(x->'predecessores', '[]'::jsonb),
    coalesce((x->>'negrito')::boolean, false), coalesce((x->>'italico')::boolean, false), x->>'cor'
  from jsonb_array_elements(coalesce(p_tarefas, '[]'::jsonb)) as x;

  update tarefas t set parent_id = (x->>'parent_id')::uuid
  from jsonb_array_elements(coalesce(p_tarefas, '[]'::jsonb)) as x
  where t.id = (x->>'id')::uuid and x->>'parent_id' is not null;

  insert into tarefa_recursos (tarefa_id, recurso_id, horas)
  select (x->>'tarefa_id')::uuid, (x->>'recurso_id')::uuid, nullif(x->>'horas', '')::numeric
  from jsonb_array_elements(coalesce(p_tarefa_recursos, '[]'::jsonb)) as x;

  insert into faturas (id, projeto_id, data_prevista, tipo, percentagem, valor, emitida, data_emissao, emitido_por, numero_registo)
  select
    (x->>'id')::uuid, p_projeto_id, nullif(x->>'data_prevista', '')::date, x->>'tipo',
    coalesce((x->>'percentagem')::numeric, 0), coalesce((x->>'valor')::numeric, 0), coalesce((x->>'emitida')::boolean, false),
    nullif(x->>'data_emissao', '')::date, coalesce(x->>'emitido_por', ''), coalesce(x->>'numero_registo', '')
  from jsonb_array_elements(coalesce(p_faturas, '[]'::jsonb)) as x;

  insert into pontos_situacao (id, projeto_id, data, feedback, criado_por, criado_em)
  select
    (x->>'id')::uuid, p_projeto_id, (x->>'data')::date, coalesce(x->>'feedback', ''),
    nullif(x->>'criado_por', '')::uuid, coalesce((x->>'criado_em')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_pontos_situacao, '[]'::jsonb)) as x;

  insert into proximos_passos (id, projeto_id, tarefa_id, ponto_situacao_id, responsavel_id, data_prevista, data_real,
    descricao, estado, notas, fechado, fechado_em, criado_por, criado_em, atualizado_em)
  select
    (x->>'id')::uuid, p_projeto_id, nullif(x->>'tarefa_id', '')::uuid, nullif(x->>'ponto_situacao_id', '')::uuid,
    nullif(x->>'responsavel_id', '')::uuid, nullif(x->>'data_prevista', '')::date, nullif(x->>'data_real', '')::date,
    x->>'descricao', coalesce(x->>'estado', 'aberto'), coalesce(x->>'notas', ''), coalesce((x->>'fechado')::boolean, false),
    nullif(x->>'fechado_em', '')::timestamptz, nullif(x->>'criado_por', '')::uuid,
    coalesce((x->>'criado_em')::timestamptz, now()), coalesce((x->>'atualizado_em')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_proximos_passos, '[]'::jsonb)) as x;
end;
$$;
grant execute on function public.gravar_filhos_projeto(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================================
-- Reserva de Viatura: qualquer utilizador envolvido num projeto pode pedir a
-- reserva de uma viatura para esse projeto. A app gera o Excel oficial
-- (DFRH-008/12) e abre o cliente de email; esta tabela é só o histórico do
-- que já foi pedido (auditoria/consulta), não faz parte do fluxo de geração.
-- ============================================================================
create table if not exists public.reservas_viatura (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references public.projetos(id) on delete set null,
  projeto_nome text not null default '',
  requisitante_id uuid references public.recursos(id) on delete set null,
  requisitante_nome text not null default '',
  area text not null default '',
  chefia text not null default '',
  gestor text not null default '',
  justificacao text not null default '',
  data_pedido date not null default current_date,
  data_inicio date not null,
  hora_inicio text not null default '',
  data_fim date not null,
  hora_fim text not null default '',
  nome_ficheiro text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists reservas_viatura_projeto_id_idx on public.reservas_viatura(projeto_id);

-- Configurações gerais da app (linha única, id fixo = 1), geridas pelo Administrador em
-- "Configurações → Definições": os dois emails da equipa de viaturas, e os 3 limiares (%) que
-- classificam a ocupação/alocação de cada pessoa em Capacidade e Alocações (ver
-- Capacidade.classeResumo em js/capacidade.js — é a única função que decide a cor; estes valores
-- só parametrizam os limites que ela usa). Abaixo de "baixo" = subutilizado (amarelo); entre
-- "baixo" e "alto" = confortável (verde); entre "alto" e "critico" = aviso (laranja); a partir de
-- "critico" = crítico (vermelho) — os mesmos limiares também classificam duplo agendamento e
-- conflitos de disponibilidade, que continuam a ter prioridade sobre a % pura (ver a função).
create table if not exists public.configuracoes (
  id int primary key default 1 check (id = 1),
  email_viaturas_1 text not null default '',
  email_viaturas_2 text not null default '',
  ocupacao_limite_baixo numeric not null default 60,
  ocupacao_limite_alto numeric not null default 80,
  ocupacao_limite_critico numeric not null default 100
);
alter table public.configuracoes add column if not exists ocupacao_limite_baixo numeric not null default 60;
alter table public.configuracoes add column if not exists ocupacao_limite_alto numeric not null default 80;
alter table public.configuracoes add column if not exists ocupacao_limite_critico numeric not null default 100;
-- Email de RH notificado (mailto, ver App.enviarEmailAusencia) sempre que uma ausência é criada,
-- alterada, aprovada, rejeitada ou eliminada — a par do Team Leader/Diretor da pessoa.
alter table public.configuracoes add column if not exists email_rh text not null default '';
-- Interruptor geral dos lembretes automáticos de horas em falta (função do servidor
-- supabase/functions/lembrete-horas) — desligado por omissão: nada é enviado até o Administrador o ligar.
alter table public.configuracoes add column if not exists lembrete_horas_ativo boolean not null default false;
-- Idem para a agenda do dia por email (função supabase/functions/lembrete-agenda).
alter table public.configuracoes add column if not exists lembrete_agenda_ativo boolean not null default false;
-- Cada pessoa pode desligar os lembretes automáticos que lhe são enviados ("A minha conta").
alter table public.recursos add column if not exists lembretes_email boolean not null default true;
-- "Modo piloto": enquanto a app ainda não está disseminada a toda a gente, os lembretes automáticos
-- (horas em falta + agenda do dia) só saem para quem o Administrador marcou explicitamente em
-- Pessoas (piloto_lembretes) — desligado por omissão, o que mantém o comportamento de sempre
-- (envia a toda a gente elegível). Ver App.elegiveis em supabase/functions/_shared/comum.ts.
alter table public.configuracoes add column if not exists lembretes_piloto_ativo boolean not null default false;
alter table public.recursos add column if not exists piloto_lembretes boolean not null default false;
-- Hora de envio configurável pelo Administrador ("HH:MM", fuso de Lisboa) e último dia em que cada
-- lembrete correu de facto (não um teste/forçado) — o pg_cron passa a chamar as funções de 10 em 10
-- minutos (ver agendar_lembrete_*.sql), e são ESTAS colunas que decidem, a cada chamada, se já é a
-- hora certa e se ainda não correu hoje. Muda-se a hora só aqui (Configurações → Definições), nunca
-- mais é preciso voltar a mexer no agendamento em si.
alter table public.configuracoes add column if not exists lembrete_horas_hora text not null default '08:00';
alter table public.configuracoes add column if not exists lembrete_agenda_hora text not null default '07:30';
alter table public.configuracoes add column if not exists lembrete_horas_ultimo_envio date;
alter table public.configuracoes add column if not exists lembrete_agenda_ultimo_envio date;
insert into public.configuracoes (id) values (1) on conflict (id) do nothing;

-- Depois de alterar colunas por SQL direto, força a API (PostgREST) a esquecer a "schema cache"
-- antiga imediatamente, em vez de esperar pelo próximo refresh automático — evita o erro "Could
-- not find the 'x' column... in the schema cache" logo a seguir a correr este ficheiro.
notify pgrst, 'reload schema';

-- ============================================================================
-- Migração pontual: versões anteriores tinham uma tabela "profiles" separada
-- (utilizador da plataforma) ligada a "recursos" por "recurso_id". Passa tudo
-- para "recursos" (colunas "auth_user_id"/"acesso" acima) e apaga "profiles" —
-- só corre se "profiles" ainda existir, por isso é seguro repetir este
-- ficheiro depois de a migração já ter acontecido.
-- ============================================================================
do $$
begin
  if to_regclass('public.profiles') is not null then
    update public.recursos r
    set auth_user_id = p.id,
        acesso = p.papel,
        email = case when r.email = '' then p.email else r.email end
    from public.profiles p
    where p.recurso_id = r.id;

    -- Solta já a fk antiga (projetos.gestor_id -> profiles) — o remap a seguir escreve ids de
    -- "recursos", que nunca vão bater certo contra "profiles" enquanto essa fk estiver ativa.
    alter table public.projetos drop constraint if exists projetos_gestor_id_fkey;

    -- Remapeia projetos.gestor_id de "profiles.id" (= auth.users.id) para o "recursos.id" ligado.
    update public.projetos pr
    set gestor_id = r.id
    from public.recursos r
    where r.auth_user_id = pr.gestor_id;

    -- Qualquer gestor_id que fique sem correspondência (ex.: apontava para uma conta entretanto
    -- apagada e recriada) passa a "sem gestor", em vez de deixar um id órfão que a fk nova abaixo
    -- rejeitaria.
    update public.projetos pr
    set gestor_id = null
    where gestor_id is not null
      and not exists (select 1 from public.recursos r where r.id = pr.gestor_id);

    drop table public.profiles cascade;

    alter table public.projetos
      add constraint projetos_gestor_id_fkey foreign key (gestor_id) references public.recursos(id) on delete set null;
  end if;
end $$;

-- ============================================================================
-- Novo utilizador -> liga-se automaticamente ao recurso com o mesmo email (se
-- o administrador já o tiver pré-criado, ex.: para reservar um lugar num
-- projeto antes da pessoa se registar) ou cria um recurso novo já ligado.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  novo_nome text := coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1));
  rid uuid;
begin
  select id into rid from public.recursos where email = new.email and auth_user_id is null limit 1;
  if rid is not null then
    update public.recursos set auth_user_id = new.id where id = rid;
  else
    insert into public.recursos (nome, email, auth_user_id) values (novo_nome, new.email, new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RLS: qualquer utilizador autenticado lê e escreve tudo (opção escolhida por agora)
-- ============================================================================
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'departamentos','equipas','recursos','feriados','ausencias',
    'projetos','tarefas','tarefa_recursos','faturas','registos',
    'pontos_situacao','proximos_passos','reservas_viatura','configuracoes','tipos_trabalho','historico_equipas'
  ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "autenticados_acesso_total" on public.%I;', t);
    execute format(
      'create policy "autenticados_acesso_total" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- Grants da Data API — a partir de 30/10/2026 a Supabase deixa de os atribuir
-- automaticamente a tabelas novas (aviso por email); sem isto, um projeto criado
-- de raiz a partir deste schema.sql (recuperação de desastre, ambiente novo) ficava
-- com todas as tabelas a devolver "permission denied" via supabase-js/PostgREST,
-- mesmo com a RLS acima já a autorizar o acesso. As tabelas já existentes em
-- produção não são afetadas (mantêm os grants automáticos de quando foram
-- criadas) — isto é só para o dia em que este ficheiro tiver de recriar tudo.
-- "authenticated" cobre tudo o que a app usa (login sempre exigido, nunca há
-- acesso anónimo); "service_role" fica também coberto, por segurança, para uso
-- futuro (Edge Functions, scripts). GRANT é idempotente — repetir não faz mal.
-- ============================================================================
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'departamentos','equipas','recursos','feriados','ausencias',
    'projetos','tarefas','tarefa_recursos','faturas','registos',
    'pontos_situacao','proximos_passos','reservas_viatura','configuracoes','tipos_trabalho','historico_equipas'
  ])
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant select, insert, update, delete on public.%I to service_role;', t);
  end loop;
end $$;

-- ============================================================================
-- CRM (módulo "Comercial") — Fase 1: contas, contactos, oportunidades, propostas, interações e
-- tarefas de follow-up, com o funil parametrizável por tipo de oportunidade.
-- Ao contrário do resto da app, estas tabelas NÃO têm "acesso total a qualquer autenticado": contêm
-- valores de propostas e dados pessoais de contactos, por isso o acesso é decidido AQUI, na base de
-- dados (e não só escondido no browser): Administradores, Diretores de departamento e Team Leaders.
-- Só o Administrador altera os parâmetros do funil (tipos, etapas, motivos de perda).
-- O módulo fala diretamente com estas tabelas (js/crm.js), fora do estado/Ctrl+Z do resto da app.
-- Tudo idempotente — pode voltar a correr-se este ficheiro sem repor nada do que já lá estiver.
-- ============================================================================
create or replace function public.crm_tem_acesso()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (
        r.acesso = 'admin'
        or exists (select 1 from public.departamentos d where d.diretor_id = r.id)
        or exists (select 1 from public.equipas e where e.lider_id = r.id)
      )
  );
$$;

create or replace function public.crm_e_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.recursos r where r.auth_user_id = auth.uid() and r.acesso = 'admin');
$$;

-- ---------- Parâmetros do funil (editáveis só pelo Administrador) ----------
create table if not exists public.crm_tipos_oportunidade (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null default 0,
  ativo boolean not null default true
);
-- Semente inicial: só insere se a tabela estiver vazia (não repõe tipos entretanto renomeados/apagados).
insert into public.crm_tipos_oportunidade (nome, ordem)
select * from (values ('Projetos de I&D', 0), ('Serviços', 1)) as seed(nome, ordem)
where not exists (select 1 from public.crm_tipos_oportunidade);

-- Uma etapa pertence a um tipo. "categoria" é o que a app usa para a lógica (nunca o nome): 'aberta'
-- (em curso), 'ganha' (fecha com sucesso e permite criar o projeto) ou 'perdida' (exige motivo).
-- "probabilidade" (0-100) serve para o valor ponderado do funil.
create table if not exists public.crm_etapas (
  id uuid primary key default gen_random_uuid(),
  tipo_id uuid not null references public.crm_tipos_oportunidade(id) on delete restrict,
  nome text not null,
  probabilidade numeric not null default 0 check (probabilidade >= 0 and probabilidade <= 100),
  categoria text not null default 'aberta' check (categoria in ('aberta', 'ganha', 'perdida')),
  ordem int not null default 0,
  ativo boolean not null default true
);
create index if not exists crm_etapas_tipo_id_idx on public.crm_etapas(tipo_id);
insert into public.crm_etapas (tipo_id, nome, probabilidade, categoria, ordem)
select t.id, e.nome, e.prob, e.cat, e.ordem
from public.crm_tipos_oportunidade t
join (values
  ('Projetos de I&D', 'Ideia / Lead', 10, 'aberta', 0),
  ('Projetos de I&D', 'Qualificada', 25, 'aberta', 1),
  ('Projetos de I&D', 'Candidatura em preparação', 40, 'aberta', 2),
  ('Projetos de I&D', 'Candidatura submetida', 60, 'aberta', 3),
  ('Projetos de I&D', 'Ganha', 100, 'ganha', 4),
  ('Projetos de I&D', 'Perdida', 0, 'perdida', 5),
  ('Serviços', 'Lead', 10, 'aberta', 0),
  ('Serviços', 'Qualificada', 25, 'aberta', 1),
  ('Serviços', 'Proposta enviada', 50, 'aberta', 2),
  ('Serviços', 'Negociação', 75, 'aberta', 3),
  ('Serviços', 'Ganha', 100, 'ganha', 4),
  ('Serviços', 'Perdida', 0, 'perdida', 5)
) as e(tipo, nome, prob, cat, ordem) on e.tipo = t.nome
where not exists (select 1 from public.crm_etapas);

create table if not exists public.crm_motivos_perda (
  id uuid primary key default gen_random_uuid(),
  tipo_id uuid not null references public.crm_tipos_oportunidade(id) on delete restrict,
  nome text not null,
  ordem int not null default 0,
  ativo boolean not null default true
);
create index if not exists crm_motivos_perda_tipo_id_idx on public.crm_motivos_perda(tipo_id);
insert into public.crm_motivos_perda (tipo_id, nome, ordem)
select t.id, m.nome, m.ordem
from public.crm_tipos_oportunidade t
join (values
  ('Projetos de I&D', 'Candidatura não aprovada', 0),
  ('Projetos de I&D', 'Sem aviso/financiamento adequado', 1),
  ('Projetos de I&D', 'Consórcio não avançou', 2),
  ('Projetos de I&D', 'Cliente desistiu', 3),
  ('Projetos de I&D', 'Outro', 4),
  ('Serviços', 'Preço', 0),
  ('Serviços', 'Prazo', 1),
  ('Serviços', 'Concorrência', 2),
  ('Serviços', 'Sem orçamento do cliente', 3),
  ('Serviços', 'Sem resposta', 4),
  ('Serviços', 'Outro', 5)
) as m(tipo, nome, ordem) on m.tipo = t.nome
where not exists (select 1 from public.crm_motivos_perda);

-- ---------- Contas (clientes) ----------
create table if not exists public.crm_contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nif text not null default '',
  setor text not null default '',
  dimensao text not null default '',
  morada text not null default '',
  website text not null default '',
  estado text not null default 'prospeto' check (estado in ('prospeto', 'ativo', 'inativo')),
  responsavel_id uuid references public.recursos(id) on delete set null,
  notas text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_contas_nif_idx on public.crm_contas(nif);

-- ---------- Contactos ----------
create table if not exists public.crm_contactos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.crm_contas(id) on delete cascade,
  nome text not null,
  cargo text not null default '',
  email text not null default '',
  telefone text not null default '',
  papel_decisao text not null default '' check (papel_decisao in ('', 'decisor', 'influenciador', 'tecnico')),
  consentimento_rgpd boolean not null default false,
  consentimento_data date,
  notas text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_contactos_conta_id_idx on public.crm_contactos(conta_id);

-- ---------- Oportunidades ----------
-- Uma conta com oportunidades não se apaga (restrict) — evita perder o histórico comercial sem querer.
-- "projeto_id" liga à criação do projeto a partir de uma oportunidade ganha (a tabela "projetos" não
-- foi alterada de propósito: a ligação vive só aqui).
create table if not exists public.crm_oportunidades (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.crm_contas(id) on delete restrict,
  contacto_id uuid references public.crm_contactos(id) on delete set null,
  tipo_id uuid not null references public.crm_tipos_oportunidade(id) on delete restrict,
  etapa_id uuid not null references public.crm_etapas(id) on delete restrict,
  titulo text not null,
  descricao text not null default '',
  valor_estimado numeric not null default 0,
  data_prevista_fecho date,
  responsavel_id uuid references public.recursos(id) on delete set null,
  origem text not null default '',
  motivo_perda_id uuid references public.crm_motivos_perda(id) on delete set null,
  motivo_perda_notas text not null default '',
  data_fecho date,
  projeto_id uuid references public.projetos(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_oportunidades_conta_id_idx on public.crm_oportunidades(conta_id);
create index if not exists crm_oportunidades_etapa_id_idx on public.crm_oportunidades(etapa_id);

-- ---------- Propostas (registo; o valor/referência vêm do GIAF) ----------
-- "caminho_documento" é só o caminho/ligação para o ficheiro no OneDrive/SharePoint — a app não gera
-- nem guarda documentos.
create table if not exists public.crm_propostas (
  id uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references public.crm_oportunidades(id) on delete cascade,
  referencia_giaf text not null default '',
  versao int not null default 1,
  valor numeric not null default 0,
  horas_estimadas numeric,
  data_envio date,
  data_validade date,
  estado text not null default 'rascunho' check (estado in ('rascunho', 'enviada', 'aceite', 'rejeitada', 'expirada')),
  caminho_documento text not null default '',
  notas text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_propostas_oportunidade_id_idx on public.crm_propostas(oportunidade_id);

-- ---------- Interações (chamadas, reuniões, emails, visitas) ----------
create table if not exists public.crm_interacoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.crm_contas(id) on delete cascade,
  contacto_id uuid references public.crm_contactos(id) on delete set null,
  oportunidade_id uuid references public.crm_oportunidades(id) on delete cascade,
  tipo text not null default 'reuniao' check (tipo in ('chamada', 'reuniao', 'email', 'visita', 'outro')),
  data date not null default current_date,
  resumo text not null default '',
  criado_por uuid references public.recursos(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists crm_interacoes_conta_id_idx on public.crm_interacoes(conta_id);
create index if not exists crm_interacoes_oportunidade_id_idx on public.crm_interacoes(oportunidade_id);

-- ---------- Tarefas de follow-up ----------
create table if not exists public.crm_tarefas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.crm_contas(id) on delete cascade,
  oportunidade_id uuid references public.crm_oportunidades(id) on delete cascade,
  descricao text not null,
  responsavel_id uuid references public.recursos(id) on delete set null,
  data_limite date,
  concluida boolean not null default false,
  concluida_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists crm_tarefas_responsavel_idx on public.crm_tarefas(responsavel_id, concluida);

-- ---------- RLS + grants das tabelas do CRM ----------
do $$
declare
  t text;
begin
  -- Dados do CRM: leitura e escrita só para quem tem acesso ao módulo.
  for t in select unnest(array['crm_contas','crm_contactos','crm_oportunidades','crm_propostas','crm_interacoes','crm_tarefas'])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "crm_acesso" on public.%I;', t);
    execute format('create policy "crm_acesso" on public.%I for all using (public.crm_tem_acesso()) with check (public.crm_tem_acesso());', t);
  end loop;
  -- Parâmetros do funil: lê quem tem acesso ao módulo, altera só o Administrador.
  for t in select unnest(array['crm_tipos_oportunidade','crm_etapas','crm_motivos_perda'])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "crm_ler" on public.%I;', t);
    execute format('drop policy if exists "crm_admin_escrever" on public.%I;', t);
    execute format('create policy "crm_ler" on public.%I for select using (public.crm_tem_acesso());', t);
    execute format('create policy "crm_admin_escrever" on public.%I for all using (public.crm_e_admin()) with check (public.crm_e_admin());', t);
  end loop;
  for t in select unnest(array[
    'crm_tipos_oportunidade','crm_etapas','crm_motivos_perda','crm_contas','crm_contactos',
    'crm_oportunidades','crm_propostas','crm_interacoes','crm_tarefas'
  ])
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant select, insert, update, delete on public.%I to service_role;', t);
  end loop;
end $$;
grant execute on function public.crm_tem_acesso() to authenticated;
grant execute on function public.crm_e_admin() to authenticated;
notify pgrst, 'reload schema';

-- ============================================================================
-- Passo manual único: tornar-te Administrador (não há ninguém para o fazer a
-- partir da app na primeira vez). Substitui o email e corre uma única vez.
-- ============================================================================
-- update public.recursos set acesso = 'admin' where auth_user_id = (select id from auth.users where email = 'o-teu-email@...');

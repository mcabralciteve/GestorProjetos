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
create table if not exists public.equipas (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);

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

-- Consultor de um projeto não é uma lista à parte: é quem já tem o recurso ligado ao seu login
-- atribuído a alguma tarefa desse projeto (tabela "tarefa_recursos" já cobre isso).
drop table if exists public.projeto_consultores;

-- ---------- Tarefas ----------
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  parent_id uuid references public.tarefas(id) on delete cascade,
  nome text not null,
  inicio date not null,
  fim date not null,
  progresso int not null default 0,
  -- predecessoras guardadas como jsonb: [{"id": "<uuid da tarefa predecessora>", "tipo": "FS", "atraso": 0}, ...]
  predecessores jsonb not null default '[]'::jsonb
);
create index if not exists tarefas_projeto_id_idx on public.tarefas(projeto_id);
create index if not exists tarefas_parent_id_idx on public.tarefas(parent_id);

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

-- ---------- Acompanhamento: pontos de situação e next steps por projeto ----------
-- Só o Administrador cria (registados numa reunião com o Gestor); o Gestor só atualiza estado e
-- notas dos next steps já existentes. Visível só para Administrador + Gestor desse projeto — a
-- app trata a visibilidade, não há RLS reforçado (mesma decisão do resto do esquema).
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
    'equipas','recursos','feriados','ausencias',
    'projetos','tarefas','tarefa_recursos','faturas','registos',
    'pontos_situacao','proximos_passos'
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
-- Passo manual único: tornar-te Administrador (não há ninguém para o fazer a
-- partir da app na primeira vez). Substitui o email e corre uma única vez.
-- ============================================================================
-- update public.recursos set acesso = 'admin' where auth_user_id = (select id from auth.users where email = 'o-teu-email@...');

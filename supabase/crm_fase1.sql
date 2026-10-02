-- CRM Fase 1 — corre ESTE ficheiro no SQL Editor do Supabase (é o mesmo bloco que está em schema.sql).
-- Seguro de repetir: só cria o que não existe e não repõe parâmetros que já tenhas alterado.

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

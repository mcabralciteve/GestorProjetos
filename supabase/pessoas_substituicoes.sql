-- ============================================================================
-- Pessoas inativas — Fase 2: registo das substituições (histórico)
--
-- SÓ CRIA uma tabela nova ("pessoas_substituicoes"); não toca em nenhuma tabela existente.
-- É um registo só de acrescentar: a app só pode ler e inserir (sem update nem delete), para o histórico
-- de "quem passou o quê a quem, quando" não poder ser alterado. Os nomes ficam guardados em texto para o
-- registo continuar legível mesmo que a pessoa, o projeto ou a tarefa sejam alterados mais tarde.
-- Seguro de correr mais do que uma vez.
-- ============================================================================
create table if not exists public.pessoas_substituicoes (
  id uuid primary key default gen_random_uuid(),
  feito_em timestamptz not null default now(),
  feito_por uuid references public.recursos(id) on delete set null,
  tipo text not null default 'tarefa' check (tipo in ('tarefa', 'next_step', 'gestor', 'lider', 'diretor')),
  projeto_id uuid references public.projetos(id) on delete set null,
  projeto_nome text not null default '',
  tarefa_id uuid,
  tarefa_nome text not null default '',
  de_recurso_id uuid references public.recursos(id) on delete set null,
  de_nome text not null default '',
  para_recurso_id uuid references public.recursos(id) on delete set null,
  para_nome text not null default '',
  horas numeric not null default 0,
  observacoes text not null default ''
);
create index if not exists pessoas_substituicoes_de_idx on public.pessoas_substituicoes(de_recurso_id);
create index if not exists pessoas_substituicoes_projeto_idx on public.pessoas_substituicoes(projeto_id);

alter table public.pessoas_substituicoes enable row level security;
drop policy if exists "substituicoes_ler" on public.pessoas_substituicoes;
create policy "substituicoes_ler" on public.pessoas_substituicoes for select using (auth.role() = 'authenticated');
drop policy if exists "substituicoes_inserir" on public.pessoas_substituicoes;
create policy "substituicoes_inserir" on public.pessoas_substituicoes for insert with check (auth.role() = 'authenticated');

grant select, insert on public.pessoas_substituicoes to authenticated;
grant select, insert, update, delete on public.pessoas_substituicoes to service_role;

notify pgrst, 'reload schema';

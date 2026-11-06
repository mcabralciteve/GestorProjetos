-- ============================================================================
-- Licenças de software (módulo "Ativos → Licenças"): valor, responsável, departamento, renovação, projeto e financiamento
--
-- SÓ CRIA uma tabela nova e duas funções. Não altera nem apaga nenhum dado existente. Seguro de correr mais do que uma vez.
--
-- Uma linha por licença (ou por subscrição):
--   tipo                 'subscricao' (paga a cada período) | 'perpetua' (aquisição única)
--   periodicidade        'mensal' | 'anual' (subscrição) | 'unica' (perpétua). Subscrição ⇔ não 'unica'.
--   valor                valor TOTAL de cada período (subscrição) ou de aquisição (perpétua), em € sem IVA.
--                        O valor anual equivalente é calculado pela app (mensal × 12).
--   n_licencas           n.º de lugares/licenças (informativo; o valor é sempre o total)
--   responsavel_id       a quem pertence (recursos.id)
--   departamento_id      departamento a que pertence (departamentos.id) — decide quem vê (ver a RLS abaixo)
--   data_renovacao       próxima renovação; renovacao_automatica = a app avança a data sozinha (mensal/anual) para a próxima ocorrência
--   projeto_id           projeto da app que a suporta (opcional); projeto_nome guarda o rótulo (ou texto livre, se o projeto não estiver na app)
--   taxa_financiamento   % do valor que é financiada pelo projeto (0 a 100); o resto fica a cargo do departamento
--   estado               'ativa' | 'cancelada' | 'expirada' ("a renovar" não é um estado: deriva da data de renovação)
--
-- Quem vê/edita (decidido NA BASE DE DADOS, porque são valores de custo): o Administrador vê todas; o Diretor de um departamento
-- vê e edita só as licenças do seu departamento. Mais ninguém. (Uma licença sem departamento só o Administrador a vê.)
-- ============================================================================
create table if not exists public.licencas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0),
  fornecedor text not null default '',
  tipo text not null default 'subscricao' check (tipo in ('subscricao', 'perpetua')),
  periodicidade text not null default 'anual' check (periodicidade in ('mensal', 'anual', 'unica')),
  n_licencas integer check (n_licencas is null or n_licencas >= 0),
  valor numeric not null default 0 check (valor >= 0),
  responsavel_id uuid references public.recursos(id) on delete set null,
  departamento_id uuid references public.departamentos(id) on delete set null,
  data_inicio date,
  data_renovacao date,
  renovacao_automatica boolean not null default true,
  projeto_id uuid references public.projetos(id) on delete set null,
  projeto_nome text not null default '',
  taxa_financiamento numeric not null default 0 check (taxa_financiamento >= 0 and taxa_financiamento <= 100),
  estado text not null default 'ativa' check (estado in ('ativa', 'cancelada', 'expirada')),
  ligacao text not null default '',
  notas text not null default '',
  criado_por_user uuid,
  criado_por_nome text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_por_nome text not null default '',
  atualizado_em timestamptz not null default now(),
  check ((tipo = 'perpetua') = (periodicidade = 'unica'))
);
create index if not exists licencas_departamento_idx on public.licencas(departamento_id);
create index if not exists licencas_renovacao_idx on public.licencas(data_renovacao);
create index if not exists licencas_projeto_idx on public.licencas(projeto_id);

-- Pode esta pessoa ver/editar licenças DESTE departamento? Administrador: sempre. Diretor: só do seu departamento.
create or replace function public.licencas_pode(p_departamento uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (
        r.acesso = 'admin'
        or (p_departamento is not null and exists (
              select 1 from public.departamentos d where d.id = p_departamento and d.diretor_id = r.id))
      )
  );
$$;
grant execute on function public.licencas_pode(uuid) to authenticated;

-- Tem esta pessoa acesso ao módulo (Administrador, ou Diretor de algum departamento)? Só serve para a app mostrar/esconder o menu.
create or replace function public.licencas_tem_acesso()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (r.acesso = 'admin' or exists (select 1 from public.departamentos d where d.diretor_id = r.id))
  );
$$;
grant execute on function public.licencas_tem_acesso() to authenticated;

alter table public.licencas enable row level security;
drop policy if exists "licencas_por_departamento" on public.licencas;
create policy "licencas_por_departamento" on public.licencas for all
  using (public.licencas_pode(departamento_id)) with check (public.licencas_pode(departamento_id));
grant select, insert, update, delete on public.licencas to authenticated;
grant select, insert, update, delete on public.licencas to service_role;

notify pgrst, 'reload schema';

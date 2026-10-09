-- ============================================================================
-- Propostas e Orçamentação — Fase 1: orçamentos ligados às propostas do CRM
--
-- Modelo:  Conta -> Oportunidade -> Proposta (crm_propostas) -> Orçamentos (versões/alternativas)
--          Um orçamento tem Áreas (equipas: DCS, ROB, DAT, DPC, Outros...) e cada área tem Linhas nas
--          5 secções da folha de orçamentação (consultoria, formação, deslocação, consumíveis, produtos).
--          Só UM orçamento por proposta pode estar "validado" (o adjudicado) — garantido pela base de dados.
--
-- Correr no SQL Editor do Supabase. Tudo idempotente (pode voltar a correr). Requer o CRM (crm_fase1.sql).
-- Acesso: quem tem acesso ao CRM (Administrador, Diretores e Team Leaders) lê e escreve; os parâmetros
-- só o Administrador altera.
-- ============================================================================

-- ---------- Parâmetros gerais (linha única, id = 1) ----------
-- Só o que a folha de Excel tem de comum a todos os orçamentos e que não está já nas Pessoas
-- (o valor/hora de cada consultor vem de recursos.preco_venda / preco_custo).
create table if not exists public.crm_orc_parametros (
  id int primary key default 1 check (id = 1),
  aluguer_saida numeric not null default 45 check (aluguer_saida >= 0),   -- € por saída/dia de aluguer de viatura
  custo_km numeric not null default 0.16 check (custo_km >= 0),           -- € por km percorrido
  validade_dias int not null default 30 check (validade_dias > 0),        -- validade por omissão da proposta
  atualizado_em timestamptz not null default now()
);
insert into public.crm_orc_parametros (id) values (1) on conflict (id) do nothing;

-- ---------- Orçamentos ----------
-- Os valores de deslocação ficam COPIADOS para o orçamento (aluguer_saida, custo_km): mudar os parâmetros
-- depois nunca altera orçamentos já feitos. "total" e "margem" são calculados pela app em cada gravação
-- (só para listar sem recalcular tudo).
create table if not exists public.crm_orcamentos (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references public.crm_propostas(id) on delete cascade,
  versao int not null default 1,
  titulo text not null default '',
  estado text not null default 'rascunho' check (estado in ('rascunho', 'enviado', 'validado', 'rejeitado')),
  validade_dias int not null default 30 check (validade_dias > 0),
  aluguer_saida numeric not null default 45,
  custo_km numeric not null default 0.16,
  total numeric not null default 0,
  margem numeric not null default 0,
  notas text not null default '',
  criado_por uuid references public.recursos(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  validado_em timestamptz
);
create index if not exists crm_orcamentos_proposta_idx on public.crm_orcamentos(proposta_id);
-- No máximo um orçamento validado (adjudicado) por proposta.
create unique index if not exists crm_orcamentos_um_validado on public.crm_orcamentos(proposta_id) where estado = 'validado';

-- ---------- Áreas (um separador da folha por departamento/equipa) ----------
create table if not exists public.crm_orc_areas (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.crm_orcamentos(id) on delete cascade,
  equipa_id uuid references public.equipas(id) on delete set null,
  nome text not null default '',                       -- nome da equipa no momento do orçamento
  ordem int not null default 0,
  custos_especificos numeric not null default 0        -- "Custos Específicos do Departamento" (€)
);
create index if not exists crm_orc_areas_orcamento_idx on public.crm_orc_areas(orcamento_id);

-- ---------- Linhas ----------
-- "dados" guarda os números da linha conforme a secção (horas, valor/hora, km, quantidade...); os
-- cálculos fazem-se na app (js/orcamento-logica.js, testado) e o valor/hora de cada consultor fica
-- congelado na linha.
create table if not exists public.crm_orc_linhas (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.crm_orc_areas(id) on delete cascade,
  seccao text not null check (seccao in ('consultoria', 'formacao', 'deslocacao', 'consumivel', 'produto')),
  ordem int not null default 0,
  descricao text not null default '',
  recurso_id uuid references public.recursos(id) on delete set null,   -- consultor de referência (valor/hora)
  dados jsonb not null default '{}'::jsonb
);
create index if not exists crm_orc_linhas_area_idx on public.crm_orc_linhas(area_id);

-- ---------- Gravar um orçamento inteiro de uma vez (tudo ou nada) ----------
-- p = { id, proposta_id, versao, titulo, estado, validade_dias, aluguer_saida, custo_km, total, margem, notas,
--       criado_por, areas: [ { id, equipa_id, nome, ordem, custos_especificos,
--                              linhas: [ { id, seccao, ordem, descricao, recurso_id, dados } ] } ] }
-- Corre com os direitos de quem chama (RLS aplica-se). Só um orçamento em "rascunho" pode ter o conteúdo
-- alterado — enviado/validado/rejeitado são registos fechados (para alterar, cria-se uma nova versão).
create or replace function public.crm_gravar_orcamento(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_estado text;
  a jsonb;
  l jsonb;
begin
  select estado into v_estado from crm_orcamentos where id = v_id;
  if v_estado is not null and v_estado <> 'rascunho' then
    raise exception 'Orçamento %: só um rascunho pode ser alterado (cria uma nova versão).', v_estado using errcode = 'P0001';
  end if;

  insert into crm_orcamentos (id, proposta_id, versao, titulo, estado, validade_dias, aluguer_saida, custo_km, total, margem, notas, criado_por, atualizado_em)
  values (v_id, (p->>'proposta_id')::uuid, coalesce((p->>'versao')::int, 1), coalesce(p->>'titulo', ''), 'rascunho',
          coalesce((p->>'validade_dias')::int, 30), coalesce((p->>'aluguer_saida')::numeric, 45), coalesce((p->>'custo_km')::numeric, 0.16),
          coalesce((p->>'total')::numeric, 0), coalesce((p->>'margem')::numeric, 0), coalesce(p->>'notas', ''),
          nullif(p->>'criado_por', '')::uuid, now())
  on conflict (id) do update set
    titulo = excluded.titulo, validade_dias = excluded.validade_dias, aluguer_saida = excluded.aluguer_saida, custo_km = excluded.custo_km,
    total = excluded.total, margem = excluded.margem, notas = excluded.notas, atualizado_em = now();

  -- Áreas e linhas: apaga e volta a inserir (os ids mantêm-se; nada mais as referencia nesta fase).
  delete from crm_orc_areas where orcamento_id = v_id;
  for a in select * from jsonb_array_elements(coalesce(p->'areas', '[]'::jsonb)) loop
    insert into crm_orc_areas (id, orcamento_id, equipa_id, nome, ordem, custos_especificos)
    values ((a->>'id')::uuid, v_id, nullif(a->>'equipa_id', '')::uuid, coalesce(a->>'nome', ''), coalesce((a->>'ordem')::int, 0),
            coalesce((a->>'custos_especificos')::numeric, 0));
    for l in select * from jsonb_array_elements(coalesce(a->'linhas', '[]'::jsonb)) loop
      insert into crm_orc_linhas (id, area_id, seccao, ordem, descricao, recurso_id, dados)
      values ((l->>'id')::uuid, (a->>'id')::uuid, l->>'seccao', coalesce((l->>'ordem')::int, 0), coalesce(l->>'descricao', ''),
              nullif(l->>'recurso_id', '')::uuid, coalesce(l->'dados', '{}'::jsonb));
    end loop;
  end loop;
  return v_id;
end;
$$;
grant execute on function public.crm_gravar_orcamento(jsonb) to authenticated;

-- ---------- RLS + grants ----------
do $$
declare
  t text;
begin
  for t in select unnest(array['crm_orcamentos', 'crm_orc_areas', 'crm_orc_linhas'])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "crm_acesso" on public.%I;', t);
    execute format('create policy "crm_acesso" on public.%I for all using (public.crm_tem_acesso()) with check (public.crm_tem_acesso());', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant select, insert, update, delete on public.%I to service_role;', t);
  end loop;
  -- Parâmetros: lê quem tem acesso ao CRM, altera só o Administrador.
  alter table public.crm_orc_parametros enable row level security;
  drop policy if exists "crm_ler" on public.crm_orc_parametros;
  drop policy if exists "crm_admin_escrever" on public.crm_orc_parametros;
  create policy "crm_ler" on public.crm_orc_parametros for select using (public.crm_tem_acesso());
  create policy "crm_admin_escrever" on public.crm_orc_parametros for all using (public.crm_e_admin()) with check (public.crm_e_admin());
  grant select, insert, update, delete on public.crm_orc_parametros to authenticated;
  grant select, insert, update, delete on public.crm_orc_parametros to service_role;
end $$;

notify pgrst, 'reload schema';

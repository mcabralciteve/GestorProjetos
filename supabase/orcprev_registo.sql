-- ============================================================================
-- orcprev — registo do que já foi carregado (Fase 1)
--
-- O importador (js/orcprev-importar.js, a correr dentro do orcprev) não consegue falar com o Gestor com a
-- sessão da pessoa (sites diferentes). Por isso, ao "Copiar semana", o Gestor pede aqui um "envio" com um
-- código secreto de uso único (token); o código vai dentro do pacote copiado e, depois de gravar no orcprev,
-- o importador chama orcprev_confirmar(token, ...) — que marca o envio como carregado e guarda as horas
-- por dia. Assim o Gestor passa a saber o que já está no orcprev (e o que falta), por pessoa e por semana.
--
-- SÓ CRIA coisas novas (1 tabela, 3 funções, 4 colunas em "configuracoes"); não toca em dados existentes.
-- Seguro de correr mais do que uma vez.
-- ============================================================================

create table if not exists public.orcprev_envios (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),     -- segredo: só quem copiou o pacote o conhece
  recurso_id uuid not null references public.recursos(id) on delete cascade,
  pessoa text not null default '',
  semana_inicio date not null,                               -- segunda-feira da semana
  semana_fim date not null,
  origem text not null default 'importador' check (origem in ('importador', 'manual')),
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz,                                 -- vazio = copiado mas ainda não confirmado no orcprev
  horas_gestor numeric not null default 0,                   -- horas "enviáveis" que o Gestor tinha ao copiar
  horas_enviadas numeric not null default 0,                 -- horas realmente gravadas no orcprev
  dias jsonb not null default '{}'::jsonb,                   -- {"2026-11-09": 8, ...} horas gravadas por dia
  orcprev_email text not null default ''
);
create index if not exists orcprev_envios_pessoa_semana_idx on public.orcprev_envios(recurso_id, semana_inicio);
create index if not exists orcprev_envios_confirmado_idx on public.orcprev_envios(confirmado_em);

alter table public.orcprev_envios enable row level security;
drop policy if exists "orcprev_envios_ler" on public.orcprev_envios;
create policy "orcprev_envios_ler" on public.orcprev_envios for select using (auth.role() = 'authenticated');
-- Sem insert/update/delete diretos: só pelas funções abaixo (e pelo service_role).

-- O token nunca sai pela leitura normal: só a função orcprev_novo_envio o devolve, a quem o criou.
revoke all on public.orcprev_envios from authenticated, anon;
grant select (id, recurso_id, pessoa, semana_inicio, semana_fim, origem, criado_em, confirmado_em,
              horas_gestor, horas_enviadas, dias, orcprev_email) on public.orcprev_envios to authenticated;
grant select, insert, update, delete on public.orcprev_envios to service_role;

-- Cria um envio para a MINHA pessoa (a ligada ao utilizador autenticado) e devolve { id, token }.
create or replace function public.orcprev_novo_envio(p_semana_inicio date, p_semana_fim date, p_horas_gestor numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r public.recursos; e public.orcprev_envios;
begin
  select * into r from public.recursos where auth_user_id = auth.uid() limit 1;
  if r.id is null then raise exception 'sem pessoa associada à conta'; end if;
  insert into public.orcprev_envios (recurso_id, pessoa, semana_inicio, semana_fim, horas_gestor)
  values (r.id, r.nome, p_semana_inicio, p_semana_fim, coalesce(p_horas_gestor, 0))
  returning * into e;
  return jsonb_build_object('id', e.id, 'token', e.token);
end $$;
revoke all on function public.orcprev_novo_envio(date, date, numeric) from public, anon;
grant execute on function public.orcprev_novo_envio(date, date, numeric) to authenticated;

-- Chamada pelo importador, dentro do orcprev, com a chave pública (anon) — por isso só aceita o token secreto.
create or replace function public.orcprev_confirmar(p_token uuid, p_dias jsonb, p_horas numeric, p_email text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if p_token is null or jsonb_typeof(coalesce(p_dias, '{}'::jsonb)) <> 'object' then return false; end if;
  update public.orcprev_envios
     set confirmado_em = now(), dias = coalesce(p_dias, '{}'::jsonb), horas_enviadas = coalesce(p_horas, 0),
         orcprev_email = coalesce(p_email, '')
   where token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.orcprev_confirmar(uuid, jsonb, numeric, text) from public;
grant execute on function public.orcprev_confirmar(uuid, jsonb, numeric, text) to anon, authenticated;

-- "Já lancei esta semana à mão no orcprev": regista a semana como carregada, com as horas por dia que o Gestor tem.
create or replace function public.orcprev_marcar_manual(p_semana_inicio date, p_semana_fim date, p_dias jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare r public.recursos; v uuid; total numeric;
begin
  select * into r from public.recursos where auth_user_id = auth.uid() limit 1;
  if r.id is null then raise exception 'sem pessoa associada à conta'; end if;
  select coalesce(sum(value::numeric), 0) into total from jsonb_each_text(coalesce(p_dias, '{}'::jsonb));
  insert into public.orcprev_envios (recurso_id, pessoa, semana_inicio, semana_fim, origem, confirmado_em, horas_gestor, horas_enviadas, dias)
  values (r.id, r.nome, p_semana_inicio, p_semana_fim, 'manual', now(), total, total, coalesce(p_dias, '{}'::jsonb))
  returning id into v;
  return v;
end $$;
revoke all on function public.orcprev_marcar_manual(date, date, jsonb) from public, anon;
grant execute on function public.orcprev_marcar_manual(date, date, jsonb) to authenticated;

-- Lembrete de sexta-feira (função "lembrete-orcprev"): interruptor, hora, 1 envio por dia e data a partir da
-- qual se começa a contar (antes disso nada é considerado em atraso — o que se lançou à mão no passado).
alter table public.configuracoes add column if not exists lembrete_orcprev_ativo boolean not null default false;
alter table public.configuracoes add column if not exists lembrete_orcprev_hora text not null default '09:00';
alter table public.configuracoes add column if not exists lembrete_orcprev_ultimo_envio date;
alter table public.configuracoes add column if not exists orcprev_controlo_desde date;

notify pgrst, 'reload schema';

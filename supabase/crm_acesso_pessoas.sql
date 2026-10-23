-- ============================================================================
-- Acesso ao CRM por pessoa
--
-- 1) ACRESCENTA uma coluna a "recursos": crm_acesso (false por omissão). Não altera nenhum dado existente.
-- 2) ALARGA a regra crm_tem_acesso() — a que decide, na base de dados, quem lê e escreve no CRM. Quem já tinha acesso
--    (Administrador, diretor de algum departamento, líder de alguma equipa) CONTINUA a ter, exatamente como antes;
--    a marca crm_acesso só acrescenta mais pessoas (ex.: um consultor comercial que não é líder nem diretor).
-- Marcar/desmarcar faz-se em Configurações → Pessoas (coluna "CRM"), só o Administrador.
-- Seguro de correr mais do que uma vez.
-- ============================================================================
alter table public.recursos add column if not exists crm_acesso boolean not null default false;

create or replace function public.crm_tem_acesso()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (
        r.acesso = 'admin'
        or r.crm_acesso
        or exists (select 1 from public.departamentos d where d.diretor_id = r.id)
        or exists (select 1 from public.equipas e where e.lider_id = r.id)
      )
  );
$$;
grant execute on function public.crm_tem_acesso() to authenticated;

notify pgrst, 'reload schema';

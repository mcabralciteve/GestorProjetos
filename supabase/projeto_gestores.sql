-- ============================================================================
-- Vários gestores por projeto
--
-- SÓ ACRESCENTA uma coluna a "projetos". Não apaga nem reescreve nenhum dado existente.
--   gestor_ids   lista (JSON) de ids de "recursos" que gerem o projeto, por ordem; o primeiro é o gestor
--                principal e continua também em "gestor_id" (que o resto da base e as funções leem).
--
-- O UPDATE final só preenche, uma vez, a lista dos projetos que ainda a têm vazia e já têm um gestor
-- (lista = [gestor_id]). Nunca mexe numa lista já preenchida. Seguro de correr mais do que uma vez.
-- ============================================================================
alter table public.projetos add column if not exists gestor_ids jsonb not null default '[]'::jsonb;

update public.projetos
set gestor_ids = jsonb_build_array(gestor_id)
where gestor_id is not null and gestor_ids = '[]'::jsonb;

notify pgrst, 'reload schema';

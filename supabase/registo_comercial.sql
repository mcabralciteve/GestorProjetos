-- ============================================================================
-- Registo de horas em atividades comerciais: associação a cliente e oportunidade do CRM
--
-- SÓ ACRESCENTA colunas (e dois índices). Não apaga nem reescreve nenhum registo de horas.
--   tipos_trabalho.comercial        marca os tipos "comerciais" (os que mostram a associação no registo de horas)
--   registos.crm_conta_id           cliente do CRM (opcional)
--   registos.crm_oportunidade_id    oportunidade do CRM (opcional)
--   registos.oportunidade_texto     título da oportunidade (copiado, ou escrito à mão se não existir no CRM)
-- Se uma conta ou oportunidade do CRM for apagada, os registos ficam como estavam (só perdem a ligação; o nome do
-- cliente e o título da oportunidade continuam guardados em texto).
--
-- O UPDATE do "comercial" só marca (uma vez) os tipos que já têm "comercial" no nome — depois podes marcar/desmarcar
-- à vontade em Configurações → Tipos de Trabalho. Seguro de correr mais do que uma vez, mas se desmarcares um tipo
-- cujo nome tenha "comercial", voltar a correr este ficheiro volta a marcá-lo.
-- ============================================================================
alter table public.tipos_trabalho add column if not exists comercial boolean not null default false;
update public.tipos_trabalho set comercial = true where comercial = false and nome ilike '%comercial%';

alter table public.registos add column if not exists crm_conta_id uuid references public.crm_contas(id) on delete set null;
alter table public.registos add column if not exists crm_oportunidade_id uuid references public.crm_oportunidades(id) on delete set null;
alter table public.registos add column if not exists oportunidade_texto text not null default '';

create index if not exists registos_crm_oportunidade_idx on public.registos(crm_oportunidade_id) where crm_oportunidade_id is not null;
create index if not exists registos_crm_conta_idx on public.registos(crm_conta_id) where crm_conta_id is not null;

notify pgrst, 'reload schema';

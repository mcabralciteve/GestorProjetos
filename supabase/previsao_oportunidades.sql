-- ============================================================================
-- Previsão (Fase B): campos de previsão na oportunidade, plano de faturas e valores por defeito por tipo
--
-- SÓ ACRESCENTA colunas e uma tabela nova. Não apaga nem reescreve nenhuma oportunidade existente.
--   crm_oportunidades.inicio_previsto     mês (dia 1) em que o trabalho deve começar (opcional)
--   crm_oportunidades.duracao_meses       duração do trabalho em meses (opcional)
--   crm_oportunidades.equipa_id           "Área responsável" (opcional; sem ela, "Por atribuir")
--   crm_oportunidade_faturas              plano de faturas da oportunidade: mês (dia 1) e % do valor
--   crm_tipos_oportunidade.prev_inicio_apos_fecho_meses / prev_duracao_meses
--                                         defeitos usados quando a oportunidade não tem início/duração:
--                                         início = N meses depois da data prevista de fecho; duração em meses
-- O UPDATE final só acerta, uma vez, o defeito dos tipos cujo nome tem "I&D" (12 meses); os restantes ficam a 4.
-- Seguro de correr mais do que uma vez.
-- ============================================================================
alter table public.crm_oportunidades add column if not exists inicio_previsto date;
alter table public.crm_oportunidades add column if not exists duracao_meses integer check (duracao_meses is null or (duracao_meses between 1 and 120));
alter table public.crm_oportunidades add column if not exists equipa_id uuid references public.equipas(id) on delete set null;

alter table public.crm_tipos_oportunidade add column if not exists prev_inicio_apos_fecho_meses integer not null default 1;
alter table public.crm_tipos_oportunidade add column if not exists prev_duracao_meses integer not null default 4;
update public.crm_tipos_oportunidade set prev_duracao_meses = 12 where prev_duracao_meses = 4 and nome ~* 'i\s*&\s*d|investiga';

create table if not exists public.crm_oportunidade_faturas (
  id uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references public.crm_oportunidades(id) on delete cascade,
  mes date not null,
  percentagem numeric not null check (percentagem >= 0 and percentagem <= 100)
);
create index if not exists crm_oportunidade_faturas_op_idx on public.crm_oportunidade_faturas(oportunidade_id);

alter table public.crm_oportunidade_faturas enable row level security;
drop policy if exists "crm_acesso" on public.crm_oportunidade_faturas;
create policy "crm_acesso" on public.crm_oportunidade_faturas for all using (public.crm_tem_acesso()) with check (public.crm_tem_acesso());
grant select, insert, update, delete on public.crm_oportunidade_faturas to authenticated;
grant select, insert, update, delete on public.crm_oportunidade_faturas to service_role;

notify pgrst, 'reload schema';

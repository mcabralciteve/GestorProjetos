-- ============================================================================
-- Previsão (Fase C): atraso da faturação, por tipo de oportunidade
--
-- SÓ ACRESCENTA uma coluna a "crm_tipos_oportunidade". Não altera nenhuma linha existente (todos os tipos ficam com 1 mês).
--   prev_fat_atraso_meses   quando uma oportunidade não tem plano de faturas, a faturação acompanha o trabalho com este
--                           atraso (em meses). Editável em Configurações → Funil CRM.
-- Seguro de correr mais do que uma vez.
-- ============================================================================
alter table public.crm_tipos_oportunidade add column if not exists prev_fat_atraso_meses integer not null default 1;

notify pgrst, 'reload schema';

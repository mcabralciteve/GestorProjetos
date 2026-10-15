-- ============================================================================
-- Pessoas inativas (saídas) — Fase 1
--
-- SÓ ACRESCENTA duas colunas à tabela "recursos". Não apaga, não altera nem
-- reescreve nenhum dado existente: todas as pessoas ficam "ativas" (ativo = true,
-- data_saida vazia). Seguro de correr mais do que uma vez.
--
--   ativo       false = pessoa inativa (já saiu / saída registada)
--   data_saida  último dia de trabalho; a pessoa passa a inativa no dia seguinte
-- ============================================================================
alter table public.recursos add column if not exists ativo boolean not null default true;
alter table public.recursos add column if not exists data_saida date;

notify pgrst, 'reload schema';

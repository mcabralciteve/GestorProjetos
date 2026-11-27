-- Data de faturação escrita à mão no plano de faturação da oportunidade.
-- NULL = a data calcula-se na app a partir do marco (adjudicação, X% de execução, final do projeto) ou do mês fixo.
-- Só acrescenta uma coluna opcional; seguro de correr mais do que uma vez.
alter table public.crm_oportunidade_faturas add column if not exists data_faturacao date;

notify pgrst, 'reload schema';

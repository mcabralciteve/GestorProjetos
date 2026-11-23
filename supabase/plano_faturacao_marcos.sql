-- Plano de faturação por marcos: cada fatura do plano da oportunidade fica ligada a um marco do projeto —
--   'adjudicacao'  na data prevista de fecho (adjudicação)
--   'execucao'     quando o trabalho chega a X% (execucao_pct): início + X% da duração (projeção de datas)
--   'final'        no último dia do trabalho
-- marco NULL = o mês fixo de antes (as linhas existentes ficam assim, sem alterações). A data do marco calcula-se na app a partir do
-- início/duração/fecho da oportunidade; "mes" guarda o último mês calculado (para quem lê a base de dados diretamente).
-- Só acrescenta colunas opcionais; seguro de correr mais do que uma vez.
alter table public.crm_oportunidade_faturas add column if not exists marco text;
alter table public.crm_oportunidade_faturas add column if not exists execucao_pct numeric;

do $$ begin
  alter table public.crm_oportunidade_faturas add constraint crm_oportunidade_faturas_marco_chk check (
    (marco is null and execucao_pct is null)
    or (marco in ('adjudicacao', 'final') and execucao_pct is null)
    or (marco = 'execucao' and execucao_pct is not null and execucao_pct >= 0 and execucao_pct <= 100)
  );
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

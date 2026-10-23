-- ============================================================================
-- Tipo de projeto (Serviços / I&D) e "sem faturação ao cliente"
--
-- SÓ ACRESCENTA duas colunas a "projetos". Não apaga nem reescreve nenhum dado existente.
--   tipo_projeto     '' (por classificar) | 'servicos' | 'id'   — usado pela Previsão (reconhecimento e faturação)
--   sem_faturacao    true = projeto sem faturação ao cliente (ex.: I&D financiado): conta para o reconhecimento
--                    (com o "Valor vendido" = valor do financiamento/orçamento aprovado) mas não entra na faturação prevista
--
-- O UPDATE final só preenche, uma vez, o tipo dos projetos que AINDA o têm vazio e que já estão ligados a uma oportunidade
-- do CRM (pelo nome do tipo da oportunidade: "I&D" ou "Serviços"). Nunca mexe num tipo já definido. Seguro de correr
-- mais do que uma vez.
-- ============================================================================
alter table public.projetos add column if not exists tipo_projeto text not null default '';
alter table public.projetos add column if not exists sem_faturacao boolean not null default false;
alter table public.projetos drop constraint if exists projetos_tipo_projeto_check;
alter table public.projetos add constraint projetos_tipo_projeto_check check (tipo_projeto in ('', 'servicos', 'id'));

update public.projetos p
set tipo_projeto = case when t.nome ~* 'i\s*&\s*d|investiga' then 'id' when t.nome ~* 'servi' then 'servicos' else '' end
from public.crm_oportunidades o
join public.crm_tipos_oportunidade t on t.id = o.tipo_id
where o.projeto_id = p.id and p.tipo_projeto = '';

notify pgrst, 'reload schema';

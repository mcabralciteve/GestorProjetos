-- ============================================================================
-- CRM: referência GIAF (Ano/Obra) na oportunidade — a proposta herda-a e acrescenta um nº sequencial
--   proposta 2026/829-01, 2026/829-02 … (referência da oportunidade + "-" + versão da proposta, 2 dígitos)
-- Idempotente. Correr no SQL Editor do Supabase ANTES de publicar a nova versão da app.
-- ============================================================================
alter table public.crm_oportunidades add column if not exists referencia_giaf text not null default '';

-- Oportunidades já ligadas a um projeto com referência GIAF: herdam o ID do projeto.
update public.crm_oportunidades o set referencia_giaf = p.id_interno
from public.projetos p
where o.projeto_id = p.id and o.referencia_giaf = '' and coalesce(p.id_interno, '') <> ''
  and coalesce(p.tipo_referencia, 'giaf') <> 'interno';

-- Importadas do SuiteCRM sem projeto: a referência ficou numa nota da descrição ("Ref. GIAF (CRM anterior): 2026/829").
update public.crm_oportunidades
set referencia_giaf = (regexp_match(descricao, 'Ref\. GIAF \(CRM anterior\): (\d{4}/\d+)'))[1]
where referencia_giaf = '' and descricao ~ 'Ref\. GIAF \(CRM anterior\): \d{4}/\d+';

notify pgrst, 'reload schema';

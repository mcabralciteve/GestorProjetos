-- ============================================================================
-- Propostas e Orçamentação — envio ao cliente e cópia para o SharePoint
--
-- "Enviar ao cliente" (no orçamento) chama a função do servidor "proposta-enviar": envia o email com a proposta em anexo (caixa
-- do sistema, com o responsável em cópia) e copia os ficheiros para <pasta CLIENTES>/<cliente>/<proposta> no SharePoint.
-- Esta coluna guarda o link da pasta CLIENTES (Administrador: Configurações → Funil CRM → Orçamentação — parâmetros).
-- Idempotente. Correr no SQL Editor do Supabase. Requer orcamentos_fase1.sql.
-- ============================================================================
alter table public.crm_orc_parametros add column if not exists sharepoint_url text not null default '';
update public.crm_orc_parametros set sharepoint_url = 'https://citeve2.sharepoint.com/:f:/r/sites/CITEVEDEPTD/Documentos%20Partilhados/Comercial/CLIENTES?d=w4ba4efd9a0bb462987726d1e64d2f503&csf=1&web=1&e=rYfbQ0'
where id = 1 and sharepoint_url = '';
notify pgrst, 'reload schema';

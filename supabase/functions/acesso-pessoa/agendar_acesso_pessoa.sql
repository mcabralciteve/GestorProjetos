-- Agenda a rotina diária que suspende o acesso (login) de quem já saiu da empresa. Corre todos os dias às 03:00 UTC.
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado.
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
select cron.schedule(
  'acesso-pessoa-diario',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/acesso-pessoa',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('acesso-pessoa-diario');

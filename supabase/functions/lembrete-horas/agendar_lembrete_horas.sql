-- Agenda a chamada diária à função lembrete-horas (segunda a sexta, 08:00 UTC = 08h/09h em Lisboa).
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado.
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
select cron.schedule(
  'lembrete-horas-diario',
  '0 8 * * 1-5',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/lembrete-horas',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('lembrete-horas-diario');

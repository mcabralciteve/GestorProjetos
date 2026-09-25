-- Agenda a chamada diária à função lembrete-agenda (segunda a sexta, 07:30 UTC = 07h30/08h30 em
-- Lisboa — antes do lembrete de horas, para a agenda chegar ao início do dia).
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado.
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
select cron.schedule(
  'lembrete-agenda-diario',
  '30 7 * * 1-5',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/lembrete-agenda',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('lembrete-agenda-diario');

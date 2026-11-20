-- Agenda o backup automático: uma chamada por dia, às 03:00 UTC (03:00 no inverno, 04:00 no verão em Lisboa).
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado, e confirma depois que já não restam "<...>"
-- no comando (select command from cron.job where jobname = 'backup-automatico-diario').
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
-- O pg_net espera só 5 s pela resposta, e a função demora mais (gera e guarda ~1,3 MB): o "timeout" que aparece em
-- net._http_response é normal — a função acaba o trabalho na mesma (vê o ficheiro novo no bucket backups-fio).
select cron.schedule(
  'backup-automatico-diario',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/backup-automatico',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('backup-automatico-diario');

-- Agenda a chamada à função lembrete-orcprev de 10 em 10 minutos, TODOS OS DIAS.
-- Mesmo mecanismo do lembrete-horas (ver a nota grande em agendar_lembrete_horas.sql): a hora de envio a sério fica em
-- Horas → Orcprev ("lembrete_orcprev_dia" e "lembrete_orcprev_hora"), isto é só o "pulso". A função só envia no dia da semana
-- e à hora configurados, e uma vez por dia — por isso o agendamento tem de correr todos os dias (o dia escolhe-se no ecrã).
-- O nome do trabalho ('...-sexta') é histórico (começou só à sexta-feira); mantém-no para o conseguires desagendar.
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado.
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
select cron.schedule(
  'lembrete-orcprev-sexta',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/lembrete-orcprev',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('lembrete-orcprev-sexta');

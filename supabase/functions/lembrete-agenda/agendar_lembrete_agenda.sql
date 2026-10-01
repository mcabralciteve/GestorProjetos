-- Agenda a chamada à função lembrete-agenda de 10 em 10 minutos, dias úteis (segunda a sexta).
-- Mesmo mecanismo do lembrete-horas (ver a nota grande em agendar_lembrete_horas.sql): a hora de
-- envio a sério fica em Configurações → Definições ("lembrete_agenda_hora"), isto é só o "pulso".
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado.
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
-- Se já tinhas este agendamento da versão anterior (uma vez por dia, a uma hora fixa), corre isto
-- de novo — "cron.schedule" com o mesmo nome substitui o agendamento antigo pelo novo.
select cron.schedule(
  'lembrete-agenda-diario',
  '*/10 * * * 1-5',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/lembrete-agenda',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('lembrete-agenda-diario');

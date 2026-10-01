-- Agenda a chamada à função lembrete-horas de 10 em 10 minutos, dias úteis (segunda a sexta).
-- A hora de envio a sério é a configurada pelo Administrador em Configurações → Definições
-- ("lembrete_horas_hora") — é a própria função que decide, a cada chamada, se já chegou essa hora e
-- se ainda não correu hoje (ver o cabeçalho de lembrete-horas/index.ts); isto é só o "pulso" que a
-- deixa verificar com regularidade, não é a hora de envio em si. Mudar a hora de envio nunca mais
-- exige voltar aqui — só mudar o campo nas Definições.
-- Ficheiro à parte do schema.sql DE PROPÓSITO: leva o CRON_SECRET, que não deve ir para o Git —
-- troca <ref> e <CRON_SECRET> só no SQL Editor, nunca no ficheiro guardado.
-- Requer as extensões pg_cron e pg_net ativas (Database -> Extensions).
-- Se já tinhas este agendamento da versão anterior (uma vez por dia, a uma hora fixa), corre isto
-- de novo — "cron.schedule" com o mesmo nome substitui o agendamento antigo pelo novo.
select cron.schedule(
  'lembrete-horas-diario',
  '*/10 * * * 1-5',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/lembrete-horas',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- Para parar: select cron.unschedule('lembrete-horas-diario');

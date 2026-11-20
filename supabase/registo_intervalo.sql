-- Horas de ausência por intervalo (das 14:00 às 16:30): o registo passa a poder guardar a hora de início e de fim ("HH:MM"),
-- além das horas (que a app calcula a partir do intervalo). Opcionais: um registo só com horas continua válido, e os
-- existentes ficam como estão. Só cria coisas novas e é seguro correr mais do que uma vez.
-- Sem estas colunas a app continua a funcionar: só deixa de oferecer o intervalo (Sync.temIntervalo).
alter table public.registos add column if not exists hora_inicio text;
alter table public.registos add column if not exists hora_fim text;

do $$ begin
  alter table public.registos add constraint registos_intervalo_chk check (
    (hora_inicio is null and hora_fim is null)
    or (hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and hora_fim ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and hora_fim > hora_inicio)
  );
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

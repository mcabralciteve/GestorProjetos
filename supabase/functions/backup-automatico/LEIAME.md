# Backup automático diário

Todos os dias, de madrugada (03:00 UTC), a função `backup-automatico` guarda **um ficheiro `.sql` com todos os dados** da base de
dados (as 35 tabelas do schema `public`: projetos, horas, CRM, propostas, orçamentos, licenças, orcprev…) no bucket **privado**
`backups-fio` do Storage do Supabase, em `diario/fio_AAAA-MM-DD.sql`.

- **Onde ver/descarregar:** painel do Supabase → Storage → `backups-fio` → `diario`.
- **Retenção:** todos os dos últimos 30 dias + o primeiro de cada mês durante 12 meses. O resto apaga-se (só depois de o novo estar guardado).
- **Como é gerado:** dentro do Postgres (`public.gerar_backup_sql()`, só acessível à service role), por isso sai sempre completo —
  não passa pela app nem pelo limite de 1000 linhas por pedido. Cada linha vai em JSON e volta a tabela com
  `jsonb_populate_recordset`; verificou-se que todas as linhas de todas as tabelas fazem a ida e volta sem diferenças.
- **Conferir:** o cabeçalho do ficheiro tem a contagem de linhas por tabela e o fim tem uma marca `-- FIM do backup`. Um ficheiro sem
  essa marca nunca é guardado.
- **Alerta de quedas:** a função compara as contagens com o backup anterior; uma tabela (com 10+ linhas) que perca mais de 20% fica
  assinalada em `quedas` na resposta e num aviso nos logs da função (painel → Edge Functions → backup-automatico → Logs).
- **Não substitui** o backup manual (Definições → Backup, que também gera um Excel para leitura), e fica no **mesmo** projeto
  Supabase: protege contra apagões e erros de dados, não contra a perda do próprio projeto. Para isso, de vez em quando, descarrega
  um ficheiro do bucket para fora (OneDrive).

## Restaurar

Está no cabeçalho de cada ficheiro: num projeto novo, correr `supabase/schema.sql` + os restantes `supabase/*.sql`, e depois colar o
backup no SQL Editor (seguro correr duas vezes: `on conflict do nothing`; durante a carga as chaves estrangeiras não são verificadas).
As contas de login não vão no backup — cada pessoa volta a criar conta com o mesmo email.

## Instalação (uma vez)

1. **SQL**: `supabase/backup_automatico.sql` no SQL Editor (cria o bucket e a função; só cria coisas novas).
2. **Publicar a função** (usa o `CRON_SECRET` que já existe):
   ```bash
   supabase functions deploy backup-automatico --no-verify-jwt
   ```
3. **Testar sem gravar nada** (gera e confere o backup, diz quantas linhas, quais ficheiros apagaria):
   ```bash
   curl -H "x-cron-secret: <CRON_SECRET>" "https://<ref>.supabase.co/functions/v1/backup-automatico?dry=1"
   ```
4. **Agendar**: `agendar_backup_automatico.sql` (nesta pasta), depois de trocar `<ref>` e `<CRON_SECRET>`.

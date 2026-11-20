-- Backup automático diário (Edge Function "backup-automatico", ver supabase/functions/backup-automatico/LEIAME.md).
-- Só cria coisas novas e é seguro correr mais do que uma vez.
--
-- 1) Um bucket PRIVADO ("backups-fio") no Storage do Supabase, onde a função guarda um .sql por dia. Sem políticas de acesso
--    de propósito: só a service role (a própria função) e quem tem acesso ao painel do Supabase conseguem ler/escrever.
-- 2) A função public.gerar_backup_sql(): devolve, em texto, um script de RESTAURO de TODAS as tabelas do schema "public"
--    (cada linha em JSON → "insert ... select * from jsonb_populate_recordset(...) on conflict do nothing"), com a contagem
--    de linhas por tabela no cabeçalho e uma marca de fim. Lê dentro do Postgres, por isso não tem o limite de 1000 linhas
--    por pedido que a app tem. Só a service role a pode chamar (a API pública não: tem todos os dados).

insert into storage.buckets (id, name, public, file_size_limit)
values ('backups-fio', 'backups-fio', false, 104857600)
on conflict (id) do nothing;

create or replace function public.gerar_backup_sql()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  restantes text[];
  ordem text[] := '{}';
  t text;
  pendente boolean;
  progresso boolean;
  n bigint;
  desloc bigint;
  js jsonb;
  total_linhas bigint := 0;
  cab text[] := '{}';
  corpo text[] := '{}';
  passo constant int := 250;
begin
  -- Ordem das tabelas: as referenciadas (chaves estrangeiras) antes das que as referenciam. Ciclos e auto-referências
  -- ficam no fim por ordem alfabética — o script de restauro desliga a verificação das chaves (session_replication_role).
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into restantes
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
  loop
    exit when coalesce(array_length(restantes, 1), 0) = 0;
    progresso := false;
    foreach t in array restantes loop
      select exists (
        select 1 from pg_constraint k
          join pg_class tc on tc.oid = k.conrelid
          join pg_class rc on rc.oid = k.confrelid
         where k.contype = 'f' and tc.relnamespace = 'public'::regnamespace and tc.relname = t
           and rc.relnamespace = 'public'::regnamespace and rc.relname <> t and rc.relname = any (restantes)
      ) into pendente;
      if not pendente then
        ordem := ordem || t;
        restantes := array_remove(restantes, t);
        progresso := true;
      end if;
    end loop;
    if not progresso then
      ordem := ordem || restantes;
      restantes := '{}';
    end if;
  end loop;

  -- Contagens (vão para o cabeçalho) e corpo.
  foreach t in array ordem loop
    execute format('select count(*) from public.%I', t) into n;
    total_linhas := total_linhas + n;
    cab := cab || format('-- tabela %s: %s', t, n);
    if n = 0 then continue; end if;
    corpo := corpo || format(E'\n-- ---------- %s (%s linha(s)) ----------', t, n);
    desloc := 0;
    while desloc < n loop
      execute format('select jsonb_agg(to_jsonb(x)) from (select * from public.%I order by ctid limit %s offset %s) x', t, passo, desloc) into js;
      exit when js is null;
      if position('$fio$' in js::text) > 0 then
        raise exception 'dados da tabela % contêm a marca $fio$ — mudar a marca no gerar_backup_sql', t;
      end if;
      corpo := corpo || format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $fio$%s$fio$::jsonb) on conflict do nothing;', t, t, js::text);
      desloc := desloc + passo;
    end loop;
  end loop;

  return array_to_string(array[
    '-- ============================================================================',
    format('-- Backup AUTOMÁTICO de dados do FIO — gerado em %s (UTC)', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')),
    '-- ============================================================================',
    '-- Como restaurar:',
    '--   1) Num projeto Supabase NOVO (ou a limpar), corre primeiro o schema: supabase/schema.sql e depois os restantes',
    '--      ficheiros supabase/*.sql do repositório do GitHub (criam as tabelas, vazias).',
    '--   2) Cola este ficheiro inteiro no SQL Editor e corre. Seguro correr duas vezes ("on conflict do nothing").',
    '--   3) Em projeto novo, as contas de login (auth.users) não existem: cada pessoa cria conta de novo com o MESMO email',
    '--      (o trigger handle_new_user liga-a ao recurso restaurado). Se houver erro de chave estrangeira com auth.users,',
    '--      corre antes: update public.recursos set auth_user_id = null;',
    '-- Contagem de linhas por tabela (para conferir o restauro):',
    array_to_string(cab, E'\n'),
    format('-- TOTAL: %s tabela(s), %s linha(s)', coalesce(array_length(ordem, 1), 0), total_linhas),
    '-- ============================================================================',
    '',
    '-- As chaves estrangeiras não são verificadas durante a carga (a ordem das tabelas é só uma ajuda):',
    'set session_replication_role = replica;',
    'begin;',
    array_to_string(corpo, E'\n'),
    '',
    'commit;',
    'set session_replication_role = default;',
    format('-- FIM do backup — %s tabela(s), %s linha(s)', coalesce(array_length(ordem, 1), 0), total_linhas)
  ], E'\n');
end $$;

-- Só a service role (a Edge Function) pode chamar: devolve TODOS os dados.
revoke all on function public.gerar_backup_sql() from public, anon, authenticated;
grant execute on function public.gerar_backup_sql() to service_role;

notify pgrst, 'reload schema';

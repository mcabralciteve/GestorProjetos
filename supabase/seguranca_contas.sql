-- ============================================================================
-- Segurança das contas (2026-11-27)
--
-- O que muda:
--   1. Só uma conta ligada a uma PESSOA ATIVA lê ou escreve dados. Antes bastava ter sessão iniciada.
--   2. Criar conta deixa de criar uma pessoa: liga-se só a uma pessoa que o Administrador já tenha registado com esse email.
--   3. Só o Administrador altera pessoas, equipas e departamentos. Cada um continua a poder mudar o seu nome e as suas
--      preferências de lembretes. Gravações de outras pessoas não dão erro: os campos protegidos mantêm o valor antigo.
--   4. Funções que podiam ser chamadas sem sessão deixam de o poder ser.
--
-- Não apaga nem reescreve dados. Corre tudo numa transação e faz verificações no fim: se alguma falhar, nada fica gravado.
-- Pode correr-se mais do que uma vez.
--
-- IMPORTANTE para tabelas novas: a regra de acesso é  using ((select public.app_conta_ativa()))
-- e nunca  auth.role() = 'authenticated'.
-- ============================================================================
begin;

-- ---------- 1. Quem tem acesso ----------
create or replace function public.app_conta_ativa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and coalesce(r.ativo, true)
      and (r.data_saida is null or r.data_saida >= current_date)
  );
$$;

create or replace function public.app_e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_conta_ativa()
     and exists (select 1 from public.recursos r where r.auth_user_id = auth.uid() and r.acesso = 'admin');
$$;

-- As regras do CRM e das Licenças passam a exigir também que a pessoa esteja ativa.
create or replace function public.crm_e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_e_admin();
$$;

create or replace function public.crm_tem_acesso() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_conta_ativa() and exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (
        r.acesso = 'admin'
        or r.crm_acesso
        or exists (select 1 from public.departamentos d where d.diretor_id = r.id)
        or exists (select 1 from public.equipas e where e.lider_id = r.id)
      )
  );
$$;

create or replace function public.licencas_pode(p_departamento uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_conta_ativa() and exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (
        r.acesso = 'admin'
        or (p_departamento is not null and exists (
              select 1 from public.departamentos d where d.id = p_departamento and d.diretor_id = r.id))
      )
  );
$$;

create or replace function public.licencas_tem_acesso() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_conta_ativa() and exists (
    select 1 from public.recursos r
    where r.auth_user_id = auth.uid()
      and (r.acesso = 'admin' or exists (select 1 from public.departamentos d where d.diretor_id = r.id))
  );
$$;

-- Todas as regras que hoje só pedem "sessão iniciada" passam a pedir "pessoa ativa".
do $$
declare
  antiga constant text := '(auth.role() = ''authenticated''::text)';
  p record;
begin
  for p in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public' and (qual = antiga or with_check = antiga)
  loop
    execute format('alter policy %I on public.%I %s %s', p.policyname, p.tablename,
      case when p.qual is not null then 'using ((select public.app_conta_ativa()))' else '' end,
      case when p.with_check is not null then 'with check ((select public.app_conta_ativa()))' else '' end);
  end loop;
end $$;

-- ---------- 2. Contas novas ----------
-- Antes: qualquer conta nova criava uma pessoa. Agora só se liga a uma pessoa já registada com o mesmo email.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.recursos set auth_user_id = new.id
  where id = (select r.id from public.recursos r where lower(r.email) = lower(new.email) and r.auth_user_id is null limit 1);
  return new;
end;
$$;

-- Se a conta for criada antes da pessoa, a ligação faz-se quando o Administrador gravar a pessoa com esse email.
create or replace function public.recursos_ligar_conta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is null and coalesce(new.email, '') <> '' then
    new.auth_user_id := (
      select u.id from auth.users u
      where lower(u.email) = lower(new.email)
        and not exists (select 1 from public.recursos r where r.auth_user_id = u.id)
      limit 1);
  end if;
  return new;
end;
$$;

-- ---------- 3. Pessoas, equipas e departamentos: só o Administrador ----------
-- Só se aplica a pedidos da app (com ou sem sessão). Funções do servidor, SQL Editor e criação de contas não são afetados.
create or replace function public.recursos_proteger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.recursos;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') or public.app_e_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'Só o Administrador pode eliminar pessoas.'; end if;
  if tg_op = 'INSERT' then
    -- a app grava com "inserir ou atualizar": se a pessoa já existe, é a regra de atualização que decide
    if exists (select 1 from public.recursos x where x.id = new.id) then return new; end if;
    raise exception 'Só o Administrador pode criar pessoas.';
  end if;
  r := old;  -- tudo fica como estava (incluindo colunas que venham a ser criadas)
  if old.auth_user_id = auth.uid() then
    r.nome := new.nome;
    r.lembretes_email := new.lembretes_email;
    r.resumo_secoes := new.resumo_secoes;
  end if;
  return r;
end;
$$;

create or replace function public.organica_proteger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  existe boolean;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') or public.app_e_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'Só o Administrador pode eliminar equipas ou departamentos.'; end if;
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from public.%I where id = $1)', tg_table_name) into existe using new.id;
    if existe then return new; end if;
    raise exception 'Só o Administrador pode criar equipas ou departamentos.';
  end if;
  return old;
end;
$$;

drop trigger if exists a_proteger on public.recursos;
create trigger a_proteger before insert or update or delete on public.recursos
  for each row execute function public.recursos_proteger();

drop trigger if exists b_ligar_conta on public.recursos;
create trigger b_ligar_conta before insert or update on public.recursos
  for each row execute function public.recursos_ligar_conta();

drop trigger if exists a_proteger on public.equipas;
create trigger a_proteger before insert or update or delete on public.equipas
  for each row execute function public.organica_proteger();

drop trigger if exists a_proteger on public.departamentos;
create trigger a_proteger before insert or update or delete on public.departamentos
  for each row execute function public.organica_proteger();

-- ---------- 4. Funções ----------
-- Gravar um projeto passa a correr com as permissões de quem grava (as regras acima), e exige sessão.
alter function public.gravar_filhos_projeto(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) security invoker;
revoke execute on function public.gravar_filhos_projeto(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.gravar_filhos_projeto(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

-- Só usadas internamente pela base de dados: ninguém as chama de fora.
revoke execute on function public.projeto_sincronizar_proposta(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.projeto_proposta_apos_oportunidade() from public, anon, authenticated;
revoke execute on function public.projeto_proposta_apos_proposta() from public, anon, authenticated;
revoke execute on function public.recursos_ligar_conta() from public, anon, authenticated;
revoke execute on function public.recursos_proteger() from public, anon, authenticated;
revoke execute on function public.organica_proteger() from public, anon, authenticated;

-- ---------- 5. Verificações (se alguma falhar, nada disto fica gravado) ----------
do $$
declare
  uid_admin uuid; uid_normal uuid; id_normal uuid; id_outro uuid;
  n bigint; custo numeric; custo_depois numeric; acesso_depois text; recusado boolean;
begin
  select auth_user_id into uid_admin from public.recursos where acesso = 'admin' and auth_user_id is not null and coalesce(ativo, true) limit 1;
  select auth_user_id, id into uid_normal, id_normal from public.recursos where acesso <> 'admin' and auth_user_id is not null and coalesce(ativo, true) limit 1;
  select id, preco_custo into id_outro, custo from public.recursos where id <> id_normal limit 1;
  if uid_admin is null or uid_normal is null then raise exception 'verificação: faltam contas de teste (admin e normal)'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and (qual like '%''authenticated''%' or with_check like '%''authenticated''%')) then
    raise exception 'verificação: ainda há regras que só pedem sessão iniciada';
  end if;
  if has_function_privilege('anon', 'public.gravar_filhos_projeto(uuid,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'verificação: a função de gravar projetos ainda se chama sem sessão';
  end if;

  -- a) uma conta desconhecida não vê nada
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select (select count(*) from public.projetos) + (select count(*) from public.recursos) + (select count(*) from public.registos) + (select count(*) from public.crm_contas) into n;
  reset role;
  if n <> 0 then raise exception 'verificação: uma conta desconhecida ainda vê % linhas', n; end if;

  -- b) uma conta normal continua a ver tudo o que via, mas não muda acessos nem custos de ninguém
  perform set_config('request.jwt.claims', json_build_object('sub', uid_normal, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.projetos;
  update public.recursos set acesso = 'admin', crm_acesso = true where id = id_normal;
  update public.recursos set preco_custo = coalesce(preco_custo, 0) + 1 where id = id_outro;
  insert into public.recursos (id, nome, preco_custo) select id, nome, coalesce(preco_custo, 0) + 1 from public.recursos where id = id_outro
    on conflict (id) do update set preco_custo = excluded.preco_custo;
  recusado := false;
  begin
    insert into public.recursos (id, nome) values (gen_random_uuid(), 'verificação');
  exception when others then recusado := true;
  end;
  reset role;
  if n = 0 then raise exception 'verificação: uma conta normal deixou de ver os projetos'; end if;
  if not recusado then raise exception 'verificação: uma conta normal ainda cria pessoas'; end if;
  select acesso into acesso_depois from public.recursos where id = id_normal;
  select preco_custo into custo_depois from public.recursos where id = id_outro;
  if acesso_depois = 'admin' then raise exception 'verificação: uma conta normal ainda se torna administradora'; end if;
  if custo_depois is distinct from custo then raise exception 'verificação: uma conta normal ainda altera preços de custo'; end if;

  -- c) o Administrador continua a poder alterar pessoas
  perform set_config('request.jwt.claims', json_build_object('sub', uid_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.recursos set preco_custo = coalesce(preco_custo, 0) + 1 where id = id_outro;
  select preco_custo into custo_depois from public.recursos where id = id_outro;
  update public.recursos set preco_custo = custo where id = id_outro;
  reset role;
  if custo_depois is distinct from coalesce(custo, 0) + 1 then raise exception 'verificação: o Administrador deixou de conseguir alterar pessoas'; end if;

  perform set_config('request.jwt.claims', '', true);
end $$;

notify pgrst, 'reload schema';
commit;

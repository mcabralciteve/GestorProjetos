-- ============================================================================
-- Horas reais ligadas às tarefas POR ID — nunca se perdem ao renomear/reestruturar tarefas.
--
-- Problema: cada gravação de um projeto apagava e recriava as tarefas (mesmos ids), e
-- registos.tarefa_id é "on delete set null" -> TODOS os registos do projeto ficavam sem tarefa na BD
-- (no backup de 2026-10-02: 310 de 332 registos de projeto sem tarefa_id). Só sobrava o NOME da tarefa,
-- e renomear a tarefa fazia as horas desaparecerem dela.
--
-- Correr no SQL Editor do Supabase, por esta ordem (é seguro repetir):
--   1) a função gravar_filhos_projeto corrigida (guarda e repõe a ligação);
--   2) o preenchimento dos registos antigos cujo nome ainda identifica UMA só tarefa do projeto;
--   3) a lista do que ficou por ligar (nomes que já não existem) — esses escolhem-se à mão em
--      Horas -> Registo (aparecem com "Escolher tarefa").
-- ============================================================================

-- 1) Função corrigida
create or replace function public.gravar_filhos_projeto(
  p_projeto_id uuid,
  p_tarefas jsonb,           -- [{id,parent_id,nome,ordem,inicio,fim,progresso,predecessores,negrito,italico,cor}]
  p_tarefa_recursos jsonb,   -- [{tarefa_id,recurso_id,horas}]
  p_faturas jsonb,           -- [{id,data_prevista,tipo,percentagem,valor,emitida,data_emissao,emitido_por,numero_registo}]
  p_pontos_situacao jsonb,   -- [{id,data,feedback,criado_por,criado_em}]
  p_proximos_passos jsonb    -- [{id,tarefa_id,ponto_situacao_id,responsavel_id,data_prevista,data_real,descricao,estado,notas,fechado,fechado_em,criado_por,criado_em,atualizado_em}]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligacoes jsonb;
begin
  -- Os registos de horas apontam para a tarefa por id (registos.tarefa_id, "on delete set null").
  -- Como as tarefas do projeto são apagadas e recriadas (com os MESMOS ids) a cada gravação, sem
  -- isto cada gravação de um projeto desligava TODOS os seus registos das tarefas — e bastava
  -- depois renomear uma tarefa para as horas deixarem de aparecer nela. Guarda-se a ligação antes
  -- de apagar e repõe-se no fim, para as tarefas que continuam a existir.
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'tarefa_id', r.tarefa_id)), '[]'::jsonb)
    into v_ligacoes
  from registos r join tarefas t on t.id = r.tarefa_id
  where t.projeto_id = p_projeto_id;

  -- Ordem de apagar: "proximos_passos" antes de "pontos_situacao" (referencia-o), e antes de
  -- "tarefas" (também o referencia) — nunca deixa uma FK pendurada, mesmo por um instante.
  delete from proximos_passos where projeto_id = p_projeto_id;
  delete from pontos_situacao where projeto_id = p_projeto_id;
  delete from faturas where projeto_id = p_projeto_id;
  delete from tarefas where projeto_id = p_projeto_id; -- cascata: apaga também tarefa_recursos

  -- Tarefas em duas fases (como já era do lado da app): parent_id fica de fora na primeira
  -- inserção porque pode referenciar outra tarefa do mesmo lote, ainda por criar.
  insert into tarefas (id, projeto_id, parent_id, nome, ordem, inicio, fim, progresso, predecessores, negrito, italico, cor)
  select
    (x->>'id')::uuid, p_projeto_id, null, x->>'nome', coalesce((x->>'ordem')::int, 0),
    (x->>'inicio')::date, (x->>'fim')::date, coalesce((x->>'progresso')::int, 0),
    coalesce(x->'predecessores', '[]'::jsonb),
    coalesce((x->>'negrito')::boolean, false), coalesce((x->>'italico')::boolean, false), x->>'cor'
  from jsonb_array_elements(coalesce(p_tarefas, '[]'::jsonb)) as x;

  update tarefas t set parent_id = (x->>'parent_id')::uuid
  from jsonb_array_elements(coalesce(p_tarefas, '[]'::jsonb)) as x
  where t.id = (x->>'id')::uuid and x->>'parent_id' is not null;

  insert into tarefa_recursos (tarefa_id, recurso_id, horas)
  select (x->>'tarefa_id')::uuid, (x->>'recurso_id')::uuid, nullif(x->>'horas', '')::numeric
  from jsonb_array_elements(coalesce(p_tarefa_recursos, '[]'::jsonb)) as x;

  insert into faturas (id, projeto_id, data_prevista, tipo, percentagem, valor, emitida, data_emissao, emitido_por, numero_registo)
  select
    (x->>'id')::uuid, p_projeto_id, nullif(x->>'data_prevista', '')::date, x->>'tipo',
    coalesce((x->>'percentagem')::numeric, 0), coalesce((x->>'valor')::numeric, 0), coalesce((x->>'emitida')::boolean, false),
    nullif(x->>'data_emissao', '')::date, coalesce(x->>'emitido_por', ''), coalesce(x->>'numero_registo', '')
  from jsonb_array_elements(coalesce(p_faturas, '[]'::jsonb)) as x;

  insert into pontos_situacao (id, projeto_id, data, feedback, criado_por, criado_em)
  select
    (x->>'id')::uuid, p_projeto_id, (x->>'data')::date, coalesce(x->>'feedback', ''),
    nullif(x->>'criado_por', '')::uuid, coalesce((x->>'criado_em')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_pontos_situacao, '[]'::jsonb)) as x;

  insert into proximos_passos (id, projeto_id, tarefa_id, ponto_situacao_id, responsavel_id, data_prevista, data_real,
    descricao, estado, notas, fechado, fechado_em, criado_por, criado_em, atualizado_em)
  select
    (x->>'id')::uuid, p_projeto_id, nullif(x->>'tarefa_id', '')::uuid, nullif(x->>'ponto_situacao_id', '')::uuid,
    nullif(x->>'responsavel_id', '')::uuid, nullif(x->>'data_prevista', '')::date, nullif(x->>'data_real', '')::date,
    x->>'descricao', coalesce(x->>'estado', 'aberto'), coalesce(x->>'notas', ''), coalesce((x->>'fechado')::boolean, false),
    nullif(x->>'fechado_em', '')::timestamptz, nullif(x->>'criado_por', '')::uuid,
    coalesce((x->>'criado_em')::timestamptz, now()), coalesce((x->>'atualizado_em')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_proximos_passos, '[]'::jsonb)) as x;

  -- Repõe a ligação registo -> tarefa (só se a tarefa ainda existir; uma tarefa apagada de propósito
  -- deixa os registos sem tarefa, como sempre, mas as horas continuam no total do projeto).
  update registos r set tarefa_id = (l->>'tarefa_id')::uuid
  from jsonb_array_elements(v_ligacoes) as l
  where r.id = (l->>'id')::uuid and r.tarefa_id is null
    and exists (select 1 from tarefas t where t.id = (l->>'tarefa_id')::uuid);
end;
$$;
grant execute on function public.gravar_filhos_projeto(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- 2) Preenche registos antigos: nome igual (sem maiúsculas/espaços) ao de UMA só tarefa do projeto.
with nomes as (
  select p.id as projeto_id, p.id_interno, lower(trim(t.nome)) as nome, count(*) as n, min(t.id::text)::uuid as tarefa_id
  from tarefas t join projetos p on p.id = t.projeto_id
  group by p.id, p.id_interno, lower(trim(t.nome))
)
update registos r set tarefa_id = n.tarefa_id
from nomes n
where r.tarefa_id is null and n.n = 1 and lower(trim(r.tarefa_nome)) = n.nome
  and ((r.projeto_id is not null and r.projeto_id = n.projeto_id)
    or (r.projeto_id is null and coalesce(r.projeto_id_interno, '') <> '' and r.projeto_id_interno = n.id_interno));

-- 3) O que continua sem tarefa (por projeto) — para ligares à mão na app.
select coalesce(p.id_interno, r.projeto_id_interno) as projeto, coalesce(p.nome, r.projeto_nome) as nome,
       count(*) as registos, sum(r.horas) as horas
from registos r left join projetos p on p.id = r.projeto_id
where r.tarefa_id is null and coalesce(r.projeto_id_interno, '') <> ''
group by 1, 2 order by horas desc;

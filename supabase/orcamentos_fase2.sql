-- ============================================================================
-- Propostas e Orçamentação — Fase 2: faturação a partir do orçamento validado
--
-- O projeto guarda uma CÓPIA (snapshot) do orçamento validado (orcamento_base): total e valor de cada rubrica
-- (consultoria, formação, deslocações, consumíveis, produtos). Assim a Faturação não precisa de ler o CRM (que tem
-- acesso restrito). Cada fatura prevista pode ser "por rubricas": lista de { k (rubrica), tipo ('percentagem'|'valor'),
-- percentagem, valor } — o valor da fatura é a soma. Mais tarde associa-se o nº de fatura do GIAF e emite-se.
--
-- Correr no SQL Editor do Supabase ANTES de publicar a nova versão da app. Idempotente. Requer orcamentos_fase1.sql.
-- ============================================================================
alter table public.projetos add column if not exists orcamento_id uuid references public.crm_orcamentos(id) on delete set null;
alter table public.projetos add column if not exists orcamento_base jsonb;
alter table public.faturas add column if not exists rubricas jsonb;

-- A função que grava um projeto de uma vez passa a gravar também as rubricas de cada fatura (resto igual: inclui a
-- proteção que repõe a ligação registo -> tarefa).
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

  insert into faturas (id, projeto_id, data_prevista, tipo, percentagem, valor, emitida, data_emissao, emitido_por, numero_registo, rubricas)
  select
    (x->>'id')::uuid, p_projeto_id, nullif(x->>'data_prevista', '')::date, x->>'tipo',
    coalesce((x->>'percentagem')::numeric, 0), coalesce((x->>'valor')::numeric, 0), coalesce((x->>'emitida')::boolean, false),
    nullif(x->>'data_emissao', '')::date, coalesce(x->>'emitido_por', ''), coalesce(x->>'numero_registo', ''),
    case when jsonb_typeof(x->'rubricas') = 'array' then x->'rubricas' else null end
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

notify pgrst, 'reload schema';

-- ============================================================================
-- Pontual: as 24 licenças importadas da folha "Novas Aquisições" do mapa "Licenciamento IA.xlsx" foram aprovadas;
-- passam a "Em processo de aquisição" (ainda não compradas, por isso ainda não contam para os custos).
--
-- Só mexe nas linhas importadas dessa folha (notas «Importado do mapa … Novas Aquisições»), seja qual for o estado em que estejam
-- agora (por aprovar, ou ativa por terem sido aprovadas na versão anterior da app). As 4 licenças atuais e tudo o resto ficam como estão.
--   • estado → em_aquisicao
--   • registo da aprovação: mantém o que já existir; se não houver, fica "Aprovação registada manualmente" e a data de agora
--   • data de início e de renovação → vazias, SE a licença estava "ativa" (a versão anterior preenchia-as ao aprovar); serão
--     preenchidas quando carregares em «✔ Adquirida». Datas de licenças que já estavam em aquisição/por aprovar não se tocam.
-- Seguro de repetir (a segunda vez não encontra nada para alterar). Mostra as linhas alteradas.
-- ============================================================================
with alvo as (
  select id, estado as estado_antes
  from public.licencas
  where notas like 'Importado do mapa%Novas Aquisições%' and estado in ('por_aprovar', 'ativa')
),
alterada as (
  update public.licencas l
  set estado = 'em_aquisicao',
      decisao_por_nome = case when l.decisao_em is null or l.decisao_por_nome = '' then 'Aprovação registada manualmente' else l.decisao_por_nome end,
      decisao_em = coalesce(l.decisao_em, now()),
      motivo_decisao = '',
      data_inicio = case when a.estado_antes = 'ativa' then null else l.data_inicio end,
      data_renovacao = case when a.estado_antes = 'ativa' then null else l.data_renovacao end,
      atualizado_em = now(),
      atualizado_por_nome = 'Ajuste: aprovadas, em aquisição'
  from alvo a
  where l.id = a.id
  returning l.id, l.nome, l.valor, l.periodicidade, l.responsavel_id, a.estado_antes
)
select x.estado_antes as estava, 'em_aquisicao' as passou_a, x.nome, coalesce(r.nome, '—') as responsavel, x.valor, x.periodicidade
from alterada x
left join public.recursos r on r.id = x.responsavel_id
order by x.nome, r.nome;

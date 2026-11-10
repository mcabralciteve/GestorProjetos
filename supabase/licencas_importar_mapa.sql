-- ============================================================================
-- Importação inicial do mapa "Licenciamento IA.xlsx" para Ativos → Licenças
--   • folha "Novas Aquisições"  → 24 licenças em estado "Por aprovar" (a aguardar a aprovação do Diretor)
--   • folha "Licenças Atuais"   → 4 licenças ativas (ChatGPT, Perplexity, Gamma, Claude)
--
-- ANTES: correr supabase/licencas.sql (cria a tabela e os estados do ciclo de aprovação).
-- SÓ INSERE linhas novas em public.licencas; não altera nem apaga nada. Seguro de repetir: o que já foi importado não se repete
-- (mesmo software + responsável + valor + marca "Importado do mapa" nas notas).
--
-- Como as linhas são ligadas à app (por nome, sem acentos nem maiúsculas):
--   responsável    = a pessoa em "recursos" com o mesmo nome (se não houver exatamente uma, fica sem responsável);
--   departamento   = o da EQUIPA da coluna "Equipa" do mapa (DCS, DSA, …); se a equipa não existir, o da equipa da pessoa;
--   projeto        = o projeto da app com esse nome/cliente (só se houver exatamente um); senão fica só o texto do mapa;
--   financiamento  = 0,5 → 50 %, 0,85 → 85 %.
-- Valores: "Claude Team" 18 €/mês por pessoa (216 €/ano); OpenArt 39,55 €/mês; Adobe 155,21 €/ano.
--
-- O resultado (última tabela) mostra, linha a linha, a que pessoa/departamento/projeto ficou ligada — confirma que não há
-- "⚠" onde esperavas um valor. As licenças ATUAIS não trazem departamento no mapa: escreve em baixo o nome do departamento a
-- que pertencem (ou deixa vazio: ficam sem departamento e só o Administrador as vê, até as editar na app).
-- ============================================================================
with cfg as (
  select ''::text as departamento_atuais   -- <<< EDITAR: nome do departamento das licenças atuais (ex.: 'Departamento X'); vazio = nenhum
),
fonte(equipa, elemento, nome, fornecedor, periodicidade, valor, n_licencas, projeto, taxa, estado, notas) as (values
    ('DCS', 'Milton Cabral', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DCS', 'Hugo Costa', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DCS', 'André Azevedo', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DSA', 'Daniela Quintas', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DSA', 'Carlos Gomes', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DSA', 'Eduardo Dias', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DSA', 'João Lourenço', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'DIH 2.0', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DSA', 'Miguel Martins', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 50, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DCS', 'Mavilde Anjos', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DPC', 'Maria João Neves', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DPC', 'Gualter Barros', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DPC', 'Mariana Roque', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DPC', 'Iulia Ionita', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DTD', 'João Oliveira', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DEV', 'Guilherme Maia', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DEV', 'João Freire', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('RPA', 'Nelson Rodrigues', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'CLOTIFY', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('RPA', 'Cláudio Ribeiro', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'CLOTIFY', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('RPA', 'Daniel Borges', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'CLOTIFY', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('RPA', 'João Cruz', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'CLOTIFY', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('RPA', 'Ricardo Maia', 'Claude Team', 'Anthropic', 'mensal', 18, 1, 'CLOTIFY', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DPC', 'Maria João Neves', 'OpenArt', 'OpenArt', 'mensal', 39.55, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação.'),
    ('DPC', 'Maria João Neves', 'Adobe Creative Cloud Education', 'Adobe', 'anual', 155.21, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação. ATENÇÃO: esta linha aparece repetida (2×) no mapa — confirmar se são mesmo 2 licenças.'),
    ('DPC', 'Maria João Neves', 'Adobe Creative Cloud Education', 'Adobe', 'anual', 155.21, 1, 'SIAC + DIGITALIZAÇÃO', 85, 'por_aprovar', 'Importado do mapa «Licenciamento IA.xlsx» (folha Novas Aquisições): pedido enviado para aprovação. ATENÇÃO: esta linha aparece repetida (2×) no mapa — confirmar se são mesmo 2 licenças.'),
    (NULL, NULL, 'ChatGPT Business', 'OpenAI', 'mensal', 132, 6, NULL, 0, 'ativa', 'Importado do mapa «Licenciamento IA.xlsx» (folha Licenças Atuais). O mapa não indica responsável, departamento nem data de renovação: completar. Valor do mapa: 22 € × 6 lugares por mês (1584 €/ano).'),
    (NULL, NULL, 'Perplexity Pro', 'Perplexity', 'anual', 408, 1, NULL, 0, 'ativa', 'Importado do mapa «Licenciamento IA.xlsx» (folha Licenças Atuais). O mapa não indica responsável, departamento nem data de renovação: completar.'),
    (NULL, NULL, 'Gamma Pro', 'Gamma', 'mensal', 18, 1, NULL, 0, 'ativa', 'Importado do mapa «Licenciamento IA.xlsx» (folha Licenças Atuais). O mapa não indica responsável, departamento nem data de renovação: completar. Valor do mapa: 18 €/mês (216 €/ano).'),
    (NULL, NULL, 'Claude Pro', 'Anthropic', 'anual', 180, 1, NULL, 0, 'ativa', 'Importado do mapa «Licenciamento IA.xlsx» (folha Licenças Atuais). O mapa não indica responsável, departamento nem data de renovação: completar.')
),
n as (   -- nomes sem acentos e em minúsculas
  select f.*,
    translate(lower(btrim(coalesce(f.elemento, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as n_elemento,
    translate(lower(btrim(coalesce(f.equipa, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as n_equipa,
    translate(lower(btrim(coalesce(f.projeto, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as n_projeto
  from fonte f
),
resolvido as (
  select n.*,
    (select (array_agg(r.id))[1] from public.recursos r
      where translate(lower(btrim(r.nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = n.n_elemento having count(*) = 1) as responsavel_id,
    (select (array_agg(e.departamento_id))[1] from public.equipas e
      where translate(lower(btrim(e.nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = n.n_equipa having count(*) = 1) as dep_da_equipa,
    coalesce(
      (select (array_agg(p.id))[1] from public.projetos p      -- 1.º: nome ou cliente exatamente iguais
        where n.n_projeto <> '' and (translate(lower(btrim(p.nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = n.n_projeto or translate(lower(btrim(p.cliente)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = n.n_projeto) having count(*) = 1),
      (select (array_agg(p.id))[1] from public.projetos p      -- 2.º: o nome contém o texto do mapa
        where n.n_projeto <> '' and translate(lower(btrim(p.nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like '%' || n.n_projeto || '%' having count(*) = 1)
    ) as projeto_id
  from n
),
completo as (
  select r.*,
    coalesce(
      case when r.estado = 'ativa' then (select d.id from public.departamentos d, cfg
        where cfg.departamento_atuais <> '' and translate(lower(btrim(d.nome)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = translate(lower(btrim(cfg.departamento_atuais)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') limit 1) end,
      r.dep_da_equipa,
      (select e.departamento_id from public.recursos x join public.equipas e on e.id = x.equipa_id where x.id = r.responsavel_id)
    ) as departamento_id
  from resolvido r
),
inseridas as (
  insert into public.licencas (nome, fornecedor, tipo, periodicidade, n_licencas, valor, responsavel_id, departamento_id,
                               renovacao_automatica, projeto_id, projeto_nome, taxa_financiamento, estado, notas, criado_por_nome, atualizado_por_nome)
  select f.nome, f.fornecedor, 'subscricao', f.periodicidade, f.n_licencas, f.valor, f.responsavel_id, f.departamento_id,
         true, f.projeto_id, coalesce(f.projeto, ''), f.taxa, f.estado, f.notas, 'Importação do mapa', 'Importação do mapa'
  from completo f
  where (select count(*) from public.licencas l
          where l.nome = f.nome and l.valor = f.valor and l.periodicidade = f.periodicidade
            and l.responsavel_id is not distinct from f.responsavel_id and l.notas like 'Importado do mapa%')
      < (select count(*) from completo f2
          where f2.nome = f.nome and f2.valor = f.valor and f2.periodicidade = f.periodicidade
            and f2.responsavel_id is not distinct from f.responsavel_id)
  returning id, nome, estado, valor, periodicidade, responsavel_id, departamento_id, projeto_id, projeto_nome, taxa_financiamento
)
select i.estado, i.nome,
       coalesce(r.nome, '⚠ sem responsável') as responsavel,
       coalesce(d.nome, '⚠ sem departamento') as departamento,
       case when i.projeto_id is not null then 'ligado: ' || p.nome else coalesce(nullif(i.projeto_nome, ''), '—') || '  (só texto)' end as projeto,
       i.valor, i.periodicidade, i.taxa_financiamento as taxa_pct
from inseridas i
left join public.recursos r on r.id = i.responsavel_id
left join public.departamentos d on d.id = i.departamento_id
left join public.projetos p on p.id = i.projeto_id
order by i.estado desc, d.nome nulls first, i.nome, r.nome;

-- ============================================================================
-- Proposta adjudicada no projeto
--
-- O gestor de projeto vê, nos "Dados do Projeto", o link da proposta adjudicada. Os dados comerciais (CRM) só são lidos por
-- quem tem acesso ao CRM, por isso o link é COPIADO para o próprio projeto (coluna nova, lida por quem vê o projeto).
--
-- SÓ ACRESCENTA uma coluna a "projetos" e duas funções/gatilhos. Não apaga nem reescreve nada do que já existe.
--   projetos.proposta_link   ligação (https://…) ou caminho da proposta adjudicada; '' = sem proposta registada
--
-- Como se preenche:
--   1) já agora, para os projetos que estão ligados a uma oportunidade do CRM (só os que ainda não têm link): a proposta aceite da
--      oportunidade, ou, se nenhuma estiver aceite, a de versão mais alta (a mesma regra do CRM) — só se tiver documento registado;
--   2) daqui em diante, sempre que no CRM se grava uma proposta (documento/estado) ou se liga uma oportunidade a um projeto;
--   3) à mão, no próprio projeto (Administrador ou gestor do projeto) — para projetos que não vieram do CRM.
-- O gatilho nunca apaga um link: só escreve quando a proposta tem documento registado.
-- Seguro de correr mais do que uma vez.
-- ============================================================================
alter table public.projetos add column if not exists proposta_link text not null default '';

-- Copia o documento da proposta vigente de uma oportunidade para o projeto a que ela está ligada.
create or replace function public.projeto_sincronizar_proposta(p_oportunidade uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_projeto uuid;
  v_link text;
begin
  select o.projeto_id into v_projeto from public.crm_oportunidades o where o.id = p_oportunidade;
  if v_projeto is null then return; end if;
  select pr.caminho_documento into v_link
  from public.crm_propostas pr
  where pr.oportunidade_id = p_oportunidade and btrim(pr.caminho_documento) <> ''
  order by (pr.estado = 'aceite') desc, pr.versao desc, pr.atualizado_em desc
  limit 1;
  if v_link is null then return; end if;
  update public.projetos set proposta_link = btrim(v_link) where id = v_projeto and proposta_link is distinct from btrim(v_link);
end;
$$;

create or replace function public.projeto_proposta_apos_proposta()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.projeto_sincronizar_proposta(new.oportunidade_id);
  return new;
end;
$$;

create or replace function public.projeto_proposta_apos_oportunidade()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.projeto_id is not null then perform public.projeto_sincronizar_proposta(new.id); end if;
  return new;
end;
$$;

drop trigger if exists projeto_proposta_apos_proposta on public.crm_propostas;
create trigger projeto_proposta_apos_proposta
  after insert or update of caminho_documento, estado, versao on public.crm_propostas
  for each row execute function public.projeto_proposta_apos_proposta();

drop trigger if exists projeto_proposta_apos_oportunidade on public.crm_oportunidades;
create trigger projeto_proposta_apos_oportunidade
  after insert or update of projeto_id on public.crm_oportunidades
  for each row execute function public.projeto_proposta_apos_oportunidade();

-- Preenchimento inicial dos projetos que já estão ligados a uma oportunidade (só onde ainda não há link).
update public.projetos p
set proposta_link = x.link
from (
  select distinct on (o.projeto_id) o.projeto_id, btrim(pr.caminho_documento) as link
  from public.crm_oportunidades o
  join public.crm_propostas pr on pr.oportunidade_id = o.id
  where o.projeto_id is not null and btrim(pr.caminho_documento) <> ''
  order by o.projeto_id, (pr.estado = 'aceite') desc, pr.versao desc, pr.atualizado_em desc
) x
where x.projeto_id = p.id and p.proposta_link = '';

notify pgrst, 'reload schema';

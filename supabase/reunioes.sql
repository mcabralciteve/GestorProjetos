-- ============================================================================
-- Reuniões (módulo "Reuniões"): identificação, participantes, notas, ficheiros (ligações), decisões/ações e ata
--
-- SÓ CRIA uma tabela nova. Não altera nem apaga nenhum dado existente. Seguro de correr mais do que uma vez.
--
-- Uma reunião é um documento que se edita de uma vez, por isso os participantes, as ligações a ficheiros e as
-- decisões/ações são listas (JSON) na própria linha — uma gravação, uma transação, sem tabelas filhas.
--   participantes  [{id, tipo: 'recurso'|'contacto'|'externo', ref_id, nome, organizacao, cargo, email, presente}]
--   ficheiros      [{id, nome, ligacao}]          só a ligação (OneDrive/SharePoint); a app não guarda ficheiros
--   pontos         [{id, tipo: 'decisao'|'acao', texto, responsavel, responsavel_recurso_id, prazo, concluida}]
--   versao         sobe a cada gravação; a app só grava se a versão ainda for a que a pessoa abriu (duas pessoas a editar
--                  a mesma reunião: a segunda é avisada em vez de apagar o trabalho da primeira)
--   ata_versao     quantas vezes a ata foi emitida (0 = ainda nenhuma)
--
-- "projeto_id" tem FK (eliminar um projeto deixa a reunião, sem projeto). "conta_id" e "oportunidade_id" são só ids do CRM,
-- sem FK de propósito: o CRM não entra no backup manual, e uma FK impediria restaurar as reuniões numa base nova. O nome do
-- cliente, do projeto e da oportunidade ficam também guardados em texto (quem não tem acesso ao CRM continua a vê-los).
--
-- Quem pode ver/editar é decidido pela app (como nos projetos): a RLS aqui é a mesma das outras tabelas.
-- ============================================================================
create table if not exists public.reunioes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(btrim(titulo)) > 0),
  data_hora timestamptz not null,
  duracao_min integer,
  local text not null default '',
  estado text not null default 'agendada' check (estado in ('agendada', 'realizada', 'cancelada')),
  projeto_id uuid references public.projetos(id) on delete set null,
  conta_id uuid,
  oportunidade_id uuid,
  cliente text not null default '',
  projeto_nome text not null default '',
  oportunidade_titulo text not null default '',
  ordem_trabalhos text not null default '',
  notas text not null default '',
  participantes jsonb not null default '[]'::jsonb,
  ficheiros jsonb not null default '[]'::jsonb,
  pontos jsonb not null default '[]'::jsonb,
  ata_versao integer not null default 0,
  ata_emitida_em timestamptz,
  ata_emitida_por text not null default '',
  versao integer not null default 1,
  criado_por_user uuid,
  criado_por_nome text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_por_nome text not null default '',
  atualizado_em timestamptz not null default now()
);
create index if not exists reunioes_data_hora_idx on public.reunioes(data_hora desc);
create index if not exists reunioes_projeto_idx on public.reunioes(projeto_id);

alter table public.reunioes enable row level security;
drop policy if exists "autenticados_acesso_total" on public.reunioes;
create policy "autenticados_acesso_total" on public.reunioes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on public.reunioes to authenticated;
grant select, insert, update, delete on public.reunioes to service_role;

notify pgrst, 'reload schema';

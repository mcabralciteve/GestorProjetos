-- ============================================================================
-- Comentários nas tarefas dos projetos
--
-- SÓ CRIA uma tabela nova. Não altera nem apaga nenhum dado existente. Seguro de correr mais do que uma vez.
--
-- Porque é que "tarefa_id" NÃO tem chave estrangeira para "tarefas": a função gravar_filhos_projeto apaga e volta a
-- criar TODAS as tarefas de um projeto (com os mesmos ids) a cada gravação. Com uma FK "on delete cascade" cada gravação
-- levava consigo todos os comentários. Assim, os comentários sobrevivem às gravações; se uma tarefa for mesmo eliminada,
-- os seus comentários ficam sem tarefa (invisíveis, inofensivos) e voltam a aparecer se a eliminação for desfeita.
-- O projeto, esse sim, tem FK: eliminar um projeto apaga os seus comentários.
--
--   autor_user_id  id da conta de quem escreveu (para só essa pessoa poder editar/apagar o seu comentário)
--   autor_nome     nome de quem escreveu, guardado no momento (o histórico não muda se a pessoa for renomeada/sair)
--   editado_em     preenchido quando o autor altera o texto (a app mostra "editado")
-- ============================================================================
create table if not exists public.tarefa_comentarios (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  tarefa_id uuid not null,
  autor_user_id uuid,
  autor_nome text not null default '',
  texto text not null check (length(btrim(texto)) > 0),
  criado_em timestamptz not null default now(),
  editado_em timestamptz
);
create index if not exists tarefa_comentarios_tarefa_idx on public.tarefa_comentarios(tarefa_id, criado_em);
create index if not exists tarefa_comentarios_projeto_idx on public.tarefa_comentarios(projeto_id);

-- Mesmo critério das restantes tabelas: o acesso real é decidido pela app (quem vê o projeto, autor/gestor/admin).
alter table public.tarefa_comentarios enable row level security;
drop policy if exists "autenticados_acesso_total" on public.tarefa_comentarios;
create policy "autenticados_acesso_total" on public.tarefa_comentarios for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
grant select, insert, update, delete on public.tarefa_comentarios to authenticated;
grant select, insert, update, delete on public.tarefa_comentarios to service_role;

notify pgrst, 'reload schema';

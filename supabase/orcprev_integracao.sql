-- ============================================================================
-- Integração de horas com o orcprev (Via A: copiar a semana no Gestor, importar no orcprev)
--
-- SÓ ACRESCENTA duas colunas de texto, vazias por omissão. Não apaga nem reescreve nenhum dado.
--   projetos.orcprev_ref              código OU nome do projeto no orcprev (opcional). Se estiver vazio, o importador
--                                     tenta casar pelo nome do projeto no Gestor.
--   tipos_trabalho.orcprev_atividade  código da atividade do orcprev que corresponde a este tipo de trabalho
--                                     (ex.: INTERNAL_MEETINGS). Vazio = as horas deste tipo NÃO são enviadas.
--
-- Não há tabela de "envios": o orcprev marca as linhas que vêm do Gestor com "[Gestor]" na nota, e é aí que o
-- importador sabe o que substituir quando se reenvia a mesma semana. Nada fica guardado no Gestor.
--
-- Seguro de correr mais do que uma vez. Enquanto não for corrido, a app continua a funcionar como sempre —
-- só não grava estes dois campos (ver Sync.temOrcprev).
-- ============================================================================
alter table public.projetos add column if not exists orcprev_ref text not null default '';
alter table public.tipos_trabalho add column if not exists orcprev_atividade text not null default '';

notify pgrst, 'reload schema';

-- Cada pessoa escolhe que secções do resumo diário por email quer receber ("A minha conta"). Guarda só o que
-- DESLIGOU: {"proximas": false, "followups": false}; uma secção em falta continua ligada (por omissão recebe tudo).
-- Chaves: hoje, atrasadas, passos, proximas, aprovacoes, followups, oportunidades.
alter table public.recursos add column if not exists resumo_secoes jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';

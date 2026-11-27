-- Cliente do projeto ligado à conta do CRM (2026-11-27).
-- Só acrescenta uma coluna vazia: não altera nem apaga dados. Pode correr-se mais do que uma vez.
-- Sem chave estrangeira de propósito (como em "reunioes"): o CRM não entra no backup manual e um restauro não pode falhar por isso.
-- O nome do cliente continua em projetos.cliente (passa a ser o nome da conta escolhida), para quem não tem acesso ao CRM.
alter table public.projetos add column if not exists conta_id uuid;

# Agenda do dia por email

Todos os dias úteis, à hora configurada pelo Administrador (**Configurações → Definições**, por
omissão 07:30), cada pessoa **com conta na app e email** que tenha tarefas previstas para hoje
recebe a lista — as mesmas do cartão "A minha agenda de hoje" do Início (tarefas-folha de projetos
ativos, atribuídas à pessoa, com hoje dentro do período). Não envia nada a quem não tem tarefas hoje
nem a quem está ausente/de férias. Cada pessoa pode desligar estes emails em **A minha conta**.

Usa a mesma infraestrutura do lembrete de horas (Microsoft Graph, `CRON_SECRET`, Modo piloto, hora
de envio configurável, parâmetros de teste `dry`/`apenas`/`destino`/`forcar`) — instala primeiro
essa (ver `../lembrete-horas/LEIAME.md`).

## Instalação (uma vez, depois de o lembrete de horas estar a funcionar)

1. **Colunas novas** — SQL Editor do Supabase:
   ```sql
   alter table public.configuracoes add column if not exists lembrete_agenda_ativo boolean not null default false;
   alter table public.recursos add column if not exists lembretes_email boolean not null default true;
   notify pgrst, 'reload schema';
   ```
2. **Republicar as duas funções** (a de horas passou a partilhar código com esta; e ler `lembretes_email`):
   ```bash
   npx supabase functions deploy lembrete-horas --no-verify-jwt
   npx supabase functions deploy lembrete-agenda --no-verify-jwt
   ```
3. **Testar sem enviar** e depois enviando o email de um colega para ti:
   ```bash
   curl.exe -H "x-cron-secret: a-tua-frase" "https://<ref>.supabase.co/functions/v1/lembrete-agenda?dry=1&forcar=1"
   curl.exe -H "x-cron-secret: a-tua-frase" "https://<ref>.supabase.co/functions/v1/lembrete-agenda?forcar=1&apenas=colega@citeve.pt&destino=o.teu@email.pt"
   ```
4. **Agendar** com `agendar_lembrete_agenda.sql` (troca `<ref>` e `<CRON_SECRET>` só no SQL Editor)
   — agenda uma verificação de 10 em 10 minutos, não a hora de envio em si (ver a nota grande em
   `agendar_lembrete_horas.sql`).
5. Ligar **Enviar a agenda do dia** em Configurações → Definições, e definir aí a hora de envio.

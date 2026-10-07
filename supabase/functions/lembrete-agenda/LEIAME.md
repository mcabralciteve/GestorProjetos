# Resumo diário por email

Todos os dias úteis, à hora configurada pelo Administrador (**Configurações → Definições**, por
omissão 07:30), cada pessoa **com conta na app e email** recebe um resumo só com o que lhe diz respeito.
Cada secção só aparece se tiver conteúdo; quem não tem nada, ou está ausente/de férias, não recebe email.

| Secção | O que mostra |
|---|---|
| Tarefas de hoje | as do cartão "A minha agenda de hoje" do Início (tarefas-folha de projetos ativos com hoje no período), com % concluída, horas previstas (se definidas) e horas já registadas |
| Em atraso | tarefas suas com data de fim passada e menos de 100% (as mais recentes primeiro) |
| Next steps abertos | next steps de que é responsável (abertos ou em curso, não fechados), os atrasados primeiro |
| Nos próximos dias | tarefas que começam nos próximos 7 dias |
| Pedidos de ausência por aprovar | só para quem decide: o Administrador (todos), o líder da equipa e o diretor do departamento (os da sua equipa/departamento, nunca o próprio pedido) |
| Comercial — follow-ups | só para quem vê o Comercial (Administrador, diretores, líderes): os seus follow-ups por fazer até hoje, os atrasados primeiro |
| Comercial — oportunidades a fechar | idem: as suas oportunidades em curso com fecho previsto ultrapassado ou nos próximos 7 dias, com valor |

Cada lista mostra no máximo 8 tarefas / 10 next steps ("… e mais N"). As horas registadas só contam registos
ligados à tarefa por id. Cada pessoa pode desligar estes emails em **A minha conta**.

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
5. Ligar **Enviar o resumo diário** em Configurações → Definições, e definir aí a hora de envio.

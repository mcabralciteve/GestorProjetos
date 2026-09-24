# Lembrete diário de horas em falta

Todos os dias úteis de manhã, cada pessoa **com conta na app e email** que tenha dias com menos de
8h registadas nos últimos 10 dias úteis recebe um email com esses dias e as horas que faltam.
Feriados, fins de semana e ausências (aprovadas ou pendentes) não contam; "hoje" também não. A
lógica é a mesma do cartão "Os meus dias por preencher" do Início (`logica.ts` espelha
`App.diasIncompletosRecurso`, verificado com o mesmo cenário nos dois).

Nada é enviado enquanto o interruptor **Configurações → Definições → Lembretes automáticos por
email** estiver desligado (vem desligado por omissão).

## Instalação (uma vez)

1. **Coluna do interruptor.** No SQL Editor do Supabase:
   ```sql
   alter table public.configuracoes add column if not exists lembrete_horas_ativo boolean not null default false;
   notify pgrst, 'reload schema';
   ```
   (Sem isto, "Guardar" nas Definições dá erro "Could not find the 'lembrete_horas_ativo' column".)

2. **Serviço de email (Resend, resend.com).** Cria conta, adiciona e verifica o domínio de envio
   (registos SPF/DKIM — pede ao IT do CITEVE) e cria uma API key. Sem domínio verificado só dá
   para enviar para o teu próprio email, o que serve para testar.

3. **Publicar a função** (Supabase CLI, na pasta do projeto, com `supabase login` e
   `supabase link --project-ref <ref>` feitos):
   ```bash
   supabase secrets set CRON_SECRET="<inventa uma frase longa e aleatória>" RESEND_API_KEY="re_..." EMAIL_FROM="Gestor de Projetos <lembretes@teudominio.pt>"
   supabase functions deploy lembrete-horas --no-verify-jwt
   ```
   `--no-verify-jwt` é necessário porque quem a chama é o agendador, não um utilizador; a função
   recusa (401) qualquer pedido sem o `CRON_SECRET`.

4. **Testar sem enviar nada** (devolve quem receberia e quantos dias):
   ```bash
   curl -H "x-cron-secret: <CRON_SECRET>" "https://<ref>.supabase.co/functions/v1/lembrete-horas?dry=1&forcar=1"
   ```
   Depois, enviar só para ti: `...?apenas=o.teu@email.pt&forcar=1`.

5. **Agendar** — ativa as extensões `pg_cron` e `pg_net` (Database → Extensions) e corre
   `agendar_lembrete_horas.sql` (nesta pasta), depois de trocar `<ref>` e `<CRON_SECRET>`.

6. Liga o interruptor nas Definições.

## Parâmetros

| Parâmetro | Efeito |
|---|---|
| `dry=1` | não envia; devolve a lista |
| `apenas=a@b.pt` | só considera esse endereço |
| `destino=eu@b.pt` | envia os emails calculados para este endereço (com `[TESTE]` no assunto) em vez de para cada pessoa; usa com `apenas=` para ver o email de um colega sem o incomodar |
| `forcar=1` | ignora "hoje não é dia útil" e o interruptor desligado |

O horário do agendamento está em UTC (Lisboa = UTC+0 no inverno, +1 no verão).

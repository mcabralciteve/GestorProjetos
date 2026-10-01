# Lembrete diário de horas em falta

Todos os dias úteis, à hora configurada pelo Administrador (**Configurações → Definições → Horas de
envio**, por omissão 08:00), cada pessoa **com conta na app e email** que tenha dias com menos de 8h
registadas nos últimos 10 dias úteis recebe um email com esses dias e as horas que faltam. Feriados,
fins de semana e ausências (aprovadas ou pendentes) não contam. "Hoje" conta ou não consoante a hora
configurada: antes das 12:00 nunca conta (o dia ainda está a decorrer); às 12:00 ou mais tarde, passa
a contar também (faz sentido como lembrete de fim de tarde — ver a nota grande em `logica.ts`). A
lógica é a mesma do cartão "Os meus dias por preencher" do Início (`logica.ts` espelha
`App.diasIncompletosRecurso`, verificado com o mesmo cenário nos dois, afora esta exceção do "hoje").

Nada é enviado enquanto o interruptor **Configurações → Definições → Lembretes automáticos por
email** estiver desligado (vem desligado por omissão), nem a ninguém fora do **Modo piloto**,
enquanto esse estiver ligado (ver Configurações → Pessoas → coluna "Piloto").

## Instalação (uma vez)

1. **Coluna do interruptor.** No SQL Editor do Supabase:
   ```sql
   alter table public.configuracoes add column if not exists lembrete_horas_ativo boolean not null default false;
   notify pgrst, 'reload schema';
   ```
   (Sem isto, "Guardar" nas Definições dá erro "Could not find the 'lembrete_horas_ativo' column".)

2. **Envio pelo Microsoft Graph (Office 365)** — a app autentica-se como ela mesma junto do Azure AD
   (client credentials, sem login de ninguém) e envia pela caixa `MS_SENDER_EMAIL`. O IT interno tem
   de preparar, no Azure AD (Entra ID) do tenant:
   - Um **App registration** dedicado (ex.: "GestorProjetos — Lembretes"), com um **Client secret**.
   - Permissão de API **Microsoft Graph → Application → `Mail.Send`**, com **consentimento de
     administrador** concedido (só um Global Admin consegue).
   - Uma **Application Access Policy** (Exchange Online PowerShell) a restringir esta app a só poder
     enviar pela caixa `MS_SENDER_EMAIL` — sem isto, a permissão `Mail.Send` (Application) deixa a
     app enviar como QUALQUER caixa do tenant:
     ```powershell
     Connect-ExchangeOnline
     New-DistributionGroup -Name "GraphMailSenders-Lembretes" -Members <MS_SENDER_EMAIL> -Type Security
     New-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -PolicyScopeGroupId "GraphMailSenders-Lembretes" -AccessRight RestrictAccess -Description "Só pode enviar como <MS_SENDER_EMAIL>"
     Test-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -Identity <MS_SENDER_EMAIL>   # tem de dar "Granted"
     ```
   - A caixa `MS_SENDER_EMAIL` (partilhada, não pessoal) já criada no Exchange Online.

   Do IT precisas de: **Tenant ID**, **Client ID**, **Client Secret** e a confirmação da caixa.

3. **Publicar a função** (Supabase CLI, na pasta do projeto, com `supabase login` e
   `supabase link --project-ref <ref>` feitos):
   ```bash
   supabase secrets set CRON_SECRET="<inventa uma frase longa e aleatória>" MS_TENANT_ID="<tenant id>" MS_CLIENT_ID="<client id>" MS_CLIENT_SECRET="<client secret>" MS_SENDER_EMAIL="lembretes.dtd@citeve.pt"
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
   `agendar_lembrete_horas.sql` (nesta pasta), depois de trocar `<ref>` e `<CRON_SECRET>`. Isto
   agenda uma VERIFICAÇÃO de 10 em 10 minutos, não o envio em si — é a função que decide, a cada
   chamada, se já chegou a hora configurada nas Definições e se ainda não correu hoje (ver "Hora de
   envio configurável", abaixo). Corre isto de novo sempre que precisares de mudar de "uma vez por
   dia a uma hora fixa" para este esquema — nunca mais precisas de voltar aqui só por mudar a hora.

6. Liga o interruptor nas Definições, e define aí a hora de envio desejada.

## Parâmetros

| Parâmetro | Efeito |
|---|---|
| `dry=1` | não envia; devolve a lista |
| `apenas=a@b.pt` | só considera esse endereço |
| `destino=eu@b.pt` | envia os emails calculados para este endereço (com `[TESTE]` no assunto) em vez de para cada pessoa; usa com `apenas=` para ver o email de um colega sem o incomodar |
| `forcar=1` | ignora "hoje não é dia útil", o interruptor desligado, a hora configurada e "já enviado hoje" — e nunca marca o dia como enviado (um teste forçado nunca pode silenciar o envio automático real desse dia) |

## Hora de envio configurável

A hora (**Configurações → Definições**, campo junto ao interruptor) é só "HH:MM", no fuso de
Lisboa — a função converte sozinha para UTC internamente. Muda-se ali, não é preciso SQL nenhum.
Cada chamada do `pg_cron` (de 10 em 10 minutos) só segue em frente se a hora atual em Lisboa já
tiver passado a configurada E ainda não tiver corrido hoje (`lembrete_horas_ultimo_envio`) — por
isso o envio real pode atrasar-se até ~10 minutos da hora pedida, nunca mais do que isso.

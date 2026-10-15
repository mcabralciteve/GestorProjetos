# Acesso de quem saiu da empresa

Quando o Administrador regista a saída de uma pessoa (**Pessoas → 🚪 Saída**), a app deixa de a deixar entrar e
esta função **suspende a conta de login** no Supabase Auth, para que a sessão deixe de valer mesmo fora da app.
Nunca apaga a conta, a pessoa nem qualquer dado: "suspender" é um *ban* reversível. Se a pessoa for reativada,
a função restaura o acesso.

Duas formas de funcionar:

1. **Pela app** — ao inativar ou reativar alguém, a app chama a função. Só um Administrador ativo pode; a função
   volta a validar tudo com os dados da base de dados (nunca confia no browser) e recusa suspender a própria
   conta ou o último Administrador ativo.
2. **Rotina diária** — todos os dias suspende as contas de quem já passou a data de saída (a pessoa trabalha até
   ao próprio dia). Nunca restaura nada sozinha.

Quem está inativo também deixa de receber os lembretes por email (`lembrete-horas` e `lembrete-agenda`).

## Instalação

1. **SQL** (só acrescenta duas colunas a `recursos`; não altera nem apaga nada): `supabase/pessoas_inativas.sql`.
2. **Publicar a função** (sem verificação de JWT: a própria função valida a sessão do Administrador ou o segredo da rotina):
   ```bash
   npx supabase functions deploy acesso-pessoa --no-verify-jwt
   ```
   Se alterares também os lembretes (passam a ignorar quem saiu), volta a publicá-los:
   ```bash
   npx supabase functions deploy lembrete-horas --no-verify-jwt
   npx supabase functions deploy lembrete-agenda --no-verify-jwt
   ```
3. **Rotina diária** (opcional mas recomendada): `agendar_acesso_pessoa.sql` (troca `<ref>` e `<CRON_SECRET>` só no SQL Editor).

## Notas
- Uma sessão já aberta pode durar até ~1 hora (validade do *access token*); a app, entretanto, não abre para quem está inativo.
- Reativar na app **antes** de a data passar não precisa da função; depois de a conta estar suspensa, a app pede-lhe para restaurar.
- Os Administradores nunca ficam sem acesso: a rotina não suspende Administradores se nenhum ficasse ativo.

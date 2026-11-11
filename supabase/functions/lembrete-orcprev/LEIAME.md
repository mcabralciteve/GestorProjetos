# Lembrete de sexta-feira: horas por carregar no orcprev

À sexta-feira, à hora configurada (**Horas → Orcprev**, por omissão 09:00), cada pessoa **com conta e email** que tenha horas
registadas no Gestor ainda **não carregadas no orcprev** recebe um email com os dias em falta e, por semana, um **link direto**
que abre o Gestor (depois do login) já na janela "Horas → orcprev" dessa semana, pronta a copiar. Quem não tem nada em falta não
recebe nada. Respeita o interruptor, "A minha conta" (lembretes desligados) e o Modo piloto, como os outros lembretes.

## Como se sabe o que já foi carregado

- Ao **Copiar semana**, o Gestor cria um "envio" (`orcprev_envios`) com um código secreto de uso único, que vai dentro do pacote.
- O importador (dentro do orcprev), depois de gravar, chama `orcprev_confirmar(token, …)` e o envio fica confirmado, com as horas
  por dia. É isto que o ecrã **Horas → Orcprev** e este email usam.
- Quem lançou à mão no orcprev usa **"Já lancei à mão"** na janela da semana (regista a semana como carregada).
- Um dia conta como carregado se as horas gravadas cobrirem as do Gestor (folga de 0,25 h do arredondamento). Regras iguais em
  `js/orcprev-logica.js` e `logica.ts` — se mudar uma, muda a outra.
- **"Contar a partir de"** (Horas → Orcprev, só Administrador): antes dessa data nada é considerado em falta (para não avisar do
  que foi lançado à mão no passado). Em branco = só as últimas 8 semanas.

## Instalação (uma vez)

1. **SQL**: no SQL Editor do Supabase, corre `supabase/orcprev_registo.sql` (só cria coisas novas). Sem isto o ecrã Horas →
   Orcprev diz que falta instalar e o Gestor continua a funcionar como antes.
2. **Publicar a função** (os segredos `CRON_SECRET`, `MS_*` são os mesmos do `lembrete-horas`):
   ```bash
   supabase functions deploy lembrete-orcprev --no-verify-jwt
   ```
3. **Testar sem enviar nada** (quem receberia e quantos dias; `forcar=1` porque hoje pode não ser sexta-feira):
   ```bash
   curl -H "x-cron-secret: <CRON_SECRET>" "https://<ref>.supabase.co/functions/v1/lembrete-orcprev?dry=1&forcar=1"
   ```
   Para ver o email de uma pessoa, enviado só para ti: `...?apenas=a.pessoa@citeve.pt&destino=o.teu@email.pt&forcar=1`.
4. **Agendar**: corre `agendar_lembrete_orcprev.sql` (nesta pasta) depois de trocar `<ref>` e `<CRON_SECRET>`.
5. **Ligar**: Horas → Orcprev → "Lembrete de sexta-feira" → marca "Enviar à sexta-feira", escolhe a hora e a data de início → Guardar.

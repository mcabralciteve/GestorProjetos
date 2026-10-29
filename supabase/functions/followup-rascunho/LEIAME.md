# Rascunho de follow-up com o Claude

Nos **follow-ups do CRM** (separador Comercial → Follow-ups, e na ficha de cada oportunidade/conta) cada follow-up por concluir tem um botão
**✉ Rascunho**. Esta função lê o CRM e pede ao Claude um email ao cliente (por exemplo, o ponto de situação de uma proposta). A app mostra
o texto para a pessoa **rever e ajustar**. **Nada é enviado**: a pessoa copia, ou abre no programa de email (mailto), e envia ela própria.

Na janela do rascunho:
- **Para** — o contacto da oportunidade (ou o decisor da conta); dá para escolher outro contacto da conta ou escrever um endereço.
- **↻ Refazer** — gera outra versão, com indicações opcionais ("mais informal", "propõe uma chamada na próxima semana"). Avisa antes de substituir texto editado.
- **✉ Abrir no email / Copiar** — para enviar do Outlook de cada um.
- **Já enviei: registar e concluir** — regista um email na conta/oportunidade (Interações) e marca o follow-up como concluído.

## O que o Claude vê
Só o necessário para escrever: nome e setor da conta; título, descrição e etapa da oportunidade; referência, estado, datas de envio e de validade
das propostas (sem valores); os 5 últimos contactos registados (tipo, data e resumo); nome e cargo do destinatário; nome de quem pede. **Não vai**
NIF, morada, telefones, emails, valores nem anexos. Os dados são lidos com a **sessão da própria pessoa** (RLS): nunca se vê mais do que ela já vê.
Só quem tem acesso ao CRM (`crm_tem_acesso()`) pode usar.

## Instalação (uma vez)
1. **Chave da API** — em console.anthropic.com cria uma chave (de preferência numa *workspace* só para o Gestor, com limite de gasto mensal) e guarda-a
   no Supabase como segredo:
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
   (Opcional: `ANTHROPIC_MODEL` para trocar de modelo; por omissão `claude-opus-5-5`. Para gastar menos, `claude-sonnet-5-5` ou `claude-haiku-5-5`.)
2. **Publicar a função** (sem `--no-verify-jwt`: só aceita pedidos de utilizadores com sessão):
   ```bash
   npx supabase functions deploy followup-rascunho
   ```
3. Testar num follow-up real, depois de publicar a página.

Custo: um rascunho gasta poucos milhares de tokens (cêntimos ou menos).

## Testes
```bash
cd supabase/functions/followup-rascunho && deno test logica_test.ts
```

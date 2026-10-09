# Enviar proposta ao cliente (email + pasta no SharePoint)

No orçamento (Comercial → Propostas → Orçamentos), **✉ Enviar ao cliente** abre um ecrã de confirmação (para quem, cópia, assunto, mensagem,
anexos) e chama esta função, que:

1. **Envia o email** com a proposta em anexo (Excel do cliente e, se escolhido, o Word DG015), pela **caixa do sistema** (`MS_SENDER_EMAIL`),
   com o responsável em cópia e como "responder para". O email nunca leva o orçamento interno. Fica nos Itens Enviados da caixa do sistema.
2. **Copia os ficheiros para o SharePoint**, em `<pasta CLIENTES>/<cliente>/<referência - título>` (cria o que faltar), com o orçamento
   interno (margens) na subpasta `Interno`. Devolve o link da pasta, que a app regista no campo "Documento" da proposta.

O email e o SharePoint são independentes: se o SharePoint falhar (por exemplo, falta a permissão abaixo), o email já foi e a app mostra o
aviso. Só quem tem acesso ao CRM (`crm_tem_acesso()`) pode chamar a função (a sessão da pessoa é validada aqui).

## Instalação

1. **SQL** (link da pasta CLIENTES, que se altera em Configurações → Funil CRM): `supabase/orcamentos_envio.sql`.
2. **Publicar a função** (as variáveis `MS_*` são as do `lembrete-horas`; as do Supabase são automáticas):
   ```bash
   npx supabase functions deploy proposta-enviar
   ```
   (sem `--no-verify-jwt`: esta função só aceita pedidos de utilizadores com sessão.)
3. **Testar o email** na app com a caixa "Só um teste para mim" (envia só para o teu endereço, sem copiar nem mudar o estado).
4. **Permissão do SharePoint** (tem de ser o administrador do Microsoft 365): na aplicação Azure usada pelo Gestor de Projetos (a das
   variáveis `MS_CLIENT_ID`/`MS_TENANT_ID`), em *API permissions → Microsoft Graph → Application permissions*:
   - **`Sites.Selected`** (recomendado) e depois dar-lhe acesso de **escrita** apenas ao site `https://citeve2.sharepoint.com/sites/CITEVEDEPTD`
     (Graph: `POST /sites/{site-id}/permissions` com `roles: ["write"]`); ou
   - **`Files.ReadWrite.All`** (mais simples, mas dá acesso a todos os sites).
   Depois do consentimento do administrador, enviar uma proposta (sem "teste") já copia os ficheiros.

## Limites
Anexos e ficheiros somam no máximo 12 MB; cada ficheiro copiado para o SharePoint até 3,5 MB (envio simples do Graph).

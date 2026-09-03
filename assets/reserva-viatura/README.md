# Reserva de Viatura — ficheiros de suporte

Estes ficheiros são usados pela funcionalidade "🚗 Viaturas" da app (ver [`js/reserva-viatura.js`](../../js/reserva-viatura.js)).

- **`Reserva_Viatura_TEMPLATE.xlsx`** — o único ficheiro usado em runtime pela app. É o
  template oficial "Mapa de Despesas" (DFRH-008/12), com as 11 células-alvo em branco.
  A app descarrega-o, troca só o conteúdo dessas 11 células (preservando o estilo de cada
  uma) e gera o Excel final — nunca reconstrói o ficheiro, para não perder o logótipo, as
  molduras, as validações nem os controlos ActiveX (botões de opção Famalicão/Covilhã,
  Nacional/Internacional).

- **`Reserva_Viatura_TEMPLATE.xls`** — o ficheiro original, tal como fornecido (formato
  Excel 97-2003, binário). Mantido só para referência/proveniência — a app não o usa
  diretamente. O `.xlsx` acima foi gerado a partir deste, uma única vez, via automação do
  Excel (abrir, limpar o conteúdo das 11 células-alvo, Guardar Como `.xlsx`) — sem passar
  por nenhuma biblioteca de terceiros, para garantir fidelidade total ao original.

- **`reserva_viatura.schema.json`** e **`README_schema_original.md`** — o schema de
  integração original (mapeamento campo→célula, codificação de datas/horas, convenção do
  nome do ficheiro de saída) fornecido por quem criou o modelo Excel. `js/reserva-viatura.js`
  implementa exatamente este schema, no browser, via edição cirúrgica do XML dentro do
  `.xlsx` (o "Método B" descrito no README original) — sem precisar do Excel instalado no
  computador de quem usa a app.

## Se o template Excel oficial mudar

1. Substitui `Reserva_Viatura_TEMPLATE.xls` pela nova versão (mantém o nome).
2. Confirma se o mapeamento campo→célula em `reserva_viatura.schema.json` ainda é válido —
   se as células-alvo mudaram de sítio, atualiza também `ReservaViatura.CAMPOS` em
   `js/reserva-viatura.js`.
3. Volta a gerar o `.xlsx`: abre o `.xls` no Excel, limpa o conteúdo das 11 células-alvo
   (área, requisitante, chefia, gestor, projeto, justificação, data do pedido, datas/horas
   de início e fim), e faz "Guardar Como" em formato `.xlsx` por cima deste ficheiro.

# Reserva de Viatura — Schema de integração

Especificação para reimplementar, noutra solução, a geração do Excel oficial
**Mapa de Despesas (DFRH-008/12)** a partir dos dados de um formulário.

Ficheiro principal: [`reserva_viatura.schema.json`](reserva_viatura.schema.json)

---

## Ideia central

O modelo Excel oficial (`Reserva_Viatura_TEMPLATE.xls`) é fixo. Para o preencher
**não se reconstrói o ficheiro** — altera-se **apenas o valor de 11 células**,
mantendo o estilo de cada uma. Assim o logótipo, molduras, validações e controlos
ficam intactos.

## Mapeamento campo → célula (folha "Mapa de Despesas")

| Campo | Célula | Tipo | Codificação |
|-------|:-----:|------|-------------|
| area (Área/Unidade) | H12 | texto | — |
| requisitante | P12 | texto | — |
| chefia | P15 | texto | — |
| gestor | G17 | texto | — |
| projeto | F15 | texto | — |
| justificacao | D24 | texto longo | célula mesclada, wrap |
| data_pedido | I19 | data | serial Excel |
| data_inicio | Q28 | data | serial Excel |
| hora_inicio | T28 | hora | fração do dia |
| data_fim | Q30 | data | serial Excel |
| hora_fim | T30 | hora | fração do dia |

- **Serial Excel** (data): `floor((UTC(a,m,d) − UTC(1899,12,30)) / 86400000)`.
  Escrever o **número** (não uma data nativa) evita deslocações de fuso.
- **Fração do dia** (hora): `(h*3600 + m*60) / 86400`.
- O formato visível (dd/mm/aaaa, h:mm) vem do **estilo já existente** na célula —
  basta manter o índice de estilo (`s`) — ver `estiloIndice` no JSON.

## Nome do ficheiro de saída

```
DFRH008_rev12_Mapa_despesas_{DDMMAAAA}.xls
```
`{DDMMAAAA}` = `data_inicio` (ex.: 15/09/2026 → `15092026`).

## Dois métodos de implementação

**A — manter `.xls` (fidelidade total):** abrir o template no Excel (automação
COM/Interop), definir `Range(celula).Value` e Guardar-Como com `FileFormat=56`
(xlExcel8). Requer Excel instalado.

**B — sem Excel, gera `.xlsx` (browser/servidor):** um `.xlsx` é um ZIP de XML.
Descompactar, em `xl/worksheets/sheet1.xml` substituir só a célula-alvo mantendo
`s=`, e recompactar sem tocar no resto. Bibliotecas: fflate/JSZip (JS).

Substituições:
```xml
<!-- texto -->
<c r="F15" s="171" t="inlineStr"><is><t xml:space="preserve">TEXTO</t></is></c>
<!-- número (data serial ou fração de hora) -->
<c r="Q28" s="101"><v>46280</v></c>
```

## Validação do payload

O JSON inclui `inputSchema` (JSON Schema draft-07) para validar os dados de
entrada, e `exemploPayload` com um caso completo.

## Fora de âmbito

Botões de opção (Famalicão/Covilhã, Nacional/Internacional), Marca, Matrícula,
Quilometragem e o "Despacho do setor de veículos" não fazem parte deste
mapeamento (são controlos ou preenchidos por outra equipa).

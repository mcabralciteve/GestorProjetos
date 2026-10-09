// Importação de orçamentos da folha Excel DTD — correr com: node --test tests/orcamento-importar.test.js
// A folha de teste é construída aqui (mesmas posições da folha real, números inventados); se a folha real existir neste
// computador também se confirma que a estrutura é reconhecida (sem copiar nada dela para o repositório).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const I = require('../js/orcamento-importar.js');
const O = require('../js/orcamento-logica.js');

function matriz(linhas) {            // { 10: ['a', 'b'] } (linhas do Excel, 1-based) -> matriz
  const n = Math.max(...Object.keys(linhas).map(Number));
  return Array.from({ length: n }, (_, i) => linhas[i + 1] || []);
}
function folhaDepartamento({ consultoria = [], formacao = [], desloc = [], consumiveis = [], produtos = [], custosEsp = 0, preco = undefined } = {}) {
  const L = {
    4: ['Cliente:', 'Têxtil do Ave', '', '', '', 'Data:', '2026-10-01'], 5: ['Projeto / Proposta:', 'Auditoria IA', '', '', '', 'Responsável:', 'Milton Cabral'],
    8: ['1. Horas de Consultoria / Trabalho'], 9: ['Tarefa / Descrição', 'Perfil', 'Nº Horas', 'Valor/Hora (€)', 'Subtotal (€)', 'Margem (€)'], 20: ['TOTAL SECÇÃO 1 — Consultoria/Trabalho'],
    22: ['2. Horas de Formação (com Preparação)'], 23: ['Exemplo…'], 24: ['Ação de Formação', 'Perfil', 'Horas de Sessão', 'Horas de Preparação'], 30: ['TOTAL SECÇÃO 2 — Formação'],
    32: ['3. Deslocações'], 33: ['Motivo / Descrição', 'Nº Saídas'], 39: ['TOTAL SECÇÃO 3 — Deslocações'],
    41: ['4. Consumíveis (adaptável ao departamento)'], 42: ['Descrição', 'Valor (€)'], 47: ['TOTAL SECÇÃO 4 — Consumíveis'],
    49: ['5. Produtos'], 50: ['Venda de produtos…'], 51: ['Produto / Descrição', 'Quantidade'], 60: ['TOTAL SECÇÃO 5 — Produtos'],
    62: ['RESUMO DO ORÇAMENTO'], 71: ['Custos Específicos do Departamento (lançar valor)', '', '', '', custosEsp], 72: ['PREÇO FINAL AO CLIENTE (€)', '', '', '', preco]
  };
  consultoria.forEach((l, i) => { L[10 + i] = l; }); formacao.forEach((l, i) => { L[25 + i] = l; }); desloc.forEach((l, i) => { L[34 + i] = l; });
  consumiveis.forEach((l, i) => { L[43 + i] = l; }); produtos.forEach((l, i) => { L[52 + i] = l; });
  return matriz(L);
}
const parametros = matriz({
  4: ['Perfil', 'Valor/Hora (€)', 'Descrição'], 5: ['Administrativo', 30], 6: ['Técnico Júnior', 40], 7: ['Técnico Sénior', 55], 8: ['Gestor', 70],
  10: ['Custos de Deslocação'], 11: ['Aluguer de viatura por saída (€)', 50], 12: ['Custo por km (€/km)', 0.2], 13: ['Portagens', 'À parte'],
  20: ['Overheads'], 21: ['Custos Gerais / Custos Indiretos (% sobre Horas Vendáveis)', 0.25]
});
const calculo = matriz({
  5: ['Nº de Meses (Salário × 14)', 14], 6: ['Dias Úteis / Ano', 220], 7: ['Horas de Trabalho / Dia', 8], 8: ['Valor Diário Subsídio Alimentação (€)', 10], 9: ['TSU — Segurança Social (entidade patronal)', 0.2375],
  10: ['Seguro de Acidentes de Trabalho (% s/ retribuição anual)', 0.006], 11: ['Fundo de Compensação do Trabalho — FCT (%)', 0], 12: ['Taxa de Absentismo / Ausências (%)', 0.03], 13: ['Custos Indiretos / Overhead (%)', undefined],
  20: ['Perfil', 'Salário Bruto\nMensal (€)', 'Retribuição'],
  21: ['Administrativo', 1000, '', '', '', '', '', 0, 0, '', '', '', 0.75], 22: ['Técnico Júnior', 1400, '', '', '', '', '', 0, 0, '', '', '', 0.75],
  23: ['Técnico Sénior', 2000, '', '', '', '', '', 0, 0, '', '', '', 0.75], 24: ['Gestor', 2600, '', '', '', '', '', 0, 0, '', '', '', 0.75]
});
const dcs = folhaDepartamento({
  consultoria: [['Diagnóstico inicial', 'Técnico Sénior', 20], ['Plano', 'Gestor', 5]],
  formacao: [['Formação em IA', 'Técnico Júnior', 4, 16]],
  desloc: [['Visita ao cliente', 2, 300, 20, 30, 0, 0, 2, 'Técnico Sénior']],
  consumiveis: [['Materiais', 50]],
  produtos: [['Sensor X', 3, 100, 150, '', 0.1]],
  custosEsp: 100
});
const folhas = { 'Leia-me': [], 'Parâmetros': parametros, 'Cálculo Valor-Hora': calculo, DCS: dcs, ROB: folhaDepartamento(), DAT: folhaDepartamento() };

test('parâmetros: perfis e valor/hora, aluguer por saída, €/km e overhead', () => {
  const p = I.lerParametros(parametros);
  assert.deepEqual(p.perfis, [{ nome: 'Administrativo', valor_hora: 30 }, { nome: 'Técnico Júnior', valor_hora: 40 }, { nome: 'Técnico Sénior', valor_hora: 55 }, { nome: 'Gestor', valor_hora: 70 }]);
  assert.equal(p.aluguer_saida, 50); assert.equal(p.custo_km, 0.2); assert.equal(p.overhead, 0.25);
});

test('custo/hora do perfil = custo anual ÷ horas faturáveis × (1 + overhead) — só o resultado fica', () => {
  const custos = I.lerCustos(calculo, 0.25);
  // Técnico Sénior: 2000×14 = 28000; TSU 23,75% + seguro 0,6% = 28000×1,2435 = 34818; + subsídio 220×10 = 2200 → 37018
  // horas faturáveis = 220×8×0,97×0,75 = 1280,4 → 28,91 €/h → ×1,25 = 36,14 €/h
  assert.equal(custos.length, 4);
  assert.ok(Math.abs(custos[2].custo_hora - (37018 / 1280.4) * 1.25) < 1e-6);
  assert.ok(custos[3].custo_hora > custos[2].custo_hora && custos[2].custo_hora > custos[0].custo_hora);
});

test('separador de departamento: linhas das 5 secções, desconto em %, custos específicos', () => {
  const a = I.lerArea(dcs);
  assert.deepEqual(a.linhas.map(l => [l.seccao, l.descricao, l.perfil]), [['consultoria', 'Diagnóstico inicial', 'Técnico Sénior'], ['consultoria', 'Plano', 'Gestor'], ['formacao', 'Formação em IA', 'Técnico Júnior'], ['deslocacao', 'Visita ao cliente', 'Técnico Sénior'], ['consumivel', 'Materiais', ''], ['produto', 'Sensor X', '']]);
  assert.deepEqual(a.linhas[2].dados, { horas_sessao: 4, horas_prep: 16 });
  assert.deepEqual(a.linhas[3].dados, { saidas: 2, km: 300, portagens: 20, refeicoes: 30, estadias: 0, outros: 0, horas: 2 });
  assert.equal(a.linhas[5].dados.desconto, 10);                      // 0,1 na folha = 10 %
  assert.equal(a.custos_especificos, 100);
  assert.equal(I.lerArea(folhaDepartamento()).linhas.length, 0);     // separador por preencher
  assert.equal(I.lerArea([['Outra coisa']]), null);                  // não é a folha DTD
});

test('interpretar: só os separadores preenchidos, cabeçalho, parâmetros e aviso de perfil desconhecido', () => {
  const r = I.interpretar(folhas);
  assert.deepEqual(r.areas.map(a => a.nome), ['DCS']);
  assert.equal(r.meta.cliente, 'Têxtil do Ave'); assert.equal(r.meta.projeto, 'Auditoria IA'); assert.equal(r.meta.responsavel, 'Milton Cabral');
  assert.deepEqual(r.parametros, { aluguer_saida: 50, custo_km: 0.2 });
  assert.equal(r.avisos.length, 0);
  const outra = { ...folhas, DCS: folhaDepartamento({ consultoria: [['X', 'Perfil Inventado', 1]] }) };
  assert.match(I.interpretar(outra).avisos[0], /Perfil Inventado/);
  assert.throws(() => I.interpretar({ 'Parâmetros': parametros, DCS: folhaDepartamento() }), /nenhum orçamento preenchido/);
});

test('construir: valores do ficheiro, ou os das Pessoas quando se escolhe um consultor; reproduz os números da folha', () => {
  const r = I.interpretar(folhas);
  let n = 0;
  const base = I.construir(r, { propostaId: 'P1', versao: 2, equipas: [{ id: 'E1', nome: 'DCS' }], gerarId: () => 'id' + (++n) });
  assert.equal(base.estado, 'rascunho'); assert.equal(base.versao, 2); assert.equal(base.aluguer_saida, 50); assert.equal(base.custo_km, 0.2);
  assert.equal(base.areas[0].equipa_id, 'E1');
  const l0 = base.areas[0].linhas[0];
  assert.equal(l0.dados.valor_hora, 55); assert.equal(l0.dados.perfil, 'Técnico Sénior'); assert.ok(l0.dados.custo_hora > 30);
  // contas: consultoria 20×55 + 5×70 = 1450; formação (4+16)×40 = 800; deslocação 2×50 + 300×0,2 + 50 = 210, horas 2×55 = 110;
  // consumíveis 50; produtos 3×135 = 405; custos específicos 100  → 3125
  assert.equal(O.calcOrcamento(base).total, 1450 + 800 + 210 + 110 + 50 + 405 + 100);
  // com consultor escolhido para "Técnico Sénior": usa o preço de venda/custo das Pessoas
  const mapeado = I.construir(r, { propostaId: 'P1', mapaPerfis: { 'Técnico Sénior': { id: 'R9', precoVenda: 60, precoCusto: 44 } }, equipas: [] });
  const m0 = mapeado.areas[0].linhas[0];
  assert.equal(m0.recurso_id, 'R9'); assert.equal(m0.dados.valor_hora, 60); assert.equal(m0.dados.custo_hora, 44); assert.equal(mapeado.areas[0].equipa_id, null);
});

test('folha real do DTD (se existir neste computador): a estrutura é reconhecida em todos os separadores', { skip: !fs.existsSync(process.env.FOLHA_DTD || 'C:/Users/mcabral/OneDrive - CITEVE/DTD@CITEVE/Comercial/Templates/DTD_Folha_Orcamentacao.xlsx') }, () => {
  const XLSX = require('../lib/xlsx.full.min.js');
  const wb = XLSX.read(fs.readFileSync(process.env.FOLHA_DTD || 'C:/Users/mcabral/OneDrive - CITEVE/DTD@CITEVE/Comercial/Templates/DTD_Folha_Orcamentacao.xlsx'), { type: 'buffer' });
  const f = {}; wb.SheetNames.forEach(n => { f[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
  I.SEPARADORES.forEach(n => assert.ok(I.lerArea(f[n]), `separador ${n} não reconhecido`));
  assert.equal(I.lerParametros(f['Parâmetros']).perfis.length, 4);
  assert.equal(I.lerCustos(f['Cálculo Valor-Hora'], 0.25).length, 4);
});

// Testes da importação de dados do SuiteCRM — correr com: node --test tests/crm-importacao.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/crm-logica.js');

const recursos = [{ id: 'R1', nome: 'Milton Cabral', email: 'mcabral@citeve.pt' }, { id: 'R2', nome: 'Ana Sousa', email: 'asousa@citeve.pt' }];
const E = (id, tipo, nome, prob, cat) => ({ id, tipo_id: tipo, nome, probabilidade: prob, categoria: cat, ordem: 0, ativo: true });
const tipos = [{ id: 'T1', nome: 'Projetos de I&D', ativo: true }, { id: 'T2', nome: 'Serviços', ativo: true }];
const etapas = [
  E('e1', 'T1', 'Lead', 10, 'aberta'), E('e2', 'T1', 'Proposta', 50, 'aberta'), E('e3', 'T1', 'Ganha', 100, 'ganha'), E('e4', 'T1', 'Perdida', 0, 'perdida'),
  E('s1', 'T2', 'Lead', 10, 'aberta'), E('s2', 'T2', 'Ganha', 100, 'ganha'), E('s3', 'T2', 'Perdida', 0, 'perdida')
];

test('parseValor: formatos português e inglês', () => {
  assert.equal(C.parseValor('€8.100,00'), 8100);
  assert.equal(C.parseValor('8100,5'), 8100.5);
  assert.equal(C.parseValor('8,100.50'), 8100.5);
  assert.equal(C.parseValor('700.000'), 700000);
  assert.equal(C.parseValor('12600'), 12600);
  assert.equal(C.parseValor(''), null);
  assert.equal(C.parseValor('n/d'), null);
});

test('datas: deteta o formato e converte para ISO', () => {
  assert.equal(C.detectarFormatoData(['06/30/2026', '10/31/2026']), 'mdy');
  assert.equal(C.detectarFormatoData(['30/06/2026', '05/10/2026']), 'dmy');
  assert.equal(C.detectarFormatoData(['05/10/2026']), 'mdy');                   // ambíguo -> americano
  assert.equal(C.detectarFormatoData(['2026-06-30']), 'ymd');
  assert.equal(C.parseData('06/30/2026', 'mdy'), '2026-06-30');
  assert.equal(C.parseData('30/06/2026', 'dmy'), '2026-06-30');
  assert.equal(C.parseData('02/30/2026', 'mdy'), null);                          // dia inexistente
  assert.equal(C.parseData('', 'mdy'), null);
});

test('resolverResponsavel: utilizador do SuiteCRM -> recurso', () => {
  assert.equal(C.resolverResponsavel('mcabral', recursos), 'R1');
  assert.equal(C.resolverResponsavel('asousa', recursos), 'R2');
  assert.equal(C.resolverResponsavel('Ana Sousa', recursos), 'R2');
  assert.equal(C.resolverResponsavel('ninguem', recursos), null);
  assert.equal(C.resolverResponsavel('', recursos), null);
});

test('mapearEtapa e mapearTipo: sugestões a partir do texto do SuiteCRM', () => {
  const ets = etapas.filter(e => e.tipo_id === 'T1');
  assert.equal(C.mapearEtapa('Ganho | Aprovada', '100', ets).categoria, 'ganha');
  assert.equal(C.mapearEtapa('Abandonado | Rejeitada', '0', ets).categoria, 'perdida');
  assert.equal(C.mapearEtapa('Proposta | Candidatura', '30', ets).nome, 'Proposta');
  assert.equal(C.mapearEtapa('Qualificação | Ideia', '10', ets).nome, 'Lead');   // sem palavras comuns: vale a probabilidade
  assert.equal(C.mapearTipo('Serviços', tipos).id, 'T2');
  assert.equal(C.mapearTipo('servicos', tipos).id, 'T2');
  assert.equal(C.mapearTipo('I&D', tipos).id, 'T1');
  assert.equal(C.mapearTipo('Outro', tipos), null);
});

test('normalizarRefGiaf: zeros à esquerda e marcador vazio', () => {
  assert.equal(C.normalizarRefGiaf('2026/0829'), '2026/829');
  assert.equal(C.normalizarRefGiaf('2026/829'), '2026/829');
  assert.equal(C.normalizarRefGiaf('2026/0000'), '');
  assert.equal(C.normalizarRefGiaf('abc'), '');
});

test('contas do SuiteCRM: lixo limpo, morada composta, apagadas ignoradas', () => {
  const m = C.parseCsv('Name;NIF;Website;Billing Street;Billing Postal Code;Billing City;Dimension;Assigned to;Deleted;Geocode Status\n' +
    'Alfa Lda;501;http://;Rua A, 1;4000-100;Porto;PME;mcabral;0;OK\n' +
    'Beta SA;502;www.beta.pt;-;;;Big;;0;\n' +
    'Gama;503;;;;;;;1;');
  const mapa = C.autoMapear(m[0], C.CAMPOS_CONTA);
  assert.equal(mapa.estado, -1);                                                 // "Geocode Status" não é o estado da conta
  const r = C.prepararContas(m, mapa, [], { recursos });
  assert.equal(r.novas.length, 2);                                               // Gama está apagada
  assert.equal(r.novas[0].morada, 'Rua A, 1, 4000-100 Porto');
  assert.equal(r.novas[0].website, '');                                          // "http://" sozinho
  assert.equal(r.novas[0].dimensao, 'PME');
  assert.equal(r.novas[0].responsavel_id, 'R1');
  assert.equal(r.novas[1].website, 'https://www.beta.pt');
  assert.equal(r.novas[1].morada, '');                                           // "-" é vazio
  assert.equal(r.novas[1].dimensao, 'Grande');
});

test('contactos do SuiteCRM: nome composto e telefone alternativo sem apóstrofo', () => {
  const m = C.parseCsv("First Name;Last Name;Account Name;Mobile;Office Phone\nAna;Silva;Alfa Lda;;'+351 252 000 000\nRui;Lopes;Alfa Lda;912;-");
  const r = C.prepararContactos(m, C.autoMapear(m[0], C.CAMPOS_CONTACTO), [{ id: 'C1', nome: 'Alfa Lda', nif: '501' }], [], {});
  assert.equal(r.novos[0].nome, 'Ana Silva');
  assert.equal(r.novos[0].telefone, '+351 252 000 000');                         // telemóvel vazio -> fixo, sem apóstrofo
  assert.equal(r.novos[1].telefone, '912');
  assert.equal(r.novos[0].conta_id, 'C1');
});

test('prepararOportunidades: etapa, tipo, valor, data, projeto, follow-up e conta a criar', () => {
  const m = C.parseCsv('Opportunity Name;Account Name;Opportunity Amount;Expected Close Date;Sales Stage;Probability (%);Next Step;Type;Assigned to;Lead Source;Ano/Obra (Referência GIAF);Deleted\n' +
    'Op A;Alfa Lda;€8.100,00;06/30/2026;Ganho | Aprovada;100;;Serviços;mcabral;Existing Customer;2026/0829;0\n' +
    'Op B;Nova SA;12600;10/31/2026;Qualificação | Ideia;10;Ligar ao cliente;Serviços;;;2026/0000;0\n' +
    'Op C;Alfa Lda;100;;Abandonado | Rejeitada;0;;Serviços;;;;0\n' +
    'Op D;Alfa Lda;1;;Ganho | Aprovada;100;;Desconhecido;;;;0\n' +
    'Op E;Alfa Lda;1;;Ganho | Aprovada;100;;Serviços;;;;1');
  const mapa = C.autoMapear(m[0], C.CAMPOS_OPORTUNIDADE);
  const ctx = { contas: [{ id: 'C1', nome: 'Alfa, Lda.' }], oportunidades: [], tipos, etapas, recursos, projetos: [{ id: 'P1', idInterno: '2026/829' }] };
  const r = C.prepararOportunidades(m, mapa, ctx, { formatoData: 'mdy', criarContas: true, criarFollowups: true, motivoPadrao: { T2: 'mp1' } });
  assert.equal(r.novas.length, 3);
  assert.equal(r.invalidas.length, 1);                                           // tipo "Desconhecido"; "Op E" está apagada e nem conta
  const [a, b, c] = r.novas;
  assert.equal(a.conta_id, 'C1');                                                // "Alfa Lda" = "Alfa, Lda."
  assert.equal(a.etapa_id, 's2'); assert.equal(a.valor_estimado, 8100);
  assert.equal(a.data_fecho, '2026-06-30'); assert.equal(a.projeto_id, 'P1'); assert.equal(a.responsavel_id, 'R1'); assert.equal(a.origem, 'Cliente existente');
  assert.equal(b.conta_id, null); assert.equal(b.conta_ref.nome, 'Nova SA');
  assert.equal(b.etapa_id, 's1'); assert.equal(b.followup, 'Ligar ao cliente'); assert.equal(b.data_fecho, null);
  assert.equal(b.descricao, '');                                                 // "2026/0000" não é referência
  assert.equal(c.etapa_id, 's3'); assert.equal(c.motivo_perda_id, 'mp1'); assert.equal(c.data_fecho, null);
  assert.equal(r.contasACriar.length, 1); assert.equal(r.followups, 1); assert.equal(r.comProjeto, 1);
  const sem = C.prepararOportunidades(m, mapa, ctx, { formatoData: 'mdy', criarContas: false });
  assert.equal(sem.semConta.length, 1);                                          // "Nova SA" fica de fora
  const dup = C.prepararOportunidades(m, mapa, Object.assign({}, ctx, { oportunidades: [{ conta_id: 'C1', titulo: 'Op A' }] }), { formatoData: 'mdy', criarContas: true });
  assert.equal(dup.duplicadas.length, 1);
});

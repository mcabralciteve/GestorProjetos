import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { dataPt, diasEntre, escolherDestinatario, lerRascunho, montarContexto, montarPedido, type Contacto, type DadosFollowup } from './logica.ts';

const C = (id: string, nome: string, email: string, papel = ''): Contacto => ({ id, nome, cargo: 'Diretor', email, papel_decisao: papel });

Deno.test('datas: formato português e dias entre duas datas', () => {
  assertEquals(dataPt('2026-10-29'), '29/10/2026');
  assertEquals(dataPt(null), '—');
  assertEquals(diasEntre('2026-10-12', '2026-10-29'), 17);
  assertEquals(diasEntre('2026-10-29', '2026-10-29'), 0);
});

Deno.test('destinatário: pedido > contacto da oportunidade > decisor > primeiro com email; sem email não conta', () => {
  const lista = [C('a', 'Ana', ''), C('b', 'Bruno', 'bruno@x.pt', 'tecnico'), C('c', 'Carla', 'carla@x.pt', 'decisor'), C('d', 'Duarte', 'duarte@x.pt')];
  assertEquals(escolherDestinatario(lista, null, ' DUARTE@x.pt ')?.id, 'd');
  assertEquals(escolherDestinatario(lista, 'b')?.id, 'b');
  assertEquals(escolherDestinatario(lista, 'a')?.id, 'c');           // o contacto da oportunidade não tem email → decisor
  assertEquals(escolherDestinatario(lista, null)?.id, 'c');
  assertEquals(escolherDestinatario([C('a', 'Ana', ''), C('b', 'Bruno', 'bruno@x.pt')], null)?.id, 'b');
  assertEquals(escolherDestinatario([C('a', 'Ana', '')], null), null);
  assertEquals(escolherDestinatario(lista, null, 'desconhecido@x.pt')?.id, 'c');    // o pedido não é de nenhum contacto → regra normal
});

const BASE: DadosFollowup = {
  tarefa: { descricao: 'Pedir ponto de situação da proposta', data_limite: '2026-10-29' },
  conta: { nome: 'Têxtil do Ave', setor: 'Têxtil' },
  oportunidade: { titulo: 'Auditoria energética', descricao: 'Auditoria às linhas de acabamento.', etapa: 'Proposta enviada', data_prevista_fecho: '2026-11-30' },
  propostas: [{ referencia_giaf: '2026/829-01', versao: 1, data_envio: '2026-10-12', data_validade: '2026-11-11', estado: 'enviada' }],
  interacoes: [{ tipo: 'reuniao', data: '2026-10-05', resumo: 'Visita à fábrica.\n  Querem decidir até novembro.' }],
  destinatario: { nome: 'Carla Sá', cargo: 'Diretora' },
  remetente: 'Milton Cabral',
  indicacoes: '',
  hojeISO: '2026-10-29',
};

Deno.test('contexto: leva o necessário, calcula os dias desde o envio e não leva dados sensíveis', () => {
  const t = montarContexto(BASE);
  assert(t.includes('Cliente: Têxtil do Ave — setor: Têxtil'));
  assert(t.includes('2026/829-01 (versão 1); estado: enviada; enviada a 12/10/2026, há 17 dias; válida até 11/11/2026'));
  assert(t.includes('05/10/2026 · reuniao: Visita à fábrica. Querem decidir até novembro.'));
  assert(t.includes('Destinatário: Carla Sá (Diretora)'));
  assertFalse(/@|NIF|€/.test(t));
});

Deno.test('contexto: sem oportunidade, sem propostas e sem contactos', () => {
  const t = montarContexto({ ...BASE, oportunidade: null, propostas: [], interacoes: [], destinatario: null });
  assert(t.includes('Destinatário: sem nome'));
  assert(t.includes('Últimos contactos: nenhum registado.'));
  assertFalse(t.includes('Oportunidade:'));
  assertFalse(t.includes('Propostas:'));
});

Deno.test('pedido: as indicações do colaborador ficam fora de <dados>', () => {
  const p = montarPedido({ ...BASE, indicacoes: 'Mais informal, e propõe uma chamada.' });
  assert(p.startsWith('<dados>'));
  assert(p.indexOf('</dados>') < p.indexOf('Indicações do colaborador: Mais informal'));
  assertFalse(montarPedido(BASE).includes('Indicações do colaborador'));
});

Deno.test('resposta do modelo: assunto + corpo, com ou sem markdown à volta', () => {
  assertEquals(lerRascunho('ASSUNTO: Proposta 2026/829-01\n\nBom dia, Carla,\n\nOlá.\n\nCom os melhores cumprimentos,\nMilton\nCITEVE'),
    { assunto: 'Proposta 2026/829-01', corpo: 'Bom dia, Carla,\n\nOlá.\n\nCom os melhores cumprimentos,\nMilton\nCITEVE' });
  assertEquals(lerRascunho('**Assunto:** Ponto de situação\r\n---\r\nBom dia,\r\nTeste')?.assunto, 'Ponto de situação');
  assertEquals(lerRascunho('**Assunto:** Ponto de situação\r\n---\r\nBom dia,\r\nTeste')?.corpo, 'Bom dia,\nTeste');
  assertEquals(lerRascunho('Aqui está o email: Bom dia'), null);
  assertEquals(lerRascunho('ASSUNTO: só o assunto'), null);
  assertEquals(lerRascunho(''), null);
});

// Navegação "Voltar" — correr com: node --test tests/navegacao.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../js/navegacao.js');

const v = (chave) => ({ chave, rotulo: chave, reabrir: () => {} });
const chaves = (p) => p.map(x => x.chave);

test('abrir outra janela empurra a atual para a pilha', () => {
  let p = N.aoAbrir([], v('conta:1'), v('op:1'));
  assert.deepEqual(chaves(p), ['conta:1']);
  p = N.aoAbrir(p, v('op:1'), v('prop:1'));
  assert.deepEqual(chaves(p), ['conta:1', 'op:1']);
});

test('janela não navegável (nova, editor) também guarda a atual; abrir sem janela atual não guarda nada', () => {
  assert.deepEqual(chaves(N.aoAbrir([], v('conta:1'), null)), ['conta:1']);
  assert.deepEqual(chaves(N.aoAbrir([], null, v('conta:1'))), []);
  assert.deepEqual(chaves(N.aoAbrir([], null, null)), []);
});

test('reabrir a mesma janela (depois de guardar) não acrescenta', () => {
  const p = N.aoAbrir([v('conta:1')], v('op:1'), v('op:1'));
  assert.deepEqual(chaves(p), ['conta:1']);
});

test('regressar à janela do topo da pilha desfaz a entrada (ex.: fechar o orçamento e voltar à proposta)', () => {
  // conta → proposta → [editor do orçamento, sem chave]: a proposta fica no topo
  let p = N.aoAbrir([v('conta:1')], v('prop:1'), null);
  assert.deepEqual(chaves(p), ['conta:1', 'prop:1']);
  p = N.aoAbrir(p, null, v('prop:1'));
  assert.deepEqual(chaves(p), ['conta:1']);
});

test('não repete a janela atual se já é o topo; a pilha recebida nunca é alterada', () => {
  const original = [v('conta:1'), v('op:1')];
  const p = N.aoAbrir(original, v('op:1'), null);
  assert.deepEqual(chaves(p), ['conta:1', 'op:1']);
  N.aoAbrir(original, v('prop:9'), v('contacto:3'));
  assert.equal(original.length, 2);
});

test('a pilha tem tamanho máximo', () => {
  let p = [];
  for (let i = 0; i < 30; i++) p = N.aoAbrir(p, v('a' + i), v('a' + (i + 1)));
  assert.equal(p.length, N.MAX_PILHA);
  assert.equal(p[p.length - 1].chave, 'a29');
});

test('retornos: junta, não repete o mesmo destino seguido e limita o tamanho', () => {
  let l = N.empurrarRetorno([], { rotulo: 'Conta — A', aba: 'crmContas' });
  l = N.empurrarRetorno(l, { rotulo: 'Conta — A', aba: 'crmContas' });
  assert.equal(l.length, 1);
  for (let i = 0; i < 10; i++) l = N.empurrarRetorno(l, { rotulo: 'R' + i, aba: 'x' });
  assert.equal(l.length, N.MAX_RETORNOS);
  assert.equal(l[l.length - 1].rotulo, 'R9');
});

test('curto: corta textos longos e arruma espaços', () => {
  assert.equal(N.curto('  Conta —   Acme  '), 'Conta — Acme');
  assert.equal(N.curto('x'.repeat(50), 10), 'xxxxxxxxx…');
  assert.equal(N.curto(null), '');
});

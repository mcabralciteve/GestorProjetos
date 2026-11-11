// Navegação "Voltar" do CRM (js/crm.js) com um DOM e um App de mentira — correr com: node --test tests/crm-navegacao.test.js
// Confirma o encadeamento real: conta → oportunidade → proposta → orçamento, guardar/voltar, fechar, e o salto para o Gantt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar() {
  const botoes = {};
  const el = (id) => botoes[id] || (botoes[id] = { style: {}, textContent: '', title: '' });
  const modal = { titulo: '', aberto: false, voltarVisivel: false };
  const App = {
    abaAtiva: 'crmContas', retornos: [], gantt: [],
    els: {
      modalBackdrop: { classList: { contains: () => modal.aberto } },
      get modalTitulo() { return { textContent: modal.titulo }; }
    },
    abrirModal(titulo) { modal.titulo = titulo; modal.aberto = true; el('modalVoltar').style.display = 'none'; },
    fecharModal() { modal.aberto = false; Crm.aoFecharModal(); },
    empurrarRetorno(r) { this.retornos = Navegacao.empurrarRetorno(this.retornos, r); },
    abrirProjetoNoGantt(id, o) { this.gantt.push({ id, o }); this.abaAtiva = 'gantt'; }
  };
  const ctx = { App, console, document: { getElementById: el }, module: undefined };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/navegacao.js'), 'utf8').replace('if (typeof module', 'if (false && typeof module'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/crm.js'), 'utf8').replace(/if \(typeof module[^\n]*\n?/g, ''), ctx);
  const Crm = vm.runInContext('Crm', ctx);
  const Navegacao = vm.runInContext('Navegacao', ctx);
  ctx.Crm = Crm; ctx.Navegacao = Navegacao;
  // abrirX a sério precisam de dados/DOM do CRM: aqui só interessa o encadeamento, por isso usa-se Crm.abrir com vistas iguais às reais.
  const vista = (chave, rotulo) => ({ chave, rotulo, reabrir: () => Crm.abrir(rotulo, '', true, vista(chave, rotulo)) });
  const abrir = (chave, rotulo) => Crm.abrir(rotulo, '', true, vista(chave, rotulo));
  return { Crm, App, modal, abrir, botao: () => el('modalVoltar'), vista };
}

test('conta → oportunidade → proposta: o botão Voltar mostra a janela anterior e desfaz um passo de cada vez', () => {
  const { Crm, abrir, botao, modal } = montar();
  abrir('conta:1', 'Conta — Acme');
  assert.equal(botao().style.display, 'none');
  abrir('op:1', 'Oportunidade — FabricFinder');
  assert.equal(botao().style.display, '');
  assert.match(botao().textContent, /Conta — Acme/);
  abrir('prop:1', 'Proposta 2026/1353-01');
  assert.match(botao().textContent, /Oportunidade — FabricFinder/);
  Crm.voltar();
  assert.equal(modal.titulo, 'Oportunidade — FabricFinder');
  assert.match(botao().textContent, /Conta — Acme/);
  Crm.voltar();
  assert.equal(modal.titulo, 'Conta — Acme');
  assert.equal(botao().style.display, 'none');
  assert.equal(Crm.pilha.length, 0);
});

test('guardar e reabrir a mesma janela não cria passos extra; fechar (✕) esvazia a pilha', () => {
  const { Crm, App, abrir } = montar();
  abrir('conta:1', 'Conta — Acme');
  abrir('op:1', 'Oportunidade — X');
  abrir('op:1', 'Oportunidade — X');   // reaberta depois de guardar
  assert.equal(Crm.pilha.length, 1);
  App.fecharModal();
  assert.equal(Crm.pilha.length, 0);
  abrir('op:2', 'Oportunidade — Y');   // abertura "a frio" a partir de uma lista
  assert.equal(Crm.pilha.length, 0);
});

test('janela sem vista (editor do orçamento) guarda a proposta; voltar à proposta desfaz o passo', () => {
  const { Crm, abrir, botao, modal } = montar();
  abrir('conta:1', 'Conta — Acme');
  abrir('prop:1', 'Proposta v1');
  Crm.abrir('Orçamento v1', '', true);        // editor: sem vista
  assert.match(botao().textContent, /Proposta v1/);
  abrir('prop:1', 'Proposta v1');             // Orc.voltar() → Crm.abrirProposta
  assert.deepEqual(Array.from(Crm.pilha, x => x.chave), ['conta:1']);
  assert.match(botao().textContent, /Conta — Acme/);
  assert.equal(modal.titulo, 'Proposta v1');
});

test('Cancelar/Guardar: volta à janela de origem se houver, senão fecha', () => {
  const { Crm, modal, abrir } = montar();
  abrir('conta:1', 'Conta — Acme');
  Crm.abrir('Novo contacto', '', false);      // contacto novo, sem vista
  Crm.fecharOuVoltar();
  assert.equal(modal.titulo, 'Conta — Acme');
  assert.equal(modal.aberto, true);
  Crm.fecharOuVoltar();                        // já não há para onde voltar
  assert.equal(modal.aberto, false);
});

test('saltar da conta (via oportunidade) para o Gantt guarda o retorno com a pilha; restaurar repõe tudo', () => {
  const { Crm, App, modal, abrir } = montar();
  abrir('conta:1', 'Conta — Acme');
  abrir('op:1', 'Oportunidade — FabricFinder');
  Crm.abrirProjetoNoGantt('proj-9');
  assert.equal(modal.aberto, false);
  assert.equal(App.gantt.length, 1);
  assert.equal(App.gantt[0].o.semRetorno, true);
  assert.equal(App.retornos.length, 1);
  assert.equal(App.retornos[0].rotulo, 'Oportunidade — FabricFinder');
  assert.equal(App.retornos[0].aba, 'crmContas');
  assert.deepEqual(Array.from(App.retornos[0].pilha, x => x.chave), ['conta:1']);
  assert.equal(Crm.pilha.length, 0);
  // "↩ Voltar a Oportunidade — FabricFinder"
  const r = App.retornos.pop();
  Crm.restaurar(r);
  assert.equal(modal.titulo, 'Oportunidade — FabricFinder');
  assert.deepEqual(Array.from(Crm.pilha, x => x.chave), ['conta:1']);
  Crm.voltar();
  assert.equal(modal.titulo, 'Conta — Acme');
});

test('saltar para o Gantt sem janela aberta (lista/dashboard) deixa o retorno ao separador a cargo do App', () => {
  const { Crm, App } = montar();
  Crm.abrirProjetoNoGantt('proj-9');
  assert.equal(App.gantt[0].o.semRetorno, false);
  assert.equal(App.retornos.length, 0);
});

// Navegação "Voltar": regras puras (sem DOM), testadas em tests/navegacao.test.js. A parte visual está em Crm (botão
// "← Voltar" na janela) e em App (botão "Voltar a…" na barra de cima, para quem saltou para o Gantt).
//
// Dois níveis, de propósito:
//  1) PILHA DE JANELAS (dentro do CRM): conta → oportunidade → proposta → orçamento. Cada janela "navegável" tem uma
//     chave (ex.: "conta:123"). Ao abrir outra janela empurra-se a atual para a pilha; ao voltar tira-se de lá.
//  2) RETORNOS (entre separadores): quando se salta da janela da conta para o Gantt de um projeto, guarda-se onde se
//     estava (separador + janela + a pilha que havia) para o botão "Voltar a…" repor tudo, sem repetir a pesquisa.
const Navegacao = {
  MAX_PILHA: 12,
  MAX_RETORNOS: 5,

  // pilha: [{chave, rotulo, reabrir}], atual: a janela que está aberta agora (ou null), nova: a que vai abrir (ou null
  // quando não é navegável, ex.: "Nova oportunidade", o editor de orçamento). Devolve a pilha nova (não altera a recebida).
  aoAbrir(pilha, atual, nova) {
    const topo = pilha.length ? pilha[pilha.length - 1] : null;
    // Voltámos a uma janela que já estava na pilha (ex.: gravou e reabriu a mesma, ou fechou o orçamento e regressou
    // à proposta): é um regresso, não uma nova entrada.
    if (nova && topo && topo.chave === nova.chave) return pilha.slice(0, -1);
    // Reabrir a mesma janela (ex.: depois de guardar) não acrescenta nada.
    if (atual && nova && atual.chave === nova.chave) return pilha;
    if (atual && !(topo && topo.chave === atual.chave)) {
      const p = pilha.concat([atual]);
      return p.length > this.MAX_PILHA ? p.slice(p.length - this.MAX_PILHA) : p;
    }
    return pilha;
  },

  // Junta um retorno à lista; não repete o mesmo destino seguido (carregar duas vezes em "Abrir" do mesmo projeto).
  empurrarRetorno(lista, retorno) {
    const ult = lista.length ? lista[lista.length - 1] : null;
    if (ult && ult.rotulo === retorno.rotulo && ult.aba === retorno.aba) return lista;
    const l = lista.concat([retorno]);
    return l.length > this.MAX_RETORNOS ? l.slice(l.length - this.MAX_RETORNOS) : l;
  },

  // Texto cabe num botão: corta com "…".
  curto(texto, max) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    const n = max || 40;
    return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
  }
};

if (typeof module !== 'undefined') module.exports = Navegacao;

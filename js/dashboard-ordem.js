// Ordem dos cartões do Início (arrastar para reordenar) — regras puras, testadas em tests/dashboard-ordem.test.js.
// A preferência é só deste browser (como o resto de "⚙ Personalizar"): uma lista de chaves de cartões, pela ordem escolhida.
const DashboardOrdem = {
  // "atuais": chaves dos cartões que existem agora, pela ordem por omissão; "guardada": a ordem escolhida.
  // Os cartões que a pessoa ainda não ordenou (novos, ou que só aparecem por vezes) ficam à frente, para se verem;
  // os restantes seguem a ordem guardada. Chaves guardadas que já não existem são ignoradas.
  ordenar(atuais, guardada) {
    const g = Array.isArray(guardada) ? guardada : [];
    const existentes = new Set(atuais);
    const conhecidas = g.filter((k, i) => existentes.has(k) && g.indexOf(k) === i);
    const set = new Set(conhecidas);
    return [...atuais.filter(k => !set.has(k)), ...conhecidas];
  },
  // O que se grava depois de uma mudança: a ordem visível agora, seguida das chaves guardadas que não estão visíveis
  // (cartões escondidos em "Personalizar" ou condicionais) — assim, quando voltam, não perdem o seu lugar relativo.
  paraGuardar(visiveis, guardada) {
    const v = new Set(visiveis);
    return [...visiveis, ...(Array.isArray(guardada) ? guardada : []).filter(k => !v.has(k))];
  },
  // Move "chave" para antes (ou depois) de "alvo".
  mover(lista, chave, alvo, depois) {
    if (chave === alvo || !lista.includes(chave) || !lista.includes(alvo)) return lista.slice();
    const sem = lista.filter(k => k !== chave);
    const i = sem.indexOf(alvo);
    sem.splice(depois ? i + 1 : i, 0, chave);
    return sem;
  }
};
if (typeof module !== 'undefined') module.exports = DashboardOrdem;

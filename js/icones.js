// Ícones (traço fino, 24x24, estilo Office) embebidos na app — sem biblioteca nem pedidos externos.
// Uso: <button class="ib" data-icone="plus" data-tip="Legenda ao passar o rato" aria-label="Legenda">; o SVG entra à
// esquerda do conteúdo do botão (o texto, se houver, fica depois). Cada ícone é uma lista de caminhos.
const Icones = {
  CAMINHOS: {
    'plus': ['M12 5v14', 'M5 12h14'],
    'corner-down-right': ['M6 6v6a3 3 0 0 0 3 3h10', 'M15 11l4 4l-4 4'],
    'repeat': ['M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3', 'M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3'],
    'arrow-up': ['M12 5v14', 'M18 11l-6 -6l-6 6'],
    'arrow-down': ['M12 5v14', 'M18 13l-6 6l-6 -6'],
    'sort-ascending': ['M4 6h7', 'M4 12h7', 'M4 18h9', 'M15 9l3 -3l3 3', 'M18 6v12'],
    'indent-increase': ['M20 6H9', 'M20 12h-7', 'M20 18H9', 'M4 8l4 4l-4 4'],
    'indent-decrease': ['M20 6H9', 'M20 12h-7', 'M20 18H9', 'M8 8l-4 4l4 4'],
    'user-plus': ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M16 19h6', 'M19 16v6', 'M6 21v-2a4 4 0 0 1 4 -4h4'],
    'arrow-back-up': ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
    'arrow-forward-up': ['M15 14l4 -4l-4 -4', 'M19 10h-11a4 4 0 1 0 0 8h1'],
    'trash': ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12', 'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3'],
    'copy': ['M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666',
      'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1'],
    'folder-plus': ['M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5', 'M16 19h6', 'M19 16v6'],
    'file-spreadsheet': ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z', 'M8 11h8v7h-8z', 'M8 15h8', 'M11 11v7'],
    'photo': ['M15 8h.01', 'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12', 'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5', 'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3'],
    'file-type-pdf': ['M14 3v4a1 1 0 0 0 1 1h4', 'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4', 'M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6', 'M17 18h2', 'M20 15h-3v6', 'M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z'],
    'link': ['M9 15l6 -6', 'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464', 'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463'],
    'zoom-in': ['M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M7 10h6', 'M10 7v6', 'M21 21l-6 -6']
  },
  svg(nome, tam) {
    const caminhos = this.CAMINHOS[nome];
    if (!caminhos) return '';
    const t = tam || 18;
    return `<svg class="ico" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos.map(d => `<path d="${d}"/>`).join('')}</svg>`;
  },
  // Põe o ícone em cada elemento [data-icone] da raiz (uma só vez por elemento).
  aplicar(raiz) {
    (raiz || document).querySelectorAll('[data-icone]').forEach(el => {
      if (el.querySelector(':scope > svg.ico')) return;
      el.insertAdjacentHTML('afterbegin', this.svg(el.dataset.icone, el.dataset.icoTam));
    });
  }
};
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Icones.aplicar());
  else Icones.aplicar();
}

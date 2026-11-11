// Email de sexta-feira: as datas com horas por carregar no orcprev, com um link direto para a cópia de cada semana.
// Pura (sem rede) para se poder testar. O link abre o Gestor (depois do login) já na janela "Horas → orcprev" dessa semana
// (ver OrcprevEstado.aoEntrar em js/orcprev-estado.js: lê "#orcprev=AAAA-MM-DD").
import type { SemanaPorCarregar } from './logica.ts';

export interface EmailMontado { assunto: string; texto: string; html: string }

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const dm = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
const diaSemana = (iso: string) => DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()];
const horas = (n: number) => `${(Math.round(n * 100) / 100).toString().replace('.', ',')}h`;

// O link tem sempre a barra final do site e o #orcprev=… no fim (um "#" já existente no APP_URL é ignorado).
export function linkDaSemana(appUrl: string, inicio: string): string {
  return `${appUrl.replace(/#.*$/, '').replace(/\/?$/, '/')}#orcprev=${inicio}`;
}

export const totalDias = (semanas: SemanaPorCarregar[]) => semanas.reduce((s, x) => s + x.dias.length, 0);

export function montarEmail(nome: string, semanas: SemanaPorCarregar[], appUrl: string): EmailMontado {
  const primeiro = nome.split(' ')[0];
  const n = totalDias(semanas);
  const assunto = `Tens ${n} dia(s) com horas por carregar no orcprev`;
  const rodape = 'Mensagem automática do FIO — podes desligá-la em "A minha conta".';
  const linhaDia = (d: { data: string; gestor: number; carregado: number }) =>
    `${diaSemana(d.data)}, ${dm(d.data)} — ${horas(Math.max(0, d.gestor - d.carregado))} por carregar` + (d.carregado > 0 ? ` (já carregadas ${horas(d.carregado)})` : '');

  const texto = `Olá ${primeiro},\n\nHá horas registadas no Gestor que ainda não foram carregadas no orcprev:\n\n` +
    semanas.map(s => `Semana ${dm(s.inicio)} a ${dm(s.fim)}\n` + s.dias.map(d => `  • ${linhaDia(d)}`).join('\n') + `\n  Copiar e importar: ${linkDaSemana(appUrl, s.inicio)}`).join('\n\n') +
    `\n\nSe já lançaste à mão no orcprev, abre a semana no Gestor e carrega em "Já lancei à mão".\n\n(${rodape})`;

  const html = `<p>Olá ${escapar(primeiro)},</p><p>Há horas registadas no Gestor que <b>ainda não foram carregadas no orcprev</b>:</p>` +
    semanas.map(s =>
      `<h3 style="margin:16px 0 6px;font-size:15px">Semana ${dm(s.inicio)} a ${dm(s.fim)}</h3><ul style="margin:0;padding-left:20px">` +
      s.dias.map(d => `<li style="margin-bottom:4px">${escapar(linhaDia(d))}</li>`).join('') + '</ul>' +
      `<p style="margin:8px 0 0"><a href="${linkDaSemana(appUrl, s.inicio)}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#1f4e79;color:#fff;text-decoration:none;font-weight:600">Copiar e importar esta semana</a></p>`).join('') +
    `<p style="margin-top:18px;color:#555">Se já lançaste à mão no orcprev, abre a semana no Gestor e carrega em <b>"Já lancei à mão"</b>.</p><p style="color:#888;font-size:12px">${rodape}</p>`;
  return { assunto, texto, html };
}

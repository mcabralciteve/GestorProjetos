// Montagem do email do resumo diário (texto + HTML) — pura, para se poder testar sem enviar nada.
import type { ItemAgenda, ItemPasso, ResumoDia } from './logica.ts';

export interface EmailMontado { assunto: string; texto: string; html: string }

const MAX_TAREFAS = 8;
const MAX_PASSOS = 10;

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dm = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;
export const horas = (n: number) => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}h`;

interface Linha { titulo: string; detalhe: string; destaque?: boolean }

function linhaTarefa(i: ItemAgenda, extra: string): Linha {
  const partes = [i.projeto, `${dm(i.inicio)} a ${dm(i.fim)}`, `${i.progresso}% concluída`];
  if (extra) partes.splice(1, 0, extra);
  if (i.horasPrevistas !== null) partes.push(`${horas(i.horasPrevistas)} previstas`);
  if (i.registadas > 0) partes.push(`${horas(i.registadas)} registadas`);
  return { titulo: i.tarefa, detalhe: partes.join(' · ') };
}

function linhaPasso(p: ItemPasso): Linha {
  const partes = [p.projeto];
  if (p.tarefa) partes.push(p.tarefa);
  if (p.prazo) partes.push(p.atrasado ? `prazo ${dm(p.prazo)} — em atraso` : `prazo ${dm(p.prazo)}`);
  if (p.estado === 'em_curso') partes.push('em curso');
  return { titulo: p.descricao, detalhe: partes.join(' · '), destaque: p.atrasado };
}

interface Seccao { titulo: string; linhas: Linha[]; total: number }

function seccoes(r: ResumoDia): Seccao[] {
  const corta = <T>(l: T[], max: number) => l.slice(0, max);
  const todas: Seccao[] = [
    { titulo: 'Tarefas de hoje', linhas: corta(r.hoje, MAX_TAREFAS).map(i => linhaTarefa(i, '')), total: r.hoje.length },
    { titulo: 'Em atraso', linhas: corta(r.atrasadas, MAX_TAREFAS).map(i => linhaTarefa(i, `devia terminar a ${dm(i.fim)}`)), total: r.atrasadas.length },
    { titulo: 'Next steps abertos', linhas: corta(r.passos, MAX_PASSOS).map(linhaPasso), total: r.passos.length },
    { titulo: 'Nos próximos dias', linhas: corta(r.proximas, MAX_TAREFAS).map(i => linhaTarefa(i, `começa a ${dm(i.inicio)}`)), total: r.proximas.length },
  ];
  return todas.filter(s => s.total > 0);
}

export function assuntoDoResumo(r: ResumoDia): string {
  const partes: string[] = [];
  if (r.hoje.length) partes.push(`${r.hoje.length} tarefa(s) hoje`);
  if (r.atrasadas.length) partes.push(`${r.atrasadas.length} em atraso`);
  if (r.passos.length) partes.push(`${r.passos.length} next step(s)`);
  return `O teu resumo de hoje${partes.length ? ' — ' + partes.join(', ') : ''}`;
}

export function montarEmail(nome: string, diaTexto: string, r: ResumoDia, appUrl: string): EmailMontado {
  const primeiro = nome.split(' ')[0];
  const rodape = 'Mensagem automática do Gestor de Projetos — podes desligá-la em "A minha conta".';
  const sec = seccoes(r);
  const resto = (s: Seccao) => s.total > s.linhas.length ? s.total - s.linhas.length : 0;

  const txt = sec.map(s =>
    `${s.titulo.toUpperCase()} (${s.total})\n` +
    s.linhas.map(l => `  • ${l.titulo}\n      ${l.detalhe}`).join('\n') +
    (resto(s) ? `\n  … e mais ${resto(s)} (abre a app)` : '')).join('\n\n');
  const texto = `Olá ${primeiro},\n\nO teu resumo de ${diaTexto}:\n\n${txt}\n\nAbre a app: ${appUrl}\n\n(${rodape})`;

  const html = sec.map(s =>
    `<h3 style="margin:18px 0 6px;font-size:15px">${escapar(s.titulo)} <span style="color:#888;font-weight:400">(${s.total})</span></h3><ul style="margin:0;padding-left:20px">` +
    s.linhas.map(l =>
      `<li style="margin-bottom:6px"><b${l.destaque ? ' style="color:#b91c1c"' : ''}>${escapar(l.titulo)}</b><br><span style="color:#666">${escapar(l.detalhe)}</span></li>`).join('') +
    (resto(s) ? `<li style="color:#888">… e mais ${resto(s)} (abre a app)</li>` : '') + '</ul>').join('');
  const corpo = `<p>Olá ${escapar(primeiro)},</p><p>O teu resumo de <b>${escapar(diaTexto)}</b>:</p>${html}` +
    `<p style="margin-top:20px"><a href="${appUrl}">Abrir a app</a></p><p style="color:#888;font-size:12px">${rodape}</p>`;
  return { assunto: assuntoDoResumo(r), texto, html: corpo };
}

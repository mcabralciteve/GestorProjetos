import { assertEquals } from 'jsr:@std/assert@1';
import { ehSexta, horasEnviaveisPorDia, segundaDaSemana, semanasPorCarregar, type Envio, type RegistoOrc } from './logica.ts';
import { linkDaSemana, montarEmail } from './email.ts';

// 2026-11-13 é sexta-feira; a segunda dessa semana é 2026-11-09.
const HOJE = '2026-11-13';
const reg = (data: string, horas: number, tipo: string | null = null): RegistoOrc => ({ pessoa: 'Ana', data, horas, tipo_trabalho_id: tipo });
const envio = (semana: string, dias: Record<string, number>, confirmado: string | null = '2026-11-10T10:00:00Z', criado = '2026-11-10T09:55:00Z'): Envio =>
  ({ recurso_id: 'r1', semana_inicio: semana, criado_em: criado, confirmado_em: confirmado, dias });
const nenhum = new Set<string>();

Deno.test('datas: segunda-feira da semana e sexta-feira', () => {
  assertEquals(segundaDaSemana('2026-11-13'), '2026-11-09');
  assertEquals(segundaDaSemana('2026-11-15'), '2026-11-09'); // domingo pertence à semana que acabou
  assertEquals(ehSexta('2026-11-13'), true);
  assertEquals(ehSexta('2026-11-12'), false);
});

Deno.test('horas enviáveis: tipos sem atividade e horas nulas ficam de fora; só dentro do intervalo', () => {
  const m = horasEnviaveisPorDia([reg('2026-11-09', 3), reg('2026-11-09', 2, 'reun'), reg('2026-11-09', 1, 'form'), reg('2026-11-10', 0), reg('2026-11-20', 5)],
    new Set(['form']), '2026-11-09', '2026-11-15');
  assertEquals(m, { '2026-11-09': 5 });
});

Deno.test('sem envios: todos os dias com horas (até hoje) ficam por carregar; dias futuros não contam', () => {
  const s = semanasPorCarregar(HOJE, null, [reg('2026-11-09', 8), reg('2026-11-10', 8), reg('2026-11-14', 4)], [], nenhum);
  assertEquals(s.length, 1);
  assertEquals(s[0].inicio, '2026-11-09');
  assertEquals(s[0].dias.map(d => d.data), ['2026-11-09', '2026-11-10', '2026-11-14'].filter(d => d <= HOJE));
});

Deno.test('envio confirmado cobre os dias (folga de 0,25 h); acima disso o dia volta a ficar por carregar', () => {
  const regs = [reg('2026-11-09', 8.2), reg('2026-11-10', 8.5)];
  const s = semanasPorCarregar(HOJE, null, regs, [envio('2026-11-09', { '2026-11-09': 8, '2026-11-10': 8 })], nenhum);
  assertEquals(s.length, 1);
  assertEquals(s[0].dias.map(d => d.data), ['2026-11-10']);
  assertEquals(s[0].dias[0].carregado, 8);
});

Deno.test('envio por confirmar não conta; usa-se o último confirmado', () => {
  const regs = [reg('2026-11-09', 8)];
  assertEquals(semanasPorCarregar(HOJE, null, regs, [envio('2026-11-09', {}, null)], nenhum).length, 1);
  const velho = envio('2026-11-09', { '2026-11-09': 2 }, '2026-11-10T08:00:00Z');
  const novo = envio('2026-11-09', { '2026-11-09': 8 }, '2026-11-11T08:00:00Z');
  assertEquals(semanasPorCarregar(HOJE, null, regs, [velho, novo], nenhum).length, 0);
});

Deno.test('"desde" corta as semanas anteriores; no máximo 8 semanas; ordem do mais antigo para o mais recente', () => {
  const regs = [reg('2026-11-02', 8), reg('2026-11-09', 8), reg('2026-09-01', 8)];
  assertEquals(semanasPorCarregar(HOJE, '2026-11-04', regs, [], nenhum).map(s => s.inicio), ['2026-11-09']);
  assertEquals(semanasPorCarregar(HOJE, null, regs, [], nenhum).map(s => s.inicio), ['2026-11-02', '2026-11-09']); // 2026-09-01 está fora das 8 semanas
});

Deno.test('email: assunto com o total de dias, um link por semana e o rodapé FIO', () => {
  const s = semanasPorCarregar(HOJE, null, [reg('2026-11-09', 8), reg('2026-11-10', 6)], [envio('2026-11-09', { '2026-11-09': 8 })], nenhum);
  const e = montarEmail('Ana Silva', s, 'https://x.github.io/App');
  assertEquals(e.assunto, 'Tens 1 dia(s) com horas por carregar no orcprev');
  assertEquals(e.texto.includes('https://x.github.io/App/#orcprev=2026-11-09'), true);
  assertEquals(e.html.includes('href="https://x.github.io/App/#orcprev=2026-11-09"'), true);
  assertEquals(e.texto.includes('terça, 10/11 — 6h por carregar'), true);
  assertEquals(e.html.includes('Mensagem automática do FIO'), true);
  assertEquals(linkDaSemana('https://x.github.io/App/#antigo', '2026-11-02'), 'https://x.github.io/App/#orcprev=2026-11-02');
});

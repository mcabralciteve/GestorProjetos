import { assertEquals } from 'jsr:@std/assert@1';
import { diasEmFalta, ehDiaUtil, hojeEmLisboa, indexarHoras } from './logica.ts';

// 2026-09-24 é quinta-feira.
const HOJE = '2026-09-24';
const sem = new Set<string>();

Deno.test('sem registos: os 10 dias úteis anteriores (hoje não conta, fins de semana saltam)', () => {
  const dias = diasEmFalta('r1', 'Ana', HOJE, 10, sem, [], new Map());
  assertEquals(dias.length, 10);
  assertEquals(dias[0].iso, '2026-09-10'); // 10.º dia útil para trás
  assertEquals(dias[9].iso, '2026-09-23');
  assertEquals(dias.every(d => d.faltam === 8), true);
});

Deno.test('dia completo (8h, mesmo somando registos) não aparece; parcial mostra o que falta', () => {
  const horas = indexarHoras([
    { pessoa: 'Ana', data: '2026-09-23', horas: 5 }, { pessoa: 'Ana', data: '2026-09-23', horas: '3' },
    { pessoa: 'Ana', data: '2026-09-22', horas: 5 },
    { pessoa: 'Outra', data: '2026-09-21', horas: 8 },
  ]);
  const dias = diasEmFalta('r1', 'Ana', HOJE, 3, sem, [], horas);
  assertEquals(dias.map(d => d.iso), ['2026-09-21', '2026-09-22']);
  assertEquals(dias[1].faltam, 3);
});

Deno.test('feriado e ausência aprovada/pendente não contam; rejeitada conta', () => {
  const feriados = new Set(['2026-09-23']);
  const ausencias = [
    { recurso_id: 'r1', data_inicio: '2026-09-22', data_fim: '2026-09-22', estado: 'pendente' },
    { recurso_id: 'r1', data_inicio: '2026-09-21', data_fim: '2026-09-21', estado: 'rejeitada' },
    { recurso_id: 'r2', data_inicio: '2026-09-18', data_fim: '2026-09-18', estado: 'aprovada' },
  ];
  const dias = diasEmFalta('r1', 'Ana', HOJE, 3, feriados, ausencias, new Map());
  // 3 dias úteis contáveis para trás: 21 (rejeitada conta), 18 e 17 (22 ausente, 23 feriado, 19-20 é fim de semana... 18 é sexta)
  assertEquals(dias.map(d => d.iso), ['2026-09-17', '2026-09-18', '2026-09-21']);
});

Deno.test('ehDiaUtil', () => {
  assertEquals(ehDiaUtil('2026-09-26', sem), false); // sábado
  assertEquals(ehDiaUtil('2026-09-24', new Set(['2026-09-24'])), false);
  assertEquals(ehDiaUtil('2026-09-24', sem), true);
});

Deno.test('hojeEmLisboa: 23:30 UTC de verão já é dia seguinte em Lisboa', () => {
  assertEquals(hojeEmLisboa(new Date('2026-07-01T23:30:00Z')), '2026-07-02');
  assertEquals(hojeEmLisboa(new Date('2026-01-15T23:30:00Z')), '2026-01-15');
});

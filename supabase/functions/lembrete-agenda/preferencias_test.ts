import { assert, assertEquals } from 'jsr:@std/assert@1';
import { aplicarPreferencias, resumoVazio, totalItens, type ResumoDia } from './logica.ts';

const item = (n: string) => ({ id: n, projeto: 'P', tarefa: n, inicio: '2026-10-01', fim: '2026-10-09', progresso: 0, horasPrevistas: null, registadas: 0 });
const resumo = (): ResumoDia => ({
  hoje: [item('h')], atrasadas: [item('a')], proximas: [item('p')],
  passos: [{ descricao: 'x', projeto: 'P', tarefa: null, prazo: null, atrasado: false, estado: 'aberto' }],
  aprovacoes: [{ pessoa: 'Ana', tipo: 'Férias', inicio: '2026-10-20', fim: '2026-10-22' }],
  followups: [{ descricao: 'f', contexto: '', prazo: '2026-10-07', atrasado: false }],
  oportunidades: [{ titulo: 'o', conta: 'c', etapa: 'e', valor: 1, fecho: '2026-10-09', ultrapassado: false }],
});

Deno.test('sem preferências (ou {}) recebe tudo; chave em falta = ligada', () => {
  assertEquals(totalItens(aplicarPreferencias(resumo(), null)), 7);
  assertEquals(totalItens(aplicarPreferencias(resumo(), undefined)), 7);
  assertEquals(totalItens(aplicarPreferencias(resumo(), {})), 7);
  assertEquals(totalItens(aplicarPreferencias(resumo(), { hoje: true })), 7);
});

Deno.test('false desliga só essa secção, sem alterar o original', () => {
  const original = resumo();
  const r = aplicarPreferencias(original, { proximas: false, followups: false, oportunidades: false });
  assertEquals([r.proximas.length, r.followups?.length, r.oportunidades?.length], [0, 0, 0]);
  assertEquals([r.hoje.length, r.atrasadas.length, r.passos.length, r.aprovacoes?.length], [1, 1, 1, 1]);
  assertEquals(original.proximas.length, 1);
});

Deno.test('desligar tudo deixa o resumo vazio (não se envia email)', () => {
  const tudo = Object.fromEntries(['hoje', 'atrasadas', 'passos', 'proximas', 'aprovacoes', 'followups', 'oportunidades'].map(k => [k, false]));
  assert(resumoVazio(aplicarPreferencias(resumo(), tudo)));
});

Deno.test('chaves desconhecidas são ignoradas', () => {
  assertEquals(totalItens(aplicarPreferencias(resumo(), { naoExiste: false })), 7);
});

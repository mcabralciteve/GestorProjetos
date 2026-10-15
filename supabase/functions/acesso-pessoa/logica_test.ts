import { assert, assertEquals } from 'jsr:@std/assert@1';
import { estaInativo, hojeLisboa, paraSuspenderNaRotina, podeRestaurar, podeRevogar, type RecursoAcesso } from './logica.ts';

const HOJE = '2026-10-15';
const r = (id: string, o: Partial<RecursoAcesso> = {}): RecursoAcesso =>
  ({ id, nome: id.toUpperCase(), auth_user_id: `auth-${id}`, acesso: 'user', ativo: true, data_saida: null, ...o });

Deno.test('inativa: marcada, ou data de saída já passou (o próprio dia ainda trabalha)', () => {
  assertEquals(estaInativo(r('a'), HOJE), false);
  assertEquals(estaInativo(r('a', { data_saida: HOJE }), HOJE), false);
  assertEquals(estaInativo(r('a', { data_saida: '2026-10-14' }), HOJE), true);
  assertEquals(estaInativo(r('a', { ativo: false }), HOJE), true);
  assertEquals(estaInativo({ ativo: null, data_saida: null }, HOJE), false);   // colunas ainda sem valor
});

Deno.test('revogar: só quem está inativa; sem conta não há nada a fazer', () => {
  const todos = [r('admin', { acesso: 'admin' }), r('x', { ativo: false }), r('semconta', { ativo: false, auth_user_id: null })];
  assertEquals(podeRevogar(todos[1], todos, HOJE, 'auth-admin').ok, true);
  const ativa = podeRevogar(r('y'), todos, HOJE, 'auth-admin');
  assertEquals(ativa.ok, false);
  const sem = podeRevogar(todos[2], todos, HOJE, 'auth-admin');
  assert(sem.ok && sem.semConta === true);
});

Deno.test('revogar: nunca o próprio, nem o último Administrador ativo', () => {
  const eu = r('eu', { acesso: 'admin', ativo: false });
  const outro = r('outro', { acesso: 'admin' });
  assertEquals(podeRevogar(eu, [eu, outro], HOJE, 'auth-eu').ok, false);          // o próprio
  assertEquals(podeRevogar(eu, [eu, outro], HOJE, 'auth-outro').ok, true);        // outro admin ativo pede
  const sozinho = [r('adm1', { acesso: 'admin', ativo: false }), r('adm2', { acesso: 'admin', data_saida: '2026-10-01' })];
  assertEquals(podeRevogar(sozinho[0], sozinho, HOJE, null).ok, false);           // ninguém ficava
});

Deno.test('restaurar: só se já não estiver inativa', () => {
  assertEquals(podeRestaurar(r('a', { ativo: false }), HOJE).ok, false);
  assertEquals(podeRestaurar(r('a'), HOJE).ok, true);
  assertEquals(podeRestaurar(r('a', { data_saida: '2026-11-30' }), HOJE).ok, true);   // sai mais tarde: ainda ativa
});

Deno.test('rotina diária: suspende inativas com conta; protege os Administradores se nenhum ficar ativo', () => {
  const todos = [
    r('adm', { acesso: 'admin' }), r('u1'), r('u2', { ativo: false }), r('u3', { data_saida: '2026-09-30' }),
    r('u4', { ativo: false, auth_user_id: null }), r('u5', { data_saida: '2026-12-01' }),
  ];
  assertEquals(paraSuspenderNaRotina(todos, HOJE).map((x) => x.id), ['u2', 'u3']);
  const semAdminAtivo = [r('adm', { acesso: 'admin', ativo: false }), r('u2', { ativo: false })];
  assertEquals(paraSuspenderNaRotina(semAdminAtivo, HOJE).map((x) => x.id), ['u2']);
});

Deno.test('hoje em Lisboa', () => {
  assertEquals(hojeLisboa(new Date('2026-10-15T23:30:00Z')), '2026-10-16');       // já é dia 16 em Lisboa (UTC+1 em outubro)
  assertEquals(hojeLisboa(new Date('2026-01-15T23:30:00Z')), '2026-01-15');
});

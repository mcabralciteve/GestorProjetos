import { assertEquals } from 'jsr:@std/assert@1';
import { elegiveis, type Recurso } from './comum.ts';

const r = (id: string, email: string, auth: string | null, lembretes: boolean | null): Recurso =>
  ({ id, nome: id, email, auth_user_id: auth, lembretes_email: lembretes });

const todos = [
  r('com-conta', 'a@x.pt', 'u1', true),
  r('sem-conta', 'b@x.pt', null, true),
  r('sem-email', '  ', 'u3', true),
  r('desligou', 'd@x.pt', 'u4', false),
  r('coluna-nula', 'e@x.pt', 'u5', null), // linha antiga, antes da coluna existir -> conta como ligado
];

Deno.test('só quem tem conta, email e não desligou os lembretes', () => {
  assertEquals(elegiveis(todos, '').map(x => x.id), ['com-conta', 'coluna-nula']);
});

Deno.test('apenas restringe a um endereço, sem distinguir maiúsculas', () => {
  assertEquals(elegiveis(todos, 'a@x.pt').map(x => x.id), ['com-conta']);
  assertEquals(elegiveis([r('m', 'Ana@X.pt', 'u', true)], 'ana@x.pt').length, 1);
  assertEquals(elegiveis(todos, 'd@x.pt'), []); // quem desligou nunca é apanhado, nem por "apenas"
});

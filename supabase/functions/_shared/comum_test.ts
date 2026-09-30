import { assertEquals } from 'jsr:@std/assert@1';
import { elegiveis, enviar, type Recurso } from './comum.ts';

const r = (id: string, email: string, auth: string | null, lembretes: boolean | null, piloto: boolean | null = null): Recurso =>
  ({ id, nome: id, email, auth_user_id: auth, lembretes_email: lembretes, piloto_lembretes: piloto });

const todos = [
  r('com-conta', 'a@x.pt', 'u1', true),
  r('sem-conta', 'b@x.pt', null, true),
  r('sem-email', '  ', 'u3', true),
  r('desligou', 'd@x.pt', 'u4', false),
  r('coluna-nula', 'e@x.pt', 'u5', null), // linha antiga, antes da coluna existir -> conta como ligado
];

Deno.test('só quem tem conta, email e não desligou os lembretes (piloto desligado: ignora piloto_lembretes)', () => {
  assertEquals(elegiveis(todos, '', false).map(x => x.id), ['com-conta', 'coluna-nula']);
});

Deno.test('apenas restringe a um endereço, sem distinguir maiúsculas', () => {
  assertEquals(elegiveis(todos, 'a@x.pt', false).map(x => x.id), ['com-conta']);
  assertEquals(elegiveis([r('m', 'Ana@X.pt', 'u', true)], 'ana@x.pt', false).length, 1);
  assertEquals(elegiveis(todos, 'd@x.pt', false), []); // quem desligou nunca é apanhado, nem por "apenas"
});

Deno.test('modo piloto: só quem o Administrador marcou (piloto_lembretes=true) entra, mesmo com "apenas"', () => {
  const comPiloto = [
    r('marcado', 'f@x.pt', 'u6', true, true),
    r('nao-marcado', 'g@x.pt', 'u7', true, false),
    r('nulo', 'h@x.pt', 'u8', true, null), // linha antiga, antes da coluna existir -> fora do piloto
  ];
  assertEquals(elegiveis(comPiloto, '', true).map(x => x.id), ['marcado']);
  assertEquals(elegiveis(comPiloto, 'g@x.pt', true), []); // "apenas" nunca contorna o piloto
  assertEquals(elegiveis(comPiloto, 'f@x.pt', true).map(x => x.id), ['marcado']);
});

// Mocka fetch (sem tocar na rede a sério) para confirmar duas coisas do envio pelo Microsoft
// Graph: (1) o pedido de sendMail tem a forma certa (Authorization, destinatário, HTML); (2) o
// token de acesso só é pedido uma vez e reaproveitado nos envios seguintes (ver obterTokenGraph).
Deno.test('enviar: chama o Graph com o token certo, e reaproveita o token em envios seguintes', async () => {
  const original = globalThis.fetch;
  let pedidosDeToken = 0;
  const corposEnviados: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('login.microsoftonline.com')) {
      pedidosDeToken++;
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }), { status: 200 }));
    }
    if (url.includes('graph.microsoft.com') && url.endsWith('/sendMail')) {
      assertEquals((init?.headers as Record<string, string>).Authorization, 'Bearer tok-123');
      corposEnviados.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response(null, { status: 202 }));
    }
    throw new Error('URL inesperado no mock: ' + url);
  }) as typeof fetch;
  try {
    await enviar('destino@x.pt', { assunto: 'Assunto A', texto: 'texto', html: '<p>Corpo A</p>' });
    await enviar('destino@x.pt', { assunto: 'Assunto B', texto: 'texto', html: '<p>Corpo B</p>' });
  } finally {
    globalThis.fetch = original;
  }
  assertEquals(pedidosDeToken, 1); // 2º envio reaproveitou o token em cache, não pediu outro
  assertEquals(corposEnviados.length, 2);
  const msg = corposEnviados[0].message as Record<string, unknown>;
  assertEquals(msg.subject, 'Assunto A');
  assertEquals((msg.body as Record<string, unknown>).content, '<p>Corpo A</p>');
  assertEquals(msg.toRecipients, [{ emailAddress: { address: 'destino@x.pt' } }]);
});

import { assertEquals } from 'jsr:@std/assert@1';
import { backupCompleto, dataDoNome, diasEntre, ficheirosAApagar, lerContagens, nomeDoDia, quedasSuspeitas } from './logica.ts';

Deno.test('nomes: ida e volta; só os nossos são reconhecidos', () => {
  assertEquals(nomeDoDia('2026-11-20'), 'fio_2026-11-20.sql');
  assertEquals(dataDoNome('fio_2026-11-20.sql'), '2026-11-20');
  assertEquals(dataDoNome('fio_2026-11-20.sql.bak'), null);
  assertEquals(dataDoNome('notas.txt'), null);
  assertEquals(diasEntre('2026-10-21', '2026-11-20'), 30);
});

Deno.test('retenção: 30 dias completos + o primeiro de cada mês (até 12 meses); o resto apaga-se', () => {
  const hoje = '2026-11-20';
  const nomes = [
    '2026-11-20', '2026-11-19', '2026-10-21',      // dentro dos 30 dias → ficam
    '2026-10-20', '2026-10-05', '2026-10-01',       // outubro: só o mais antigo (01) fica; 20 e 05 são >30 dias → apagam-se
    '2026-09-30', '2026-09-02', '2026-09-15',       // setembro: fica o 02
    '2025-11-02', '2025-11-20',                     // há 12 meses: fica o primeiro de novembro/2025
    '2025-10-01', '2025-10-15',                     // há 13 meses → apagam-se ambos
  ].map(nomeDoDia);
  assertEquals(ficheirosAApagar(nomes, hoje).sort(), ['2026-10-20', '2026-10-05', '2026-09-30', '2026-09-15', '2025-11-20', '2025-10-01', '2025-10-15'].map(nomeDoDia).sort());
});

Deno.test('retenção: nunca apaga o que não é nosso, nem ficheiros de datas futuras', () => {
  const nomes = ['leia-me.txt', nomeDoDia('2027-01-01'), 'fio_2026-13-45.sql.old'];
  assertEquals(ficheirosAApagar(nomes, '2026-11-20'), []);
});

Deno.test('contagens lidas do cabeçalho', () => {
  const t = '-- Backup\n-- tabela registos: 1208\n-- tabela crm_contas: 171\n-- TOTAL: 2 tabela(s), 1379 linha(s)\nset x;\n-- FIM do backup — 2 tabela(s)';
  assertEquals(lerContagens(t), { registos: 1208, crm_contas: 171 });
  assertEquals(backupCompleto(t), true);
  assertEquals(backupCompleto('-- tabela registos: 5\ninsert ...'), false); // sem marca de fim
  assertEquals(backupCompleto('-- FIM do backup'), false);                    // sem tabelas
});

Deno.test('quedas: >20% em tabelas com 10+ linhas dá alerta; crescimento e tabelas pequenas não', () => {
  const antes = { registos: 1000, tarefas: 380, pequenas: 8, estavel: 50, desapareceu: 100, nova: 0 };
  const depois = { registos: 1211, tarefas: 300, pequenas: 1, estavel: 41 };
  assertEquals(quedasSuspeitas(antes, depois), [
    { tabela: 'desapareceu', antes: 100, depois: 0 },
    { tabela: 'tarefas', antes: 380, depois: 300 },
  ]);
  assertEquals(quedasSuspeitas({ registos: 1000 }, { registos: 800 }), []); // exatamente 20% não chega
});

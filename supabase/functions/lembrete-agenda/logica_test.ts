import { assertEquals } from 'jsr:@std/assert@1';
import { agendaDoDia, indexarAgenda, rotuloProjeto } from './logica.ts';

const HOJE = '2026-09-24';
const projetos = [
  { id: 'p1', id_interno: '2026/001', nome: 'SIAC', cliente: 'Academia', ativo: true },
  { id: 'p2', id_interno: '', nome: 'Sem código', cliente: '', ativo: true },
  { id: 'p3', id_interno: '2026/999', nome: 'Suspenso', cliente: 'X', ativo: false },
];
const tarefas = [
  { id: 't1', projeto_id: 'p1', parent_id: null, nome: 'Fase (tem filhos)', inicio: '2026-09-01', fim: '2026-09-30', progresso: 0 },
  { id: 't2', projeto_id: 'p1', parent_id: 't1', nome: 'Subtarefa hoje', inicio: '2026-09-24', fim: '2026-09-24', progresso: 50 },
  { id: 't3', projeto_id: 'p1', parent_id: 't1', nome: 'Subtarefa amanhã', inicio: '2026-09-25', fim: '2026-09-26', progresso: 0 },
  { id: 't4', projeto_id: 'p2', parent_id: null, nome: 'Termina hoje', inicio: '2026-09-20', fim: '2026-09-24', progresso: null },
  { id: 't5', projeto_id: 'p3', parent_id: null, nome: 'Projeto suspenso', inicio: '2026-09-20', fim: '2026-09-30', progresso: 10 },
  { id: 't6', projeto_id: 'p2', parent_id: null, nome: 'Já acabou', inicio: '2026-09-01', fim: '2026-09-23', progresso: 100 },
];
const atrib = ['t1', 't2', 't3', 't4', 't5', 't6'].map(t => ({ tarefa_id: t, recurso_id: 'r1' }));
const indice = indexarAgenda(projetos, tarefas, atrib);

Deno.test('só folhas, de projetos ativos, com hoje dentro do período; ordenadas', () => {
  const itens = agendaDoDia('r1', HOJE, indice, []);
  assertEquals(itens.map(i => i.tarefa), ['Subtarefa hoje', 'Termina hoje']);
  assertEquals(itens[1].progresso, 0); // null -> 0
});

Deno.test('o projeto aparece sempre com código, nome e cliente', () => {
  assertEquals(rotuloProjeto(projetos[0]), '2026/001 — SIAC (Academia)');
  assertEquals(rotuloProjeto(projetos[1]), 'Sem código');
});

Deno.test('ausência aprovada/pendente esvazia a agenda; rejeitada não; outra pessoa não conta', () => {
  const aus = (estado: string, rec = 'r1') => [{ recurso_id: rec, data_inicio: '2026-09-23', data_fim: '2026-09-25', estado }];
  assertEquals(agendaDoDia('r1', HOJE, indice, aus('aprovada')), []);
  assertEquals(agendaDoDia('r1', HOJE, indice, aus('pendente')), []);
  assertEquals(agendaDoDia('r1', HOJE, indice, aus('rejeitada')).length, 2);
  assertEquals(agendaDoDia('r1', HOJE, indice, aus('aprovada', 'r2')).length, 2);
});

Deno.test('pessoa sem tarefas devolve vazio', () => {
  assertEquals(agendaDoDia('r9', HOJE, indice, []), []);
});

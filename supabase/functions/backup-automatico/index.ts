// Backup automático diário: pede à base de dados o script de restauro de TODAS as tabelas (função SQL gerar_backup_sql, ver
// supabase/backup_automatico.sql), guarda-o no bucket privado "backups-fio" (um ficheiro por dia: diario/fio_AAAA-MM-DD.sql),
// compara com o backup anterior (quedas suspeitas de linhas) e aplica a retenção (30 dias + o primeiro de cada mês, 12 meses).
// Agendado por pg_cron (ver agendar_backup_automatico.sql); protegido pelo mesmo x-cron-secret das outras funções.
// Parâmetros de teste: ?dry=1 — gera e confere o backup, mas não grava nem apaga nada.
import { autorizado, criarDb, hojeLisboaISO, resposta } from '../_shared/comum.ts';
import {
  BUCKET, PASTA, backupCompleto, dataDoNome, ficheirosAApagar, lerContagens, nomeDoDia, quedasSuspeitas,
} from './logica.ts';

Deno.serve(async (req) => {
  if (!autorizado(req)) return resposta({ erro: 'não autorizado' }, 401);
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const db = criarDb();
  const hoje = hojeLisboaISO();

  const { data: sql, error: erroSql } = await db.rpc('gerar_backup_sql');
  if (erroSql || typeof sql !== 'string') {
    return resposta({ erro: String(erroSql?.message ?? 'resposta inesperada'), dica: 'corre supabase/backup_automatico.sql no SQL Editor' }, 500);
  }
  // Nunca se guarda (nem se apaga nada a pensar nele) um backup que não chegou ao fim.
  if (!backupCompleto(sql)) return resposta({ erro: 'backup incompleto (sem marca de fim ou sem tabelas) — nada foi guardado' }, 500);
  const contagens = lerContagens(sql);
  const bytes = new TextEncoder().encode(sql).length;

  const armazem = db.storage.from(BUCKET);
  const { data: lista, error: erroLista } = await armazem.list(PASTA, { limit: 1000 });
  if (erroLista) return resposta({ erro: 'não foi possível listar o bucket: ' + erroLista.message, dica: 'o bucket backups-fio existe? (supabase/backup_automatico.sql)' }, 500);
  const nomes = (lista ?? []).map(f => f.name);

  // Backup anterior = o mais recente com data anterior a hoje (o de hoje, se já existir, é substituído).
  const anterior = nomes.map(n => ({ n, d: dataDoNome(n) })).filter(x => x.d && x.d < hoje).sort((a, b) => String(b.d).localeCompare(String(a.d)))[0];
  let quedas: ReturnType<typeof quedasSuspeitas> = [];
  if (anterior) {
    const { data: ficheiro } = await armazem.download(`${PASTA}/${anterior.n}`);
    if (ficheiro) quedas = quedasSuspeitas(lerContagens(await ficheiro.text()), contagens);
  }
  if (quedas.length) console.warn('BACKUP: tabelas com menos linhas do que no backup anterior', JSON.stringify(quedas));

  const totalLinhas = Object.values(contagens).reduce((s, n) => s + n, 0);
  const base = { hoje, dry, ficheiro: `${PASTA}/${nomeDoDia(hoje)}`, kb: Math.round(bytes / 1024), tabelas: Object.keys(contagens).length, linhas: totalLinhas, registos: contagens.registos ?? 0, anterior: anterior?.n ?? null, quedas };
  if (dry) return resposta({ ...base, apagaria: ficheirosAApagar([...new Set([...nomes, nomeDoDia(hoje)])], hoje) });

  const { error: erroGravar } = await armazem.upload(base.ficheiro, new Blob([sql], { type: 'text/plain' }), { upsert: true, contentType: 'text/plain; charset=utf-8' });
  if (erroGravar) return resposta({ erro: 'não foi possível guardar o backup: ' + erroGravar.message }, 500);

  // Retenção só depois de o novo estar guardado.
  const apagar = ficheirosAApagar([...new Set([...nomes, nomeDoDia(hoje)])], hoje);
  let apagados = 0;
  if (apagar.length) {
    const { error: erroApagar } = await armazem.remove(apagar.map(n => `${PASTA}/${n}`));
    if (erroApagar) console.warn('BACKUP: não foi possível apagar backups antigos', erroApagar.message);
    else apagados = apagar.length;
  }
  return resposta({ ...base, apagados });
});

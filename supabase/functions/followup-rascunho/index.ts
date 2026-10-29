// Rascunho de um email de follow-up ao cliente, escrito pelo Claude a partir do CRM. NÃO envia nada: devolve o texto
// para a pessoa rever na app (copiar, abrir no email, ou registar o envio). Chamada pela app, autenticada com a sessão
// da pessoa — só quem tem acesso ao CRM (crm_tem_acesso) pode pedir. Os dados são lidos COM a sessão da pessoa (RLS),
// por isso nunca se usa mais do que ela própria vê.
// Variáveis: ANTHROPIC_API_KEY (obrigatória); ANTHROPIC_MODEL (opcional, por omissão claude-opus-5-5); as do Supabase são automáticas.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1';
import { hojeLisboaISO } from '../_shared/comum.ts';
import { dataPt, diasEntre, escolherDestinatario, lerRascunho, montarPedido, SISTEMA, MAX_INTERACOES, type Contacto, type DadosFollowup } from './logica.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MODELO = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-5-5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return resposta({ erro: 'Método não suportado.' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return resposta({ erro: 'O assistente ainda não está configurado (falta a chave ANTHROPIC_API_KEY no Supabase).' }, 503);

  // 1) Quem é e se tem acesso ao CRM
  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
  const { data: u } = await db.auth.getUser();
  if (!u?.user) return resposta({ erro: 'Sessão inválida — volta a entrar na app.' }, 401);
  const { data: acesso } = await db.rpc('crm_tem_acesso');
  if (acesso !== true) return resposta({ erro: 'Sem permissão para usar o CRM.' }, 403);

  let pedido: { tarefa_id?: string; para_email?: string; indicacoes?: string };
  try { pedido = await req.json(); } catch { return resposta({ erro: 'Pedido ilegível.' }, 400); }
  if (!pedido.tarefa_id) return resposta({ erro: 'Falta indicar o follow-up.' }, 400);

  // 2) Contexto do CRM (com a sessão da pessoa)
  const { data: tarefa } = await db.from('crm_tarefas').select('id, descricao, data_limite, oportunidade_id, conta_id').eq('id', pedido.tarefa_id).maybeSingle();
  if (!tarefa) return resposta({ erro: 'Não encontrei esse follow-up.' }, 404);
  const { data: op } = tarefa.oportunidade_id
    ? await db.from('crm_oportunidades').select('id, titulo, descricao, conta_id, contacto_id, etapa_id, data_prevista_fecho').eq('id', tarefa.oportunidade_id).maybeSingle()
    : { data: null };
  const contaId = tarefa.conta_id ?? op?.conta_id ?? null;
  if (!contaId) return resposta({ erro: 'Este follow-up não está ligado a nenhuma conta nem oportunidade — liga-o primeiro a uma delas.' }, 400);

  const [conta, etapa, contactos, propostas, interacoes, eu] = await Promise.all([
    db.from('crm_contas').select('nome, setor').eq('id', contaId).maybeSingle(),
    op?.etapa_id ? db.from('crm_etapas').select('nome').eq('id', op.etapa_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('crm_contactos').select('id, nome, cargo, email, papel_decisao').eq('conta_id', contaId),
    op ? db.from('crm_propostas').select('referencia_giaf, versao, data_envio, data_validade, estado').eq('oportunidade_id', op.id).order('versao', { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    (op ? db.from('crm_interacoes').select('tipo, data, resumo').eq('oportunidade_id', op.id) : db.from('crm_interacoes').select('tipo, data, resumo').eq('conta_id', contaId))
      .order('data', { ascending: false }).limit(MAX_INTERACOES),
    db.from('recursos').select('nome').eq('auth_user_id', u.user.id).maybeSingle(),
  ]);
  if (!conta.data) return resposta({ erro: 'Não encontrei a conta deste follow-up.' }, 404);

  const lista = (contactos.data ?? []) as Contacto[];
  const dest = escolherDestinatario(lista, op?.contacto_id ?? null, pedido.para_email ?? '');
  const hojeISO = hojeLisboaISO();
  const dados: DadosFollowup = {
    tarefa: { descricao: tarefa.descricao, data_limite: tarefa.data_limite },
    conta: { nome: conta.data.nome, setor: conta.data.setor ?? '' },
    oportunidade: op ? { titulo: op.titulo, descricao: op.descricao ?? '', etapa: etapa.data?.nome ?? '', data_prevista_fecho: op.data_prevista_fecho } : null,
    propostas: (propostas.data ?? []) as DadosFollowup['propostas'],
    interacoes: (interacoes.data ?? []) as DadosFollowup['interacoes'],
    destinatario: dest ? { nome: dest.nome, cargo: dest.cargo } : null,
    remetente: eu.data?.nome ?? '',
    indicacoes: String(pedido.indicacoes ?? ''),
    hojeISO,
  };

  // 3) O Claude escreve o rascunho
  const claude = new Anthropic();
  let texto = '';
  try {
    const r = await claude.messages.create({
      model: MODELO,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: SISTEMA,
      messages: [{ role: 'user', content: montarPedido(dados) }],
    });
    if (r.stop_reason === 'refusal') return resposta({ erro: 'O assistente recusou escrever este rascunho. Escreve-o à mão ou muda as indicações.' }, 422);
    texto = r.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n');
  } catch (err) {
    console.error('followup-rascunho: erro da API', err);
    if (err instanceof Anthropic.AuthenticationError) return resposta({ erro: 'A chave do assistente (ANTHROPIC_API_KEY) não é válida.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return resposta({ erro: 'O assistente está ocupado — tenta de novo daqui a um minuto.' }, 429);
    if (err instanceof Anthropic.NotFoundError) return resposta({ erro: `O modelo "${MODELO}" não está disponível (ANTHROPIC_MODEL).` }, 502);
    return resposta({ erro: 'Não consegui contactar o assistente. Tenta de novo.' }, 502);
  }
  const rascunho = lerRascunho(texto);
  if (!rascunho) return resposta({ erro: 'O assistente respondeu num formato inesperado. Tenta de novo.' }, 502);

  // Lista do que foi usado, para a pessoa perceber de onde vem o texto.
  const usado: string[] = [`Conta: ${dados.conta.nome}`];
  if (dados.oportunidade) usado.push(`Oportunidade: ${dados.oportunidade.titulo}`);
  for (const p of dados.propostas) if (p.data_envio) usado.push(`Proposta ${p.referencia_giaf || 'sem referência'} enviada a ${dataPt(p.data_envio)} (há ${diasEntre(p.data_envio, hojeISO)} dias)`);
  usado.push(`${Math.min(dados.interacoes.length, MAX_INTERACOES)} contacto(s) anteriores`);
  return resposta({
    ok: true, ...rascunho, modelo: MODELO,
    para: dest?.email ?? '',
    contactos: lista.filter(c => (c.email ?? '').trim()).map(c => ({ nome: c.nome, cargo: c.cargo, email: c.email })),
    usado,
  });
});

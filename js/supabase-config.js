// Configuração de ligação ao Supabase (base de dados + autenticação remotas).
// A "anon key" é pública por definição (é assim que o Supabase espera que seja usada num browser)
// — a segurança fica a cargo das políticas de RLS definidas na base de dados, não do sigilo desta chave.
const SUPABASE_URL = 'https://gdvgmbrseluztwncflcc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkdmdtYnJzZWx1enR3bmNmbGNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODI2NjYsImV4cCI6MjEwMzE1ODY2Nn0.KiUsCVlL1nWlv00kWMsbsaOn6hnPfdOhVT_issrdip0';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Ecrã de autenticação (Supabase Auth). Controla o acesso à app e avisa o resto do código (via um
// evento DOM, não uma chamada direta a App — evita um acoplamento escondido pela ordem dos
// <script>) sempre que o estado de sessão muda, para js/sync.js poder carregar/limpar os dados.
const Auth = {
  modoRegisto: false,

  async init() {
    this.cacheEls();
    this.wireEvents();
    const { data: { session } } = await supabaseClient.auth.getSession();
    this.atualizarUI(session);
    document.dispatchEvent(new CustomEvent('auth-mudou', { detail: session }));
    supabaseClient.auth.onAuthStateChange((_evento, session) => {
      this.atualizarUI(session);
      document.dispatchEvent(new CustomEvent('auth-mudou', { detail: session }));
    });
  },

  cacheEls() {
    this.els = {
      gate: document.getElementById('authGate'),
      form: document.getElementById('formAuth'),
      nome: document.getElementById('authNome'),
      labelNome: document.getElementById('labelAuthNome'),
      email: document.getElementById('authEmail'),
      password: document.getElementById('authPassword'),
      msg: document.getElementById('authMsg'),
      btnSubmit: document.getElementById('btnAuthSubmit'),
      linkAlternar: document.getElementById('linkAlternarAuth'),
      sub: document.getElementById('authSub'),
      userInfo: document.getElementById('authUserInfo'),
      btnSair: document.getElementById('btnSair'),
      btnMinhaConta: document.getElementById('btnMinhaConta'),
      contaMenuWrap: document.getElementById('contaMenuWrap'),
      contaMenuDropdown: document.getElementById('contaMenuDropdown')
    };
  },

  wireEvents() {
    this.els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.modoRegisto) this.registar(); else this.entrar();
    });
    this.els.linkAlternar.addEventListener('click', (e) => {
      e.preventDefault();
      this.modoRegisto = !this.modoRegisto;
      this.atualizarModo();
    });
    this.els.btnSair.addEventListener('click', () => this.sair());
    // Menu "Conta"/"Sair" por baixo do nome: abre/fecha ao clicar no nome, fecha ao clicar fora
    // ou em qualquer opção do menu.
    this.els.userInfo.addEventListener('click', (e) => { e.stopPropagation(); this.alternarMenuConta(); });
    document.addEventListener('click', () => this.fecharMenuConta());
  },

  alternarMenuConta() {
    this.els.userInfo.classList.toggle('aberto');
    this.els.contaMenuDropdown.classList.toggle('aberto');
  },
  fecharMenuConta() {
    this.els.userInfo.classList.remove('aberto');
    this.els.contaMenuDropdown.classList.remove('aberto');
  },

  atualizarModo() {
    this.els.labelNome.style.display = this.modoRegisto ? '' : 'none';
    this.els.btnSubmit.textContent = this.modoRegisto ? 'Criar conta' : 'Entrar';
    this.els.sub.textContent = this.modoRegisto ? 'Cria a tua conta para acederes à app.' : 'Inicia sessão para continuar.';
    this.els.linkAlternar.textContent = this.modoRegisto ? 'Já tens conta? Inicia sessão.' : 'Ainda não tens conta? Cria uma.';
    this.els.msg.textContent = '';
  },

  async entrar() {
    this.els.msg.style.color = 'var(--cinza-500)';
    this.els.msg.textContent = 'A entrar...';
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: this.els.email.value.trim(),
      password: this.els.password.value
    });
    if (error) { this.els.msg.style.color = 'var(--vermelho)'; this.els.msg.textContent = this.traduzirErro(error); return; }
    this.els.msg.textContent = '';
  },

  async registar() {
    this.els.msg.style.color = 'var(--cinza-500)';
    this.els.msg.textContent = 'A criar conta...';
    const { data, error } = await supabaseClient.auth.signUp({
      email: this.els.email.value.trim(),
      password: this.els.password.value,
      options: { data: { nome: this.els.nome.value.trim() } }
    });
    if (error) { this.els.msg.style.color = 'var(--vermelho)'; this.els.msg.textContent = this.traduzirErro(error); return; }
    if (data.user && !data.session) {
      this.els.msg.style.color = 'var(--verde)';
      this.els.msg.textContent = 'Conta criada — verifica o teu email para confirmar antes de entrares.';
    }
  },

  async sair() {
    await supabaseClient.auth.signOut();
  },

  atualizarUI(session) {
    const autenticado = !!session;
    this.els.gate.classList.toggle('aberto', !autenticado);
    this.els.contaMenuWrap.style.display = autenticado ? '' : 'none';
    this.els.userInfo.textContent = autenticado ? '👤 ' + (session.user.user_metadata?.nome || session.user.email) : '';
    if (!autenticado) this.fecharMenuConta();
    if (autenticado) this.els.password.value = '';
  },

  traduzirErro(error) {
    const msg = error.message || '';
    if (msg.includes('Invalid login credentials')) return 'Email ou password incorretos.';
    if (msg.includes('User already registered')) return 'Já existe uma conta com este email.';
    if (msg.includes('Password should be at least')) return 'A password tem de ter pelo menos 6 caracteres.';
    if (msg.includes('Email not confirmed')) return 'Confirma o teu email antes de entrares (verifica a caixa de entrada).';
    return msg || 'Ocorreu um erro. Tenta novamente.';
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());

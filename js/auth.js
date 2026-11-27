// Ecrã de autenticação (Supabase Auth). Controla o acesso à app e avisa o resto do código (via um
// evento DOM, não uma chamada direta a App — evita um acoplamento escondido pela ordem dos
// <script>) sempre que o estado de sessão muda, para js/sync.js poder carregar/limpar os dados.
// A app não cria contas: é o Administrador que as cria no Supabase, para pessoas já registadas em Recursos.
const Auth = {
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
      email: document.getElementById('authEmail'),
      password: document.getElementById('authPassword'),
      msg: document.getElementById('authMsg'),
      userInfo: document.getElementById('authUserInfo'),
      btnSair: document.getElementById('btnSair'),
      btnMinhaConta: document.getElementById('btnMinhaConta'),
      contaMenuWrap: document.getElementById('contaMenuWrap'),
      notifWrap: document.getElementById('notifWrap'),
      contaMenuDropdown: document.getElementById('contaMenuDropdown'),
      btnAtualizarDados: document.getElementById('btnAtualizarDados')
    };
  },

  wireEvents() {
    this.els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.entrar();
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

  async sair() {
    await supabaseClient.auth.signOut();
  },

  atualizarUI(session) {
    const autenticado = !!session;
    this.els.gate.classList.toggle('aberto', !autenticado);
    this.els.contaMenuWrap.style.display = autenticado ? '' : 'none';
    if (this.els.notifWrap) this.els.notifWrap.style.display = autenticado ? '' : 'none';
    if (this.els.btnAtualizarDados) this.els.btnAtualizarDados.style.display = autenticado ? '' : 'none';
    this.els.userInfo.textContent = autenticado ? '👤 ' + (session.user.user_metadata?.nome || session.user.email) : '';
    if (!autenticado) this.fecharMenuConta();
    if (autenticado) this.els.password.value = '';
  },

  traduzirErro(error) {
    const msg = error.message || '';
    if (msg.includes('Invalid login credentials')) return 'Email ou password incorretos.';
    if (msg.includes('Email not confirmed')) return 'Confirma o teu email antes de entrares (verifica a caixa de entrada).';
    return msg || 'Ocorreu um erro. Tenta novamente.';
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());

/* ==========================================================================
   B3 Rebalanceamento & IA — Frontend Application (100% Client-Side)
   ========================================================================== */

class B3App {
  constructor() {
    // --- CONFIGURAÇÃO GOOGLE SHEETS / APPS SCRIPT ---
    // 1. Crie uma Planilha Google.
    // 2. Extensões > Apps Script. Cole o código do arquivo 'docs/api.gs'.
    // 3. Implantar > App da Web (Quem tem acesso: "Qualquer pessoa").
    // 4. Copie a URL gerada e cole abaixo:
    this.GAS_URL = "https://script.google.com/macros/s/AKfycbyIQkk8nPe2ROYHPbMbvfm6EZV8TvSneHgnKovW7JoVxbMrVjF3Bs-0SG_Ps6uLk1NY5Q/exec";

    this.portfolio = { name: 'Meu Portfólio', positions: [] };
    this.user = null; // { username: '...' } if logged in
    this.assets = [];
    this.marketData = null;
    this.marketNews = null;
    this.analysis = null;
    this.charts = {};
    this.isDiscoveryMode = false;
    this.currentPage = 'dashboard';
    this.previousPage = 'dashboard';
    this.summaryPeriod = 'day'; // day, month, year
    this.taxConfig = null;
    this.fiscalData = { dt_loss: 0, st_loss: 0, irrf_balance: 0, tax_balance: 0 };
    this.init();
  }

  /* ------------------------------------------------------------------
     Utilities & Helpers
  ------------------------------------------------------------------ */
  $(id) { return document.getElementById(id); }

  formatCurrency(v) {
    if (v == null) return 'R$ 0,00';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatNumber(n, decimals = 2) {
    if (n == null || isNaN(n)) return '0';
    return n.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  parseRate(val) {
    if (val == null || val === '') return 0;
    if (typeof val === 'number') return val;
    let s = val.toString().trim();
    if (/^\d+\.\d+$/.test(s)) return parseFloat(s);
    if (/^\d+,\d+$/.test(s)) return parseFloat(s.replace(',', '.'));
    if (s.includes('.') && s.includes(',')) {
      if (s.lastIndexOf('.') < s.lastIndexOf(',')) {
        return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
      } else {
        return parseFloat(s.replace(/,/g, '')) || 0;
      }
    }
    let clean = s.replace(/\./g, '').replace(',', '.');
    let parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  getAssetLogoHTML(ticker, size = 24) {
    const tickerClean = this.escapeHTML(ticker.replace('.SA', '').toUpperCase());
    const logoUrl = `../assets/logos/${tickerClean}.svg`;
    const fallbackUrl = `../assets/logo4.png`;
    return `<img src="${logoUrl}" alt="${tickerClean}" width="${size}" height="${size}"
                 style="vertical-align: middle; margin-right: 8px; border-radius: 4px; object-fit: contain; background: #fff; padding: 1px;"
                 onerror="this.src='${fallbackUrl}'; this.onerror=null;">`;
  }

  palette(n) {
    const base = [
      '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
      '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
      '#a855f7', '#d946ef',
    ];
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }

  showLoading(text = 'Processando...') {
    this.$('loadingText').textContent = text;
    this.$('loadingOverlay').classList.add('show');
  }

  hideLoading() {
    this.$('loadingOverlay').classList.remove('show');
  }

  setSplashMessage(text) {
    const el = this.$('splashMessage');
    if (el) el.textContent = text;
  }

  hideSplashScreen() {
    const splash = this.$('splashScreen');
    if (splash) {
      splash.classList.add('hide');
      document.body.classList.remove('loading');
      setTimeout(() => splash.remove(), 600);
    }
  }

  showMonitor(ticker) {
    console.log('Showing monitor for:', ticker);
    const tickerClean = ticker.replace('.SA', '').toUpperCase();
    this.showPage('monitor');

    // Garantir que o container está visível e dimensionado antes de renderizar
    // O fadeUp leva 0.4s, então vamos aguardar um pouco mais para garantir
    setTimeout(() => {
        this.renderChart(tickerClean);
    }, 450);
  }

  /* ------------------------------------------------------------------
     Initialisation
  ------------------------------------------------------------------ */
  async init() {
    this.bindUI();
    this.setupNavigation();
    this.setupModal();
    this.setupAuth();

    this.setSplashMessage('Verificando sessão...');
    // 1. Carregar status de autenticação e portfólio (Unificado)
    await this.checkAuthStatus();

    this.setSplashMessage('Carregando mercado...');
    // 2. Carregar recursos essenciais para o Dashboard (Progressivo)
    await Promise.all([
      this.loadAssets(),
      this.loadMarketNews(),
      this.loadMarketSummary(),
      this.loadPortfolio(),
      this.loadMarketData(true) // true = load only essential market_data.json
    ]);

    // 3. Análise inicial para liberar o dashboard rapidamente
    this.setSplashMessage('Sincronizando portfólio...');
    await this.runAnalysis();
    this.renderPositions();

    // 4. Liberar a UI
    this.hideSplashScreen();

    // 5. Carregar históricos pesados em segundo plano (Não bloqueante)
    if (this.user) {
      this.loadMarketData(false); // Carregar histórico completo para membros
    }
  }

  bindUI() {
    // Buttons
    this.$('btnAddPosition').addEventListener('click', () => this.openModal(null, 'buy'));
    this.$('btnSellPosition').addEventListener('click', () => this.openModal(null, 'sell'));
    this.$('btnAnalyze').addEventListener('click', () => this.runAnalysis());
    this.$('btnCalculateTaxes').addEventListener('click', () => this.renderTaxReport());
    this.$('btnSaveFiscalBalance').addEventListener('click', () => this.confirmAndSaveFiscalBalance());
    this.$('btnRunBarsi').addEventListener('click', () => this.runBarsi());
    this.$('btnRunRebalance').addEventListener('click', () => this.runRebalance());
    this.$('btnRequestExpertAnalysis').addEventListener('click', () => this.requestExpertAnalysis());
    this.$('btnAddBulk').addEventListener('click', () => this.openBulkModal());
    this.$('btnVoltarMonitor').addEventListener('click', () => this.showPage(this.previousPage));

    // Mobile
    this.$('hamburger').addEventListener('click', () => this.toggleSidebar());
    this.$('overlay').addEventListener('click', () => this.toggleSidebar(false));

    // Auth buttons
    this.$('btnLogout').addEventListener('click', (e) => { e.preventDefault(); this.logout(); });
    this.$('btnLogoutFull').addEventListener('click', () => this.logout());

    // Admin buttons (removed as management is now done directly in Google Sheets)
    // this.$('btnAdminLoadUsers').addEventListener('click', () => this.adminLoadUsers());
    // this.$('btnAdminAddUser').addEventListener('click', () => this.adminAddUser());

    // Sort listeners
    this.$('sortPositions').addEventListener('change', () => this.renderPositions());
    this.$('hideClosedPositions').addEventListener('change', () => this.renderPositions());
    this.$('sortBarsi').addEventListener('change', () => this.renderBarsi());
    this.$('sortRebalance').addEventListener('change', () => this.renderRebalance());

    // Proventos listeners
    this.$('btnFilterDividends').addEventListener('click', () => this.renderDividendsPage());
    this.$('btnToggleDiscovery').addEventListener('click', () => {
      this.isDiscoveryMode = !this.isDiscoveryMode;
      this.$('btnToggleDiscovery').textContent = this.isDiscoveryMode ? '💼 Minha Carteira' : '🌐 Descoberta de Ativos';
      this.$('divTableTitle').textContent = this.isDiscoveryMode ? 'Ativos com Proventos no Período (Mercado)' : 'Meus Proventos no Período';
      this.renderDividendsPage();
    });

    // Auth Modal
    this.$('authModalClose').addEventListener('click', () => this.closeAuthModal());
    this.$('authModalOverlay').addEventListener('click', e => {
      if (e.target === this.$('authModalOverlay')) this.closeAuthModal();
    });
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.tab));
    });

    // News modal
    this.$('newsModalClose').addEventListener('click', () => this.closeNewsModal());
    this.$('newsModalOk').addEventListener('click', () => this.closeNewsModal());
    this.$('newsModalOverlay').addEventListener('click', e => {
      if (e.target === this.$('newsModalOverlay')) this.closeNewsModal();
    });
    this.$('leadForm').addEventListener('submit', (e) => this.handleLeadSubmit(e));

    // Ticker input validation
    this.$('posTicker').addEventListener('input', () => this.validateTicker());
  }


  /* ------------------------------------------------------------------
     Navigation
  ------------------------------------------------------------------ */
  setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const section = link.dataset.section;
        this.showPage(section);
        this.toggleSidebar(false);
      });
    });
  }

  showPage(name) {
    console.log('Showing page:', name);
    if (this.currentPage !== 'monitor') {
      this.previousPage = this.currentPage;
    }

    // Modal based navigation for guests
    if (name === 'members' && !this.user) {
      this.openAuthModal('login');
      // Continuamos para mostrar a página de membros com o CTA
    }

    // Protection for dividends page
    if (name === 'dividends' && !this.user) {
      this.openAuthModal('register', 'dividends');
      return;
    }

    this.currentPage = name;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.querySelector(`[data-page="${name}"]`);
    if (page) {
      page.classList.add('active');
    } else {
      console.warn('Page not found:', name);
    }

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`.nav-link[data-section="${name}"]`);
    if (link) link.classList.add('active');

    if (name === 'dividends') {
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
      if (!this.$('divStartDate').value) this.$('divStartDate').value = firstDay;
      if (!this.$('divEndDate').value) this.$('divEndDate').value = lastDay;
      this.renderDividendsPage();
    }

    if (name === 'news') {
      this.renderMarketNews();
    }

    if (name === 'summary') {
      this.renderMarketSummary();
    }

    if (name === 'taxes') {
      if (!this.user) {
        this.openAuthModal('register', 'taxes');
        return;
      }
      this.loadTaxData();
    }
  }

  toggleSidebar(force) {
    const sidebar = this.$('sidebar');
    const overlay = this.$('overlay');
    const open = force !== undefined ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('show', open);
  }

  /* ------------------------------------------------------------------
     Authentication & Server Sync
  ------------------------------------------------------------------ */
  setupAuth() {
    this.$('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = this.$('loginUsername').value;
      const password = this.$('loginPassword').value;
      await this.login(username, password);
    });

    this.$('changePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPassword = this.$('oldPassword').value;
      const newPassword = this.$('newPassword').value;
      await this.changePassword(oldPassword, newPassword);
    });
  }

  async loadTaxData() {
    if (!this.user || !this.GAS_URL) return;
    try {
      this.showLoading('Carregando dados fiscais...');
      const [configRes, fiscalRes] = await Promise.all([
        fetch(this.GAS_URL, {
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify({ action: 'get_tax_config' })
        }),
        fetch(this.GAS_URL, {
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify({
            action: 'get_fiscal_data',
            username: this.user.username,
            session_token: this.user.session_token
          })
        })
      ]);
      this.taxConfig = await configRes.json();
      this.fiscalData = await fiscalRes.json();
      this.hideLoading();

      const today = new Date();
      this.$('taxMonth').value = today.getMonth() + 1;
      this.$('taxYear').value = today.getFullYear();

      this.renderTaxReport();
    } catch (err) {
      this.hideLoading();
      console.error('Erro ao carregar dados fiscais:', err);
    }
  }

  async checkAuthStatus() {
    if (!this.GAS_URL) {
      console.log('Google Apps Script URL não configurada. Usando modo local.');
      this.user = null;
      this.updateAuthUI(null);
      return;
    }

    const savedUser = localStorage.getItem('b3_user');
    if (savedUser) {
      const user = JSON.parse(savedUser);
      try {
        const res = await fetch(this.GAS_URL, {
          method: 'POST',
          mode: 'cors',
          body: JSON.stringify({
            action: 'status_and_portfolio',
            username: user.username,
            session_token: user.session_token
          })
        });
        const data = await res.json();
        if (data.logged_in) {
          this.user = { ...user, is_admin: !!data.is_admin };
          this.updateAuthUI(data);
          if (data.portfolio) {
            this.portfolio = data.portfolio;
          }
        } else {
          this.logout();
        }
      } catch (err) {
        console.warn('Erro ao verificar status no sistema:', err);
      }
    }
  }

  async login(username, password) {
    if (!this.GAS_URL) {
      this.toast('Configure a GAS_URL no app.js para habilitar o login.', 'warning');
      return;
    }

    this.showLoading('Entrando...');
    try {
      const res = await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({ action: 'login', username, password })
      });
      const data = await res.json();
      this.hideLoading();

      if (data.success) {
        this.user = {
          username: data.username,
          is_admin: !!data.is_admin,
          session_token: data.session_token
        };
        localStorage.setItem('b3_user', JSON.stringify(this.user));

        this.toast(`Bem-vindo, ${data.username}!`, 'success');
        this.updateAuthUI(data);
        this.closeAuthModal();

        // Load server portfolio first
        const serverData = await this.loadPortfolioFromServer();

        // Migration logic: Only migrate if server portfolio is empty
        if (serverData.is_new || (serverData.positions && serverData.positions.length === 0)) {
          const local = localStorage.getItem('b3_portfolio');
          if (local) {
            const localPortfolio = JSON.parse(local);
            if (localPortfolio.positions && localPortfolio.positions.length > 0) {
              this.toast('Sincronizando seu portfólio local para a nuvem...', 'info');
              this.portfolio = localPortfolio;
              await this.savePortfolioServer();
            } else {
              this.portfolio = serverData;
            }
          } else {
            this.portfolio = serverData;
          }
        } else {
          this.portfolio = serverData;
        }

        await this.runAnalysis();
        this.renderPositions();
        this.showPage('dashboard');
      } else {
        this.toast(data.error || 'Erro no login', 'error');
      }
    } catch (err) {
      this.hideLoading();
      this.toast('Falha na comunicação com o sistema.', 'error');
    }
  }

  async logout() {
    this.showLoading('Saindo...');
    try {
      localStorage.removeItem('b3_user');
      this.user = null;
      this.updateAuthUI(false);

      // Restore local portfolio after logout
      const local = localStorage.getItem('b3_portfolio');
      if (local) {
        this.portfolio = JSON.parse(local);
      } else {
        this.portfolio = { name: 'Meu Portfólio', positions: [] };
      }

      this.hideLoading();
      this.toast('Você saiu com sucesso', 'info');

      await this.runAnalysis();
      this.renderPositions();
      this.showPage('dashboard');
    } catch (err) {
      this.hideLoading();
    }
  }

  async changePassword(old_password, new_password) {
    if (!this.GAS_URL) {
      this.toast('Configuração do servidor não encontrada.', 'error');
      return;
    }

    try {
      this.showLoading('Atualizando senha...');
      const response = await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({
          action: 'update_password',
          username: this.user.username,
          old_password,
          new_password
        })
      });

      const result = await response.json();
      this.hideLoading();

      if (result.success) {
        this.toast(result.message || 'Senha alterada com sucesso!', 'success');
        this.$('changePasswordForm').reset();
      } else {
        this.toast(result.error || 'Erro ao alterar senha.', 'error');
      }
    } catch (error) {
      this.hideLoading();
      console.error('Update password error:', error);
      this.toast('Erro na comunicação com o servidor.', 'error');
    }
  }

  updateAuthUI(data) {
    console.log('Updating Auth UI:', data);
    const loggedIn = data && (data.logged_in || data.username);
    if (loggedIn) {
      this.$('userProfile').style.display = 'flex';
      this.$('sidebarUserName').textContent = this.user.username;

      this.$('loginArea').classList.add('hidden');
      this.$('memberDashboard').classList.remove('hidden');
      this.$('memberDashboard').style.display = 'block';

      this.$('memberWelcomeName').textContent = this.user.username;
      this.$('nav-members').innerHTML = '<span class="nav-icon">👤</span> Perfil';

      // Proventos area
      if (this.$('dividendsGuestAlert')) this.$('dividendsGuestAlert').classList.add('hidden');
      if (this.$('dividendsContent')) this.$('dividendsContent').classList.remove('hidden');

      // Taxes area
      if (this.$('taxesGuestAlert')) this.$('taxesGuestAlert').classList.add('hidden');
      if (this.$('taxesContent')) this.$('taxesContent').classList.remove('hidden');

      // News area
      if (this.$('newsGuestTip')) this.$('newsGuestTip').classList.add('hidden');

      // Admin Panel
      // Note: Admin management is handled via Google Sheets in this version
      this.$('adminPanel').classList.add('hidden');
    } else {
      this.$('userProfile').style.display = 'none';
      this.$('loginArea').classList.remove('hidden');
      this.$('loginArea').style.display = 'block';
      this.$('memberDashboard').classList.add('hidden');
      this.$('adminPanel').classList.add('hidden');
      this.$('nav-members').innerHTML = '<span class="nav-icon">👤</span> Área de Membros';

      // Proventos area
      if (this.$('dividendsGuestAlert')) this.$('dividendsGuestAlert').classList.remove('hidden');
      if (this.$('dividendsContent')) this.$('dividendsContent').classList.add('hidden');

      // Taxes area
      if (this.$('taxesGuestAlert')) this.$('taxesGuestAlert').classList.remove('hidden');
      if (this.$('taxesContent')) this.$('taxesContent').classList.add('hidden');

      // News area
      if (this.$('newsGuestTip')) this.$('newsGuestTip').classList.remove('hidden');

      if (this.currentPage === 'dividends') this.showPage('dashboard');
    }
  }


  async savePortfolioServer() {
    if (!this.user || !this.GAS_URL) return;
    try {
      await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({
          action: 'save_portfolio',
          username: this.user.username,
          session_token: this.user.session_token,
          portfolio: this.portfolio
        })
      });
    } catch (err) {
      console.error('Erro ao salvar os dados:', err);
      this.toast('Erro ao sincronizar dados com o sistema', 'warning');
    }
  }

  async loadPortfolioFromServer() {
    if (!this.user || !this.GAS_URL) return { name: 'Meu Portfólio', positions: [], is_new: true };
    try {
      const res = await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({
          action: 'get_portfolio',
          username: this.user.username,
          session_token: this.user.session_token
        })
      });
      return await res.json();
    } catch (err) {
      console.warn('Erro ao carregar do sistema:', err);
      return { name: 'Meu Portfólio', positions: [], is_new: true };
    }
  }

  /* ------------------------------------------------------------------
     Modal
  ------------------------------------------------------------------ */
  setupModal() {
    this.$('modalClose').addEventListener('click', () => this.closeModal());
    this.$('modalCancel').addEventListener('click', () => this.closeModal());
    this.$('positionForm').addEventListener('submit', e => {
      e.preventDefault();
      this.savePosition();
    });
    this.$('modalOverlay').addEventListener('click', e => {
      if (e.target === this.$('modalOverlay')) this.closeModal();
    });

    this.$('posType').addEventListener('change', () => {
      const type = this.$('posType').value;
      if (this.editIndex === null) {
        this.$('modalTitle').textContent = type === 'buy' ? 'Registrar Compra' : 'Registrar Venda';
        this.$('labelPosPrice').textContent = type === 'buy' ? 'Preço de Compra (R$)' : 'Preço de Venda (R$)';
      }
    });

    // Bulk Modal
    this.$('bulkModalClose').addEventListener('click', () => this.closeBulkModal());
    this.$('bulkModalCancel').addEventListener('click', () => this.closeBulkModal());
    this.$('btnBulkAddRow').addEventListener('click', () => this.addBulkRow());
    this.$('btnBulkSave').addEventListener('click', () => this.saveBulkPositions());
    this.$('bulkModalOverlay').addEventListener('click', e => {
      if (e.target === this.$('bulkModalOverlay')) this.closeBulkModal();
    });
  }

  openModal(editIndex = null, defaultType = 'buy') {
    // Limit check for non-members
    if (!this.user && editIndex === null) {
      const uniqueTickers = new Set(this.portfolio.positions.map(p => p.ticker));
      if (uniqueTickers.size >= 5) {
        this.openAuthModal('register', 'limit');
        return;
      }
    }

    this.editIndex = editIndex;

    if (editIndex !== null) {
      this.$('modalTitle').textContent = 'Editar Registro';
      this.$('labelPosPrice').textContent = 'Preço da Operação (R$)';
    } else {
      this.$('modalTitle').textContent = defaultType === 'buy' ? 'Registrar Compra' : 'Registrar Venda';
      this.$('labelPosPrice').textContent = defaultType === 'buy' ? 'Preço de Compra (R$)' : 'Preço de Venda (R$)';
    }

    // Ensure datalist is populated (fallback)
    if (this.$('assetList').children.length === 0 && this.assets.length > 0) {
      this.populateAssetDatalist();
    }

    const tickerInput = this.$('posTicker');
    tickerInput.value = '';
    this.$('tickerWarning').style.display = 'none';

    if (editIndex !== null && this.portfolio.positions[editIndex]) {
      const pos = this.portfolio.positions[editIndex];
      this.$('posType').value = pos.type || 'buy';
      tickerInput.value = pos.ticker;
      this.$('posQty').value = pos.quantity;
      this.$('posPrice').value = pos.purchase_price;
      this.$('posDate').value = pos.purchase_date || new Date().toISOString().slice(0, 10);
      this.$('posCosts').value = pos.costs || 0;
      this.$('posIRRF').value = pos.irrf || 0;
    } else {
      this.$('posType').value = defaultType;
      this.$('posQty').value = '';
      this.$('posPrice').value = '';
      this.$('posDate').value = new Date().toISOString().slice(0, 10);
      this.$('posCosts').value = 0;
      this.$('posIRRF').value = 0;
    }

    this.$('modalOverlay').classList.add('show');
  }

  validateTicker() {
    const val = this.$('posTicker').value.toUpperCase();
    if (!val) {
      this.$('tickerWarning').style.display = 'none';
      return;
    }
    const found = this.assets.find(a => a.ticker === val || a.ticker.replace('.SA', '') === val);
    if (!found) {
      this.$('tickerWarning').style.display = 'block';
    } else {
      this.$('tickerWarning').style.display = 'none';
    }
  }

  openAuthModal(tab = 'login', reason = null) {
    this.switchAuthTab(tab);

    const reasonBox = this.$('authModalReasonBox');
    const reasonText = this.$('authModalReasonText');

    if (reason === 'limit') {
      reasonBox.classList.remove('hidden');
      reasonText.innerHTML = '⚠️ Limite de 5 ativos atingido. <br>Seja Membro Pro para ativos ilimitados.';
    } else if (reason === 'dividends') {
      reasonBox.classList.remove('hidden');
      reasonText.textContent = '🔒 A análise de proventos é exclusiva para membros.';
    } else if (reason === 'taxes') {
      reasonBox.classList.remove('hidden');
      reasonText.textContent = '📜 A apuração de IR é exclusiva para membros.';
    } else {
      reasonBox.classList.add('hidden');
    }

    this.$('authModalOverlay').classList.add('show');
    if (tab === 'login') {
      this.$('loginUsername').focus();
    } else {
      this.$('leadEmail').focus();
    }
  }

  closeAuthModal() {
    this.$('authModalOverlay').classList.remove('show');
  }

  switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.auth-tab-content').forEach(c => c.classList.toggle('active', c.id === 'authTab' + tab.charAt(0).toUpperCase() + tab.slice(1)));
  }

  async handleLeadSubmit(e) {
    e.preventDefault();
    const email = this.$('leadEmail').value;

    if (!this.GAS_URL) {
      this.toast('Configure a GAS_URL no app.js para capturar leads.', 'warning');
      return;
    }

    this.showLoading('Enviando...');
    try {
      const res = await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({ action: 'add_lead', email })
      });
      const data = await res.json();
      this.hideLoading();
      if (data.success) {
        this.toast('Obrigado! Entraremos em contato em breve para a realização do seu cadastro.', 'success');
        this.closeAuthModal();
        this.$('leadForm').reset();
      } else {
        this.toast('Erro ao salvar lead no sistema.', 'error');
      }
    } catch (err) {
      this.hideLoading();
      this.toast('Falha na comunicação com o sistema', 'error');
    }
  }

  closeModal() {
    this.$('modalOverlay').classList.remove('show');
    this.editIndex = null;
  }

  openBulkModal() {
    const tbody = this.$('bulkTableBody');
    tbody.innerHTML = '';
    this.addBulkRow(); // Add one initial row
    this.$('bulkModalOverlay').classList.add('show');
  }

  closeBulkModal() {
    this.$('bulkModalOverlay').classList.remove('show');
  }

  addBulkRow() {
    const tbody = this.$('bulkTableBody');
    const tr = document.createElement('tr');

    // Ticker select options
    let options = '<option value="">Selecione...</option>';
    this.assets.forEach(a => {
      options += `<option value="${a.ticker}">${a.ticker}</option>`;
    });

    const today = new Date().toISOString().slice(0, 10);

    tr.innerHTML = `
      <td>
        <select class="bulk-type" style="width: 100%">
          <option value="buy">Compra</option>
          <option value="sell">Venda</option>
        </select>
      </td>
      <td>
        <select class="bulk-ticker" style="width: 100%">${options}</select>
      </td>
      <td>
        <input type="number" class="bulk-qty" min="1" placeholder="Qtd" style="width: 100%">
      </td>
      <td>
        <input type="number" class="bulk-price" min="0" step="0.01" placeholder="Preço" style="width: 100%">
      </td>
      <td>
        <input type="date" class="bulk-date" value="${today}" style="width: 100%">
      </td>
      <td>
        <button class="btn-danger-sm" onclick="this.closest('tr').remove()">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  async saveBulkPositions() {
    const rows = document.querySelectorAll('#bulkTableBody tr');
    const newPositions = [];

    // Limit check for non-members
    if (!this.user) {
      const currentTickers = new Set(this.portfolio.positions.map(p => p.ticker));
      const incomingTickers = new Set();
      for (const row of rows) {
        const t = row.querySelector('.bulk-ticker').value;
        if (t) incomingTickers.add(t);
      }
      const combined = new Set([...currentTickers, ...incomingTickers]);
      if (combined.size > 5) {
        this.toast('Limite de 5 ativos atingido para não-membros', 'warning');
        this.openAuthModal('register', 'limit');
        return;
      }
    }

    // Validation: Check balances for bulk adds
    const tempPortfolio = JSON.parse(JSON.stringify(this.portfolio.positions));

    for (const row of rows) {
      const type = row.querySelector('.bulk-type').value;
      const ticker = row.querySelector('.bulk-ticker').value;
      const qty = parseInt(row.querySelector('.bulk-qty').value, 10);
      const price = parseFloat(row.querySelector('.bulk-price').value);
      const date = row.querySelector('.bulk-date').value;

      if (ticker && !isNaN(qty) && !isNaN(price)) {
        if (type === 'sell') {
          // Calculate current balance for this ticker in temp portfolio
          let balance = 0;
          tempPortfolio.forEach(p => {
            if (p.ticker === ticker) {
              if ((p.type || 'buy') === 'buy') balance += p.quantity;
              else balance -= p.quantity;
            }
          });

          if (qty > balance) {
            this.toast(`Saldo insuficiente de ${ticker.replace('.SA', '')} para a venda de ${qty} unidades. Saldo disponível: ${balance}`, 'error');
            return;
          }
        }

        const newPos = {
          type,
          ticker,
          quantity: qty,
          purchase_price: price,
          purchase_date: date || new Date().toISOString().slice(0, 10)
        };
        newPositions.push(newPos);
        tempPortfolio.push(newPos);
      }
    }

    if (newPositions.length === 0) {
      this.toast('Nenhum dado válido para salvar', 'error');
      return;
    }

    this.portfolio.positions.push(...newPositions);

    this.closeBulkModal();
    this.savePortfolio();
    await this.runAnalysis();
    this.renderPositions();
    this.toast(`${newPositions.length} ativos adicionados!`, 'success');
  }

  /* ------------------------------------------------------------------
     Data loading
  ------------------------------------------------------------------ */
  async loadMarketData(essentialOnly = false) {
    try {
      // 1. Carregar manifest para saber quais arquivos existem
      const manifestUrl = `./data/manifest.json?t=${new Date().getTime()}`;
      const manifestRes = await fetch(manifestUrl);

      let files = ['market_data.json']; // Fallback
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        files = manifest.market_data_files || files;
      }

      // Performance Optimization: Guests or essential load only the main market_data.json
      if (!this.user || essentialOnly) {
        files = ['market_data.json'];
      }

      console.log('Arquivos de mercado detectados:', files);

      // 2. Carregar arquivos permitidos
      const loadPromises = files.map(async (file) => {
        try {
          const res = await fetch(`./data/${file}?t=${new Date().getTime()}`);
          if (res.ok) return await res.json();
        } catch (e) {
          console.warn(`Erro ao carregar ${file}:`, e);
        }
        return null;
      });

      const dataList = (await Promise.all(loadPromises)).filter(d => d !== null);

      if (dataList.length === 0) {
        throw new Error('Nenhum dado de mercado pôde ser carregado.');
      }

      // 3. Mesclar dados (Merge)
      const newData = this.mergeMarketData(dataList);

      // Se já temos dados carregados (essential), mesclamos com o novo histórico completo
      if (this.marketData && !essentialOnly) {
        this.marketData = this.mergeMarketData([this.marketData, newData]);
        // Re-analisar para habilitar ferramentas que dependem do histórico completo
        this.runAnalysis();
      } else {
        this.marketData = newData;
      }

      // 4. Se for visitante, garantir restrição de 2 anos no histórico para economia de memória
      if (!this.user) {
        this.restrictHistoricalData(2);
      }

      console.log('Dados de mercado carregados e mesclados com sucesso');
    } catch (err) {
      console.error('Erro ao carregar dados de mercado:', err);
      if (!essentialOnly) {
          this.toast('Erro ao carregar dados históricos: ' + err.message, 'error');
      }
    }
  }

  restrictHistoricalData(years) {
    if (!this.marketData) return;
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    Object.keys(this.marketData.assets).forEach(ticker => {
      const asset = this.marketData.assets[ticker];
      if (asset.history && asset.history.dates) {
        const startIndex = asset.history.dates.findIndex(d => d >= cutoffStr);
        if (startIndex > 0) {
          asset.history.dates = asset.history.dates.slice(startIndex);
          asset.history.closes = asset.history.closes.slice(startIndex);
          asset.history.volumes = asset.history.volumes.slice(startIndex);
        }
      }
    });
  }

  mergeMarketData(dataList) {
    // Usamos o primeiro arquivo como base (geralmente market_data.json, o mais recente)
    const base = dataList[0];
    const mergedAssets = { ...base.assets };

    // Percorrer os outros arquivos para mesclar histórico e dividendos
    for (let i = 1; i < dataList.length; i++) {
      const current = dataList[i];

      Object.keys(current.assets).forEach(ticker => {
        if (!mergedAssets[ticker]) {
          // Se o ativo não existe na base, adicionamos (caso raro, mas possível)
          mergedAssets[ticker] = current.assets[ticker];
          return;
        }

        const baseAsset = mergedAssets[ticker];
        const extraAsset = current.assets[ticker];

        // Mesclar Histórico
        if (extraAsset.history && extraAsset.history.dates) {
          this.mergeAssetHistory(baseAsset.history, extraAsset.history);
        }

        // Mesclar Dividendos
        if (extraAsset.dividends && extraAsset.dividends.dates) {
          this.mergeAssetDividends(baseAsset.dividends, extraAsset.dividends);
        }
      });
    }

    return { ...base, assets: mergedAssets };
  }

  mergeAssetHistory(baseHist, extraHist) {
    const combined = [];
    // Adicionar base
    baseHist.dates.forEach((date, i) => {
      combined.push({ date, close: baseHist.closes[i], vol: baseHist.volumes[i] });
    });
    // Adicionar extras (evitando duplicatas por data)
    const existingDates = new Set(baseHist.dates);
    extraHist.dates.forEach((date, i) => {
      if (!existingDates.has(date)) {
        combined.push({ date, close: extraHist.closes[i], vol: extraHist.volumes[i] });
        existingDates.add(date);
      }
    });

    // Ordenar por data
    combined.sort((a, b) => a.date.localeCompare(b.date));

    // Atualizar objeto base
    baseHist.dates = combined.map(c => c.date);
    baseHist.closes = combined.map(c => c.close);
    baseHist.volumes = combined.map(c => c.vol);
  }

  mergeAssetDividends(baseDivs, extraDivs) {
    const combined = [];
    // Adicionar base
    baseDivs.dates.forEach((date, i) => {
      combined.push({ date, value: baseDivs.values[i] });
    });
    // Adicionar extras (evitando duplicatas por data)
    const existingDates = new Set(baseDivs.dates);
    extraDivs.dates.forEach((date, i) => {
      if (!existingDates.has(date)) {
        combined.push({ date, value: extraDivs.values[i] });
        existingDates.add(date);
      }
    });

    // Ordenar por data
    combined.sort((a, b) => a.date.localeCompare(b.date));

    // Atualizar objeto base
    baseDivs.dates = combined.map(c => c.date);
    baseDivs.values = combined.map(c => c.value);
  }

  async loadMarketNews() {
    try {
      const res = await fetch(`./data/market_news.json?t=${new Date().getTime()}`);
      if (res.ok) {
        this.marketNews = await res.json();
      }
    } catch (e) {
      console.warn('Market news not available yet.');
    }
  }

  renderMarketNews() {
    if (!this.marketNews) {
      this.$('marketInsightText').textContent = 'Insights indisponíveis no momento.';
      return;
    }

    this.$('marketInsightText').textContent = this.marketNews.market_summary || 'Sem resumo geral.';
    this.$('newsLastUpdate').textContent = `Última atualização: ${new Date(this.marketNews.last_update).toLocaleString('pt-BR')}`;

    // Render Ibovespa Header in Market Research
    const ibov = this.marketNews.ibov;
    const ibovCard = this.$('ibovHeaderCard');
    if (ibov && ibovCard) {
      ibovCard.style.display = 'block';
      this.$('ibovScore').textContent = this.formatNumber(ibov.last_close, 0) + ' pts';

      const renderDelta = (id, val, label) => {
        const el = this.$(id);
        const sign = val > 0 ? '+' : '';
        const color = val >= 0 ? 'var(--green)' : 'var(--red)';
        el.textContent = `${label}: ${sign}${this.formatNumber((val * 100), 2)}%`;
        el.style.color = color;
      };

      renderDelta('ibovDay', ibov.daily_delta, 'D');
      renderDelta('ibovMonth', ibov.monthly_delta, 'M');
      renderDelta('ibovYear', ibov.yearly_delta, 'A');
    }

    const grid = this.$('newsAssetsGrid');
    grid.innerHTML = '';

    // Sanitization helper

    const assets = Object.keys(this.marketNews.assets);
    const movers = this.marketNews.market_movers || [];

    assets.forEach(ticker => {
      // Logic: If guest, only show market movers. If member, show all processed (which includes their portfolio)
      const isMover = movers.includes(ticker);
      if (!this.user && !isMover) return;

      const data = this.marketNews.assets[ticker];
      const card = document.createElement('div');
      card.className = 'card glass news-card';

      let performanceHtml = '';
      if (data.last_close != null && data.daily_delta != null) {
        const d_delta = this.formatNumber(data.daily_delta * 100, 2);
        const d_color = data.daily_delta >= 0 ? 'var-up' : 'var-down';
        const d_sign = data.daily_delta > 0 ? '+' : '';

        let extraDeltas = '';
        if (data.monthly_delta != null && data.yearly_delta != null) {
          const m_delta = this.formatNumber(data.monthly_delta * 100, 1);
          const y_delta = this.formatNumber(data.yearly_delta * 100, 1);
          extraDeltas = `
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">
              M: <span class="${data.monthly_delta >= 0 ? 'var-up' : 'var-down'}">${data.monthly_delta > 0 ? '+' : ''}${m_delta}%</span> |
              A: <span class="${data.yearly_delta >= 0 ? 'var-up' : 'var-down'}">${data.yearly_delta > 0 ? '+' : ''}${y_delta}%</span>
            </div>
          `;
        }

        performanceHtml = `
          <div class="news-card-perf">
            <span class="news-perf-price">R$ ${this.formatNumber(data.last_close, 2)}</span>
            <span class="news-perf-delta ${d_color}">${d_sign}${d_delta}%</span>
            ${extraDeltas}
          </div>
        `;
      }

      let outdatedBadge = '';
      if (data.is_outdated) {
        outdatedBadge = `<div class="news-outdated-label">⚠️ Notícias de período anterior ao dia atual</div>`;
      }

      const displayDate = data.price_date ? data.price_date.split('-').reverse().join('/') : new Date(data.updated_at).toLocaleDateString('pt-BR');

      const tickerClean = this.escapeHTML(ticker.replace('.SA', ''));
      const logoHtml = this.getAssetLogoHTML(ticker, 32);
      card.innerHTML = `
        <div class="news-card-header">
          <div style="display:flex; align-items:center; gap:0.75rem">
            ${logoHtml}
            <div style="display:flex; flex-direction:column">
              <a href="#" onclick="event.preventDefault(); app.showMonitor('${tickerClean}')" class="ticker-link news-card-ticker"><strong>${tickerClean}</strong></a>
              <span style="font-size: 0.65rem; color: var(--text-muted);">${displayDate}</span>
            </div>
          </div>
          ${performanceHtml}
        </div>
        ${outdatedBadge}
        <div class="news-card-summary">${this.escapeHTML(data.summary)}</div>
        <button class="btn btn-outline btn-sm" onclick="app.showAssetNews('${this.escapeHTML(ticker)}')" style="margin-top:auto">Ver Mais</button>
      `;
      grid.appendChild(card);
    });
  }

  showAssetNews(ticker) {
    if (!this.marketNews || !this.marketNews.assets[ticker]) {
      this.toast('Notícias não encontradas para este ativo.', 'warning');
      return;
    }

    const data = this.marketNews.assets[ticker];
    this.$('newsModalTitle').textContent = `Resumo IA: ${ticker.replace('.SA', '')}`;
    this.$('newsModalTickerName').textContent = ticker;

    const logoContainer = this.$('newsModalLogoContainer');
    if (logoContainer) {
      logoContainer.innerHTML = this.getAssetLogoHTML(ticker, 48);
    }

    let updateText = `Atualizado em ${new Date(data.updated_at).toLocaleString('pt-BR')}`;
    if (data.period) updateText += ` | Período: ${data.period}`;
    this.$('newsModalUpdateDate').textContent = updateText;

    // Handle summary text and outdated disclaimer
    const textElement = this.$('newsModalText');
    if (textElement) {
        // Transforma o container em flexbox para neutralizar margens invisíveis do topo
        textElement.style.display = 'flex';
        textElement.style.flexDirection = 'column';
        textElement.style.justifyContent = 'flex-start';
        textElement.style.gap = '0px'; // Garante espaço zero entre os elementos filhos
        textElement.style.paddingTop = '0px';
        textElement.style.marginTop = '0px';       
      if (data.is_outdated) {
        textElement.innerHTML = `
          <div class="news-outdated-label" style="margin-bottom: 0;">AVISO: Este resumo não necessariamente retra o desempenho do dia, pois não houve fontes disponíveis para a data atual.</div>
          <div style="white-space: pre-wrap; margin-top: 0;">${this.escapeHTML(data.summary).trim()}</div><br>
        `.replace(/>\s+</g, '><'); // Remove os espaços e quebras de linha gerados pelas crases;
      } else {
        textElement.textContent = data.summary;
      }
    }

    const sourcesDiv = this.$('newsModalSources');
    if (sourcesDiv) {
      sourcesDiv.innerHTML = '';
      if (data.sources && data.sources.length > 0) {
        const title = document.createElement('p');
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '0.5rem';
        title.textContent = 'Fontes consultadas:';
        sourcesDiv.appendChild(title);

        const list = document.createElement('ul');
        list.style.paddingLeft = '1.2rem';
        data.sources.forEach((link, idx) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = link;
          a.target = '_blank';
          a.textContent = `Notícia ${idx + 1}`;
          a.style.color = 'var(--accent)';
          li.appendChild(a);
          list.appendChild(li);
        });
        sourcesDiv.appendChild(list);
      }
    }

    this.$('newsModalOverlay').classList.add('show');

    // Reset scroll position
    const scrollArea = this.$('newsModalScrollArea');
    if (scrollArea) scrollArea.scrollTop = 0;
  }

  closeNewsModal() {
    this.$('newsModalOverlay').classList.remove('show');
  }

  async loadMarketSummary() {
    try {
      const url = `./data/market_summary.json?t=${new Date().getTime()}`;
      const res = await fetch(url);
      if (!res.ok) return;
      this.marketSummaryData = await res.json();
      this.renderMarketSummary();

      if (this.marketSummaryData.all_assets) {
        this.renderMarketTreemap();
      }
    } catch (err) {
      console.warn('Resumo de mercado não disponível');
    }
  }

  setSummaryPeriod(period) {
    this.summaryPeriod = period;
    document.querySelectorAll('.btn-period').forEach(b => b.classList.remove('active'));
    const btn = this.$(`btn-period-${period}`);
    if (btn) btn.classList.add('active');

    this.renderMarketSummary();
    this.renderMarketTreemap();
  }

  async loadAssets() {
    try {
      const res = await fetch('./assets.json');
      if (!res.ok) throw new Error();
      const data = await res.json();
      this.assets = data.assets || [];
      this.populateAssetDatalist();
    } catch {
      console.warn('Falha ao carregar assets.json');
      this.assets = [];
    }
  }

  populateAssetDatalist() {
    const datalist = this.$('assetList');
    if (datalist) {
      datalist.innerHTML = '';
      this.assets.forEach(a => {
        const option = document.createElement('option');
        option.value = a.ticker;
        option.textContent = `${a.ticker} — ${a.name}`;
        datalist.appendChild(option);
      });
    }
  }

  async loadPortfolio() {
    // Portfolio loading is now handled unified in checkAuthStatus for members
    if (this.user) {
        return;
    }

    // Fallback para localStorage
    const saved = localStorage.getItem('b3_portfolio');
    if (saved) {
      try {
        this.portfolio = JSON.parse(saved);
      } catch {
        this.portfolio = { name: 'Meu Portfólio', positions: [] };
      }
    } else {
      try {
        const res = await fetch('./sample_portfolio.json');
        if (res.ok) {
          this.portfolio = await res.json();
          this.savePortfolio();
        }
      } catch {
        this.portfolio = { name: 'Meu Portfólio', positions: [] };
      }
    }
  }

  savePortfolio() {
    if (this.user) {
      this.savePortfolioServer();
    } else {
      localStorage.setItem('b3_portfolio', JSON.stringify(this.portfolio));
    }
  }

  consolidatePortfolio() {
    const consolidated = {};

    // Group transactions by ticker
    const grouped = {};
    this.portfolio.positions.forEach((pos, index) => {
      if (!grouped[pos.ticker]) grouped[pos.ticker] = [];
      grouped[pos.ticker].push({ ...pos, originalIndex: index, originalQty: pos.quantity });
    });

    Object.keys(grouped).forEach(ticker => {
      const transactions = [...grouped[ticker]];
      transactions.sort((a, b) => a.purchase_date.localeCompare(b.purchase_date) || a.originalIndex - b.originalIndex);

      let currentQty = 0;
      let totalRealizedProfit = 0;
      let totalCostOfSoldShares = 0;
      let swingTradeLots = []; // FIFO queue

      const byDay = {};
      transactions.forEach(t => {
        if (!byDay[t.purchase_date]) byDay[t.purchase_date] = [];
        byDay[t.purchase_date].push(t);
      });

      Object.keys(byDay).sort().forEach(date => {
        const dayTrans = byDay[date];
        let buys = dayTrans.filter(t => (t.type || 'buy') === 'buy').map(t => ({ ...t }));
        let sells = dayTrans.filter(t => t.type === 'sell').map(t => ({ ...t }));

        let dtProfit = 0;

        // Day Trade matching (FIFO within the day)
        let buyPtr = 0, sellPtr = 0;
        while (buyPtr < buys.length && sellPtr < sells.length) {
          let b = buys[buyPtr];
          let s = sells[sellPtr];
          let matchQty = Math.min(b.quantity, s.quantity);

          const grossResult = (s.purchase_price - b.purchase_price) * matchQty;
          const propCosts = ((b.costs || 0) * (matchQty / b.originalQty)) + ((s.costs || 0) * (matchQty / s.originalQty));
          dtProfit += (grossResult - propCosts);

          b.quantity -= matchQty;
          s.quantity -= matchQty;

          if (b.quantity === 0) buyPtr++;
          if (s.quantity === 0) sellPtr++;
        }

        // Remaining day transactions go to global Swing Trade FIFO
        dayTrans.forEach(t => {
          const type = t.type || 'buy';
          let remainingQty = (type === 'sell') ? sells.find(s => s.originalIndex === t.originalIndex).quantity
                                               : buys.find(b => b.originalIndex === t.originalIndex).quantity;

          if (remainingQty > 0) {
            if (type === 'buy') {
              const propCosts = (t.costs || 0) * (remainingQty / t.originalQty);
              const totalCost = (remainingQty * t.purchase_price) + propCosts;
              const unitCost = totalCost / remainingQty;
              swingTradeLots.push({ qty: remainingQty, unitCost: unitCost });
              currentQty += remainingQty;
            } else {
              const propCosts = (t.costs || 0) * (remainingQty / t.originalQty);
              const netSaleValue = (remainingQty * t.purchase_price) - propCosts;
              let costBasisSold = 0;
              let toSell = remainingQty;
              while (toSell > 0 && swingTradeLots.length > 0) {
                let lot = swingTradeLots[0];
                let take = Math.min(toSell, lot.qty);
                costBasisSold += (take * lot.unitCost);
                lot.qty -= take;
                toSell -= take;
                if (lot.qty === 0) swingTradeLots.shift();
              }
              totalRealizedProfit += (netSaleValue - costBasisSold);
              totalCostOfSoldShares += costBasisSold;
              currentQty -= remainingQty;
            }
          }
        });
        totalRealizedProfit += dtProfit;
      });

      const totalInvested = swingTradeLots.reduce((acc, lot) => acc + (lot.qty * lot.unitCost), 0);
      const currentPM = currentQty > 0 ? totalInvested / currentQty : 0;

      consolidated[ticker] = {
        ticker,
        totalQty: currentQty,
        avgPrice: currentPM,
        totalInvested: totalInvested,
        realizedProfit: totalRealizedProfit,
        costOfSoldShares: totalCostOfSoldShares,
        transactions: grouped[ticker]
      };
    });

    return Object.values(consolidated);
  }

  findCloseForDate(asset, targetDateStr) {
    if (!asset || !asset.history || !asset.history.dates.length) return null;

    const dates = asset.history.dates;
    const closes = asset.history.closes;

    // Fallback: Se a data for anterior à primeira disponível, usa a primeira
    if (targetDateStr < dates[0]) {
      return closes[0];
    }

    // Busca a data exata ou o primeiro dia útil posterior
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= targetDateStr) {
        return closes[i];
      }
    }

    // Se for posterior à última, usa a última
    return closes[closes.length - 1];
  }

  /* ------------------------------------------------------------------
     CRUD — Positions
  ------------------------------------------------------------------ */
  getTickerBalance(ticker, excludeIndex = null) {
    let balance = 0;
    this.portfolio.positions.forEach((pos, idx) => {
      if (idx === excludeIndex) return;
      if (pos.ticker === ticker) {
        const type = pos.type || 'buy';
        if (type === 'buy') balance += pos.quantity;
        else balance -= pos.quantity;
      }
    });
    return balance;
  }

  async savePosition() {
    const type = this.$('posType').value;
    let ticker = this.$('posTicker').value.toUpperCase();
    if (ticker && !ticker.endsWith('.SA')) {
      const found = this.assets.find(a => a.ticker === ticker + '.SA');
      if (found) ticker = ticker + '.SA';
    }
    const qty = parseInt(this.$('posQty').value, 10);
    const price = parseFloat(this.$('posPrice').value);
    const date = this.$('posDate').value;
    const costs = parseFloat(this.$('posCosts').value) || 0;
    const irrf = parseFloat(this.$('posIRRF').value) || 0;
    if (!ticker || !qty || !price) return;

    const pos = {
      type,
      ticker,
      quantity: qty,
      purchase_price: price,
      purchase_date: date || new Date().toISOString().slice(0, 10),
      costs,
      irrf
    };

    // Validation: Sale cannot exceed current balance
    if (type === 'sell') {
      const currentBalance = this.getTickerBalance(ticker, this.editIndex);
      if (qty > currentBalance) {
        this.toast(`Saldo insuficiente de ${ticker.replace('.SA', '')} para realizar a venda. Saldo atual: ${currentBalance}`, 'error');
        return;
      }
    }

    if (this.editIndex !== null) {
      this.portfolio.positions[this.editIndex] = pos;
    } else {
      this.portfolio.positions.push(pos);
    }

    this.closeModal();
    this.savePortfolio();
    await this.runAnalysis();
    this.renderPositions();
    this.toast('Ativo salvo com sucesso!', 'success');
  }

  async removePosition(index) {
    this.portfolio.positions.splice(index, 1);
    this.savePortfolio();
    await this.runAnalysis();
    this.renderPositions();
    this.toast('Ativo removido', 'info');
  }

  /* ------------------------------------------------------------------
     Logic — 100% Client-Side
  ------------------------------------------------------------------ */
  getDividendsForTicker(ticker, transactions, startDate = null, endDate = null) {
    const asset = this.marketData.assets[ticker];
    if (!asset || !asset.dividends || !asset.dividends.dates) return 0;

    let total = 0;
    asset.dividends.dates.forEach((date, idx) => {
      // Filter by date range if provided (for discovery tool)
      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;

      const value = asset.dividends.values[idx];

      // Calculate quantity owned on this dividend date
      let qtyOnDate = 0;
      transactions.forEach(t => {
        if (t.purchase_date <= date) {
          const type = t.type || 'buy';
          if (type === 'buy') qtyOnDate += t.quantity;
          else qtyOnDate -= t.quantity;
        }
      });

      total += (qtyOnDate * value);
    });
    return total;
  }

  async runAnalysis() {
    if (!this.portfolio.positions.length || !this.marketData) {
      this.analysis = null;
      this.renderDashboard();
      return;
    }

    const consolidated = this.consolidatePortfolio();
    const positions = [];
    let totalMarketValue = 0;
    let totalInvestedValue = 0;
    let totalDividendsValue = 0;
    let totalEffectiveProfit = 0;
    let totalProjectedProfit = 0;

    consolidated.forEach(item => {
      const asset = this.marketData.assets[item.ticker];
      if (!asset) return;

      const currentPrice = asset.last_price;
      const marketValue = currentPrice * item.totalQty;
      const investedValue = item.totalInvested;
      const totalProventos = this.getDividendsForTicker(item.ticker, item.transactions);

      const effectiveProfit = item.realizedProfit;
      const projectedProfit = item.totalQty > 0 ? (marketValue - investedValue) : 0;

      const totalEquity = marketValue + totalProventos + effectiveProfit;

      // Rentabilidades Individuais para o Gráfico
      const rentEfetivaPerc = item.costOfSoldShares > 0 ? (effectiveProfit / item.costOfSoldShares * 100) : 0;
      const rentProjetadaPerc = investedValue > 0 ? (projectedProfit / investedValue * 100) : 0;

      // Rentabilidade Total do Ativo: Lucro Total / (Custo Atual + Custo de lotes já vendidos)
      const denominator = (investedValue + item.costOfSoldShares);
      const rentTotal = denominator > 0 ?
        ((effectiveProfit + projectedProfit + totalProventos) / denominator * 100) : 0;

      positions.push({
        ticker: item.ticker,
        name: asset.name,
        sector: asset.sector || 'N/A',
        quantity: item.totalQty,
        avgPrice: item.avgPrice,
        totalInvested: investedValue,
        current_price: currentPrice,
        market_value: marketValue,
        total_proventos: totalProventos,
        effectiveProfit: effectiveProfit,
        projectedProfit: projectedProfit,
        rentEfetivaPerc: rentEfetivaPerc,
        rentProjetadaPerc: rentProjetadaPerc,
        total_equity: totalEquity,
        rentability_total: rentTotal,
        volatility: asset.stats.volatility || 0
      });

      totalMarketValue += marketValue;
      totalInvestedValue += investedValue;
      totalDividendsValue += totalProventos;
      totalEffectiveProfit += effectiveProfit;
      totalProjectedProfit += projectedProfit;
    });

    const totalEquityValue = totalMarketValue + totalDividendsValue + totalEffectiveProfit;

    const allocation = {};
    const allocationInvested = {};
    positions.forEach(p => {
      allocation[p.ticker] = (p.total_equity / (totalEquityValue || 1) * 100);
      allocationInvested[p.ticker] = (p.totalInvested / (totalInvestedValue || 1) * 100);
    });

    // We use projected rentability for the return metrics if requested, or total
    const portfolioReturn = (totalInvestedValue > 0) ? (totalProjectedProfit / totalInvestedValue * 100) : 0;
    const portfolioVol = positions.reduce((acc, p, idx) => acc + ((p.total_equity / (totalEquityValue || 1)) * (p.volatility || 0)), 0);
    const portfolioRentTotal = (totalInvestedValue > 0) ? ((totalEffectiveProfit + totalProjectedProfit + totalDividendsValue) / totalInvestedValue * 100) : 0;

    const riskFree = parseFloat(this.$('riskFreeRate').value) || 10;
    const sharpe = (portfolioVol > 0) ? (portfolioReturn - riskFree) / portfolioVol : 0;

    this.analysis = {
      timestamp: new Date().toISOString(),
      positions,
      allocation,
      allocationInvested,
      summary: {
        total_value: totalEquityValue,
        total_market_value: totalMarketValue,
        total_invested: totalInvestedValue,
        total_proventos: totalDividendsValue,
        total_effective_profit: totalEffectiveProfit,
        total_projected_profit: totalProjectedProfit,
        num_positions: positions.filter(p => p.quantity > 0).length,
        avg_rentability: portfolioReturn,
        portfolio_rentability_real: portfolioRentTotal,
        portfolio_volatility: portfolioVol,
        sharpe_ratio: sharpe
      }
    };

    this.renderDashboard();
  }

  async runBarsi() {
    if (!this.analysis || !this.analysis.positions.length || !this.marketData) {
      this.toast('Adicione ativos ao portfólio primeiro', 'error');
      return;
    }

    const targetYield = parseFloat(this.$('barsiYield').value) || 6;
    this.$('barsiTargetDisplay').textContent = targetYield + '%';

    const analyses = [];
    // Only consider tickers with active positions (qty > 0)
    const tickers = this.analysis.positions.filter(p => p.quantity > 0).map(p => p.ticker);

    for (const ticker of tickers) {
      const asset = this.marketData.assets[ticker];
      if (!asset) continue;

      const divs = asset.dividends?.values || [];
      if (!divs.length) {
        analyses.push({
          ticker, name: asset.name, current_price: asset.last_price,
          price_ceiling: null, margin_of_safety: 0, recommendation: "SEM DADOS",
          dpa_avg: 0, current_yield: 0
        });
        continue;
      }

      // Últimos 12 meses de dividendos (aproximadamente)
      const annualDpa = divs.slice(-4).reduce((a, b) => a + b, 0); // Assume-se trimestral no yfinance em muitos casos
      // Nota: o yfinance dividends varia. Para ser mais robusto, somar o último ano:
      // Mas aqui simplificamos como somar os últimos valores.

      const price = asset.last_price || 0;
      const priceCeiling = annualDpa / (targetYield / 100);
      const margin = price > 0 ? ((priceCeiling - price) / price * 100) : 0;
      const currentYield = price > 0 ? (annualDpa / price * 100) : 0;

      let rec = "VENDER";
      if (margin > 20) rec = "COMPRAR (ALTA MARGEM)";
      else if (margin > 0) rec = "COMPRAR";
      else if (margin > -10) rec = "MANTER";

      analyses.push({
        ticker, name: asset.name, current_price: price,
        price_ceiling: priceCeiling, margin_of_safety: margin,
        recommendation: rec, dpa_avg: annualDpa / 4, current_yield: currentYield
      });
    }

    const summary = {
      buy_signals: analyses.filter(a => a.recommendation.includes('COMPRAR')).length,
      hold_signals: analyses.filter(a => a.recommendation.includes('MANTER')).length,
      sell_signals: analyses.filter(a => a.recommendation.includes('VENDER')).length
    };

    this.barsiResults = { analyses, summary };
    this.renderBarsi();
    this.toast('Análise de preço-teto concluída!', 'success');
  }

  async runRebalance() {
    if (!this.marketData || !this.analysis) return;
    // Only consider tickers with active positions (qty > 0)
    const tickers = this.analysis.positions.filter(p => p.quantity > 0).map(p => p.ticker);
    if (tickers.length < 2) {
      this.toast('Necessário pelo menos 2 ativos para otimização', 'error');
      return;
    }

    const strategy = this.$('rebalanceStrategy').value;
    const maxWeight = parseFloat(this.$('maxAssetWeight').value) || 100;
    const months = parseInt(this.$('analysisPeriod').value) || 12;
    const riskFree = parseFloat(this.$('riskFreeRate').value) || 10;

    this.showLoading(`Otimizando via ${strategy.toUpperCase()}...`);

    // 1. Preparar Retornos e Matriz de Covariância
    const assetsData = tickers.map(t => this.marketData.assets[t]).filter(a => a && a.history && a.history.closes.length > 20);
    if (assetsData.length < 2) {
      this.hideLoading();
      this.toast('Dados históricos insuficientes para os ativos.', 'warning');
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const returnsMap = {};
    const tickersList = [];

    assetsData.forEach(a => {
      const idx = a.history.dates.findIndex(d => d >= cutoffStr);
      const closes = idx === -1 ? a.history.closes : a.history.closes.slice(idx);

      const dailyReturns = [];
      for (let i = 1; i < closes.length; i++) {
        dailyReturns.push((closes[i] - closes[i-1]) / closes[i-1]);
      }

      const meanDaily = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
      const annualReturn = meanDaily * 252 * 100;
      const annualVol = Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - meanDaily, 2), 0) / (dailyReturns.length || 1)) * Math.sqrt(252) * 100;

      returnsMap[a.ticker] = {
        ticker: a.ticker,
        annualReturn,
        annualVol,
        dailyReturns,
        meanDaily
      };
      tickersList.push(a.ticker);
    });

    // Calcular Matriz de Covariância Anualizada
    const nAssets = tickersList.length;
    const minLen = Math.min(...tickersList.map(t => returnsMap[t].dailyReturns.length));
    const covMatrix = Array.from({ length: nAssets }, () => new Array(nAssets).fill(0));

    for (let i = 0; i < nAssets; i++) {
      for (let j = 0; j < nAssets; j++) {
        const retI = returnsMap[tickersList[i]].dailyReturns.slice(-minLen);
        const retJ = returnsMap[tickersList[j]].dailyReturns.slice(-minLen);
        const meanI = returnsMap[tickersList[i]].meanDaily;
        const meanJ = returnsMap[tickersList[j]].meanDaily;

        let cov = 0;
        for (let k = 0; k < minLen; k++) {
          cov += (retI[k] - meanI) * (retJ[k] - meanJ);
        }
        covMatrix[i][j] = (cov / minLen) * 252 * 10000; // Anualizado e em escala percentual (100*100)
      }
    }

    // 2. Otimização (Monte Carlo Robusto)
    let weights = {};
    if (strategy === 'volatility') {
      const sumInvVol = assetsData.reduce((acc, a) => acc + (1 / (returnsMap[a.ticker].annualVol || 1)), 0);
      assetsData.forEach(a => {
        weights[a.ticker] = ((1 / (returnsMap[a.ticker].annualVol || 1)) / sumInvVol) * 100;
      });
    } else {
      let bestMetric = -Infinity;
      let bestWeights = {};
      const numSimulations = 10000;

      for (let i = 0; i < numSimulations; i++) {
        let w = assetsData.map(() => Math.random());
        const sum = w.reduce((a, b) => a + b, 0);
        w = w.map(val => (val / sum) * 100);

        // Constraint enforcement logic
        if (maxWeight < 100) {
          for (let iter = 0; iter < 5; iter++) {
            let excess = 0;
            let sumUnder = 0;
            w = w.map(val => {
              if (val > maxWeight) { excess += (val - maxWeight); return maxWeight; }
              sumUnder += val;
              return val;
            });
            if (excess <= 0.0001) break;
            w = w.map(val => val < maxWeight ? val + (excess * (val / (sumUnder || 1))) : val);
          }
        }

        let pRet = 0, variance = 0;
        for (let j = 0; j < nAssets; j++) {
          pRet += (w[j] / 100) * returnsMap[tickersList[j]].annualReturn;
          for (let k = 0; k < nAssets; k++) {
            variance += (w[j] / 100) * (w[k] / 100) * covMatrix[j][k];
          }
        }
        const pVol = Math.sqrt(Math.max(0, variance));

        let metric = 0;
        if (strategy === 'sharpe') metric = pVol > 0 ? (pRet - riskFree) / pVol : -Infinity;
        else if (strategy === 'return') metric = pRet;
        else if (strategy === 'risk') metric = -pVol;

        if (metric > bestMetric) {
          bestMetric = metric;
          tickersList.forEach((t, idx) => bestWeights[t] = w[idx]);
        }
      }
      weights = bestWeights;
    }

    // 3. Sugestões de Rebalanceamento
    const portfolioMap = {};
    this.analysis.positions.forEach(p => {
      if (!portfolioMap[p.ticker]) portfolioMap[p.ticker] = 0;
      portfolioMap[p.ticker] += p.quantity;
    });
    const totalValue = assetsData.reduce((acc, a) => acc + (portfolioMap[a.ticker] || 0) * a.last_price, 0);

    const suggestions = [];
    assetsData.forEach(a => {
      const price = a.last_price;
      const curQty = portfolioMap[a.ticker] || 0;
      const curVal = curQty * price;
      const curPct = (totalValue > 0) ? (curVal / totalValue * 100) : 0;
      const tgtPct = weights[a.ticker];
      const tgtVal = (tgtPct / 100) * (totalValue || 10000); // Se portfólio vazio, assume aporte de 10k
      const tgtQty = Math.round(tgtVal / price);
      const diff = tgtQty - curQty;

      if (Math.abs(diff) > 0) {
        suggestions.push({
          ticker: a.ticker,
          name: a.name,
          action: diff > 0 ? 'COMPRAR' : 'VENDER',
          quantity: Math.abs(diff),
          current_allocation: curPct,
          target_allocation: tgtPct,
          price: price,
          total_value: Math.abs(diff) * price
        });
      }
    });

    let finalRet = 0, finalVar = 0;
    for (let j = 0; j < nAssets; j++) {
      const tJ = tickersList[j];
      finalRet += (weights[tJ] / 100) * returnsMap[tJ].annualReturn;
      for (let k = 0; k < nAssets; k++) {
        const tK = tickersList[k];
        finalVar += (weights[tJ] / 100) * (weights[tK] / 100) * covMatrix[j][k];
      }
    }
    const finalVol = Math.sqrt(Math.max(0, finalVar));

    this.rebalanceResults = {
      optimal_allocation: {
        weights,
        expected_return: finalRet,
        volatility: finalVol,
        sharpe_ratio: finalVol > 0 ? (finalRet - riskFree) / finalVol : 0
      },
      rebalancing_suggestions: suggestions
    };

    setTimeout(() => {
      this.renderRebalance();
      this.hideLoading();
      this.toast('Otimização concluída!', 'success');
    }, 600);
  }

  async requestExpertAnalysis() {
    if (!this.user) {
      this.toast('Faça login para solicitar análise especializada.', 'warning');
      this.showPage('members');
      return;
    }

    const params = {
      strategy: this.$('rebalanceStrategy').value,
      max_weight: this.$('maxAssetWeight').value,
      period_months: this.$('analysisPeriod').value,
      risk_free: this.$('riskFreeRate').value
    };

    this.showLoading('Enviando solicitação...');
    try {
      const res = await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({
          action: 'request_rebalance',
          username: this.user.username,
          session_token: this.user.session_token,
          params: params,
          portfolio: this.portfolio
        })
      });
      const data = await res.json();
      this.hideLoading();
      if (data.success) {
        this.toast('Solicitação enviada com sucesso! O administrador processará e enviará por e-mail.', 'success');
      } else {
        this.toast(data.error || 'Erro ao enviar solicitação.', 'error');
      }
    } catch (err) {
      this.hideLoading();
      this.toast('Falha na comunicação com o servidor.', 'error');
    }
  }

  /* ------------------------------------------------------------------
     Rendering — Dashboard
  ------------------------------------------------------------------ */
  renderDashboard() {
    if (!this.analysis) {
      this.$('statTotalValue').textContent = 'R$ 0,00';
      this.$('statTotalInvested').textContent = 'R$ 0,00';
      this.$('statTotalProventos').textContent = 'R$ 0,00';
      this.$('statRentabilityReal').textContent = '0%';
      this.$('statPositions').textContent = '0';
      this.$('statVolatility').textContent = '0%';
      this.$('statSharpe').textContent = '0.00';
      return;
    }

    const s = this.analysis.summary;
    this.$('statTotalValue').textContent = this.formatCurrency(s.total_market_value + s.total_proventos + s.total_effective_profit);
    this.$('statTotalInvested').textContent = this.formatCurrency(s.total_invested || 0);
    this.$('statTotalProventos').textContent = this.formatCurrency(s.total_proventos || 0);
    this.$('statRealizedProfit').textContent = this.formatCurrency(s.total_effective_profit || 0);
    this.$('statRealizedProfit').className = 'stat-value ' + (s.total_effective_profit >= 0 ? 'positive' : 'negative');
    this.$('statPositions').textContent = s.num_positions || 0;

    const rentRealEl = this.$('statRentabilityReal');
    rentRealEl.textContent = (s.portfolio_rentability_real > 0 ? '+' : '') + this.formatNumber(s.portfolio_rentability_real, 2) + '%';
    rentRealEl.className = 'stat-value ' + (s.portfolio_rentability_real >= 0 ? 'positive' : 'negative');

    this.$('statVolatility').textContent = this.formatNumber(s.portfolio_volatility, 2) + '%';
    this.$('statSharpe').textContent = this.formatNumber(s.sharpe_ratio || 0, 2);

    this.renderAllocationChart();
    this.renderRentabilityChart();
  }

  renderAllocationChart() {
    if (!this.analysis || !this.analysis.positions.length) return;
    const ctx = this.$('allocationChart');
    if (this.charts.allocation) this.charts.allocation.destroy();

    // Filter only open positions for allocation chart
    const openPositions = this.analysis.positions.filter(p => p.quantity > 0);
    if (!openPositions.length) return;

    const labels = openPositions.map(p => p.ticker.replace('.SA', ''));
    const currentValues = openPositions.map(p => p.market_value);
    const investedValues = openPositions.map(p => p.totalInvested);
    const colors = this.palette(labels.length);

    this.charts.allocation = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            label: 'Patrimônio Total',
            data: currentValues,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#0b0f19',
            hoverOffset: 8,
            weight: 2
          },
          {
            label: 'Valor Investido',
            data: investedValues,
            backgroundColor: colors.map(c => c + '88'), // Semi-transparent
            borderWidth: 2,
            borderColor: '#0b0f19',
            hoverOffset: 8,
            weight: 1
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '40%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16, font: { family: 'Inter', size: 11 } } },
          tooltip: {
            callbacks: {
              label: context => {
                const label = context.dataset.label || '';
                const value = context.raw || 0;
                return `${context.label} (${label}): R$ ${this.formatNumber(value, 2)}`;
              },
            },
          },
        },
      },
    });
  }

  renderRentabilityChart() {
    if (!this.analysis || !this.analysis.positions.length) return;
    const ctx = this.$('rentabilityChart');
    if (this.charts.rentability) this.charts.rentability.destroy();

    // Sort by total equity to have a consistent view
    const sortedPositions = [...this.analysis.positions].sort((a, b) => b.total_equity - a.total_equity);

    const labels = sortedPositions.map(p => p.ticker.replace('.SA', ''));
    const effectiveValues = sortedPositions.map(p => p.effectiveProfit);
    const projectedValues = sortedPositions.map(p => p.projectedProfit);

    this.charts.rentability = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Lucro Efetivo (R$)',
            data: effectiveValues,
            backgroundColor: '#22c55e',
            borderRadius: 4
          },
          {
            label: 'Lucro Projetado (R$)',
            data: projectedValues,
            backgroundColor: '#6366f1',
            borderRadius: 4
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } },
            grid: { display: false },
            stacked: true
          },
          y: {
            ticks: { color: '#94a3b8', callback: v => 'R$ ' + this.formatNumber(v, 0) },
            grid: { color: 'rgba(255,255,255,0.05)' },
            stacked: true
          },
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: '#94a3b8', font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: R$ ${this.formatNumber(ctx.raw, 2)}`
            }
          },
        },
      },
    });
  }

  /* ------------------------------------------------------------------
     Rendering — Positions table
  ------------------------------------------------------------------ */
  renderPositions() {
    const tbody = this.$('positionsBody');
    if (!this.portfolio.positions.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Nenhum ativo no portfólio. Clique em "Adicionar Ativo".</td></tr>';
      return;
    }

    let consolidated = this.consolidatePortfolio();

    // Filter out closed positions if requested
    const hideClosed = this.$('hideClosedPositions').checked;
    if (hideClosed) {
      consolidated = consolidated.filter(c => c.totalQty > 0);
    }

    const analysisMap = {};
    if (this.analysis) {
      this.analysis.positions.forEach(p => { analysisMap[p.ticker] = p; });
    }

    // Sort
    const sortBy = this.$('sortPositions').value;
    consolidated.sort((a, b) => {
      const an = analysisMap[a.ticker] || {};
      const bn = analysisMap[b.ticker] || {};
      if (sortBy === 'market_value') return (bn.market_value || 0) - (an.market_value || 0);
      if (sortBy === 'dividends') return (bn.total_proventos || 0) - (an.total_proventos || 0);
      if (sortBy === 'equity') return (bn.total_equity || 0) - (an.total_equity || 0);
      if (sortBy === 'rentability') return (bn.rentability_total || 0) - (an.rentability_total || 0);
      return a.ticker.localeCompare(b.ticker);
    });

    let html = '';
    consolidated.forEach(item => {
      const a = analysisMap[item.ticker] || {};
      const tickerClean = this.escapeHTML(item.ticker.replace('.SA', ''));

      const rent = a.rentability_total;
      const rentClass = rent !== undefined ? (rent >= 0 ? 'positive' : 'negative') : '';
      const rentText = rent !== undefined ? ((rent > 0 ? '+' : '') + this.formatNumber(rent, 2) + '%') : '—';

      const effProf = a.effectiveProfit || 0;
      const projProf = a.projectedProfit || 0;

      const aiButton = this.user ? `
        <button class="btn-ai-icon" onclick="app.showAssetNews('${item.ticker}')" title="Ver resumo IA">🤖</button>
      ` : '';

      html += `<tr>
        <td><a href="#" onclick="event.preventDefault(); app.showMonitor('${tickerClean}')" class="ticker-link"><strong>${tickerClean}</strong><br><small style="color:var(--text-muted)">${a.name || item.ticker}</small></a></td>
        <td>${item.totalQty}</td>
        <td>R$ ${this.formatNumber(item.avgPrice, 4)}</td>
        <td>${this.formatCurrency(item.totalInvested)}</td>
        <td>${a.market_value ? this.formatCurrency(a.market_value) : '—'}</td>
        <td class="positive">${a.total_proventos ? this.formatCurrency(a.total_proventos) : 'R$ 0,00'}</td>
        <td style="font-weight:700">${a.total_equity ? this.formatCurrency(a.total_equity) : '—'}</td>
        <td class="${effProf >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(effProf)}</td>
        <td class="${projProf >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(projProf)}</td>
        <td class="${rentClass}">${rentText}</td>
        <td>
          <div style="display:flex; gap:0.25rem">
            <button class="btn-primary-sm" onclick="app.manageTransactions('${item.ticker}')" title="Gerenciar registros">⚙️</button>
            ${aiButton}
          </div>
        </td>
      </tr>`;
    });
    tbody.innerHTML = html;
  }

  renderDividendsPage() {
    if (!this.marketData) return;
    const startDate = this.$('divStartDate').value;
    const endDate = this.$('divEndDate').value;

    let totalProventos = 0;
    let tableData = [];

    if (this.isDiscoveryMode) {
      // Discovery Mode: Look at all market data
      Object.keys(this.marketData.assets).forEach(ticker => {
        const asset = this.marketData.assets[ticker];
        const dummyTransactions = [{ quantity: 1, purchase_date: '1900-01-01' }]; // Assume holding 1 share
        const proventosPerShare = this.getDividendsForTicker(ticker, dummyTransactions, startDate, endDate);

        if (proventosPerShare > 0) {
          const yieldPeriod = (proventosPerShare / (asset.last_price || 1)) * 100;
          tableData.push({
            ticker,
            name: asset.name,
            total_proventos: proventosPerShare,
            yield_period: yieldPeriod,
            isDiscovery: true
          });
        }
      });
      // Sort discovery by yield
      tableData.sort((a, b) => b.yield_period - a.yield_period);
    } else {
      // Portfolio Mode
      if (!this.analysis) {
        this.$('dividendsBody').innerHTML = '<tr><td colspan="4" class="empty-state">Adicione ativos ao seu portfólio primeiro.</td></tr>';
        return;
      }
      this.analysis.positions.forEach(p => {
        const consolidatedTicker = this.consolidatePortfolio().find(c => c.ticker === p.ticker);
        if (!consolidatedTicker) return;

        const proventos = this.getDividendsForTicker(p.ticker, consolidatedTicker.transactions, startDate, endDate);
        if (proventos > 0) {
          totalProventos += proventos;
          const yieldPeriod = (proventos / (p.totalInvested || 1)) * 100;
          tableData.push({
            ticker: p.ticker,
            name: p.name,
            total_proventos: proventos,
            yield_period: yieldPeriod
          });
        }
      });
      tableData.sort((a, b) => b.total_proventos - a.total_proventos);
    }

    // Stats
    this.$('divStatTotal').textContent = this.isDiscoveryMode ? 'N/A' : this.formatCurrency(totalProventos);
    const topPayer = tableData[0];
    this.$('divStatTopPayer').textContent = topPayer ? topPayer.ticker.replace('.SA','') : '—';

    if (!this.isDiscoveryMode) {
      const avgYield = tableData.reduce((acc, val) => acc + val.yield_period, 0) / (tableData.length || 1);
      this.$('divStatYield').textContent = this.formatNumber(avgYield, 2) + '%';
    } else {
      this.$('divStatYield').textContent = '—';
    }

    // Table
    const tbody = this.$('dividendsBody');
    if (!tableData.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Nenhum provento encontrado no período de ${startDate} a ${endDate}</td></tr>`;
      return;
    }

    tbody.innerHTML = tableData.map(item => `
      <tr>
        <td><strong>${item.ticker.replace('.SA', '')}</strong><br><small style="color:var(--text-muted)">${item.name}</small></td>
        <td class="positive">${this.formatCurrency(item.total_proventos)}${item.isDiscovery ? ' /ação' : ''}</td>
        <td>${this.formatNumber(item.yield_period, 2)}%</td>
        <td>${this.isDiscoveryMode ? '—' : this.formatNumber(((item.total_proventos / (totalProventos || 1)) * 100), 1) + '%'}</td>
      </tr>
    `).join('');
  }

  manageTransactions(ticker) {
    const tickerData = this.consolidatePortfolio().find(i => i.ticker === ticker);
    if (!tickerData) return;

    this.closeTransactionModal(); // Ensure old modal is removed

    let rows = '';
    tickerData.transactions.forEach(t => {
      const typeLabel = (t.type || 'buy') === 'buy' ? '<span class="badge badge-buy">Compra</span>' : '<span class="badge badge-sell">Venda</span>';
      rows += `
        <tr>
          <td>${typeLabel}</td>
          <td>${t.purchase_date}</td>
          <td>${t.quantity}</td>
          <td>R$ ${this.formatNumber(t.purchase_price, 2)}</td>
          <td>
            <button class="btn-outline-sm" onclick="app.closeTransactionModal(); app.openModal(${t.originalIndex})">✏️</button>
            <button class="btn-danger-sm" onclick="if(confirm('Excluir este registro?')){ app.removePosition(${t.originalIndex}); app.manageTransactions('${ticker}'); }">🗑</button>
          </td>
        </tr>
      `;
    });

    const modalHtml = `
      <div class="modal-overlay show" id="transactionModalOverlay">
        <div class="modal glass modal-lg">
          <div class="modal-header">
            <h2>Registros: ${ticker}</h2>
            <button class="modal-close" onclick="app.closeTransactionModal()">&times;</button>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Data</th>
                  <th>Quantidade</th>
                  <th>Preço</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="form-actions" style="margin-top:1.5rem">
            <button class="btn btn-primary" onclick="app.closeTransactionModal()">Fechar</button>
          </div>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.id = 'dynamicModalContainer';
    div.innerHTML = modalHtml;
    document.body.appendChild(div);
  }

  closeTransactionModal() {
    const el = document.getElementById('dynamicModalContainer');
    if (el) el.remove();
  }

  /* ------------------------------------------------------------------
     Rendering — Barsi
  ------------------------------------------------------------------ */
  renderBarsi() {
    const data = this.barsiResults;
    if (!data) return;

    const tbody = this.$('barsiBody');
    if (!data.analyses || !data.analyses.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum resultado</td></tr>';
      return;
    }

    const analyses = [...data.analyses];
    const sortBy = this.$('sortBarsi').value;
    analyses.sort((a, b) => {
      if (sortBy === 'margin') return b.margin_of_safety - a.margin_of_safety;
      if (sortBy === 'yield') return b.current_yield - a.current_yield;
      return a.ticker.localeCompare(b.ticker);
    });

    let html = '';
    analyses.forEach(a => {
      let badgeClass = 'badge-none', badgeText = 'N/A';
      if (a.recommendation.includes('COMPRAR')) { badgeClass = 'badge-buy'; badgeText = 'COMPRAR'; }
      else if (a.recommendation.includes('MANTER')) { badgeClass = 'badge-hold'; badgeText = 'MANTER'; }
      else if (a.recommendation.includes('VENDER')) { badgeClass = 'badge-sell'; badgeText = 'VENDER'; }
      else if (a.recommendation.includes('SEM DADOS')) { badgeText = 'SEM DADOS'; }

      const marginClass = a.margin_of_safety > 0 ? 'positive' : 'negative';

      html += `<tr>
        <td><strong>${a.ticker.replace('.SA', '')}</strong><br><small style="color:var(--text-muted)">${a.name}</small></td>
        <td>R$ ${this.formatNumber(a.current_price, 2)}</td>
        <td>${a.price_ceiling !== null ? 'R$ ' + this.formatNumber(a.price_ceiling, 2) : '—'}</td>
        <td class="${marginClass}">${a.margin_of_safety > 0 ? '+' : ''}${this.formatNumber(a.margin_of_safety, 1)}%</td>
        <td>${this.formatNumber(a.current_yield, 2)}%</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      </tr>`;
    });
    tbody.innerHTML = html;

    const sum = data.summary || {};
    this.$('barsiBuy').textContent = sum.buy_signals || 0;
    this.$('barsiHold').textContent = sum.hold_signals || 0;
    this.$('barsiSell').textContent = sum.sell_signals || 0;
    this.$('barsiSummary').style.display = 'flex';
  }

  /* ------------------------------------------------------------------
     Rendering — Rebalance
  ------------------------------------------------------------------ */
  renderRebalance() {
    const data = this.rebalanceResults;
    if (!data) return;

    this.$('rebalancePlaceholder').style.display = 'none';
    this.$('rebalanceResults').style.display = 'block';

    const opt = data.optimal_allocation;
    this.$('rebReturn').textContent = this.formatNumber(opt.expected_return, 2) + '%';
    this.$('rebVol').textContent = this.formatNumber(opt.volatility, 2) + '%';
    this.$('rebSharpe').textContent = this.formatNumber(opt.sharpe_ratio, 4);

    const ctx = this.$('optimalChart');
    if (this.charts.optimal) this.charts.optimal.destroy();

    const tickers = Object.keys(opt.weights);
    const weights = Object.values(opt.weights);
    const labels = tickers.map(t => t.replace('.SA', ''));
    const colors = this.palette(labels.length);

    this.charts.optimal = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: weights, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16, font: { family: 'Inter', size: 12 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${this.formatNumber(ctx.raw, 2)}%` } },
        },
      },
    });

    const suggestions = [...(data.rebalancing_suggestions || [])];
    const tbody = this.$('suggestionsBody');
    if (!suggestions.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Portfólio já está otimizado!</td></tr>';
      this.$('suggestionsCard').style.display = 'block';
      return;
    }

    const sortBy = this.$('sortRebalance').value;
    suggestions.sort((a, b) => {
      if (sortBy === 'allocation') return b.target_allocation - a.target_allocation;
      if (sortBy === 'value') return b.total_value - a.total_value;
      return a.ticker.localeCompare(b.ticker);
    });

    let html = '';
    suggestions.forEach(s => {
      const actionClass = s.action === 'COMPRAR' ? 'badge-buy' : 'badge-sell';
      html += `<tr>
        <td><span class="badge ${actionClass}">${s.action}</span></td>
        <td><strong>${s.ticker.replace('.SA', '')}</strong><br><small style="color:var(--text-muted)">${s.name}</small></td>
        <td>${s.quantity}</td>
        <td>R$ ${this.formatNumber(s.price, 2)}</td>
        <td>${this.formatCurrency(s.total_value)}</td>
        <td>${this.formatNumber(s.current_allocation, 1)}% → ${this.formatNumber(s.target_allocation, 1)}%</td>
      </tr>`;
    });
    tbody.innerHTML = html;
    this.$('suggestionsCard').style.display = 'block';
  }

  /* ------------------------------------------------------------------
     Rendering — Market Summary
     original com o nome do ativo na linha 1451: <td><strong>${item.ticker.replace('.SA', '')}</strong><br><small style="color:var(--text-muted)">${item.name}</small></td>
  ------------------------------------------------------------------ */
  renderMarketSummary() {
    const summary = this.marketSummaryData;
    if (!summary) return;

    this.$('summaryDateFull').textContent = `Dados atualizados em ${new Date(summary.date).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'})} (referente à coleta de ${new Date(summary.last_update).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'})})`;

    let gainers, losers, deltaKey;
    if (this.summaryPeriod === 'month') {
      gainers = summary.gainers_month;
      losers = summary.losers_month;
      deltaKey = 'monthly_delta';
    } else if (this.summaryPeriod === 'year') {
      gainers = summary.gainers_year;
      losers = summary.losers_year;
      deltaKey = 'yearly_delta';
    } else {
      gainers = summary.gainers;
      losers = summary.losers;
      deltaKey = 'daily_delta';
    }

    const renderRows = (data, isGainer) => {
      if (!data) return '<tr><td colspan="4" class="empty-state">Sem dados para este período</td></tr>';
      return data.map((item, idx) => {
        const tickerClean = this.escapeHTML(item.ticker.replace('.SA', ''));
        const deltaVal = item[deltaKey] || 0;
        const delta = this.formatNumber(deltaVal * 100, 2);
        const icon = isGainer ? '' : '';
        const cssClass = isGainer ? 'var-up' : 'var-down';

        const logoHtml = this.getAssetLogoHTML(item.ticker, 24);
        const canvasId = `spark-${isGainer ? 'up' : 'down'}-${idx}`;

        return `
          <tr>
            <td>
              <div style="display: flex; align-items: center;">
                ${logoHtml}
                <a href="#" onclick="event.preventDefault(); app.showMonitor('${tickerClean}')" class="ticker-link"><strong>${tickerClean}</strong></a>
              </div>
            </td>
            <td>R$${this.formatNumber(item.last_close, 2)}</td>
            <td class="${cssClass}">${(deltaVal > 0) ? '+' : ''}${delta}% ${icon}</td>
            <td style="padding: 2px 5px;"><canvas id="${canvasId}" width="80" height="30"></canvas></td>
          </tr>
        `;
      }).join('');
    };

    this.$('gainersBody').innerHTML = renderRows(gainers, true);
    this.$('losersBody').innerHTML = renderRows(losers, false);

    // Render sparklines
    if (!this.sparkCharts) this.sparkCharts = [];
    this.sparkCharts.forEach(c => c.destroy());
    this.sparkCharts = [];

    // Render sparklines with small delay to ensure DOM is ready
    setTimeout(() => {
      if (gainers) gainers.forEach((item, idx) => this.renderSparkline(item.ticker, `spark-up-${idx}`));
      if (losers) losers.forEach((item, idx) => this.renderSparkline(item.ticker, `spark-down-${idx}`));
    }, 50);
  }

  renderSparkline(ticker, canvasId) {
    const asset = this.marketData && this.marketData.assets[ticker];
    if (!asset || !asset.history || !asset.history.closes) return;

    const ctx = document.getElementById(canvasId);
    if (!ctx) {
      console.warn(`Canvas ${canvasId} not found for ${ticker}`);
      return;
    }

    const data = asset.history.closes.slice(-15);
    if (data.length === 0) return;

    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const avgLine = data.map(() => avg);
    const isUp = data[data.length - 1] >= data[0];

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((_, i) => i),
        datasets: [
          {
            data: data,
            borderColor: isUp ? '#00ccff' : '#ffcc00',
            borderWidth: 1.8,
            pointRadius: 0,
            fill: false,
            tension: 0.3
          },
          {
            data: avgLine,
            borderColor: 'rgba(255, 255, 255, 0.7)',
            borderWidth: 1.0,
            borderDash: [5, 2],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        events: [],
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });
    this.sparkCharts.push(chart);
  }

  renderTaxReport() {
    const month = parseInt(this.$('taxMonth').value);
    const year = parseInt(this.$('taxYear').value);

    if (!this.portfolio.positions.length) return;

    // 1. Segregar operações por mês e tipo (DT vs ST)
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const reportData = {
      totalSalesStocks: 0,
      stProfitStocks: 0, // Apenas Ações (sujeito a isenção 20k)
      stProfitOthers: 0, // ETFs, Opções (15% sem isenção)
      stProfitFIIs: 0,   // FIIs/Fiagros (20% sem isenção)
      dtProfit: 0,
      irrfMonth: 0,
      details: []
    };

    // Necessitamos recalcular tudo cronologicamente para ter o PMC correto no mês
    const consolidated = {};
    const tickers = [...new Set(this.portfolio.positions.map(p => p.ticker))];

    tickers.forEach(ticker => {
      const transactions = [...this.portfolio.positions]
        .filter(p => p.ticker === ticker)
        .map((p, i) => ({ ...p, originalIndex: i, originalQty: p.quantity }));

      transactions.sort((a, b) => a.purchase_date.localeCompare(b.purchase_date) || a.originalIndex - b.originalIndex);

      let currentQty = 0;
      let currentPM = 0;
      let currentTotalCost = 0;

      const byDay = {};
      transactions.forEach(t => {
        if (!byDay[t.purchase_date]) byDay[t.purchase_date] = [];
        byDay[t.purchase_date].push(t);
      });

      Object.keys(byDay).sort().forEach(date => {
        const isCurrentMonth = date.startsWith(monthStr);
        const dayTrans = byDay[date];

        // Clone to not affect original objects during internal day-trade matching
        let buys = dayTrans.filter(t => (t.type || 'buy') === 'buy').map(t => ({...t}));
        let sells = dayTrans.filter(t => t.type === 'sell').map(t => ({...t}));

        // Day Trade Detection
        let buyPtr = 0, sellPtr = 0;
        while (buyPtr < buys.length && sellPtr < sells.length) {
          let b = buys[buyPtr];
          let s = sells[sellPtr];
          let matchQty = Math.min(b.quantity, s.quantity);

          if (isCurrentMonth) {
            const gross = (s.purchase_price - b.purchase_price) * matchQty;
            const costs = ((b.costs || 0) * (matchQty / b.originalQty)) + ((s.costs || 0) * (matchQty / s.originalQty));
            const result = gross - costs;
            const irrf = (s.irrf || 0) * (matchQty / s.originalQty);

            reportData.dtProfit += result;
            reportData.irrfMonth += irrf;
            reportData.details.push({
              date, ticker, type: 'Day Trade', qty: matchQty, price: s.purchase_price, costs, result, irrf
            });
          }

          b.quantity -= matchQty;
          s.quantity -= matchQty;
          if (b.quantity === 0) buyPtr++;
          if (s.quantity === 0) sellPtr++;
        }

        // Swing Trade FIFO
        if (!consolidated[ticker]) consolidated[ticker] = { qty: 0, lots: [] };
        let state = consolidated[ticker];

        dayTrans.forEach((t, i) => {
          let remainingQty = (t.type === 'sell') ? sells.find(s => s.originalIndex === t.originalIndex).quantity
                                               : buys.find(b => b.originalIndex === t.originalIndex).quantity;

          if (remainingQty > 0) {
            if ((t.type || 'buy') === 'buy') {
              const propCosts = (t.costs || 0) * (remainingQty / t.originalQty);
              const totalCost = (remainingQty * t.purchase_price) + propCosts;
              const unitCost = totalCost / remainingQty;
              state.lots.push({ qty: remainingQty, unitCost: unitCost });
              state.qty += remainingQty;
            } else {
              const propCosts = (t.costs || 0) * (remainingQty / t.originalQty);
              const netSaleValue = (remainingQty * t.purchase_price) - propCosts;

              let costBasisSold = 0;
              let toSell = remainingQty;
              while (toSell > 0 && state.lots.length > 0) {
                let lot = state.lots[0];
                let take = Math.min(toSell, lot.qty);
                costBasisSold += (take * lot.unitCost);
                lot.qty -= take;
                toSell -= take;
                if (lot.qty === 0) state.lots.shift();
              }

              const result = netSaleValue - costBasisSold;
              const irrf = (t.irrf || 0) * (remainingQty / t.originalQty);

              if (isCurrentMonth) {
                const asset = this.assets.find(a => a.ticker === ticker);
                const description = (asset && asset.description) ? asset.description.toUpperCase() : '';
                const sector = (asset && asset.sector) ? asset.sector.toUpperCase() : '';
                const tickerClean = ticker.replace('.SA', '');

                // Melhorando a detecção por Ticker e Setor
                const isFII = description.includes('FII') || description.includes('FIAGRO') || sector.includes('IMOBILIÁRIO') || sector.includes('FUNDO');
                const isETF = description.includes('ETF') || tickerClean === 'BOVA11' || tickerClean === 'IVVB11' || tickerClean === 'SMAL11';
                const isOption = description.includes('OPÇÃO') || tickerClean.match(/[A-Z]{4}[A-X][0-9]+/);
                const isStock = !isFII && !isETF && !isOption;

                if (isStock) {
                  reportData.totalSalesStocks += (remainingQty * t.purchase_price);
                  reportData.stProfitStocks += result;
                } else if (isFII) {
                  reportData.stProfitFIIs += result;
                } else {
                  // ETFs / Opções (ST 15% mas sem isenção)
                  reportData.stProfitOthers += result;
                }

                reportData.irrfMonth += irrf;
                reportData.details.push({
                  date, ticker, type: 'Swing Trade', qty: remainingQty, price: t.purchase_price, costs: t.costs * (remainingQty / t.originalQty), result, irrf
                });
              }

              currentQty -= remainingQty;
              currentTotalCost = currentQty * currentPM;
            }
          }
        });
      });
    });

    // 2. Aplicar Regras de Isenção e Compensação
    const rawConfig = this.taxConfig || { STOCK_EXEMPTION_LIMIT: 20000, STOCK_ST_RATE: 0.15, STOCK_DT_RATE: 0.20, FII_RATE: 0.20 };
    const config = {
      STOCK_EXEMPTION_LIMIT: this.parseRate(rawConfig.STOCK_EXEMPTION_LIMIT),
      STOCK_ST_RATE: this.parseRate(rawConfig.STOCK_ST_RATE),
      STOCK_DT_RATE: this.parseRate(rawConfig.STOCK_DT_RATE),
      FII_RATE: this.parseRate(rawConfig.FII_RATE)
    };
    const fiscal = {
      st_loss: this.parseRate(this.fiscalData?.st_loss),
      dt_loss: this.parseRate(this.fiscalData?.dt_loss),
      irrf_balance: this.parseRate(this.fiscalData?.irrf_balance),
      tax_balance: this.parseRate(this.fiscalData?.tax_balance)
    };

    // Isenção 20k (Apenas para AÇÕES em Swing Trade)
    let isento = reportData.totalSalesStocks <= config.STOCK_EXEMPTION_LIMIT && reportData.stProfitStocks > 0;

    // Lucro Tributável ST (15%) = (Stocks se não isento) + Outros ST (ETFs/Opções)
    let stProfit15 = (isento ? 0 : reportData.stProfitStocks) + reportData.stProfitOthers;
    let stTaxable = Math.max(0, stProfit15);
    let stLossCurrent = stProfit15 < 0 ? -stProfit15 : 0;

    // Lucro Tributável FIIs (20%)
    let fiiTaxable = Math.max(0, reportData.stProfitFIIs);
    let fiiLossCurrent = reportData.stProfitFIIs < 0 ? -reportData.stProfitFIIs : 0;

    // Compensação de prejuízos Swing Trade (ST 15% + FII 20%)
    // Baseado na regra do usuário: Prejuízos de Swing Trade SÓ podem compensar lucros de Swing Trade
    let stLossAvailable = fiscal.st_loss;
    let stLossComp = 0;

    // Primeiro compensa Swing Trade Comum (15%)
    if (stTaxable > 0 && stLossAvailable > 0) {
      const comp = Math.min(stTaxable, stLossAvailable);
      stLossComp += comp;
      stTaxable -= comp;
      stLossAvailable -= comp;
    }

    // Depois compensa FIIs (20%) se sobrar prejuízo
    if (fiiTaxable > 0 && stLossAvailable > 0) {
      const comp = Math.min(fiiTaxable, stLossAvailable);
      stLossComp += comp;
      fiiTaxable -= comp;
      stLossAvailable -= comp;
    }

    // Compensação de Day Trade (DT 20%)
    let dtTaxable = Math.max(0, reportData.dtProfit);
    let dtLossComp = 0;
    let dtLossCurrent = reportData.dtProfit < 0 ? -reportData.dtProfit : 0;
    if (dtTaxable > 0 && fiscal.dt_loss > 0) {
      dtLossComp = Math.min(dtTaxable, fiscal.dt_loss);
      dtTaxable -= dtLossComp;
    }

    // Cálculo do Imposto do Mês + Imposto Acumulado de meses anteriores (DARF < R$10)
    const st_rate = config.STOCK_ST_RATE || 0.15;
    const fii_rate = config.FII_RATE || 0.20;
    const dt_rate = config.STOCK_DT_RATE || 0.20;

    let taxDue = (stTaxable * st_rate) + (fiiTaxable * fii_rate) + (dtTaxable * dt_rate);
    let totalTaxDue = taxDue + (fiscal.tax_balance || 0);

    // Abatimento de IRRF
    let irrfAvailable = reportData.irrfMonth + (fiscal.irrf_balance || 0);
    let irrfCompensated = Math.min(totalTaxDue, irrfAvailable);
    let taxAfterIRRF = Math.max(0, totalTaxDue - irrfCompensated);

    let darf = 0;
    let nextTaxBalance = 0;

    // Regra R$ 10,00 para emissão de DARF
    if (taxAfterIRRF >= 10) {
      darf = taxAfterIRRF;
      nextTaxBalance = 0;
    } else {
      darf = 0;
      nextTaxBalance = taxAfterIRRF;
    }

    // 3. Renderizar UI
    this.$('repTotalSales').textContent = this.formatCurrency(reportData.totalSalesStocks);
    this.$('repIsento').textContent = isento ? 'Sim' : 'Não';
    this.$('repSTResult').textContent = this.formatCurrency(reportData.stProfitStocks + reportData.stProfitOthers + reportData.stProfitFIIs);
    this.$('repDTResult').textContent = this.formatCurrency(reportData.dtProfit);
    this.$('repLossCompensated').textContent = this.formatCurrency(stLossComp + dtLossComp);

    // Mostra o imposto bruto calculado para dar visibilidade ao usuário
    this.$('repTaxDue').innerHTML = `${this.formatCurrency(taxDue)}${fiscal.tax_balance > 0 ? ` <br><small style="font-size: 0.7rem; color: var(--text-muted);">+ ${this.formatCurrency(fiscal.tax_balance)} acumulado</small>` : ''}`;

    this.$('repIRRF').textContent = this.formatCurrency(reportData.irrfMonth);

    if (darf === 0 && nextTaxBalance > 0) {
      this.$('repDARF').innerHTML = `${this.formatCurrency(0)} <br><small style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(Abaixo do mínimo de R$ 10,00. Acumulado para o próximo mês: ${this.formatCurrency(nextTaxBalance)})</small>`;
    } else {
      this.$('repDARF').textContent = this.formatCurrency(darf);
    }

    this.$('repSTLossBalance').textContent = this.formatCurrency(fiscal.st_loss);
    this.$('repDTLossBalance').textContent = this.formatCurrency(fiscal.dt_loss);
    this.$('repIRRFBalance').textContent = this.formatCurrency(fiscal.irrf_balance);
    if (this.$('repTaxBalance')) this.$('repTaxBalance').textContent = this.formatCurrency(fiscal.tax_balance);

    // Store calculated next balances for saving
    this.nextFiscalBalances = {
      st_loss: Math.max(0, stLossAvailable + stLossCurrent + fiiLossCurrent),
      dt_loss: Math.max(0, fiscal.dt_loss - dtLossComp + dtLossCurrent),
      irrf_balance: Math.max(0, irrfAvailable - irrfCompensated),
      tax_balance: nextTaxBalance
    };
    this.$('btnSaveFiscalBalance').style.display = 'inline-block';

    const tbody = this.$('taxDetailsBody');
    if (reportData.details.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma operação de venda/day trade neste mês.</td></tr>';
    } else {
      tbody.innerHTML = reportData.details.map(d => `
        <tr>
          <td>${d.date.split('-').reverse().join('/')}</td>
          <td><strong>${d.ticker.replace('.SA','')}</strong></td>
          <td><span class="badge ${d.type === 'Day Trade' ? 'badge-daytrade' : 'badge-hold'}">${d.type}</span></td>
          <td>${d.qty}</td>
          <td>R$ ${this.formatNumber(d.price, 2)}</td>
          <td>R$ ${this.formatNumber(d.costs, 2)}</td>
          <td class="${d.result >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(d.result)}</td>
          <td>R$ ${this.formatNumber(d.irrf, 2)}</td>
        </tr>
      `).join('');
    }
  }

  importCSV(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.split('\n');
      const newPositions = [];

      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        if (cols.length < 5) continue;

        // Formato esperado: Data,Ticker,Tipo,Qtd,Preço,Custos,IRRF
        // Ex: 2024-05-10,PETR4,buy,100,35.50,1.50,0
        const [date, ticker, type, qty, price, costs, irrf] = cols;

        newPositions.push({
          purchase_date: date,
          ticker: ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : ticker.toUpperCase() + '.SA',
          type: type.toLowerCase() === 'v' || type.toLowerCase() === 'sell' ? 'sell' : 'buy',
          quantity: parseInt(qty),
          purchase_price: parseFloat(price),
          costs: parseFloat(costs) || 0,
          irrf: parseFloat(irrf) || 0
        });
      }

      if (newPositions.length > 0) {
        this.portfolio.positions.push(...newPositions);
        this.savePortfolio();
        await this.runAnalysis();
        this.renderPositions();
        this.toast(`${newPositions.length} registros importados!`, 'success');
      }
    };
    reader.readAsText(file);
    input.value = ''; // Reset input
  }

  async saveFiscalData(newFiscalData) {
    if (!this.user || !this.GAS_URL) return;
    try {
      this.showLoading('Salvando balanço fiscal...');
      const res = await fetch(this.GAS_URL, {
        method: 'POST',
        mode: 'cors',
        body: JSON.stringify({
          action: 'save_fiscal_data',
          username: this.user.username,
          session_token: this.user.session_token,
          fiscal_data: newFiscalData
        })
      });
      const data = await res.json();
      this.hideLoading();
      if (data.success) {
        this.fiscalData = newFiscalData;
        this.toast('Balanço fiscal salvo com sucesso!', 'success');
        this.renderTaxReport();
      } else {
        this.toast(data.error || 'Erro ao salvar balanço fiscal.', 'error');
      }
    } catch (err) {
      this.hideLoading();
      console.error('Erro ao salvar dados fiscais:', err);
    }
  }

  confirmAndSaveFiscalBalance() {
    if (!this.nextFiscalBalances) return;
    if (confirm('Deseja salvar os saldos calculados como base para os próximos meses?')) {
      this.saveFiscalData(this.nextFiscalBalances);
    }
  }

  renderMarketTreemap() {
    const allAssets = this.marketSummaryData ? this.marketSummaryData.all_assets : null;
    if (!allAssets) return;
    const ctx = this.$('marketTreemap');
    if (!ctx) return;
    if (this.charts.treemap) this.charts.treemap.destroy();

    const deltaKey = this.summaryPeriod === 'month' ? 'monthly_delta' : (this.summaryPeriod === 'year' ? 'yearly_delta' : 'daily_delta');

    // Filter and prepare data
    const validAssets = allAssets.filter(a => a[deltaKey] !== undefined && a.ticker !== '^BVSP');

    const posPriceAssets = validAssets.filter(a => a[deltaKey] > 0);
    const negPriceAssets = validAssets.filter(a => a[deltaKey] < 0);

    const getQuartiles = (values) => {
      if (values.length === 0) return [0, 0, 0, 0, 0];
      const sorted = [...values].sort((a, b) => a - b);
      const q = (p) => {
        const pos = (sorted.length - 1) * p;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sorted[base + 1] !== undefined) {
          return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        } else {
          return sorted[base];
        }
      };
      return [sorted[0], q(0.25), q(0.5), q(0.75), sorted[sorted.length - 1]];
    };

    const getCategory = (val, quartiles) => {
      if (val <= quartiles[1]) return 0;
      if (val <= quartiles[2]) return 1;
      if (val <= quartiles[3]) return 2;
      return 3;
    };

    const posVolAbs = posPriceAssets.map(a => Math.abs(a.delta_volume || 0));
    const negVolAbs = negPriceAssets.map(a => Math.abs(a.delta_volume || 0));

    const posQuartiles = getQuartiles(posVolAbs);
    const negQuartiles = getQuartiles(negVolAbs);

    const cores_negativas = ["#FFE600", "#FF9800", "#FF5722", "#D50000"]; // Amarelo a Vermelho
    const cores_positivas = ["#C6FF00", "#76FF03", "#00E676", "#00C853"]; // Lima a Verde

    const data = validAssets.map(a => {
      const volAbs = Math.abs(a.delta_volume || 0);
      let category = 0;
      let color = "#D3D3D3";

      if (a[deltaKey] > 0) {
        category = getCategory(volAbs, posQuartiles);
        color = cores_positivas[category];
      } else if (a[deltaKey] < 0) {
        category = getCategory(volAbs, negQuartiles);
        color = cores_negativas[category];
      }

      const val = a[deltaKey] * 100;

      return {
        ticker: a.ticker.replace('.SA', ''),
        name: a.name,
        value: Math.max(Math.abs(val), 0.5),
        daily: this.formatNumber(a.daily_delta * 100, 2) + '%',
        monthly: this.formatNumber(a.monthly_delta * 100, 2) + '%',
        yearly: this.formatNumber(a.yearly_delta * 100, 2) + '%',
        delta_volume: this.formatNumber(a.delta_volume * 100, 2) + '%',
        delta: a[deltaKey],
        color: color
      };
    });

    // Helper for text color contrast (Luminance)
    const getTextColor = (hex) => {
      if (!hex || hex === 'transparent') return '#ffffff';
      if (hex.startsWith('#')) hex = hex.slice(1);
      if (hex.length === 3) hex = hex.split('').map(s => s + s).join('');
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return L > 0.6 ? "#333333" : "#FFFFFF";
    };

    this.charts.treemap = new Chart(ctx, {
      type: 'treemap',
      data: {
        datasets: [{
          label: 'Mercado B3',
          tree: data,
          key: 'value',
          spacing: 1,
          borderWidth: 0,
          borderRadius: 2,
          backgroundColor: (context) => {
            if (!context || !context.raw || !context.raw._data) return '#333';
            return context.raw._data.color;
          },
          labels: {
            display: true,
            formatter: (context) => {
              if (!context || !context.raw || !context.raw._data) return '';
              const item = context.raw._data;
              if (context.raw.w < 40 || context.raw.h < 30) return [item.ticker];
              if (this.summaryPeriod === 'month') return [item.ticker, `M: ${item.monthly}`, `D: ${item.daily}`];
              if (this.summaryPeriod === 'year') return [item.ticker, `A: ${item.yearly}`, `D: ${item.daily}`];
              return [item.ticker, `D: ${item.daily}`, `M: ${item.monthly}`];
            },
            font: (context) => {
              if (!context || !context.raw) return { size: 10 };
              const item = context.raw;
              const size = Math.min(Math.max((item.w || 0) / 6, 8), 12);
              return { size: size, weight: 'bold', family: 'Inter' };
            },
            color: (context) => {
              if (!context || !context.raw || !context.raw._data) return '#fff';
              return getTextColor(context.raw._data.color);
            }
          }
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => (items && items[0] && items[0].raw && items[0].raw._data) ? items[0].raw._data.ticker : '',
              label: (item) => {
                if (!item || !item.raw || !item.raw._data) return '';
                const d = item.raw._data;
                return [
                  `Nome: ${d.name}`,
                  `Variação Dia: ${d.daily}`,
                  `Variação Mês: ${d.monthly}`,
                  `Variação Ano: ${d.yearly}`,
                  `Delta Volume: ${d.delta_volume}`
                ];
              }
            }
          }
        }
      }
    });
  }

  renderChart(ticker) {
    if (!ticker) return;
    const containerId = "tradingview_chart_spa";
    const container = this.$(containerId);
    if (!container) return;

    container.innerHTML = "";

    if (typeof TradingView !== "undefined") {
      new TradingView.widget({
        "autosize": true,
        "symbol": "BMFBOVESPA:" + ticker,
        "interval": "D",
        "timezone": "America/Sao_Paulo",
        "theme": "dark",
        "style": "1",
        "locale": "br",
        "enable_publishing": false,
        "hide_side_toolbar": false,
        "allow_symbol_change": false,
        "container_id": containerId,
            "studies": [
            "STD;Bollinger_Bands",
            "STD;MACD",
            "STD;Divergence%1Indicator",
            "STD;Stochastic_RSI"
            ]
      });
    } else {
      container.innerHTML = '<p class="empty-state">Erro ao carregar o TradingView. Verifique sua conexão.</p>';
    }
  }

  toast(message, type = 'info') {
    const container = this.$('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3800);
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.app = new B3App();
});

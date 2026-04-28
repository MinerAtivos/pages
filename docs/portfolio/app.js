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
    this.GAS_URL = "https://script.google.com/macros/s/AKfycbxJtX1FkpmSw-y1MB3B3OUBzFTdB-7AhYMJK8kryYm0IogCVHzv3bt3K-t6XYUZrBw/exec";

    this.portfolio = { name: 'Meu Portfólio', positions: [] };
    this.user = null; // { username: '...' } if logged in
    this.assets = [];
    this.marketData = null;
    this.marketNews = null;
    this.analysis = null;
    this.charts = {};
    this.isDiscoveryMode = false;
    this.currentPage = 'dashboard';
    this.init();
  }

  /* ------------------------------------------------------------------
     Initialisation
  ------------------------------------------------------------------ */
  async init() {
    this.bindUI();
    this.setupNavigation();
    this.setupModal();
    this.setupAuth();

    await this.checkAuthStatus();
    await this.loadMarketData();
    await this.loadMarketNews();
    await this.loadMarketSummary();
    await this.loadAssets();
    await this.loadPortfolio();
    await this.runAnalysis();

    this.renderPositions();
  }

  bindUI() {
    // Buttons
    this.$('btnAddPosition').addEventListener('click', () => this.openModal());
    this.$('btnAnalyze').addEventListener('click', () => this.runAnalysis());
    this.$('btnRunBarsi').addEventListener('click', () => this.runBarsi());
    this.$('btnRunRebalance').addEventListener('click', () => this.runRebalance());
    this.$('btnAddBulk').addEventListener('click', () => this.openBulkModal());

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

    // Membership modal
    this.$('membershipModalClose').addEventListener('click', () => this.closeMembershipModal());
    this.$('membershipModalOverlay').addEventListener('click', e => {
      if (e.target === this.$('membershipModalOverlay')) this.closeMembershipModal();
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

  $(id) { return document.getElementById(id); }

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

    // Protection for dividends page
    if (name === 'dividends' && !this.user) {
      this.toast('Acesse sua conta para ver esta seção exclusiva', 'warning');
      this.showPage('members');
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
            action: 'status',
            username: user.username,
            session_token: user.session_token
          })
        });
        const data = await res.json();
        if (data.logged_in) {
          this.user = { ...user, is_admin: !!data.is_admin };
          this.updateAuthUI(data);
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

      // News area
      if (this.$('newsGuestTip')) this.$('newsGuestTip').classList.add('hidden');

      // Admin Panel
      if (this.user.is_admin) {
        this.$('adminPanel').classList.remove('hidden');
        this.$('adminPanel').style.display = 'block';
        // O gerenciamento de usuários é feito diretamente no sistema.
        // Ocultamos a lista de usuários para simplificar.
        this.$('adminUsersTableCard').style.display = 'none';
      } else {
        this.$('adminPanel').classList.add('hidden');
      }
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

      // News area
      if (this.$('newsGuestTip')) this.$('newsGuestTip').classList.remove('hidden');

      if (this.currentPage === 'dividends') this.showPage('dashboard');
    }
  }

  /* ------------------------------------------------------------------
     Admin Panel
  ------------------------------------------------------------------ */
  async adminLoadUsers() {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Não autorizado');
      const users = await res.json();
      const tbody = this.$('adminUsersBody');
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${u.username}</td>
          <td>${u.is_admin ? 'Admin' : 'Usuário'}</td>
          <td>
            <button class="btn-danger-sm" onclick="app.adminDeleteUser(${u.id})">Excluir</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.warn('Erro ao carregar usuários:', err);
    }
  }

  async adminAddUser() {
    const username = prompt('Nome de usuário:');
    if (username === null) return;
    if (!username.trim()) { this.toast('Nome de usuário é obrigatório', 'error'); return; }

    const password = prompt('Senha:');
    if (password === null) return;
    if (!password.trim()) { this.toast('Senha é obrigatória', 'error'); return; }

    const isAdmin = confirm('Deseja que este usuário seja administrador?');

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, is_admin: isAdmin })
      });
      const data = await res.json();
      if (res.ok) {
        this.toast(data.message, 'success');
        this.adminLoadUsers();
      } else {
        this.toast(data.error, 'error');
      }
    } catch (err) {
      this.toast('Erro ao criar usuário', 'error');
    }
  }

  async adminDeleteUser(userId) {
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        this.toast(data.message, 'info');
        this.adminLoadUsers();
      } else {
        this.toast(data.error, 'error');
      }
    } catch (err) {
      this.toast('Erro ao excluir usuário', 'error');
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

    // Bulk Modal
    this.$('bulkModalClose').addEventListener('click', () => this.closeBulkModal());
    this.$('bulkModalCancel').addEventListener('click', () => this.closeBulkModal());
    this.$('btnBulkAddRow').addEventListener('click', () => this.addBulkRow());
    this.$('btnBulkSave').addEventListener('click', () => this.saveBulkPositions());
    this.$('bulkModalOverlay').addEventListener('click', e => {
      if (e.target === this.$('bulkModalOverlay')) this.closeBulkModal();
    });
  }

  openModal(editIndex = null) {
    // Limit check for non-members
    if (!this.user && editIndex === null) {
      const uniqueTickers = new Set(this.portfolio.positions.map(p => p.ticker));
      if (uniqueTickers.size >= 5) {
        this.openMembershipModal();
        return;
      }
    }

    this.editIndex = editIndex;
    this.$('modalTitle').textContent = editIndex !== null ? 'Editar Registro' : 'Adicionar Ativo';

    // Ensure datalist is populated (fallback)
    if (this.$('assetList').children.length === 0 && this.assets.length > 0) {
      this.populateAssetDatalist();
    }

    const tickerInput = this.$('posTicker');
    tickerInput.value = '';
    this.$('tickerWarning').style.display = 'none';

    if (editIndex !== null && this.portfolio.positions[editIndex]) {
      const pos = this.portfolio.positions[editIndex];
      tickerInput.value = pos.ticker;
      this.$('posQty').value = pos.quantity;
      this.$('posPrice').value = pos.purchase_price;
      this.$('posDate').value = pos.purchase_date || new Date().toISOString().slice(0, 10);
    } else {
      this.$('posQty').value = '';
      this.$('posPrice').value = '';
      this.$('posDate').value = new Date().toISOString().slice(0, 10);
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

  openMembershipModal() {
    this.$('membershipModalOverlay').classList.add('show');
  }

  closeMembershipModal() {
    this.$('membershipModalOverlay').classList.remove('show');
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
        this.closeMembershipModal();
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
        this.openMembershipModal();
        return;
      }
    }

    for (const row of rows) {
      const ticker = row.querySelector('.bulk-ticker').value;
      const qty = parseInt(row.querySelector('.bulk-qty').value, 10);
      const price = parseFloat(row.querySelector('.bulk-price').value);
      const date = row.querySelector('.bulk-date').value;

      if (ticker && !isNaN(qty) && !isNaN(price)) {
        newPositions.push({
          ticker,
          quantity: qty,
          purchase_price: price,
          purchase_date: date || new Date().toISOString().slice(0, 10)
        });
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
  async loadMarketData() {
    try {
      // 1. Carregar manifest para saber quais arquivos existem
      const manifestUrl = `./data/manifest.json?t=${new Date().getTime()}`;
      const manifestRes = await fetch(manifestUrl);

      let files = ['market_data.json']; // Fallback
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        files = manifest.market_data_files || files;
      }

      console.log('Arquivos de mercado detectados:', files);

      // 2. Carregar todos os arquivos em paralelo
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
      this.marketData = this.mergeMarketData(dataList);
      console.log('Dados de mercado carregados e mesclados com sucesso');
    } catch (err) {
      console.error('Erro ao carregar dados de mercado:', err);
      this.toast('Erro ao carregar dados históricos: ' + err.message, 'error');
    }
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

    const grid = this.$('newsAssetsGrid');
    grid.innerHTML = '';

    // Sanitization helper
    const escapeHTML = (str) => {
      if (!str) return '';
      return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[m]));
    };

    const assets = Object.keys(this.marketNews.assets);
    const movers = this.marketNews.market_movers || [];

    assets.forEach(ticker => {
      // Logic: If guest, only show market movers. If member, show all processed (which includes their portfolio)
      const isMover = movers.includes(ticker);
      if (!this.user && !isMover) return;

      const data = this.marketNews.assets[ticker];
      const card = document.createElement('div');
      card.className = 'card glass news-card';
      card.innerHTML = `
        <div class="news-card-header">
          <span class="news-card-ticker">${escapeHTML(ticker.replace('.SA', ''))}</span>
          <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(data.updated_at).toLocaleDateString('pt-BR')}</span>
        </div>
        <div class="news-card-summary">${escapeHTML(data.summary)}</div>
        <button class="btn btn-outline btn-sm" onclick="app.showAssetNews('${escapeHTML(ticker)}')" style="margin-top:auto">Ver Mais</button>
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
    this.$('newsModalTickerName').textContent = ticker; // Fallback to ticker since full name isn't in news.json

    let dateStr = `Atualizado em ${new Date(data.updated_at).toLocaleString('pt-BR')}`;
    if (data.period) {
      dateStr += ` | Notícias: ${data.period}`;
    }
    this.$('newsModalUpdateDate').textContent = dateStr;

    this.$('newsModalText').textContent = data.summary;

    const sourcesDiv = this.$('newsModalSources');
    sourcesDiv.innerHTML = '';
    if (data.sources && data.sources.length > 0) {
      const title = document.createElement('div');
      title.style.fontWeight = '600';
      title.style.marginBottom = '0.5rem';
      title.style.color = 'var(--text-muted)';
      title.textContent = 'Fontes consultadas:';
      sourcesDiv.appendChild(title);

      data.sources.forEach((link, idx) => {
        const a = document.createElement('a');
        a.href = link;
        a.target = '_blank';
        a.style.display = 'block';
        a.style.color = 'var(--accent-primary)';
        a.style.textDecoration = 'none';
        a.style.marginBottom = '0.25rem';
        try {
          const domain = new URL(link).hostname.replace('www.', '');
          a.textContent = `[${idx + 1}] ${domain}`;
        } catch {
          a.textContent = `[${idx + 1}] Fonte externa`;
        }
        sourcesDiv.appendChild(a);
      });
    }

    this.$('newsModalOverlay').classList.add('show');
  }

  closeNewsModal() {
    this.$('newsModalOverlay').classList.remove('show');
  }

  async loadMarketSummary() {
    try {
      const url = `./data/market_summary.json?t=${new Date().getTime()}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const summary = await res.json();
      this.renderMarketSummary(summary);

      if (summary.all_assets) {
        this.renderMarketTreemap(summary.all_assets);
      }
    } catch (err) {
      console.warn('Resumo de mercado não disponível');
    }
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
    if (!datalist) return;
    datalist.innerHTML = '';
    this.assets.forEach(a => {
      const option = document.createElement('option');
      option.value = a.ticker;
      option.textContent = `${a.ticker} — ${a.name}`;
      datalist.appendChild(option);
    });
  }

  async loadPortfolio() {
    if (this.user) {
      const serverData = await this.loadPortfolioFromServer();
      if (serverData && !serverData.error) {
        this.portfolio = serverData;
        return;
      }
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

    this.portfolio.positions.forEach((pos, index) => {
      if (!consolidated[pos.ticker]) {
        consolidated[pos.ticker] = {
          ticker: pos.ticker,
          totalQty: 0,
          totalInvested: 0,
          weightedDateSum: 0,
          transactions: []
        };
      }

      const tickerData = consolidated[pos.ticker];
      const qty = pos.quantity;
      const price = pos.purchase_price;
      const dateStr = pos.purchase_date || new Date().toISOString().slice(0, 10);
      const date = new Date(dateStr);
      const timestamp = date.getTime();

      tickerData.totalQty += qty;
      tickerData.totalInvested += (qty * price);
      tickerData.weightedDateSum += (timestamp * qty);
      tickerData.transactions.push({ ...pos, originalIndex: index, purchase_date: dateStr });
    });

    return Object.values(consolidated).map(item => {
      const avgPrice = item.totalInvested / item.totalQty;
      const avgTimestamp = item.weightedDateSum / item.totalQty;
      const avgDate = new Date(avgTimestamp).toISOString().slice(0, 10);

      return {
        ...item,
        avgPrice: avgPrice,
        avgDate: avgDate
      };
    });
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
  async savePosition() {
    let ticker = this.$('posTicker').value.toUpperCase();
    if (ticker && !ticker.endsWith('.SA')) {
      const found = this.assets.find(a => a.ticker === ticker + '.SA');
      if (found) ticker = ticker + '.SA';
    }
    const qty = parseInt(this.$('posQty').value, 10);
    const price = parseFloat(this.$('posPrice').value);
    const date = this.$('posDate').value;
    if (!ticker || !qty || !price) return;

    const pos = {
      ticker,
      quantity: qty,
      purchase_price: price,
      purchase_date: date || new Date().toISOString().slice(0, 10)
    };

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
          qtyOnDate += t.quantity;
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

    consolidated.forEach(item => {
      const asset = this.marketData.assets[item.ticker];
      if (!asset) return;

      const currentPrice = asset.last_price;
      const marketValue = currentPrice * item.totalQty;
      const investedValue = item.totalInvested;
      const totalProventos = this.getDividendsForTicker(item.ticker, item.transactions);
      const totalEquity = marketValue + totalProventos;

      // Nova Rentabilidade Real: (Valor Mercado + Total Proventos - Valor Investido) / Valor Investido
      const rentReal = investedValue > 0 ? ((totalEquity - investedValue) / investedValue * 100) : 0;

      // Rentabilidade do Ativo (Mercado): Ponderada pelas datas de compra
      // Para cada lote: (Preço Atual + Proventos do Lote / Preço na Data da Compra) - 1
      let weightedMarketRentSum = 0;
      item.transactions.forEach(t => {
        const histPrice = this.findCloseForDate(asset, t.purchase_date);
        const lotProventos = this.getDividendsForTicker(item.ticker, [t]);
        if (histPrice) {
          const lotInvested = histPrice * t.quantity;
          const lotMarketValue = currentPrice * t.quantity;
          const lotEquity = lotMarketValue + lotProventos;
          const lotRent = ((lotEquity - lotInvested) / lotInvested * 100);
          weightedMarketRentSum += (lotRent * t.quantity);
        } else {
          weightedMarketRentSum += (rentReal * t.quantity);
        }
      });
      const rentMarket = weightedMarketRentSum / item.totalQty;

      positions.push({
        ticker: item.ticker,
        name: asset.name,
        sector: asset.sector || 'N/A',
        quantity: item.totalQty,
        avgPrice: item.avgPrice,
        avgDate: item.avgDate,
        totalInvested: investedValue,
        current_price: currentPrice,
        position_value: marketValue,
        market_value: marketValue,
        total_proventos: totalProventos,
        total_equity: totalEquity,
        rentability_market: rentMarket,
        rentability_real: rentReal,
        volatility: asset.stats.volatility || 0
      });
      totalMarketValue += marketValue;
      totalInvestedValue += investedValue;
      totalDividendsValue += totalProventos;
    });

    const totalEquityValue = totalMarketValue + totalDividendsValue;

    const allocation = {};
    const allocationInvested = {};
    positions.forEach(p => {
      // Allocation based on Total Equity (Market + Dividends)
      allocation[p.ticker] = (p.total_equity / (totalEquityValue || 1) * 100);
      allocationInvested[p.ticker] = (p.totalInvested / (totalInvestedValue || 1) * 100);
    });

    const avgRent = positions.reduce((a, b) => a + (b.rentability_market || 0), 0) / (positions.length || 1);
    const avgVol = positions.reduce((a, b) => a + (b.volatility || 0), 0) / (positions.length || 1);
    const portfolioRentReal = totalInvestedValue > 0 ? ((totalEquityValue - totalInvestedValue) / totalInvestedValue * 100) : 0;

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
        num_positions: positions.length,
        avg_rentability: avgRent,
        portfolio_rentability_real: portfolioRentReal,
        portfolio_volatility: avgVol
      }
    };

    this.renderDashboard();
  }

  async runBarsi() {
    if (!this.portfolio.positions.length || !this.marketData) {
      this.toast('Adicione ativos ao portfólio primeiro', 'error');
      return;
    }

    const targetYield = parseFloat(this.$('barsiYield').value) || 6;
    this.$('barsiTargetDisplay').textContent = targetYield + '%';

    const analyses = [];
    const tickers = [...new Set(this.portfolio.positions.map(p => p.ticker))];

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
    if (!this.marketData) return;
    const tickers = [...new Set(this.portfolio.positions.map(p => p.ticker))];
    if (tickers.length < 2) {
      this.toast('Necessário pelo menos 2 ativos para otimização', 'error');
      return;
    }

    this.showLoading('Calculando alocação via Volatilidade Inversa...');

    // Estratégia: Volatilidade Inversa (Inverse Volatility Weighting)
    // Peso_i = (1 / Vol_i) / Sum(1 / Vol_j)

    const validAssets = tickers.map(t => this.marketData.assets[t]).filter(a => a && (a.stats.volatility || 0) > 0);

    if (validAssets.length === 0) {
      this.hideLoading();
      this.toast('Não há dados de volatilidade suficientes para os ativos selecionados.', 'warning');
      return;
    }

    const sumInverseVol = validAssets.reduce((acc, a) => acc + (1 / a.stats.volatility), 0);

    const weights = {};
    validAssets.forEach(a => {
      weights[a.ticker] = ((1 / a.stats.volatility) / sumInverseVol) * 100;
    });

    const portfolioMap = {};
    this.portfolio.positions.forEach(p => { portfolioMap[p.ticker] = (portfolioMap[p.ticker] || 0) + p.quantity; });

    const totalValue = validAssets.reduce((acc, a) => acc + (portfolioMap[a.ticker] || 0) * a.last_price, 0);

    const suggestions = [];
    validAssets.forEach(a => {
      const price = a.last_price;
      const curQty = portfolioMap[a.ticker] || 0;
      const curVal = curQty * price;
      const curPct = (curVal / totalValue * 100);
      const tgtPct = weights[a.ticker];
      const tgtVal = (tgtPct / 100) * totalValue;
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

    this.rebalanceResults = {
      optimal_allocation: {
        weights,
        expected_return: this.analysis?.summary.avg_rentability || 0,
        volatility: this.analysis?.summary.portfolio_volatility || 0,
        sharpe_ratio: (this.analysis?.summary.avg_rentability / this.analysis?.summary.portfolio_volatility) || 0
      },
      rebalancing_suggestions: suggestions
    };

    setTimeout(() => {
      this.renderRebalance();
      this.hideLoading();
      this.toast('Otimização concluída!', 'success');
    }, 500);
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
      this.$('statVolatility').textContent = '—';
      return;
    }

    const s = this.analysis.summary;
    this.$('statTotalValue').textContent = this.formatCurrency(s.total_value);
    this.$('statTotalInvested').textContent = this.formatCurrency(s.total_invested);
    this.$('statTotalProventos').textContent = this.formatCurrency(s.total_proventos);
    this.$('statPositions').textContent = s.num_positions;

    const rentRealEl = this.$('statRentabilityReal');
    rentRealEl.textContent = (s.portfolio_rentability_real > 0 ? '+' : '') + s.portfolio_rentability_real.toFixed(2) + '%';
    rentRealEl.className = 'stat-value ' + (s.portfolio_rentability_real >= 0 ? 'positive' : 'negative');

    this.$('statVolatility').textContent = s.portfolio_volatility.toFixed(2) + '%';

    this.renderAllocationChart();
    this.renderRentabilityChart();
  }

  renderAllocationChart() {
    if (!this.analysis || !this.analysis.positions.length) return;
    const ctx = this.$('allocationChart');
    if (this.charts.allocation) this.charts.allocation.destroy();

    const labels = this.analysis.positions.map(p => p.ticker.replace('.SA', ''));
    const currentValues = this.analysis.positions.map(p => p.total_equity);
    const investedValues = this.analysis.positions.map(p => p.totalInvested);
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
                return `${context.label} (${label}): R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
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

    const labels = this.analysis.positions.map(p => p.ticker.replace('.SA', ''));
    const marketValues = this.analysis.positions.map(p => p.rentability_market);
    const investorValues = this.analysis.positions.map(p => p.rentability_real);

    this.charts.rentability = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Rentab. Ativo (%)',
            data: marketValues,
            backgroundColor: '#6366f1',
            borderRadius: 4,
            barPercentage: 0.8,
            categoryPercentage: 0.7
          },
          {
            label: 'Minha Rentab. (%)',
            data: investorValues,
            backgroundColor: '#22c55e',
            borderRadius: 4,
            barPercentage: 0.8,
            categoryPercentage: 0.7
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: '#94a3b8', font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${(ctx.raw > 0 ? '+' : '') + ctx.raw.toFixed(2)}%`
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
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Nenhum ativo no portfólio. Clique em "Adicionar Ativo".</td></tr>';
      return;
    }

    let consolidated = this.consolidatePortfolio();
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
      if (sortBy === 'rentability') return (bn.rentability_real || 0) - (an.rentability_real || 0);
      return a.ticker.localeCompare(b.ticker);
    });

    let html = '';
    consolidated.forEach(item => {
      const a = analysisMap[item.ticker] || {};
      const rent = a.rentability_real;
      const rentClass = rent !== undefined ? (rent >= 0 ? 'positive' : 'negative') : '';
      const rentText = rent !== undefined ? ((rent > 0 ? '+' : '') + rent.toFixed(2) + '%') : '—';

      const aiButton = this.user ? `
        <button class="btn-ai-icon" onclick="app.showAssetNews('${item.ticker}')" title="Ver resumo IA">🤖</button>
      ` : '';

      html += `<tr>
        <td><strong>${item.ticker.replace('.SA', '')}</strong><br><small style="color:var(--text-muted)">${a.name || item.ticker}</small></td>
        <td>${item.totalQty}</td>
        <td>R$ ${item.avgPrice.toFixed(2)}</td>
        <td>${this.formatCurrency(item.totalInvested)}</td>
        <td>${a.current_price ? 'R$ ' + a.current_price.toFixed(2) : '—'}</td>
        <td>${a.market_value ? this.formatCurrency(a.market_value) : '—'}</td>
        <td class="positive">${a.total_proventos ? this.formatCurrency(a.total_proventos) : 'R$ 0,00'}</td>
        <td style="font-weight:700">${a.total_equity ? this.formatCurrency(a.total_equity) : '—'}</td>
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
      this.$('divStatYield').textContent = avgYield.toFixed(2) + '%';
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
        <td>${item.yield_period.toFixed(2)}%</td>
        <td>${this.isDiscoveryMode ? '—' : ((item.total_proventos / (totalProventos || 1)) * 100).toFixed(1) + '%'}</td>
      </tr>
    `).join('');
  }

  manageTransactions(ticker) {
    const tickerData = this.consolidatePortfolio().find(i => i.ticker === ticker);
    if (!tickerData) return;

    this.closeTransactionModal(); // Ensure old modal is removed

    let rows = '';
    tickerData.transactions.forEach(t => {
      rows += `
        <tr>
          <td>${t.purchase_date}</td>
          <td>${t.quantity}</td>
          <td>R$ ${t.purchase_price.toFixed(2)}</td>
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
        <td>R$ ${a.current_price.toFixed(2)}</td>
        <td>${a.price_ceiling !== null ? 'R$ ' + a.price_ceiling.toFixed(2) : '—'}</td>
        <td class="${marginClass}">${a.margin_of_safety > 0 ? '+' : ''}${a.margin_of_safety.toFixed(1)}%</td>
        <td>${a.current_yield.toFixed(2)}%</td>
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
    this.$('rebReturn').textContent = opt.expected_return.toFixed(2) + '%';
    this.$('rebVol').textContent = opt.volatility.toFixed(2) + '%';
    this.$('rebSharpe').textContent = opt.sharpe_ratio.toFixed(4);

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
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw.toFixed(2)}%` } },
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
        <td>R$ ${s.price.toFixed(2)}</td>
        <td>${this.formatCurrency(s.total_value)}</td>
        <td>${s.current_allocation.toFixed(1)}% → ${s.target_allocation.toFixed(1)}%</td>
      </tr>`;
    });
    tbody.innerHTML = html;
    this.$('suggestionsCard').style.display = 'block';
  }

  /* ------------------------------------------------------------------
     Rendering — Market Summary
     original com o nome do ativo na linha 1451: <td><strong>${item.ticker.replace('.SA', '')}</strong><br><small style="color:var(--text-muted)">${item.name}</small></td>
  ------------------------------------------------------------------ */
  renderMarketSummary(summary) {
    if (!summary || !summary.gainers || !summary.losers) return;

    this.$('summaryDateFull').textContent = `Dados atualizados em ${summary.date} (referente à coleta de ${summary.last_update.split('T')[0]})`;

    const renderRows = (data, isGainer) => {
      return data.map(item => {
        const deltaVal = item.daily_delta !== undefined ? item.daily_delta : item.delta;
        const delta = (deltaVal * 100).toFixed(2);
        const icon = isGainer ? '🚀' : '📉';
        const cssClass = isGainer ? 'var-up' : 'var-down';

        const volVal = item.delta_volume !== undefined ? item.delta_volume : 0;
        const volPct = (volVal * 100).toFixed(0);
        const volClass = volVal > 0 ? 'var-up' : 'var-down';
        const volIcon = volVal > 1 ? '⬆️😲' : '';

        return `
          <tr>
            <td><strong>${item.ticker.replace('.SA', '')}</strong></td>            
            <td>R$${item.last_close.toFixed(2)}</td>
            <td class="${cssClass}">${(deltaVal > 0 && isGainer) ? '+' : ''}${delta}% ${icon}</td>
            <td class="${volClass}">${volVal > 0 ? '+' : ''}${volPct}% ${volIcon}</td>
          </tr>
        `;
      }).join('');
    };

    this.$('gainersBody').innerHTML = renderRows(summary.gainers, true);
    this.$('losersBody').innerHTML = renderRows(summary.losers, false);
  }

  renderMarketTreemap(allAssets) {
    const ctx = this.$('marketTreemap');
    if (!ctx) return;
    if (this.charts.treemap) this.charts.treemap.destroy();

    console.log('Rendering Treemap with assets:', allAssets.length);

    // Filter and prepare data
    const validAssets = allAssets.filter(a => a.daily_delta !== undefined);

    const posPriceAssets = validAssets.filter(a => a.daily_delta > 0);
    const negPriceAssets = validAssets.filter(a => a.daily_delta < 0);

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

      if (a.daily_delta > 0) {
        category = getCategory(volAbs, posQuartiles);
        color = cores_positivas[category];
      } else if (a.daily_delta < 0) {
        category = getCategory(volAbs, negQuartiles);
        color = cores_negativas[category];
      }

      return {
        ticker: a.ticker.replace('.SA', ''),
        name: a.name,
        value: Math.max(Math.abs(a.daily_delta * 100), 0.5),
        daily: (a.daily_delta * 100).toFixed(2) + '%',
        monthly: (a.monthly_delta * 100).toFixed(2) + '%',
        delta_volume: (a.delta_volume * 100).toFixed(2) + '%',
        delta: a.daily_delta,
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
                  `Delta Volume: ${d.delta_volume}`
                ];
              }
            }
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     Utilities
  ------------------------------------------------------------------ */
  formatCurrency(v) {
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  $(id) { return document.getElementById(id); }

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

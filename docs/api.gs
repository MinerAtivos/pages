/*
  B3 Rebalanceamento & IA — Google Apps Script API
  Este script atua como o backend para o projeto hospedado no GitHub Pages.

  COMO INSTALAR:
  1. Crie uma nova Planilha Google (Google Sheet).
  2. No menu superior, vá em "Extensões" > "Apps Script".
  3. Apague todo o código existente e cole este conteúdo.
  4. Clique no ícone de disquete (Salvar) e dê o nome de "B3-Backend".
  5. Clique em "Implantar" > "Nova implantação".
  6. Selecione o tipo "App da Web".
  7. Em "Executar como", selecione "Eu".
  8. Em "Quem tem acesso", selecione "Qualquer pessoa" (isso é necessário para o GitHub Pages acessar).
  9. Clique em "Implantar", autorize o acesso e COPIE a "URL do app da Web".
  10. Cole essa URL no arquivo 'app.js' do seu projeto no GitHub.

  ESTRUTURA DA PLANILHA (Crie 3 abas com estes nomes):
  - Users: [id, username, password, is_admin]
  - Portfolios: [user_id, data, updated_at]
  - Leads: [email, timestamp]
*/

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doPost(e) {
  const result = processRequest(e);
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // O doGet é útil para testes simples, mas o app usará doPost para segurança de dados
  return ContentService.createTextOutput(JSON.stringify({ status: "API Online", message: "Use POST para interagir com a API." }))
    .setMimeType(ContentService.MimeType.JSON);
}

function processRequest(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return { error: "Dados inválidos" };
  }

  const action = data.action;

  if (action === "login") {
    return handleLogin(data.username, data.password);
  } else if (action === "add_lead") {
    return handleAddLead(data.email);
  } else if (action === "get_portfolio") {
    return handleGetPortfolio(data.username, data.session_token);
  } else if (action === "save_portfolio") {
    return handleSavePortfolio(data.username, data.session_token, data.portfolio);
  } else if (action === "update_password") {
    return handleUpdatePassword(data.username, data.old_password, data.new_password);
  } else if (action === "status") {
    return handleStatus(data.username, data.session_token);
  } else if (action === "get_all_tickers") {
    return handleGetAllTickers();
  }

  return { error: "Ação não reconhecida: " + action };
}

// --- Funções de Banco de Dados (Sheets) ---

function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function findUser(username) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();
  // Pular cabeçalho na linha 0
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === username) {
      return {
        id: data[i][0],
        username: data[i][1],
        password: data[i][2],
        is_admin: data[i][3] == 1 || data[i][3] === true || data[i][3] === "1"
      };
    }
  }
  return null;
}

// --- Handlers ---

function handleLogin(username, password) {
  const user = findUser(username);
  if (user && String(user.password) === String(password)) {
    // Para simplificar no GAS, usamos o próprio username como token básico (em produção usaríamos algo mais forte)
    const token = Utilities.base64Encode(username + ":" + new Date().getTime());
    return {
      success: true,
      username: user.username,
      is_admin: user.is_admin,
      session_token: token
    };
  }
  return { error: "Usuário ou senha inválidos" };
}

function handleStatus(username, token) {
  if (!username || !token) return { logged_in: false };
  const user = findUser(username);
  if (user) {
    return { logged_in: true, username: user.username, is_admin: user.is_admin };
  }
  return { logged_in: false };
}

function handleAddLead(email) {
  if (!email) return { error: "E-mail obrigatório" };
  const sheet = getSheet("Leads");
  sheet.appendRow([email, new Date().toISOString()]);
  return { success: true, message: "Lead cadastrado com sucesso" };
}

function handleGetPortfolio(username, token) {
  const user = findUser(username);
  if (!user) return { error: "Não autorizado" };

  const sheet = getSheet("Portfolios");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == user.id) {
      return JSON.parse(data[i][1]);
    }
  }
  return { name: "Meu Portfólio", positions: [], is_new: true };
}

function handleSavePortfolio(username, token, portfolio) {
  const user = findUser(username);
  if (!user) return { error: "Não autorizado" };

  const sheet = getSheet("Portfolios");
  const data = sheet.getDataRange().getValues();
  const portfolioStr = JSON.stringify(portfolio);
  const now = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == user.id) {
      sheet.getRange(i + 1, 2).setValue(portfolioStr);
      sheet.getRange(i + 1, 3).setValue(now);
      return { success: true };
    }
  }

  // Se não existir, adiciona novo
  sheet.appendRow([user.id, portfolioStr, now]);
  return { success: true };
}

function handleGetAllTickers() {
  const sheet = getSheet("Portfolios");
  const data = sheet.getDataRange().getValues();
  const tickers = new Set();
  for (let i = 1; i < data.length; i++) {
    try {
      const portfolio = JSON.parse(data[i][1]);
      if (portfolio.positions) {
        portfolio.positions.forEach(p => {
          if (p.ticker) tickers.add(p.ticker);
        });
      }
    } catch (e) {}
  }
  return { success: true, tickers: Array.from(tickers) };
}

function handleUpdatePassword(username, oldPassword, newPassword) {
  const sheet = getSheet("Users");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === username) {
      if (String(data[i][2]) === String(oldPassword)) {
        sheet.getRange(i + 1, 3).setValue(newPassword);
        return { success: true, message: "Senha alterada com sucesso!" };
      } else {
        return { error: "Senha atual incorreta." };
      }
    }
  }
  return { error: "Usuário não encontrado." };
}

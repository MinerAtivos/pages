# Configuração do Backend com Google Sheets 📊

Este projeto foi adaptado para funcionar de forma 100% estática (GitHub Pages), utilizando o **Google Sheets** como banco de dados através do **Google Apps Script**.

## 1. Preparação da Planilha

1. Crie uma nova [Planilha Google](https://sheets.new).
2. Renomeie as abas (páginas) da planilha para:
   - `Users`
   - `Portfolios`
   - `Leads`

### Estrutura das Abas (Cabeçalhos na Linha 1)

**Aba `Users`:**
| id | username | password | is_admin |
|---|---|---|---|
| 1 | admin | admin123 | 1 |
| 2 | lucas1 | senha123 | 0 |

**Aba `Portfolios`:**
| user_id | data | updated_at |
|---|---|---|
| (preenchido automaticamente) | (JSON do portfólio) | (data/hora) |

**Aba `Leads`:**
| email | timestamp |
|---|---|
| (preenchido automaticamente) | (data/hora) |

---

## 2. Instalação do Script (API)

1. Na sua planilha, vá em **Extensões > Apps Script**.
2. No editor que abrir, apague todo o código e cole o conteúdo do arquivo `docs/api.gs` deste repositório.
3. Clique no ícone de disquete (Salvar) e nomeie como `B3-Backend`.
4. Clique no botão azul **Implantar > Nova implantação**.
5. Selecione o tipo **App da Web**.
6. Configurações:
   - Descrição: `API B3 Rebalanceamento`
   - Executar como: `Eu`
   - Quem tem acesso: `Qualquer pessoa`
7. Clique em **Implantar**.
8. **Copie a URL do app da Web** gerada (algo como `https://script.google.com/macros/s/.../exec`).

> ⚠️ **IMPORTANTE:** Toda vez que você fizer uma alteração no código do Apps Script (como adicionar a função de trocar senha), você deve clicar em **Implantar > Gerenciar implantações**, clicar no ícone de lápis (Editar) e selecionar **"Nova Versão"** na lista suspensa de versão. Caso contrário, o Google continuará executando a versão antiga do seu código e você verá erros como "Ação não reconhecida".

---

## 3. Conexão com o Site

1. Abra o arquivo `app.js` na raiz do projeto.
2. Localize a variável `this.GAS_URL` no início do `constructor`.
3. Cole a URL que você copiou entre as aspas:
   ```javascript
   this.GAS_URL = "SUA_URL_AQUI";
   ```
4. Salve o arquivo e faça o commit/push para o GitHub.

---

## 4. Migração de Dados (Opcional)

Se você já tinha dados no banco de dados anterior, aqui estão os dados atuais para você copiar e colar na sua planilha:

### Dados para a aba `Users`:
- `1, admin, admin123, 1`
- `2, lucas1, senha123, 0`

*(Nota: As senhas originais estavam criptografadas. Para facilitar o seu gerenciamento direto na planilha, o novo sistema utiliza comparação de texto simples. Você pode definir as senhas que desejar diretamente na coluna 'password' da aba Users. Os usuários também podem alterar suas próprias senhas através da Área de Membros no site).*

### Dados para a aba `Portfolios`:
Você pode copiar o conteúdo JSON dos portfólios existentes se desejar, mas recomendamos que os usuários salvem novamente seus dados após o primeiro login no novo sistema para garantir a sincronização.

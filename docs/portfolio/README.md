# B3 Rebalanceamento & IA 📊🤖

Plataforma inteligente para análise e rebalanceamento de portfólios de investimentos na B3.

## 🚀 Funcionalidades

- **Dashboard:** Visão geral com gráficos de alocação e rentabilidade.
- **Automação:** Atualização diária automática de dados via GitHub Actions.
- **Posições:** Gestão completa do seu portfólio (Adição individual ou em lote).
- **Preço-Teto (Barsi):** Cálculo automático baseado em dividendos históricos (Método Barsi/Bazin).
- **Rebalanceamento:** Otimização de alocação baseada em Volatilidade Inversa (Inverse Volatility Weighting).
- **Dados Reais:** Integração com `yfinance` para cotações e dividendos atualizados.

## 📁 Estrutura do Projeto

- `server.py`: Servidor Flask (Backend API).
- `static/`: Frontend (HTML, CSS, JS).
- `scripts/`: Scripts Python auxiliares para coleta e análise de dados.
- `data/`: Armazenamento de cache e dados do portfólio.
- `docs/`: Documentação detalhada do projeto (veja [Cadastro de Ativos](docs/CADASTRO_ATIVOS.md)).

## 🛠️ Instalação e Execução Local

1.  **Instale as dependências:**
    ```bash
    pip install -r requirements.txt
    ```

2.  **Execute o servidor:**
    ```bash
    python server.py
    ```

3.  **Acesse no navegador:**
    `http://localhost:5000`

## 🐳 Execução via Docker

Para rodar em um ambiente de produção ou isolado:

1.  **Construa a imagem:**
    ```bash
    docker build -t b3-rebalanceamento .
    ```

2.  **Rode o container:**
    ```bash
    docker run -p 5000:5000 b3-rebalanceamento
    ```

## 🌐 Publicação / Deploy

Para expor a aplicação na internet:

1.  **PaaS (Heroku, Render, Railway):** Conecte seu repositório GitHub e use o `Dockerfile` ou configure o comando de inicialização como `gunicorn server:app`.
2.  **VPS (DigitalOcean, AWS, GCP):** Clone o repositório e use o `Dockerfile` com um proxy reverso (Nginx) para HTTPS.

## ⚠️ Aviso Legal

Este projeto é uma ferramenta educacional e não constitui recomendação de investimento.

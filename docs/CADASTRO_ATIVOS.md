# Cadastro de Ativos

Para adicionar novos ativos ao sistema, siga os passos abaixo:

1. Abra o arquivo `assets.json` na raiz do projeto.
2. Adicione um novo objeto à lista `assets` com o ticker desejado. Exemplo:
   ```json
   {
     "ticker": "BBAS3.SA",
     "name": "Banco do Brasil",
     "sector": "Financeiro"
   }
   ```
3. Salve o arquivo e faça o commit/push para o GitHub.
4. O GitHub Actions irá detectar a mudança e, na próxima execução agendada (ou via execução manual do workflow "Fetch Market Data"), os dados históricos para este novo ativo serão coletados e disponibilizados no sistema.

**Nota:** O ticker deve seguir o padrão do Yahoo Finance (ex: `.SA` para ativos da B3).

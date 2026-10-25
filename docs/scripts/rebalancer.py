#!/usr/bin/env python3
"""
Rebalancer - Cálculo de rebalanceamento usando Teoria de Markowitz
Otimiza alocação de ativos para máximo Sharpe Ratio
"""

import json
import os
from datetime import datetime
import numpy as np
import pandas as pd
from scipy.optimize import minimize

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
OUTPUT_FILE = os.path.join(DATA_DIR, 'rebalancing_recommendation.json')

class PortfolioRebalancer:
    """Rebalanceador de portfólio usando Markowitz"""
    
    def __init__(self, market_data_file, risk_free_rate=0.10):
        """
        Inicializa rebalanceador
        
        Args:
            market_data_file: Caminho para arquivo com dados de mercado
            risk_free_rate: Taxa livre de risco (default: 10% a.a. - CDI)
        """
        with open(market_data_file, 'r', encoding='utf-8') as f:
            self.market_data = json.load(f)
        self.risk_free_rate = risk_free_rate
    
    def get_returns_matrix(self, tickers, period_days=252):
        """
        Coleta matriz de retornos para cálculo de covariância
        
        Args:
            tickers: Lista de tickers
            period_days: Número de dias de histórico (default: 1 ano)
        
        Returns:
            tuple: (returns_matrix, expected_returns)
        """
        returns_dict = {}
        
        for ticker in tickers:
            if ticker not in self.market_data['assets']:
                continue
            
            hist_closes = np.array(self.market_data['assets'][ticker]['history']['closes'])
            
            # Usa últimos period_days
            if len(hist_closes) > period_days:
                hist_closes = hist_closes[-period_days:]
            
            # Calcula retornos diários
            returns = np.diff(hist_closes) / hist_closes[:-1]
            returns_dict[ticker] = returns
        
        if not returns_dict:
            return None, None
        
        # Alinha todos os retornos para o mesmo tamanho
        min_len = min(len(r) for r in returns_dict.values())
        returns_matrix = np.array([returns_dict[t][-min_len:] for t in tickers if t in returns_dict])
        
        # Retorno esperado anualizado (252 dias úteis)
        expected_returns = np.mean(returns_matrix, axis=1) * 252
        
        return returns_matrix, expected_returns
    
    def optimize_portfolio(self, tickers, target_return=None, constraints=None):
        """
        Otimiza portfólio para máximo Sharpe Ratio
        
        Args:
            tickers: Lista de tickers
            target_return: Retorno alvo (opcional)
            constraints: Restrições customizadas (opcional)
        
        Returns:
            dict: Pesos ótimos e métricas
        """
        returns_matrix, expected_returns = self.get_returns_matrix(tickers)
        
        if returns_matrix is None:
            return None
        
        # Matriz de covariância
        cov_matrix = np.cov(returns_matrix)
        
        n_assets = len(tickers)
        
        def portfolio_stats(weights):
            """Calcula retorno e volatilidade do portfólio"""
            ret = np.sum(expected_returns * weights)
            vol = np.sqrt(weights @ cov_matrix @ weights.T)
            sharpe = (ret - self.risk_free_rate) / vol if vol > 0 else 0
            return ret, vol, sharpe
        
        def negative_sharpe(weights):
            """Retorna Sharpe negativo (para minimização)"""
            return -portfolio_stats(weights)[2]
        
        # Restrições
        constraints_list = [
            {'type': 'eq', 'fun': lambda w: np.sum(w) - 1}  # Soma dos pesos = 1
        ]
        
        if target_return is not None:
            constraints_list.append({
                'type': 'eq',
                'fun': lambda w: np.sum(expected_returns * w) - target_return
            })
        
        # Limites: cada ativo entre 0% e 100%
        bounds = tuple((0, 1) for _ in range(n_assets))
        
        # Chute inicial: pesos iguais
        x0 = np.array([1/n_assets] * n_assets)
        
        # Otimização
        result = minimize(
            negative_sharpe,
            x0,
            method='SLSQP',
            bounds=bounds,
            constraints=constraints_list
        )
        
        if not result.success:
            print(f"⚠️  Otimização não convergiu: {result.message}")
            return None
        
        optimal_weights = result.x
        opt_return, opt_vol, opt_sharpe = portfolio_stats(optimal_weights)
        
        return {
            'tickers': tickers,
            'weights': {t: round(w * 100, 2) for t, w in zip(tickers, optimal_weights)},
            'expected_return': round(opt_return * 100, 2),
            'volatility': round(opt_vol * 100, 2),
            'sharpe_ratio': round(opt_sharpe, 4),
            'risk_free_rate': round(self.risk_free_rate * 100, 2),
        }
    
    def suggest_rebalancing(self, current_portfolio, target_portfolio):
        \"\"\"\n        Sugere rebalanceamento comparando portfólio atual com alvo\n        \n        Args:\n            current_portfolio: dict {ticker: quantidade}\n            target_portfolio: dict {ticker: percentual alvo}\n        \n        Returns:\n            list: Sugestões de compra/venda\n        \"\"\"\n        suggestions = []\n        \n        # Calcula valor total\n        total_value = sum(\n            current_portfolio.get(t, 0) * self.market_data['assets'][t]['last_price']\n            for t in target_portfolio.keys()\n            if t in self.market_data['assets']\n        )\n        \n        for ticker, target_pct in target_portfolio.items():\n            if ticker not in self.market_data['assets']:\n                continue\n            \n            price = self.market_data['assets'][ticker]['last_price']\n            current_qty = current_portfolio.get(ticker, 0)\n            current_value = current_qty * price\n            current_pct = (current_value / total_value * 100) if total_value > 0 else 0\n            \n            target_value = (target_pct / 100) * total_value\n            target_qty = int(target_value / price)\n            \n            diff_qty = target_qty - current_qty\n            diff_pct = target_pct - current_pct\n            \n            if abs(diff_qty) > 0:\n                action = 'Aumentar' if diff_qty > 0 else 'Diminuir'\n                suggestions.append({\n                    'ticker': ticker,\n                    'name': self.market_data['assets'][ticker]['name'],\n                    'action': action,\n                    'quantity': abs(diff_qty),\n                    'current_allocation': round(current_pct, 2),\n                    'target_allocation': target_pct,\n                    'difference': round(diff_pct, 2),\n                    'price': round(price, 2),\n                    'total_value': round(abs(diff_qty) * price, 2),\n                })\n        \n        return sorted(suggestions, key=lambda x: abs(x['difference']), reverse=True)\n\ndef main():\n    \"\"\"Função principal - exemplo de uso\"\"\"\n    market_data_file = os.path.join(DATA_DIR, 'market_data.json')\n    \n    if not os.path.exists(market_data_file):\n        print(\"⚠️  Arquivo de dados de mercado não encontrado.\")\n        print(\"   Execute primeiro: python scripts/data_fetcher.py\")\n        return\n    \n    # Tickers para otimização\n    tickers = [\n        'PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA'\n    ]\n    \n    rebalancer = PortfolioRebalancer(market_data_file)\n    \n    # Otimiza portfólio\n    print(\"\\n\" + \"=\"*60)\n    print(\"Otimização de Portfólio - Teoria de Markowitz\")\n    print(\"=\"*60 + \"\\n\")\n    \n    optimal = rebalancer.optimize_portfolio(tickers)\n    \n    if optimal:\n        print(\"Alocação Ótima:\")\n        for ticker, weight in optimal['weights'].items():\n            print(f\"  {ticker}: {weight}%\")\n        \n        print(f\"\\nRetorno Esperado: {optimal['expected_return']}%\")\n        print(f\"Volatilidade: {optimal['volatility']}%\")\n        print(f\"Sharpe Ratio: {optimal['sharpe_ratio']}\")\n        \n        # Sugestão de rebalanceamento\n        current = {'PETR4.SA': 100, 'VALE3.SA': 50, 'ITUB4.SA': 75, 'BBDC4.SA': 40, 'ABEV3.SA': 200}\n        suggestions = rebalancer.suggest_rebalancing(current, optimal['weights'])\n        \n        print(f\"\\n{'='*60}\")\n        print(\"Sugestões de Rebalanceamento\")\n        print(f\"{'='*60}\\n\")\n        \n        for sugg in suggestions:\n            print(f\"{sugg['action']:8} {sugg['quantity']:4} {sugg['ticker']:10} \"\n                  f\"(R$ {sugg['total_value']:>10,.2f}) - \"\n                  f\"Aloc: {sugg['current_allocation']:>5.1f}% → {sugg['target_allocation']:>5.1f}%\")\n        \n        # Salva recomendação\n        recommendation = {\n            'timestamp': datetime.now().isoformat(),\n            'optimal_allocation': optimal,\n            'rebalancing_suggestions': suggestions,\n        }\n        \n        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)\n        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:\n            json.dump(recommendation, f, indent=2, ensure_ascii=False)\n        \n        print(f\"\\n✓ Recomendação salva em: {OUTPUT_FILE}\")\n\nif __name__ == '__main__':\n    main()

#!/usr/bin/env python3
"""
Portfolio Analyzer - Análise de portfólio do usuário
Calcula rentabilidade, alocação e métricas de risco
"""

import json
import os
from datetime import datetime
import numpy as np
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
OUTPUT_FILE = os.path.join(DATA_DIR, 'portfolio_analysis.json')

class PortfolioAnalyzer:
    """Analisador de portfólio"""
    
    def __init__(self, market_data_file):
        """
        Inicializa analisador
        
        Args:
            market_data_file: Caminho para arquivo com dados de mercado
        """
        with open(market_data_file, 'r', encoding='utf-8') as f:
            self.market_data = json.load(f)
    
    def analyze_portfolio(self, portfolio):
        """
        Analisa um portfólio do usuário
        
        Args:
            portfolio: dict com estrutura {ticker: quantidade}
        
        Returns:
            dict: Análise completa do portfólio
        """
        analysis = {
            'timestamp': datetime.now().isoformat(),
            'positions': [],
            'summary': {},
            'allocation': {},
        }
        
        total_value = 0
        prices = {}
        
        # Processa cada posição
        for ticker, quantity in portfolio.items():
            if ticker not in self.market_data['assets']:
                print(f"⚠️  Ativo {ticker} não encontrado nos dados de mercado")
                continue
            
            asset_data = self.market_data['assets'][ticker]
            current_price = asset_data['last_price']
            position_value = current_price * quantity
            
            # Calcula rentabilidade (exemplo: comparando com média de 1 ano)
            hist_closes = np.array(asset_data['history']['closes'])
            avg_price_1y = np.mean(hist_closes[-252:]) if len(hist_closes) >= 252 else np.mean(hist_closes)
            
            rentability = ((current_price - avg_price_1y) / avg_price_1y * 100) if avg_price_1y > 0 else 0
            
            position = {
                'ticker': ticker,
                'name': asset_data['name'],
                'quantity': quantity,
                'current_price': round(current_price, 2),
                'position_value': round(position_value, 2),
                'rentability_1y': round(rentability, 2),
                'sector': asset_data['sector'],
                'volatility': round(asset_data['stats']['volatility'], 2),
            }
            
            analysis['positions'].append(position)
            total_value += position_value
            prices[ticker] = current_price
        
        # Calcula alocação
        for position in analysis['positions']:
            allocation_pct = (position['position_value'] / total_value * 100) if total_value > 0 else 0
            analysis['allocation'][position['ticker']] = round(allocation_pct, 2)
        
        # Resumo
        analysis['summary'] = {
            'total_value': round(total_value, 2),
            'num_positions': len(analysis['positions']),
            'avg_rentability': round(
                np.mean([p['rentability_1y'] for p in analysis['positions']]) if analysis['positions'] else 0,
                2
            ),
            'portfolio_volatility': self._calculate_portfolio_volatility(portfolio),
        }
        
        return analysis
    
    def _calculate_portfolio_volatility(self, portfolio):
        """Calcula volatilidade do portfólio"""
        try:
            tickers = list(portfolio.keys())
            if len(tickers) < 2:
                return 0
            
            # Coleta retornos históricos
            returns_data = {}
            for ticker in tickers:
                if ticker in self.market_data['assets']:
                    hist_closes = np.array(self.market_data['assets'][ticker]['history']['closes'])
                    returns = np.diff(hist_closes) / hist_closes[:-1]
                    returns_data[ticker] = returns
            
            if len(returns_data) < 2:
                return 0
            
            # Cria matriz de retornos
            min_len = min(len(r) for r in returns_data.values())
            returns_matrix = np.array([returns_data[t][-min_len:] for t in tickers])
            
            # Calcula matriz de covariância
            cov_matrix = np.cov(returns_matrix)
            
            # Calcula pesos
            total_value = sum(
                portfolio[t] * self.market_data['assets'][t]['last_price']
                for t in tickers if t in self.market_data['assets']
            )
            
            weights = np.array([
                (portfolio[t] * self.market_data['assets'][t]['last_price']) / total_value
                for t in tickers if t in self.market_data['assets']
            ])
            
            # Volatilidade do portfólio
            portfolio_var = weights @ cov_matrix @ weights.T
            portfolio_vol = np.sqrt(portfolio_var) * 100
            
            return round(portfolio_vol, 2)
        except Exception as e:
            print(f"Erro ao calcular volatilidade: {e}")
            return 0
    
    def get_sector_allocation(self, portfolio):
        """Calcula alocação por setor"""
        sector_allocation = {}
        total_value = 0
        
        for ticker, quantity in portfolio.items():
            if ticker in self.market_data['assets']:
                asset_data = self.market_data['assets'][ticker]
                position_value = asset_data['last_price'] * quantity
                sector = asset_data['sector']
                
                if sector not in sector_allocation:
                    sector_allocation[sector] = 0
                sector_allocation[sector] += position_value
                total_value += position_value
        
        # Converte para percentuais
        for sector in sector_allocation:
            sector_allocation[sector] = round(
                (sector_allocation[sector] / total_value * 100) if total_value > 0 else 0,
                2
            )
        
        return sector_allocation

def main():
    """Função principal - exemplo de uso"""
    market_data_file = os.path.join(DATA_DIR, 'market_data.json')
    
    if not os.path.exists(market_data_file):
        print("⚠️  Arquivo de dados de mercado não encontrado.")
        print("   Execute primeiro: python scripts/data_fetcher.py")
        return
    
    # Exemplo de portfólio
    example_portfolio = {
        'PETR4.SA': 100,
        'VALE3.SA': 50,
        'ITUB4.SA': 75,
        'ABEV3.SA': 200,
        'WEGE3.SA': 30,
    }
    
    analyzer = PortfolioAnalyzer(market_data_file)
    analysis = analyzer.analyze_portfolio(example_portfolio)
    sector_alloc = analyzer.get_sector_allocation(example_portfolio)
    
    analysis['sector_allocation'] = sector_alloc
    
    # Salva análise
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(analysis, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Análise salva em: {OUTPUT_FILE}")
    print(f"\nResumo do Portfólio:")
    print(f"  Valor Total: R$ {analysis['summary']['total_value']:,.2f}")
    print(f"  Posições: {analysis['summary']['num_positions']}")
    print(f"  Rentabilidade Média: {analysis['summary']['avg_rentability']:.2f}%")
    print(f"  Volatilidade: {analysis['summary']['portfolio_volatility']:.2f}%")

if __name__ == '__main__':
    main()

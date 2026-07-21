#!/usr/bin/env python3
"""
Financials Fetcher - Coleta demonstrativos financeiros estruturados e estatísticas do Yahoo Finance
via yfinance (.income_stmt, .balance_sheet, .cashflow, .info) para os ativos do usuário e os principais pares.
Mapeia setores e segmentos usando o arquivo docs/portfolio/assets.json.
Gera o arquivo: docs/portfolio/data/market_financials.json
"""

import json
import os
import math
import sys
import concurrent.futures
from datetime import datetime
import yfinance as yf
import pandas as pd

# Configurações de caminhos
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
ASSETS_FILE = os.path.join(os.path.dirname(__file__), '..', 'assets.json')
PORTFOLIO_ANALYSIS_FILE = os.path.join(DATA_DIR, 'portfolio_analysis.json')
OUTPUT_FILE = os.path.join(DATA_DIR, 'market_financials.json')

def load_portfolio_and_peers():
    """
    Carrega a lista de ativos de assets.json.
    Filtra os setores correspondentes às posições atuais do portfólio para evitar
    baixar todos os 496 ativos (o que levaria muito tempo), mantendo a execução rápida e focada.
    """
    # 1. Carrega o assets.json completo
    if not os.path.exists(ASSETS_FILE):
        print(f"❌ Arquivo de ativos {ASSETS_FILE} não encontrado.")
        sys.exit(1)

    with open(ASSETS_FILE, 'r', encoding='utf-8') as f:
        assets_data = json.load(f)
        all_assets = assets_data.get('assets', [])

    # Cria mapa de ticker -> meta
    asset_map = {a['ticker']: a for a in all_assets if 'ticker' in a}

    # 2. Carrega as posições do usuário
    user_tickers = []
    if os.path.exists(PORTFOLIO_ANALYSIS_FILE):
        try:
            with open(PORTFOLIO_ANALYSIS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                user_tickers = [p['ticker'] for p in data.get('positions', []) if 'ticker' in p]
        except Exception as e:
            print(f"⚠️ Erro ao ler {PORTFOLIO_ANALYSIS_FILE}: {e}")

    # Fallback se o portfólio estiver vazio
    if not user_tickers:
        user_tickers = ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA', 'WEGE3.SA']

    # 3. Identifica os setores dessas posições no assets.json
    user_sectors = set()
    for ticker in user_tickers:
        if ticker in asset_map:
            user_sectors.add(asset_map[ticker]['sector'])
        else:
            # Se não achar com sufixo ou sem, tenta limpar
            t_clean = ticker.split('.')[0]
            for asset_t, asset_val in asset_map.items():
                if asset_t.startswith(t_clean):
                    user_sectors.add(asset_val['sector'])
                    break

    print(f"Setores do portfólio do usuário: {list(user_sectors)}")

    # 4. Seleciona todos os ativos de assets.json desses mesmos setores para servirem como pares de comparação
    selected_assets = []
    for asset in all_assets:
        if asset.get('sector') in user_sectors:
            selected_assets.append(asset)

    # Garante que as posições originais do usuário estejam na lista (caso alguma não estivesse nos setores acima)
    for ticker in user_tickers:
        if ticker in asset_map and asset_map[ticker] not in selected_assets:
            selected_assets.append(asset_map[ticker])

    print(f"Selecionados {len(selected_assets)} ativos de assets.json para comparação e download.")
    return selected_assets

def safe_float(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        if math.isnan(val) or math.isinf(val):
            return None
        return float(val)
    return None

def clean_series(df, row_name):
    """Extrai uma linha do dataframe do yfinance convertendo timestamps de colunas para strings YYYY."""
    if df is None or df.empty:
        return {}

    row_name_normalized = str(row_name).lower().replace(" ", "").strip()
    matched_idx = None
    for idx in df.index:
        idx_normalized = str(idx).lower().replace(" ", "").strip()
        if idx_normalized == row_name_normalized:
            matched_idx = idx
            break

    if matched_idx is None:
        return {}

    row = df.loc[matched_idx]
    res = {}
    if isinstance(row, pd.Series):
        for col, val in row.items():
            if hasattr(col, 'strftime'):
                year_str = col.strftime('%Y')
            else:
                year_str = str(col)[:4]
            f_val = safe_float(val)
            if f_val is not None:
                res[year_str] = f_val
    return res

def fetch_ticker_financials(asset_meta):
    """Busca dados de demonstrativos e info para um ticker específico"""
    ticker = asset_meta['ticker']
    name = asset_meta.get('name', ticker)
    sector_b3 = asset_meta.get('sector', 'N/A')
    description_b3 = asset_meta.get('description', 'N/A')

    print(f"Buscando {ticker} (Setor: {sector_b3} | Segmento: {description_b3})...")
    try:
        t = yf.Ticker(ticker)

        info = t.info or {}

        try:
            inc = t.get_income_stmt(as_dict=False)
        except Exception:
            inc = None

        try:
            bal = t.get_balance_sheet(as_dict=False)
        except Exception:
            bal = None

        try:
            cf = t.get_cashflow(as_dict=False)
        except Exception:
            try:
                cf = t.get_cash_flow(as_dict=False)
            except Exception:
                cf = None

        # Extrair séries históricas
        revenue = clean_series(inc, 'Total Revenue')
        opt_income = clean_series(inc, 'Operating Income')
        net_income = clean_series(inc, 'Net Income')

        current_assets = clean_series(bal, 'Current Assets')
        current_liabilities = clean_series(bal, 'Current Liabilities')
        total_debt = clean_series(bal, 'Total Debt')
        equity = clean_series(bal, 'Common Stock Equity')
        if not equity:
            equity = clean_series(bal, 'Stockholders Equity')

        # Calcular margem operacional histórica
        opt_margin = {}
        for y, rev in revenue.items():
            if rev and rev > 0 and y in opt_income:
                opt_margin[y] = opt_income[y] / rev

        # Calcular liquidez corrente histórica
        current_liquidity = {}
        for y, ca in current_assets.items():
            if y in current_liabilities and current_liabilities[y] and current_liabilities[y] > 0:
                current_liquidity[y] = ca / current_liabilities[y]

        # Calcular dívida sobre patrimônio líquido histórica
        debt_to_equity = {}
        for y, d in total_debt.items():
            if y in equity and equity[y] and equity[y] > 0:
                debt_to_equity[y] = d / equity[y]

        # Sobrescreve as propriedades de setor/indústria com o assets.json do usuário
        stats = {
            'sector': sector_b3,
            'industry': description_b3,
            'market_cap': safe_float(info.get('marketCap')),
            'forward_pe': safe_float(info.get('forwardPE') or info.get('trailingPE')),
            'price_to_book': safe_float(info.get('priceToBook')),
            'dividend_yield': safe_float(info.get('dividendYield')),
            'ev_to_ebitda': safe_float(info.get('enterpriseToEbitda')),
            'roe': safe_float(info.get('returnOnEquity')),
            'profit_margin': safe_float(info.get('profitMargins')),
            'operating_margin_current': safe_float(info.get('operatingMargins')),
            'debt_to_equity_current': safe_float(info.get('debtToEquity'))
        }

        historical = {
            'revenue': revenue,
            'operating_income': opt_income,
            'operating_margin': opt_margin,
            'current_liquidity': current_liquidity,
            'debt_to_equity': debt_to_equity,
            'net_income': net_income,
            'equity': equity
        }

        return {
            'ticker': ticker,
            'name': name,
            'stats': stats,
            'historical': historical
        }

    except Exception as e:
        print(f"❌ Erro ao coletar demonstrativos de {ticker}: {e}")
        return None

def calculate_industry_averages(assets_data):
    """
    Calcula médias simples por sector e por description (industry) para cada indicador
    tanto atual (stats) quanto histórico usando os campos mapeados do assets.json.
    """
    industry_stats = {}
    sector_stats = {}

    historical_keys = ['revenue', 'operating_margin', 'current_liquidity', 'debt_to_equity']
    stats_keys = ['forward_pe', 'price_to_book', 'dividend_yield', 'ev_to_ebitda', 'roe', 'profit_margin', 'operating_margin_current', 'debt_to_equity_current']

    # Coletar por indústria (description) e setor
    for ticker, data in assets_data.items():
        ind = data['stats']['industry']
        sec = data['stats']['sector']

        if ind and ind != 'N/A':
            if ind not in industry_stats:
                industry_stats[ind] = {'stats': {}, 'historical': {}}
            for k in stats_keys:
                val = data['stats'].get(k)
                if val is not None:
                    if k not in industry_stats[ind]['stats']:
                        industry_stats[ind]['stats'][k] = []
                    industry_stats[ind]['stats'][k].append(val)
            for hk in historical_keys:
                h_data = data['historical'].get(hk, {})
                for y, val in h_data.items():
                    if val is not None:
                        if hk not in industry_stats[ind]['historical']:
                            industry_stats[ind]['historical'][hk] = {}
                        if y not in industry_stats[ind]['historical'][hk]:
                            industry_stats[ind]['historical'][hk][y] = []
                        industry_stats[ind]['historical'][hk][y].append(val)

        if sec and sec != 'N/A':
            if sec not in sector_stats:
                sector_stats[sec] = {'stats': {}, 'historical': {}}
            for k in stats_keys:
                val = data['stats'].get(k)
                if val is not None:
                    if k not in sector_stats[sec]['stats']:
                        sector_stats[sec]['stats'][k] = []
                    sector_stats[sec]['stats'][k].append(val)
            for hk in historical_keys:
                h_data = data['historical'].get(hk, {})
                for y, val in h_data.items():
                    if val is not None:
                        if hk not in sector_stats[sec]['historical']:
                            sector_stats[sec]['historical'][hk] = {}
                        if y not in sector_stats[sec]['historical'][hk]:
                            sector_stats[sec]['historical'][hk][y] = []
                        sector_stats[sec]['historical'][hk][y].append(val)

    def average_list(lst):
        valid = [x for x in lst if x is not None and not math.isnan(x) and not math.isinf(x)]
        return sum(valid) / len(valid) if valid else None

    resolved_industry = {}
    resolved_sector = {}

    for ind, content in industry_stats.items():
        resolved_industry[ind] = {'stats': {}, 'historical': {}}
        for k, vals in content['stats'].items():
            resolved_industry[ind]['stats'][k] = average_list(vals)
        for hk, years_vals in content['historical'].items():
            resolved_industry[ind]['historical'][hk] = {}
            for y, vals in years_vals.items():
                resolved_industry[ind]['historical'][hk][y] = average_list(vals)

    for sec, content in sector_stats.items():
        resolved_sector[sec] = {'stats': {}, 'historical': {}}
        for k, vals in content['stats'].items():
            resolved_sector[sec]['stats'][k] = average_list(vals)
        for hk, years_vals in content['historical'].items():
            resolved_sector[sec]['historical'][hk] = {}
            for y, vals in years_vals.items():
                resolved_sector[sec]['historical'][hk][y] = average_list(vals)

    return resolved_industry, resolved_sector

def main():
    print("Iniciando coleta simplificada de dados fundamentalistas usando assets.json...")
    selected_assets = load_portfolio_and_peers()
    print(f"Total de {len(selected_assets)} ativos selecionados para processar.")

    assets_data = {}
    # Executa a coleta em paralelo usando ThreadPoolExecutor para alto desempenho (max 20 workers)
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        future_to_asset = {executor.submit(fetch_ticker_financials, asset): asset for asset in selected_assets}
        for future in concurrent.futures.as_completed(future_to_asset):
            asset = future_to_asset[future]
            try:
                res = future.result()
                if res:
                    assets_data[res['ticker']] = res
            except Exception as e:
                print(f"❌ Erro ao processar ticker {asset['ticker']}: {e}")

    print("Calculando médias de setor e indústria...")
    ind_avg, sec_avg = calculate_industry_averages(assets_data)

    output = {
        'last_update': datetime.now().isoformat(),
        'assets': assets_data,
        'industry_averages': ind_avg,
        'sector_averages': sec_avg
    }

    # Salva os dados limpos sem NaN ou Infinity
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✓ Coleta fundamentalista concluída com sucesso! Salvo em: {OUTPUT_FILE}")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Data Fetcher - Coleta dados de ativos B3 via yfinance
Executa coleta de histórico de preços e informações de dividendos
"""

import json
import os
import math
import argparse
import glob
from datetime import datetime, timedelta
import yfinance as yf
import pandas as pd

# Configurações
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
ASSETS_FILE = os.path.join(os.path.dirname(__file__), '..', 'assets.json')
OUTPUT_FILE = os.path.join(DATA_DIR, 'market_data.json')
MANIFEST_FILE = os.path.join(DATA_DIR, 'manifest.json')
CACHE_DIR = os.path.join(DATA_DIR, 'cache')

# Ativos B3 populares para fallback
DEFAULT_ASSETS = [
    'PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA',
    'WEGE3.SA', 'JBSS3.SA', 'LREN3.SA', 'MGLU3.SA', 'ASAI3.SA'
]

def load_tickers():
    """Carrega lista de tickers do arquivo assets.json"""
    if os.path.exists(ASSETS_FILE):
        try:
            with open(ASSETS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                tickers = [a['ticker'] for a in data.get('assets', []) if 'ticker' in a]
                if tickers:
                    return tickers
        except Exception as e:
            print(f"⚠️ Erro ao ler {ASSETS_FILE}: {e}")
    return DEFAULT_ASSETS

def fetch_asset_data(ticker, period=None, start=None):
    """
    Coleta dados históricos de um ativo
    
    Args:
        ticker: Código do ativo (ex: PETR4.SA)
        period: Período de dados (ex: '2y', '5y', 'max')
        start: Data de início (YYYY-MM-DD)
    
    Returns:
        dict: Dados do ativo ou None se erro
    """
    try:
        if start:
            print(f"Coletando dados de {ticker} (desde: {start})...")
        else:
            print(f"Coletando dados de {ticker} (período: {period or '2y'})...")
        
        # Coleta dados históricos
        asset = yf.Ticker(ticker)
        if start:
            hist = asset.history(start=start)
        else:
            hist = asset.history(period=period or '2y')
        
        if hist.empty:
            print(f"  ⚠️  Nenhum dado encontrado para {ticker}")
            return None
        
        # Coleta informações gerais
        info = asset.info
        
        # Coleta histórico de dividendos
        dividends = asset.dividends
        
        # Prepara dados de retorno
        asset_data = {
            'ticker': ticker,
            'name': info.get('longName', ticker),
            'sector': info.get('sector', 'N/A'),
            'currency': info.get('currency', 'BRL'),
            'last_price': float(hist['Close'].iloc[-1]) if not hist.empty else None,
            'last_update': datetime.now().isoformat(),
            'history': {
                'dates': hist.index.strftime('%Y-%m-%d').tolist(),
                'closes': hist['Close'].round(2).tolist(),
                'volumes': hist['Volume'].astype(int).tolist(),
            },
            'dividends': {
                'dates': dividends.index.strftime('%Y-%m-%d').tolist(),
                'values': dividends.round(4).tolist(),
            } if not dividends.empty else {'dates': [], 'values': []},
            'stats': {
                'avg_price': float(hist['Close'].mean()),
                'min_price': float(hist['Close'].min()),
                'max_price': float(hist['Close'].max()),
                'volatility': float(hist['Close'].pct_change().std() * 100),
            }
        }
        
        print(f"  ✓ {ticker} coletado com sucesso")
        return asset_data
        
    except Exception as e:
        print(f"  ✗ Erro ao coletar {ticker}: {str(e)}")
        return None

def fetch_all_assets(assets=None, period=None, start=None):
    """
    Coleta dados de múltiplos ativos
    
    Args:
        assets: Lista de tickers (usa DEFAULT_ASSETS se None)
        period: Período de dados
        start: Data de início
    
    Returns:
        dict: Dados de todos os ativos
    """
    if assets is None:
        assets = DEFAULT_ASSETS
    
    print(f"\n{'='*60}")
    print(f"Iniciando coleta de dados - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if start:
        print(f"Início solicitado: {start}")
    else:
        print(f"Período solicitado: {period or '2y'}")
    print(f"{'='*60}\n")
    
    all_data = {
        'timestamp': datetime.now().isoformat(),
        'period': period,
        'start': start,
        'assets': {},
        'summary': {
            'total_assets': len(assets),
            'successful': 0,
            'failed': 0,
        }
    }
    
    for ticker in assets:
        data = fetch_asset_data(ticker, period=period, start=start)
        if data:
            all_data['assets'][ticker] = data
            all_data['summary']['successful'] += 1
        else:
            all_data['summary']['failed'] += 1
    
    print(f"\n{'='*60}")
    print(f"Coleta finalizada!")
    print(f"  Sucesso: {all_data['summary']['successful']}")
    print(f"  Falhas: {all_data['summary']['failed']}")
    print(f"{'='*60}\n")
    
    return all_data

def sanitize_data(obj):
    """Remove NaN e Infinity recursivamente de um objeto para garantir JSON válido"""
    if isinstance(obj, dict):
        return {k: sanitize_data(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_data(v) for v in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    return obj

def save_data(data, output_file=OUTPUT_FILE):
    """Salva dados em arquivo JSON, garantindo que seja válido"""
    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    # Limpa dados antes de salvar
    clean_data = sanitize_data(data)

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(clean_data, f, indent=2, ensure_ascii=False, allow_nan=False)
    print(f"✓ Dados salvos em: {output_file}")

def update_manifest():
    """Escaneia a pasta data/ e atualiza o manifest.json com a lista de arquivos de mercado"""
    pattern = os.path.join(DATA_DIR, 'market_data*.json')
    files = glob.glob(pattern)
    # Extrai apenas o nome do arquivo relativo à pasta data/
    file_names = [os.path.basename(f) for f in files]

    manifest = {
        'last_update': datetime.now().isoformat(),
        'market_data_files': sorted(file_names)
    }

    with open(MANIFEST_FILE, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"✓ Manifest atualizado em: {MANIFEST_FILE}")
    print(f"  Arquivos detectados: {file_names}")

def main():
    """Função principal"""
    parser = argparse.ArgumentParser(description='Coleta dados de ativos B3 via yfinance')
    parser.add_argument('--period', type=str, default=None, help='Período de dados (ex: 2y, 5y, max)')
    parser.add_argument('--start', type=str, default=None, help='Data de início (YYYY-MM-DD)')
    parser.add_argument('--output', type=str, default='market_data.json', help='Nome do arquivo de saída (na pasta data/)')
    args = parser.parse_args()

    # Carrega tickers do arquivo de configuração
    tickers = load_tickers()

    # Coleta dados
    data = fetch_all_assets(tickers, period=args.period, start=args.start)
    
    # Salva dados
    output_path = os.path.join(DATA_DIR, args.output)
    save_data(data, output_file=output_path)

    # Atualiza manifest
    update_manifest()
    
    return data

if __name__ == '__main__':
    main()

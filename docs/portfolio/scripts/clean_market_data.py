#!/usr/bin/env python3
"""
clean_market_data.py

Otimiza o arquivo market_data.json mantendo no máximo 10 dias de histórico por ativo.
Todo o histórico restante (antigo) é transferido e incorporado sem duplicatas ao
arquivo market_data_historical.json.
"""

import os
import json
from datetime import datetime

# Caminhos dos arquivos
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), 'data')
MARKET_DATA_FILE = os.path.join(DATA_DIR, 'market_data.json')
HISTORICAL_DATA_FILE = os.path.join(DATA_DIR, 'market_data_historical.json')

MAX_RECENT_DAYS = 10


def load_json(filepath):
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_json(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def clean_and_transfer():
    print("Iniciando limpeza e transferência de dados de mercado...")

    market_data = load_json(MARKET_DATA_FILE)
    if not market_data or 'assets' not in market_data:
        print(f"⚠️  Arquivo {MARKET_DATA_FILE} inválido ou não encontrado.")
        return

    historical_data = load_json(HISTORICAL_DATA_FILE)
    if not historical_data:
        historical_data = {
            "timestamp": datetime.now().isoformat(),
            "period": "historical",
            "start": None,
            "assets": {}
        }
    if 'assets' not in historical_data:
        historical_data['assets'] = {}

    transferred_count = 0
    assets_affected = 0

    for ticker, asset in market_data['assets'].items():
        history = asset.get('history', {})
        dates = history.get('dates', [])
        closes = history.get('closes', [])
        volumes = history.get('volumes', [])

        if len(dates) <= MAX_RECENT_DAYS:
            continue

        assets_affected += 1

        # Separa os dados recentes (últimos MAX_RECENT_DAYS) dos antigos
        keep_dates = dates[-MAX_RECENT_DAYS:]
        keep_closes = closes[-MAX_RECENT_DAYS:]
        keep_volumes = volumes[-MAX_RECENT_DAYS:]

        transfer_dates = dates[:-MAX_RECENT_DAYS]
        transfer_closes = closes[:-MAX_RECENT_DAYS]
        transfer_volumes = volumes[:-MAX_RECENT_DAYS]

        # Atualiza market_data.json para conter apenas os últimos MAX_RECENT_DAYS
        asset['history']['dates'] = keep_dates
        asset['history']['closes'] = keep_closes
        asset['history']['volumes'] = keep_volumes

        # Prepara a entrada no market_data_historical.json
        if ticker not in historical_data['assets']:
            historical_data['assets'][ticker] = {
                "ticker": asset.get("ticker", ticker),
                "name": asset.get("name", ticker),
                "sector": asset.get("sector", "N/A"),
                "currency": asset.get("currency", "BRL"),
                "last_price": asset.get("last_price", 0.0),
                "last_update": asset.get("last_update", datetime.now().isoformat()),
                "history": {
                    "dates": [],
                    "closes": [],
                    "volumes": []
                }
            }

        hist_asset = historical_data['assets'][ticker]
        if 'history' not in hist_asset or not isinstance(hist_asset['history'], dict):
            hist_asset['history'] = {"dates": [], "closes": [], "volumes": []}

        hist_dates = hist_asset['history'].get('dates', [])
        hist_closes = hist_asset['history'].get('closes', [])
        hist_volumes = hist_asset['history'].get('volumes', [])

        # Mapeamento para deduplicação mantendo por data YYYY-MM-DD
        date_map = {}
        for d, c, v in zip(hist_dates, hist_closes, hist_volumes):
            date_map[d] = (c, v)

        # Adiciona / atualiza com os dados transferidos
        for d, c, v in zip(transfer_dates, transfer_closes, transfer_volumes):
            if d not in date_map:
                transferred_count += 1
            date_map[d] = (c, v)

        # Ordena cronologicamente por data
        sorted_dates = sorted(date_map.keys())
        hist_asset['history']['dates'] = sorted_dates
        hist_asset['history']['closes'] = [date_map[d][0] for d in sorted_dates]
        hist_asset['history']['volumes'] = [date_map[d][1] for d in sorted_dates]

    # Atualiza timestamps nos arquivos
    now_iso = datetime.now().isoformat()
    market_data['timestamp'] = now_iso
    historical_data['timestamp'] = now_iso

    save_json(MARKET_DATA_FILE, market_data)
    save_json(HISTORICAL_DATA_FILE, historical_data)

    print(f"✓ Limpeza concluída!")
    print(f"  Ativos processados: {assets_affected}")
    print(f"  Novos registros de cotação transferidos para histórico: {transferred_count}")


if __name__ == '__main__':
    clean_and_transfer()

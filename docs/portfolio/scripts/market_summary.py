#!/usr/bin/env python3
"""
Market Summary - Gera resumo diário de ganhos e perdas, incluindo dados para Treemap
"""

import json
import os
from datetime import datetime, timedelta

# Configurações
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
MARKET_DATA_FILE = os.path.join(DATA_DIR, 'market_data.json')
MANIFEST_FILE = os.path.join(DATA_DIR, 'manifest.json')
SUMMARY_JSON = os.path.join(DATA_DIR, 'market_summary.json')
SUMMARY_MD = os.path.join(DATA_DIR, 'market_summary.md')

def load_merged_data():
    """Carrega e mescla dados de todos os arquivos listados no manifest.json"""
    if not os.path.exists(MANIFEST_FILE):
        if os.path.exists(MARKET_DATA_FILE):
            with open(MARKET_DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return None

    try:
        with open(MANIFEST_FILE, 'r', encoding='utf-8') as f:
            manifest = json.load(f)

        files = manifest.get('market_data_files', [])
        if not files:
            return None

        data_list = []
        for file_name in files:
            path = os.path.join(DATA_DIR, file_name)
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    data_list.append(json.load(f))

        if not data_list:
            return None

        # Merge logic (similar ao app.js)
        base = data_list[0]
        merged_assets = {**base.get('assets', {})}

        for i in range(1, len(data_list)):
            current = data_list[i]
            for ticker, asset in current.get('assets', {}).items():
                if ticker not in merged_assets:
                    merged_assets[ticker] = asset
                    continue

                # Mesclar histórico (dates, closes, volumes)
                b_hist = merged_assets[ticker].get('history', {})
                e_hist = asset.get('history', {})
                if b_hist and e_hist:
                    combined = []
                    seen = set()
                    # Arquivo base (índice 0) é considerado mais recente/prioritário
                    for j in range(len(b_hist.get('dates', []))):
                        d = b_hist['dates'][j]
                        combined.append({
                            'd': d,
                            'c': b_hist['closes'][j],
                            'v': b_hist['volumes'][j]
                        })
                        seen.add(d)

                    for j in range(len(e_hist.get('dates', []))):
                        d = e_hist['dates'][j]
                        if d not in seen:
                            combined.append({
                                'd': d,
                                'c': e_hist['closes'][j],
                                'v': e_hist['volumes'][j]
                            })
                            seen.add(d)

                    combined.sort(key=lambda x: x['d'])
                    b_hist['dates'] = [x['d'] for x in combined]
                    b_hist['closes'] = [x['c'] for x in combined]
                    b_hist['volumes'] = [x['v'] for x in combined]

        base['assets'] = merged_assets
        return base
    except Exception as e:
        print(f"⚠️ Erro ao mesclar dados para resumo: {e}")
        return None

def calculate_variations():
    data = load_merged_data()
    if not data:
        print("❌ Nenhum dado de mercado pôde ser carregado.")
        return None

    assets_data = data.get('assets', {})

    # Definir data atual e anterior de referência (baseado em VALE3 e PETR4)
    ref_tickers = ['VALE3.SA', 'PETR4.SA']
    ref_dates = []
    for t in ref_tickers:
        if t in assets_data:
            dates = assets_data[t].get('history', {}).get('dates', [])
            if len(dates) >= 2:
                ref_dates.append((dates[-1], dates[-2]))

    if not ref_dates:
        print("❌ Não foi possível determinar as datas de referência de mercado.")
        return None

    # Usar a data mais comum entre os ativos de referência
    from collections import Counter
    market_current_date, market_prev_date = Counter(ref_dates).most_common(1)[0][0]
    print(f"📅 Datas de referência: Atual={market_current_date}, Anterior={market_prev_date}")

    all_assets_summary = []

    for ticker, info in assets_data.items():
        history = info.get('history', {})
        dates = history.get('dates', [])
        closes = history.get('closes', [])

        if not dates or not closes or len(dates) < 2:
            continue

        # FILTRO: Apenas ativos que negociaram exatamente nas datas de referência
        if dates[-1] != market_current_date or dates[-2] != market_prev_date:
            continue

        asset_summary = {
            'ticker': ticker,
            'name': info.get('name', ticker),
            'last_close': closes[-1],
            'date': dates[-1],
            'daily_delta': 0,
            'monthly_delta': 0,
            'delta_volume': 0
        }

        # Volume Delta (Current vs 20d moving average prior to current)
        volumes = history.get('volumes', [])
        if len(volumes) >= 2:
            current_vol = volumes[-1]
            # Média dos últimos 20 dias anteriores ao atual
            prior_volumes = [v for v in volumes[-21:-1] if v is not None and v > 0]
            if prior_volumes and current_vol is not None and current_vol > 0:
                avg_vol = sum(prior_volumes) / len(prior_volumes)
                if avg_vol > 0:
                    asset_summary['delta_volume'] = (current_vol / avg_vol) - 1

        # Daily Delta
        prev_close = closes[-2]
        last_close = closes[-1]
        if prev_close and prev_close > 0 and last_close is not None:
            asset_summary['daily_delta'] = (last_close / prev_close) - 1
            asset_summary['prev_close'] = prev_close

        # Monthly Delta (approx 30 days ago)
        # We look for the price closest to 30 days before the last date
        try:
            last_date = datetime.strptime(dates[-1], '%Y-%m-%d')
            target_date = last_date - timedelta(days=30)
            target_date_str = target_date.strftime('%Y-%m-%d')

            # Find closest date index that is <= target_date_str
            # Since dates are sorted, we can search
            month_idx = 0
            for i, d in enumerate(dates):
                if d <= target_date_str:
                    month_idx = i
                else:
                    break

            month_close = closes[month_idx]
            if month_close and month_close > 0 and last_close is not None:
                asset_summary['monthly_delta'] = (last_close / month_close) - 1
        except Exception as e:
            print(f"⚠️ Erro ao calcular delta mensal para {ticker}: {e}")

        all_assets_summary.append(asset_summary)

    if not all_assets_summary:
        print("⚠️ Nenhum dado suficiente para calcular variações.")
        return None

    # Top Gainers/Losers based on daily delta
    valid_daily = [a for a in all_assets_summary if 'prev_close' in a]
    sorted_daily = sorted(valid_daily, key=lambda x: x['daily_delta'], reverse=True)

    top_gainers = sorted_daily[:5]
    top_losers = sorted_daily[-5:][::-1]

    return {
        'last_update': data.get('timestamp'),
        'date': all_assets_summary[0]['date'] if all_assets_summary else None,
        'gainers': top_gainers,
        'losers': top_losers,
        'all_assets': all_assets_summary
    }

def format_markdown(summary):
    date_str = summary['date']
    md = f"## Resumo de Mercado - {date_str}\n\n"

    def get_vol_info(a):
        vol_pct = a.get('delta_volume', 0) * 100
        if vol_pct > 0.01:
            return f"+{vol_pct:.2f}%", "⬆️"
        elif vol_pct < -0.01:
            return f"{vol_pct:.2f}%", "⬇️"
        else:
            return "0.00%", "—"

    md += "### 📈 Maiores Altas (Dia)\n\n"
    md += "| Ativo | Nome | Fechamento | Anterior | Variação | DeltaVolume |\n"
    md += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
    for a in summary['gainers']:
        delta_pct = a['daily_delta'] * 100
        vol_text, vol_icon = get_vol_info(a)
        md += f"| {a['ticker']} | {a['name']} | R$ {a['last_close']:.2f} | R$ {a.get('prev_close', 0):.2f} | **+{delta_pct:.2f}%** 🚀 | {vol_text} {vol_icon} |\n"

    md += "\n### 📉 Maiores Baixas (Dia)\n\n"
    md += "| Ativo | Nome | Fechamento | Anterior | Variação | DeltaVolume |\n"
    md += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
    for a in summary['losers']:
        delta_pct = a['daily_delta'] * 100
        vol_text, vol_icon = get_vol_info(a)
        md += f"| {a['ticker']} | {a['name']} | R$ {a['last_close']:.2f} | R$ {a.get('prev_close', 0):.2f} | **{delta_pct:.2f}%** 📉 | {vol_text} {vol_icon} |\n"

    return md

def main():
    print("Gerando resumo de mercado e dados para Treemap...")
    summary = calculate_variations()

    if summary:
        # Salvar JSON
        with open(SUMMARY_JSON, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        print(f"✓ Resumo JSON salvo em: {SUMMARY_JSON}")

        # Salvar Markdown
        md_content = format_markdown(summary)
        with open(SUMMARY_MD, 'w', encoding='utf-8') as f:
            f.write(md_content)
        print(f"✓ Resumo Markdown salvo em: {SUMMARY_MD}")
    else:
        print("❌ Não foi possível gerar o resumo.")

if __name__ == "__main__":
    main()

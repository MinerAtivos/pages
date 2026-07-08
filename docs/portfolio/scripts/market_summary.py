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

# Lista aproximada de ativos do IBOVESPA (pode ser atualizada)
IBOV_TICKERS = {
    'ABEV3.SA', 'ALOS3.SA', 'ALPA4.SA', 'ARZZ3.SA', 'ASAI3.SA', 'AZUL4.SA', 'B3SA3.SA', 
    'BBAS3.SA', 'BBDC3.SA', 'BBDC4.SA', 'BBSE3.SA', 'BEEF3.SA', 'BPAC11.SA', 'BRAP4.SA', 
    'BRFS3.SA', 'BRKM5.SA', 'CCRO3.SA', 'CIEL3.SA', 'CMIG4.SA', 'CMIN3.SA', 'COGN3.SA', 
    'CPFE3.SA', 'CPLE6.SA', 'CRFB3.SA', 'CSAN3.SA', 'CSNA3.SA', 'CYRE3.SA', 'DXCO3.SA', 
    'ECOR3.SA', 'EGIE3.SA', 'ELET3.SA', 'ELET6.SA', 'EMBR3.SA', 'ENGI11.SA', 'EQTL3.SA', 
    'EZTC3.SA', 'FLRY3.SA', 'GGBR4.SA', 'GOAU4.SA', 'GOLL4.SA', 'HAPV3.SA', 'HYPE3.SA', 
    'IGTI11.SA', 'IRBR3.SA', 'ITSA4.SA', 'ITUB3.SA', 'ITUB4.SA', 'JBSS3.SA', 'JHSF3.SA', 
    'KLBN11.SA', 'LREN3.SA', 'LWSA3.SA', 'MGLU3.SA', 'MRFG3.SA', 'MRVE3.SA', 'MULT3.SA', 
    'NTCO3.SA', 'PCAR3.SA', 'PETR3.SA', 'PETR4.SA', 'PETZ3.SA', 'PRIO3.SA', 'PSSA3.SA', 
    'RADL3.SA', 'RAIL3.SA', 'RENT3.SA', 'RRRP3.SA', 'SANB11.SA', 'SBSP3.SA', 'SLCE3.SA', 
    'SMTO3.SA', 'STBP3.SA', 'SUZB3.SA', 'TAEE11.SA', 'TIMS3.SA', 'TOTS3.SA', 'TRPL4.SA', 
    'UGPA3.SA', 'USIM5.SA', 'VALE3.SA', 'VBBR3.SA', 'VIVA3.SA', 'VIVT3.SA', 'WEGE3.SA', 'YDUQ3.SA'
}

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

        # Merge logic
        base = data_list[0]
        merged_assets = {**base.get('assets', {})}

        for i in range(1, len(data_list)):
            current = data_list[i]
            for ticker, asset in current.get('assets', {}).items():
                if ticker not in merged_assets:
                    merged_assets[ticker] = asset
                    continue

                b_hist = merged_assets[ticker].get('history', {})
                e_hist = asset.get('history', {})
                if b_hist and e_hist:
                    combined = []
                    seen = set()
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

    # Definir data atual e anterior de referência
    ref_tickers = ['PETR4.SA', 'VALE3.SA']
    ref_dates = []
    liquid_ref_dates = []
    for t in ref_tickers:
        if t in assets_data:
            dates = assets_data[t].get('history', {}).get('dates', [])
            if len(dates) >= 2:
                ref_dates.append((dates[-1], dates[-2]))
            if not liquid_ref_dates and len(dates) >= 10:
                liquid_ref_dates = dates[-10:]

    if not ref_dates:
        print("❌ Não foi possível determinar as datas de referência de mercado.")
        return None

    from collections import Counter
    market_current_date, market_prev_date = Counter(ref_dates).most_common(1)[0][0]
    print(f"📅 Datas de referência: Atual={market_current_date}, Anterior={market_prev_date}")
    
    liquid_ref_set = set(liquid_ref_dates)
    print(f"💧 Datas de liquidez (últimos 10 dias): {liquid_ref_dates}")

    all_assets_summary = []

    for ticker, info in assets_data.items():
        history = info.get('history', {})
        dates = history.get('dates', [])
        closes = history.get('closes', [])

        if not dates or not closes or len(dates) < 2:
            continue

        # FILTRO BASE: Apenas ativos que negociaram exatamente nas datas de referência
        if dates[-1] != market_current_date or dates[-2] != market_prev_date:
            continue

        asset_summary = {
            'ticker': ticker,
            'name': info.get('name', ticker),
            'last_close': closes[-1],
            'date': dates[-1],
            'daily_delta': 0,
            'monthly_delta': 0,
            'yearly_delta': 0,
            'delta_volume': 0,
            'is_liquid': False,
            'is_ibov': ticker in IBOV_TICKERS
        }

        # Liquidez: negociou nos mesmos 10 dias de PETR4/VALE3
        if liquid_ref_set and liquid_ref_set.issubset(set(dates)):
            asset_summary['is_liquid'] = True

        # Volume Delta
        volumes = history.get('volumes', [])
        if len(volumes) >= 2:
            current_vol = volumes[-1]
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

        # Monthly and Yearly Deltas
        try:
            last_date_obj = datetime.strptime(dates[-1], '%Y-%m-%d')
            def calculate_delta_days_ago(days):
                target_date_str = (last_date_obj - timedelta(days=days)).strftime('%Y-%m-%d')
                idx = 0
                for i, d in enumerate(dates):
                    if d <= target_date_str:
                        idx = i
                    else:
                        break
                hist_close = closes[idx]
                if hist_close and hist_close > 0 and last_close is not None:
                    return (last_close / hist_close) - 1
                return 0

            asset_summary['monthly_delta'] = calculate_delta_days_ago(30)
            asset_summary['yearly_delta'] = calculate_delta_days_ago(365)
        except Exception as e:
            pass

        all_assets_summary.append(asset_summary)

    if not all_assets_summary:
        print("⚠️ Nenhum dado suficiente para calcular variações.")
        return None

    # Separate Ibovespa
    ibov_data = next((a for a in all_assets_summary if a['ticker'] == '^BVSP'), None)
    rank_assets = [a for a in all_assets_summary if a['ticker'] != '^BVSP']

    def get_top_5(assets, key, reverse=True):
        valid = [a for a in assets if key in a and a[key] is not None]
        # Adiciona verificação para prev_close no caso de daily_delta
        if key == 'daily_delta':
            valid = [a for a in valid if 'prev_close' in a]
        sorted_assets = sorted(valid, key=lambda x: x[key], reverse=reverse)
        return sorted_assets[:5]

    filters = {
        'geral': rank_assets,
        'liquid': [a for a in rank_assets if a['is_liquid']],
        'ibov': [a for a in rank_assets if a['is_ibov']]
    }

    result = {
        'last_update': data.get('timestamp'),
        'date': all_assets_summary[0]['date'] if all_assets_summary else None,
        'ibov': ibov_data,
        'all_assets': all_assets_summary
    }

    for f_name, f_assets in filters.items():
        suffix = "" if f_name == "geral" else f"_{f_name}"
        result[f'gainers{suffix}'] = get_top_5(f_assets, 'daily_delta', True)
        result[f'losers{suffix}'] = get_top_5(f_assets, 'daily_delta', False)
        result[f'gainers_month{suffix}'] = get_top_5(f_assets, 'monthly_delta', True)
        result[f'losers_month{suffix}'] = get_top_5(f_assets, 'monthly_delta', False)
        result[f'gainers_year{suffix}'] = get_top_5(f_assets, 'yearly_delta', True)
        result[f'losers_year{suffix}'] = get_top_5(f_assets, 'yearly_delta', False)

    return result

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

    md += "### 📈 Maiores Altas (Dia - Geral)\n\n"
    md += "| Ativo | Nome | Fechamento | Anterior | Variação | DeltaVolume |\n"
    md += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
    for a in summary.get('gainers', []):
        delta_pct = a['daily_delta'] * 100
        vol_text, vol_icon = get_vol_info(a)
        md += f"| {a['ticker']} | {a['name']} | R$ {a['last_close']:.2f} | R$ {a.get('prev_close', 0):.2f} | **+{delta_pct:.2f}%** 🚀 | {vol_text} {vol_icon} |\n"

    md += "\n### 📉 Maiores Baixas (Dia - Geral)\n\n"
    md += "| Ativo | Nome | Fechamento | Anterior | Variação | DeltaVolume |\n"
    md += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
    for a in summary.get('losers', []):
        delta_pct = a['daily_delta'] * 100
        vol_text, vol_icon = get_vol_info(a)
        md += f"| {a['ticker']} | {a['name']} | R$ {a['last_close']:.2f} | R$ {a.get('prev_close', 0):.2f} | **{delta_pct:.2f}%** 📉 | {vol_text} {vol_icon} |\n"

    return md

def main():
    print("Gerando resumo de mercado e dados para Treemap...")
    summary = calculate_variations()

    if summary:
        with open(SUMMARY_JSON, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        print(f"✓ Resumo JSON salvo em: {SUMMARY_JSON}")

        md_content = format_markdown(summary)
        with open(SUMMARY_MD, 'w', encoding='utf-8') as f:
            f.write(md_content)
        print(f"✓ Resumo Markdown salvo em: {SUMMARY_MD}")
    else:
        print("❌ Não foi possível gerar o resumo.")

if __name__ == "__main__":
    main()

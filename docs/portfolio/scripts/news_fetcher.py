import yfinance as yf
import g4f
import json
import os
from datetime import datetime
import time
import requests

# Configurações
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
ASSETS_JSON = os.path.join(os.path.dirname(__file__), '..', 'assets.json')
MARKET_SUMMARY_JSON = os.path.join(DATA_DIR, 'market_summary.json')
OUTPUT_JSON = os.path.join(DATA_DIR, 'market_news.json')
GAS_URL = os.environ.get('GAS_URL')

def load_tickers_from_sheets():
    if not GAS_URL:
        print("⚠️ GAS_URL não configurada. Buscando apenas ativos locais.")
        return []
    try:
        response = requests.post(GAS_URL, json={"action": "get_all_tickers"}, timeout=30)
        data = response.json()
        if data.get('success'):
            return data.get('tickers', [])
    except Exception as e:
        print(f"❌ Erro ao buscar tickers da Planilha: {e}")
    return []

def load_tickers():
    tickers = set()
    # 1. Ativos dos portfólios (Planilha)
    tickers.update(load_tickers_from_sheets())

    # 2. Ativos do resumo de mercado (Altas/Baixas)
    if os.path.exists(MARKET_SUMMARY_JSON):
        try:
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                summary = json.load(f)
            tickers.update([a['ticker'] for a in summary.get('gainers', [])])
            tickers.update([a['ticker'] for a in summary.get('losers', [])])
        except: pass

    # 3. Fallback/Priority básicos
    priority = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA", "BBAS3.SA", "MGLU3.SA", "ABEV3.SA", "WEGE3.SA"]
    tickers.update(priority)

    return list(tickers)

def get_market_movers():
    """Retorna lista de tickers que estão no resumo de mercado (altas/baixas)"""
    movers = []
    if os.path.exists(MARKET_SUMMARY_JSON):
        try:
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                summary = json.load(f)
            movers.extend([a['ticker'] for a in summary.get('gainers', [])])
            movers.extend([a['ticker'] for a in summary.get('losers', [])])
        except: pass
    return movers

def get_ai_summary(ticker, context, is_priority=False):
    if not context or context.strip() == "":
        return "Sem notícias recentes de impacto encontradas nos principais canais financeiros."

    # Se não for prioridade e tivermos muitas notícias, fazemos uma síntese simples para economizar tempo/recurso
    if not is_priority:
        # Síntese "Sintética" - apenas limpa e organiza os títulos
        clean_titles = [t.strip() for t in context.split('.') if len(t.strip()) > 10]
        if clean_titles:
            return f"Movimentações recentes: {'; '.join(clean_titles[:2])}. O mercado monitora o desempenho do papel frente ao setor."
        return "Ativo com baixa frequência de notícias recentes."

    prompt = (
        f"Aja como um analista B3. Resuma em 2 frases objetivas as notícias de {ticker}. "
        f"Seja direto sobre o sentimento (positivo/negativo/neutro).\nNotícias: {context}"
    )

    for provider in [g4f.Provider.PollinationsAI, g4f.Provider.PuterJS]:
        try:
            response = g4f.ChatCompletion.create(
                model="openai" if provider == g4f.Provider.PollinationsAI else "gpt-4o-mini",
                provider=provider,
                messages=[{"role": "user", "content": prompt}],
            )
            if response and len(response) > 15:
                return response.strip()
        except:
            continue

    # Fallback caso a IA falhe mesmo sendo prioridade
    return f"Resumo: {context[:200]}..."

def main():
    print("🚀 Iniciando News Fetcher...")
    all_tickers = load_tickers()
    movers = get_market_movers()

    news_output = {
        "last_update": datetime.now().isoformat(),
        "market_summary": "O mercado brasileiro segue atento ao cenário fiscal e movimentações de commodities.",
        "assets": {},
        "market_movers": movers # Lista para facilitar filtro no frontend
    }

    processed_count = 0
    total = len(all_tickers)

    # Ordena para processar movers primeiro (prioridade de exibição)
    sorted_tickers = movers + [t for t in all_tickers if t not in movers]

    for ticker in sorted_tickers:
        processed_count += 1
        if processed_count % 10 == 0:
            print(f"Progresso: {processed_count}/{total}")

        # Para evitar timeout extremo, se passar de 300 ativos, paramos (segurança)
        if processed_count > 350: break

        try:
            t_obj = yf.Ticker(ticker)
            news = t_obj.news
            context = ""
            for item in news[:2]:
                # yfinance returns flat dict usually, title is top-level
                title = item.get('title') or item.get('content', {}).get('title', '')
                if title: context += f"{title}. "

            is_prio = ticker in movers or processed_count <= 25
            summary = get_ai_summary(ticker, context, is_priority=is_prio)

            news_output["assets"][ticker] = {
                "summary": summary,
                "updated_at": datetime.now().isoformat()
            }

            # Delay menor para não-prioridade
            if is_prio: time.sleep(0.5)

        except Exception as e:
            print(f"Erro em {ticker}: {e}")

    # Gera insight geral baseado nos 10 primeiros resumos
    top_summaries = {t: news_output["assets"][t]["summary"] for t in sorted_tickers[:10] if t in news_output["assets"]}

    try:
        combined = "\n".join([f"{t}: {s}" for t, s in top_summaries.items()])
        news_output["market_summary"] = g4f.ChatCompletion.create(
            model="openai",
            provider=g4f.Provider.PollinationsAI,
            messages=[{"role": "user", "content": f"Resuma o clima do mercado B3 hoje em 3 frases:\n{combined}"}],
        )
    except:
        pass

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(news_output, f, indent=2, ensure_ascii=False)

    print(f"✅ Finalizado! {len(news_output['assets'])} ativos processados.")

if __name__ == "__main__":
    main()

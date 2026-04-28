import yfinance as yf
import g4f
import json
import os
from datetime import datetime, timedelta
import time
import requests
import feedparser
import urllib.parse

# Configurações
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
MARKET_SUMMARY_JSON = os.path.join(DATA_DIR, 'market_summary.json')
OUTPUT_JSON = os.path.join(DATA_DIR, 'market_news.json')
GAS_URL = os.environ.get('GAS_URL')

def load_tickers_from_sheets():
    if not GAS_URL: return []
    try:
        response = requests.post(GAS_URL, json={"action": "get_all_tickers"}, timeout=30)
        data = response.json()
        if data.get('success'): return data.get('tickers', [])
    except Exception as e:
        print(f"❌ Erro ao buscar tickers da Planilha: {e}")
    return []

def load_tickers():
    tickers = set()
    tickers.update(load_tickers_from_sheets())
    if os.path.exists(MARKET_SUMMARY_JSON):
        try:
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                summary = json.load(f)
            tickers.update([a['ticker'] for a in summary.get('gainers', [])])
            tickers.update([a['ticker'] for a in summary.get('losers', [])])
        except: pass
    priority = ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA", "BBAS3.SA", "MGLU3.SA", "ABEV3.SA", "WEGE3.SA"]
    tickers.update(priority)
    return list(tickers)

def get_market_movers():
    movers = []
    if os.path.exists(MARKET_SUMMARY_JSON):
        try:
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                summary = json.load(f)
            movers.extend([a['ticker'] for a in summary.get('gainers', [])])
            movers.extend([a['ticker'] for a in summary.get('losers', [])])
        except: pass
    return movers

def fetch_google_news(ticker):
    """Busca notícias via Google News RSS para o ticker"""
    # Remove .SA para melhor busca no Google News
    clean_ticker = ticker.replace('.SA', '')
    query = urllib.parse.quote(f"{clean_ticker} ações notícias")
    url = f"https://news.google.com/rss/search?q={query}&hl=pt-BR&gl=BR&ceid=BR:pt-419"

    news_items = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:5]: # Pega as 5 mais recentes
            # Google News RSS date format: "Fri, 24 Apr 2026 17:27:01 GMT"
            dt = None
            if hasattr(entry, 'published_parsed'):
                dt = datetime(*entry.published_parsed[:6])

            news_items.append({
                'title': entry.title,
                'link': entry.link,
                'date': dt,
                'source': 'Google News'
            })
    except Exception as e:
        print(f"⚠️ Erro no Google News para {ticker}: {e}")
    return news_items

def fetch_yahoo_news(ticker):
    """Busca notícias via Yahoo Finance"""
    news_items = []
    try:
        t_obj = yf.Ticker(ticker)
        news = t_obj.news
        if not news: return []

        for item in news:
            content = item.get('content', {})
            title = item.get('title') or content.get('title', '')
            link = item.get('link') or content.get('canonicalUrl', {}).get('url') or content.get('clickThroughUrl', {}).get('url')

            # Date parsing logic from previous version
            dt = None
            ts = item.get('providerPublishTime')
            if ts:
                dt = datetime.fromtimestamp(ts)
            else:
                pub_date = content.get('pubDate') or content.get('pubdate')
                if pub_date:
                    try: dt = datetime.strptime(pub_date, '%Y-%m-%dT%H:%M:%SZ')
                    except:
                        try: dt = datetime.fromisoformat(pub_date.replace('Z', '+00:00'))
                        except: pass

            news_items.append({
                'title': title,
                'link': link,
                'date': dt,
                'source': 'Yahoo Finance'
            })
    except Exception as e:
        print(f"⚠️ Erro no Yahoo Finance para {ticker}: {e}")
    return news_items

def get_ai_summary(ticker, context, is_priority=False):
    if not context or context.strip() == "":
        return "Sem notícias recentes de impacto encontradas nos principais canais financeiros."

    if not is_priority:
        clean_titles = [t.strip() for t in context.split('.') if len(t.strip()) > 10]
        if clean_titles:
            return f"Movimentações recentes: {'; '.join(clean_titles[:2])}. O mercado monitora o desempenho do papel frente ao setor."
        return "Ativo com baixa frequência de notícias recentes."

    prompt = (
        f"Aja como um analista B3. Resuma em 2 frases objetivas as notícias de {ticker}. "
        f"Seja direto sobre o sentimento (positivo/negativo/neutro).\nNotícias de múltiplas fontes:\n{context}"
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
        except: continue
    return f"Resumo: {context[:200]}..."

def main():
    print("🚀 Iniciando Multi-Source News Fetcher...")
    all_tickers = load_tickers()
    movers = get_market_movers()

    news_output = {
        "last_update": datetime.now().isoformat(),
        "market_summary": "O mercado brasileiro segue atento ao cenário fiscal e movimentações de commodities.",
        "assets": {},
        "market_movers": movers
    }

    processed_count = 0
    total = len(all_tickers)
    sorted_tickers = movers + [t for t in all_tickers if t not in movers]

    now = datetime.now()
    one_week_ago = now - timedelta(days=7)

    for ticker in sorted_tickers:
        processed_count += 1
        if processed_count % 10 == 0: print(f"Progresso: {processed_count}/{total}")
        if processed_count > 350: break

        try:
            # Busca de múltiplas fontes
            yahoo_news = fetch_yahoo_news(ticker)
            google_news = fetch_google_news(ticker)

            combined_news = yahoo_news + google_news

            # Filtra por data e remove duplicatas (baseado no título)
            seen_titles = set()
            valid_news = []
            for item in combined_news:
                title_norm = item['title'].lower().strip()
                if title_norm in seen_titles: continue

                if item['date'] and item['date'] >= one_week_ago:
                    valid_news.append(item)
                    seen_titles.add(title_norm)

            # Fallback se nada na última semana
            if not valid_news and combined_news:
                valid_news = sorted(combined_news, key=lambda x: x['date'] if x['date'] else datetime.min, reverse=True)[:2]

            context = ""
            sources = []
            dates = []

            # Ordena por data (mais recente primeiro)
            valid_news.sort(key=lambda x: x['date'] if x['date'] else datetime.min, reverse=True)

            for item in valid_news[:4]: # Pega até 4 notícias das fontes combinadas
                if item['title']: context += f"[{item['source']}] {item['title']}. "
                if item['link']: sources.append(item['link'])
                if item['date']: dates.append(item['date'])

            period_str = ""
            if dates:
                min_date = min(dates).strftime('%d/%m/%Y')
                max_date = max(dates).strftime('%d/%m/%Y')
                period_str = f"Em {min_date}" if min_date == max_date else f"De {min_date} a {max_date}"

            is_prio = ticker in movers or processed_count <= 25
            summary = get_ai_summary(ticker, context, is_priority=is_prio)

            news_output["assets"][ticker] = {
                "summary": summary,
                "period": period_str,
                "sources": list(dict.fromkeys(sources)), # Deduplicate keeping order
                "updated_at": datetime.now().isoformat()
            }
            if is_prio: time.sleep(0.5)

        except Exception as e:
            print(f"Erro em {ticker}: {e}")

    # Geral
    try:
        top_summaries = [f"{t}: {news_output['assets'][t]['summary']}" for t in sorted_tickers[:10] if t in news_output["assets"]]
        if top_summaries:
            combined = "\n".join(top_summaries)
            news_output["market_summary"] = g4f.ChatCompletion.create(
                model="openai",
                provider=g4f.Provider.PollinationsAI,
                messages=[{"role": "user", "content": f"Resuma o clima do mercado B3 hoje em 3 frases:\n{combined}"}],
            )
    except: pass

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(news_output, f, indent=2, ensure_ascii=False)
    print(f"✅ Finalizado! {len(news_output['assets'])} ativos processados.")

if __name__ == "__main__":
    main()

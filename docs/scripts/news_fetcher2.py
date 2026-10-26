import yfinance as yf
import g4f
import json
import os
from datetime import datetime, timedelta
import time
import requests
import feedparser
import urllib.parse
from bs4 import BeautifulSoup
from newspaper import Article
from googlenewsdecoder import gnewsdecoder

# Configurações
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
MARKET_SUMMARY_JSON = os.path.join(DATA_DIR, 'market_summary.json')
OUTPUT_JSON = os.path.join(DATA_DIR, 'market_news.json')
HISTORY_JSON = os.path.join(DATA_DIR, 'market_news_history.json')
# GAS_URL = os.environ.get('GAS_URL')
GAS_URL = 'https://script.google.com/macros/s/AKfycbyIQkk8nPe2ROYHPbMbvfm6EZV8TvSneHgnKovW7JoVxbMrVjF3Bs-0SG_Ps6uLk1NY5Q/exec'

def load_tickers_from_sheets():
    if not GAS_URL:
        print("⚠️ GAS_URL não configurada. Buscando apenas ativos locais.")
        return []
    try:
        response = requests.post(GAS_URL, json={"action": "get_all_tickers"}, timeout=30)
        data = response.json()
        if data.get('success'): return data.get('tickers', [])
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
    """Busca notícias gerais via Google News RSS para o ticker"""
    clean_ticker = ticker.replace('.SA', '')
    query = urllib.parse.quote(f"{clean_ticker}")
    url = f"https://news.google.com/rss/search?q={query}%20when%3A15d&hl=pt-BR&gl=BR&ceid=BR:pt-419"

    news_items = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:5]:
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

def fetch_recommendation_news(ticker):
    """Busca notícias focadas em recomendações, carteiras recomendadas, compra e venda para o ticker"""
    clean_ticker = ticker.replace('.SA', '')
    query = urllib.parse.quote(f'"{clean_ticker}" (carteira recomendada OR recomendação OR compra OR venda OR "top pick")')
    url = f"https://news.google.com/rss/search?q={query}%20when%3A15d&hl=pt-BR&gl=BR&ceid=BR:pt-419"

    news_items = []
    try:
        feed = feedparser.parse(url)
        for entry in feed.entries[:5]:
            dt = None
            if hasattr(entry, 'published_parsed'):
                dt = datetime(*entry.published_parsed[:6])

            news_items.append({
                'title': entry.title,
                'link': entry.link,
                'date': dt,
                'source': 'Google News (Recomendações)'
            })
    except Exception as e:
        print(f"⚠️ Erro ao buscar notícias de recomendação para {ticker}: {e}")
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

def decode_google_news_url(url):
    """Decodifica URL de redirecionamento do Google News para obter o link direto da matéria"""
    if not url: return url
    if "news.google.com" in url:
        try:
            res = gnewsdecoder(url)
            if res and res.get('success') and res.get('decoded_url'):
                return res.get('decoded_url')
        except Exception:
            pass
    return url

def fetch_article_body(url, timeout=5):
    """Acessa a URL da notícia e extrai o conteúdo do corpo do artigo"""
    if not url: return ""
    real_url = decode_google_news_url(url)

    # 1. Tentar extração estruturada via newspaper3k
    try:
        art = Article(real_url, language='pt')
        art.download()
        art.parse()
        text = art.text.strip()
        if text and len(text) > 80:
            return text[:1500]
    except Exception:
        pass

    # 2. Fallback via requests + BeautifulSoup
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        resp = requests.get(real_url, headers=headers, timeout=timeout, allow_redirects=True)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            for s in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
                s.decompose()
            paragraphs = [p.get_text().strip() for p in soup.find_all('p') if len(p.get_text().strip()) > 30]
            body_text = ' '.join(paragraphs)
            if body_text and len(body_text) > 80:
                return body_text[:1500]
    except Exception:
        pass

    return ""

def analyze_news_with_ai(ticker, context, is_priority=False):
    """
    Analisa as notícias recentes e extrai:
    1. Resumo objetivo
    2. Sentimento (score de -1.0 a +1.0 e rótulo categórico)
    3. Tendência de recomendação de 15 dias (inclusões, exclusões, histórico e narrativa de evolução)
    """
    clean_ticker = ticker.replace('.SA', '')
    if not context or context.strip() == "":
        return {
            "summary": f"Sem notícias recentes de impacto encontradas nos principais canais financeiros para {clean_ticker}.",
            "sentiment": {
                "score": 0.0,
                "label": "neutro"
            },
            "recommendation_trend_15d": {
                "inclusions_count": 0,
                "exclusions_count": 0,
                "previous_status": "Sem menções recentes em recomendações",
                "current_status": "Sem menções recentes em recomendações",
                "trend_summary": f"Não foram identificadas alterações relevantes nas carteiras recomendadas para {clean_ticker} nos últimos 15 dias."
            }
        }

    prompt = f"""Aja como um analista financeiro especialista B3.
Análise detalhada de notícias e recomendações dos últimos 15 dias para o ativo {clean_ticker}.
Foi realizada a leitura e varredura do conteúdo completo das matérias/artigos de notícias de múltiplas fontes:
{context}

Retorne EXATAMENTE um objeto JSON válido (sem textos explicativos antes ou depois) com a seguinte estrutura:
{{
  "summary": "Resumo objetivo em português (2 a 3 frases) focado no impacto e novidades sobre {clean_ticker}.",
  "sentiment": {{
    "score": 0.5,
    "label": "positivo"
  }},
  "recommendation_trend_15d": {{
    "inclusions_count": 1,
    "exclusions_count": 0,
    "previous_status": "Recomendado por carteiras analíticas",
    "current_status": "Mantido/Incluído em recomendações",
    "trend_summary": "Resumo de 1 a 2 frases destacando se o ativo era recomendado, se sofreu inclusão/exclusão por portais financeiros e a tendência de mercado nos últimos 15 dias."
  }}
}}

Instruções para os campos:
- "sentiment.score": número float entre -1.0 (muito negativo) e +1.0 (muito positivo).
- "sentiment.label": exatamente um dentre os valores: "positivo", "negativo", "neutro", "inclusao_carteira", "exclusao_carteira".
- "recommendation_trend_15d.inclusions_count": quantidade estimada de menções/fontes no corpo das matérias indicando compra, visão otimista ou inclusão em carteiras recomendadas.
- "recommendation_trend_15d.exclusions_count": quantidade estimada de menções/fontes no corpo das matérias indicando venda, visão pessimista, corte ou retirada de carteiras.
"""

    gemini_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    raw_response = None

    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel('gemini-1.5-flash')
            res = model.generate_content(prompt)
            if res and res.text:
                raw_response = res.text.strip()
        except Exception as e:
            print(f"⚠️ Erro ao chamar Gemini API para {ticker}: {e}")

    if not raw_response and is_priority:
        for provider in [g4f.Provider.PollinationsAI, g4f.Provider.PuterJS]:
            try:
                response = g4f.ChatCompletion.create(
                    model="openai" if provider == g4f.Provider.PollinationsAI else "gpt-4o-mini",
                    provider=provider,
                    messages=[{"role": "user", "content": prompt}],
                )
                if response and len(response) > 15:
                    raw_response = response.strip()
                    break
            except Exception as e:
                continue

    if raw_response:
        try:
            clean_json = raw_response
            if clean_json.startswith('```'):
                lines = clean_json.splitlines()
                if lines[0].startswith('```'): lines = lines[1:]
                if lines and lines[-1].startswith('```'): lines = lines[:-1]
                clean_json = '\n'.join(lines).strip()

            data = json.loads(clean_json)
            if "sentiment" in data and isinstance(data["sentiment"], dict):
                score = float(data["sentiment"].get("score", 0.0))
                score = max(-1.0, min(1.0, score))
                label = str(data["sentiment"].get("label", "neutro")).lower()
                if label not in ["positivo", "negativo", "neutro", "inclusao_carteira", "exclusao_carteira"]:
                    label = "positivo" if score > 0.2 else ("negativo" if score < -0.2 else "neutro")
                data["sentiment"] = {"score": round(score, 2), "label": label}

            if "summary" in data and "recommendation_trend_15d" in data:
                return data
        except Exception as err:
            print(f"⚠️ Erro ao decodificar JSON da IA para {ticker}: {err}")

    # Fallback estruturado
    clean_titles = [t.strip() for t in context.split('.') if len(t.strip()) > 10]
    fallback_summary = f"Movimentações recentes: {'; '.join(clean_titles[:2])}." if clean_titles else f"Resumo para {clean_ticker}: {context[:200]}..."

    context_lower = context.lower()
    inclusions = context_lower.count("inclu") + context_lower.count("compra") + context_lower.count("top pick") + context_lower.count("recomendada")
    exclusions = context_lower.count("retirad") + context_lower.count("exclu") + context_lower.count("venda") + context_lower.count("corta")

    if inclusions > exclusions and exclusions == 0:
        label = "inclusao_carteira" if "carteira" in context_lower else "positivo"
        score = 0.65
    elif exclusions > inclusions:
        label = "exclusao_carteira" if "carteira" in context_lower else "negativo"
        score = -0.55
    else:
        label = "neutro"
        score = 0.0

    return {
        "summary": fallback_summary,
        "sentiment": {
            "score": score,
            "label": label
        },
        "recommendation_trend_15d": {
            "inclusions_count": inclusions,
            "exclusions_count": exclusions,
            "previous_status": "Sob acompanhamento do mercado",
            "current_status": f"Mencionado nas análises de mercado ({inclusions} menções otimistas / {exclusions} cautelosas)",
            "trend_summary": f"O mercado monitora o desempenho de {clean_ticker} nas principais carteiras e notícias financeiras nos últimos 15 dias."
        }
    }

def main():
    print("🚀 Iniciando Multi-Source News & Recommendation Fetcher com Varredura de Conteúdo de Matérias...")
    all_tickers = load_tickers()
    movers = get_market_movers()

    # Carregar dados de mercado para contexto e exibição
    market_summary_data = {}
    market_last_date = None
    if os.path.exists(MARKET_SUMMARY_JSON):
        try:
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                summary_json = json.load(f)
                market_last_date = summary_json.get('date')
                for a in summary_json.get('all_assets', []):
                    market_summary_data[a['ticker']] = a
        except: pass

    now_dt = datetime.now()
    today_str = market_last_date if market_last_date else now_dt.strftime('%Y-%m-%d')

    news_output = {
        "last_update": now_dt.isoformat(),
        "market_last_date": market_last_date,
        "market_summary": "O mercado brasileiro segue atento ao cenário fiscal e movimentações de commodities.",
        "ibov": None,
        "assets": {},
        "market_movers": movers
    }

    if os.path.exists(MARKET_SUMMARY_JSON):
        try:
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                ms_data = json.load(f)
                news_output["ibov"] = ms_data.get('ibov')
        except: pass

    # Carregar histórico existente de market_news_history.json
    history_data = {"last_update": now_dt.isoformat(), "history": {}}
    if os.path.exists(HISTORY_JSON):
        try:
            with open(HISTORY_JSON, 'r', encoding='utf-8') as hf:
                history_data = json.load(hf)
                if "history" not in history_data:
                    history_data["history"] = {}
        except Exception as e:
            print(f"⚠️ Não foi possível carregar histórico existente: {e}")

    history_data["last_update"] = now_dt.isoformat()
    if today_str not in history_data["history"]:
        history_data["history"][today_str] = {}

    processed_count = 0
    total = len(all_tickers)
    sorted_tickers = movers + [t for t in all_tickers if t not in movers]

    fifteen_days_ago = now_dt - timedelta(days=15)

    for ticker in sorted_tickers:
        processed_count += 1
        if processed_count % 10 == 0: print(f"Progresso: {processed_count}/{total}")
        if processed_count > 350: break

        try:
            yahoo_news = fetch_yahoo_news(ticker)
            google_news = fetch_google_news(ticker)
            recom_news = fetch_recommendation_news(ticker)
            combined_news = yahoo_news + google_news + recom_news

            seen_titles = set()
            valid_news = []
            for item in combined_news:
                title_norm = item['title'].lower().strip()
                if title_norm in seen_titles: continue

                if item['date'] and item['date'] >= fifteen_days_ago:
                    valid_news.append(item)
                    seen_titles.add(title_norm)

            if not valid_news and combined_news:
                valid_news = sorted(combined_news, key=lambda x: x['date'] if x['date'] else datetime.min, reverse=True)[:3]

            context = ""
            sources = []
            dates = []
            valid_news.sort(key=lambda x: x['date'] if x['date'] else datetime.min, reverse=True)

            for item in valid_news[:4]:
                real_link = decode_google_news_url(item['link'])
                if real_link:
                    body_content = fetch_article_body(real_link)
                    if body_content:
                        context += f"[{item['source']}] Título: {item['title']}\nConteúdo da Matéria: {body_content}\n\n"
                    else:
                        context += f"[{item['source']}] Título: {item['title']}\n\n"
                    sources.append(real_link)
                elif item['title']:
                    context += f"[{item['source']}] Título: {item['title']}\n\n"

                if item['date']: dates.append(item['date'])

            period_str = ""
            max_news_date_str = None
            if dates:
                min_date = min(dates)
                max_date = max(dates)
                min_date_str = min_date.strftime('%d/%m/%Y')
                max_date_str = max_date.strftime('%d/%m/%Y')
                max_news_date_str = max_date.strftime('%Y-%m-%d')
                period_str = f"Em {min_date_str}" if min_date_str == max_date_str else f"De {min_date_str} a {max_date_str}"

            # Verificar se a notícia é anterior à data do mercado
            is_outdated = False
            if market_last_date and max_news_date_str:
                if max_news_date_str < market_last_date:
                    is_outdated = True

            is_prio = ticker in movers or processed_count <= 25
            analysis_res = analyze_news_with_ai(ticker, context, is_priority=is_prio)

            asset_market_info = market_summary_data.get(ticker, {})

            asset_entry = {
                "summary": analysis_res.get("summary", ""),
                "sentiment": analysis_res.get("sentiment", {"score": 0.0, "label": "neutro"}),
                "recommendation_trend_15d": analysis_res.get("recommendation_trend_15d", {}),
                "period": period_str,
                "sources": list(dict.fromkeys(sources)),
                "updated_at": now_dt.isoformat(),
                "is_outdated": is_outdated,
                "last_close": asset_market_info.get('last_close'),
                "daily_delta": asset_market_info.get('daily_delta'),
                "monthly_delta": asset_market_info.get('monthly_delta'),
                "yearly_delta": asset_market_info.get('yearly_delta'),
                "price_date": asset_market_info.get('date')
            }

            news_output["assets"][ticker] = asset_entry
            history_data["history"][today_str][ticker] = asset_entry

            if is_prio: time.sleep(0.5)

        except Exception as e:
            print(f"Erro em {ticker}: {e}")

    try:
        gainers = []
        losers = []
        if os.path.exists(MARKET_SUMMARY_JSON):
            with open(MARKET_SUMMARY_JSON, 'r', encoding='utf-8') as f:
                ms = json.load(f)
                gainers = [a['ticker'] for a in ms.get('gainers', [])]
                losers = [a['ticker'] for a in ms.get('losers', [])]

        gainers_summaries = [f"{t}: {news_output['assets'][t]['summary']}" for t in gainers if t in news_output["assets"]]
        losers_summaries = [f"{t}: {news_output['assets'][t]['summary']}" for t in losers if t in news_output["assets"]]

        ibov_info = ""
        if news_output.get("ibov"):
            i = news_output["ibov"]
            ibov_info = f"O IBOVESPA fechou em {i['last_close']:.0f} pontos, com variação de {i['daily_delta']*100:.2f}% no dia, {i['monthly_delta']*100:.2f}% no mês e {i['yearly_delta']*100:.2f}% no ano.\n"

        prompt = f"Aja como um analista financeiro. {ibov_info}Resuma, em português, o clima do mercado B3 hoje em 3 frases curtas e diretas.\n"
        if gainers_summaries:
            prompt += f"Destaques de alta:\n" + "\n".join(gainers_summaries) + "\n"
        if losers_summaries:
            prompt += f"Destaques de baixa:\n" + "\n".join(losers_summaries) + "\n"

        news_output["market_summary"] = g4f.ChatCompletion.create(
            model="openai",
            provider=g4f.Provider.PollinationsAI,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        print(f"Erro no resumo geral IA: {e}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(news_output, f, indent=2, ensure_ascii=False)

    with open(HISTORY_JSON, 'w', encoding='utf-8') as hf:
        json.dump(history_data, hf, indent=2, ensure_ascii=False)

    print(f"✅ Finalizado! {len(news_output['assets'])} ativos processados e salvos no histórico.")

if __name__ == "__main__":
    main()

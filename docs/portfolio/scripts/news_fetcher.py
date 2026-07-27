import yfinance as yf
import g4f
from google import genai
import json
import os
import traceback
import re
from datetime import datetime, timedelta
import time
import requests
import feedparser
import urllib.parse

# Configurações
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
MARKET_SUMMARY_JSON = os.path.join(DATA_DIR, 'market_summary.json')
OUTPUT_JSON = os.path.join(DATA_DIR, 'market_news.json')
#GAS_URL = os.environ.get('GAS_URL')
GAS_URL = 'https://script.google.com/macros/s/AKfycbyIQkk8nPe2ROYHPbMbvfm6EZV8TvSneHgnKovW7JoVxbMrVjF3Bs-0SG_Ps6uLk1NY5Q/exec'
GEMINI_API_KEY = None
EXHAUSTED_MODELS = set()

def get_gemini_key():
    global GEMINI_API_KEY
    # 1. Prioridade: Variável de ambiente
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    if GEMINI_API_KEY:
        print("✅ Gemini API Key carregada de variável de ambiente.")
        return GEMINI_API_KEY

    # 2. Fallback: Google Apps Script
    if not GAS_URL: return None
    try:
        response = requests.post(GAS_URL, json={"action": "get_tax_config"}, timeout=30)
        data = response.json()
        GEMINI_API_KEY = data.get('GEMINI_API_KEY')
        if GEMINI_API_KEY:
            print("✅ Gemini API Key carregada via GAS.")
        return GEMINI_API_KEY
    except Exception as e:
        print(f"❌ Erro ao buscar Gemini Key da Planilha: {e}")
    return None

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
    priority = ["^BVSP", "PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA", "BBAS3.SA", "MGLU3.SA", "ABEV3.SA", "WEGE3.SA"]
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
    if ticker == "^BVSP":
        query = urllib.parse.quote("IBOV OR IBOVESPA OR BVSP")
    else:
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

import random
import re
import time

def get_ai_summary(ticker, context, genai_client=None, genai_state=None):
    global EXHAUSTED_MODELS
    if not context or context.strip() == "":
        return "Sem notícias recentes de impacto encontradas nos principais canais financeiros."

    # 1. Tentar Gemini se disponível (via SDK oficial)
    if genai_client and (genai_state is None or genai_state.get("is_valid", True)):
        # Nova ordem de preferência otimizada para o Free Tier em 2026
        for model_name in [
            "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", 
            "gemini-2.0-flash-lite", "gemini-3.5-flash", "gemini-flash-latest",
            "gemini-1.5-pro", "gemini-2.5-pro", "gemini-pro-latest"
        ]:
            if model_name in EXHAUSTED_MODELS:
                continue

            # Pausa preventiva antes de cada tentativa para descolar requisições em lote
            time.sleep(random.randint(3, 7))

            try:
                prompt = (
                    f"Você é um analista experiente da B3. Analise e resuma com PROFUNDIDADE as notícias de {ticker}.\n"
                    f"Contexto (manchetes): {context}\n\n"
                    f"Instruções OBRIGATÓRIAS:\n"
                    f"1. Comece DIRETAMENTE com a análise das notícias. NÃO use introduções, saudações ou frases como 'Como analista...', 'Com base nas notícias' ou 'Aqui está o resumo'.\n"
                    f"2. NÃO apenas repita os títulos das notícias. Analise o que elas significam para a empresa.\n"
                    f"3. Identifique os fatos principais que impactam o papel.\n"
                    f"4. Extraia o sentimento do mercado (otimista, pessimista ou neutro) e explique o porquê.\n"
                    f"5. Escreva o resumo em português, fluído, entre 3 a 4 frases.\n"
                    f"6. Se as notícias forem contraditórias, aponte os pontos de atenção."
                )

                response = genai_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                )

                if response and response.text:
                    return response.text.strip()
                else:
                    print(f"⚠️ Gemini ({model_name}) retornou resposta vazia para {ticker}")
            except Exception as e:
                error_msg = str(e)
                print(f"⚠️ Erro Gemini SDK ({model_name}) para {ticker}: {error_msg}")

                # Tratar cota esgotada (429) ou erro de permissão (403)
                if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                    # Captura o tempo recomendado de espera da API
                    match = re.search(r"retry in ([\d\.]+)s", error_msg)
                    if not match:
                        match = re.search(r"retryDelay': '(\d+)s'", error_msg)

                    if match:
                        wait_time = float(match.group(1)) + 2  # Margem de segurança de 2s
                        print(f"⏳ Janela/Minuto estourado para {model_name}. Aguardando {wait_time}s para tentar novamente...")
                        time.sleep(wait_time)
                    else:
                        # Se limit: 0 apareceu, é um estouro temporário por minuto/dia no IP do GitHub
                        # Damos um tempo maior em vez de banir permanentemente o modelo da execução
                        print(f"⚠️ Quota excedida (Rate Limit) no IP para {model_name}. Aguardando backoff de 45s...")
                        time.sleep(45)
                        
                elif "403" in error_msg:
                    if "leaked" in error_msg.lower():
                        print(f"🚨 ALERTA: Sua Gemini API Key foi reportada como VAZADA (leaked) pelo Google e desativada.")
                        if genai_state: genai_state["is_valid"] = False
                    else:
                        print(f"🚫 Erro de permissão (403) para {model_name}. Pulando...")
                    EXHAUSTED_MODELS.add(model_name)
                elif "404" in error_msg or "NOT_FOUND" in error_msg:
                    print(f"🚫 Modelo não encontrado ou descontinuado (404): {model_name}. Removendo da lista.")
                    EXHAUSTED_MODELS.add(model_name)

                # Avança para tentar o próximo modelo disponível na lista caso este falhe
                continue

    # 2. Fallback para g4f
    prompt_fallback = (
        f"Aja como um analista B3 experiente. Resuma em português e em 3 frases OBJETIVAS e ANALÍTICAS as notícias de {ticker}.\n"
        f"Foque no impacto financeiro e no sentimento (positivo/negativo/neutro).\n"
        f"NÃO apenas liste os títulos.\n"
        f"Notícias:\n{context}"
    )

    # Lista de provedores robustos com tratamento de erro dinâmico
    available_providers = []
    for p_name in ["Airforce", "Blackbox", "ChatGptEs", "AmigoChat", "Liaobots"]:
        if hasattr(g4f.Provider, p_name):
            provider = getattr(g4f.Provider, p_name)
            if hasattr(provider, 'working') and not provider.working:
                continue
            available_providers.append(provider)

    for provider in available_providers:
        try:
            model = "gpt-4o-mini"
            response = g4f.ChatCompletion.create(
                model=model,
                provider=provider,
                messages=[{"role": "user", "content": prompt_fallback}],
            )
            if response and len(str(response)) > 15:
                return str(response).strip()
        except Exception as e:
            print(f"⚠️ Erro g4f ({provider.__name__}) para {ticker}: {e}")
            continue

    # Último recurso: extração manual básica se a IA falhar
    clean_titles = [t.strip() for t in context.replace('[', '.[').split('.') if len(t.strip()) > 15]
    if clean_titles:
        return f"Destaques: {'; '.join(clean_titles[:2])}. O mercado monitora o impacto destes fatos no desempenho do papel."

    return f"Resumo: {context[:300]}..."

def main():
    print("🚀 Iniciando Multi-Source News Fetcher...")
    api_key = get_gemini_key()

    genai_client = None
    genai_state = {"is_valid": True}
    if api_key:
        try:
            genai_client = genai.Client(api_key=api_key)
            print(f"✅ Google GenAI Client inicializado (Key: {api_key[:4]}...{api_key[-4:]})")

            # Diagnóstico opcional de modelos disponíveis
            try:
                print("🔍 Verificando modelos disponíveis...")
                # Tentar listar modelos para ver os nomes exatos permitidos
                available = []
                for m in genai_client.models.list():
                    name = m.name
                    # O SDK às vezes retorna 'models/gemini-...' ou apenas 'gemini-...'
                    clean_name = name.replace("models/", "")
                    available.append(clean_name)
                print(f"🤖 Modelos encontrados na sua conta: {', '.join(available)}")
            except Exception as diag_e:
                diag_msg = str(diag_e)
                if "leaked" in diag_msg.lower():
                    print("🚨 ALERTA: Sua API Key foi reportada como VAZADA (leaked) pelo Google.")
                    genai_state["is_valid"] = False
                else:
                    print(f"⚠️ Não foi possível listar modelos: {diag_msg}")
        except Exception as e:
            print(f"❌ Erro ao inicializar Google GenAI Client: {e}")

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

    news_output = {
        "last_update": datetime.now().isoformat(),
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
            yahoo_news = fetch_yahoo_news(ticker)
            google_news = fetch_google_news(ticker)
            combined_news = yahoo_news + google_news

            is_ibov_ticker = (ticker == "^BVSP")
            cutoff_date = (now - timedelta(days=2)) if is_ibov_ticker else one_week_ago

            seen_titles = set()
            valid_news = []
            for item in combined_news:
                title_norm = item['title'].lower().strip()
                if title_norm in seen_titles: continue

                if item['date'] and item['date'] >= cutoff_date:
                    valid_news.append(item)
                    seen_titles.add(title_norm)

            if not valid_news and combined_news:
                if is_ibov_ticker:
                    # Tenta com 7 dias se 2 dias ficou vazio
                    for item in combined_news:
                        title_norm = item['title'].lower().strip()
                        if title_norm in seen_titles: continue
                        if item['date'] and item['date'] >= one_week_ago:
                            valid_news.append(item)
                            seen_titles.add(title_norm)

                if not valid_news:
                    valid_news = sorted(combined_news, key=lambda x: x['date'] if x['date'] else datetime.min, reverse=True)[:2]

            context = ""
            sources = []
            dates = []
            valid_news.sort(key=lambda x: x['date'] if x['date'] else datetime.min, reverse=True)

            for item in valid_news[:4]:
                if item['title']: context += f"[{item['source']}] {item['title']}. "
                if item['link']: sources.append(item['link'])
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

            summary = get_ai_summary(ticker, context, genai_client=genai_client, genai_state=genai_state)

            asset_market_info = market_summary_data.get(ticker, {})

            news_output["assets"][ticker] = {
                "summary": summary,
                "period": period_str,
                "sources": list(dict.fromkeys(sources)),
                "updated_at": datetime.now().isoformat(),
                "is_outdated": is_outdated,
                "last_close": asset_market_info.get('last_close'),
                "daily_delta": asset_market_info.get('daily_delta'),
                "monthly_delta": asset_market_info.get('monthly_delta'),
                "yearly_delta": asset_market_info.get('yearly_delta'),
                "price_date": asset_market_info.get('date')
            }
            # Delay maior para respeitar cota do Free Tier (máx 15 RPM em alguns casos)
            time.sleep(1.5)

        except Exception as e:
            print(f"Erro em {ticker}: {e}")

    try:
        # Melhorar o resumo geral separando ganhadores e perdedores
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

        ibov_summary = ""
        if "^BVSP" in news_output["assets"]:
            ibov_summary = f"Notícias e fatos relevantes do IBOVESPA hoje: {news_output['assets']['^BVSP']['summary']}\n"

        prompt = (
            f"Aja como um analista financeiro sênior. {ibov_info}{ibov_summary}Resuma, em português, o clima do mercado B3 hoje em 3 a 4 frases analíticas e conectadas.\n"
            f"Evite apenas listar nomes de empresas, busque explicar a tendência do dia.\n"
        )
        if gainers_summaries:
            prompt += f"Destaques de alta:\n" + "\n".join(gainers_summaries) + "\n"
        if losers_summaries:
            prompt += f"Destaques de baixa:\n" + "\n".join(losers_summaries) + "\n"

        summary_success = False
        if genai_client and genai_state.get("is_valid", True):
            for model_name in [
                "gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest",
                "gemini-2.0-flash-lite", "gemini-1.5-flash-8b", "gemini-1.5-pro"
            ]:
                if model_name in EXHAUSTED_MODELS: continue
                try:
                    response = genai_client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                    )
                    if response and response.text:
                        news_output["market_summary"] = response.text.strip()
                        summary_success = True
                        break
                except Exception as e:
                    print(f"⚠️ Erro Gemini SDK ({model_name}) no resumo geral: {e}")

        if not summary_success:
            # Fallback geral robusto (mesma lógica de provedores de get_ai_summary)
            available_providers = []
            for p_name in ["Airforce", "Blackbox", "ChatGptEs", "AmigoChat", "Liaobots"]:
                if hasattr(g4f.Provider, p_name):
                    provider = getattr(g4f.Provider, p_name)
                    if hasattr(provider, 'working') and not provider.working:
                        continue
                    available_providers.append(provider)

            for provider in available_providers:
                try:
                    news_output["market_summary"] = g4f.ChatCompletion.create(
                        model="gpt-4o-mini",
                        provider=provider,
                        messages=[{"role": "user", "content": prompt}],
                    )
                    if news_output["market_summary"] and len(news_output["market_summary"]) > 20:
                        summary_success = True
                        break
                except: continue
    except Exception as e:
        print(f"Erro no resumo geral IA: {e}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(news_output, f, indent=2, ensure_ascii=False)
    print(f"✅ Finalizado! {len(news_output['assets'])} ativos processados.")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
cria_post.py — Gera diariamente uma postagem em HTML no diretório blog_posts_source/
com o resumo do mercado (Altas, Baixas e Notícias).

Uso:
  python3 cria_post.py
"""

import os
import json
import re
from datetime import datetime

# Caminhos de arquivos
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'docs', 'portfolio', 'data')
MARKET_SUMMARY_JSON = os.path.join(DATA_DIR, 'market_summary.json')
MARKET_NEWS_JSON = os.path.join(DATA_DIR, 'market_news.json')

SOURCE_DIR = os.path.join(BASE_DIR, 'blog_posts_source')
ASSETS_BLOG_DIR = os.path.join(BASE_DIR, 'docs', 'assets', 'blog')
DEFAULT_COVER = 'assets/blog/default-cover.png'

def load_json(filepath):
    if not os.path.exists(filepath):
        print(f"⚠️ Arquivo não encontrado: {filepath}")
        return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Erro ao carregar {filepath}: {e}")
        return None

def format_ticker_tag(ticker):
    """Remove o sufixo .SA e adiciona #"""
    clean_ticker = ticker.replace('.SA', '')
    return f"#{clean_ticker}"

def generate_preformatted_text(summary_data):
    """Gera o bloco pré-formatado com Altas e Baixas"""
    gainers = summary_data.get('gainers', [])
    losers = summary_data.get('losers', [])

    lines = []
    lines.append("Altas")
    lines.append("")
    for item in gainers:
        tag = format_ticker_tag(item['ticker'])
        close = item.get('last_close', 0.0)
        delta_pct = item.get('daily_delta', 0.0) * 100
        lines.append(f"{tag}, {close:.2f}, +{delta_pct:.2f}%")

    lines.append("")
    lines.append("Baixas")
    lines.append("")
    for item in losers:
        tag = format_ticker_tag(item['ticker'])
        close = item.get('last_close', 0.0)
        delta_pct = item.get('daily_delta', 0.0) * 100
        lines.append(f"{tag}, {close:.2f}, {delta_pct:.2f}%")

    return "\n".join(lines)

def generate_cover_image(date_str, slug):
    """
    Tenta capturar o print da página do Treemap/Mercado usando Playwright.
    Fallback: usa a imagem padrão (default-cover.png).
    Retorna o caminho relativo da imagem para usar no post.
    """
    os.makedirs(ASSETS_BLOG_DIR, exist_ok=True)
    img_filename = f"{slug}.png"
    img_filepath = os.path.join(ASSETS_BLOG_DIR, img_filename)
    relative_img_path = f"assets/blog/{img_filename}"

    try:
        from playwright.sync_api import sync_playwright
        import time

        portfolio_index = os.path.join(BASE_DIR, 'docs', 'portfolio', 'index.html')
        if os.path.exists(portfolio_index):
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(viewport={'width': 1280, 'height': 800})
                page.goto(f"file://{os.path.abspath(portfolio_index)}")
                time.sleep(1.5)  # tempo para renderizar o Treemap/Chart.js

                # Captura screenshot da viewport / página
                page.screenshot(path=img_filepath, full_page=False)
                browser.close()

            print(f"📸 Capa capturada via Playwright: {img_filepath}")
            return relative_img_path
    except Exception as e:
        print(f"⚠️ Erro ao capturar print do Treemap via Playwright ({e}). Usando imagem padrão.")

    return DEFAULT_COVER

def main():
    print("🚀 Executando cria_post.py...")

    summary_data = load_json(MARKET_SUMMARY_JSON)
    news_data = load_json(MARKET_NEWS_JSON)

    if not summary_data:
        print("❌ Impossível criar post: market_summary.json não encontrado ou vazio.")
        return

    # Extrai data e formatações
    raw_date = summary_data.get('date') or datetime.now().strftime('%Y-%m-%d')
    try:
        dt_obj = datetime.strptime(raw_date, '%Y-%m-%d')
    except ValueError:
        dt_obj = datetime.now()

    date_ddmm = dt_obj.strftime('%d.%m')
    date_formatted = dt_obj.strftime('%d.%m.%Y')
    date_display = dt_obj.strftime('%d/%m/%Y')
    date_iso = dt_obj.strftime('%Y-%m-%d')

    title = f"Resumo do mercado {date_formatted}"
    slug = f"resumo-do-mercado-{date_iso}"

    # Tenta capturar / obter a imagem de capa
    cover_image_path = generate_cover_image(date_iso, slug)

    # Bloco pré-formatado (Altas e Baixas)
    preformatted_text = generate_preformatted_text(summary_data)

    # Resumo das notícias (replicar saída de fetch news)
    market_news_text = ""
    if news_data and news_data.get('market_summary'):
        market_news_text = news_data['market_summary'].strip()
    else:
        market_news_text = "Sem resumo de notícias disponível para esta data."

    # Notícias de destaques de ativos se houver em news_data
    assets_news_html = ""
    if news_data and news_data.get('assets'):
        assets_news_list = []
        movers = news_data.get('market_movers', [])
        for t in movers:
            if t in news_data['assets']:
                info = news_data['assets'][t]
                summary = info.get('summary', '').strip()
                if summary and "Sem notícias" not in summary:
                    clean_ticker = t.replace('.SA', '')
                    assets_news_list.append(f"<li><strong>#{clean_ticker}:</strong> {summary}</li>")

        if assets_news_list:
            assets_news_html = f"""
            <h3 class="text-xl font-bold mt-6 mb-3 text-gray-800">Destaques por Ativo</h3>
            <ul class="list-disc pl-5 space-y-2 text-gray-700">
                {"".join(assets_news_list)}
            </ul>
            """

    # Monta os metadados no início do arquivo
    metadata = f"""<!--
title: {title}
date: {date_iso}
tags: resumo, mercado, b3, altas, baixas
image: {cover_image_path}
description: Resumo do mercado do dia {date_display} com destaques de altas, baixas e notícias da B3.
-->"""

    # Monta o corpo HTML do post
    html_content = f"""{metadata}
<div class="market-post-container space-y-6">
    <h2 class="text-2xl font-bold text-gray-900 border-b pb-2 mb-4">Resumo do mercado {date_ddmm}</h2>

    <div class="pre-formatted-block bg-gray-900 text-green-400 p-5 rounded-xl font-mono text-sm shadow-inner relative overflow-x-auto">
        <button onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText); alert('Copiado com sucesso!');" class="absolute top-3 right-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs px-3 py-1 rounded border border-gray-600 font-sans transition-all">
            <i class="fas fa-copy mr-1"></i> Copiar
        </button>
        <pre class="whitespace-pre">{preformatted_text}</pre>
    </div>

    <div class="news-summary-section mt-8 pt-4 border-t border-gray-200">
        <h3 class="text-xl font-bold mb-3 text-gray-800">Panorama Geral do Mercado</h3>
        <p class="text-gray-700 leading-relaxed bg-blue-50/50 p-4 rounded-lg border border-blue-100">{market_news_text}</p>
        {assets_news_html}
    </div>
</div>
"""

    os.makedirs(SOURCE_DIR, exist_ok=True)
    out_file = os.path.join(SOURCE_DIR, f"{date_iso}-resumo-mercado.html")
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"✅ Post criado com sucesso em: {out_file}")

if __name__ == "__main__":
    main()

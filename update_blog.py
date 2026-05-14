import os
import json
import re
import unicodedata
from datetime import datetime

# Configurações
SOURCE_DIR = 'blog_posts_source'
OUTPUT_DIR = 'docs/blog/posts'
POSTS_JSON = 'docs/blog/posts.json'
DEFAULT_IMAGE = 'docs/assets/blog/old_favicon.png' #default-cover.png' # Imagem padrão caso não encontre nenhuma

def extract_metadata(content):
    metadata = {}
    # Procura pelo bloco de metadados no início do arquivo
    match = re.search(r'<!--(.*?)-->', content, re.DOTALL)
    if match:
        meta_block = match.group(1)
        for line in meta_block.strip().split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                metadata[key.strip().lower()] = value.strip()
    return metadata

def extract_first_image(content):
    # Procura por tags <img> no conteúdo
    match = re.search(r'<img [^>]*src="([^"]+)"', content)
    if match:
        return match.group(1)
    return None

def slugify(text):
    """Slugify with ASCII normalization."""
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    text = text.lower()
    text = re.sub(r'\W+', '-', text)
    return text.strip('-')

def update_blog():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    if not os.path.exists(SOURCE_DIR):
        os.makedirs(SOURCE_DIR)

    posts_registry = []

    # Processa cada arquivo na pasta source
    for filename in os.listdir(SOURCE_DIR):
        if filename.endswith('.html') or filename.endswith('.txt'):
            filepath = os.path.join(SOURCE_DIR, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                raw_content = f.read()

            metadata = extract_metadata(raw_content)
            if not metadata.get('title'):
                print(f"Aviso: {filename} não possui título. Pulando...")
                continue

            # Limpa o conteúdo removendo o bloco de metadados
            clean_content = re.sub(r'<!--.*?-->', '', raw_content, flags=re.DOTALL).strip()

            title = metadata.get('title')

            # Validação de data
            date_str = metadata.get('date', datetime.now().strftime('%Y-%m-%d'))
            try:
                datetime.strptime(date_str, '%Y-%m-%d')
            except ValueError:
                print(f"Aviso: Data inválida '{date_str}' em {filename}. Usando data atual.")
                date_str = datetime.now().strftime('%Y-%m-%d')

            tags = [tag.strip() for tag in metadata.get('tags', '').split(',') if tag.strip()]

            # Lógica de imagem
            cover_image = metadata.get('image')
            if not cover_image:
                cover_image = extract_first_image(clean_content)
                # Se a imagem extraída tiver ../../ (comum no source), removemos para o JSON
                if cover_image:
                    cover_image = cover_image.replace('../../', '')

            if not cover_image:
                # Tenta buscar uma imagem com o mesmo nome do post na pasta assets/blog
                slug = slugify(title)
                potential_img = f"assets/blog/{slug}.png"
                if os.path.exists(os.path.join('docs', potential_img)):
                    cover_image = potential_img
                else:
                    cover_image = DEFAULT_IMAGE

            slug = slugify(title)
            output_filename = f"{slug}.html"
            output_path = os.path.join(OUTPUT_DIR, output_filename)

            # Cria o registro do post
            post_entry = {
                "id": slug,
                "title": title,
                "description": metadata.get('description', clean_content[:150] + '...'),
                "imageUrl": cover_image,
                "path": f"posts/{output_filename}",
                "date": date_str,
                "tags": tags
            }
            posts_registry.append(post_entry)

            # Gera o arquivo HTML individual do post usando o layout
            generate_post_html(post_entry, clean_content, output_path)

    # Ordena posts por data decrescente
    posts_registry.sort(key=lambda x: x['date'], reverse=True)

    # Salva o posts.json
    with open(POSTS_JSON, 'w', encoding='utf-8') as f:
        json.dump(posts_registry, f, indent=2, ensure_ascii=False)

    print(f"Blog atualizado com {len(posts_registry)} postagens.")

def generate_post_html(post, content, output_path):
    # Carrega o layout default
    layout_path = os.path.join('docs', '_layouts', 'default.html')
    if not os.path.exists(layout_path):
        # Fallback básico se o layout não existir
        layout = "<html><body>{{ content }}</body></html>"
    else:
        with open(layout_path, 'r', encoding='utf-8') as f:
            layout = f.read()

    # Prepara o conteúdo do post com visual moderno
    tags_html = "".join([f'<span class="bg-blue-100 text-blue-600 px-2 py-1 rounded-full text-xs font-medium mr-2">#{tag}</span>' for tag in post['tags']])

    # Formatação da data para exibição
    try:
        display_date = datetime.strptime(post['date'], '%Y-%m-%d').strftime('%d/%m/%Y')
    except ValueError:
        display_date = post['date']

    # Garantir que a imagem da capa use o caminho correto relativo ao post
    display_image = post['imageUrl']
    if not display_image.startswith('http') and not display_image.startswith('/'):
        display_image = '../../' + display_image.replace('../../', '')

    post_html = f"""
    <article class="max-w-4xl mx-auto px-4 py-12">
        <header class="mb-8">
            <div class="flex items-center space-x-2 text-sm text-gray-500 mb-4">
                <time datetime="{post['date']}">{display_date}</time>
                <span>•</span>
                <div class="flex">{tags_html}</div>
            </div>
            <h1 class="text-4xl md:text-5xl font-bold text-dark mb-6">{post['title']}</h1>
            <img src="{display_image}" alt="{post['title']}" class="w-full h-[400px] object-cover rounded-2xl shadow-lg mb-8">
        </header>
        <div class="prose prose-lg max-w-none text-gray-700 leading-relaxed">
            {content}
        </div>
        <footer class="mt-12 pt-8 border-t border-gray-200">
            <a href="../index.html" class="text-primary hover:text-secondary font-medium flex items-center">
                <i class="fas fa-arrow-left mr-2"></i> Voltar ao Blog
            </a>
        </footer>
    </article>
    """

    # Substitui o {{ content }} no layout
    final_html = layout.replace('{{ content }}', post_html)

    # Ajuste de caminhos para arquivos na pasta posts/ (sobem dois níveis)
    final_html = final_html.replace('href="style.css"', 'href="../style.css"')
    final_html = final_html.replace('src="script.js"', 'src="../script.js"')
    final_html = final_html.replace('href="favicon.png"', 'href="../favicon.png"')
    final_html = final_html.replace('href="metodologia.html"', 'href="../metodologia.html"')
    final_html = final_html.replace('href="monitor.html"', 'href="../monitor.html"')
    final_html = final_html.replace('href="index.html"', 'href="../index.html"')
    final_html = final_html.replace('href="balanceamento.html"', 'href="../balanceamento.html"')

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(final_html)

if __name__ == "__main__":
    update_blog()

document.addEventListener('DOMContentLoaded', () => {
    const postsGrid = document.querySelector('.posts-grid');
    const postsJsonPath = 'posts.json'; // Caminho para o seu arquivo JSON de posts

    // Função para criar um card de post
    function createPostCard(post) {
        const card = document.createElement('article');
        card.classList.add('post-card');

        // Garante que a descrição não seja muito longa para o card
        const truncatedDescription = post.description.length > 120
            ? post.description.substring(0, 120) + '...'
            : post.description;

        card.innerHTML = `
            <img src="${post.imageUrl}" alt="${post.title}" onerror="this.onerror=null;this.src='https://via.placeholder.com/300x200?text=Imagem+N%C3%A3o+Encontrada';">
            <span class="bg-green-50 text-green-600 px-2 py-1 rounded-md text-xs">${post.id}</span>
            <div class="post-card-content">
                <h3>${post.title}</h3>
                <p>${truncatedDescription}</p>
                <a href="${post.path}">Ler Mais</a> //cta do post 
            </div>
        `;
        return card;
    }

    // Função principal para carregar e exibir os posts
    async function loadPosts() {
        try {
            const response = await fetch(postsJsonPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const postsData = await response.json(); // Carrega o JSON

            // Opcional: ordenar posts por algum critério, por exemplo, data (se você adicionar ao JSON)
             postsData.sort((a, b) => new Date(b.date) - new Date(a.date));

            postsData.forEach(post => {
                const card = createPostCard(post);
                postsGrid.appendChild(card);
            });

        } catch (error) {
            console.error('Erro ao carregar ou processar os posts:', error);
            postsGrid.innerHTML = '<p>Não foi possível carregar os posts. Por favor, tente novamente mais tarde.</p>';
        }
    }

    loadPosts();
});

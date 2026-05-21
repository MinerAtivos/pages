document.addEventListener('DOMContentLoaded', () => {
    const postsGrid = document.getElementById('posts-grid');
    const featuredContainer = document.getElementById('featured-post-container');
    const tagsFilter = document.getElementById('tags-filter');
    const searchInput = document.getElementById('search-input');
    const emptyState = document.getElementById('empty-state');

    let allPosts = [];
    let currentTag = 'all';
    let searchQuery = '';

    async function loadPosts() {
        try {
            const response = await fetch('posts.json');
            if (!response.ok) throw new Error('Falha ao carregar posts');
            allPosts = await response.json();

            renderTags();
            renderPosts();
        } catch (error) {
            console.error('Erro:', error);
            postsGrid.innerHTML = '<p class="text-center col-span-3">Erro ao carregar postagens.</p>';
        }
    }

    function renderTags() {
        const tags = new Set();
        allPosts.forEach(post => {
            if (post.tags) {
                post.tags.forEach(tag => tags.add(tag));
            }
        });

        const tagsArray = Array.from(tags);
        tagsArray.forEach(tag => {
            const button = document.createElement('button');
            button.className = 'tag-btn bg-white text-gray-600 hover:bg-gray-100 px-4 py-2 rounded-full text-sm font-medium transition shadow-sm';
            button.textContent = tag;
            button.dataset.tag = tag;
            button.addEventListener('click', () => {
                setTag(tag);
            });
            tagsFilter.appendChild(button);
        });
    }

    function setTag(tag) {
        currentTag = tag;
        document.querySelectorAll('.tag-btn').forEach(btn => {
            if (btn.dataset.tag === tag) {
                btn.classList.add('active', 'bg-primary', 'text-white');
                btn.classList.remove('bg-white', 'text-gray-600');
            } else {
                btn.classList.remove('active', 'bg-primary', 'text-white');
                btn.classList.add('bg-white', 'text-gray-600');
            }
        });
        renderPosts();
    }

    function renderPosts() {
        const filteredPosts = allPosts.filter(post => {
            const matchesTag = currentTag === 'all' || (post.tags && post.tags.includes(currentTag));
            const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                post.description.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesTag && matchesSearch;
        });

        postsGrid.innerHTML = '';
        featuredContainer.innerHTML = '';

        if (filteredPosts.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        } else {
            emptyState.classList.add('hidden');
        }

        // Render Featured (only if it's the first render or "all" is selected and no search)
        if (currentTag === 'all' && searchQuery === '' && filteredPosts.length > 0) {
            const featured = filteredPosts[0];
            featuredContainer.innerHTML = createFeaturedCard(featured);

            // Render remaining
            filteredPosts.slice(1).forEach(post => {
                postsGrid.innerHTML += createPostCard(post);
            });
        } else {
            // Render all filtered
            filteredPosts.forEach(post => {
                postsGrid.innerHTML += createPostCard(post);
            });
        }
    }

    function createFeaturedCard(post) {
        const date = new Date(post.date).toLocaleDateString('pt-BR');
        return `
            <div class="relative group cursor-pointer overflow-hidden rounded-3xl shadow-xl transition-all hover:shadow-2xl" onclick="window.location.href='${post.path}'">
                <img src="../${post.imageUrl}" alt="${post.title}" class="w-full h-[500px] object-cover transition-transform duration-500 group-hover:scale-105">
                <div class="absolute inset-0 bg-gradient-to-t from-[#0b0f19] via-transparent to-transparent"></div>
                <div class="absolute bottom-0 left-0 p-8 md:p-12 w-full">
                    <span class="bg-primary text-white px-3 py-1 rounded-md text-sm font-bold mb-4 inline-block">Destaque</span>
                    <h2 class="text-3xl md:text-5xl font-bold text-white mb-4">${post.title}</h2>
                    <p class="text-gray-300 text-lg mb-6 line-clamp-2 max-w-3xl">${post.description}</p>
                    <div class="flex items-center text-gray-400 text-sm">
                        <span>${date}</span>
                        <span class="mx-2">•</span>
                        <span>${post.tags.join(', ')}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function createPostCard(post) {
        const date = new Date(post.date).toLocaleDateString('pt-BR');
        return `
            <article class="glass-card flex flex-col overflow-hidden card-hover cursor-pointer h-full" onclick="window.location.href='${post.path}'">
                <img src="../${post.imageUrl}" alt="${post.title}" class="w-full h-48 object-cover">
                <div class="p-6 flex flex-col flex-grow">
                    <div class="flex items-center text-xs text-gray-500 mb-3">
                        <span>${date}</span>
                        <span class="mx-2">•</span>
                        <span class="text-primary font-medium">${post.tags[0] || ''}</span>
                    </div>
                    <h3 class="text-xl font-bold text-dark mb-3 line-clamp-2">${post.title}</h3>
                    <p class="text-gray-600 text-sm mb-6 line-clamp-3 flex-grow">${post.description}</p>
                    <div class="flex items-center text-primary font-semibold text-sm">
                        Leia mais <i class="fas fa-arrow-right ml-2 transition-transform group-hover:translate-x-1"></i>
                    </div>
                </div>
            </article>
        `;
    }

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderPosts();
    });

    document.querySelector('[data-tag="all"]').addEventListener('click', () => setTag('all'));

    loadPosts();
});

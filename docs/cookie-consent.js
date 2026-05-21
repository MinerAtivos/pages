(function() {
    const GTM_ID = 'GTM-NFF8PMR';
    const CONSENT_KEY = 'cookie_consent_minerativos';

    function loadGTM() {
        // Google Tag Manager
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer',GTM_ID);
        console.log('GTM Loaded');
    }

    function createBanner() {
        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            width: 90%;
            max-width: 600px;
            background: white;
            color: #1f2937;
            padding: 20px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            border-radius: 12px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 15px;
            font-family: 'Inter', sans-serif;
            border: 1px solid #e5e7eb;
        `;

        // Get the base path dynamically to handle both root and subdirectories
        const pathSegments = window.location.pathname.split('/').filter(s => s !== '');

        // Find 'docs' or the index of the last segment to determine depth
        const docsIndex = pathSegments.indexOf('docs');
        const depth = docsIndex !== -1 ? (pathSegments.length - docsIndex - 1) : 0;

        const prefix = depth > 0 ? '../'.repeat(depth) : '';
        const policyPath = prefix + 'politica-privacidade.html';

        banner.innerHTML = `
            <div style="flex-grow: 1;">
                <h3 style="margin: 0 0 8px 0; font-weight: 700; font-size: 1.1rem;">Nós valorizamos sua privacidade</h3>
                <p style="margin: 0; font-size: 0.9rem; line-height: 1.5; color: #4b5563;">
                    Usamos cookies para melhorar sua experiência e analisar nosso tráfego.
                    Ao clicar em "Aceitar", você concorda com o uso de cookies conforme nossa
                    <a href="${policyPath}" style="color: #2563eb; text-decoration: underline;">Política de Privacidade</a>.
                </p>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 5px;">
                <button id="cookie-deny" style="padding: 10px 20px; border-radius: 6px; border: 1px solid #d1d5db; background: transparent; cursor: pointer; font-weight: 500; font-size: 0.9rem; transition: background 0.2s;">Recusar</button>
                <button id="cookie-accept" style="padding: 10px 20px; border-radius: 6px; border: none; background: #2563eb; color: white; cursor: pointer; font-weight: 500; font-size: 0.9rem; transition: background 0.2s;">Aceitar</button>
            </div>
        `;

        document.body.appendChild(banner);

        document.getElementById('cookie-accept').addEventListener('click', function() {
            localStorage.setItem(CONSENT_KEY, 'accepted');
            banner.remove();
            loadGTM();
        });

        document.getElementById('cookie-deny').addEventListener('click', function() {
            localStorage.setItem(CONSENT_KEY, 'denied');
            banner.remove();
        });

        // Hover effects
        const acceptBtn = document.getElementById('cookie-accept');
        const denyBtn = document.getElementById('cookie-deny');
        acceptBtn.onmouseover = () => acceptBtn.style.background = '#1e40af';
        acceptBtn.onmouseout = () => acceptBtn.style.background = '#2563eb';
        denyBtn.onmouseover = () => denyBtn.style.background = '#f9fafb';
        denyBtn.onmouseout = () => denyBtn.style.background = 'transparent';
    }

    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === 'accepted') {
        loadGTM();
    } else if (consent !== 'denied') {
        if (document.readyState === 'complete') {
            createBanner();
        } else {
            window.addEventListener('load', createBanner);
        }
    }
})();

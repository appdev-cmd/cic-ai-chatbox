
// Helper to decode HTML entities
function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&nbsp;/g, ' ');
}

// Custom parser to scrape and extract DuckDuckGo HTML search results
function parseDuckDuckGo(html) {
    const results = [];
    const blocks = html.split('class="result results_links');
    
    // Skip the first block as it is prefix content
    for (let i = 1; i < blocks.length && results.length < 5; i++) {
        const block = blocks[i];
        
        // Extract title
        const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
        if (!titleMatch) continue;
        const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        
        // Extract snippet
        const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        
        // Extract redirect URL which contains the target link in the 'uddg' query param
        const urlMatch = block.match(/href="([^"]*?uddg=[^"]*?)"/);
        let url = '';
        if (urlMatch) {
            try {
                const rawUrl = urlMatch[1];
                const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    url = decodeURIComponent(uddgMatch[1]);
                }
            } catch (e) {
                console.error("Error decoding url: ", e);
            }
        }
        
        // Fallback: try to match class="result__url" href
        if (!url) {
            const fallbackUrlMatch = block.match(/class="result__url"[^>]*href="([^"]+)"/);
            if (fallbackUrlMatch) {
                url = fallbackUrlMatch[1];
                if (url.startsWith('//')) {
                    url = 'https:' + url;
                }
            }
        }

        if (title && url) {
            results.push({
                title: decodeHtmlEntities(title),
                url: decodeHtmlEntities(url),
                content: decodeHtmlEntities(snippet)
            });
        }
    }
    return results;
}

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Target-Url, X-Target-Key');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Parse query parameter
    let query = '';
    if (req.method === 'GET') {
        query = req.query.q || '';
    } else if (req.method === 'POST') {
        query = req.body?.q || '';
    }

    if (!query || !query.trim()) {
        return res.status(400).json({ error: 'Search query "q" is required' });
    }

    const searchQuery = query.trim();
    console.log(`Executing real-time web search for query: "${searchQuery}"`);

    // Check for API Keys
    const tavilyKey = process.env.TAVILY_API_KEY;

    // 1. Prioritize Tavily API if configured
    if (tavilyKey) {
        try {
            console.log('Using Tavily API for search...');
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: tavilyKey,
                    query: searchQuery,
                    search_depth: 'basic',
                    max_results: 5
                })
            });

            if (response.ok) {
                const data = await response.json();
                const formatted = (data.results || []).map(r => ({
                    title: r.title,
                    url: r.url,
                    content: r.content
                }));
                return res.status(200).json({ source: 'tavily', results: formatted });
            } else {
                console.error(`Tavily API returned status ${response.status}. Falling back to DuckDuckGo...`);
            }
        } catch (error) {
            console.error('Tavily search error, falling back to DuckDuckGo:', error);
        }
    }

    // 2. Fallback to DuckDuckGo Scraper
    try {
        console.log('Using DuckDuckGo HTML Scraper for search...');
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
        const response = await fetch(ddgUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        if (!response.ok) {
            throw new Error(`DuckDuckGo returned status ${response.status}`);
        }

        const html = await response.text();
        const results = parseDuckDuckGo(html);
        return res.status(200).json({ source: 'duckduckgo', results });
    } catch (error) {
        console.error('DuckDuckGo search scraper failed:', error);
        return res.status(200).json({ 
            source: 'error',
            error: 'Search failed', 
            details: error.message,
            results: [] // return empty array on failure
        });
    }
}

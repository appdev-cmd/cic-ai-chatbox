// api/proxy.js

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE,PUT');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const targetUrl = req.headers['x-target-url'];
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing X-Target-Url header in request' });
    }

    // Get the relative path (strip /api/proxy prefix)
    const reqUrl = req.url || '';
    const relativePath = reqUrl.startsWith('/api/proxy') 
        ? reqUrl.slice('/api/proxy'.length) 
        : reqUrl;

    const destinationUrl = targetUrl.replace(/\/$/, '') + '/' + relativePath.replace(/^\//, '');

    const targetKey = req.headers['x-target-key'] || req.headers['authorization'];
    const headers = {
        'Content-Type': req.headers['content-type'] || 'application/json',
    };
    if (targetKey) {
        headers['Authorization'] = targetKey.startsWith('Bearer') ? targetKey : `Bearer ${targetKey}`;
    }

    // Bypass SSL certificate validation if self-signed
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    try {
        const fetchOptions = {
            method: req.method,
            headers: headers
        };

        if (req.method === 'POST') {
            // req.body is pre-parsed by Vercel Node helper into an object.
            // We serialize it back to JSON string to forward it downstream.
            fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
        }

        const response = await fetch(destinationUrl, fetchOptions);

        // Check if the response is an SSE stream (text/event-stream)
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('event-stream')) {
            res.writeHead(response.status, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            });

            // Read the stream chunk-by-chunk and write it directly to the response
            if (response.body) {
                if (typeof response.body.getReader === 'function') {
                    const reader = response.body.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        res.write(value);
                    }
                } else if (typeof response.body.on === 'function') {
                    // Node.js standard stream
                    await new Promise((resolve, reject) => {
                        response.body.on('data', (chunk) => res.write(chunk));
                        response.body.on('end', resolve);
                        response.body.on('error', reject);
                    });
                } else {
                    // Async iterator fallback
                    for await (const chunk of response.body) {
                        res.write(chunk);
                    }
                }
            }
            res.end();
            return;
        }

        // Standard JSON/text response
        const text = await response.text();
        res.status(response.status);
        let responseContentType = response.headers.get('content-type') || '';
        if (responseContentType) {
            if (responseContentType.includes(',')) {
                responseContentType = responseContentType.split(',')[0].trim();
            }
            try {
                res.setHeader('Content-Type', responseContentType);
            } catch (err) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
        }
        res.send(text);

    } catch (e) {
        console.error('Vercel serverless proxy error:', e);
        try {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        } catch (_) {}
        res.status(500).json({ error: `Vercel proxy connection failed: ${e.message}` });
    }
};

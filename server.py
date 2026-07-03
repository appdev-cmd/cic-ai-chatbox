import os
import ssl
import json
import urllib.request
import urllib.error
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Reconfigure stdout/stderr to support UTF-8 printing on Windows console
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    pass


class ProxyHandler(SimpleHTTPRequestHandler):
    def handle_proxy(self):
        # 1. Extract target base URL from headers
        target_base = self.headers.get('X-Target-Url')
        if not target_base:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Missing X-Target-Url header in request"}).encode('utf-8'))
            return

        # Extract the relative path (strip /api/proxy)
        relative_path = self.path[len('/api/proxy'):]
        
        # Combine target base and relative path
        target_url = target_base.rstrip('/') + '/' + relative_path.lstrip('/')

        # 2. Extract headers and map the API keys
        req_headers = {
            'Content-Type': self.headers.get('Content-Type', 'application/json')
        }
        
        # Check for target authorization
        target_key = self.headers.get('X-Target-Key')
        if target_key:
            req_headers['Authorization'] = f"Bearer {target_key}"
        elif self.headers.get('Authorization'):
            req_headers['Authorization'] = self.headers.get('Authorization')

        # Read request body for POST
        content_length = int(self.headers.get('Content-Length', 0))
        req_body = self.rfile.read(content_length) if content_length > 0 else None

        # 3. Create request object
        req = urllib.request.Request(
            target_url,
            data=req_body,
            headers=req_headers,
            method=self.command
        )

        # Create unverified SSL context to bypass self-signed certificate restrictions
        context = ssl._create_unverified_context()

        try:
            with urllib.request.urlopen(req, context=context) as response:
                # Send status code
                self.send_response(response.status)
                
                # Copy response headers from downstream, except CORS and Server headers
                for key, val in response.headers.items():
                    if key.lower() not in ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'server', 'date', 'transfer-encoding']:
                        self.send_header(key, val)
                
                # Inject CORS headers for local client browser
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', '*')
                self.send_header('Access-Control-Allow-Methods', '*')
                self.end_headers()

                # Stream response body in chunks to support SSE (Server-Sent Events)
                buffer = b""
                logged = False
                while True:
                    chunk = response.read(256)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    
                    if not logged:
                        buffer += chunk
                        if len(buffer) > 2000 or b"[DONE]" in buffer:
                            try:
                                print("\n--- PROXY STREAM FIRST 2000 BYTES ---")
                                print(buffer.decode('utf-8', errors='ignore'))
                                print("--- END PROXY STREAM ---\n")
                            except Exception as e:
                                print(f"Error logging buffer: {e}")
                            logged = True

        except urllib.error.HTTPError as e:
            # Handle downstream API HTTP error codes (e.g. 401, 404, 500)
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                self.wfile.write(e.read())
            except Exception:
                self.wfile.write(json.dumps({"error": f"Downstream API returned status {e.code}"}).encode('utf-8'))
        except Exception as e:
            # Handle networking/connection errors
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Proxy connection failed: {str(e)}"}).encode('utf-8'))

    def handle_search(self):
        from urllib.parse import urlparse, parse_qs, unquote
        parsed_url = urlparse(self.path)
        params = parse_qs(parsed_url.query)
        query = params.get('q', [''])[0]
        
        if not query:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                try:
                    body = json.loads(self.rfile.read(content_length).decode('utf-8'))
                    query = body.get('q', '')
                except Exception:
                    pass

        if not query or not query.strip():
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Search query 'q' is required"}).encode('utf-8'))
            return

        query = query.strip()
        print(f"Executing real-time web search for query: '{query}'")

        tavily_key = os.environ.get('TAVILY_API_KEY')
        
        # Try to load from a local .env file if exists
        if not tavily_key:
            try:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                env_path = os.path.join(base_dir, '.env')
                if os.path.exists(env_path):
                    with open(env_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            if line.strip() and not line.startswith('#'):
                                parts = line.strip().split('=', 1)
                                if len(parts) == 2 and parts[0].strip() == 'TAVILY_API_KEY':
                                    tavily_key = parts[1].strip().strip('"').strip("'")
                                    break
            except Exception as e:
                print(f"Error reading local .env: {e}")

        # 1. Prioritize Tavily if key is available
        if tavily_key:
            try:
                print("Using Tavily API for local search...")
                req_data = json.dumps({
                    "api_key": tavily_key,
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 5
                }).encode('utf-8')
                
                req = urllib.request.Request(
                    "https://api.tavily.com/search",
                    data=req_data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                
                context = ssl._create_unverified_context()
                with urllib.request.urlopen(req, context=context) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    formatted = []
                    for r in data.get('results', []):
                        formatted.append({
                            "title": r.get('title', ''),
                            "url": r.get('url', ''),
                            "content": r.get('content', '')
                        })
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"source": "tavily", "results": formatted}).encode('utf-8'))
                    return
            except Exception as e:
                print(f"Tavily search failed: {e}")
                # Fallback to DuckDuckGo

        # 2. Fallback to DuckDuckGo scraper
        try:
            print("Using DuckDuckGo HTML Scraper for local search...")
            from urllib.parse import quote
            import re
            ddg_url = f"https://html.duckduckgo.com/html/?q={quote(query)}"
            req = urllib.request.Request(
                ddg_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            )
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, context=context) as response:
                html = response.read().decode('utf-8', errors='ignore')
                results = []
                blocks = html.split('class="result results_links')
                for block in blocks[1:6]:
                    title_match = re.search(r'class="result__a"[^>]*>([\s\S]*?)</a>', block)
                    if not title_match:
                        continue
                    title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
                    
                    snippet_match = re.search(r'<a class="result__snippet"[^>]*>([\s\S]*?)</a>', block)
                    snippet = re.sub(r'<[^>]+>', '', snippet_match.group(1)).strip() if snippet_match else ''
                    
                    url_match = re.search(r'href="([^"]*?uddg=[^"]*?)"', block)
                    url = ''
                    if url_match:
                        raw_url = url_match.group(1)
                        uddg_match = re.search(r'uddg=([^&]+)', raw_url)
                        if uddg_match:
                            url = unquote(uddg_match.group(1))
                    
                    if not url:
                        fallback_url_match = re.search(r'class="result__url"[^>]*href="([^"]+)"', block)
                        if fallback_url_match:
                            url = fallback_url_match.group(1)
                            if url.startswith('//'):
                                url = 'https:' + url

                    if title and url:
                        title = title.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
                        snippet = snippet.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
                        results.append({
                            "title": title,
                            "url": url,
                            "content": snippet
                        })
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"source": "duckduckgo", "results": results}).encode('utf-8'))
                return
        except Exception as e:
            print(f"DuckDuckGo search failed: {e}")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"source": "error", "error": "Search failed", "results": []}).encode('utf-8'))

    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/proxy/'):
            self.handle_proxy()
        elif self.path.startswith('/api/search'):
            self.handle_search()
        else:
            # Serve static files normally
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/proxy/'):
            self.handle_proxy()
        elif self.path.startswith('/api/search'):
            self.handle_search()
        else:
            self.send_error(404, "File not found")

if __name__ == '__main__':
    # Change working directory to script location to serve correct files
    base_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(base_dir, 'dist')
    if os.path.exists(dist_dir):
        os.chdir(dist_dir)
        print("Serving from 'dist' directory...")
    else:
        os.chdir(base_dir)
        print("Serving from project root...")
    
    PORT = 8000
    server_address = ('', PORT)
    httpd = ThreadingHTTPServer(server_address, ProxyHandler)
    
    print(f"==================================================")
    print(f" CIC AI Chatbox is running at:")
    print(f" http://localhost:{PORT}")
    print(f"==================================================")
    print(f"Press Ctrl+C to stop the server.")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")

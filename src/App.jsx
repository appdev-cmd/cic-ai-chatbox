import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

// Setup marked markdown parser with highlight.js integration
marked.setOptions({
    highlight: function (code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
});

// Custom renderer for code block wrappers with language tags and copy button
const renderer = new marked.Renderer();
renderer.code = function(args) {
    // Handle both marked v12+ (object signature) and older versions (positional arguments)
    const codeText = typeof args === 'object' ? args.text : arguments[0];
    const codeLang = typeof args === 'object' ? args.lang : arguments[1];
    
    const escapedCode = codeText.replace(/"/g, '&quot;').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const displayLang = codeLang || 'code';
    
    let highlighted;
    try {
        highlighted = hljs.highlight(codeText, { 
            language: hljs.getLanguage(displayLang) ? displayLang : 'plaintext' 
        }).value;
    } catch (e) {
        highlighted = codeText;
    }
    
    return `
        <pre><div class="code-header"><span class="code-lang">${displayLang}</span><button class="copy-code-btn" onclick="copyToClipboard(this, \`${escapedCode}\`)"><i class="fa-regular fa-copy"></i> Copy</button></div><code class="hljs language-${displayLang}">${highlighted}</code></pre>
    `;
};
marked.use({ renderer });

// Robust copy function with fallback for webview/browser permission restrictions
const copyTextToClipboard = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.warn('navigator.clipboard failed, trying fallback...', e);
        }
    }
    
    // Fallback: create temporary textarea
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (err) {
        console.error('Fallback copy failed:', err);
        document.body.removeChild(textArea);
        return false;
    }
};

// Global Code Copy Helper for markdown-rendered HTML
window.copyToClipboard = (btn, codeText) => {
    copyTextToClipboard(codeText).then((success) => {
        if (success) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-check" style="color: var(--success-color)"></i> Copied!`;
            setTimeout(() => {
                btn.innerHTML = originalHtml;
            }, 2000);
        } else {
            console.error('Failed to copy code block');
        }
    });
};

const DEFAULT_SETTINGS = {
    apiUrl: 'https://ai-api.cic.com.vn:9443/v1',
    apiKey: '',
    cicApiKey: '',
    openrouterApiKey: '',
    connectionType: 'proxy',
    selectedModel: '',
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: 'You are Gemma, a highly capable AI assistant developed by Google. Answer clearly, accurately, and assist the user as best as you can.',
    imageEngine: 'pollinations',
    pollinationsModel: 'flux',
    openaiImageModel: 'dall-e-3',
    imageSize: '1024x1024'
};

const OPENROUTER_FREE_MODELS = [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA: Nemotron 3 Ultra (Free)' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'NVIDIA: Nemotron 3 Super (Free)' },
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'NVIDIA: Nemotron 3 Nano 30B A3B (Free)' },
    { id: 'nvidia/nemotron-nano-9b-v2:free', name: 'NVIDIA: Nemotron Nano 9B V2 (Free)' },
    { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'NVIDIA: Nemotron Nano 12B 2 VL (Free)' },
    { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'NVIDIA: Nemotron 3 Nano Omni (Free)' },
    { id: 'nvidia/nemotron-3.5-content-safety:free', name: 'NVIDIA: Nemotron 3.5 Content Safety (Free)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (Free)' },
    { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Meta: Llama 3.2 3B Instruct (Free)' },
    { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (Free)' },
    { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google: Gemma 4 26B A4B (Free)' },
    { id: 'cohere/north-mini-code:free', name: 'Cohere: North Mini Code (Free)' },
    { id: 'qwen/qwen3-coder:free', name: 'Qwen: Qwen3 Coder 480B A35B (Free)' },
    { id: 'openai/gpt-oss-120b:free', name: 'OpenAI: gpt-oss-120b (Free)' },
    { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Nous: Hermes 3 405B Instruct (Free)' }
];

// Encode a session object (title, model, messages) into a URL-safe Base64 string
const encodeSession = (session, selectedModel) => {
    try {
        const data = {
            title: session.title,
            model: selectedModel,
            messages: session.messages
        };
        const jsonStr = JSON.stringify(data);
        const utf8Bytes = new TextEncoder().encode(jsonStr);
        let binary = '';
        for (let i = 0; i < utf8Bytes.length; i++) {
            binary += String.fromCharCode(utf8Bytes[i]);
        }
        const base64 = btoa(binary);
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
        console.error('Error encoding session:', e);
        return null;
    }
};

// Decode a URL-safe Base64 string back into a session object
const decodeSession = (base64Str) => {
    if (!base64Str) return null;
    try {
        const base64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const jsonStr = new TextDecoder().decode(bytes);
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Error decoding session:', e);
        return null;
    }
};

// Component helper for rendering image messages
function ImageMessageContent({ msg, onZoom, onDownload, showToast }) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);

    if (msg.isLoading) {
        return (
            <div className="image-loading-card">
                <div className="image-loading-skeleton">
                    <i className="fa-solid fa-palette fa-spin"></i>
                    <span>{msg.content || 'Đang tạo ảnh với AI...'}</span>
                    <small className="image-prompt-preview">"{msg.imagePrompt}"</small>
                </div>
            </div>
        );
    }

    if (msg.isError || hasError) {
        return (
            <div className="image-error-card">
                <i className="fa-solid fa-circle-exclamation"></i>
                <div className="error-details">
                    <h4>Không thể tạo ảnh</h4>
                    <p>{msg.content || 'Đã xảy ra lỗi khi tải hình ảnh. Vui lòng thử lại.'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="image-message-card">
            <div className="image-wrapper">
                {!isLoaded && (
                    <div className="image-render-skeleton">
                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                        <span>Đang tải hình ảnh...</span>
                    </div>
                )}
                <img 
                    src={msg.imageUrl} 
                    alt={msg.imagePrompt} 
                    className={isLoaded ? 'loaded' : 'loading'}
                    onLoad={() => setIsLoaded(true)}
                    onError={() => setHasError(true)}
                    onClick={() => isLoaded && onZoom(msg.imageUrl, msg.imagePrompt)}
                />
                {isLoaded && (
                    <div className="image-hover-overlay" onClick={() => onZoom(msg.imageUrl, msg.imagePrompt)}>
                        <span className="zoom-indicator">
                            <i className="fa-solid fa-magnifying-glass-plus"></i> Phóng to
                        </span>
                    </div>
                )}
            </div>
            {isLoaded && (
                <div className="image-info">
                    <p className="image-prompt-text"><strong>Prompt:</strong> {msg.imagePrompt}</p>
                    {msg.optimizedPrompt && msg.optimizedPrompt !== msg.imagePrompt && (
                        <p className="image-optimized-prompt-text">
                            <strong>AI Optimized (English):</strong> <em>{msg.optimizedPrompt}</em>
                        </p>
                    )}
                    <div className="image-actions-row">
                        <button className="image-action-btn" onClick={() => onDownload(msg.imageUrl, msg.imagePrompt)}>
                            <i className="fa-solid fa-download"></i> Tải xuống
                        </button>
                        <button className="image-action-btn" onClick={() => window.open(msg.imageUrl, '_blank')}>
                            <i className="fa-solid fa-arrow-up-right-from-square"></i> Mở tab mới
                        </button>
                        <button className="image-action-btn" onClick={() => {
                            copyTextToClipboard(msg.imagePrompt);
                            showToast('Đã sao chép prompt!', 'success');
                        }}>
                            <i className="fa-regular fa-copy"></i> Sao chép Prompt
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

const parseThinkingContent = (text, isGenerating, isLast) => {
    if (!text) return { hasThinking: false, thinkingText: '', contentText: '', isThinkingComplete: false };
    
    // Case 1: The text explicitly contains </think> (meaning thinking has completed)
    const thinkEnd = text.indexOf('</think>');
    if (thinkEnd !== -1) {
        let thinkStart = text.indexOf('<think>');
        let thinkingText = '';
        if (thinkStart !== -1) {
            thinkingText = text.substring(thinkStart + 7, thinkEnd);
        } else {
            thinkingText = text.substring(0, thinkEnd);
        }
        
        const contentText = text.substring(thinkEnd + 8).trim();
        return { 
            hasThinking: true, 
            thinkingText: thinkingText, 
            contentText: contentText, 
            isThinkingComplete: true 
        };
    }
    
    // Case 2: The text contains <think> but no </think> (meaning thinking is in progress)
    const thinkStart = text.indexOf('<think>');
    if (thinkStart !== -1) {
        const thinkingText = text.substring(thinkStart + 7);
        return { 
            hasThinking: true, 
            thinkingText: thinkingText, 
            contentText: '', 
            isThinkingComplete: false 
        };
    }
    
    // Case 3: No tags present, and we are currently generating the last message.
    // In this case, everything streamed so far is assumed to be thinking process.
    if (isGenerating && isLast) {
        return {
            hasThinking: true,
            thinkingText: text,
            contentText: '',
            isThinkingComplete: false
        };
    }
    
    // Case 4: No tags present, and not generating (standard completed message)
    return {
        hasThinking: false,
        thinkingText: '',
        contentText: text,
        isThinkingComplete: true
    };
};

function AssistantMessageBubble({ msg, isGenerating, isLast }) {
    const rawContent = msg.content || '';
    const rawReasoning = msg.reasoning || '';
    const duration = msg.thinkingDuration;

    console.log('[AssistantBubble render]', { msg, isGenerating, isLast, rawContent, rawReasoning, duration });

    let thinkingText = '';
    let contentText = '';
    let isThinkingComplete = !isGenerating || !isLast;

    if (rawReasoning) {
        thinkingText = rawReasoning;
        contentText = rawContent;
        if (isGenerating && isLast && !rawContent) {
            isThinkingComplete = false;
        }
    } else {
        const parsed = parseThinkingContent(rawContent, isGenerating, isLast);
        thinkingText = parsed.thinkingText;
        contentText = parsed.contentText;
        isThinkingComplete = parsed.isThinkingComplete;
    }

    const hasThinking = !!thinkingText.trim();

    const [isCollapsed, setIsCollapsed] = useState(() => {
        // Collapse by default for historical messages, expand for current streaming message
        return !(isGenerating && isLast);
    });

    // Automatically expand when thinking text starts streaming for the first time
    useEffect(() => {
        if (isGenerating && isLast && hasThinking && !contentText) {
            setIsCollapsed(false);
        }
    }, [hasThinking, isGenerating, isLast, contentText]);

    return (
        <>
            {hasThinking && (
                <div className="thinking-container">
                    <div className="thinking-header" onClick={() => setIsCollapsed(!isCollapsed)}>
                        <div className="thinking-title">
                            {!isThinkingComplete ? (
                                <i className="fa-solid fa-brain fa-spin"></i>
                            ) : (
                                <i className="fa-solid fa-brain"></i>
                            )}
                            <span>Suy nghĩ của AI</span>
                            {duration !== null && duration !== undefined ? (
                                <span className="thinking-duration">{duration}s</span>
                            ) : !isThinkingComplete ? (
                                <span className="thinking-duration">Đang suy nghĩ...</span>
                            ) : (
                                <span className="thinking-duration">Đã xong</span>
                            )}
                        </div>
                        <i className={`fa-solid fa-chevron-down thinking-toggle-icon ${!isCollapsed ? 'expanded' : ''}`}></i>
                    </div>
                    {!isCollapsed && (
                        <div 
                            className="thinking-content" 
                            dangerouslySetInnerHTML={{ __html: marked.parse(thinkingText) }} 
                        />
                    )}
                </div>
            )}
            
            {contentText ? (
                <div dangerouslySetInnerHTML={{ __html: marked.parse(contentText) }} />
            ) : isGenerating && isLast ? (
                hasThinking ? (
                    <div className="response-waiting-indicator">
                        <span className="cursor-blink"></span>
                    </div>
                ) : (
                    <div dangerouslySetInnerHTML={{ __html: marked.parse('Generating response...') }} />
                )
            ) : null}
        </>
    );
}

// --- Helper Functions ---
const parseApiError = async (response) => {
    try {
        const errObj = await response.json().catch(() => ({}));
        if (errObj.error) {
            if (typeof errObj.error === 'object') {
                return errObj.error.message 
                    ? (typeof errObj.error.message === 'object' ? JSON.stringify(errObj.error.message) : String(errObj.error.message))
                    : JSON.stringify(errObj.error);
            }
            return String(errObj.error);
        }
        if (errObj.message) {
            return typeof errObj.message === 'object' ? JSON.stringify(errObj.message) : String(errObj.message);
        }
    } catch (e) {
        // Fallback
    }
    return `HTTP ${response.status}`;
};

const generateSessionId = () => 'session_' + Date.now();
const generateSharedSessionId = () => 'session_shared_' + Date.now();
const generateTempMsgId = () => 'image_msg_' + Date.now();

export default function App() {
    // --- States ---
    const [settings, setSettings] = useState(() => {
        const stored = localStorage.getItem('gemma_chat_settings');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Migrate API keys if they don't exist yet but apiKey does
                if (parsed.apiKey) {
                    if (!parsed.cicApiKey && (!parsed.apiUrl || !parsed.apiUrl.includes('openrouter.ai'))) {
                        parsed.cicApiKey = parsed.apiKey;
                    }
                    if (!parsed.openrouterApiKey && parsed.apiUrl && parsed.apiUrl.includes('openrouter.ai')) {
                        parsed.openrouterApiKey = parsed.apiKey;
                    }
                }
                return { ...DEFAULT_SETTINGS, ...parsed };
            } catch (e) {
                console.error('Error parsing settings:', e);
            }
        }
        return DEFAULT_SETTINGS;
    });

    const [sessions, setSessions] = useState(() => {
        const stored = localStorage.getItem('gemma_chat_sessions');
        return stored ? JSON.parse(stored) : {};
    });

    const [currentSessionId, setCurrentSessionId] = useState(() => {
        return localStorage.getItem('gemma_last_session_id') || null;
    });

    const [models, setModels] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('checking'); // 'online' | 'offline' | 'checking' | 'disconnected'
    const [connectionError, setConnectionError] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    
    // UI Panels
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    
    // Settings form fields
    const [formSettings, setFormSettings] = useState({ ...settings });
    const [cicApiKeyVisible, setCicApiKeyVisible] = useState(false);
    const [openrouterApiKeyVisible, setOpenrouterApiKeyVisible] = useState(false);
    const [isFetchingModels, setIsFetchingModels] = useState(false);

    // Chat input value
    const [inputValue, setInputValue] = useState('');

    // Search query for chat history
    const [searchQuery, setSearchQuery] = useState('');

    // Toast notification state
    const [toast, setToast] = useState({ show: false, message: '', type: 'info' });

    // Web Search states
    const [isSearchingWeb, setIsSearchingWeb] = useState(false);

    // Image Generation states
    const [isImageMode, setIsImageMode] = useState(false);
    const [lightboxImage, setLightboxImage] = useState(null);
    const [isCustomImageModel, setIsCustomImageModel] = useState(false);

    // --- Refs ---
    const abortControllerRef = useRef(null);
    const messageWindowRef = useRef(null);
    const inputRef = useRef(null);
    const scrollTimeoutRef = useRef(null);

    // --- Sync localStorage ---
    useEffect(() => {
        localStorage.setItem('gemma_chat_settings', JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        localStorage.setItem('gemma_chat_sessions', JSON.stringify(sessions));
    }, [sessions]);



    useEffect(() => {
        if (currentSessionId) {
            localStorage.setItem('gemma_last_session_id', currentSessionId);
        } else {
            localStorage.removeItem('gemma_last_session_id');
        }
    }, [currentSessionId]);

    // --- Sync isImageMode with current session ---
    useEffect(() => {
        if (currentSessionId && sessions[currentSessionId]) {
            setIsImageMode(!!sessions[currentSessionId].isImageMode);
        } else {
            setIsImageMode(false);
        }
    }, [currentSessionId, sessions]);


    // --- Validate connection on mount or setting changes ---
    useEffect(() => {
        validateConnection(settings);
    }, [settings.apiUrl, settings.apiKey, settings.cicApiKey, settings.openrouterApiKey, settings.connectionType]);

    // --- Import shared session on mount ---
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const shareData = params.get('share');
        if (shareData) {
            setTimeout(() => {
                const decoded = decodeSession(shareData);
                if (decoded && decoded.messages) {
                    const sessionId = generateSharedSessionId();
                    setSessions(prev => ({
                        ...prev,
                        [sessionId]: {
                            id: sessionId,
                            title: decoded.title || 'Shared Chat',
                            messages: decoded.messages
                        }
                    }));
                    setCurrentSessionId(sessionId);
                    
                    if (decoded.model) {
                        setSettings(prev => ({ ...prev, selectedModel: decoded.model }));
                    }

                    showToast('Đã nhập cuộc hội thoại được chia sẻ thành công!', 'success');
                } else {
                    showToast('Không thể giải mã dữ liệu cuộc hội thoại chia sẻ.', 'error');
                }

                // Clean URL parameters
                const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
            }, 100);
        }

        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, []);

    // --- Scroll to bottom when messages update or generating starts ---
    const scrollToBottom = (force = false) => {
        if (messageWindowRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = messageWindowRef.current;
            // Check if user is near the bottom (within 150px) before updating
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
            
            if (force || isAtBottom) {
                const behavior = force ? 'smooth' : 'auto';
                const lastScrollTop = scrollTop;

                // Immediate smooth scroll if forced (e.g. user sends message)
                if (force) {
                    messageWindowRef.current.scrollTo({
                        top: messageWindowRef.current.scrollHeight,
                        behavior: 'smooth'
                    });
                }

                // Clear any pending scroll timeouts to avoid backlog buildup
                if (scrollTimeoutRef.current) {
                    clearTimeout(scrollTimeoutRef.current);
                }

                scrollTimeoutRef.current = setTimeout(() => {
                    if (messageWindowRef.current) {
                        // If not forced, cancel scrolling if the user has manually scrolled up in the meantime
                        if (!force && messageWindowRef.current.scrollTop < lastScrollTop) {
                            return;
                        }
                        messageWindowRef.current.scrollTo({
                            top: messageWindowRef.current.scrollHeight,
                            behavior
                        });
                    }
                    scrollTimeoutRef.current = null;
                }, 50);
            }
        }
    };

    // Auto-scroll when session changes
    useEffect(() => {
        scrollToBottom(true);
    }, [currentSessionId]);

    const handleInputResize = () => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
        }
    };

    useEffect(() => {
        handleInputResize();
    }, [inputValue]);

    // --- API Request config resolver ---
    const getRequestConfig = (endpointPath, targetSettings = settings) => {
        const isProxy = targetSettings.connectionType === 'proxy';
        const cleanPath = endpointPath.startsWith('/') ? endpointPath : '/' + endpointPath;
        
        let url = '';
        let headers = {
            'Content-Type': 'application/json'
        };

        const isOpenRouter = targetSettings.apiUrl && targetSettings.apiUrl.includes('openrouter.ai');
        const apiKey = isOpenRouter 
            ? (targetSettings.openrouterApiKey || targetSettings.apiKey || '')
            : (targetSettings.cicApiKey || targetSettings.apiKey || '');

        if (isProxy) {
            url = `/api/proxy${cleanPath}`;
            headers['X-Target-Url'] = targetSettings.apiUrl;
            if (apiKey) {
                headers['X-Target-Key'] = apiKey;
            }
        } else {
            url = `${targetSettings.apiUrl}${cleanPath}`;
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        }

        return { url, headers };
    };

    // --- Connection Validation ---
    async function validateConnection(targetSettings) {
        setConnectionStatus('checking');
        
        const isOpenRouter = targetSettings.apiUrl && targetSettings.apiUrl.includes('openrouter.ai');
        const apiKey = isOpenRouter 
            ? (targetSettings.openrouterApiKey || targetSettings.apiKey || '')
            : (targetSettings.cicApiKey || targetSettings.apiKey || '');

        if (isOpenRouter && !apiKey) {
            setConnectionStatus('offline');
            setConnectionError('Chưa cấu hình OpenRouter API Key. Vui lòng vào Cài đặt để nhập khóa.');
            return false;
        }

        const config = getRequestConfig('/models', targetSettings);
        
        try {
            const response = await fetch(config.url, {
                method: 'GET',
                headers: config.headers
            });

            if (response.ok) {
                setConnectionStatus('online');
                setConnectionError('');
                
                // Fetch models automatically if list is empty
                fetchModels(targetSettings);
                return true;
            } else {
                const errMsg = await parseApiError(response);
                setConnectionStatus('offline');
                setConnectionError(`API returned error: ${errMsg}`);
                return false;
            }
        } catch (e) {
            console.error(e);
            setConnectionStatus('offline');
            setConnectionError('Cannot reach the API. Make sure the server is running and CORS allows connections, or use Proxy mode.');
            return false;
        }
    }

    // --- Fetch Models ---
    async function fetchModels(targetSettings = settings) {
        setIsFetchingModels(true);
        const config = getRequestConfig('/models', targetSettings);
        
        try {
            const response = await fetch(config.url, {
                method: 'GET',
                headers: config.headers
            });

            if (response.ok) {
                const data = await response.json();
                let modelList = data.data || [];
                
                // Lọc các mô hình miễn phí nếu kết nối OpenRouter
                if (targetSettings.apiUrl && targetSettings.apiUrl.includes('openrouter.ai')) {
                    modelList = modelList.filter(m => m.id.endsWith(':free'));
                }
                
                setModels(modelList);
                
                // Set default model if none selected or if previous selected model doesn't exist
                if (modelList.length > 0) {
                    const exists = modelList.some(m => m.id === targetSettings.selectedModel);
                    if (!exists || !targetSettings.selectedModel) {
                        setSettings(prev => ({ ...prev, selectedModel: modelList[0].id }));
                        setFormSettings(prev => ({ ...prev, selectedModel: modelList[0].id }));
                    }
                }
            } else {
                console.error('Failed to fetch models: ' + response.status);
            }
        } catch (e) {
            console.error('Network error fetching models: ', e);
        } finally {
            setIsFetchingModels(false);
        }
    };

    // --- Settings Drawer Actions ---
    const openSettingsModal = () => {
        setFormSettings({ ...settings });
        setIsSettingsOpen(true);
        fetchModels(settings);
        const hasModel = models.some(m => m.id === settings.openaiImageModel);
        setIsCustomImageModel(!hasModel || !settings.openaiImageModel);
    };

    const handleSaveSettings = () => {
        setSettings({ ...formSettings });
        setIsSettingsOpen(false);
        if (currentSessionId && formSettings.selectedModel) {
            setSessions(prev => ({
                ...prev,
                [currentSessionId]: {
                    ...prev[currentSessionId],
                    model: formSettings.selectedModel
                }
            }));
        }
    };

    const handleResetSettings = () => {
        if (window.confirm('Reset settings to default?')) {
            setFormSettings({ ...DEFAULT_SETTINGS });
        }
    }

    function showToast(message, type = 'info') {
        setToast({ show: true, message, type });
        setTimeout(() => {
            setToast(prev => ({ ...prev, show: false }));
        }, 3000);
    };

    const handleShareSession = (e) => {
        const session = sessions[currentSessionId];
        if (!session) return;

        const encoded = encodeSession(session, settings.selectedModel);
        if (!encoded) {
            showToast('Lỗi khi mã hóa cuộc hội thoại.', 'error');
            return;
        }

        const shareUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?share=${encoded}`;
        
        if (shareUrl.length > 8000) {
            alert('Cuộc hội thoại quá dài để chia sẻ qua link (vượt quá giới hạn ký tự URL). Anh vui lòng chia sẻ cuộc hội thoại ngắn hơn nhé!');
            return;
        }

        copyTextToClipboard(shareUrl).then((success) => {
            if (success) {
                const originalHtml = e.currentTarget.innerHTML;
                e.currentTarget.innerHTML = `<i class="fa-solid fa-check" style="color: var(--success-color)"></i>`;
                showToast('Đã sao chép liên kết chia sẻ cuộc hội thoại vào clipboard!', 'success');
                setTimeout(() => {
                    e.currentTarget.innerHTML = originalHtml;
                }, 2000);
            } else {
                showToast('Không thể sao chép liên kết vào clipboard.', 'error');
            }
        });
    };

    const handleToggleImageMode = () => {
        const nextValue = !isImageMode;
        setIsImageMode(nextValue);
        if (currentSessionId) {
            setSessions(prev => ({
                ...prev,
                [currentSessionId]: {
                    ...prev[currentSessionId],
                    isImageMode: nextValue
                }
            }));
        }
    };

    // --- Session Actions ---
    const handleCreateNewSession = (initialText = '') => {
        const sessionId = generateSessionId();
        setSessions(prev => ({
            ...prev,
            [sessionId]: {
                id: sessionId,
                title: 'New Chat',
                messages: [],
                isImageMode: isImageMode
            }
        }));
        setCurrentSessionId(sessionId);
        
        if (initialText) {
            setInputValue(initialText);
            // Initiate sendMessage using inputText after state updates
            setTimeout(() => triggerSendMessage(sessionId, initialText), 50);
        }
    };

    const handleDeleteSession = (sessionId, e) => {
        e.stopPropagation();
        if (window.confirm('Delete this chat session?')) {
            setSessions(prev => {
                const copy = { ...prev };
                delete copy[sessionId];
                return copy;
            });
            if (currentSessionId === sessionId) {
                const keys = Object.keys(sessions).filter(k => k !== sessionId);
                setCurrentSessionId(keys.length > 0 ? keys[keys.length - 1] : null);
            }
        }
    };

    const handleTogglePinSession = (sessionId, e) => {
        e.stopPropagation();
        setSessions(prev => ({
            ...prev,
            [sessionId]: {
                ...prev[sessionId],
                pinned: !prev[sessionId].pinned
            }
        }));
    };

    const handleRenameSession = (sessionId, e) => {
        e.stopPropagation();
        const currentTitle = sessions[sessionId].title;
        const newTitle = window.prompt('Rename chat:', currentTitle);
        if (newTitle && newTitle.trim()) {
            setSessions(prev => ({
                ...prev,
                [sessionId]: {
                    ...prev[sessionId],
                    title: newTitle.trim()
                }
            }));
        }
    };

    const handleClearAllHistory = () => {
        if (window.confirm('Are you sure you want to delete all chat history? This cannot be undone.')) {
            setSessions({});
            setCurrentSessionId(null);
        }
    };

    // --- Message Copying ---
    const handleCopyMessageText = (content, btn) => {
        copyTextToClipboard(content).then((success) => {
            if (success) {
                const originalHtml = btn.innerHTML;
                btn.innerHTML = `<i class="fa-solid fa-check" style="color: var(--success-color)"></i> Copied`;
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                }, 2000);
            } else {
                showToast('Không thể sao chép tin nhắn vào clipboard.', 'error');
            }
        });
    };

    // --- Image Generation Actions ---
    const handleDownloadImage = async (imageUrl, prompt) => {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = prompt.trim().substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
            a.download = `cic_art_${safeName || 'image'}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast('Đã tải hình ảnh xuống!', 'success');
        } catch (e) {
            console.error('Download failed:', e);
            window.open(imageUrl, '_blank');
            showToast('Mở ảnh trong tab mới để tải.', 'info');
        }
    };

    const triggerGenerateImage = async (sessionId, text) => {
        setIsGenerating(true);
        scrollToBottom(true);

        // 1. Add user message
        setSessions(prev => {
            const session = prev[sessionId];
            const messages = [...session.messages, { role: 'user', content: text }];
            const title = session.messages.length === 0 
                ? (text.length > 24 ? text.substring(0, 24) + '...' : text) 
                : session.title;
            return {
                ...prev,
                [sessionId]: { ...session, title, messages }
            };
        });

        // 2. Add loading assistant message
        const tempMsgId = generateTempMsgId();
        setSessions(prev => {
            const session = prev[sessionId];
            return {
                ...prev,
                [sessionId]: {
                    ...session,
                    messages: [...session.messages, { 
                        id: tempMsgId,
                        role: 'assistant', 
                        content: 'Đang dịch và tối ưu hóa prompt...', 
                        isImage: true, 
                        isLoading: true,
                        imagePrompt: text
                    }]
                }
            };
        });
        scrollToBottom(true);

        let optimizedPrompt = text;
        
        // Translate and expand prompt using selected model if online
        if (isOnline && settings.selectedModel) {
            try {
                const config = getRequestConfig('/chat/completions');
                
                const translateMessages = [
                    {
                        role: 'system',
                        content: 'You are an expert prompt engineer for Text-to-Image AI models like Flux and Stable Diffusion. Your task is to analyze the conversation history and the user\'s latest request, and synthesize them into a single, cohesive, highly descriptive English prompt for image generation. IMPORTANT RULES:\n1. If the user is designing an object (like a medal, trophy, logo, coin, card, or icon), focus 100% on the design of the object itself. Avoid drawing full human figures, realistic faces, or people unless explicitly requested. Instead, represent human elements as abstract engraved symbols or icons on the object.\n2. AI image generators struggle with rendering readable text. Keep prompts clean and represent requested text/letters as "engraved minimalist symbol", simple numbers (e.g., "100"), or clean graphic icons instead of complex sentences to avoid gibberish text in the image.\n3. Enhance visual details, style (e.g., 3D product render, vector illustration, glossy metallic finish), lighting, and clean composition.\n4. Output ONLY the final English prompt without any intro, outro, or explanations.'
                    }
                ];

                // Append history messages (excluding the last temporary loading message)
                const history = sessions[sessionId]?.messages || [];
                history.forEach(m => {
                    // Skip the very last loading message we just added
                    if (m.id === tempMsgId) return;
                    
                    if (m.role === 'user') {
                        translateMessages.push({ role: 'user', content: m.content });
                    } else if (m.role === 'assistant') {
                        if (m.isImage) {
                            translateMessages.push({ 
                                role: 'assistant', 
                                content: `[Previous Image Description: ${m.optimizedPrompt || m.imagePrompt}]` 
                            });
                        } else {
                            translateMessages.push({ role: 'assistant', content: m.content });
                        }
                    }
                });

                // Add the current user prompt
                translateMessages.push({ role: 'user', content: text });

                const translatePayload = {
                    model: settings.selectedModel,
                    messages: translateMessages,
                    temperature: 0.6,
                    max_tokens: 150,
                    stream: false
                };

                const translateRes = await fetch(config.url, {
                    method: 'POST',
                    headers: config.headers,
                    body: JSON.stringify(translatePayload)
                });

                if (translateRes.ok) {
                    const translateData = await translateRes.json();
                    const choiceText = translateData.choices?.[0]?.message?.content?.trim() || '';
                    if (choiceText && choiceText.length > 5) {
                        optimizedPrompt = choiceText;
                        console.log(`Prompt optimized: "${text}" -> "${optimizedPrompt}"`);
                    }
                }
            } catch (translateError) {
                console.error('Error translating prompt: ', translateError);
            }
        }

        // Update loading state message text
        setSessions(prev => {
            const session = prev[sessionId];
            const messages = [...session.messages];
            const targetIdx = messages.findIndex(m => m.id === tempMsgId);
            if (targetIdx !== -1) {
                messages[targetIdx] = {
                    ...messages[targetIdx],
                    content: 'Đang tạo hình ảnh của bạn với AI...',
                    imagePrompt: text,
                    optimizedPrompt: optimizedPrompt
                };
            }
            return {
                ...prev,
                [sessionId]: { ...session, messages }
            };
        });
        scrollToBottom(true);

        let imageUrl = '';
        let errorMsg = '';

        if (settings.imageEngine === 'pollinations') {
            try {
                let width = 1024;
                let height = 1024;
                if (settings.imageSize === '1024x576') {
                    width = 1024;
                    height = 576;
                } else if (settings.imageSize === '576x1024') {
                    width = 576;
                    height = 1024;
                }
                
                const model = settings.pollinationsModel || 'flux';
                // Construct pollinations URL with random seed to avoid caching
                const randomSeed = Math.floor(Math.random() * 10000000);
                const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(optimizedPrompt)}?width=${width}&height=${height}&model=${model}&nologo=true&private=true&enhance=false&seed=${randomSeed}`;
                imageUrl = url;
            } catch (e) {
                console.error('Pollinations generation failed:', e);
                errorMsg = `Tạo ảnh thất bại: ${e.message}`;
            }
        } else {
            // OpenAI Compatible API
            try {
                const config = getRequestConfig('/images/generations');
                const payload = {
                    prompt: optimizedPrompt,
                    model: settings.openaiImageModel || 'dall-e-3',
                    n: 1,
                    size: settings.imageSize || '1024x1024'
                };
                
                const response = await fetch(config.url, {
                    method: 'POST',
                    headers: config.headers,
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) {
                    throw new Error(await parseApiError(response));
                }
                
                const data = await response.json();
                if (data.data && data.data.length > 0) {
                    const firstData = data.data[0];
                    if (firstData.url) {
                        imageUrl = firstData.url;
                    } else if (firstData.b64_json) {
                        imageUrl = `data:image/png;base64,${firstData.b64_json}`;
                    } else {
                        throw new Error('API response does not contain url or b64_json');
                    }
                } else {
                    throw new Error('API response does not contain data array');
                }
            } catch (e) {
                console.error('OpenAI image generation failed:', e);
                errorMsg = `Tạo ảnh thất bại: ${e.message}`;
            }
        }

        // 3. Update message list with final result
        setSessions(prev => {
            const session = prev[sessionId];
            const messages = [...session.messages];
            const targetIdx = messages.findIndex(m => m.id === tempMsgId || (m.role === 'assistant' && m.isImage && m.isLoading && m.imagePrompt === text));
            
            const updatedMsg = imageUrl ? {
                role: 'assistant',
                content: `![${text}](${imageUrl})`,
                isImage: true,
                imageUrl: imageUrl,
                imagePrompt: text,
                optimizedPrompt: optimizedPrompt,
                isLoading: false
            } : {
                role: 'assistant',
                content: errorMsg,
                isImage: true,
                isError: true,
                isLoading: false,
                imagePrompt: text,
                optimizedPrompt: optimizedPrompt
            };

            if (targetIdx !== -1) {
                messages[targetIdx] = updatedMsg;
            } else {
                messages.push(updatedMsg);
            }

            return {
                ...prev,
                [sessionId]: { ...session, messages }
            };
        });

        setIsGenerating(false);
        scrollToBottom(true);
    };

    // --- Core Chat Send Action ---
    const handleSendMessage = () => {
        const text = inputValue.trim();
        if (!text || isGenerating) return;

        let targetSessionId = currentSessionId;
        if (!targetSessionId) {
            targetSessionId = generateSessionId();
            setSessions(prev => ({
                ...prev,
                [targetSessionId]: {
                    id: targetSessionId,
                    title: text.length > 24 ? text.substring(0, 24) + '...' : text,
                    messages: [],
                    isImageMode: isImageMode
                }
            }));
            setCurrentSessionId(targetSessionId);
        }

        if (isImageMode) {
            setInputValue('');
            triggerGenerateImage(targetSessionId, text);
            return;
        }

        if (!settings.selectedModel) {
            alert('Please select a model in settings first.');
            openSettingsModal();
            return;
        }

        setInputValue('');
        triggerSendMessage(targetSessionId, text);
    };

    const triggerSendMessage = async (sessionId, text) => {
        const activeModel = sessions[sessionId]?.model || settings.selectedModel;
        const isOpenRouter = (activeModel && activeModel.includes(':free')) || (settings.apiUrl && settings.apiUrl.includes('openrouter.ai'));
        const apiKey = isOpenRouter 
            ? (settings.openrouterApiKey || settings.apiKey || '')
            : (settings.cicApiKey || settings.apiKey || '');

        if (isOpenRouter && !apiKey) {
            showToast('Vui lòng cấu hình OpenRouter API Key trong phần Cài đặt để bắt đầu chat.', 'error');
            openSettingsModal();
            return;
        }

        setIsGenerating(true);
        scrollToBottom(true);

        // Prepare user and temporary assistant message in session
        setSessions(prev => {
            const session = prev[sessionId];
            const messages = [...session.messages, { role: 'user', content: text }];
            
            // Auto rename title if it was first message
            const title = session.messages.length === 0 
                ? (text.length > 24 ? text.substring(0, 24) + '...' : text) 
                : session.title;
            
            return {
                ...prev,
                [sessionId]: {
                    ...session,
                    title,
                    messages
                }
            };
        });

        // Perform classification using LLM Router (Option 2)
        let needsSearch = false;
        const activeModelForClassify = sessions[sessionId]?.model || settings.selectedModel;
        
        try {
            const config = getRequestConfig('/chat/completions');
            const classifyPayload = {
                model: activeModelForClassify,
                messages: [
                    {
                        role: 'system',
                        content: 'Analyze if the user query requires real-time / current information or a web search to be answered accurately (e.g. news, weather, dates, latest developments, current prices, current events, etc.). Reply with exactly "YES" or "NO". Do not write anything else.'
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                temperature: 0.0,
                max_tokens: 5,
                stream: false
            };

            const classifyRes = await fetch(config.url, {
                method: 'POST',
                headers: config.headers,
                body: JSON.stringify(classifyPayload)
            });

            if (classifyRes.ok) {
                const classifyData = await classifyRes.json();
                const choiceText = classifyData.choices?.[0]?.message?.content?.trim() || '';
                needsSearch = choiceText.toUpperCase().includes('YES');
                console.log(`LLM Router decision: "${choiceText}" -> needsSearch: ${needsSearch}`);
            } else {
                console.error('LLM Router classification API returned error: ' + classifyRes.status);
            }
        } catch (classifyError) {
            console.error('Error in LLM Router classification step: ', classifyError);
        }

        let searchContext = '';
        if (needsSearch) {
            setIsSearchingWeb(true);
            try {
                const searchRes = await fetch(`/api/search?q=${encodeURIComponent(text)}`);
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    const results = searchData.results || [];
                    if (results.length > 0) {
                        searchContext = `[Thời gian hiện tại: ${new Date().toLocaleDateString('vi-VN')}]\n[Kết quả tìm kiếm Internet cho: "${text}"]\n`;
                        results.forEach((res, index) => {
                            searchContext += `${index + 1}. ${res.title} - ${res.url}\n   Tóm tắt: ${res.content}\n`;
                        });
                        searchContext += `\nYêu cầu: Hãy sử dụng thông tin tìm kiếm thời gian thực ở trên để trả lời câu hỏi. Trích dẫn nguồn theo số thứ tự (ví dụ: [1], [2]) tại nơi lấy thông tin. Nếu kết quả tìm kiếm không liên quan hoặc không đủ thông tin, hãy nói rõ và tự trả lời bằng kiến thức của bạn.`;
                    }
                } else {
                    console.error('API search returned status: ' + searchRes.status);
                }
            } catch (searchError) {
                console.error('Error fetching search results: ', searchError);
            } finally {
                setIsSearchingWeb(false);
            }
        }

        abortControllerRef.current = new AbortController();
        const config = getRequestConfig('/chat/completions');
        
        // Construct messages payload with system instructions
        const messagesPayload = [
            { role: 'system', content: settings.systemPrompt }
        ];

        // Add previous history
        const historyMessages = sessions[sessionId]?.messages || [];
        messagesPayload.push(...historyMessages);

        // Inject search context right before the user query if available
        if (searchContext) {
            messagesPayload.push({ role: 'system', content: searchContext });
        }

        // Add current user message
        messagesPayload.push({ role: 'user', content: text });

        const modelToUse = activeModel;
        const apiPayload = {
            model: modelToUse,
            messages: messagesPayload,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            stream: true
        };

        // Add assistant placeholder to state
        setSessions(prev => {
            const session = prev[sessionId];
            return {
                ...prev,
                [sessionId]: {
                    ...session,
                    messages: [...session.messages, { role: 'assistant', content: '' }]
                }
            };
        });

        let streamText = '';
        let streamReasoning = '';
        let thinkingStartTime = Date.now();
        let thinkingDuration = null;
        let hasSeenContent = false;

        try {
            const response = await fetch(config.url, {
                method: 'POST',
                headers: config.headers,
                body: JSON.stringify(apiPayload),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) {
                throw new Error(await parseApiError(response));
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep last incomplete line

                for (const line of lines) {
                    const cleaned = line.trim();
                    if (!cleaned) continue;

                    if (cleaned.startsWith('data: ')) {
                        const dataStr = cleaned.slice(6);
                        if (dataStr === '[DONE]') {
                            break;
                        }

                        try {
                            const parsed = JSON.parse(dataStr);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || parsed.choices?.[0]?.delta?.reasoning;

                            // Debug log to see the delta keys and values fully expanded
                            console.log('[API Stream Chunk] delta:', JSON.stringify(parsed.choices?.[0]?.delta));

                            let changed = false;

                            if (reasoning) {
                                streamReasoning += reasoning;
                                changed = true;
                            }
                            
                            if (delta) {
                                streamText += delta;
                                changed = true;
                                
                                // Check if we have seen the start of actual content (outside of thinking block)
                                if (streamText.includes('</think>')) {
                                    if (!hasSeenContent) {
                                        hasSeenContent = true;
                                        thinkingDuration = Math.round((Date.now() - thinkingStartTime) / 1000);
                                    }
                                } else if (!streamText.includes('<think>')) {
                                    // If there is no <think> block at all, the first delta itself is content
                                    if (!hasSeenContent) {
                                        hasSeenContent = true;
                                    }
                                }
                            }

                            // If we were streaming reasoning content and then receive content for the first time
                            if (hasSeenContent && streamReasoning && thinkingDuration === null) {
                                thinkingDuration = Math.round((Date.now() - thinkingStartTime) / 1000);
                            }

                            if (changed) {
                                // Update assistant message content in state in real-time
                                setSessions(prev => {
                                    const session = prev[sessionId];
                                    const messages = [...session.messages];
                                    messages[messages.length - 1] = { 
                                        role: 'assistant', 
                                        content: streamText,
                                        reasoning: streamReasoning,
                                        thinkingDuration: thinkingDuration
                                    };
                                    return {
                                        ...prev,
                                        [sessionId]: { ...session, messages }
                                    };
                                });
                                scrollToBottom();
                            }
                        } catch (e) {
                            // Suppress JSON parse errors on incomplete chunk boundaries
                        }
                    }
                }
            }
        } catch (e) {
            let errorText = '';
            if (e.name === 'AbortError') {
                errorText = streamText + ' *[Generation stopped by user]*';
            } else {
                errorText = `Error generating response: ${e.message}`;
            }

            setSessions(prev => {
                const session = prev[sessionId];
                const messages = [...session.messages];
                if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                    const lastMsg = messages[messages.length - 1];
                    messages[messages.length - 1] = { 
                        role: 'assistant', 
                        content: errorText,
                        reasoning: lastMsg.reasoning || '',
                        thinkingDuration: lastMsg.thinkingDuration || null
                    };
                } else {
                    messages.push({ role: 'assistant', content: errorText });
                }
                return {
                    ...prev,
                    [sessionId]: { ...session, messages }
                };
            });
        } finally {
            setIsGenerating(false);
            abortControllerRef.current = null;
            scrollToBottom();
        }
    };

    const handleStopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    // --- Model Change ---
    const handleModelChange = (modelId) => {
        setSettings(prev => ({ ...prev, selectedModel: modelId }));
        setFormSettings(prev => ({ ...prev, selectedModel: modelId }));
        if (currentSessionId) {
            setSessions(prev => ({
                ...prev,
                [currentSessionId]: {
                    ...prev[currentSessionId],
                    model: modelId
                }
            }));
        }
    };

    // --- Helpers ---
    const currentSession = sessions[currentSessionId];
    const isOnline = connectionStatus === 'online';

    // Trích xuất timestamp từ ID cuộc hội thoại
    const getSessionTimestamp = (session) => {
        const match = session.id.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    };

    // Lọc các cuộc hội thoại dựa trên searchQuery
    const filteredSessions = Object.values(sessions).filter(session => 
        session.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Sắp xếp các cuộc hội thoại: ghim lên đầu, sau đó sắp xếp theo thời gian mới nhất
    const sortedSessions = filteredSessions.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return getSessionTimestamp(b) - getSessionTimestamp(a);
    });

    const displayedModels = models.length > 0 
        ? models 
        : (formSettings.apiUrl && formSettings.apiUrl.includes('openrouter.ai') ? OPENROUTER_FREE_MODELS : []);

    return (
        <div className="app-container">
            {/* Sidebar */}
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <div className="logo">
                        <div className="logo-icon">
                            <i className="fa-solid fa-wand-magic-sparkles"></i>
                        </div>
                        <span>CIC AI Chatbox</span>
                    </div>
                    <button className="close-sidebar-btn" onClick={() => setIsSidebarOpen(false)} title="Close Sidebar">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                </div>

                <button className="new-chat-btn" onClick={() => { handleCreateNewSession(); setIsSidebarOpen(false); }}>
                    <i className="fa-solid fa-plus"></i> New Chat
                </button>

                {/* Chat History List */}
                <div className="chat-history">
                    <div className="history-label">Recent Chats</div>
                    
                    <div className="sidebar-search-container">
                        <div className="search-chat-input-wrapper">
                            <i className="fa-solid fa-magnifying-glass search-icon-sidebar"></i>
                            <input 
                                type="text" 
                                className="search-chat-input" 
                                placeholder="Tìm kiếm cuộc trò chuyện..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button className="search-clear-btn" onClick={() => setSearchQuery('')} title="Xóa tìm kiếm">
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="history-list">
                        {sortedSessions.length === 0 ? (
                            <div className="history-label" style={{ textAlign: 'center', padding: '20px 0', textTransform: 'none' }}>
                                {searchQuery ? 'Không tìm thấy cuộc trò chuyện' : 'No recent chats'}
                            </div>
                        ) : (
                            sortedSessions.map(session => (
                                <div 
                                    key={session.id} 
                                    className={`history-item ${session.id === currentSessionId ? 'active' : ''} ${session.pinned ? 'pinned-item' : ''}`}
                                    onClick={() => { setCurrentSessionId(session.id); setIsSidebarOpen(false); }}
                                >
                                    <div className="history-title-container">
                                        {session.pinned ? (
                                            <i className="fa-solid fa-thumbtack pinned-icon"></i>
                                        ) : (
                                            <i className="fa-regular fa-message"></i>
                                        )}
                                        <span className="history-title">{session.title}</span>
                                    </div>
                                    <div className="history-actions">
                                        <button 
                                            className={`history-action-btn pin-btn ${session.pinned ? 'pinned' : ''}`} 
                                            title={session.pinned ? "Bỏ ghim" : "Ghim cuộc trò chuyện"} 
                                            onClick={(e) => handleTogglePinSession(session.id, e)}
                                        >
                                            <i className="fa-solid fa-thumbtack"></i>
                                        </button>
                                        <button className="history-action-btn" title="Rename Chat" onClick={(e) => handleRenameSession(session.id, e)}>
                                            <i className="fa-regular fa-pen-to-square"></i>
                                        </button>
                                        <button className="history-action-btn delete-btn" title="Delete Chat" onClick={(e) => handleDeleteSession(session.id, e)}>
                                            <i className="fa-regular fa-trash-can"></i>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Sidebar Footer */}
                <div className="sidebar-footer">
                    <button className="footer-btn" onClick={() => { openSettingsModal(); setIsSidebarOpen(false); }}>
                        <i className="fa-solid fa-gear"></i> Settings
                    </button>
                    <button className="footer-btn" title="Clear all history" onClick={handleClearAllHistory}>
                        <i className="fa-solid fa-trash-can"></i> Clear Chats
                    </button>
                </div>
            </aside>

            {/* Main Chat Area */}
            <main className="chat-area">
                {/* Top Navigation Header */}
                <header className="chat-header">
                    <div className="header-left">
                        <button className="menu-btn" title="Toggle Sidebar" onClick={() => setIsSidebarOpen(true)}>
                            <i className="fa-solid fa-bars"></i>
                        </button>
                        <div className="model-info">
                            {models.length > 0 ? (
                                <select 
                                    className="model-selector-header"
                                    value={currentSession?.model || settings.selectedModel}
                                    onChange={(e) => handleModelChange(e.target.value)}
                                >
                                    {models.map(m => (
                                        <option key={m.id} value={m.id}>{m.id}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="model-badge">
                                    {currentSession?.model || settings.selectedModel || 'Select Model in Settings'}
                                </span>
                            )}
                            <div className="status-indicator">
                                <span className={`status-dot ${connectionStatus}`}></span>
                                <span className="status-text">
                                    {connectionStatus === 'online' && 'Connected'}
                                    {connectionStatus === 'offline' && 'Auth Failed'}
                                    {connectionStatus === 'checking' && 'Connecting...'}
                                    {connectionStatus === 'disconnected' && 'Disconnected'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="header-right">
                        {currentSession && (
                            <button 
                                className="header-action-btn" 
                                title="Chia sẻ cuộc hội thoại" 
                                onClick={handleShareSession}
                                style={{ marginRight: '8px' }}
                            >
                                <i className="fa-solid fa-share-nodes"></i>
                            </button>
                        )}
                        <button className="header-action-btn" title="Quick Settings" onClick={openSettingsModal}>
                            <i className="fa-solid fa-sliders"></i>
                        </button>
                    </div>
                </header>

                {/* Message Window */}
                <div className="message-window" ref={messageWindowRef}>
                    {!currentSession || currentSession.messages.length === 0 ? (
                        /* Welcome/Landing State */
                        <div className="welcome-container">
                            <div className="welcome-header animate-fade-in">
                                <div className="welcome-gemma-logo">
                                    <i className="fa-solid fa-brain"></i>
                                </div>
                                <h1>Interact with CIC AI Chatbox</h1>
                                <p>A sleek, premium chat interface connected to your local AI engine.</p>
                            </div>

                            <div className={`setup-notice-card ${isOnline ? 'connected' : ''}`}>
                                <div className="notice-icon">
                                    <i className={`fa-solid ${isOnline ? 'fa-circle-check' : 'fa-circle-info'}`}></i>
                                </div>
                                <div className="notice-content">
                                    <h4>{isOnline ? 'Connected successfully' : 'Connection Status Required'}</h4>
                                    <p>
                                        {isOnline 
                                            ? 'Ready to chat. Select a model below or in settings to begin.' 
                                            : connectionError || 'To start chatting, make sure you configure your local API URL and API Key in the settings panel.'
                                        }
                                    </p>
                                    {!isOnline && (
                                        <button className="notice-action-btn" onClick={openSettingsModal}>Open Settings</button>
                                    )}
                                </div>
                            </div>

                            <div className="welcome-grid">
                                <div className="feature-card">
                                    <div className="card-icon"><i className="fa-solid fa-bolt"></i></div>
                                    <h3>Real-time Streaming</h3>
                                    <p>Watch responses generate word-by-word instantly with local streaming capability.</p>
                                </div>
                                <div className="feature-card">
                                    <div className="card-icon"><i className="fa-solid fa-code"></i></div>
                                    <h3>Code Highlight</h3>
                                    <p>Beautiful markdown formatting, lists, tables, and syntax highlighting for coding prompts.</p>
                                </div>
                                <div className="feature-card">
                                    <div className="card-icon"><i className="fa-solid fa-shield-halved"></i></div>
                                    <h3>Local & Private</h3>
                                    <p>Your chat history is saved directly in your browser's localStorage. No external trackers.</p>
                                </div>
                            </div>

                            <div className="prompt-suggestions">
                                <h3>Try asking...</h3>
                                <div class="suggestions-grid">
                                    <button className="suggestion-chip" onClick={() => setInputValue('Write a Python script to sort a list of dicts by key.')}>
                                        Write a Python script to sort a list of dicts by key.
                                    </button>
                                    <button className="suggestion-chip" onClick={() => setInputValue('Explain the difference between Gemma-2 and Gemma-1.')}>
                                        Explain the difference between Gemma-2 and Gemma-1.
                                    </button>
                                    <button className="suggestion-chip" onClick={() => setInputValue('What is retrieval-augmented generation (RAG)? Explain simply.')}>
                                        What is retrieval-augmented generation (RAG)? Explain simply.
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Chat Messages */
                        <div className="messages-container">
                            {currentSession.messages.map((msg, idx) => {
                                const isUser = msg.role === 'user';
                                const isLast = idx === currentSession.messages.length - 1;

                                 // Determine text to copy for non-image assistant messages
                                let copyText = msg.content || '';
                                if (!isUser && !msg.isImage) {
                                    if (msg.reasoning) {
                                        copyText = msg.content || '';
                                    } else {
                                        const parsed = parseThinkingContent(msg.content || '', isGenerating, isLast);
                                        copyText = parsed.contentText || msg.content || '';
                                    }
                                }

                                return (
                                    <div key={idx} className={`message-row ${isUser ? 'user-row' : 'assistant-row'}`}>
                                        <div className="message-avatar">
                                            {isUser ? <i className="fa-regular fa-user"></i> : <i className="fa-solid fa-wand-magic-sparkles"></i>}
                                        </div>
                                        <div className={`message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'} ${msg.isImage ? 'image-bubble' : ''}`} data-raw-text={msg.content}>
                                            <div className="message-body">
                                                {msg.isImage ? (
                                                    <ImageMessageContent 
                                                        msg={msg} 
                                                        onZoom={(url, prompt) => setLightboxImage({ url, prompt })} 
                                                        onDownload={handleDownloadImage}
                                                        showToast={showToast}
                                                    />
                                                ) : isUser ? (
                                                    msg.content
                                                ) : (
                                                    <AssistantMessageBubble 
                                                        msg={msg}
                                                        isGenerating={isGenerating}
                                                        isLast={isLast}
                                                    />
                                                )}
                                            </div>
                                            {!msg.isImage && (
                                                <div className="message-footer">
                                                    <button 
                                                        className="message-action-btn" 
                                                        onClick={(e) => handleCopyMessageText(isUser ? msg.content : copyText, e.currentTarget)} 
                                                        title="Copy entire message"
                                                    >
                                                        <i className="fa-regular fa-copy"></i> Copy
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            
                            {/* Web Search Loading Indicator */}
                            {isSearchingWeb && (
                                <div className="search-loading-container">
                                    <div className="search-loading-bubble">
                                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                                        <span>Đang tìm kiếm thông tin trên internet...</span>
                                    </div>
                                </div>
                            )}

                            {/* Typing/Loading Indicator */}
                            {isGenerating && currentSession.messages[currentSession.messages.length - 1]?.role === 'user' && (
                                <div className="typing-indicator-container">
                                    <div className="typing-bubble">
                                        <span className="typing-dot"></span>
                                        <span className="typing-dot"></span>
                                        <span className="typing-dot"></span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Input Controls Area */}
                <footer className="input-area-container">
                    <div className="input-toolbar">
                        <div className="toolbar-left"></div>
                        <div className="toolbar-right">
                            {isGenerating && (
                                <button className="toolbar-btn" title="Stop generating" onClick={handleStopGeneration}>
                                    <i className="fa-solid fa-circle-stop"></i> Stop Generating
                                </button>
                            )}
                        </div>
                    </div>
                    <div className={`input-box-wrapper ${isImageMode ? 'image-mode-active' : ''}`}>
                        <button 
                            className={`image-mode-toggle-btn ${isImageMode ? 'active' : ''}`}
                            onClick={handleToggleImageMode}
                            title={isImageMode ? "Chuyển sang chế độ Chat" : "Chuyển sang chế độ Tạo ảnh (Text-to-Image)"}
                        >
                            <i className="fa-solid fa-palette"></i>
                        </button>

                        <textarea 
                            ref={inputRef}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder={isImageMode ? "Mô tả bức ảnh bạn muốn vẽ bằng tiếng Anh hoặc tiếng Việt..." : "Nhắn tin cho Gemma..."} 
                            rows="1" 
                            disabled={!isOnline && (!isImageMode || settings.imageEngine !== 'pollinations')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                        ></textarea>

                        <button 
                            className="send-btn" 
                            title="Send Message" 
                            onClick={handleSendMessage}
                            disabled={inputValue.trim() === '' || isGenerating || (!isOnline && (!isImageMode || settings.imageEngine !== 'pollinations'))}
                        >
                            <svg 
                                viewBox="0 0 24 24" 
                                width="18" 
                                height="18" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2" 
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                            >
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                    <div className="input-footer">
                        <span>Connected to: <strong>{settings.apiUrl}</strong></span>
                    </div>
                </footer>
            </main>

            {/* Settings Drawer Modal Overlay */}
            {isSettingsOpen && (
                <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
                    <div className="settings-modal animate-slide-up" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Connection & Model Settings</h3>
                            <button className="close-modal-btn" onClick={() => setIsSettingsOpen(false)}>
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="settings-section">
                                <h4>API Configuration</h4>
                                
                                <div className="form-group">
                                    <label>Cấu hình nhanh (Preset)</label>
                                    <select 
                                        value={formSettings.apiUrl && formSettings.apiUrl.includes('openrouter.ai') ? 'openrouter' : 'cic'}
                                        onChange={(e) => {
                                            if (e.target.value === 'openrouter') {
                                                setFormSettings(prev => ({
                                                    ...prev,
                                                    apiUrl: 'https://openrouter.ai/api/v1',
                                                    connectionType: 'direct',
                                                    selectedModel: 'nvidia/nemotron-3-ultra-550b-a55b:free'
                                                }));
                                                setModels([]);
                                            } else {
                                                setFormSettings(prev => ({
                                                    ...prev,
                                                    apiUrl: 'https://ai-api.cic.com.vn:9443/v1',
                                                    connectionType: 'proxy',
                                                    selectedModel: ''
                                                }));
                                                setModels([]);
                                            }
                                        }}
                                    >
                                        <option value="cic">CIC AI API (Mặc định)</option>
                                        <option value="openrouter">OpenRouter Free Models (NVIDIA & Khác)</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Connection Mode</label>
                                    <select 
                                        value={formSettings.connectionType}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, connectionType: e.target.value }))}
                                    >
                                        <option value="proxy">(Recommended) Local Proxy Server - bypass CORS</option>
                                        <option value="direct">Direct Browser Fetch - requires CORS enabled on API</option>
                                    </select>
                                    <small className="form-help">Use Proxy mode if browser displays CORS blocked errors.</small>
                                </div>

                                <div className="form-group">
                                    <label>API Base URL</label>
                                    <input 
                                        type="text" 
                                        placeholder="e.g. https://ai-api.cic.com.vn:9443/v1" 
                                        value={formSettings.apiUrl}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, apiUrl: e.target.value.trim() }))}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>CIC AI API Key</label>
                                    <div className="password-input-wrapper">
                                        <input 
                                            type={cicApiKeyVisible ? "text" : "password"} 
                                            placeholder="Nhập CIC AI API Key"
                                            value={formSettings.cicApiKey || ''}
                                            onChange={(e) => setFormSettings(prev => ({ ...prev, cicApiKey: e.target.value.trim() }))}
                                        />
                                        <button 
                                            type="button" 
                                            className="toggle-password-btn" 
                                            onClick={() => setCicApiKeyVisible(prev => !prev)}
                                        >
                                            <i className={`fa-regular ${cicApiKeyVisible ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>OpenRouter API Key</label>
                                    <div className="password-input-wrapper">
                                        <input 
                                            type={openrouterApiKeyVisible ? "text" : "password"} 
                                            placeholder="Nhập OpenRouter API Key"
                                            value={formSettings.openrouterApiKey || ''}
                                            onChange={(e) => setFormSettings(prev => ({ ...prev, openrouterApiKey: e.target.value.trim() }))}
                                        />
                                        <button 
                                            type="button" 
                                            className="toggle-password-btn" 
                                            onClick={() => setOpenrouterApiKeyVisible(prev => !prev)}
                                        >
                                            <i className={`fa-regular ${openrouterApiKeyVisible ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-section">
                                <h4>Model Selector</h4>
                                <div className="form-group">
                                    <label>Select Model</label>
                                    <div className="model-select-wrapper">
                                        <select 
                                            value={formSettings.selectedModel}
                                            onChange={(e) => setFormSettings(prev => ({ ...prev, selectedModel: e.target.value }))}
                                            disabled={displayedModels.length === 0}
                                        >
                                            {displayedModels.length === 0 ? (
                                                <option value="">-- Load models first --</option>
                                            ) : (
                                                displayedModels.map(m => (
                                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                                ))
                                            )}
                                        </select>
                                        <button 
                                            type="button" 
                                            className="action-btn-secondary" 
                                            onClick={() => fetchModels(formSettings)}
                                            disabled={isFetchingModels}
                                        >
                                            <i className="fa-solid fa-rotate"></i> {isFetchingModels ? 'Fetching...' : 'Fetch'}
                                        </button>
                                    </div>
                                    <small className="form-help">Fetches models dynamically from the `/v1/models` endpoint.</small>
                                </div>
                            </div>

                            <div className="settings-section">
                                <h4>Image Generation</h4>
                                <div className="form-group">
                                    <label>Engine tạo ảnh (Image Engine)</label>
                                    <select 
                                        value={formSettings.imageEngine}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, imageEngine: e.target.value }))}
                                    >
                                        <option value="pollinations">Pollinations AI (Miễn phí, Không cần API Key)</option>
                                        <option value="openai">OpenAI Compatible API (Dùng API URL & Key)</option>
                                    </select>
                                </div>

                                {formSettings.imageEngine === 'pollinations' ? (
                                    <div className="form-group">
                                        <label>Mô hình (Model)</label>
                                        <select 
                                            value={formSettings.pollinationsModel}
                                            onChange={(e) => setFormSettings(prev => ({ ...prev, pollinationsModel: e.target.value }))}
                                        >
                                            <option value="flux">Flux.1 Schnell (Mặc định - Đẹp, nhanh)</option>
                                            <option value="flux-realism">Flux Realism (Chân thực)</option>
                                            <option value="flux-anime">Flux Anime (Hoạt hình)</option>
                                            <option value="flux-3d">Flux 3D (3D Model)</option>
                                            <option value="any-dark">Any Dark (Tối, nghệ thuật)</option>
                                        </select>
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <label>Tên mô hình ảnh (Model Name)</label>
                                        {models.length > 0 && !isCustomImageModel ? (
                                            <select 
                                                value={formSettings.openaiImageModel || ''}
                                                onChange={(e) => {
                                                    if (e.target.value === '__custom__') {
                                                        setIsCustomImageModel(true);
                                                    } else {
                                                        setFormSettings(prev => ({ ...prev, openaiImageModel: e.target.value }));
                                                    }
                                                }}
                                            >
                                                <option value="">-- Chọn mô hình tạo ảnh --</option>
                                                {models.map(m => (
                                                    <option key={m.id} value={m.id}>{m.id}</option>
                                                ))}
                                                <option value="__custom__">✍️ Nhập thủ công mô hình khác...</option>
                                            </select>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <input 
                                                    type="text"
                                                    placeholder="e.g. dall-e-3, flux-schnell"
                                                    value={formSettings.openaiImageModel || ''}
                                                    onChange={(e) => setFormSettings(prev => ({ ...prev, openaiImageModel: e.target.value }))}
                                                    style={{ flex: 1 }}
                                                />
                                                {models.length > 0 && (
                                                    <button 
                                                        type="button" 
                                                        className="action-btn-secondary"
                                                        onClick={() => setIsCustomImageModel(false)}
                                                        style={{ padding: '0 12px' }}
                                                    >
                                                        Danh sách
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        <small className="form-help">Chọn từ các mô hình máy chủ cung cấp hoặc tự nhập thủ công.</small>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Kích thước ảnh (Image Size)</label>
                                    <select 
                                        value={formSettings.imageSize}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, imageSize: e.target.value }))}
                                    >
                                        <option value="1024x1024">1:1 Square (1024x1024)</option>
                                        <option value="1024x576">16:9 Landscape (1024x576)</option>
                                        <option value="576x1024">9:16 Portrait (576x1024)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="settings-section">
                                <h4>Parameters</h4>
                                
                                <div className="form-group">
                                    <div className="slider-header">
                                        <label>Temperature</label>
                                        <span className="slider-val">{formSettings.temperature}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="2" 
                                        step="0.1" 
                                        value={formSettings.temperature}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                                    />
                                    <small class="form-help">Higher values make output more creative, lower values make it more focused.</small>
                                </div>

                                <div className="form-group">
                                    <div className="slider-header">
                                        <label>Max Completion Tokens</label>
                                        <span className="slider-val">{formSettings.maxTokens}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="256" 
                                        max="8192" 
                                        step="128" 
                                        value={formSettings.maxTokens}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>System Instruction</label>
                                    <textarea 
                                        rows="3" 
                                        placeholder="Define the AI's persona, formatting, or behavior rules..."
                                        value={formSettings.systemPrompt}
                                        onChange={(e) => setFormSettings(prev => ({ ...prev, systemPrompt: e.target.value }))}
                                    ></textarea>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={handleResetSettings}>Reset Defaults</button>
                            <button className="btn-primary" onClick={handleSaveSettings}>Save Settings</button>
                        </div>
                    </div>
                </div>
            )}
            
            {toast.show && (
                <div className={`toast-notification ${toast.type}`}>
                    <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : toast.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info'}`}></i>
                    <span>{toast.message}</span>
                </div>
            )}

            {lightboxImage && (
                <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
                    <button className="close-lightbox-btn" onClick={() => setLightboxImage(null)}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <img src={lightboxImage.url} alt={lightboxImage.prompt} />
                        <div className="lightbox-caption">
                            <p className="lightbox-prompt">{lightboxImage.prompt}</p>
                            <div className="lightbox-actions">
                                <button className="lightbox-action-btn-primary" onClick={() => handleDownloadImage(lightboxImage.url, lightboxImage.prompt)}>
                                    <i className="fa-solid fa-download"></i> Tải xuống
                                </button>
                                <button className="lightbox-action-btn-secondary" onClick={() => {
                                    copyTextToClipboard(lightboxImage.prompt);
                                    showToast('Đã sao chép prompt!', 'success');
                                }}>
                                    <i className="fa-regular fa-copy"></i> Sao chép Prompt
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

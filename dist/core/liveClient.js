import { executeCodexPrompt } from './cliAuth.js';
export const POPULAR_MODELS = {
    gemini: [
        { id: 'gemini-3.8-flash-tiered', name: 'Gemini 3.8 Flash (Latest Flagship)', provider: 'gemini', description: 'Next-gen flagship model with supreme speed and reasoning' },
        { id: 'gemini-3.7-flash-tiered', name: 'Gemini 3.7 Flash', provider: 'gemini', description: 'Cutting-edge reasoning model' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'gemini', description: 'Ultra-fast lightweight execution' },
        { id: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash', provider: 'gemini', description: 'Balanced multimodal model' },
        { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: 'gemini', description: 'High-throughput code and agent reasoning' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (via Antigravity)', provider: 'gemini', description: 'Claude Sonnet thinking model routed through Google quota' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', description: 'Production stable multimodal' },
    ],
    openai: [
        { id: 'gpt-4o', name: 'GPT-4o (Latest Flagship)', provider: 'openai', description: 'Versatile high-intelligence flagship model' },
        { id: 'o3-mini', name: 'o3-mini', provider: 'openai', description: 'High-speed deliberate reasoning model' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Lightweight fast execution model' },
    ],
    anthropic: [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Latest)', provider: 'anthropic', description: 'State-of-the-art coding and reasoning' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Lightning-fast technical execution' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', description: 'Deep analytical synthesis' },
    ],
};
/**
 * Validates an API key against the provider's live endpoint.
 */
export async function validateApiKey(provider, apiKey) {
    const cleanKey = apiKey.trim();
    if (!cleanKey)
        return { valid: false, error: 'Key cannot be empty.' };
    try {
        if (provider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`;
            const res = await fetch(url);
            if (res.ok)
                return { valid: true };
            const err = (await res.json().catch(() => ({})));
            return { valid: false, error: err?.error?.message || `HTTP ${res.status}: Invalid Gemini API Key` };
        }
        if (provider === 'openai') {
            const url = 'https://api.openai.com/v1/models';
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${cleanKey}` },
            });
            if (res.ok)
                return { valid: true };
            const err = (await res.json().catch(() => ({})));
            return { valid: false, error: err?.error?.message || `HTTP ${res.status}: Invalid OpenAI API Key` };
        }
        if (provider === 'anthropic') {
            const url = 'https://api.anthropic.com/v1/messages';
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': cleanKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'ping' }],
                }),
            });
            if (res.ok || res.status === 200)
                return { valid: true };
            const err = (await res.json().catch(() => ({})));
            return { valid: false, error: err?.error?.message || `HTTP ${res.status}: Invalid Anthropic API Key` };
        }
    }
    catch (err) {
        return { valid: false, error: err.message || 'Network connection failed' };
    }
    return { valid: false, error: 'Unknown provider' };
}
/**
 * Executes a real live LLM prompt against the selected provider, harness, and model.
 */
export async function sendLiveLlmPrompt(options) {
    const { provider, model, apiKey, authToken, harness, prompt, systemPrompt } = options;
    try {
        // 1. If OpenAI with Codex CLI harness: invoke local codex agent
        if (provider === 'openai' && harness === 'codex-cli') {
            const fullPrompt = systemPrompt ? `${systemPrompt}\n\nTask: ${prompt}` : prompt;
            return await executeCodexPrompt(fullPrompt, model);
        }
        // 2. Google Gemini
        if (provider === 'gemini') {
            const contents = [];
            if (systemPrompt) {
                contents.push({ role: 'user', parts: [{ text: `Instructions: ${systemPrompt}` }] });
                contents.push({ role: 'model', parts: [{ text: 'Understood. Ready.' }] });
            }
            contents.push({ role: 'user', parts: [{ text: prompt }] });
            // Path A: Authenticated via Google OAuth token (Antigravity / Gemini CLI)
            if (authToken) {
                const endpoints = [
                    'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
                    'https://autopush-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
                    'https://cloudcode-pa.googleapis.com/v1internal:generateContent',
                ];
                const payload = {
                    project: 'aicode-consumers',
                    model,
                    request: {
                        contents,
                    },
                };
                for (const ep of endpoints) {
                    try {
                        const res = await fetch(ep, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${authToken}`,
                                'User-Agent': 'antigravity/1.18.3 darwin/arm64',
                                'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
                            },
                            body: JSON.stringify(payload),
                        });
                        if (!res.ok)
                            continue;
                        const data = (await res.json());
                        const parts = data?.response?.candidates?.[0]?.content?.parts || [];
                        const text = parts.map((p) => p.text || '').join('').trim();
                        if (text)
                            return { text };
                    }
                    catch {
                        // Try next endpoint fallback
                    }
                }
            }
            // Path B: Fallback to Google Generative Language REST API (if apiKey provided)
            if (apiKey) {
                const restModel = model.includes('tiered') || model.includes('low') || model.includes('claude') ? 'gemini-2.0-flash' : model;
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${restModel}:generateContent?key=${apiKey}`;
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents }),
                });
                if (res.ok) {
                    const data = (await res.json());
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (text)
                        return { text };
                }
            }
            return {
                text: '',
                error: 'Unable to reach Gemini models with current credentials. Please check /auth.',
            };
        }
        // 3. OpenAI via REST API
        if (provider === 'openai') {
            if (!apiKey && !authToken) {
                return { text: '', error: 'OpenAI API key or Codex session required.' };
            }
            const messages = [];
            if (systemPrompt)
                messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: prompt });
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey || authToken}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                }),
            });
            if (!res.ok) {
                const err = (await res.json().catch(() => ({})));
                return { text: '', error: err?.error?.message || `OpenAI API Error (HTTP ${res.status})` };
            }
            const data = (await res.json());
            const text = data?.choices?.[0]?.message?.content || '';
            return { text };
        }
        // 4. Anthropic Claude
        if (provider === 'anthropic') {
            if (!apiKey) {
                return { text: '', error: 'Anthropic API key required for direct Claude completions.' };
            }
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 4096,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!res.ok) {
                const err = (await res.json().catch(() => ({})));
                return { text: '', error: err?.error?.message || `Anthropic API Error (HTTP ${res.status})` };
            }
            const data = (await res.json());
            const text = data?.content?.[0]?.text || '';
            return { text };
        }
    }
    catch (err) {
        return { text: '', error: err.message || 'Request failed' };
    }
    return { text: '', error: 'Unsupported provider' };
}

import { executeAntigravityPrompt, executeCodexPrompt } from './cliAuth.js';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
export const DEFAULT_OPENAI_REASONING_EFFORT = 'high';
export const POPULAR_MODELS = {
    gemini: [
        { id: 'gemini-3.8-flash', codeAssistId: 'gemini-3.8-flash-tiered', name: 'Gemini 3.8 Flash', provider: 'gemini', description: 'Latest flagship Flash model for complex coding and agentic work' },
        { id: 'gemini-3.7-flash', codeAssistId: 'gemini-3.7-flash-tiered', name: 'Gemini 3.7 Flash', provider: 'gemini', description: 'Fast, balanced reasoning and multimodal model' },
        { id: 'gemini-3.5-flash', codeAssistId: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash', provider: 'gemini', description: 'Balanced model; direct Gemini API key may be required' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'gemini', description: 'Lowest-latency option for lightweight tasks' },
    ],
    openai: [
        { id: DEFAULT_OPENAI_MODEL, name: 'GPT-5.6 Luna', provider: 'openai', description: 'Jarvis default: high-reasoning agentic coding model' },
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Versatile high-intelligence flagship model' },
        { id: 'o3-mini', name: 'o3-mini', provider: 'openai', description: 'High-speed deliberate reasoning model' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Lightweight fast execution model' },
    ],
    anthropic: [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Latest)', provider: 'anthropic', description: 'State-of-the-art coding and reasoning' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Lightning-fast technical execution' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', description: 'Deep analytical synthesis' },
    ],
};
const LEGACY_GEMINI_MODEL_IDS = {
    'gemini-3.8-flash-tiered': 'gemini-3.8-flash',
    'gemini-3.7-flash-tiered': 'gemini-3.7-flash',
    'gemini-3.5-flash-low': 'gemini-3.5-flash',
    'gemini-3-flash': 'gemini-3.7-flash',
    'gemini-2.5-flash': 'gemini-3.7-flash',
    'gemini-2.0-flash': 'gemini-3.7-flash',
    'gemini-1.5-pro': 'gemini-3.7-flash',
    'gemini-1.5-flash': 'gemini-3.7-flash',
};
export function normalizeModelId(provider, model) {
    const defaultModel = POPULAR_MODELS[provider][0].id;
    if (!model)
        return defaultModel;
    const normalized = provider === 'gemini' ? LEGACY_GEMINI_MODEL_IDS[model] || model : model;
    return POPULAR_MODELS[provider].some((option) => option.id === normalized) ? normalized : defaultModel;
}
export function getGeminiCodeAssistModelId(model) {
    const normalized = normalizeModelId('gemini', model);
    return POPULAR_MODELS.gemini.find((option) => option.id === normalized)?.codeAssistId || normalized;
}
function supportsReasoningEffort(model) {
    return /^gpt-5(?:\.|-|$)/i.test(model) || /^o\d/i.test(model);
}
function extractApiError(payload, fallback) {
    return payload?.error?.message || payload?.message || fallback;
}
function getAntigravityModelId(model) {
    const normalized = normalizeModelId('gemini', model);
    const base = normalized === 'gemini-3.5-flash' || normalized === 'gemini-3.1-flash-lite'
        ? 'gemini-3.7-flash'
        : normalized;
    const effort = /-(high|medium|low)$/i.exec(model)?.[1]?.toLowerCase() || 'low';
    return `${base}-${effort}`;
}
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
    const { provider, model, apiKey, authToken, harness, prompt, systemPrompt, reasoningEffort } = options;
    const selectedReasoningEffort = reasoningEffort || (provider === 'openai' ? DEFAULT_OPENAI_REASONING_EFFORT : undefined);
    try {
        // 1. If OpenAI with Codex CLI harness: invoke local codex agent
        if (provider === 'openai' && harness === 'codex-cli') {
            const fullPrompt = systemPrompt ? `${systemPrompt}\n\nTask: ${prompt}` : prompt;
            return await executeCodexPrompt(fullPrompt, model, selectedReasoningEffort);
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
            if (harness === 'antigravity-cli') {
                const fullPrompt = systemPrompt ? `${systemPrompt}\n\nTask: ${prompt}` : prompt;
                return await executeAntigravityPrompt(fullPrompt, getAntigravityModelId(model));
            }
            if (authToken) {
                const codeAssistModel = getGeminiCodeAssistModelId(model);
                const endpoints = [
                    'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
                    'https://autopush-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
                    'https://cloudcode-pa.googleapis.com/v1internal:generateContent',
                ];
                const payload = {
                    project: 'aicode-consumers',
                    model: codeAssistModel,
                    request: {
                        contents,
                    },
                };
                const endpointErrors = [];
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
                        if (!res.ok) {
                            const errorPayload = await res.json().catch(() => ({}));
                            endpointErrors.push({
                                status: res.status,
                                message: extractApiError(errorPayload, `HTTP ${res.status}`),
                            });
                            continue;
                        }
                        const data = (await res.json());
                        const parts = data?.response?.candidates?.[0]?.content?.parts || [];
                        const text = parts.map((p) => p.text || '').join('').trim();
                        if (/no longer available|not available/i.test(text)) {
                            return {
                                text: '',
                                error: `${model} is not available through your Google Code Assist session. Choose another model with /model, or use a Gemini API key if that model is available to your API project.`,
                            };
                        }
                        if (text)
                            return { text };
                        endpointErrors.push({ status: 502, message: 'Google returned an empty response.' });
                    }
                    catch (error) {
                        endpointErrors.push({ status: 0, message: error?.message || 'Network request failed.' });
                    }
                }
                if (!apiKey) {
                    const authRejected = endpointErrors.some(({ status }) => status === 401 || status === 403);
                    const detail = endpointErrors.find(({ message }) => message)?.message;
                    return {
                        text: '',
                        error: authRejected
                            ? `Google rejected the current Code Assist session${detail ? `: ${detail}` : '.'} Run /auth to reconnect once.`
                            : `${model} could not be used through Google Code Assist${detail ? `: ${detail}` : '.'} Choose another model with /model.`,
                    };
                }
            }
            // Path B: Fallback to Google Generative Language REST API (if apiKey provided)
            if (apiKey) {
                const apiModel = normalizeModelId('gemini', model);
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents }),
                });
                const data = (await res.json().catch(() => ({})));
                if (res.ok) {
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (text)
                        return { text };
                }
                return {
                    text: '',
                    error: extractApiError(data, `Gemini API request failed (HTTP ${res.status}).`),
                };
            }
            return {
                text: '',
                error: 'No usable Gemini credential is available. Run /auth to connect Google Code Assist or enter a Gemini API key.',
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
                    ...(selectedReasoningEffort && supportsReasoningEffort(model)
                        ? { reasoning_effort: selectedReasoningEffort }
                        : {}),
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

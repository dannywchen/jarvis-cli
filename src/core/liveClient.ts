import { UserProfile } from '../types/index.js';
import { executeCodexPrompt } from './cliAuth.js';

export type ProviderType = 'gemini' | 'openai' | 'anthropic';

export interface ModelOption {
  id: string;
  name: string;
  provider: ProviderType;
  description: string;
}

export const POPULAR_MODELS: Record<ProviderType, ModelOption[]> = {
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Latest)', provider: 'gemini', description: 'Next-gen multimodal, ultra-fast generation' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', description: 'Advanced multimodal agentic reasoning' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', description: 'Deep reasoning with 2M token context' },
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
export async function validateApiKey(provider: ProviderType, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return { valid: false, error: 'Key cannot be empty.' };

  try {
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`;
      const res = await fetch(url);
      if (res.ok) return { valid: true };
      const err = ((await res.json().catch(() => ({}))) as any);
      return { valid: false, error: err?.error?.message || `HTTP ${res.status}: Invalid Gemini API Key` };
    }

    if (provider === 'openai') {
      const url = 'https://api.openai.com/v1/models';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (res.ok) return { valid: true };
      const err = ((await res.json().catch(() => ({}))) as any);
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
      if (res.ok || res.status === 200) return { valid: true };
      const err = ((await res.json().catch(() => ({}))) as any);
      return { valid: false, error: err?.error?.message || `HTTP ${res.status}: Invalid Anthropic API Key` };
    }
  } catch (err: any) {
    return { valid: false, error: err.message || 'Network connection failed' };
  }

  return { valid: false, error: 'Unknown provider' };
}

/**
 * Executes a real live LLM prompt against the selected provider, harness, and model.
 */
export async function sendLiveLlmPrompt(options: {
  provider: ProviderType;
  model: string;
  apiKey?: string | null;
  authToken?: string | null;
  harness?: string | null;
  prompt: string;
  systemPrompt?: string;
}): Promise<{ text: string; error?: string }> {
  const { provider, model, apiKey, authToken, harness, prompt, systemPrompt } = options;

  try {
    // 1. If OpenAI with Codex CLI harness: invoke local codex agent
    if (provider === 'openai' && harness === 'codex-cli') {
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\nTask: ${prompt}` : prompt;
      return await executeCodexPrompt(fullPrompt, model);
    }

    // 2. Google Gemini
    if (provider === 'gemini') {
      let endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      if (apiKey) {
        endpoint += `?key=${apiKey}`;
      } else if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const contents: any[] = [];
      if (systemPrompt) {
        contents.push({ role: 'user', parts: [{ text: `Instructions: ${systemPrompt}` }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood. Ready.' }] });
      }
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ contents }),
      });

      if (!res.ok) {
        const err = ((await res.json().catch(() => ({}))) as any);
        return { text: '', error: err?.error?.message || `Gemini API Error (HTTP ${res.status})` };
      }

      const data = (await res.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { text };
    }

    // 3. OpenAI via REST API
    if (provider === 'openai') {
      if (!apiKey && !authToken) {
        return { text: '', error: 'OpenAI API key or Codex session required.' };
      }

      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
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
        const err = ((await res.json().catch(() => ({}))) as any);
        return { text: '', error: err?.error?.message || `OpenAI API Error (HTTP ${res.status})` };
      }

      const data = (await res.json()) as any;
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
        const err = ((await res.json().catch(() => ({}))) as any);
        return { text: '', error: err?.error?.message || `Anthropic API Error (HTTP ${res.status})` };
      }

      const data = (await res.json()) as any;
      const text = data?.content?.[0]?.text || '';
      return { text };
    }
  } catch (err: any) {
    return { text: '', error: err.message || 'Request failed' };
  }

  return { text: '', error: 'Unsupported provider' };
}

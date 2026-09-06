export type ProviderType = 'gemini' | 'openai' | 'anthropic';
export interface ModelOption {
    id: string;
    name: string;
    provider: ProviderType;
    description: string;
}
export declare const POPULAR_MODELS: Record<ProviderType, ModelOption[]>;
/**
 * Validates an API key against the provider's live endpoint.
 */
export declare function validateApiKey(provider: ProviderType, apiKey: string): Promise<{
    valid: boolean;
    error?: string;
}>;
/**
 * Executes a real live LLM prompt against the selected provider, harness, and model.
 */
export declare function sendLiveLlmPrompt(options: {
    provider: ProviderType;
    model: string;
    apiKey?: string | null;
    authToken?: string | null;
    harness?: string | null;
    prompt: string;
    systemPrompt?: string;
}): Promise<{
    text: string;
    error?: string;
}>;

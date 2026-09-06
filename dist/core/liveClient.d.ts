export type ProviderType = 'gemini' | 'openai' | 'anthropic';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export declare const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
export declare const DEFAULT_OPENAI_REASONING_EFFORT: ReasoningEffort;
export interface ModelOption {
    id: string;
    name: string;
    provider: ProviderType;
    description: string;
    codeAssistId?: string;
}
export declare const POPULAR_MODELS: Record<ProviderType, ModelOption[]>;
export declare function normalizeModelId(provider: ProviderType, model?: string): string;
export declare function getGeminiCodeAssistModelId(model: string): string;
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
    reasoningEffort?: ReasoningEffort;
}): Promise<{
    text: string;
    error?: string;
}>;

/**
 * llm-gateway.ts — ClawDao 统一 LLM 网关
 *
 * 默认：MiniMax M3（多模态，支持文本+图像输入）
 * 也支持 MiniMax-M2.7、MiniMax-M2.7-highspeed 等纯文本场景
 *
 * 鉴权：走 MiniMax 网关，baseUrl 默认 https://agent.minimaxi.com/mavis/api/v1/llm/v1
 * （实际 MiniMax 国际区是 https://api.minimax.io/v1，按需切换）
 */

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: 'MiniMax-M3' | 'MiniMax-M2.7' | 'MiniMax-M2.7-highspeed';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

export interface LLMResponse {
  id: string;
  content: string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

const DEFAULT_BASE = 'https://agent.minimaxi.com/mavis/api/v1/llm/v1';

export async function chat(
  messages: LLMMessage[],
  config: LLMConfig
): Promise<LLMResponse> {
  const url = `${config.baseUrl ?? DEFAULT_BASE}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model ?? 'MiniMax-M3',
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      messages,
    }),
    signal: config.signal,
  });

  if (!res.ok) {
    throw new Error(`LLM API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    id: string;
    content: Array<{ text: string }>;
    model: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  return {
    id: json.id,
    content: json.content.map((c) => c.text).join(''),
    model: json.model,
    usage: json.usage && {
      input_tokens: json.usage.input_tokens,
      output_tokens: json.usage.output_tokens,
    },
  };
}

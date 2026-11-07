// Shared Nemotron wrapper (spec sections 4, 11, 15). Shared by agents + coordinator.
// DRAFT interface — agree on it as a team in milestone 1, then implement.
// Every Nemotron call in the repo goes through here so tokens are always logged.

export type Purpose = 'plan' | 'code' | 'context' | 'test_fix' | 'merge_fix' | 'coordination';

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run: (args: any) => Promise<string>;
}

export interface CallOptions {
  model: string;
  purpose: Purpose;
  temperature?: number; // default 0 for demo determinism
  signal?: AbortSignal; // worker aborts on pause (early stop)
  onUsage: (usage: Usage, purpose: Purpose) => void | Promise<void>; // -> contract.logTokens
}

export interface LLM {
  /** One completion, no tools. */
  chat(messages: ChatMessage[], opts: CallOptions): Promise<{ content: string; usage: Usage }>;
  /** Tool-calling loop: runs tools until the model stops calling them or maxSteps is hit. */
  runTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    opts: CallOptions & { maxSteps?: number },
  ): Promise<{ messages: ChatMessage[]; usage: Usage }>;
}

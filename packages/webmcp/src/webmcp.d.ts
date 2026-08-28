export {};

declare global {
  interface ModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute(input: unknown, options?: { signal?: AbortSignal }): unknown | Promise<unknown>;
  }

  interface ModelContext {
    registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void>;
    getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredModelContextTool[]>;
    executeTool(tool: RegisteredModelContextTool, inputArguments?: string, options?: { signal?: AbortSignal }): Promise<string>;
  }

  interface RegisteredModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: string;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  }

  interface Document {
    readonly modelContext?: ModelContext;
  }
}

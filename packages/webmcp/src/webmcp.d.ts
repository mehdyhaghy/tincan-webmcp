export {};

declare global {
  interface ModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute(input: Record<string, unknown>, options: { signal: AbortSignal }): unknown | Promise<unknown>;
  }

  interface ModelContextRegisterToolOptions {
    exposedTo?: string[];
    signal?: AbortSignal;
  }

  interface ModelContext {
    registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>;
    getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredModelContextTool[]>;
    executeTool(
      tool: RegisteredModelContextTool,
      inputArguments?: Record<string, unknown> | string,
      options?: { signal?: AbortSignal },
    ): Promise<string>;
  }

  interface RegisteredModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown> | string;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    origin?: string;
    window?: Window;
  }

  interface Document {
    readonly modelContext?: ModelContext;
  }
}

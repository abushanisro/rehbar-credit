/**
 * Deno type definitions for local IDE compatibility in Supabase Edge Functions.
 * These stubs satisfy the TypeScript compiler without requiring the Deno extension.
 */

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// Re-export supabase-js types for the esm.sh URL import used in edge functions
declare module "https://esm.sh/@supabase/supabase-js@2.45.4" {
  export * from "@supabase/supabase-js";
}

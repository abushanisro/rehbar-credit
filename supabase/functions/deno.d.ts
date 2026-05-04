/**
 * Deno type definitions for local IDE compatibility in Supabase Functions.
 */
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

// Public (browser-safe) configuration. NEXT_PUBLIC_* values are inlined at
// build time, so they must be referenced literally.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Cricket Auction";
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
/** Label shown after amounts, e.g. "pts", "₹", "L". */
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY_LABEL || "pts";

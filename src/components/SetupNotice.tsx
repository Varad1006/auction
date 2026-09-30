import { isConfigured } from "@/lib/env";

export function SetupNotice() {
  if (isConfigured) return null;
  return (
    <div className="mx-auto mt-4 max-w-3xl rounded-xl bg-amber-400/10 p-4 text-sm text-amber-100 ring-1 ring-amber-400/30">
      <p className="font-semibold">Supabase is not configured.</p>
      <p className="mt-1 text-amber-200/80">
        Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README) and rebuild.
      </p>
    </div>
  );
}

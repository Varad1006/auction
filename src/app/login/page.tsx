import { LoginPanel } from "./LoginPanel";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <LoginPanel next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} error={error ?? null} />;
}

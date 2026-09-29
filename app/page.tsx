import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeSource } from "@/lib/invites";
import LandingPage from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "ForeThought — a coach and caddy for the rest of us",
  description: "Rich? Already good at golf? This app was not written for you. For everyone else: meet Frankie, an AI coach and caddy that remembers your game.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/chat");

  const { src } = await searchParams;
  return <LandingPage source={normalizeSource(src)} />;
}

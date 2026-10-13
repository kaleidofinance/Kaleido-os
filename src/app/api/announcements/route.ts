import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * The latest product-update announcements, newest first. Public and read-only;
 * rows are written by scripts/announce.mjs with the service role. Cached at the
 * edge for a minute — every open tab polls this.
 */
export const revalidate = 60;

export async function GET() {
  if (!supabaseAdmin) return NextResponse.json({ announcements: [] });
  const { data, error } = await supabaseAdmin
    .from("announcements")
    .select("id, title, body, url, cta, published_at")
    .eq("active", true)
    .lte("published_at", new Date().toISOString())
    .order("id", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ announcements: [] });
  return NextResponse.json(
    {
      announcements: (data ?? []).map((r) => ({
        id: Number(r.id),
        title: r.title,
        body: r.body,
        url: r.url ?? null,
        cta: r.cta ?? null,
        publishedAt: r.published_at,
      })),
    },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}

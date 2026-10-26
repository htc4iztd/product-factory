import { agentRaw } from "@/lib/agent";

// オントロジーを SKOS（Turtle / JSON-LD）で保存する
export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") === "json-ld" ? "json-ld" : "turtle";
  const r = await agentRaw(`/ontology/export?format=${format}`);
  const ext = format === "turtle" ? "ttl" : "jsonld";
  return new Response(r.body, { status: r.status, headers: {
    "content-type": r.headers.get("content-type") ?? "text/plain; charset=utf-8",
    "content-disposition": `attachment; filename="ontology.${ext}"`, "cache-control": "private, no-store",
  } });
}

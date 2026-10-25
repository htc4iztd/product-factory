import crypto from "node:crypto";
import { agentInternal } from "@/lib/agent";

// GitHub の webhook（issues・issue_comment）を受けて、そのリポジトリと同期しているプロダクトを取り込み直す。
// 署名（X-Hub-Signature-256）を GITHUB_WEBHOOK_SECRET で確かめてから agent-api に中継する。
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;

export async function POST(req: Request) {
  if (!SECRET) return new Response("webhook is not configured", { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return new Response("bad signature", { status: 401 });
  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return Response.json({ ok: true });
  let repo = "";
  try {
    repo = JSON.parse(raw)?.repository?.full_name ?? "";
  } catch {
    return new Response("bad payload", { status: 400 });
  }
  if (!repo) return Response.json({ ok: true, skipped: true });
  const r = await agentInternal("/github/webhook", { event, repo });
  return Response.json(r);
}

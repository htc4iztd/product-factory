# Product Factory (MVP / R0)

1人の Product Builder が、アイデアから運用まで 14 ステージ（P1〜P5、ゲート G1〜G4）を 1 つの Web アプリ上で回すための工場。
AWS Labs の AI-DLC を拡張し、Google ADK 2.x の Workflow で各ステージを動かす。設計は [docs/design.md](docs/design.md)。

## 構成

```
apps/web          Next.js 16 + Auth.js v5（テナントとロールはセッションからだけ渡す）
services/agent    FastAPI + Google ADK 2.13（ステージ実行・工場DB・監査ログ）
infra/nginx       リバースプロキシ（外に出すのは web だけ）
infra/terraform   gcp（Cloud Run の土台：Artifact Registry / Secret Manager / サービスアカウント / Workload Identity）
.github/workflows ci / infra / deploy
```

設計からの差分（R0 時点）

- ステージの順序とゲートは工場エンジン（決定的なコード）が持ち、各ステージの中身（質問→生成→自己監査→承認）を ADK の Workflow が 1 ステージ実行 = 1 セッションで動かす。人の入力待ち（RequestInput）は DB に残り、プロセスを再起動しても再開できる（テストで確認済み）。
- web の DB アクセスは Prisma ではなく `pg` + `apps/web/db/schema.sql`。テーブルは Tenant / User / TenantMember の3つ。Prisma のエンジン取得が開発環境から遮断されたためで、テーブルが 3 つだけなのでこのまま進める。
- ループ L1〜L5、トレーサビリティ画面、worker / scheduler は R2。ナビには「R2」として無効表示している。
- `GOOGLE_API_KEY` が無ければ LLM はスタブ（必須見出しを埋めたダミー成果物）になり、全工程をそのまま通せる。

## ローカルで動かす

```bash
cp .env.example .env   # AUTH_SECRET と PF_INTERNAL_TOKEN を埋める
docker compose up -d --build
open http://localhost   # /register で登録すると、その人が個人テナントの OWNER になる
```

コンテナを使わない場合

```bash
# agent-api
cd services/agent && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
DATABASE_URL=postgresql://pf@127.0.0.1:5432/pf PF_LLM=stub uvicorn pf_agent.api:app --port 8100
# web
cd apps/web && npm ci && DATABASE_URL=postgresql://pf@127.0.0.1:5432/pf AUTH_SECRET=dev npm run dev
```

## テスト

- `services/agent`: `pytest`（全周回・ゲート・差し戻しと要再確認・テナント分離・再起動後の再開）
- `apps/web`: `BASE=http://localhost:3000 node e2e/full-cycle.mjs`（登録→プロダクト作成→14 ステージ→4 ゲート→監査ログを画面操作で通す）

## デプロイ（Cloud Run + Supabase）

web と agent-api を Cloud Run（東京）に置き、DB は Supabase（東京）を使う。nginx はローカル用で、Cloud Run では使わない。

```
利用者 ─HTTPS→ Cloud Run pf-web（公開） ─ID トークン→ Cloud Run pf-agent（IAM で非公開）
                      └────────────┬──────────────┘
                         Supabase Postgres（session モードの接続プール）
```

1. **Supabase**：東京リージョンでプロジェクトを作る。
   - Connect → **Session pooler** の接続文字列を控え、末尾に `?sslmode=require` を付ける（パスワードに記号があれば URL エンコードする）。
   - テーブルはサーバーからだけ使うので、Project Settings → Data API を無効にする。
2. **GCP**：課金を有効にしたプロジェクトで Cloud Shell を開き、土台を作って秘密値を入れる。
   ```bash
   git clone https://github.com/<owner>/<name> && cd <name>/infra/terraform/gcp
   terraform init && terraform apply -var project_id=<PROJECT_ID> -var github_repo=<owner>/<name>
   gcloud config set project <PROJECT_ID>
   read -rs V && printf '%s' "$V" | gcloud secrets versions add DATABASE_URL --data-file=-     # 1 の接続文字列
   read -rs V && printf '%s' "$V" | gcloud secrets versions add GOOGLE_API_KEY --data-file=-   # Gemini を使うときだけ
   terraform output
   ```
   state は Cloud Shell の手元に残る（リポジトリには入れない）。
3. **GitHub**：Environment `production` を作る（必要なら Required reviewers を付ける）。Variables に `terraform output` の `GCP_PROJECT_ID`、`GCP_REGION`、`GCP_WIF_PROVIDER`、`GCP_DEPLOY_SA` を入れる。任意で次も入れる。
   - `PF_GEMINI=true`：Gemini を使う（無ければスタブ）。`PF_MODEL` でモデルを変えられる。
   - `PF_ALLOW_SIGNUP=false`：自分の登録が済んだら入れて、新規登録を締め切る。
4. Actions → `deploy` → Run workflow。以後は main への push で `ci` 成功後に自動で更新される。web の URL はジョブのサマリーに出る。

Supabase の session モードは同時接続数に上限があるので、Cloud Run は各サービス最大1台、DB の接続は各2本（`PF_DB_POOL_SIZE`）にしている。

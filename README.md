# Product Factory (MVP / R0)

1人の Product Builder が、アイデアから運用まで 14 ステージ（P1〜P5、ゲート G1〜G4）を 1 つの Web アプリ上で回すための工場。
AWS Labs の AI-DLC を拡張し、Google ADK 2.x の Workflow で各ステージを動かす。設計は [docs/design.md](docs/design.md)。

## 構成

```
apps/web          Next.js 16 + Auth.js v5（テナントとロールはセッションからだけ渡す）
services/agent    FastAPI + Google ADK 2.13（ステージ実行・工場DB・監査ログ）
infra/nginx       リバースプロキシ（外に出すのは web だけ）
infra/terraform   bootstrap（tfstate / GitHub OIDC）と envs/mvp（ステージB：EC2 + docker compose）
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

## AWS へのデプロイ（ステージB）

1. 手元で一度だけ `infra/terraform/bootstrap` を apply（`-var github_repo=owner/name`）。出力の tfstate バケットとロール ARN を控える。
2. GitHub の Variables に `AWS_REGION`、`TF_STATE_BUCKET`、`AWS_TF_ROLE_ARN` を設定し、Environment `aws-mvp` を作って Required reviewers を付ける。
3. `infra` ワークフローで `envs/mvp` を apply。出力の `deploy_role_arn` を Variables の `AWS_DEPLOY_ROLE_ARN` に入れる。
4. Gemini を使うなら Parameter Store の `/pf/mvp/env/GOOGLE_API_KEY` に値を入れる。
5. main に push → `ci` 成功後に `deploy` が ECR へ push し、SSM Run Command で EC2 上の compose を更新する。

ステージA（ECS Fargate + RDS）への移行は R2 以降。

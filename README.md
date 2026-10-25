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
- 工程の順序でロックしない。どのステージからでも始められ、最新版が変わると参照している下流が「要再確認」になる。フェーズ末の審査（G1〜G4）は進行のロックではなく判断の記録。
- プロダクトごとに、ステージを使うか（開閉）と、更新に承認を求めるかを設定できる。承認の既定は個人モードがなし、法人モードがあり。
- 成果物は文章ではなく項目ごとの値（下書き）で持つ。P1〜P2 はフレームワーク（①リーンキャンバス、②TAM/SAM/SOM、③競合比較とポジショニング、④バリュープロポジションキャンバス、⑤KPIツリー・PL）、⑦は業務一覧（業務領域→業務→作業の階層と種類）とスイムレーン型の業務フロー（フローエディタ）・業務ルール・役割・例外。⑥はペルソナ・ストーリーマップ（US-xx）・受入基準（AC-xx）・画面一覧、⑧は機能要求（FR-xx、ストーリーIDで⑥とつなぐ）・非機能要求（IPA 非機能要求グレードの6分類と水準）・外部接続、⑬は⑥の受入基準を取り込んだ網羅表とテストケース。ID は空なら自動で振り、⑥→⑧、⑥→⑬ の網羅を画面に出す。⑨⑩⑪⑫⑭は見出しごとの文書（順に構造化する）。更新すると版になり、Markdown にして下流と監査に渡す。
- 各ステージの右側でAIと対話する。AIは項目ごとの書き換え案を出し、人が採用したものだけが下書きに入る。対話の1往復は ADK の Workflow（発言と案を作る → 案を項目の型で検査して保存）で動く。
- 概要ページの上部（プロダクト名・進み具合の下）に「プロダクト・キャンバス」を置く。①リーンキャンバスと④バリュープロポジションの値（最新版を優先、なければ下書き）から画像生成AIでプロダクトの全体像（利用シーン／画面イメージ／コンセプト）を描き、表紙として同じテナントの人と共有する。画像は使ったプロンプトと一緒に工場DBに残す。モデルは `PF_IMAGE_MODEL`（既定 `gemini-3.1-flash-image`）、APIキーがなければ仮のSVG。
- ⑤のKPIツリーはグラフで編集する（KPIを選んで子を足す、点をドラッグして親子をつなぎ替える、分解の式 × / + を決める）。値は表と同じ行（KPI・親KPI・分解の式・目標値・計測方法）で持つので、AIの案もそのまま使える。
- サイドバーはボタンか `[` キーで隠す・表示する。右側のパネル（AIタブ・参照タブ）は `]` キーかタブで開閉する。どちらも状態は cookie に残す。
- AIタブの対話はセッションに分けられる（新しく始める・切り替える・名前を変える）。各セッションは ADK のセッションと1対1。「レポート」でステージの全セッションを要約・決まったこと・却下した案・未決事項にまとめる。
- 参照タブでは、事業フェーズ（①〜⑤）の成果物（最新版、なければ下書き）をその場で読める。
- 文書タブは編集できる。「## 項目名」の見出しごとにキャンバスの項目へ反映する（フローなど文書から読めない項目は変えない）。
- 「確定」ではなく「更新」と呼ぶ。下書きを更新すると版が1つ増え、その版が最新版になる。
- ループ L1〜L5、トレーサビリティ画面、worker / scheduler は R2。
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

- `services/agent`: `pytest`（対話・採用・更新・承認と差し戻し・要再確認・設定・テナント分離・対話セッションとレポート・再起動後の対話の継続・文書からの反映）
- `apps/web`: `BASE=http://localhost:3000 node e2e/full-cycle.mjs`（登録→①〜⑤をAIの下書き・採用・更新で通す→文書タブからの反映→承認と差し戻し→下流の要再確認→ステージの開閉→参照タブ→対話セッションとレポート→振り返り）

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
   - `PF_GEMINI=true`：Gemini を使う（無ければスタブ）。`PF_MODEL` で対話のモデル、`PF_IMAGE_MODEL` で画像のモデルを変えられる。
   - `PF_ALLOW_SIGNUP=false`：自分の登録が済んだら入れて、新規登録を締め切る。
4. Actions → `deploy` → Run workflow。以後は main への push で `ci` 成功後に自動で更新される。web の URL はジョブのサマリーに出る。

Supabase の session モードは同時接続数に上限があるので、Cloud Run は各サービス最大1台、DB の接続は各2本（`PF_DB_POOL_SIZE`）にしている。

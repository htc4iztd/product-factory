# Product Factory (MVP / R0)

1人の Product Builder が、アイデアから運用まで 14 ステージ（P1〜P5、ゲート G1〜G4）を 1 つの Web アプリ上で回すための工場。
AWS Labs の AI-DLC を拡張し、Google ADK 2.x の Workflow で各ステージを動かす。設計は [docs/design.md](docs/design.md)。

## 構成

```
apps/web          Next.js 16 + Auth.js v5（テナントとロールはセッションからだけ渡す）
services/agent    FastAPI + Google ADK 2.13（ステージ実行・工場DB・監査ログ）
infra/nginx       リバースプロキシ（外に出すのは web だけ）
infra/terraform   gcp（Cloud Run の土台：Artifact Registry / Secret Manager / サービスアカウント / Workload Identity）
.github/workflows ci / infra / deploy / ide
ide               Code-OSS の Web 版（ソースからビルド）と、リポジトリを読む拡張機能
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
- 各ステージの「以降の工程を自動開発する」：上流（押したステージまでの最新版、なければ下書き）に従って、AI が違いのはっきりしたパターン（案）を決め、案ごとに後工程（⑪運用方式設計まで）の下書きと、ブラウザで触れる単一ファイルの試作を作る。できたものはプリプロダクト（PP-n）として残り、並べて比べ、試作を触り、1つを採用すると各ステージの下書きに入る（人がそこから直して更新・承認する）。試作は sandbox の iframe で、通信なしで動かす。作ったあとで上流の版が変わると知らせる。採用した案を実コードにして Cloud Run に展開するのは次の段。
- ジョブ：自動開発のような時間のかかる処理は、Cloud Run Jobs（`pf-autodev`。agent と同じイメージで入口だけ `python -m pf_agent.worker <job_id>`）で動かす。手元・テストでは裏のスレッド。右上の「ジョブ」で、ジョブの定義・走行状況（工程ごとのログ）・実行履歴・使った LLM のトークン量（モデル別）を見て、取り消し・作り直しができる。
- 新しいプロダクトは、トップの「新しいプロダクトをつくる」から AI の聞き取りで作る。AI が1〜2問ずつ聞き、分かったこと（名前・作るもの・誰のためか・困りごと・解決のしかた・選ばれる理由・MVP か PoC か）を右にまとめる。人が右で書き換えた項目は AI が上書きしない。作ると、答えた内容が①リーンキャンバスの下書きに入る。聞き取りの途中は保存しない。
- 「チーム」：議論（プロダクトごとのチャンネルとスレッド・メンション・通知）、チケット（TK-n。仕分け待ち→未着手→進行中→レビュー→完了）、決定記録（DEC-n）、会議と議事録（MTG-n）、ドキュメント（DOC-n）。どれも成果物の ID（US-01 など）と同じ書き方で互いを参照でき、本文中の ID はリンクになる。仕様は会話で決まることが多いので、スレッド・会議の文字起こし・外部の会話から AI が「決まったこと」と「宿題」を抜き出し、決定記録（確定待ち）とチケット（仕分け待ち）にする。人が確定した決定は、関係するステージの AI の対話に前提として渡り、ステージの参照タブにも出る。外部の会話（Google Chat・Teams・Gmail・Outlook・Meet・Slack など）はチャンネルにつなぎ、本文ごと取り込むか、要約と決定だけを残すかをチャンネルごとに選ぶ。いまは貼り付けで取り込み、Google Workspace・Microsoft 365 からの自動取り込みはこの受け口に後から足す。
- チケットと GitHub Issues の同期：プロダクトごとに「同期しない／⑫⑬（構築）のチケットだけ／すべて」を選ぶ。対象のチケットと手で起票したチケットは、作成・更新（題名・本文・完了で close）・コメントが Issue に出る。GitHub 側の close・reopen・題名の変更・コメントは、チケット画面を開いたとき（前回から1分以上）・「今すぐ取り込む」・webhook で取り込む。GitHub で作られた Issue を「仕分け待ち」のチケットにすることもできる。往復で同じ変更を繰り返さないよう、PF が書いた本文とコメントには印を付け、Issue の updated_at より新しい変更だけを取り込む。トークンはテナントごとに設定画面で入れる（暗号化して保存。なければサーバーの `GITHUB_TOKEN`）。このトークンで非公開リポジトリのコードも読める。
- 右上の歯車（設定）で、テナントが使う LLM の接続を決める。接続方式は Gemini API・Vertex AI（キー不要。Gemini と Claude）・Anthropic API・OpenAI 互換 API（ローカルLLM など）・スタブ。対話・レポート・画像でモデルを分けられる（画像は Gemini 系だけ）。アプリ全体の既定はプラットフォーム管理者（`PF_ADMIN_EMAILS`）が決め、各テナントの OWNER が自分のキーで上書きできる。API キーは `PF_SECRET_KEY` から作る鍵で暗号化して DB に置き、画面には末尾4文字だけを出す。Vertex AI（キー不要）はアプリの GCP の費用になるので、選べるのはプラットフォーム管理者と、管理者が全テナントに許したときだけ。テナントの OpenAI 互換 URL は https の公開アドレスだけを受け付ける（内部ネットワークへの到達を防ぐ）。
- 「コード（IDE）」では、プロダクトに GitHub リポジトリ（owner/name とブランチ）をつなぎ、Code-OSS の Web 版で読む（読み取り専用、ターミナルなし）。Code-OSS は `ide/VSCODE_VERSION` のタグからソースでビルドし（`ide/build.sh`）、Microsoft のマーケットプレイスや製品版の資産は使わない。IDE 内の拡張機能（`ide/extension`）が `pfrepo://<プロダクトID>/` のファイルシステムとして web の `/api/p/{id}/code/*` を読み、agent-api が GitHub の REST API から木と中身を取る。非公開リポジトリは `GITHUB_TOKEN`（読み取りだけの fine-grained token）が要る。
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
- チーム: `BASE=... node e2e/team.mjs`（議論→決定と宿題の抜き出し→決定の確定とステージの参照→チケット→会議の議事録→ドキュメント→外部の会話の取り込み）
- 自動開発: `BASE=... node e2e/autodev.mjs`（⑥から2案→ジョブの完了→比べる→試作を触る→採用→ジョブの履歴とトークン量）
- GitHub: `BASE=... node e2e/github.mjs`（agent-api の `PF_GITHUB_API` を偽の GitHub に向けて、トークン→同期の設定→Issue の起票→GitHub での close の取り込みを通す）
- IDE: `BASE=... node e2e/ide.mjs`（公開リポジトリをつなぎ、Code-OSS でファイルの木と中身が出るか。`IDE_ORIGIN` と GitHub への接続が要る）

## デプロイ（Cloud Run + Supabase）

web と agent-api（と IDE）を Cloud Run に置き、DB は Supabase を使う。リージョンは DB と揃える（Terraform の `region` と Variables の `GCP_REGION`。既定は東京 `asia-northeast1`）。nginx はローカル用で、Cloud Run では使わない。

```
利用者 ─HTTPS→ Cloud Run pf-web（公開） ─ID トークン→ Cloud Run pf-agent（IAM で非公開）
                      └────────────┬──────────────┘
                         Supabase Postgres（session モードの接続プール）
```

1. **Supabase**：Cloud Run と同じ地域でプロジェクトを作る。
   - Connect → **Session pooler** の接続文字列を控え、末尾に `?sslmode=require` を付ける（パスワードに記号があれば URL エンコードする）。
   - テーブルはサーバーからだけ使うので、Project Settings → Data API を無効にする。
2. **GCP**：課金を有効にしたプロジェクトで Cloud Shell を開き、土台を作って秘密値を入れる。
   ```bash
   git clone https://github.com/<owner>/<name> && cd <name>/infra/terraform/gcp
   terraform init && terraform apply -var project_id=<PROJECT_ID> -var github_repo=<owner>/<name> -var region=<REGION>
   gcloud config set project <PROJECT_ID>
   read -rs V && printf '%s' "$V" | gcloud secrets versions add DATABASE_URL --data-file=-     # 1 の接続文字列
   read -rs V && printf '%s' "$V" | gcloud secrets versions add GOOGLE_API_KEY --data-file=-   # Gemini を使うときだけ
   terraform output
   ```
   state は Cloud Shell の手元に残る（リポジトリには入れない）。
3. **GitHub**：Environment `production` を作る（必要なら Required reviewers を付ける）。Variables に `terraform output` の `GCP_PROJECT_ID`、`GCP_REGION`、`GCP_WIF_PROVIDER`、`GCP_DEPLOY_SA` を入れる。任意で次も入れる。
   - `PF_GEMINI=true`：Gemini を使う（無ければスタブ）。`PF_MODEL` で対話のモデル、`PF_IMAGE_MODEL` で画像のモデルを変えられる。
   - `PF_ALLOW_SIGNUP=false`：自分の登録が済んだら入れて、新規登録を締め切る。
   - `PF_GITHUB_WEBHOOK=true`：GitHub の webhook を受ける（Terraform の apply の後）。リポジトリの Settings → Webhooks に、Payload URL `https://<web の URL>/api/github/webhook`、Content type `application/json`、Secret に Secret Manager の `GITHUB_WEBHOOK_SECRET` の値、イベントは Issues と Issue comments を入れる。
   - `PF_ADMIN_EMAILS`：プラットフォーム管理者。設定画面でアプリ全体の LLM の既定と Vertex AI の利用を決められる人のメールアドレス（複数は `;` 区切り）。
4. Actions → `deploy` → Run workflow。以後は main への push で `ci` 成功後に自動で更新される。web の URL はジョブのサマリーに出る。

5. **IDE（任意）**：Actions → `ide` → Run workflow（Code-OSS のビルドに30〜60分）。終わると web に IDE の URL（`IDE_ORIGIN`）が入る。非公開リポジトリを読むときは、読み取りだけの fine-grained token を `gcloud secrets versions add GITHUB_TOKEN` で入れ、Variables に `PF_GITHUB_TOKEN=true` を入れてから `deploy` を実行する。

Supabase の session モードは同時接続数に上限があるので、Cloud Run は各サービス最大1台、DB の接続は各2本（`PF_DB_POOL_SIZE`）にしている。

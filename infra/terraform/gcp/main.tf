# Cloud Run（web / agent-api）で動かすための土台。手元（Cloud Shell）で apply する。
# Cloud Run のサービス自体は deploy ワークフローが gcloud で作成・更新する。
# DB は Supabase（外部）。接続文字列は Secret Manager の DATABASE_URL に手で入れる。

locals {
  apis = ["run", "artifactregistry", "secretmanager", "iam", "iamcredentials", "sts", "cloudresourcemanager"]
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  service            = "${each.key}.googleapis.com"
  disable_on_destroy = false
}

# ---- コンテナイメージ ----
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "product-factory"
  format        = "DOCKER"
  # 新しい10個は残し、それ以外は30日で消す
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions { keep_count = 10 }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "2592000s"
    }
  }
  depends_on = [google_project_service.api]
}

# ---- 実行用のサービスアカウント ----
resource "google_service_account" "web" {
  account_id   = "pf-web"
  display_name = "Product Factory web"
  depends_on   = [google_project_service.api]
}
resource "google_service_account" "agent" {
  account_id   = "pf-agent"
  display_name = "Product Factory agent-api"
  depends_on   = [google_project_service.api]
}

# IDE（Code-OSS の静的ファイル）を配るだけのサービスアカウント。権限は持たせない
resource "google_service_account" "ide" {
  account_id   = "pf-ide"
  display_name = "Product Factory IDE (static)"
  depends_on   = [google_project_service.api]
}

# agent-api と IDE は IAM で閉じ、web だけが呼べるようにする
resource "google_project_iam_member" "web_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.web.email}"
}

# ---- 秘密情報 ----
# AUTH_SECRET と PF_INTERNAL_TOKEN はここで生成する。
# DATABASE_URL と GOOGLE_API_KEY は値を state に載せないよう、箱だけ作って値は gcloud で入れる。
resource "google_secret_manager_secret" "env" {
  for_each  = toset(["DATABASE_URL", "AUTH_SECRET", "PF_INTERNAL_TOKEN", "GOOGLE_API_KEY", "GITHUB_TOKEN"])
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}
resource "random_password" "auth" {
  length  = 48
  special = false
}
resource "random_password" "internal" {
  length  = 40
  special = false
}
resource "google_secret_manager_secret_version" "auth" {
  secret      = google_secret_manager_secret.env["AUTH_SECRET"].id
  secret_data = random_password.auth.result
}
resource "google_secret_manager_secret_version" "internal" {
  secret      = google_secret_manager_secret.env["PF_INTERNAL_TOKEN"].id
  secret_data = random_password.internal.result
}

locals {
  secret_access = {
    web_db       = { sa = google_service_account.web.email, secret = "DATABASE_URL" }
    web_auth     = { sa = google_service_account.web.email, secret = "AUTH_SECRET" }
    web_internal = { sa = google_service_account.web.email, secret = "PF_INTERNAL_TOKEN" }
    agent_db     = { sa = google_service_account.agent.email, secret = "DATABASE_URL" }
    agent_int    = { sa = google_service_account.agent.email, secret = "PF_INTERNAL_TOKEN" }
    agent_gemini = { sa = google_service_account.agent.email, secret = "GOOGLE_API_KEY" }
    agent_github = { sa = google_service_account.agent.email, secret = "GITHUB_TOKEN" }
  }
}
resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = local.secret_access
  secret_id = google_secret_manager_secret.env[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value.sa}"
}

# ---- GitHub Actions からのデプロイ（Workload Identity Federation。鍵を発行しない）----
resource "google_service_account" "deployer" {
  account_id   = "pf-github-deploy"
  display_name = "Product Factory GitHub deploy"
  depends_on   = [google_project_service.api]
}
resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}
resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}
# Cloud Run に実行用サービスアカウントを割り当てるための権限
resource "google_service_account_iam_member" "deployer_act_as" {
  for_each = {
    web   = google_service_account.web.name
    agent = google_service_account.agent.name
    ide   = google_service_account.ide.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  depends_on                = [google_project_service.api]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
  }
  # このリポジトリの、指定した Environment で動くジョブだけを受け入れる
  attribute_condition = "assertion.repository == '${var.github_repo}' && assertion.environment == '${var.github_environment}'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# GitHub の Variables に入れる値
output "GCP_PROJECT_ID" { value = var.project_id }
output "GCP_REGION" { value = var.region }
output "GCP_WIF_PROVIDER" { value = google_iam_workload_identity_pool_provider.github.name }
output "GCP_DEPLOY_SA" { value = google_service_account.deployer.email }

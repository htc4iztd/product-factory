variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "asia-northeast1"
}
variable "github_repo" {
  type        = string
  description = "owner/name。デプロイを許すリポジトリ"
}
variable "github_environment" {
  type        = string
  default     = "production"
  description = "デプロイを許す GitHub Environment。deploy ワークフローの environment と揃える"
}

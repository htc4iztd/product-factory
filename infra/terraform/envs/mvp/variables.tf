variable "region" {
  type    = string
  default = "ap-northeast-1"
}
variable "github_repo" {
  type        = string
  description = "owner/name。deploy ロールの信頼条件に使う"
}
variable "instance_type" {
  type    = string
  default = "t3.medium"
}
variable "allowed_cidrs" {
  type        = list(string)
  description = "HTTP/HTTPS を許可する接続元。個人検証中は自宅・社内の IP に絞る"
  default     = ["0.0.0.0/0"]
}

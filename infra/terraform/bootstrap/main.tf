# 一度だけ手元で apply する（AWS の管理者権限で）。
# tfstate 用バケット、GitHub OIDC プロバイダ、infra ワークフローが使うロールを作る。
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }
}

variable "region" {
  type    = string
  default = "ap-northeast-1"
}
variable "github_repo" {
  type        = string
  description = "owner/name"
}

provider "aws" { region = var.region }

data "aws_caller_identity" "me" {}

resource "aws_s3_bucket" "tfstate" {
  bucket = "pf-tfstate-${data.aws_caller_identity.me.account_id}"
}
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "tf_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

# MVP 段階は個人アカウントなので広めに付ける。社内展開（ステージA）で絞る
resource "aws_iam_role" "terraform" {
  name               = "pf-github-terraform"
  assume_role_policy = data.aws_iam_policy_document.tf_trust.json
}
resource "aws_iam_role_policy_attachment" "terraform" {
  role       = aws_iam_role.terraform.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "tf_state_bucket" { value = aws_s3_bucket.tfstate.bucket }
output "oidc_provider_arn" { value = aws_iam_openid_connect_provider.github.arn }
output "terraform_role_arn" { value = aws_iam_role.terraform.arn }

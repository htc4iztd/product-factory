# ステージB：EC2 1台で docker compose を動かす。SSH は開けず、操作は SSM のみ。
data "aws_caller_identity" "me" {}
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
data "aws_vpc" "default" { default = true }
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  name   = "pf-mvp"
  prefix = "/pf/mvp"
}

# ---- コンテナイメージ ----
resource "aws_ecr_repository" "svc" {
  for_each             = toset(["agent-api", "web"])
  name                 = "product-factory/${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_ecr_lifecycle_policy" "svc" {
  for_each   = aws_ecr_repository.svc
  repository = each.value.name
  policy = jsonencode({ rules = [{
    rulePriority = 1, description = "keep 20",
    selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 },
    action       = { type = "expire" }
  }] })
}

# ---- 成果物・バックアップ置き場 ----
resource "aws_s3_bucket" "data" {
  bucket = "${local.name}-data-${data.aws_caller_identity.me.account_id}"
}
resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---- 秘密情報（値はここで生成し、deploy.sh が .env に書き出す）----
resource "random_password" "pg" {
  length  = 32
  special = false
}
resource "random_password" "auth" {
  length  = 48
  special = false
}
resource "random_password" "internal" {
  length  = 40
  special = false
}
resource "aws_ssm_parameter" "secret" {
  for_each = {
    POSTGRES_PASSWORD = random_password.pg.result
    AUTH_SECRET       = random_password.auth.result
    PF_INTERNAL_TOKEN = random_password.internal.result
  }
  name  = "${local.prefix}/env/${each.key}"
  type  = "SecureString"
  value = each.value
}
# Gemini キーは手で入れる（Terraform の state に載せない）
resource "aws_ssm_parameter" "gemini" {
  name  = "${local.prefix}/env/GOOGLE_API_KEY"
  type  = "SecureString"
  value = "unset"
  lifecycle { ignore_changes = [value] }
}

# ---- EC2 ----
resource "aws_security_group" "web" {
  name   = "${local.name}-web"
  vpc_id = data.aws_vpc.default.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "ec2" {
  name               = "${local.name}-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}
resource "aws_iam_role_policy" "ec2_app" {
  role = aws_iam_role.ec2.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ssm:GetParametersByPath", "ssm:GetParameter"],
    Resource = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter${local.prefix}/*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
    Resource = [aws_s3_bucket.data.arn, "${aws_s3_bucket.data.arn}/*"] },
  ] })
}
resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name}-ec2"
  role = aws_iam_role.ec2.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  vpc_security_group_ids = [aws_security_group.web.id]
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    region = var.region, prefix = local.prefix, bucket = aws_s3_bucket.data.bucket
  })
  user_data_replace_on_change = false
  metadata_options { http_tokens = "required" }
  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }
  tags = { Name = local.name }
}
resource "aws_eip" "app" {
  instance = aws_instance.app.id
}
resource "aws_ssm_parameter" "data_bucket" {
  name  = "${local.prefix}/data_bucket"
  type  = "String"
  value = aws_s3_bucket.data.bucket
}
resource "aws_ssm_parameter" "instance_id" {
  name  = "${local.prefix}/instance_id"
  type  = "String"
  value = aws_instance.app.id
}

# ---- GitHub Actions の deploy ロール（ECR push と SSM 送信だけ）----
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:environment:aws-mvp"]
    }
  }
}
resource "aws_iam_role" "deploy" {
  name               = "${local.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}
resource "aws_iam_role_policy" "deploy" {
  role = aws_iam_role.deploy.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
    Resource = [for r in aws_ecr_repository.svc : r.arn] },
    { Effect = "Allow", Action = ["ssm:GetParameter"],
    Resource = [aws_ssm_parameter.instance_id.arn, aws_ssm_parameter.data_bucket.arn] },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.data.arn}/release/*" },
    { Effect = "Allow", Action = ["ssm:SendCommand"], Resource = [
      aws_instance.app.arn, "arn:aws:ssm:${var.region}::document/AWS-RunShellScript"] },
    { Effect = "Allow", Action = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"], Resource = "*" },
  ] })
}

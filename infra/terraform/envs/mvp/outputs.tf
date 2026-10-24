output "public_ip" { value = aws_eip.app.public_ip }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.svc : k => r.repository_url } }
output "data_bucket" { value = aws_s3_bucket.data.bucket }

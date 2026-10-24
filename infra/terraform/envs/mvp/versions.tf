terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.80" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  backend "s3" {
    key          = "mvp/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
    # bucket は init 時に -backend-config で渡す
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "product-factory", Stage = "mvp-B" } }
}

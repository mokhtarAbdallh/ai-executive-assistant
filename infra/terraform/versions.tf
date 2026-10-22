terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
  }

  # Recommended: keep state remotely. Create the bucket first, then uncomment.
  # backend "s3" {
  #   bucket       = "YOUR-TFSTATE-BUCKET"
  #   key          = "meeting-assistant/terraform.tfstate"
  #   region       = "eu-central-1"
  #   use_lockfile = true # Terraform >= 1.10
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

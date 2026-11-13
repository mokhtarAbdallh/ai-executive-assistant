# Dawwen on AWS Academy Learner Lab (ADR-027). Test stack only — production is infra/terraform.
# Run from AWS CloudShell inside the Lab (credentials come from the Lab session).
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }
  # Local state in CloudShell's home folder (kept between sessions). It contains the API keys
  # and database password: never copy it into the repository.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "dawwen"
      Stack     = "learner-lab"
      ManagedBy = "terraform"
    }
  }
}

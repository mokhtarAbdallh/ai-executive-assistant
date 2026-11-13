# Default VPC of the Lab account: public subnets, internet gateway, no NAT (saves ~$32/month).
# Tasks get public IPs to reach Groq, Gemini, GHCR and AWS APIs; only the ALB accepts traffic.
data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone"
    values = var.availability_zones
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# The Lab forbids creating IAM roles; LabRole is pre-created and trusted by ECS tasks.
data "aws_iam_role" "lab" {
  name = "LabRole"
}

locals {
  subnets = data.aws_subnets.default.ids
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP to the load balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "ECS tasks: only the ALB may connect"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "web + api from the ALB"
    from_port       = 3000
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres from the ECS tasks only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

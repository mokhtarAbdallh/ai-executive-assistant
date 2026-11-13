# ---------- Database: RDS PostgreSQL (Aurora Serverless is not allowed in the Lab) ----------
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = local.subnets
}

resource "aws_db_instance" "main" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "16" # pgvector is available as an extension (created by the first migration)
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp2" # the Lab supports gp2 only for RDS
  storage_encrypted = true

  db_name  = "dawwen"
  username = "dawwen"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  monitoring_interval     = 0 # enhanced monitoring is not supported in the Lab
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true
}

# ---------- Audio bucket ----------
# The Lab's SCP denies s3:GetBucketObjectLockConfiguration, which the aws_s3_bucket resource always
# reads, so Terraform cannot own the bucket. Create it once (CloudShell):
#   aws s3 mb s3://dawwen-lab-audio-$(aws sts get-caller-identity --query Account --output text)
# Terraform manages everything else on it. destroy keeps the empty bucket (free); raw audio is
# deleted by the worker and by the 7-day lifecycle rule below.
data "aws_s3_bucket" "audio" {
  bucket = "${var.name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = data.aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = data.aws_s3_bucket.audio.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Browser uploads go straight to S3 with a presigned PUT from the site.
resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = data.aws_s3_bucket.audio.id
  cors_rule {
    allowed_origins = [local.app_url]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Invariant 5 backstop: the worker deletes audio after transcription anyway.
resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = data.aws_s3_bucket.audio.id
  rule {
    id     = "delete-raw-audio"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      days = 7
    }
  }
}

# ---------- Queue: S3 upload event -> worker ----------
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-audio-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "audio" {
  name                       = "${var.name}-audio-processing"
  visibility_timeout_seconds = 900
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "audio" {
  queue_url = aws_sqs_queue.audio.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.audio.arn
      Condition = {
        ArnEquals    = { "aws:SourceArn" = data.aws_s3_bucket.audio.arn }
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_s3_bucket_notification" "audio" {
  bucket = data.aws_s3_bucket.audio.id
  queue {
    queue_arn     = aws_sqs_queue.audio.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/"
  }
  depends_on = [aws_sqs_queue_policy.audio]
}

# ---------- Secrets (ECS injects them; values also live in the local state file) ----------
resource "random_password" "app_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  recovery_window_in_days = 0 # delete at once, so apply works again after destroy
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DB_PASSWORD      = random_password.db.result
    APP_SECRET       = random_password.app_secret.result
    ASR_HTTP_API_KEY = var.groq_api_key
    LLM_API_KEY      = var.gemini_api_key
  })
}

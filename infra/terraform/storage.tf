# ---------- KMS key for audio ----------
resource "aws_kms_key" "audio" {
  description             = "${local.name} audio encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 14
}

resource "aws_kms_alias" "audio" {
  name          = "alias/${local.name}-audio"
  target_key_id = aws_kms_key.audio.key_id
}

# ---------- S3: raw audio ----------
resource "aws_s3_bucket" "audio" {
  bucket = "${local.name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.audio.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "expire-raw-audio"
    status = "Enabled"

    filter {
      prefix = "uploads/"
    }

    expiration {
      days = var.audio_retention_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Browser uploads straight to S3 with presigned URLs.
resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["PUT", "POST", "GET", "HEAD"]
    allowed_origins = var.cors_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "audio_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audio.arn, "${aws_s3_bucket.audio.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "audio" {
  bucket     = aws_s3_bucket.audio.id
  policy     = data.aws_iam_policy_document.audio_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.audio]
}

# ---------- SQS: processing queue + DLQ ----------
resource "aws_sqs_queue" "audio_dlq" {
  name                      = "${local.name}-audio-processing-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "audio_processing" {
  name                       = "${local.name}-audio-processing"
  visibility_timeout_seconds = 900 # must exceed worst-case processing time of one meeting
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.audio_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "sqs_from_s3" {
  statement {
    sid       = "AllowS3ToSend"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.audio_processing.arn]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.audio.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "audio_processing" {
  queue_url = aws_sqs_queue.audio_processing.id
  policy    = data.aws_iam_policy_document.sqs_from_s3.json
}

# Upload finished -> message on the queue -> worker picks it up.
resource "aws_s3_bucket_notification" "audio_uploaded" {
  bucket = aws_s3_bucket.audio.id

  queue {
    queue_arn     = aws_sqs_queue.audio_processing.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/"
  }

  depends_on = [aws_sqs_queue_policy.audio_processing]
}

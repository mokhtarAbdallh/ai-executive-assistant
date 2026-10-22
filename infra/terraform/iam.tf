data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ---------- Execution role: pulls images, writes logs, injects secrets ----------
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [for s in aws_secretsmanager_secret.app : s.arn],
      [aws_rds_cluster.main.master_user_secret[0].secret_arn],
    )
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ---------- Task roles (what the app code itself may do) ----------
resource "aws_iam_role" "task" {
  for_each           = toset(["web", "api", "worker"])
  name               = "${local.name}-task-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ECS Exec (shell into a task for debugging)
data "aws_iam_policy_document" "ecs_exec" {
  statement {
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_exec" {
  for_each = aws_iam_role.task
  name     = "ecs-exec"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.ecs_exec.json
}

# Bedrock (api: assistant chat/drafts, worker: meeting analysis)
data "aws_iam_policy_document" "bedrock" {
  statement {
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = var.bedrock_resource_arns
  }
}

# api: mint presigned upload/download URLs, read/write objects
data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.audio.arn}/*"]
  }

  statement {
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.audio.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "api"
  role   = aws_iam_role.task["api"].id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_iam_role_policy" "api_bedrock" {
  name   = "bedrock"
  role   = aws_iam_role.task["api"].id
  policy = data.aws_iam_policy_document.bedrock.json
}

# worker: consume the queue, read (and delete) audio
data "aws_iam_policy_document" "worker" {
  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.audio_processing.arn]
  }

  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.audio.arn}/*"]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.audio.arn]
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "worker"
  role   = aws_iam_role.task["worker"].id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_iam_role_policy" "worker_bedrock" {
  name   = "bedrock"
  role   = aws_iam_role.task["worker"].id
  policy = data.aws_iam_policy_document.bedrock.json
}

# ---------- ECR (one repo per container) ----------
resource "aws_ecr_repository" "app" {
  for_each             = toset(["web", "api", "worker"])
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

# ---------- Cluster + logs ----------
resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(["web", "api", "worker"])
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = 30
}

# ---------- Task definitions ----------
locals {
  common_env = [
    { name = "AWS_REGION", value = var.aws_region },
    { name = "DB_HOST", value = aws_rds_cluster.main.endpoint },
    { name = "DB_PORT", value = "5432" },
    { name = "DB_NAME", value = var.db_name },
    { name = "DB_USER", value = aws_rds_cluster.main.master_username }, # create a least-privilege app user later
    { name = "AUDIO_BUCKET", value = aws_s3_bucket.audio.id },
    { name = "AUDIO_QUEUE_URL", value = aws_sqs_queue.audio_processing.url },
    { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
    { name = "BEDROCK_EMBEDDING_MODEL_ID", value = var.bedrock_embedding_model_id },
    { name = "EMBEDDING_DIM", value = tostring(var.embedding_dim) },
    { name = "AUTH_PROVIDER", value = var.auth_provider },
    { name = "ASR_PROVIDER", value = var.asr_provider },
    { name = "LLM_PROVIDER", value = var.llm_provider },
    { name = "DEMO_MODE", value = tostring(var.demo_mode) },
    { name = "PUBLIC_BASE_URL", value = var.public_base_url },
    { name = "PRICING_CONFIG", value = var.pricing_config },
  ]

  secret_db_password = {
    name      = "DB_PASSWORD"
    valueFrom = "${aws_rds_cluster.main.master_user_secret[0].secret_arn}:password::"
  }
  secret_app = {
    name      = "APP_SECRET"
    valueFrom = aws_secretsmanager_secret.app["app_secret"].arn
  }
  secret_google = {
    name      = "GOOGLE_OAUTH"
    valueFrom = aws_secretsmanager_secret.app["google_oauth"].arn
  }
  secret_asr = {
    name      = "ASR_API_KEY"
    valueFrom = aws_secretsmanager_secret.app["asr_api_key"].arn
  }

  svc = {
    web = {
      cpu         = var.web_cpu
      memory      = var.web_memory
      port        = var.web_port
      environment = [{ name = "NODE_ENV", value = "production" }]
      secrets     = []
    }
    api = {
      cpu         = var.api_cpu
      memory      = var.api_memory
      port        = var.api_port
      environment = concat(local.common_env, [{ name = "NODE_ENV", value = "production" }])
      secrets     = [local.secret_db_password, local.secret_app, local.secret_google]
    }
    worker = {
      cpu         = var.worker_cpu
      memory      = var.worker_memory
      port        = 0
      environment = concat(local.common_env, [{ name = "NODE_ENV", value = "production" }])
      secrets     = [local.secret_db_password, local.secret_app, local.secret_asr]
    }
  }
}

resource "aws_ecs_task_definition" "svc" {
  for_each                 = toset(keys(local.svc))
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.svc[each.key].cpu
  memory                   = local.svc[each.key].memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.app[each.key].repository_url}:${var.image_tag}"
    essential = true

    portMappings = local.svc[each.key].port > 0 ? [{ containerPort = local.svc[each.key].port, protocol = "tcp" }] : []
    environment  = local.svc[each.key].environment
    secrets      = local.svc[each.key].secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.svc[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = each.key
      }
    }
  }])
}

# ---------- Services ----------
# CI/CD registers new task-definition revisions, so Terraform ignores task_definition drift.
resource "aws_ecs_service" "web" {
  name                              = "${local.name}-web"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.svc["web"].arn
  desired_count                     = var.web_desired_count
  launch_type                       = "FARGATE"
  enable_execute_command            = true
  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = var.web_port
  }

  depends_on = [aws_lb_listener.http]

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_ecs_service" "api" {
  name                              = "${local.name}-api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.svc["api"].arn
  desired_count                     = var.api_desired_count
  launch_type                       = "FARGATE"
  enable_execute_command            = true
  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_port
  }

  depends_on = [aws_lb_listener_rule.api]

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# Worker has no load balancer: it long-polls SQS.
resource "aws_ecs_service" "worker" {
  name                   = "${local.name}-worker"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.svc["worker"].arn
  desired_count          = var.worker_min
  launch_type            = "FARGATE"
  enable_execute_command = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ---------- Worker autoscaling on queue depth ----------
resource "aws_appautoscaling_target" "worker" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  min_capacity       = var.worker_min
  max_capacity       = var.worker_max
}

resource "aws_appautoscaling_policy" "worker_queue_depth" {
  name               = "${local.name}-worker-queue-depth"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  resource_id        = aws_appautoscaling_target.worker.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = 2 # ~visible messages tolerated before adding a task
    scale_out_cooldown = 60
    scale_in_cooldown  = 300

    customized_metric_specification {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesVisible"
      statistic   = "Average"

      dimensions {
        name  = "QueueName"
        value = aws_sqs_queue.audio_processing.name
      }
    }
  }
}

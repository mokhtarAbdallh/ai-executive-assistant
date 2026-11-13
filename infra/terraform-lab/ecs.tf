# ECS Fargate: api + worker + web, all using the Lab's pre-created LabRole.
resource "aws_ecs_cluster" "main" {
  name = var.name
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "web", "admin"])
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = 3
}

locals {
  image = {
    api    = "${var.image_registry}/dawwen-api:${var.image_tag}"
    worker = "${var.image_registry}/dawwen-worker:${var.image_tag}"
    web    = "${var.image_registry}/dawwen-web:${var.image_tag}"
  }

  pricing_config = jsonencode({
    customerPricePerAudioMinuteMicros = var.customer_price_per_minute_micros
    providerCosts = {
      asrPerAudioMinuteMicros          = { "openai-whisper" = 0 }
      llmPerMillionInputTokensMicros   = { "openai-compatible" = 0 }
      llmPerMillionOutputTokensMicros  = { "openai-compatible" = 0 }
      embeddingsPerMillionTokensMicros = { "openai-compatible" = 0 }
    }
    lowBalanceThresholdMicros = 1000000
  })

  # Same variable names as infra/terraform and deploy/lab/.env.lab.example.
  # RDS enforces TLS by default and NODE_ENV=production turns DB TLS on, so DB_SSL stays unset.
  app_env = [for k, v in {
    NODE_ENV            = "production"
    AWS_REGION          = var.aws_region
    DB_HOST             = aws_db_instance.main.address
    DB_PORT             = tostring(aws_db_instance.main.port)
    DB_NAME             = aws_db_instance.main.db_name
    DB_USER             = aws_db_instance.main.username
    AUDIO_BUCKET        = data.aws_s3_bucket.audio.bucket
    AUDIO_QUEUE_URL     = aws_sqs_queue.audio.url
    PUBLIC_BASE_URL     = local.app_url
    CORS_ORIGINS        = local.app_url
    COOKIE_SECURE       = "false" # plain HTTP: browsers drop Secure cookies
    AUTH_PROVIDER       = "local"
    DEMO_MODE           = "false"
    ASR_PROVIDER        = "openai-whisper"
    ASR_HTTP_URL        = "https://api.groq.com/openai/v1"
    ASR_MODEL           = var.asr_model
    ASR_HTTP_OPTIONS    = jsonencode({ chunkSeconds = 120, overlapSeconds = 2, concurrency = 2 })
    LLM_PROVIDER        = "openai-compatible"
    LLM_BASE_URL        = "https://generativelanguage.googleapis.com/v1beta/openai"
    LLM_MODEL           = var.llm_model
    LLM_EMBEDDING_MODEL = var.llm_embedding_model
    EMBEDDING_DIM       = "1024"
    PRICING_CONFIG      = local.pricing_config
  } : { name = k, value = v }]

  app_secrets = [for k in ["DB_PASSWORD", "APP_SECRET", "ASR_HTTP_API_KEY", "LLM_API_KEY"] : {
    name      = k
    valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::"
  }]

  logs = { for k in ["api", "worker", "web", "admin"] : k => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.app[k].name
      awslogs-region        = var.aws_region
      awslogs-stream-prefix = k
    }
  } }

  desired = var.running ? 1 : 0
}

# ---------- api (runs database migrations first, in the same task) ----------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = data.aws_iam_role.lab.arn
  task_role_arn            = data.aws_iam_role.lab.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name             = "migrate"
      image            = local.image.api
      essential        = false
      command          = ["node", "packages/db/scripts/migrate-deploy.mjs"]
      environment      = local.app_env
      secrets          = local.app_secrets
      logConfiguration = local.logs.api
    },
    {
      name             = "api"
      image            = local.image.api
      essential        = true
      portMappings     = [{ containerPort = 8080, protocol = "tcp" }]
      environment      = local.app_env
      secrets          = local.app_secrets
      logConfiguration = local.logs.api
      dependsOn        = [{ containerName = "migrate", condition = "SUCCESS" }]
    }
  ])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = local.desired
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 180

  network_configuration {
    subnets          = local.subnets
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true # no NAT: the public IP is the way out to the internet
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = false
  }

  depends_on = [aws_lb_listener_rule.api, aws_secretsmanager_secret_version.app]
}

# ---------- worker (SQS consumer, no inbound traffic) ----------
resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024 # ffmpeg + audio chunks
  execution_role_arn       = data.aws_iam_role.lab.arn
  task_role_arn            = data.aws_iam_role.lab.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name             = "worker"
    image            = local.image.worker
    essential        = true
    environment      = local.app_env
    secrets          = local.app_secrets
    logConfiguration = local.logs.worker
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = local.desired
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.subnets
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  # Start after the api so its migrations have created the tables.
  depends_on = [aws_ecs_service.api]
}

# ---------- web (static React app behind nginx) ----------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = data.aws_iam_role.lab.arn
  task_role_arn            = data.aws_iam_role.lab.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name             = "web"
    image            = local.image.web
    essential        = true
    portMappings     = [{ containerPort = 3000, protocol = "tcp" }]
    logConfiguration = local.logs.web
  }])
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = local.desired
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.subnets
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
}

# ---------- one-off: make var.admin_email a platform admin (see output admin_command) ----------
resource "aws_ecs_task_definition" "admin" {
  family                   = "${var.name}-make-admin"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = data.aws_iam_role.lab.arn
  task_role_arn            = data.aws_iam_role.lab.arn

  container_definitions = jsonencode([{
    name      = "make-admin"
    image     = "public.ecr.aws/docker/library/postgres:16-alpine"
    essential = true
    # psql substitutes :'email' as a quoted literal (no SQL injection); prints "UPDATE 1" on success.
    command = ["sh", "-c", "printf '%s\\n' \"$SQL\" | psql -v ON_ERROR_STOP=1 -v email=\"$ADMIN_EMAIL\""]
    environment = [
      { name = "SQL", value = "UPDATE users SET \"isPlatformAdmin\" = true WHERE email = :'email';" },
      { name = "PGHOST", value = aws_db_instance.main.address },
      { name = "PGPORT", value = tostring(aws_db_instance.main.port) },
      { name = "PGDATABASE", value = aws_db_instance.main.db_name },
      { name = "PGUSER", value = aws_db_instance.main.username },
      { name = "PGSSLMODE", value = "require" },
      { name = "ADMIN_EMAIL", value = lower(var.admin_email) }
    ]
    secrets          = [{ name = "PGPASSWORD", valueFrom = "${aws_secretsmanager_secret.app.arn}:DB_PASSWORD::" }]
    logConfiguration = local.logs.admin
  }])
}

# ---------- Aurora PostgreSQL Serverless v2 (+ pgvector for meeting search) ----------
resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_rds_cluster" "main" {
  cluster_identifier = local.name
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = var.aurora_engine_version
  database_name      = var.db_name

  master_username             = "app_admin"
  manage_master_user_password = true # password lives in Secrets Manager, auto-rotated by AWS

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted      = true

  backup_retention_period   = var.environment == "prod" ? 14 : 3
  deletion_protection       = var.environment == "prod"
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${local.name}-final" : null

  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_acu
    max_capacity = var.aurora_max_acu
  }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier         = "${local.name}-writer"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version
}

# ---------- Application secrets (containers only; values are set outside Terraform) ----------
locals {
  secret_names = {
    asr_api_key  = "asr-api-key"      # transcription provider key
    google_oauth = "google-oauth"     # JSON: {"client_id": "...", "client_secret": "..."}
    app_secret   = "app-secret"       # JWT / session signing key
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each                = local.secret_names
  name                    = "${local.name}/${each.value}"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

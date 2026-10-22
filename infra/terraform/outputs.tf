output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "audio_bucket" {
  value = aws_s3_bucket.audio.id
}

output "audio_queue_url" {
  value = aws_sqs_queue.audio_processing.url
}

output "audio_dlq_url" {
  value = aws_sqs_queue.audio_dlq.url
}

output "db_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "db_master_secret_arn" {
  value = aws_rds_cluster.main.master_user_secret[0].secret_arn
}

output "app_secret_arns" {
  description = "Put the real values into these secrets after the first apply."
  value       = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

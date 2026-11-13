locals {
  network_cfg = "awsvpcConfiguration={subnets=[${join(",", local.subnets)}],securityGroups=[${aws_security_group.tasks.id}],assignPublicIp=ENABLED}"
}

output "app_url" {
  description = "Open this in the browser (HTTP; first start takes ~3-5 minutes)."
  value       = local.app_url
}

output "admin_command" {
  description = "After registering var.admin_email in the site, run this once to make it a platform admin."
  value       = "aws ecs run-task --region ${var.aws_region} --cluster ${aws_ecs_cluster.main.name} --launch-type FARGATE --task-definition ${aws_ecs_task_definition.admin.family} --network-configuration '${local.network_cfg}'"
}

output "logs_command" {
  description = "Follow a service's logs (replace api with worker or web)."
  value       = "aws logs tail /ecs/${var.name}/api --follow --region ${var.aws_region}"
}

output "audio_bucket" {
  value = data.aws_s3_bucket.audio.bucket
}

output "audio_queue_url" {
  value = aws_sqs_queue.audio.url
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

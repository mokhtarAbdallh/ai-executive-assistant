# CloudWatch alarms (ADR-019): operational visibility for the worker queue.
# The DLQ is the terminal state for failed audio messages — anything sitting in
# it means data lost (no worker consumed it), so we alarm on age of oldest
# message and page via SNS when configured.

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

variable "alarm_email" {
  type        = string
  default     = ""
  description = "Optional email endpoint for alarm notifications (SNS subscription)."
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "audio_dlq_age" {
  alarm_name          = "${local.name}-audio-dlq-age"
  alarm_description   = "Messages are ending up in the audio-processing DLQ (worker exhausted retries). Invariant 5 risk: audio may never be transcribed."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 900
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.audio_dlq.name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = []
}

resource "aws_cloudwatch_metric_alarm" "audio_queue_backlog" {
  alarm_name          = "${local.name}-audio-queue-backlog"
  alarm_description   = "Audio queue has a persistent backlog — workers are underprovisioned or ASR is slow."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 6
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 50
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.audio_processing.name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = []
}

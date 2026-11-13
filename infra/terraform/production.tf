# Production hardening (ADR-025): WAF on the ALB, SES sending for reminders,
# a monthly cost budget. Backups/deletion protection live in database.tf,
# alarms in alarms.tf.

variable "waf_enabled" {
  description = "Attach an AWS WAF web ACL to the ALB (~$5/month + $1/rule/month + $0.60 per million requests)."
  type        = bool
  default     = true
}

variable "waf_rate_limit_per_5min" {
  description = "Requests per client IP per 5 minutes before WAF blocks it (login/register brute force, scraping)."
  type        = number
  default     = 2000
}

variable "monthly_budget_usd" {
  description = "Monthly AWS cost budget; alerts alarm_email at 80% actual and 100% forecast. 0 = no budget."
  type        = number
  default     = 0
}

# ---------- WAF ----------
resource "aws_wafv2_web_acl" "main" {
  count = var.waf_enabled ? 1 : 0
  name  = "${local.name}-alb"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 0
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Audio goes straight to S3 (presigned), but transcript edits and assistant
        # chats can exceed the rule's 8 KB body limit: count instead of block.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-alb"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  count        = var.waf_enabled ? 1 : 0
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main[0].arn
}

# ---------- SES (task reminders by email, worker/src/reminders.ts) ----------
# The identity must be verified (click the link SES emails), and the account must be
# moved out of the SES sandbox (AWS console request) before mail reaches real users.
resource "aws_sesv2_email_identity" "sender" {
  count          = var.email_from == "" ? 0 : 1
  email_identity = var.email_from
}

data "aws_iam_policy_document" "worker_ses" {
  count = var.email_from == "" ? 0 : 1
  statement {
    actions   = ["ses:SendEmail"]
    resources = [aws_sesv2_email_identity.sender[0].arn]
  }
}

resource "aws_iam_role_policy" "worker_ses" {
  count  = var.email_from == "" ? 0 : 1
  name   = "ses"
  role   = aws_iam_role.task["worker"].id
  policy = data.aws_iam_policy_document.worker_ses[0].json
}

# ---------- Cost budget ----------
resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd > 0 && var.alarm_email != "" ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alarm_email]
  }
}

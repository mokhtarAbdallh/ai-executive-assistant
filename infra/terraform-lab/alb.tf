# Public HTTP load balancer: /api/* -> api, everything else -> web (Invariant 6).
# No HTTPS: the Lab cannot register a domain, so there is no certificate to attach.
resource "aws_lb" "main" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = local.subnets
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  idle_timeout               = 120
}

locals {
  app_url = "http://${aws_lb.main.dns_name}"
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  deregistration_delay = 10
  health_check {
    path    = "/"
    matcher = "200"
  }
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  deregistration_delay = 10
  health_check {
    path                = "/api/health"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

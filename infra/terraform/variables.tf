# ---------- General ----------
variable "project" {
  type    = string
  default = "meeting-assistant"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "aws_region" {
  description = "Pick a region where Bedrock (and your chosen models) are available. Verify before applying."
  type        = string
  default     = "eu-central-1"
}

# ---------- Network ----------
variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "az_count" {
  type    = number
  default = 2
}

variable "single_nat_gateway" {
  description = "true = one NAT (cheaper, dev/MVP). false = one NAT per AZ (HA)."
  type        = bool
  default     = true
}

# ---------- Edge ----------
variable "certificate_arn" {
  description = "ACM certificate ARN in the same region as the ALB. Empty = HTTP only (dev)."
  type        = string
  default     = ""
}

variable "cors_origins" {
  description = "Browser origins allowed to upload audio directly to S3 via presigned URLs."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

# ---------- Storage / queue ----------
variable "audio_retention_days" {
  description = "Raw audio is auto-deleted after this many days (privacy feature)."
  type        = number
  default     = 7
}

# ---------- Containers ----------
variable "image_tag" {
  type    = string
  default = "latest"
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton is cheaper but images must be built for arm64)."
  type        = string
  default     = "X86_64"
}

variable "web_port" {
  type    = number
  default = 3000
}

variable "api_port" {
  type    = number
  default = 8080
}

variable "api_health_path" {
  type    = string
  default = "/api/health"
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 512
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 1024
}

variable "worker_memory" {
  type    = number
  default = 2048
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "worker_min" {
  type    = number
  default = 1
}

variable "worker_max" {
  type    = number
  default = 5
}

# ---------- Database ----------
variable "db_name" {
  type    = string
  default = "meetings"
}

variable "aurora_engine_version" {
  description = "null = AWS default for aurora-postgresql. Pin it for prod (pgvector needs a recent 15.x/16.x)."
  type        = string
  default     = null
}

variable "aurora_min_acu" {
  type    = number
  default = 0.5
}

variable "aurora_max_acu" {
  type    = number
  default = 4
}

# ---------- Bedrock ----------
variable "bedrock_resource_arns" {
  description = "Tighten to the exact model / inference-profile ARNs you use."
  type        = list(string)
  default = [
    "arn:aws:bedrock:*::foundation-model/*",
    "arn:aws:bedrock:*:*:inference-profile/*",
  ]
}

# ---------- App Runtime & Models (ADR-009) ----------
variable "bedrock_model_id" {
  description = "Bedrock model ID for meeting analysis and assistant converse (no default; set in tfvars)."
  type        = string
  default     = ""
}

variable "bedrock_embedding_model_id" {
  description = "Bedrock embedding model ID for semantic search."
  type        = string
  default     = ""
}

variable "embedding_dim" {
  description = "Vector embedding dimension (matches pgvector column migration)."
  type        = number
  default     = 1024
}

variable "auth_provider" {
  description = "local or cognito"
  type        = string
  default     = "local"
}

variable "asr_provider" {
  description = "elevenlabs, speechmatics, whisper-http, transcribe, or fake"
  type        = string
  default     = "elevenlabs"
}

variable "llm_provider" {
  description = "bedrock or fake"
  type        = string
  default     = "bedrock"
}

variable "demo_mode" {
  description = "Enable zero-cost offline demo mode"
  type        = bool
  default     = false
}

variable "public_base_url" {
  description = "Base public URL for OAuth redirects (e.g. Google Calendar)"
  type        = string
  default     = ""
}

variable "pricing_config" {
  description = "JSON string containing customer pricing and provider costs"
  type        = string
  default     = "{}"
}


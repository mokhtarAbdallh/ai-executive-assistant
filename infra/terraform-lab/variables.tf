variable "aws_region" {
  description = "Learner Lab allows only us-east-1 and us-west-2."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = contains(["us-east-1", "us-west-2"], var.aws_region)
    error_message = "Learner Lab only allows us-east-1 or us-west-2."
  }
}

variable "availability_zones" {
  description = "Two zones of the default VPC (Fargate and RDS need at least two)."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "dawwen-lab"
}

variable "running" {
  description = "false = scale every service to 0 tasks (pause to save budget; the database stays)."
  type        = bool
  default     = true
}

# ---------- Images (built by .github/workflows/lab-images.yml) ----------
variable "image_registry" {
  description = "Public container registry prefix, lower case (e.g. ghcr.io/<github-user>)."
  type        = string
  default     = "ghcr.io/mokhtarabdallh"
}

variable "image_tag" {
  type    = string
  default = "lab"
}

# ---------- Free AI providers (pass keys as TF_VAR_* environment variables) ----------
variable "groq_api_key" {
  description = "Groq key for Whisper speech-to-text. export TF_VAR_groq_api_key=..."
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Gemini key for analysis + embeddings. export TF_VAR_gemini_api_key=..."
  type        = string
  sensitive   = true
}

variable "asr_model" {
  type    = string
  default = "whisper-large-v3"
}

variable "llm_model" {
  type    = string
  default = "gemini-2.5-flash"
}

variable "llm_embedding_model" {
  type    = string
  default = "gemini-embedding-001"
}

# ---------- Sizes (the cheapest that work) ----------
variable "db_instance_class" {
  description = "Learner Lab allows nano/micro/small/medium burstable classes."
  type        = string
  default     = "db.t4g.micro"
}

variable "admin_email" {
  description = "Account that becomes platform admin (register it in the site first, then run admin_command)."
  type        = string
  default     = "admin@dawwen.lab"
}

variable "customer_price_per_minute_micros" {
  description = "What a customer's credit is charged per audio minute (provider costs are 0 here)."
  type        = number
  default     = 30000
}

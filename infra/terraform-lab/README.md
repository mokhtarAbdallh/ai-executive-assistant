# Dawwen — Learner Lab Terraform (test only)

A small AWS stack for the AWS Academy Learner Lab ($50 budget). Production lives in
`infra/terraform/` and is untouched. Full Arabic guide: `docs/LAB.md` (Terraform section).
Decision record: ADR-027 in `docs/DECISIONS.md`.

```
Internet ── ALB :80 ─┬─ /api/* → ECS api (Fargate; runs migrations first) ─┐
                     └─ /*     → ECS web (nginx)                           ├→ RDS PostgreSQL 16 (pgvector)
S3 uploads/ ── event ── SQS ── ECS worker ────────────────────────────────┘
api + worker → Groq Whisper (speech-to-text) + Gemini (analysis, embeddings): free tiers
```

## What differs from production
| Production (`infra/terraform`) | Lab (`infra/terraform-lab`) |
|---|---|
| Own VPC, private subnets, NAT | Default VPC, public subnets, no NAT; tasks have public IPs, SG lets only the ALB in |
| Custom IAM roles | Pre-created `LabRole` (the Lab forbids creating roles) |
| Aurora Serverless v2 | RDS `db.t4g.micro`, gp2 20 GB |
| HTTPS + WAF + domain | Plain HTTP on the ALB DNS name (`COOKIE_SECURE=false`) |
| ECR images | Public GHCR images built by `.github/workflows/lab-images.yml` |
| Bedrock / Transcribe | Groq + Gemini via OpenAI-compatible APIs |

## Use it (AWS CloudShell inside the Lab, region us-east-1)
```bash
# once per CloudShell: install Terraform into ~/bin (kept between sessions)
mkdir -p ~/bin && cd ~/bin && curl -sLo tf.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip && unzip -o tf.zip && rm tf.zip
git clone -b test/learner-lab https://github.com/mokhtarAbdallh/ai-executive-assistant.git ~/dawwen
# once per account: the Lab blocks Terraform from owning the bucket (see data.tf)
aws s3 mb s3://dawwen-lab-audio-$(aws sts get-caller-identity --query Account --output text) --region us-east-1
cd ~/dawwen/infra/terraform-lab
read -rs TF_VAR_groq_api_key && export TF_VAR_groq_api_key
read -rs TF_VAR_gemini_api_key && export TF_VAR_gemini_api_key
terraform init
terraform apply          # ~10-15 min (RDS is the slow part)
terraform output app_url
```
End of day: `terraform destroy` (everything, ~$0 afterwards) — or `terraform apply -var running=false`
to keep the database (RDS still costs ~$0.4/day).

The state file (`terraform.tfstate`) contains the keys and the DB password. It stays in the
CloudShell home folder; never commit or share it.

## Cost (us-east-1, approximate)
ALB ~$0.023/h + RDS micro ~$0.016/h + 3 Fargate tasks ~$0.05/h + public IPv4 ~$0.025/h
≈ **$0.12/hour** ≈ $1 per 8-hour day. Destroy when you stop working.

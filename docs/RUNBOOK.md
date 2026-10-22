# Dawwen (دوّن) — Production Operations Runbook

This operational runbook provides comprehensive instructions for deploying, operating, monitoring, and troubleshooting **Dawwen (دوّن)** on AWS infrastructure.

---

## 1. System Topology & Infrastructure Contract

```
Internet
   │ (HTTPS :443 / HTTP :80 redirect)
   ▼
[AWS Application Load Balancer]
   ├── /api/*  ──> API Target Group (Port 8080) ──> ECS Fargate: `api` container
   └── /*      ──> Web Target Group (Port 3000) ──> ECS Fargate: `web` container

[Storage & Processing]
   ├── Audio Uploads: S3 Bucket (`meeting-assistant-audio-*`) with KMS CMK encryption
   ├── Audio Queue: SQS (`meeting-assistant-audio-processing`) + DLQ (`-dlq`)
   ├── Background Processing: ECS Fargate: `worker` container (consumes SQS, runs ffmpeg)
   ├── Database: Aurora PostgreSQL Serverless v2 with `pgvector`
   ├── AI Foundation: Amazon Bedrock (Claude 3.5 Sonnet + Titan Embeddings G1)
   └── External ASR: ElevenLabs Scribe API
```

### Critical Infrastructure Ports & Contracts
- **Web Service:** Listens on port `3000`. Health check: `GET /` (expecting 200).
- **API Service:** Listens on port `8080`. Health check: `GET /api/health` (expecting 200 with `{ status: "ok" }`).
- **S3 Key Convention:** Raw audio uploads **must** be stored under prefix `uploads/{userId}/{meetingId}/{fileName}` to match the S3 7-day auto-expiry lifecycle rule (`filter { prefix = "uploads/" }`).
- **Secrets:** Injected into ECS tasks via AWS Secrets Manager. Never logged, never written to disk.

---

## 2. Pre-Deployment Setup Checklist (One-Time)

Before executing Terraform or deploying containers to a real AWS account:

### A. AWS Bedrock Model Access
1. Open the AWS Console in the deployment region (`eu-central-1` or `us-east-1`).
2. Navigate to **Amazon Bedrock** → **Model access**.
3. Ensure access is granted for:
   - **Anthropic Claude 3.5 Sonnet** (`anthropic.claude-3-5-sonnet-20241022-v2:0` or `anthropic.claude-3-5-sonnet-20240620-v1:0`)
   - **Amazon Titan Embeddings G1 - Text** (`amazon.titan-embed-text-v1` or `v2`)

### B. ACM SSL Certificate
1. Request an ACM public certificate for your custom domain (e.g., `dawwen.ai` and `*.dawwen.ai`).
2. Complete DNS validation in Route 53 or your DNS registrar.
3. Note the Certificate ARN and supply it to Terraform variable `certificate_arn`.

### C. AWS Secrets Manager Credentials
Terraform (`infra/terraform/ecs.tf`) references four secrets in Secrets Manager under prefix `${project}-${environment}`:
1. `app_secret`: 64-character random string (e.g., `openssl rand -hex 32`). Used for JWT signing and token encryption.
2. `google_oauth`: JSON string `{"client_id": "<ID>", "client_secret": "<SECRET>"}` from Google Cloud Console.
3. `asr_api_key`: ElevenLabs API key string (`xi-api-key`).

---

## 3. Database Migration Runbook

Prisma migrations must be applied before routing traffic to new API or worker revisions.

### Migration Execution Procedure
Run a one-off ECS Fargate task or run via an administrative bastion / CI pipeline:

```bash
# 1. Connect to Aurora PostgreSQL via VPC bastion or AWS Systems Manager Session
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

# 2. Deploy migrations
pnpm --filter @dawwen/db exec prisma migrate deploy

# 3. Verify pgvector extension and indexes
psql "$DATABASE_URL" -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
psql "$DATABASE_URL" -c "\d meeting_embeddings;"
```

---

## 4. Deployment Sequence

### Step 1: Validate Infrastructure
```bash
cd infra/terraform
terraform init
terraform plan -out=tfplan
# Review plan carefully before applying
terraform apply tfplan
```

### Step 2: Build & Push Container Images
```bash
# Authenticate Docker to AWS ECR
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com

# Build and tag images
docker build -t <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/meeting-assistant-dev/web:v1.0.0 apps/web
docker build -t <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/meeting-assistant-dev/api:v1.0.0 apps/api
docker build -t <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/meeting-assistant-dev/worker:v1.0.0 apps/worker

# Push images to ECR
docker push <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/meeting-assistant-dev/web:v1.0.0
docker push <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/meeting-assistant-dev/api:v1.0.0
docker push <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/meeting-assistant-dev/worker:v1.0.0
```

### Step 3: Trigger ECS Deployment
Update ECS services with the new image tags:
```bash
aws ecs update-service --cluster meeting-assistant-dev --service meeting-assistant-dev-web --force-new-deployment
aws ecs update-service --cluster meeting-assistant-dev --service meeting-assistant-dev-api --force-new-deployment
aws ecs update-service --cluster meeting-assistant-dev --service meeting-assistant-dev-worker --force-new-deployment
```

### Step 4: Validate Health Checks
```bash
# 1. API Health endpoint via ALB
curl -f https://api.yourdomain.com/api/health
# Expected: {"status":"ok","uptimeSeconds":...}

# 2. Check ALB Target Group health
aws elbv2 describe-target-health --target-group-arn <API_TARGET_GROUP_ARN>
aws elbv2 describe-target-health --target-group-arn <WEB_TARGET_GROUP_ARN>
```

---

## 5. Monitoring & Alerting

### Key CloudWatch Metric Alarms
1. **SQS Queue Age (`ApproximateAgeOfOldestMessage`):**
   - Alarm when `> 300 seconds` (indicates audio processing worker backlog or freeze).
2. **DLQ Message Count (`ApproximateNumberOfMessagesVisible`):**
   - Alarm when `> 0` on `meeting-assistant-audio-processing-dlq`. Requires immediate investigation.
3. **ECS Memory/CPU Utilization:**
   - Worker task CPU `> 85%` for 5 consecutive minutes → trigger auto-scaling scale-out up to `worker_max = 5`.
4. **ALB 5XX Errors:**
   - Alarm if `HTTPCode_Target_5XX_Count > 10` in 5 minutes.

### Structured Log Analysis in CloudWatch Logs Insights
Filter logs for error events without printing sensitive data:
```sql
fields @timestamp, @message
| filter @logStream like /api/ or @logStream like /worker/
| filter level = 50 or @message like /error/ or @message like /FAILED/
| sort @timestamp desc
| limit 100
```

---

## 6. Incident Response & Troubleshooting

### Scenario A: SQS Dead Letter Queue (DLQ) Has Messages
- **Symptom:** CloudWatch alarm on DLQ triggers.
- **Cause:** Audio file corrupt, ElevenLabs ASR quota exhausted, or Bedrock rate limit exceeded after 3 SQS delivery attempts.
- **Procedure:**
  1. Inspect the message attributes and error log in CloudWatch:
     ```bash
     aws sqs receive-message --queue-url <DLQ_URL> --max-number-of-messages 1
     ```
  2. Search for `failed processing meeting audio in worker` in log group `/ecs/meeting-assistant-dev/worker`.
  3. If transient error, redrive messages back to the primary queue:
     ```bash
     aws sqs start-message-move-task --source-arn <DLQ_ARN> --destination-arn <QUEUE_ARN>
     ```

### Scenario B: Bedrock Rate Limit / Throttling (`ThrottlingException`)
- **Symptom:** Meeting analysis fails with `ThrottlingException` or `RequestTimeout`.
- **Cause:** Concurrency limit reached on Bedrock Claude in the region.
- **Procedure:**
  1. Check worker auto-scaling; ensure `worker_max` does not exceed your Bedrock quota.
  2. Request a quota increase in AWS Service Quotas for `Converse requests per minute`.
  3. Exponential backoff and jitter in `@dawwen/llm` automatically retries up to 3 times before returning to SQS.

### Scenario C: Credit Ledger Balance Gating (HTTP 402)
- **Symptom:** User reports inability to upload audio or meeting shows `status: FAILED` with "Insufficient credit balance".
- **Procedure:**
  1. Check user credit balance: `GET /api/billing/balance` (or query `credit_ledgers` table).
  2. If user paid via offline bank transfer or voucher, execute top-up:
     ```bash
     curl -X POST https://yourdomain.com/api/billing/topup \
       -H "Authorization: Bearer <TOKEN>" \
       -H "Content-Type: application/json" \
       -d '{"amount": 25.00, "reference": "INSTAPAY-123456"}'
     ```

---

## 7. Rollback & Disaster Recovery

### Application Rollback
To rollback to a previous stable container version:
```bash
aws ecs update-service --cluster meeting-assistant-dev --service meeting-assistant-dev-api \
  --task-definition meeting-assistant-dev-api:<PREVIOUS_REVISION>
```

### Raw Audio S3 Disaster Recovery
- S3 bucket has KMS encryption and versioning enabled.
- Hard invariant: Raw audio is purged after transcription. If reprocessing is required before deletion, the original audio remains in S3 during the `audio_retention_days` window (default 7 days).
- Deleted database records can be restored from point-in-time recovery (PITR) snapshots on the Aurora cluster (35-day backup retention).

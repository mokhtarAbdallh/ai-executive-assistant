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
   └── External ASR: ElevenLabs Scribe API OR self-hosted QwenCleo (`ASR_PROVIDER`, ADR-018)
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

Terraform (`infra/terraform/ecs.tf` + `database.tf`) references secrets in Secrets Manager under prefix `${project}-${environment}`:

1. `app-secret`: 64-character random string (e.g., `openssl rand -hex 32`). Used for JWT signing and token encryption.
2. `google-oauth`: JSON string `{"client_id": "<ID>", "client_secret": "<SECRET>"}` from Google Cloud Console.
3. `asr-api-key`: ElevenLabs API key string (`xi-api-key`).
4. `asr-http-api-key`: optional shared key for the self-hosted QwenCleo ASR server (ADR-018); required only when `ASR_PROVIDER=qwencleo-http` and the server is configured to expect a key.

### D. Self-hosted ASR + Notifications (optional)

- `ASR_PROVIDER=qwencleo-http` points the worker at the self-hosted QwenCleo FastAPI server
  (`asr_http_url` variable, e.g. `http://server.internal:8000`). The worker pre-processes audio to
  16 kHz mono WAV chunks, so the GPU server only needs the `POST /v1/transcribe` contract (ADR-018).
- `EMAIL_FROM` (e.g. `no-reply@yourdomain.com`) enables SES email for the reminder dispatcher; the
  sender identity must be verified in SES (sandbox mode requires verifying recipient addresses too).
  Without `EMAIL_FROM` reminders dispatch through the console channel (ADR-020).
- `alarm_email` (Terraform variable) subscribes an email endpoint to the alarms SNS topic
  (`alarms.tf`). Leave empty to skip the subscription; alarms still exist in CloudWatch.

### E. Google Calendar OAuth (ADR-023)

- In Google Cloud Console → OAuth client → **Authorized redirect URIs**, add exactly
  `${PUBLIC_BASE_URL}/api/calendar/callback` (e.g. `https://app.example.com/api/calendar/callback`).
- `PUBLIC_BASE_URL` must be the public https origin of the web app: the callback redirects the
  browser to `${PUBLIC_BASE_URL}/?calendar=connected|error`.
- Without Google credentials the API uses the fake calendar, and in production approving a
  "book meeting" proposal is refused (`calendar_not_connected`) instead of pretending it booked.
- Email proposals are refused in production (`email_not_configured`) until the API has a real
  email channel; reminders are sent by the worker (SES via `EMAIL_FROM`).

---

## 3. Database Migration Runbook

Prisma migrations must be applied before routing traffic to new API or worker revisions.

### Migration Execution Procedure

Run it as a one-off ECS task with the API image (it builds the URL from the `DB_*` secrets
and never prints it). Terraform prints the exact command:

```bash
cd infra/terraform
eval "$(terraform output -raw migrate_command)"   # aws ecs run-task ... migrate-deploy.mjs
# Wait for the task to stop with exit code 0 (ECS console → Tasks → Stopped), then deploy.
```

For ad-hoc SQL (pgvector checks, the cost report), open an SSM port-forward to Aurora from a
task with ECS Exec enabled and point `DATABASE_URL` at `127.0.0.1`.

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

Actual alarms created by `infra/terraform/alarms.tf` (SNS topic `${project}-${environment}-alarms`):

1. **Audio DLQ age (`${project}-${environment}-audio-dlq-age`):**
   `ApproximateAgeOfOldestMessage > 900 s` on the audio DLQ for 2 evaluations — messages reached the
   DLQ after exhausting retries; meetings stay `TRANSCRIBING/ANALYZING` until the sweeper fails them
   (ADR-019). Investigate, then redrive (Scenario A).
2. **Audio queue backlog (`${project}-${environment}-audio-queue-backlog`):**
   `ApproximateNumberOfMessagesVisible > 50` for 30 minutes — workers under-provisioned or ASR
   too slow; scale out (max 5 tasks) or check the ASR endpoint.
3. **API 5xx (`…-api-5xx`):** `HTTPCode_Target_5XX_Count > 10` per 5 min, twice — read
   `/ecs/<name>/api` logs by `reqId`.
4. **API unhealthy (`…-api-unhealthy`):** any unhealthy API target for 3 minutes — crash loop,
   database unreachable, or a bad deploy (roll back, section 7).
5. **Database capacity (`…-db-capacity`):** Aurora `ACUUtilization > 90%` for 15 minutes — raise
   `aurora_max_acu` or find the slow query (Performance Insights).
6. **Monthly budget:** set `monthly_budget_usd` (with `alarm_email`) for AWS Budgets mails at 80%
   actual / 100% forecast.

Worker auto-scaling (about 2 visible SQS messages per task, up to `worker_max`) is a scaling
policy, not an alarm.

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
- **Cause:** Audio file corrupt, ASR failure (ElevenLabs quota exhausted, self-hosted ASR server
  unreachable — check `asr_http_url`), or Bedrock rate limit exceeded after 3 SQS delivery attempts.
- **Procedure:**
  1. Inspect the message attributes and error log in CloudWatch:
     ```bash
     aws sqs receive-message --queue-url <DLQ_URL> --max-number-of-messages 1
     ```
  2. Search for `meeting processing failed` in log group `/ecs/meeting-assistant-dev/worker`
     (the meeting row also carries a user-safe `failureReason`).
  3. Since ADR-023 a failed run marks the meeting `FAILED`, so a plain DLQ redrive is skipped by
     the worker (only `QUEUED` meetings are claimed). Fix the cause, then retry per meeting —
     the user's **"حاول تاني / Try again"** button, or:
     ```bash
     curl -X POST https://yourdomain.com/api/meetings/<MEETING_ID>/retry -H "Authorization: Bearer <USER_TOKEN>"
     ```
     Retry needs the raw audio (it is kept for failed meetings; the S3 lifecycle removes it later).
  4. Credit holds of failed/crashed runs are released automatically (pipeline catch block or
     the stuck-meeting sweeper); `meetings.creditHoldMicros` shows any hold still in flight.

### Scenario B: Bedrock Rate Limit / Throttling (`ThrottlingException`)

- **Symptom:** Meeting analysis fails with `ThrottlingException` or `RequestTimeout`.
- **Cause:** Concurrency limit reached on Bedrock Claude in the region.
- **Procedure:**
  1. Check worker auto-scaling; ensure `worker_max` does not exceed your Bedrock quota.
  2. Request a quota increase in AWS Service Quotas for `Converse requests per minute`.
  3. `@dawwen/llm` retries invalid output up to 3 times; tokens of failed attempts are still metered
     (`usage_events.metadata.failed = true`). The meeting ends `FAILED` and can be retried.

### Scenario C: Credit Ledger Balance Gating (HTTP 402)

- **Symptom:** User reports inability to upload audio or meeting shows `status: FAILED` with "Insufficient credit balance".
- **Procedure:**
  1. Check user credit balance: `GET /api/billing/balance` (or query `credit_ledgers` table).
  2. If user paid via offline bank transfer or voucher, a **platform admin** credits them
     (ADR-022; regular users get 403). Either use the admin form in Billing → Top up, or:
     ```bash
     curl -X POST https://yourdomain.com/api/billing/topup \
       -H "Authorization: Bearer <ADMIN_TOKEN>" \
       -H "Content-Type: application/json" \
       -d '{"userEmail": "user@example.com", "amountDollars": 25, "reference": "INSTAPAY-123456"}'
     ```
  3. Granting / revoking the admin flag (run with `DATABASE_URL` pointing at the target DB):
     ```bash
     pnpm --filter @dawwen/db admin:grant you@example.com
     pnpm --filter @dawwen/db admin:grant you@example.com --revoke
     ```

### Web build modes

- Production/staging builds must **not** set `VITE_DEMO_MODE`; the app then requires login and
  shows real errors when the API is unreachable.
- `VITE_DEMO_MODE=true` (used only by the Playwright suite and offline UI demos) serves the
  built-in sample data and auto-logs in a demo user.

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
- Deleted database records can be restored from point-in-time recovery (PITR) snapshots on the Aurora cluster (14-day backup retention in prod, 3 days elsewhere; deletion protection and a
  final snapshot in prod).

---

## 8. Production Go-Live Checklist (ADR-025)

Do these in order; tick each one. Nothing here is done by code alone.

**Decisions**
- [ ] AWS region chosen (Bedrock model available there, close to Egypt: `eu-central-1` or `me-central-1`).
- [ ] ASR provider chosen from the bake-off (`pnpm --filter @dawwen/worker bakeoff --dir <recordings>`
      on 20–30 real Egyptian meetings with human transcripts; compare WER, names/English terms by hand, cost).
- [ ] Payment method for credits (manual top-up codes via the admin endpoint first).

**Infrastructure** (`environment = "prod"` in tfvars)
- [ ] `certificate_arn` set (HTTPS only), `cors_origins` = the real web origin, `public_base_url` set.
- [ ] `single_nat_gateway = false`, `api_desired_count >= 2` for availability.
- [ ] `pricing_config` holds **your real provider prices** (check the ElevenLabs price per minute
      on your plan; the Terraform default and the example disagree).
- [ ] `alarm_email` set and the SNS subscription confirmed from the inbox; `monthly_budget_usd` set.
- [ ] `waf_enabled = true` (default). After a week, check WAF sampled requests for false positives.
- [ ] `email_from` set; click the SES verification link; request SES production access
      (account leaves the sandbox) — until then reminders reach verified addresses only.
- [ ] Secrets filled in Secrets Manager (`app-secret`, ASR/Google keys) — never in tfvars or git.

**Data safety**
- [ ] Aurora: 14-day backups, deletion protection and final snapshot are automatic in prod —
      do one test restore of a snapshot into a new cluster before launch.
- [ ] `audio_retention_days` agreed (privacy policy says the same number).

**Release**
- [ ] `terraform plan` reviewed, `apply` run by a human.
- [ ] Images pushed, migrations run (section 3), services healthy (section 4).
- [ ] Smoke test on prod: register → upload a short recording with consent → review → approve a
      proposal. (`pnpm test:e2e:fullstack` covers the same path locally.)
- [ ] Cost check after the first real week: `pnpm --filter @dawwen/worker cost-report --fixed-usd
      <AWS bill excl. Bedrock>` → set the customer price per minute with a margin you accept.

#!/usr/bin/env bash
# Creates (or updates) the Learner Lab AWS resources for Dawwen (ADR-026). Idempotent.
#   S3 bucket  dawwen-lab-audio-<account>  (private, encrypted, CORS for the site, uploads/
#              deleted after 7 days, backups/ after 30)
#   SQS queue  dawwen-lab-audio-processing (+ DLQ after 3 failed receives, as in Terraform)
#   S3 → SQS   notification for new objects under uploads/
# Uses the LabRole credentials of the EC2 server (or of CloudShell). Prints KEY=value lines.
set -euo pipefail

SITE_ORIGIN="${1:?usage: aws-resources.sh https://<site-origin>}"
REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$REGION"

ACCOUNT="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
BUCKET="dawwen-lab-audio-${ACCOUNT}"
QUEUE="dawwen-lab-audio-processing"
DLQ="${QUEUE}-dlq"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

log() { echo "[aws-resources] $*" >&2; }

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  log "bucket $BUCKET exists"
else
  log "creating bucket $BUCKET"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# The browser uploads straight to S3 with a presigned PUT from the site's origin.
cat >"$TMP/cors.json" <<EOF
{"CORSRules":[{"AllowedOrigins":["$SITE_ORIGIN"],"AllowedMethods":["PUT","GET","HEAD"],
"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]}
EOF
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$TMP/cors.json"

# Privacy (Invariant 5): the worker deletes audio after transcription; this is the backstop.
cat >"$TMP/lifecycle.json" <<'EOF'
{"Rules":[
 {"ID":"delete-raw-audio","Status":"Enabled","Filter":{"Prefix":"uploads/"},"Expiration":{"Days":7}},
 {"ID":"expire-db-backups","Status":"Enabled","Filter":{"Prefix":"backups/"},"Expiration":{"Days":30}}
]}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration "file://$TMP/lifecycle.json"

log "queues"
DLQ_URL=$(aws sqs create-queue --queue-name "$DLQ" \
  --attributes MessageRetentionPeriod=1209600 --query QueueUrl --output text)
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
QUEUE_URL=$(aws sqs create-queue --queue-name "$QUEUE" --query QueueUrl --output text)
QUEUE_ARN="arn:aws:sqs:${REGION}:${ACCOUNT}:${QUEUE}"

# Attribute values are JSON strings inside JSON: build the file with escaped quotes.
cat >"$TMP/queue.json" <<EOF
{
  "VisibilityTimeout": "900",
  "ReceiveMessageWaitTimeSeconds": "20",
  "MessageRetentionPeriod": "345600",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"3\"}",
  "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"s3.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"$QUEUE_ARN\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"arn:aws:s3:::$BUCKET\"},\"StringEquals\":{\"aws:SourceAccount\":\"$ACCOUNT\"}}}]}"
}
EOF
aws sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes "file://$TMP/queue.json"

log "S3 → SQS notification on uploads/"
cat >"$TMP/notify.json" <<EOF
{"QueueConfigurations":[{"QueueArn":"$QUEUE_ARN","Events":["s3:ObjectCreated:*"],
"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"uploads/"}]}}}]}
EOF
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration "file://$TMP/notify.json"

echo "AUDIO_BUCKET=$BUCKET"
echo "AUDIO_QUEUE_URL=$QUEUE_URL"

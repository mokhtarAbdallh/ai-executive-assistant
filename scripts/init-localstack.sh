#!/usr/bin/env bash
# LocalStack ready-hook: S3 bucket + SQS queue/DLQ + S3→SQS notification, mirroring
# infra/terraform (storage.tf). Idempotent: LocalStack may run ready-hooks more than once.
set -euo pipefail

BUCKET=meeting-assistant-audio
QUEUE=meeting-assistant-audio-processing

echo "Initializing LocalStack resources for Dawwen..."

awslocal s3api head-bucket --bucket "$BUCKET" 2>/dev/null || awslocal s3 mb "s3://$BUCKET"

# Browser uploads go straight to S3 with a presigned PUT (local web ports).
cat <<EOF > /tmp/cors.json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
      "AllowedOrigins": [
        "http://localhost:5173",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5180",
        "http://127.0.0.1:5173"
      ],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
EOF
awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file:///tmp/cors.json

# create-queue is idempotent when the attributes are the same.
DLQ_URL=$(awslocal sqs create-queue --queue-name "$QUEUE-dlq" --output text --query 'QueueUrl')
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn \
  --output text --query 'Attributes.QueueArn')

# RedrivePolicy is itself a JSON string inside the attributes document (no jq needed).
cat <<EOF > /tmp/queue-attributes.json
{
  "VisibilityTimeout": "900",
  "ReceiveMessageWaitTimeSeconds": "20",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"3\"}"
}
EOF
QUEUE_URL=$(awslocal sqs create-queue --queue-name "$QUEUE" \
  --attributes file:///tmp/queue-attributes.json --output text --query 'QueueUrl')
QUEUE_ARN=$(awslocal sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn \
  --output text --query 'Attributes.QueueArn')

# Uploads under uploads/ trigger processing, like the S3 event notification in AWS.
cat <<EOF > /tmp/notification.json
{
  "QueueConfigurations": [
    {
      "QueueArn": "$QUEUE_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": { "Key": { "FilterRules": [{ "Name": "prefix", "Value": "uploads/" }] } }
    }
  ]
}
EOF
awslocal s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration file:///tmp/notification.json

echo "LocalStack resources initialized successfully!"

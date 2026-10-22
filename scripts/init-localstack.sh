#!/usr/bin/env bash
set -euo pipefail

echo "Initializing LocalStack resources for Dawwen..."

# Wait for LocalStack to be ready
awslocal s3 mb s3://meeting-assistant-audio

# S3 CORS configuration
cat <<EOF > /tmp/cors.json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
      "AllowedOrigins": ["http://localhost:5173"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
EOF
awslocal s3api put-bucket-cors --bucket meeting-assistant-audio --cors-configuration file:///tmp/cors.json

# Create DLQ
DLQ_URL=$(awslocal sqs create-queue --queue-name meeting-assistant-audio-processing-dlq --output text --query 'QueueUrl')
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --output text --query 'Attributes.QueueArn')

# Create main queue with DLQ redrive policy
REDRIVE_POLICY=$(cat <<EOF
{"deadLetterTargetArn":"$DLQ_ARN","maxReceiveCount":"3"}
EOF
)
QUEUE_URL=$(awslocal sqs create-queue \
  --queue-name meeting-assistant-audio-processing \
  --attributes "{\"VisibilityTimeout\":\"900\",\"ReceiveMessageWaitTimeSeconds\":\"20\",\"RedrivePolicy\":$(echo $REDRIVE_POLICY | jq -R .)}" \
  --output text --query 'QueueUrl')

QUEUE_ARN=$(awslocal sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn --output text --query 'Attributes.QueueArn')

# S3 Notification to SQS on uploads/ prefix
cat <<EOF > /tmp/notification.json
{
  "QueueConfigurations": [
    {
      "QueueArn": "$QUEUE_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "uploads/"
            }
          ]
        }
      }
    }
  ]
}
EOF
awslocal s3api put-bucket-notification-configuration --bucket meeting-assistant-audio --notification-configuration file:///tmp/notification.json

echo "LocalStack resources initialized successfully!"

# Meeting Assistant — AWS Infrastructure (Terraform skeleton)

## اللي جوه الـ skeleton
| ملف | بيعمل إيه |
|---|---|
| `versions.tf` | الـ provider والـ backend (S3 state معمول comment) |
| `variables.tf` | كل الإعدادات (ريجن، أحجام الـ tasks، retention للصوت، إلخ) |
| `network.tf` | VPC + subnets عامة/خاصة + NAT + S3 endpoint + Security Groups |
| `storage.tf` | S3 للصوت (KMS + حذف تلقائي) + SQS + DLQ + ربط S3 بالـ SQS |
| `database.tf` | Aurora PostgreSQL Serverless v2 + حاويات الـ secrets |
| `iam.tf` | Roles بأقل صلاحيات لكل service (web / api / worker) |
| `alb.tf` | ALB: `/api/*` للـ api والباقي للـ web (HTTPS لو حطيت certificate) |
| `ecs.tf` | ECR + Cluster + 3 services (web / api / worker) + autoscaling للـ worker على عمق الـ queue |

## التشغيل
```bash
cp terraform.tfvars.example terraform.tfvars   # عدّل القيم
terraform init
terraform validate
terraform plan
terraform apply
```

## بعد أول apply (بالترتيب)
1. **املأ الـ secrets** (القيم بتتحط برّه Terraform): `asr-api-key` و`google-oauth` و`app-secret` (الأسماء في output `app_secret_arns`).
2. **ابني وارفع الـ images** لـ 3 ريبوهات ECR (output `ecr_repository_urls`) بالـ tag اللي في `image_tag`، وبعدها:
   `aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment`
   (الـ services هتفشل وتعيد المحاولة لحد ما الـ images تترفع، وده طبيعي في أول مرة).
3. **فعّل pgvector** على الداتابيز مرة واحدة: `CREATE EXTENSION IF NOT EXISTS vector;`
4. **فعّل صلاحية موديلات Bedrock** اللي هتستخدمها من الكونسول في نفس الريجن، وضيّق `bedrock_resource_arns` على الموديلات دي بس.
5. اعمل **مستخدم داتابيز بصلاحيات محدودة** للتطبيق بدل الـ master user.

## ملاحظات مهمة
- الـ services بتتجاهل تغييرات `task_definition` (الـ CI/CD هو اللي بيسجّل revisions جديدة). لو غيّرت CPU/Memory من Terraform، سجّل revision جديد أو شيل الـ `ignore_changes` مؤقتًا.
- `single_nat_gateway = true` أرخص للتجربة؛ في الـ prod خليه `false`.
- أكبر بنود التكلفة الثابتة: NAT Gateway + ALB + Aurora (الحد الأدنى للـ ACU) + الـ worker الشغال.
- الصوت بيتحذف تلقائي بعد `audio_retention_days` من مسار `uploads/`.
- الـ worker بيستقبل من SQS وبينادي مزود التفريغ (خارج AWS) عبر NAT. لو اخترت Whisper مستضاف عندك، هتضيف service بـ GPU أو endpoint على SageMaker.

## مش موجود لسه (مراحل جاية)
Cognito، CloudFront + Route53 + ACM، WAF، Step Functions بدل الـ worker البسيط، EventBridge Scheduler + SES للتذكيرات، CI/CD (GitHub Actions)، Alarms على الـ DLQ.

> الملفات اتراجعت syntax وتطابق المراجع بين الملفات، لكن **متجرّبتش بـ `terraform validate` أو `plan`** على حساب AWS حقيقي. شغّلهم قبل أي apply.

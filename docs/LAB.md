# تشغيل دوّن على AWS Learner Lab (نسخة تجربة مجانية)

> الفرع ده (`test/learner-lab`) للتجربة بس. الكود الأصلي على `main` / `fix/phase-4-operations`
> ما اتغيّرش. القرار والتفاصيل التقنية في ADR-026 جوه `docs/DECISIONS.md`.

## الشكل

```
المتصفح ─► https://<IP>.sslip.io
             │
   ┌─────────┴──────────── EC2 واحد (t3.medium) ─────────────┐
   │ Caddy: HTTPS مجاني ─► الموقع  │  /api ─► الـ API         │
   │ الـ worker  │  Postgres + pgvector (على هارد السيرفر)     │
   └─────────────┬────────────────────────────────────────────┘
                 │ صلاحيات LabRole (من غير مفاتيح AWS)
         S3 (الصوت) + SQS (الطابور)
                 │
   Groq Whisper (صوت ← نص)  ·  Gemini (تحليل + بحث)   ← ببلاش
```

## اللي اتشال مؤقتاً (مقارنة بالإنتاج)

| الإنتاج                        | هنا                               | الفرق                                                                  |
| ------------------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| Claude على Bedrock             | Gemini 2.5 Flash (مجاني)          | جودة أقل شوية، والبيانات ممكن تستخدم في التدريب: جرّب بتسجيلاتك انت بس |
| ElevenLabs / QwenCleo          | Whisper large-v3 على Groq (مجاني) | **مفيش تفريق بين المتكلمين** (كله "Speaker 1")، وفيه حد يومي للدقايق   |
| مساعد بأدوات (Bedrock)         | النسخة البسيطة من غير موديل       | المساعد أبسط                                                           |
| Aurora + نسخ احتياطي           | Postgres جوه Docker               | النسخ الاحتياطي يدوي (تحت)                                             |
| ECS + ALB + NAT + WAF          | سيرفر واحد + Caddy                | مفيش scaling ولا WAF                                                   |
| SES / Google Calendar / Alarms | مقفولين                           | التذكير بيتسجل في الـ log بس، ومفيش حجز كالندر حقيقي                   |

## التكلفة على ميزانية الـ 50 دولار (تقريبي)

| البند         | السعر                      | لو شغال 8 ساعات يومياً               |
| ------------- | -------------------------- | ------------------------------------ |
| t3.medium     | ~0.042$ / ساعة             | ~10$ في الشهر                        |
| هارد 30GB gp3 | ~0.08$ / GB / شهر          | ~2.4$                                |
| Elastic IP    | ~0.005$ / ساعة (طول الوقت) | ~3.6$                                |
| S3 + SQS      | قروش                       | ~0                                   |
| **المجموع**   |                            | **~16$ في الشهر** (لو 24 ساعة: ~36$) |

**اقفل السيرفر (Stop) كل ما تخلص.** عداد الميزانية في الـ Lab بيتحدّث كل 8–12 ساعة بس،
ولو الميزانية خلصت الحساب كله بيتمسح.

## الخطوات

### 1. افتح الـ Lab

**Start Lab** ← استنى النقطة تبقى خضرا ← **AWS**. اتأكد فوق على اليمين إنك في **N. Virginia (us-east-1)**.

### 2. اعمل السيرفر — EC2 → Launch instance

- **Name:** `dawwen-lab`
- **AMI:** Ubuntu Server 24.04 LTS
- **Instance type:** `t3.medium`
- **Key pair:** `vockey`
- **Network settings → Edit → Security group:**
  - SSH (22) — Source: **My IP**
  - HTTP (80) — Anywhere
  - HTTPS (443) — Anywhere
- **Storage:** 30 GiB gp3
- **Advanced details:**
  - **IAM instance profile:** `LabInstanceProfile`
  - **Metadata response hop limit:** `2` ← مهم، من غيره الـ containers مش هتشوف صلاحيات LabRole
    (السكربت بيحاول يصلّحها لوحده لو نسيت)
- **Launch instance**

### 3. ثبّت العنوان — Elastic IP

EC2 → **Elastic IPs** → **Allocate** → اختاره → **Actions → Associate** → اختار `dawwen-lab`.
كده العنوان مش هيتغير لما السيرفر يقفل ويفتح.

### 4. ادخل على السيرفر

EC2 → Instances → `dawwen-lab` → **Connect** → **EC2 Instance Connect** → **Connect**.
(أو SSH بملف `labsuser.ppk` من **AWS Details** في صفحة الـ Lab.)

### 5. شغّل الإعداد (أمر واحد)

```bash
git clone -b test/learner-lab https://github.com/mokhtarAbdallh/ai-executive-assistant.git && cd ai-executive-assistant && ./deploy/lab/setup.sh
```

السكربت هيطلب منك:

- **مفتاح Groq** و **مفتاح Gemini** — اكتبهم (مش هيظهروا وانت بتكتب). بيتحفظوا في
  `deploy/lab/.env.lab` على السيرفر بس، والملف ده مستحيل يترفع على git.

وبعدين لوحده: يسطّب Docker، ويعمل swap، ويعمل الـ S3 bucket والـ SQS queue، ويبني ويشغّل كل حاجة
(**أول مرة 10–20 دقيقة**)، ويعمل حساب أدمن.

### 6. افتح الموقع

```
https://<IP-بشرط>.sslip.io      ← مثلاً https://3-91-20-7.sslip.io
```

بيانات دخول الأدمن:

```bash
cat ~/dawwen-admin.txt
```

أول فتحة ممكن تاخد دقيقة لحد ما شهادة HTTPS تطلع.

### 7. وانت خارج

EC2 → `dawwen-lab` → **Instance state → Stop**. لما تفتح الـ Lab تاني، السيرفر بيشتغل لوحده
والموقع بيرجع (الـ containers عليها `restart: unless-stopped`).

## أوامر مفيدة (على السيرفر، من جوه فولدر المشروع)

```bash
# اختصار
alias dc='docker compose -f deploy/lab/docker-compose.yml --env-file deploy/lab/.env.lab'

dc ps                      # حالة الخدمات
dc logs -f worker          # متابعة معالجة الاجتماعات
dc logs -f api             # أخطاء الـ API

git pull && ./deploy/lab/setup.sh            # تحديث الكود وإعادة البناء
./deploy/lab/setup.sh --reconfigure          # تغيير مفاتيح Groq/Gemini

# نسخة احتياطية من الداتابيز إلى S3 (بتتمسح بعد 30 يوم)
BUCKET=$(grep ^AUDIO_BUCKET= deploy/lab/.env.lab | cut -d= -f2)
dc exec -T postgres pg_dump -U dawwen dawwen | gzip | aws s3 cp - "s3://$BUCKET/backups/dawwen-$(date +%F).sql.gz"
```

## شحن رصيد لمستخدم

ادخل بحساب الأدمن ← صفحة الرصيد ← اشحن لإيميل المستخدم (التكلفة الفعلية للخدمات المجانية = 0،
بس الموقع بيخصم سعر الدقيقة من الرصيد زي الإنتاج بالظبط).

## مشاكل شائعة

| العَرَض                                    | السبب والحل                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| الرفع بيفشل من المتصفح                     | الـ CORS على الـ bucket متظبط على عنوان قديم: `./deploy/lab/setup.sh --reconfigure`                   |
| الاجتماع واقف على "بيتعالج"                | `dc logs worker`. لو فيه `429` يبقى الحد المجاني خلص للدقيقة/لليوم، هيحاول تاني لوحده                 |
| `Unable to locate credentials` في الـ logs | الـ hop limit لسه 1: خطوة 2 (Advanced details) أو شغّل `setup.sh` تاني                                |
| الموقع مش بيفتح بـ https                   | بورت 80 و 443 لازم يكونوا مفتوحين للكل في الـ Security group                                          |
| HTTPS مش راضي يطلع خالص                    | في `.env.lab` خلي `SITE_ADDRESS=:80` و `COOKIE_SECURE=false` واستخدم `http://<IP>`، وبعدين `dc up -d` |

## حدود الخدمات المجانية (ممكن تتغير)

- **Groq Whisper:** حد للدقايق في الساعة وفي اليوم — يكفي تجارب كتير بس مش استخدام حقيقي.
- **Gemini Flash:** حد لعدد الطلبات في الدقيقة وفي اليوم. كل اجتماع = طلب تحليل أو اتنين + embeddings.
- لما الحد يخلص، الـ worker بيستنى ويحاول تاني؛ لو فضل يفشل، الاجتماع بيبقى FAILED وتقدر تعيده من الواجهة.

## أمان

- المفاتيح في `deploy/lab/.env.lab` على السيرفر بس (صلاحيات 600). الريبو **Public**: ماتحطش أي مفتاح في الكود.
- بعد ما تخلص التجربة، اعمل مفاتيح جديدة من Groq و Google AI Studio وامسح القديمة.

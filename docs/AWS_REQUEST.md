# AWS request: Sales Demo Room video storage

**For:** DevOps / IT (AWS account owners)
**From:** Sales Demo Room backend team
**Bucket:** existing `storagenupi` (ap-south-1). No new bucket is needed.

## Why we need this

Sales staff upload product demo videos, up to 2 GB each, and play them during live customer demos. The browser uploads and plays the files **directly from AWS**, so the video traffic doesn't load our server. All files stay **private**: people can only reach them through short-lived signed links that our backend creates.

| # | Change | Touches other apps? |
|---|---|---|
| 1 | Use the folder `sales-demo/` inside `storagenupi` | No |
| 2 | **Add** one CORS rule (browser uploads) | No: the rule is added, existing rules stay |
| 3 | **Add** one lifecycle rule limited to `sales-demo/` | No: it only applies to our folder |
| 4 | New CloudFront distribution with signed URLs | No: it's new |
| 5 | **Add** one bucket-policy statement for that CloudFront, limited to `sales-demo/*` | No |
| 6 | IAM permissions for our server, limited to `sales-demo/*` | No |

Block Public Access stays **ON**. Nothing becomes public.

> **Important when applying #2, #3 and #5:** S3 replaces the *whole* CORS, lifecycle or policy document when you save it. Download the current document first, **add** our part to it, then save. Don't paste ours on its own, or the existing rules for other apps would be deleted.

---

## 1. Folder layout (for reference)

```
storagenupi/
  sales-demo/
    videos/<assetId>/v<version>/original.<ext>   uploaded file
    videos/<assetId>/v<version>/play.mp4         converted file the browser plays
    videos/<assetId>/v<version>/thumb.jpg        thumbnail
    decks/...                                     (phase 2: presentations)
```

---

## 2. CORS rule: add to the bucket's CORS configuration

Browsers upload in 16 MB parts with `PUT` and need to read the `ETag` response header.

```json
{
  "AllowedOrigins": ["https://<frontend-qa-domain>", "https://<frontend-prod-domain>"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}
```

We'll confirm the exact frontend domains. During testing, `http://localhost:5180` may be added and removed afterwards.

---

## 3. Lifecycle rule: add to the bucket's lifecycle configuration

This cleans up uploads that were started but never finished, which S3 would otherwise bill for indefinitely.

```json
{
  "ID": "sales-demo-abort-incomplete-uploads",
  "Status": "Enabled",
  "Filter": { "Prefix": "sales-demo/" },
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
}
```

If **versioning** is enabled on `storagenupi`, please also add this to the same rule, so deleted videos don't keep costing money as old versions:

```json
"NoncurrentVersionExpiration": { "NoncurrentDays": 7 }
```

---

## 4. CloudFront distribution (new)

This gives fast playback across India, and private access through signed URLs.

| Setting | Value |
|---|---|
| Origin | `storagenupi.s3.ap-south-1.amazonaws.com`, with **Origin Access Control (OAC)**, signing "always" |
| Origin path | *(empty)*. Our signed URLs include `/sales-demo/...`. |
| Viewer protocol | Redirect HTTP to HTTPS |
| Allowed methods | GET, HEAD |
| **Restrict viewer access** | **Yes**, trusted key group: `sales-demo-signing` (below) |
| Cache policy | `CachingOptimized` (managed) |
| Response headers policy | `CORS-With-Preflight` (managed) |
| Price class | "Use North America, Europe, Asia, Middle East, and Africa" (includes India) |
| Domain | The default `dxxxx.cloudfront.net` is fine. A custom domain, e.g. `media-demo.nupipay.com`, is optional. |

### 4.1 Signing key (for signed URLs)

1. Generate a key pair, for example on a secure machine:
   ```bash
   openssl genrsa -out sales-demo-cf-private.pem 2048
   openssl rsa -pubout -in sales-demo-cf-private.pem -out sales-demo-cf-public.pem
   ```
2. CloudFront → **Public keys** → upload `sales-demo-cf-public.pem`.
3. CloudFront → **Key groups** → create `sales-demo-signing` containing that key.
4. Send us the **public key ID**. Put the **private key** into the server's `.env` (or AWS Secrets Manager) yourselves. It must **not** go over email or chat.

### 4.2 Bucket policy statement: add to the existing bucket policy

```json
{
  "Sid": "SalesDemoCloudFrontRead",
  "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::storagenupi/sales-demo/*",
  "Condition": {
    "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>" }
  }
}
```

If the bucket uses **SSE-KMS** encryption instead of the default SSE-S3, please tell us. The KMS key policy would also need to allow this distribution and our server role.

---

## 5. IAM permissions for our server

Ideally, attach this to the **IAM role of the server/EC2 instance** that runs our containers, so no access keys are needed. If that isn't possible, create an IAM user `sales-demo-backend` with this policy and give us the keys through a secure channel.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SalesDemoObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::storagenupi/sales-demo/*"
    },
    {
      "Sid": "SalesDemoListOwnFolder",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::storagenupi",
      "Condition": { "StringLike": { "s3:prefix": ["sales-demo/*"] } }
    }
  ]
}
```

**What each permission is for:**
- `PutObject` covers creating uploads and signing upload links for the browser.
- `GetObject` lets the worker read an uploaded file in order to convert it.
- `DeleteObject` removes replaced videos and Trash items after 30 days.
- The multipart and list permissions let us resume and clean up uploads.

There is no access to anything outside `sales-demo/`.

---

## 6. Expected cost

These are estimates. Please check them against the AWS Pricing Calculator for ap-south-1.

| Item | Assumption | Approx. per month |
|---|---|---|
| S3 storage | 100 videos × ~300 MB, original + converted copy ≈ 60 GB at ~$0.025/GB | ~$1.5 |
| S3 requests | A few thousand uploads and reads | < $0.10 |
| S3 → CloudFront transfer | | $0 (free) |
| CloudFront delivery, typical | 200 demos × 3 viewers × ~400 MB watched ≈ 240 GB | **$0** within the 1 TB/month free tier; ~$26 if the account's free tier is already used by other services (~$0.11/GB India) |
| CloudFront delivery, busy | 1,000 demos × 5 viewers × ~500 MB ≈ 2.5 TB | ~$165–275 |
| CloudFront requests | Signed URL requests | ~$0–1 |

**Expected total for our current use: about $2–30/month.** The CloudFront free tier applies to the whole AWS account, so please tell us whether other services already use it. Deleted and replaced videos are removed automatically, so storage doesn't grow without limit.

**Optional safeguard:** an AWS Budget alert on the tag or usage of this distribution, for example at $50/month.

---

## 7. Rollback (each step can be undone on its own)

| Change | How to undo |
|---|---|
| CORS rule | Remove our rule from the CORS configuration |
| Lifecycle rule | Delete the rule `sales-demo-abort-incomplete-uploads` |
| CloudFront | Disable, then delete the distribution; delete the key group and public key |
| Bucket policy | Remove the statement `SalesDemoCloudFrontRead` |
| IAM | Detach and delete the policy (and the user, if one was created) |
| Data | Delete the folder `sales-demo/`. It contains only our files. |

---

## 8. What we need back

| # | Item | How to send |
|---|---|---|
| 1 | Confirmation that changes 2–6 are applied (and whether versioning or SSE-KMS is on) | Any channel |
| 2 | CloudFront domain (e.g. `dxxxx.cloudfront.net`) | Any channel |
| 3 | CloudFront public key ID | Any channel |
| 4 | CloudFront private key | **Placed directly on the server** (`.env`) or in Secrets Manager. Never by email or chat. |
| 5 | How our server gets AWS access: instance role name, or IAM user keys | Keys only by a secure channel |
| 6 | The AWS account ID and region (`ap-south-1`) | Any channel |

**After we receive these:**
1. We set `STORAGE_DRIVER=s3` and the values above in the server's `.env`.
2. We deploy the S3 + CloudFront driver.
3. We test an upload and a playback on QA together with you.

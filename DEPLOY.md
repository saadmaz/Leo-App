# LEO - Deployment Guide

This guide covers deploying LEO to production:
- **Backend** → [Railway](https://railway.app) (Docker, FastAPI)
- **Frontend** → [Vercel](https://vercel.com) (Next.js)
- **Database** → Firebase Firestore (already cloud-hosted)
- **Auth** → Firebase Authentication (already cloud-hosted)

---

## Prerequisites

Before deploying, make sure you have:

- [ ] Firebase project with Firestore and Authentication enabled
- [ ] Firebase service account JSON (downloaded from Firebase Console → Project Settings → Service Accounts → Generate New Private Key)
- [ ] Anthropic API key
- [ ] Stripe account with Pro and Agency products created (see below)
- [ ] Firecrawl API key (for website ingestion)
- [ ] Apify API key (for Instagram ingestion)

---

## 1. Firebase Setup

### Enable services
1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. Enable **Authentication** → Email/Password sign-in
3. Enable **Firestore Database** → Start in production mode

### Get service account credentials
1. Project Settings → Service Accounts → **Generate New Private Key**
2. Save as `backend/firebase-service-account.json` (gitignored, never commit)
3. For Railway, you'll paste the private key and client email as env vars instead of a file

### Firestore security rules
In Firestore → Rules, paste:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 2. Stripe Setup

### Create products
1. Stripe Dashboard → Products → **Add Product**
2. Create **LEO Pro** - $29/month recurring → copy the Price ID (`price_...`)
3. Create **LEO Agency** - $99/month recurring → copy the Price ID (`price_...`)
4. Add both Price IDs to your backend env vars:
   ```
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_AGENCY_PRICE_ID=price_...
   ```

### Register webhook
1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://your-leo-api.up.railway.app/billing/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **Signing secret** → add as `STRIPE_WEBHOOK_SECRET`

---

## 3. Deploy Backend to Railway

### Create project
1. [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo**
2. Select this repository
3. Railway detects `railway.toml` and `Dockerfile` automatically

### Set environment variables
In Railway → your service → Variables, add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `FIREBASE_PROJECT_ID` | `your-project-id` |
| `FIREBASE_PRIVATE_KEY` | Contents of `"private_key"` field from service account JSON (include `\n` newlines) |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com` |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRO_PRICE_ID` | `price_...` |
| `STRIPE_AGENCY_PRICE_ID` | `price_...` |
| `FIRECRAWL_API_KEY` | `fc-...` |
| `APIFY_API_KEY` | `apify_api_...` |
| `ENVIRONMENT` | `production` |
| `FRONTEND_URL` | `https://your-app.vercel.app` (set after Vercel deploy) |
| `LOG_LEVEL` | `INFO` |

### Verify
Once deployed, visit `https://your-leo-api.up.railway.app/health` - should return `{"status":"ok"}`.

> **Note on `FIREBASE_PRIVATE_KEY`**: The key from the JSON file contains literal `\n` newlines. In Railway, paste the full key including `-----BEGIN RSA PRIVATE KEY-----` header/footer. Railway preserves newlines in multi-line values.

---

## 4. Deploy Frontend to Vercel

### Import project
1. [vercel.com](https://vercel.com) → New Project → **Import Git Repository**
2. Select this repo → set **Root Directory** to `frontend`
3. Framework: **Next.js** (auto-detected)

### Set environment variables
In Vercel → your project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-leo-api.up.railway.app` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | From Firebase Console → Project Settings → Web App |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `your-project-id` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | From Firebase Web App config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | From Firebase Web App config |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |

### Deploy
Click **Deploy**. Vercel runs `npm run build` and deploys automatically.

### Authorized domains (Firebase)
After deploying, add your Vercel domain to Firebase:
1. Firebase Console → Authentication → Settings → **Authorized domains**
2. Add `your-app.vercel.app`

---

## 5. Post-deployment checklist

- [ ] Backend `/health` returns `{"status":"ok"}`
- [ ] Can sign up and log in
- [ ] Can create a project and start a chat
- [ ] Brand Core ingestion completes (requires Firecrawl + Apify keys)
- [ ] Stripe checkout opens and completes (use Stripe test card `4242 4242 4242 4242`)
- [ ] Stripe webhook receives events (check Stripe Dashboard → Webhooks → your endpoint → recent deliveries)
- [ ] Update `FRONTEND_URL` in Railway to your Vercel domain

---

## Local development

```bash
# Backend
cd Leo
cp backend/.env.example backend/.env   # fill in your keys
uvicorn backend.main:app --reload

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local             # fill in Firebase config
npm install
npm run dev
```

Both run on their default ports; Next.js proxies `/api/backend/*` to `localhost:8000`.

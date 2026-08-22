# NABIN Deployment & DevOps Operations Guide

## 1. Environments & Staging

| Environment | API Host | Frontend / Admin | Database |
| :--- | :--- | :--- | :--- |
| **Local Development** | `http://localhost:4000` | `http://localhost:4000/admin` | In-Memory / Local Postgres |
| **Beta Staging** | `https://api-beta.nabin.in` | `https://admin-beta.nabin.in` | Supabase Beta Instance |
| **Production** | `https://api.nabin.in` | `https://admin.nabin.in` | Supabase Production Master |

## 2. Running Locally

### Backend Server
```bash
cd backend
npm install
node src/server.js
```
The server will bind to `http://localhost:4000` and `ws://localhost:4000`.

### Flutter Mobile Apps
```bash
cd mobile
flutter pub get
flutter run -d chrome # Or target Android / iOS emulator
```

## 3. Production Container Deployment

### Build Container
```bash
docker build -t nabin-backend:latest -f backend/Dockerfile .
```

### Run Container
```bash
docker run -d \
  -p 4000:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e SUPABASE_URL=https://your-supabase-id.supabase.co \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e PAYMENT_WEBHOOK_SECRET=your-webhook-secret \
  --name nabin-api \
  nabin-backend:latest
```

## 4. Health & Zero-Downtime Verification
During blue-green rolling deployments, traffic switchover is conditioned on:
```bash
curl -f http://localhost:4000/api/health
curl -f http://localhost:4000/api/ready
```
If `/api/ready` returns HTTP 503 (e.g. emergency lockdown is active), the load balancer preserves the previous healthy revision.

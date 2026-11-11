# MicroServiceHub

A web marketplace for everyday services in Bangladesh. People who need a job done (**seekers**) find people who do it (**providers**), agree on a price, pay safely, and can reach emergency help (ambulance, doctor, blood bank) from the same app.

Live demo: https://microservicehub.onrender.com (free hosting, the first load can take up to a minute)

Course project: CSE 3206, Software Engineering Laboratory.

## What it does

**Hiring**
- A seeker posts a work request. Providers apply with a message and, if they want, their own price. The seeker compares and hires one.
- Or a provider publishes a service and a seeker books it for a date.
- Explore screen with every service type, search, filters, reviews and saved providers.

**Trust and money**
- Every user is verified with a NID (or birth certificate under 18) and a selfie. An admin approves or rejects.
- Cash, bKash and Nagad payments are confirmed by the provider. Online bKash payments are held in escrow until the seeker confirms the job. Disputes freeze the money until an admin decides.
- Platform fee, promo codes and referral codes.

**Communication and location**
- Chat, voice calls and notifications (in-app, push, email, SMS).
- Opt-in "Available now" map and consent-based live location sharing.

**Emergency help (run by the admin team)**
- Ambulances: choose a free one and follow it live on a map. The driver shares the position from a secret link, no login needed.
- Doctors: press "Checkup", an admin approves it and sends a meeting link.
- Blood bank: join as a donor or ask for blood. Phone numbers are shared only with consent.

**Admin panel**
- Statistics, user and KYC management, moderation, payments, disputes, fees, categories, admin team, reports (CSV) and the emergency services.

## Tech stack

| Part | Tools |
| --- | --- |
| Frontend | React 19, Vite, React Router, Leaflet, Socket.IO client, plain CSS |
| Backend | Node.js, Express 5, Socket.IO, JWT, bcryptjs, helmet, express-rate-limit, multer, web-push, nodemailer |
| Database | MySQL (TiDB Cloud in production, MariaDB/XAMPP locally) |
| Hosting | Render (app) and TiDB Cloud (database), deployed from GitHub |
| Tests | node:test (114 integration tests), oxlint |

## Project structure

```
.
├── src/                 React app (pages, components, styles)
├── public/              manifest, service worker, icons, images
├── backend/
│   ├── server.js        Express app and Socket.IO
│   ├── migrate.js       creates and updates the database tables at start
│   ├── routes/          API modules (account, work, listings, payments, kyc, emergency, admin, ...)
│   ├── tests/           automated tests
│   └── scripts/         create-admin, backup, restore
├── render.yaml          Render deployment blueprint
├── DEPLOY.md            step by step deployment guide
```

## Run it locally

You need Node.js 18 or newer and a MySQL or MariaDB server (for example XAMPP).

1. Create an empty database called `micro_service_hub`. The tables are created automatically when the backend starts.
2. Backend:
   ```bash
   cd backend
   cp .env.example .env      # then edit the database settings if needed
   npm install
   npm start                 # http://localhost:5000
   ```
3. Frontend (in another terminal, from the project root):
   ```bash
   npm install
   npm run dev               # http://localhost:5173
   ```
4. Create an admin account:
   ```bash
   cd backend
   npm run create-admin -- you@example.com "a-strong-password" "Your Name"
   ```

## Configuration

Settings live in `backend/.env` (see `backend/.env.example`). The most important ones:

| Variable | Purpose |
| --- | --- |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` | Database connection (defaults match XAMPP) |
| `JWT_SECRET` | Signs login tokens (generated on first start if empty) |
| `GOOGLE_CLIENT_ID` | Enables "Continue with Google" |
| `CORS_ORIGINS` | Extra allowed frontend origins |
| `DB_SSL` | Set to `true` for TiDB Cloud and other hosted databases |
| `APP_URL`, `API_PUBLIC_URL` | Public addresses, used in emails and payment return links |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | Creates the first admin on an empty database (remove after the first start) |

The frontend reads `VITE_API_URL` (default `http://localhost:5000`).

Real bKash payments, email and SMS need accounts at those providers. Without them the app still works: users pay the provider directly and the provider confirms.

## Tests

```bash
cd backend
npm test
```

The tests start the real server on a random port against a separate database (`micro_service_hub_test`) and call the real HTTP API.

## Deployment

The project deploys as one Render web service (the Express server also serves the built React app). See `DEPLOY.md` and `render.yaml`.

## Known limitations

- Online bKash is tested with a simulated gateway until a merchant account is connected.
- Payouts to providers are recorded as due and paid by an admin.
- The interface is in English only.
- The free hosting sleeps when idle.

## Team

Group: LabGroup567

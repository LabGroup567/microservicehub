# Putting MicroServiceHub online

# Free hosting options

The whole project (website + API + live chat) is **one Node.js app**. The backend serves the built website, so you need only:

1. a place that runs Node.js (the app),
2. a MySQL database it can reach over the internet,
3. a web address.

> **InfinityFree cannot run this app.** It hosts PHP and MySQL only, with no Node.js and no WebSockets. It can only hold the static website files (see the last section), and then the backend would still have to live elsewhere. Using one Node host is simpler.

Free plans change often. Check each provider's pricing page before you start.

## 1. Put the code on GitHub

```bash
git init
git add .
git commit -m "MicroServiceHub"
```

Create an empty **private** repository on github.com, then run the two commands it shows (`git remote add origin ...` and `git push -u origin main`). The `.gitignore` files already keep passwords (`backend/.env`), uploads and backups out of the repository.

## 2. Free MySQL database

Any MySQL 8 or MariaDB 10.4+ with remote access works. Aiven has a free MySQL plan (1 GB, no card); TiDB Cloud has a free tier too. Create a database and note:

`host`, `port`, `user`, `password`, `database name`. These go into the variables below.

Hosted databases need an encrypted connection, so keep `DB_SSL=true`. If the provider gives a CA certificate, paste it into `DB_SSL_CA`.

The app creates every table by itself on first start.

## 3. Free Node host: Render

1. Sign up at render.com with GitHub.
2. **New > Blueprint**, choose your repository. It reads `render.yaml` in this folder.
3. Fill in the variables it asks for:

| Variable | Value |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | from step 2 |
| `APP_URL` and `API_PUBLIC_URL` | the address Render gives, e.g. `https://microservicehub.onrender.com` (set after the first deploy, then redeploy) |
| `GOOGLE_CLIENT_ID` | your Google client ID (optional) |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | your own email and a strong password (10+ characters) |

4. Deploy. Open the address: the website is there.
5. Log in with the admin email and password. **Then delete `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`** from Render's environment. That account is the main admin.

Sign-in with Google: in Google Cloud Console, add your Render address as an *authorized JavaScript origin*.

### Email

Set these in Render to send verification and reset emails (Gmail example, using an App Password from your Google account security page):

`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `MAIL_FROM=MicroServiceHub <you@gmail.com>`

Without these, emails are only printed in Render's logs.

### What to expect on a free plan

- The app **sleeps after about 15 minutes without visitors**; the next visit takes up to a minute to wake it. Live location, calls and chat reconnect when it wakes.
- It needs HTTPS for phone push alerts, live location and calls. Render gives HTTPS automatically.
- NID photos are stored in the database, so they survive restarts and redeploys.

## 4. A nicer address

- Free: the `*.onrender.com` address, or a free subdomain from a DNS service such as FreeDNS (afraid.org) that points to your Render address.
- Your own name: buy a cheap domain (a `.xyz` or `.shop` often costs a few dollars a year), then in Render open the service, **Settings > Custom Domains**, add it and follow the DNS steps. HTTPS is issued automatically. Update `APP_URL` and `API_PUBLIC_URL` to the new address.

## 5. Updating the live site

Change the code, then `git push`. Render rebuilds and restarts it.

## Backups

The `npm run backup` script needs `mysqldump` and is meant for your own computer. For the hosted database use the provider's backup feature, and download a copy now and then.

## Only if you still want InfinityFree

It can serve the **website files only**. You still need the backend on Render (steps 2 and 3 above).

1. Copy `.env.production.example` to `.env.production` and put your Render address in `VITE_API_URL`.
2. Run `npm run build`.
3. In InfinityFree's File Manager (or FTP), upload everything inside `dist/` (including the hidden `.htaccess`) to `htdocs/`.
4. On Render set `CORS_ORIGINS` to your InfinityFree address and `APP_URL` to it as well.

InfinityFree shows a browser check page to some visitors and can be slow, so serving the site from Render is better.

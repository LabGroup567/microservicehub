# Putting MicroServiceHub on your Diana Host panel

Your panel has a **Self Managed** Node.js application form, so the whole project (website + API + chat) runs as one app on `microservicehu.hivecoredigital.com`. You do not need any other server.

You need three things from the panel: a **database**, the **uploaded files**, and the **application form**.

## 1. Create the database (Database menu)

1. Open **Database** in the left menu and create a new MySQL database, for example `microservicehub`.
2. Create a database user with a strong password and give it **all privileges** on that database.
3. Write down three values. The panel usually adds a prefix, so copy the full names:
   - database name (like `hivecor1_microservicehub`)
   - user name (like `hivecor1_msh`)
   - password

The app creates all of its tables by itself on the first start.

## 2. Upload the files

The ready-made package is `release/microservicehu-app.zip` (about 25 MB, everything included).

1. Open the panel's **File Manager** and go to `/home/hivecor1/` (the folder *above* `public_html`).
2. Upload `microservicehu-app.zip` there, then **Extract** it.
3. You now have `/home/hivecor1/microservicehu-app/` with two folders inside: `backend` and `dist`.

If the upload is refused because the file is too big, use **FTP** instead (FTP menu, then FileZilla): upload the folder `release/microservicehu-app` as it is.

## 3. Create the application (Add Application form)

Fill the form like this. Anything not listed stays as it is.

| Field | Value |
| --- | --- |
| Port | `30000` (already filled in) |
| Application Name | `microservicehub` |
| Deployment Domain | `microservicehu.hivecoredigital.com` |
| Base Application URL | `/` (leave the box empty) |
| Application Path | `/home/hivecor1/` + `microservicehu-app` |
| Application type | **Node.js** (choose the newest version, 18 or higher) |
| Application startup file | `backend/server.js` |
| Deployment Environment | **Production** |
| Start Command | `node backend/server.js` |
| Stop Command | leave empty |

### Environment Variables (the "Add +" button)

Add one row per line (name, then value):

| Name | Value |
| --- | --- |
| `PORT` | `30000` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | the database name from step 1 |
| `DB_USER` | the database user from step 1 |
| `DB_PASSWORD` | the database password from step 1 |
| `APP_URL` | `https://microservicehu.hivecoredigital.com` |
| `API_PUBLIC_URL` | `https://microservicehu.hivecoredigital.com` |
| `INITIAL_ADMIN_EMAIL` | your own email address |
| `INITIAL_ADMIN_PASSWORD` | a strong password of 10+ characters (your login as main admin) |
| `INITIAL_ADMIN_NAME` | your name |

Optional, add them now or later:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | your Google client ID (sign in with Google) |
| `SMTP_HOST` | `mail.hivecoredigital.com` (create an email account such as `noreply@hivecoredigital.com` in the panel's **Email** menu first) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `noreply@hivecoredigital.com` |
| `SMTP_PASS` | that email account's password |
| `MAIL_FROM` | `MicroServiceHub <noreply@hivecoredigital.com>` |

Do not create `JWT_SECRET` yourself: the app makes one the first time it starts and keeps it.

Save and **start** the application.

## 4. Turn on HTTPS

Phone alerts, live location and voice calls only work over HTTPS.

1. Open **SSL** in the left menu and install a free certificate (Let's Encrypt) for `microservicehu.hivecoredigital.com`.
2. Back in **Domain > Manage Domains**, switch **Force HTTPS** to **ON** for the subdomain.

## 5. First check

1. Open `https://microservicehu.hivecoredigital.com`. The home page should load.
2. Log in with `INITIAL_ADMIN_EMAIL` and the password you set. You land in the Admin panel as the **main admin**.
3. **Now delete `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`** from the environment variables and restart the app. They are only needed once.
4. Register a test seeker, and check that you can open the pages.

If the page shows an error, open the application's **log** in the panel. The last lines say what is wrong. Typical causes:

- `Access denied for user`: the database name, user or password is mistyped.
- `Cannot find module`: the zip was extracted into a different folder than the Application Path.
- `EADDRINUSE`: another application already uses the port; use the port the panel suggests.

## Good to know

- **Chat, live location and calls** use WebSockets. If the panel's web server does not pass them through, the app automatically falls back to slower polling, so it still works. If chat feels delayed, tell me.
- **Google sign-in:** in Google Cloud Console add `https://microservicehu.hivecoredigital.com` as an authorized JavaScript origin.
- **Updating later:** upload the new package, extract it over the old folder (keep `backend/.env`, which holds the secret keys), then restart the application.
- **Backups:** use the panel's **Backuply** (it is in your Applications menu) for the database and files.
- The folder `/public_html/microservicehu` from the Manage Domains screen is not used by this app and can stay empty.

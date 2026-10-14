# Deploying Schach Workspace to work.schachengineers.com

> **Repository copy: the admin password is a placeholder.** The owner holds the real value privately. Do not commit it, email it or post it in chat. After the first sign-in, change that password and turn on the authenticator app (step 7).

This deploys a **fresh** installation with no existing data. It uses Docker Compose (PostgreSQL, the app, a database-migration step and the ClamAV virus scanner), with Caddy in front for HTTPS.

Repository: https://github.com/Schach-workplace/Schach_Workspace (private). Use commit `e02ae3f` or later; it includes `compose.production.yaml` and the production image fixes.

---

## 1. Server

| Item | Requirement |
|---|---|
| OS | Ubuntu 24.04 LTS |
| Memory | 4 GB minimum, 8 GB recommended (ClamAV alone uses 2–3 GB) |
| CPU / disk | 2 vCPU, 40 GB+ SSD |
| Region | India |
| Open ports | 22 (SSH), 80 and 443 only |

Do **not** open 8080 (the app listens only on the server itself) or 5432 (the database is never published).

**DNS:** create an `A` record for `work.schachengineers.com` pointing to the server's public IP. Wait until `dig +short work.schachengineers.com` returns that IP.

**Install software:**

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2 caddy
sudo usermod -aG docker $USER
# log out and back in so the docker group applies
```

---

## 2. Get the code

The repository is private, so use a GitHub deploy key or a read-only access token.

```bash
sudo mkdir -p /opt/schach && sudo chown $USER /opt/schach
git clone https://github.com/Schach-workplace/Schach_Workspace.git /opt/schach
cd /opt/schach
git log --oneline -1   # should be e02ae3f or later
```

---

## 3. Generate secrets

Run each command on the server and save the output in your password manager.

```bash
openssl rand -base64 32 | tr -d '/+=' | cut -c1-32   # POSTGRES_PASSWORD
openssl rand -hex 32                                  # MFA_ENCRYPTION_KEY
openssl rand -hex 32                                  # onboarding key (goes inside PEOPLE_CREDENTIAL_RETRY_KEYS_JSON)
```

| Secret | If it is lost |
|---|---|
| `MFA_ENCRYPTION_KEY` | Everyone's authenticator setup becomes unusable. |
| Onboarding key | In-progress onboarding retries cannot be recovered. If you ever rotate it, keep the old key ID listed alongside the new one. |
| `POSTGRES_PASSWORD` | The app cannot reach its database. |

---

## 4. Create `/opt/schach/.env`

```bash
nano /opt/schach/.env
```

Paste the following, replacing the three `<…>` values with the secrets from step 3:

```bash
# Database
POSTGRES_PASSWORD=<generated>

# First admin account (used once, on the empty database)
BOOTSTRAP_EMAIL=techops@schachengineers.com
BOOTSTRAP_NAME=Schach TechOps
BOOTSTRAP_PASSWORD=<ADMIN_BOOTSTRAP_PASSWORD — held privately by the owner>

# Production mode
ENVIRONMENT=production
SECURE_COOKIES=true
ALLOWED_ORIGINS=https://work.schachengineers.com
SESSION_HOURS=72

# Authenticator (MFA) encryption
MFA_ENCRYPTION_KEY=<64 hex characters>

# New-employee onboarding
PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID=prod-2026
PEOPLE_CREDENTIAL_RETRY_KEYS_JSON={"prod-2026":"<64 hex characters>"}

# Chat media limits
COMMUNICATION_MEDIA_LIMIT_BYTES=26214400
COMMUNICATION_USER_QUOTA_BYTES=524288000
COMMUNICATION_COMPANY_QUOTA_BYTES=26843545600
COMMUNICATION_UNUSED_UPLOAD_HOURS=24
COMMUNICATION_MEDIA_RETENTION_DAYS=90
COMMUNICATION_MESSAGE_RETENTION_DAYS=365

# Calls: leave empty until LiveKit is set up (section 10)
LIVEKIT_INTERNAL_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Restrict the file:

```bash
chmod 600 /opt/schach/.env
```

`techops@schachengineers.com` becomes the **Founder** of the first company, the top role. The app requires passwords of at least 12 characters.

---

## 5. Build, migrate and start

```bash
cd /opt/schach
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

The first build takes several minutes. Then check:

```bash
docker compose -f compose.yaml -f compose.production.yaml ps
docker compose -f compose.yaml -f compose.production.yaml logs migrate --tail 30
docker compose -f compose.yaml -f compose.production.yaml logs app --tail 30
curl -s http://127.0.0.1:8080/api/health
```

Expected:
- `migrate` exited successfully after applying all 59 migrations.
- `app`, `db` and `clamav` are running.
- The health check returns `{"ok":true}`.

ClamAV can take a few minutes to download virus signatures the first time. Until it does, file uploads in chat are refused, deliberately.

---

## 6. HTTPS with Caddy

Replace the contents of `/etc/caddy/Caddyfile` with:

```
work.schachengineers.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

Reload and check:

```bash
sudo systemctl reload caddy
curl -s https://work.schachengineers.com/api/health    # {"ok":true}
```

Caddy obtains and renews the TLS certificate automatically, and handles WebSockets (needed for chat) without extra settings.

If you use **nginx** instead, you must add `client_max_body_size 30m;` and WebSocket upgrade headers (`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`), and keep the original `Host` and `Origin` headers.

---

## 7. First sign-in and lock-down

1. Open **https://work.schachengineers.com** and sign in as `techops@schachengineers.com` with password `<ADMIN_BOOTSTRAP_PASSWORD — held privately by the owner>`.
2. **Settings → My account:** change the password to a new strong one and **turn on the authenticator app**. Save the recovery codes somewhere safe.
3. On the server, replace the bootstrap password in `.env` with a random value. Compose still requires the variable, but the app ignores it once accounts exist.
   ```bash
   cd /opt/schach
   sed -i "s|^BOOTSTRAP_PASSWORD=.*|BOOTSTRAP_PASSWORD=$(openssl rand -base64 24)|" .env
   docker compose -f compose.yaml -f compose.production.yaml up -d
   ```
4. In your browser's developer tools (Application → Cookies), confirm the session cookie is marked `Secure` and `HttpOnly`.
5. **Settings:** set the company name, timezone **Asia/Kolkata**, currency **INR** and financial-year start **April**.

---

## 8. Set up the organisation

1. **People → Departments:** create departments (Engineering, Finance, Manufacturing and so on).
2. **Finance → Set budget:** add department budgets if you track spending, and activate them.
3. **People → Onboarding presets** (optional): save reusable role, department, manager and starting-task templates.
4. **People → Add person:** add department heads first, then employees. The steps are Person → Access → Starting work → Review → Done.
   - Give each new person their starting password privately.
   - Ask them to change it and turn on the authenticator app in their first week.
5. Only Founder, CEO or Company admin can add people, and nobody can grant a role above their own.
6. Make sure at least two people can approve expenses. Nobody can approve or pay their own expense.

**Roles at a glance**

| Role | Sees | Can do |
|---|---|---|
| Founder / CEO / Company admin | Whole company | Manage people and settings, oversee all work and finance, approve and pay others' expenses |
| Finance | Company finance | Budgets and categories, approve and pay others' expenses |
| Department head | Own department | Assign and review department work, approve colleagues' expenses within budget (no payments) |
| Manager | Direct reports | Assign and follow up team work |
| Member | Own work | Do tasks, submit for review, file expenses |
| Viewer | Company work, read-only | No changes, no finance |

---

## 9. Backups (set up before real use)

Your data lives in these places. Back up all of them:

| What | Where |
|---|---|
| Database | Docker volume `postgres_data` |
| Chat files | Docker volume `communication_media` |
| Staged receipts | Docker volume `finance_intakes` |
| Report files | Docker volume `report_artifacts` |
| Secrets | `/opt/schach/.env` |

Nightly database dump (for example, from cron at 02:00):

```bash
mkdir -p /backups
cd /opt/schach && docker compose exec -T db pg_dump -U schach -d schach_workspace --format=custom > /backups/schach-$(date +%F).dump
```

- Copy the dumps, the four volumes and `.env` to **encrypted off-server storage**.
- Keep 35 days of copies.
- **Test a restore** at least once, into a separate empty database. Never restore over the live one. A backup is only proven once a restore has worked.

---

## 10. Optional features (add later)

| Feature | What is needed |
|---|---|
| **Voice and video calls** | Self-hosted LiveKit: `deploy/compose.livekit.yaml` plus a private `deploy/livekit.yaml` made from `deploy/livekit.example.yaml`. Set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env`, open 7881/tcp and 7882/udp, and add a TURN server for mobile networks. Never expose port 7880. |
| **Push notifications** (native apps only) | Mount your Firebase service-account JSON and Apple `.p8` key read-only, then set `FCM_SERVICE_ACCOUNT_FILE`, `APNS_AUTH_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=com.schachengineers.workspace` and `APNS_SANDBOX=false`. The phone app is published as **Workspace** with app ID `com.schachengineers.workspace` on both platforms. |
| **Receipt text recognition (OCR)** | Not included in the default image. Receipts are entered manually. |

**Phones:** Android and iPhone browsers work at `https://work.schachengineers.com` once HTTPS is live. Browsers get no push notifications and no background updates; those need the native apps.

---

### 10a. Turning on calls (fixes "Calling is not configured")

That message means `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are empty. Call signalling already goes through `https://work.schachengineers.com`; LiveKit carries the audio and video.

1. Generate a key pair on the server:
   ```bash
   echo schachprod                          # API key name
   openssl rand -base64 48 | tr -d '/+='    # API secret (32+ characters)
   ```
2. Create the LiveKit config:
   ```bash
   cd /opt/schach
   cp deploy/livekit.example.yaml deploy/livekit.yaml && chmod 600 deploy/livekit.yaml
   ```
   Then in `deploy/livekit.yaml`, set:
   ```yaml
   keys:
     schachprod: <secret>
   ```
3. In `.env`, set `LIVEKIT_API_KEY=schachprod` and `LIVEKIT_API_SECRET=<secret>`. Leave `LIVEKIT_INTERNAL_URL` empty; the LiveKit Compose file sets it.
4. Open the media ports in the server firewall **and** the cloud firewall:
   ```bash
   sudo ufw allow 7881/tcp
   sudo ufw allow 7882/udp
   ```
   Never open 7880.
5. Restart with LiveKit included. Use all these `-f` files from now on:
   ```bash
   docker compose -f compose.yaml -f compose.production.yaml -f deploy/compose.livekit.yaml up -d
   docker compose -f compose.yaml -f compose.production.yaml -f deploy/compose.livekit.yaml logs livekit --tail 30
   ```
6. Test two phones on Wi-Fi first, then on mobile data. If Wi-Fi works but mobile data fails, add a **TURN** relay: a DNS name such as `turn.schachengineers.com`, the `turn:` section in `deploy/livekit.yaml` (`enabled: true`, `domain`, `udp_port: 3478`, `tls_port: 5349`, TLS certificate), and those ports opened and published.
7. Phone browsers must be allowed microphone (and camera) access. Native apps need a development or release build, not Expo Go.

## 11. Updating to a new version

Always back up first. After a database migration, an older version of the app cannot simply be put back.

```bash
cd /opt/schach
docker compose exec -T db pg_dump -U schach -d schach_workspace --format=custom > /backups/pre-update-$(date +%F).dump
git pull
docker compose -f compose.yaml -f compose.production.yaml up -d --build
curl -s https://work.schachengineers.com/api/health
```

---

## 12. Before inviting everyone

Test with two or three people:

- [ ] Sign-in with the authenticator app works.
- [ ] A head and a member each see only their own scope.
- [ ] A task is submitted by one person and accepted by another; the owner cannot accept their own work.
- [ ] An expense is approved by someone other than its creator.
- [ ] A chat message and a file upload work.
- [ ] The site works on an iPhone and an Android phone.
- [ ] One backup has been restored successfully into a test database.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| App container keeps restarting | `docker compose -f compose.yaml -f compose.production.yaml logs app`. Production refuses to start if `ALLOWED_ORIGINS` isn't HTTPS, `SECURE_COOKIES` isn't `true` or the database is unreachable. |
| "Add person" returns an error about configuration (503) | `PEOPLE_CREDENTIAL_RETRY_*` is missing, or you started without `-f compose.production.yaml`. |
| Sign-in works but every action fails | `ALLOWED_ORIGINS` must exactly equal `https://work.schachengineers.com`, with no trailing slash. |
| File uploads refused | ClamAV is still loading signatures. Check with `docker compose logs clamav`. |
| Forgot the admin password | There is no public reset page. An operator runs `backend/cmd/reset-password` (from the repository, with Go installed) against the database, supplying `RESET_EMAIL`, `RESET_PASSWORD`, `DATABASE_URL` and `ENVIRONMENT=production` through the environment. See `docs/OPERATIONS.md` → Operator password recovery. The tool isn't included in the Docker image. |

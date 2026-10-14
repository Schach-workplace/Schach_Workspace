# Workspace mobile apps: Android and iOS setup, end to end

This guide takes the **Workspace** phone app from source code to private distribution for your company's staff:
- **Android:** a private app through **Managed Google Play** (with a testing-track alternative).
- **iPhone:** a private **Custom App** through **Apple Business Manager**.

| | Value |
|---|---|
| App name | Workspace |
| App ID (Android package and iOS bundle ID) | `com.schachengineers.workspace` |
| Server built into the app | `https://work.schachengineers.com` |
| Source | `mobile/` in https://github.com/Schach-workplace/Schach_Workspace, commit `083ed57` or later |
| Build service | Expo EAS (cloud builds, so no Mac is required) |

> **Do the server first.** Follow `DEPLOY-work.schachengineers.com.md` until `https://work.schachengineers.com/api/health` returns `{"ok":true}`. The app can't sign in until the server is live on HTTPS.

---

## Part 0: Accounts and lead times (start today)

| Account | Cost | Lead time | Needed for |
|---|---|---|---|
| **D-U-N-S number** for Schach Engineers | Free | **1–2 weeks** | Apple organisation account and Apple Business Manager |
| **Apple Developer Program** (Organisation) | US$99/year | 1–3 days after D-U-N-S | Building and signing the iPhone app |
| **Apple Business Manager** | Free | A few days of verification | Private Custom App distribution to your staff |
| **Google Play Console** (Organisation) | US$25 once | 1–3 days of identity verification | Building and publishing the Android app |
| **Managed Google Play** enterprise | Free | Same day | Private Android distribution (see 2.6) |
| **Firebase** project | Free | Minutes | Android push notifications |
| **Expo** account | Free | Minutes | Cloud builds and submission (EAS) |

Use a shared company mailbox (for example `techops@schachengineers.com`) for every account, not a personal email, and turn on two-factor sign-in everywhere.

---

## Part 1: One-time project setup (any computer with Node.js 20+)

```bash
git clone https://github.com/Schach-workplace/Schach_Workspace.git
cd Schach_Workspace/mobile
npm ci
npx eas-cli@latest login            # your Expo account
npx eas-cli@latest init             # links mobile/ to a new EAS project; commit the projectId it adds
```

Check the configuration:

```bash
npx expo-doctor                       # expect: all checks passed
EXPO_PUBLIC_SERVER_URL=https://work.schachengineers.com npx expo config --type public | grep -E "name:|bundleIdentifier|package:"
```

You should see `Workspace` and `com.schachengineers.workspace` twice.

The build profiles are already in `mobile/eas.json`:

| Profile | Purpose | Server | Android output | iOS output |
|---|---|---|---|---|
| `development` | Developer builds with live reload | Typed at sign-in | Dev client | Dev client |
| `preview` | Test phones before release | Built in | `.apk` (installable directly) | Ad hoc build for registered iPhones |
| `production` | Store / private distribution | Built in | `.aab` (Play) | App Store Connect build |

Version numbers are managed by EAS and increase automatically on each production build.

---

## Part 2: Android

### 2.1 Firebase (push notifications)

1. Go to https://console.firebase.google.com and click **Add project**. Name it, for example, "Workspace".
2. Open **Project settings → General → Your apps → Add app → Android**. Package name: `com.schachengineers.workspace`.
3. Download **`google-services.json`**.
4. Upload it to EAS so builds can use it without storing it in Git:
   - expo.dev → your project → **Environment variables → Add variable**
   - Name: `GOOGLE_SERVICES_JSON`, type **File**, visibility **Secret**
   - Environments: **preview** and **production**
5. In Firebase, open **Project settings → Service accounts → Generate new private key**, and download the JSON key. This file is for **your server**, not the app:
   - Copy it to the server, for example `/opt/schach/secrets/fcm-service-account.json` with `chmod 600`.
   - Mount it read-only into the app container and set `FCM_SERVICE_ACCOUNT_FILE` to that path (see the deployment guide, section 10).

The server sends notifications **directly to Firebase**, so you don't need to upload anything to Expo's push service.

### 2.2 Test build on Android phones

```bash
cd Schach_Workspace/mobile
npx eas-cli@latest build --profile preview --platform android
```

When it finishes, EAS shows a link and QR code. Open it on each test phone, download the `.apk`, and allow "Install unknown apps" when prompted. Test using **Part 4**.

### 2.3 Play Console: create the app

1. https://play.google.com/console → **Create app**
   - App name: **Workspace**
   - Default language: English (India)
   - App or game: **App**; Free or paid: **Free**
   - Accept the declarations.
2. **App content** (Policy section): complete every item.
   - **Privacy policy URL:** e.g. `https://schachengineers.com/privacy` (required).
   - **App access:** "All or some functionality is restricted". Add a **reviewer login** for a test account on `work.schachengineers.com` (create a fictional test company/user for this).
   - **Ads:** No ads.
   - **Data safety:** declare what the app collects (name, email, work content, photos/files you upload, voice/video in calls, device identifiers for notifications), that data is **encrypted in transit**, and that users can ask the company admin to delete their account.
   - **Foreground service permissions:** the app uses a **microphone/media-playback foreground service** to keep calls running when the screen is off. Describe it as: "Keeps an active company voice/video call connected while the app is in the background." Google may ask for a short screen recording of a call.
   - **Target audience:** 18+; content rating questionnaire.
3. **App integrity → App signing:** leave **Google Play App Signing** on (default). EAS uploads with its upload key.

### 2.4 Production build and first upload

```bash
npx eas-cli@latest build --profile production --platform android
```

To let EAS upload for you, create a **Google Cloud service account** with Play Console access:
1. In Play Console, open **Users and permissions → Invite new users**. Use the service-account email created in Google Cloud and grant **Release** permissions for this app.
2. Run `npx eas-cli@latest credentials --platform android` → **Google Service Account → upload the key for submissions**.

Then:

```bash
npx eas-cli@latest submit --profile production --platform android
```

The first submission creates a release on the **Internal testing** track. You can also download the `.aab` from the EAS build page and upload it manually under **Testing → Internal testing → Create new release**.

### 2.5 Internal testing (quick, up to 100 testers)

Go to **Testing → Internal testing → Testers**, add your staff's Google account emails, and share the opt-in link. They install from the Play Store app like any other app. This is the fastest way to start, while Managed Google Play is being set up.

### 2.6 Private distribution through Managed Google Play

A **private app** is visible only to your organisation inside Managed Google Play and is never public.

1. **Create a Managed Google Play enterprise** for Schach Engineers. Options:
   - **Google Workspace / Cloud Identity:** Admin console → Devices → Mobile & endpoints → Settings → Android → enable "Managed Google Play".
   - Or bind through your **EMM/MDM** provider (Microsoft Intune, ManageEngine, Scalefusion, Hexnode and so on).
2. Note your **Organisation ID** (shown in the Managed Google Play / Admin settings).
3. In Play Console, open **Setup → Advanced settings → Managed Google Play** (labelled "Managed Google Play" or "Private apps"). Turn it on and **add your Organisation ID**.
4. Complete a release on the **Production** track. For private apps it only reaches your organisation.
5. In your Workspace Admin console or EMM, **approve** the Workspace app and assign it to users or groups. Staff then see it in the **Work** Play Store on their managed devices or work profiles.

> If staff use personal phones without a work profile, the **internal testing track (2.5)** or a **closed testing track** with email lists is simpler and still private.

### 2.7 Android updates later

```bash
git pull
npx eas-cli@latest build --profile production --platform android
npx eas-cli@latest submit --profile production --platform android
```

Then promote the release in Play Console (Internal testing → Production) or approve the update in your EMM.

---

## Part 3: iPhone (iOS)

No Mac is needed: EAS builds and signs in the cloud.

### 3.1 Apple Developer account

1. Enrol at https://developer.apple.com/programs/enroll/ as an **Organisation** using the D-U-N-S number.
2. After approval, note your **Team ID** (Membership details).

### 3.2 Push notification key (APNs)

1. developer.apple.com → **Certificates, Identifiers & Profiles → Keys → +**.
2. Name it "Workspace APNs" and tick **Apple Push Notifications service (APNs)**. Continue, then download the **`.p8`** file. **You can only download it once.**
3. Note the **Key ID** and your **Team ID**.
4. On your server:
   - Copy the `.p8` to `/opt/schach/secrets/apns.p8` (`chmod 600`) and mount it read-only into the app container.
   - Set `APNS_AUTH_KEY_FILE` to that path, plus `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=com.schachengineers.workspace` and `APNS_SANDBOX=false`. Use `APNS_SANDBOX=true` only while testing development builds.

### 3.3 App Store Connect: create the app record

1. https://appstoreconnect.apple.com → **Apps → + → New App**
   - Platform: iOS; Name: **Workspace**. If the name is already taken in the store, use e.g. "Workspace for Teams"; the icon label stays "Workspace".
   - Primary language: English (India)
   - Bundle ID: `com.schachengineers.workspace`. EAS registers it on first build; or create it under Certificates, Identifiers & Profiles → Identifiers first.
   - SKU: `workspace-ios`
2. Note the app's **Apple ID** (App Information → General Information). You'll put it in `eas.json` as `ascAppId`.
3. Add it to `mobile/eas.json`:
   ```json
   "submit": {
     "production": {
       "ios": { "ascAppId": "1234567890" }
     }
   }
   ```

### 3.4 Test build on iPhones (ad hoc)

Register each test iPhone, then build:

```bash
npx eas-cli@latest device:create          # gives a link/QR; open it on each test iPhone to register it
npx eas-cli@latest build --profile preview --platform ios
```

EAS creates the certificates and provisioning profile (sign in with your Apple account when asked). Install from the build link on the registered iPhones, then test using **Part 4**.

> Alternative: build `production` and use **TestFlight** (3.6) for testers. No device registration is needed, and builds expire after 90 days.

### 3.5 Production build and upload

```bash
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --profile production --platform ios
```

On the first `submit`, let EAS create and store an **App Store Connect API key** (or run `npx eas-cli@latest credentials --platform ios` beforehand). The build appears in App Store Connect → **TestFlight** after Apple's processing (10–30 minutes).

**Export compliance:** when App Store Connect asks about encryption, the app only uses standard HTTPS/TLS and the operating system's encryption. This normally qualifies as **exempt**. Confirm with your own legal judgement.

### 3.6 TestFlight (quick start)

Go to App Store Connect → **TestFlight**.
- **Internal testing:** up to 100 people who are users of your App Store Connect team.
- **External testing:** up to 10,000 people by email or public link. Needs a light beta review.

### 3.7 Private distribution as a Custom App (Apple Business Manager)

1. **Enrol in Apple Business Manager** at https://business.apple.com with the same D-U-N-S number. Note the **Organisation ID** (Preferences → Enrolment information).
2. In App Store Connect, open your app → **Pricing and Availability → App Distribution Methods**:
   - Choose **Private Distribution** ("available only to specific businesses").
   - Add your **Apple Business Manager Organisation ID**.
   - **This is permanent.** A private app can never later be made public, so create a separate app record if you ever want a public version.
3. Fill in the **App Review information**:
   - A **reviewer account**: a fictional test user and company on `work.schachengineers.com` with sample data.
   - Notes for the reviewer: "Business app for company staff. Accounts are created by the company administrator. Calls use the microphone/camera; background audio keeps an active call connected."
4. Add screenshots (6.7" and 6.1" iPhone; iPad if `supportsTablet` stays on), the privacy policy URL, the support URL and the **App Privacy** answers (same data as the Android Data safety form).
5. **Submit for review.** Custom Apps still go through App Review, usually 1–3 days.
6. After approval, in **Apple Business Manager → Apps and Books**, the app appears under Custom Apps. **Get licences** (free) and either:
   - **with an MDM:** assign the app to devices or users and it installs automatically; or
   - **without an MDM:** choose **Redemption codes**, download the codes, and send one to each employee. They open the code link on their iPhone, and the App Store installs Workspace.

### 3.8 iOS updates later

```bash
git pull
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --profile production --platform ios
```

In App Store Connect, add the new build to a new version and **Submit for review**. After approval, managed devices update automatically and others update from the App Store.

---

## Part 4: Test plan before rollout

Run on **at least one Android phone and one iPhone**, on both **Wi-Fi and mobile data**. Record results (phone model, OS version, build number, pass/fail) in a copy of `docs/qa/execution-log.csv` kept outside `docs/qa/`.

| # | Check | Pass when |
|---|---|---|
| 1 | Install and open | App shows **Workspace** sign-in with no server field |
| 2 | Sign in + authenticator code | Lands on the user's company |
| 3 | Company switching | Only the user's own companies appear |
| 4 | My work → open task → submit for review | Another person can accept it; the owner cannot |
| 5 | New expense with **camera** receipt | Receipt attached; approval by someone else works |
| 6 | Chat: message, photo, file, voice note | Arrives on another phone |
| 7 | Message → Create task | Shows title + audience; needs confirmation |
| 8 | **Audio and video call** between two phones | Connects on Wi-Fi **and** mobile data (mobile data may need TURN; see deployment guide section 10) |
| 9 | Call with screen locked / app in background | Call stays connected |
| 10 | **Push notification** with app closed | Arrives; tapping opens the right chat / task / expense |
| 11 | Background → foreground after 5 minutes | Re-checks sign-in, no private content flashes |
| 12 | Large text size and screen reader (TalkBack / VoiceOver) | Screens readable and operable |
| 13 | Sign out; Settings → devices → revoke a lost phone | Revoked phone is signed out |

Fix anything found, rebuild, and retest before inviting everyone.

---

## Part 5: Server settings that must match the apps

These go in `/opt/schach/.env` on the server, with the key files mounted read-only into the app container:

```bash
# Android push (Firebase service account JSON, mounted into the container)
FCM_SERVICE_ACCOUNT_FILE=/run/secrets/fcm-service-account.json

# iPhone push (APNs key)
APNS_AUTH_KEY_FILE=/run/secrets/apns.p8
APNS_KEY_ID=<Key ID>
APNS_TEAM_ID=<Team ID>
APNS_BUNDLE_ID=com.schachengineers.workspace
APNS_SANDBOX=false
```

Example Compose addition (`compose.push.yaml`), used with the other `-f` files:

```yaml
services:
  app:
    environment:
      FCM_SERVICE_ACCOUNT_FILE: /run/secrets/fcm-service-account.json
      APNS_AUTH_KEY_FILE: /run/secrets/apns.p8
      APNS_KEY_ID: ${APNS_KEY_ID}
      APNS_TEAM_ID: ${APNS_TEAM_ID}
      APNS_BUNDLE_ID: com.schachengineers.workspace
      APNS_SANDBOX: "false"
    volumes:
      - ./secrets/fcm-service-account.json:/run/secrets/fcm-service-account.json:ro
      - ./secrets/apns.p8:/run/secrets/apns.p8:ro
```

```bash
docker compose -f compose.yaml -f compose.production.yaml -f deploy/compose.livekit.yaml -f compose.push.yaml up -d
```

Calls also need LiveKit configured on the server (deployment guide section 10).

---

## Part 6: Checklist

**Accounts**
- [ ] D-U-N-S number
- [ ] Apple Developer (Organisation)
- [ ] Apple Business Manager
- [ ] Google Play Console (Organisation)
- [ ] Managed Google Play enterprise (or decide on testing tracks)
- [ ] Firebase project
- [ ] Expo account; `eas init` done

**Files and keys** (store in your password manager, never in Git)
- [ ] `google-services.json` uploaded to EAS as `GOOGLE_SERVICES_JSON` (File, Secret)
- [ ] Firebase service-account JSON on the server (`FCM_SERVICE_ACCOUNT_FILE`)
- [ ] APNs `.p8` key on the server (`APNS_*`)
- [ ] App Store Connect API key (created by EAS on first submit)
- [ ] Google Play service-account key for `eas submit`

**Store details**
- [ ] Privacy policy URL and support URL
- [ ] Reviewer test account on `work.schachengineers.com` (fictional company and data)
- [ ] Screenshots (phone; tablet if supported)
- [ ] Data safety (Google) and App Privacy (Apple) answers
- [ ] Foreground-service declaration (Google) and background-audio note (Apple)
- [ ] Export compliance answered

**Release**
- [ ] Preview builds tested on real Android and iPhone (Part 4)
- [ ] Production builds submitted
- [ ] Android: private app approved in Managed Google Play or testing track shared
- [ ] iOS: Custom App approved; licences assigned or redemption codes sent

---

## Notes and limits

- **The icon is a neutral placeholder** (two orange panels with a check). To change it, replace `mobile/assets/source/*.svg`, run `mobile/assets/source/render.sh`, then rebuild.
- **The app ID can never change** once the app is published.
- **iOS private distribution is permanent** for that app record.
- Calls, push notifications and background behaviour have **not yet been tested on real phones or a real server**. Part 4 is that first test, so report any failure with phone model, OS version and the exact message.
- Staff accounts are created by company admins in the web app (People → Add person). The app has no self-sign-up.

# Setup & maintenance notes

Technical notes for whoever maintains the app. For using the app, see the [user manual](Task-Reminder-Manual.pdf).

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Web app | `web/` | Plain HTML/CSS/JS with no build step. Hosted on Firebase Hosting. |
| Database + login | Firebase | Google Auth and Firestore. Rules in `firestore.rules` let each user see only their own tasks. |
| Reminders | `.github/workflows/reminders.yml` → `scripts/send-reminders.mjs` | Runs every 10 minutes on GitHub (free for public repos) and sends push notifications through Firebase Cloud Messaging. |
| Deploy | `.github/workflows/deploy.yml` | Every push to `main` that touches `web/` publishes the site. |
| APK | `.github/workflows/build-apk.yml` + `android/` | Builds the Android app and publishes it as a GitHub Release. |

Everything stays on the free Firebase **Spark** plan, so no credit card is needed.

## One-time setup (all doable from a phone)

Tip: in Chrome on your phone, turn on **⋮ → Desktop site** for the Firebase and GitHub settings pages. It makes them much easier to use.

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Create a project**, give it a name, and finish. Google Analytics is optional.
2. **Build → Authentication → Get started → Google → Enable**. Pick your support email and **Save**.
3. **Build → Firestore Database → Create database**. Pick a location near you and **Start in production mode**.
4. **Build → Hosting → Get started**, then just click through with **Next**. You don't need to run the commands it shows.

### 2. Get the web config
1. Open **⚙ Project settings → General → Your apps → `</>` (Web)**. Give it any nickname and **Register app**.
2. Copy the `firebaseConfig` values it shows.
3. Open **⚙ Project settings → Cloud Messaging → Web Push certificates → Generate key pair**, and copy the key.
4. Put the values from steps 2 and 3 into [`web/firebase-config.js`](../web/firebase-config.js), or just paste them to Claude and ask it to do it. These values are not secret.

### 3. Add GitHub secrets
Open the repo on GitHub → **Settings → Secrets and variables → Actions → New repository secret** and add:

| Name | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase **⚙ Project settings → Service accounts → Generate new private key**. It downloads a `.json` file. Open it in any text viewer, copy **all** of it, and paste it here. |
| `ANDROID_KEYSTORE_BASE64` | The app's signing key (Claude gave you this as a text file). |
| `ANDROID_KEYSTORE_PASSWORD` | The signing key's password (also from Claude). |

⚠️ Never commit the service-account JSON or the keystore to the repo. It is public.

### 4. Go live
1. Merge the pull request into `main`. **Deploy web app** runs automatically, and your app is live at `https://<project-id>.web.app`.
2. **Actions → Build Android APK → Run workflow**. When it finishes, open **Releases** on the repo page, download `task-reminder.apk`, and install it. Android will ask you to allow installing from your browser.
3. Open the app, sign in with Google, and tap **Enable** on the reminders banner.

After that, anything merged to `main` updates the app automatically. The APK only needs rebuilding if `android/` changes.

## Troubleshooting

- **Deploy fails with "permission denied" / 403**: the service account needs a role. Copy its email from Firebase **⚙ Project settings → Service accounts** (it looks like `firebase-adminsdk-…@<project>.iam.gserviceaccount.com`). Then in [Google Cloud IAM](https://console.cloud.google.com/iam-admin/iam), tap **Grant access**, paste the email, pick the **Firebase Admin** role, and **Save**. It can take a few minutes to apply.
- **No notifications**: check that the app's **Settings** screen says reminders are **On**. Then check **Actions → Send reminders** for errors; you can also trigger it by hand with **Run workflow**. GitHub can delay scheduled runs by a few minutes.
- **APK shows a browser address bar at the top**: the web app has to be deployed *after* the `ANDROID_KEYSTORE_*` secrets were added. Re-run **Deploy web app**.

## Development

```sh
npm install
npm test            # urgency rule tests
npm run icons       # regenerate PNG icons (web + Android)
```

To preview the web app locally, serve `web/` (e.g. `npx serve web`). Google sign-in only works on `localhost` or on your Firebase domains.

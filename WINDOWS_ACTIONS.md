# Windows installer builds

The `Windows Desktop Build` workflow creates NSIS (`.exe`) and MSI installers
on every push to `main`, or when manually run from **Actions**.

## Repository variables

In GitHub, open **Settings → Secrets and variables → Actions → Variables** and
create the following values. They are compiled into the desktop frontend.

| Variable | Example |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://pos.express-travel-ticketing.online/api` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://pos.express-travel-ticketing.online/api` |
| `NEXT_PUBLIC_DJANGO_URL` | `https://pos.express-travel-ticketing.online` |

## Optional signing secrets

Tauri update signatures are optional for installer builds. If using Tauri's
updater, add these under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of the Tauri private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating that key |

Never commit these values or a private key. To generate a key pair locally:

```bash
npx tauri signer generate -w ~/.tauri/handypos.key
```

The matching public key belongs in Tauri updater configuration only when the
updater is enabled.

## Downloading an installer

After a successful run, open **Actions → Windows Desktop Build → the run →
Artifacts** and download `handy-pos-windows-<run number>`.

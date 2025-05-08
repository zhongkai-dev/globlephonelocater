# Railway Deployment Checklist

## Pre-Deployment Checklist

- [x] Project has a valid `package.json` with a `start` script
- [x] Project has a `Procfile` defined
- [x] Database directory creation code is added
- [x] Environment variables are documented in `.env.example`
- [x] `.gitignore` is set up to exclude sensitive files
- [x] `railway.json` configuration file is created
- [x] Project has proper documentation in `README.md`
- [x] Detailed deployment guide is available in `RAILWAY_DEPLOY.md`

## Deployment Steps

1. Create a GitHub repository and push your code
2. Sign up for Railway using your GitHub account
3. Create a new project in Railway and connect your repository
4. Configure all environment variables in Railway:
   - [ ] `TELEGRAM_BOT_TOKEN`
   - [ ] `VERIPHONE_API_KEY`
   - [ ] `PORT`
   - [ ] `ADMIN_USERNAME`
   - [ ] `ADMIN_PASSWORD`
   - [ ] `SESSION_SECRET`
5. Deploy the application

## Post-Deployment Verification

- [ ] Check deployment logs for any errors
- [ ] Test the Telegram bot by sending messages
- [ ] Access the admin panel to verify it works
- [ ] Check that user limits are working properly
- [ ] Verify carrier detection functionality
- [ ] Monitor the application for stability

## Important Notes

- SQLite database will be stored in the ephemeral filesystem on Railway
  - This is fine for moderate usage but consider migrating to PostgreSQL for heavy usage
- Railway offers auto-restart on failure (configured in `railway.json`)
- Make sure to monitor your API key usage (Veriphone and sent.dm) 
# Deploying to Railway

Follow these steps to deploy your Phone Location Bot to Railway:

## 1. Prepare Your Project

Make sure your project has:
- A `package.json` file with a `start` script
- A `Procfile` (already created)
- All necessary environment variables defined in `.env.example`

## 2. Create a GitHub Repository

1. Create a new repository on GitHub
2. Push your code to the repository:
```bash
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 3. Sign Up for Railway

1. Go to [Railway.app](https://railway.app/)
2. Sign up using your GitHub account

## 4. Create a New Project

1. Click "New Project" in the Railway dashboard
2. Select "Deploy from GitHub repo"
3. Choose your repository
4. Click "Deploy Now"

## 5. Configure Environment Variables

1. Go to your project in Railway
2. Click on the "Variables" tab
3. Add the following variables:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
   - `VERIPHONE_API_KEY`: Your Veriphone API key
   - `PORT`: 3000 (or another port)
   - `ADMIN_USERNAME`: Admin panel username
   - `ADMIN_PASSWORD`: Admin panel password
   - `SESSION_SECRET`: A random string for session security

## 6. Set Up Database

Railway will automatically create your SQLite database in the `database` directory because we've added code to ensure this directory exists.

## 7. Verify Deployment

1. Check the "Deployments" tab to see if your application deployed successfully
2. Test your bot by sending a message to it on Telegram
3. Access the admin panel at `https://<your-railway-url>/admin/login`

## 8. (Optional) Add a Custom Domain

1. Go to the "Settings" tab of your project
2. Click "Generate Domain" or "Add Custom Domain"
3. Follow the instructions to set up your domain

## Monitoring and Logs

- Check the "Logs" tab in your Railway dashboard to view application logs
- Monitor your application's performance in the "Metrics" tab

## Troubleshooting

If you encounter issues:
1. Check the application logs in Railway
2. Verify all environment variables are set correctly
3. Make sure your bot token is valid
4. Check that your code initializes the database properly 
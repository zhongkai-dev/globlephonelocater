# Phone Location Bot

A Telegram bot that provides carrier and location information for phone numbers. The bot includes an admin panel for user management and tracking.

## Features

- Phone number validation and location detection
- Carrier identification (T-Mobile, AT&T, Verizon, and others)
- Daily usage limits for users
- Admin panel for managing users, API keys, and viewing statistics
- API key rotation to avoid rate limits

## Environment Variables

Create a `.env` file with the following variables:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
VERIPHONE_API_KEY=your_veriphone_api_key_here
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure_password_here
SESSION_SECRET=a_secure_random_string
```

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with the required environment variables
4. Run the bot: `npm run dev`

## Deployment on Railway

1. Create a new project on [Railway](https://railway.app/)
2. Connect your GitHub repository
3. Set up the environment variables in Railway
4. Deploy the application

## Admin Panel

Access the admin panel at `/admin/login` to manage users, view statistics, and configure API keys.

## Tech Stack

- Node.js
- Express
- SQLite
- EJS templates
- Telegram Bot API
- Veriphone API
- sent.dm API for carrier detection 
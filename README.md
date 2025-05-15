# Phone Locator Bot

This bot helps you verify phone numbers and provides detailed carrier information.

## Features

- Phone number validation
- Carrier information
- Country and region detection
- Support for bulk checking multiple numbers
- Daily usage limits for users

## Deployment to Railway

### Prerequisites

- [Railway](https://railway.app/) account
- [Railway CLI](https://docs.railway.app/develop/cli) installed

### Steps to Deploy

1. Login to Railway:
   ```
   railway login
   ```

2. Initialize Railway project:
   ```
   railway init
   ```

3. Set environment variables on Railway dashboard:
   - TELEGRAM_BOT_TOKEN
   - VERIPHONE_API_KEY
   - SESSION_SECRET
   - ADMIN_USERNAME
   - ADMIN_PASSWORD

4. Deploy the project:
   ```
   railway up
   ```

5. Open the deployed project:
   ```
   railway open
   ```

## Environment Variables

The following environment variables are required:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from @BotFather
- `VERIPHONE_API_KEY`: API key for Veriphone service
- `SESSION_SECRET`: Secret for session management
- `ADMIN_USERNAME`: Username for admin panel
- `ADMIN_PASSWORD`: Password for admin panel
- `PORT` (optional): Port for the web server, defaults to 3000

## Local Development

1. Clone the repository
2. Run `npm install`
3. Create a `.env` file with the required environment variables
4. Run `npm start` 
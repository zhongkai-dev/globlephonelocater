# Phone Locator Bot

This application helps verify phone numbers and provides carrier information.

## Deployment Instructions for Render.com

1. Create a free account on [Render.com](https://render.com)
2. Connect your GitHub account to Render
3. Push this code to a GitHub repository:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/phonelocater.git
   git push -u origin main
   ```
4. In Render dashboard, click "New" → "Blueprint"
5. Select the GitHub repository with this code
6. Render will automatically detect the `render.yaml` configuration
7. Set up these required environment variables:
   - `MONGODB_URI`: Your MongoDB connection string
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
   - `VERIPHONE_API_KEY`: Your Veriphone API key

The application will be automatically deployed and available at a Render-provided URL.

## Setting up MongoDB

For the database, you can use:
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier)
- Render's MongoDB service (requires credit card for verification)

## Features

- Phone number validation
- Carrier detection
- Country and region detection
- Tracking of daily usage and limits
- Admin panel for management

## Requirements

- Node.js 18+
- MongoDB
- Telegram Bot Token

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Configure environment variables in `.env` file:
   ```
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   VERIPHONE_API_KEY=your_veriphone_api_key
   SESSION_SECRET=your_session_secret
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=password
   MONGODB_URI=your_mongodb_connection_string
   PORT=3000
   ```

3. Start the application:
   ```
   npm start
   ```

   For development with auto-restart:
   ```
   npm run dev
   ```

## Docker Deployment

1. Build the Docker image:
   ```
   docker build -t phone-locator-bot .
   ```

2. Run the container:
   ```
   docker run -p 3000:3000 --env-file .env phone-locator-bot
   ```

## MongoDB Migration

The application now uses MongoDB instead of SQLite. The database connection is configured in `models/index.js`.

All data models are now stored in MongoDB collections:
- Users
- API Keys
- Settings
- Lookup History

### SQLite Compatibility

The application includes a compatibility layer (`db-compat.js`) that handles SQLite gracefully. This allows:
- Running migration scripts that still reference SQLite
- Operating in environments where SQLite may or may not be available 
- Easy transition from SQLite to MongoDB

When running in Docker, SQLite is skipped entirely using the `--no-optional` flag during installation.

## Admin Panel

Access the admin panel at `/admin` with the credentials set in the `.env` file.

## License

ISC 
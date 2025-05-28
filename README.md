# Phone Locator Bot

A Telegram bot that helps verify phone numbers and provides detailed carrier information.

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

ISC "# globlephonelocater" 

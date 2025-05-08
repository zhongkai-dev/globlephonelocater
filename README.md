# Phone Location Bot

A Telegram bot that allows users to look up phone number information including country, carrier, and line type. The system includes a web-based admin panel for managing users, API keys, and viewing lookup history.

## Features

### Telegram Bot
- Phone number lookup with detailed information
- Country detection
- Carrier information 
- Line type detection (mobile, landline, VoIP)
- User management with request limits

### Admin Panel
- User-friendly dashboard with key statistics
- User management (add, block, unblock users)
- API key management (add, rotate, delete)
- Request history with filtering options
- User limit management

## Requirements

- Node.js (v14+)
- npm or yarn
- Telegram Bot Token (from BotFather)
- Veriphone API Key

## Installation

1. Clone the repository:
```
git clone https://github.com/yourusername/phonelocater.git
cd phonelocater
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file in the root directory with the following content:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
VERIPHONE_API_KEY=your_veriphone_api_key
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=securepassword
SESSION_SECRET=some_random_string
```

4. Start the application:
```
npm start
```

## Usage

### Telegram Bot
1. Start a chat with your bot on Telegram
2. Send a phone number in international format (e.g., +1234567890)
3. The bot will respond with information about the phone number

### Admin Panel
1. Access the admin panel at `http://localhost:3000/admin`
2. Log in with your admin credentials (set in the .env file)
3. Navigate through the dashboard to manage users, API keys, and view lookup history

## Deployment

The application is configured for easy deployment on Railway. Refer to the `RAILWAY_DEPLOY.md` file for detailed deployment instructions.

## Directory Structure

```
phonelocater/
├── database/         # SQLite database files
├── public/           # Static assets
├── routes/           # Express routes
│   └── admin.js      # Admin panel routes
├── views/            # EJS templates
│   └── admin/        # Admin panel views
├── .env              # Environment variables
├── .env.example      # Example environment variables
├── index.js          # Main application entry point
├── package.json      # Dependencies and scripts
└── README.md         # This file
```

## License

MIT 
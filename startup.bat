@echo off
echo Building and starting the Phone Locator Bot...
docker-compose up -d --build

echo Container is now running!
echo Access the admin panel at http://localhost:3000/admin
echo Bot should be active on Telegram if token is correct

echo.
echo Showing logs (press Ctrl+C to exit):
docker-compose logs -f 
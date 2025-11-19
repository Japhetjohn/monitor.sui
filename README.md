# Sui Wallet Monitor - Telegram Bot 🤖

A Python Telegram bot that monitors Sui blockchain wallets and sends real-time notifications to Telegram whenever any transaction occurs.

## Bot Information

- **Bot Username**: @monitorsuiwalletbot
- **Bot URL**: https://t.me/monitorsuiwalletbot
- **Token**: `8587301602:AAGB61luA8mVYy4W18tvSxmDSLitXs-IuDQ`

## Features ✨

- 🔔 **Real-time Notifications** - Get instant Telegram messages for all wallet activities
- 💰 **Multi-Wallet Support** - Monitor multiple wallets simultaneously
- 📊 **Smart Detection** - Automatically identifies transaction types:
  - Token transfers (in/out)
  - DEX swaps (Cetus, Turbos, DeepBook)
  - NFT minting and transfers
  - Staking and unstaking
  - Smart contract interactions
- 💾 **Persistent Storage** - Your wallets are saved and restored automatically
- 🔗 **SuiNS Support** - Monitor wallets using @names or 0x addresses
- 📈 **Detailed Info** - Every notification includes:
  - Transaction type and description
  - Balance changes for all tokens
  - Sender/recipient addresses
  - Gas costs
  - Direct link to explorer

## Quick Start 🚀

### 1. Local Testing (Optional)

```bash
# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "TELEGRAM_BOT_TOKEN=8587301602:AAGB61luA8mVYy4W18tvSxmDSLitXs-IuDQ" > .env

# Run the bot
python telegram_bot.py
```

### 2. Deploy to Render (Recommended for 24/7)

#### Step 1: Push to GitHub

```bash
git add .
git commit -m "Add Telegram bot for Sui wallet monitoring"
git push origin main
```

#### Step 2: Deploy on Render

1. Go to https://dashboard.render.com/
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `sui-wallet-monitor-bot`
   - **Environment**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python telegram_bot.py`
   - **Plan**: Free (or paid for better uptime)

5. Add Environment Variable:
   - **Key**: `TELEGRAM_BOT_TOKEN`
   - **Value**: `8587301602:AAGB61luA8mVYy4W18tvSxmDSLitXs-IuDQ`

6. Click **"Create Web Service"**

#### Step 3: Use Your Bot

1. Open Telegram: https://t.me/monitorsuiwalletbot
2. Send `/start` to initialize
3. Add wallets:
```
/add 0x21ba03ab19b4fd9688b8c5973dcb1225914061282eeb66c2d7dd1d287929ddde Dev Wallet
/add 0x89d3a9c91cbfeb9b59335c526b0726262a51f2e0ef97775397feb83d194f4e2c Trading Wallet
```

## Bot Commands 📋

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Show welcome message | `/start` |
| `/add` | Add wallet to monitor | `/add 0x21ba...ddde Dev Wallet` |
| `/remove` | Remove a wallet | `/remove` |
| `/list` | List monitored wallets | `/list` |
| `/status` | Check bot status | `/status` |

## Usage Examples 📱

### Add Wallet with Address
```
/add 0x21ba03ab19b4fd9688b8c5973dcb1225914061282eeb66c2d7dd1d287929ddde Dev Wallet
```

### Add Wallet with SuiNS Name
```
/add @myname My Personal Wallet
```

### View All Wallets
```
/list
```

### Remove a Wallet
```
/remove
```
(Then click the wallet you want to remove)

## Notification Example 🔔

When a transaction occurs, you'll receive:

```
🔔 New Transaction on Dev Wallet

💰 Money In
📝 Got 10.5000 SUI

💰 Balance Changes:
  +10.500000 SUI

👤 From: 0x12345...6789
⛽ Gas: 0.001234 SUI
✅ Status: Success
🕐 2025-11-19 20:00:00 UTC

🔗 View on Explorer
```

## Project Structure 📁

```
monitor.sui/
├── telegram_bot.py           # Main bot application
├── requirements.txt          # Python dependencies
├── render-bot.yaml          # Render deployment config
├── .env.example             # Environment template
├── .gitignore              # Git ignore rules
├── README.md               # This file
└── QUICKSTART_TELEGRAM.md  # Quick start guide
```

## Configuration ⚙️

The bot can be configured via environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | Yes |

Other settings (in code):
- `CHECK_INTERVAL = 5` - Seconds between wallet checks
- `SUI_RPC_URL` - Sui RPC endpoint (default: mainnet)
- `WALLETS_FILE` - Storage file (default: monitored_wallets.json)

## How It Works 🔧

1. **Initialization**: Bot loads saved wallets from `monitored_wallets.json`
2. **Monitoring Loop**: Every 5 seconds, checks each wallet for new transactions
3. **Detection**: Queries Sui RPC for both incoming and outgoing transactions
4. **Parsing**: Analyzes transaction data to detect activity type
5. **Notification**: Formats and sends message to your Telegram chat
6. **Persistence**: Saves wallet list and tracks last checked transaction

## Troubleshooting 🔧

### Bot not responding?
- Check bot is running (locally or on Render)
- Send `/start` to reinitialize
- Check logs for errors

### Not receiving notifications?
- Verify wallets are added: `/list`
- Ensure wallet has recent activity
- Check bot logs for errors
- Wait 5 seconds (monitoring interval)

### Deployment issues?
- Verify `TELEGRAM_BOT_TOKEN` is set in Render
- Check Render logs for errors
- Ensure Python 3.8+ is used

## Tech Stack 💻

- **Language**: Python 3.8+
- **Bot Framework**: python-telegram-bot 20.7
- **HTTP Client**: aiohttp (async)
- **Blockchain**: Sui Network Mainnet
- **Storage**: JSON file

## Security 🔒

- **Never commit** `.env` file or expose your bot token
- Bot token is stored securely in Render environment variables
- Only you can access your monitored wallets
- No data is shared with third parties

## Pre-configured Wallets 👛

Your two wallets ready to monitor:

1. **Dev Wallet**
   ```
   0x21ba03ab19b4fd9688b8c5973dcb1225914061282eeb66c2d7dd1d287929ddde
   ```

2. **Trading Wallet**
   ```
   0x89d3a9c91cbfeb9b59335c526b0726262a51f2e0ef97775397feb83d194f4e2c
   ```

## Support 💬

For issues or questions:
1. Check this README
2. Review bot logs
3. Verify configuration

## License 📄

MIT

---

**Built with ❤️ for the Sui ecosystem**

Start monitoring: https://t.me/monitorsuiwalletbot 🚀

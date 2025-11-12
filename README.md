# Sui Wallet Monitor 🔍

A beautiful, real-time Sui blockchain wallet activity monitor with live notifications.

## Features ✨

- **Real-time Monitoring**: Track all transactions on a Sui wallet address in real-time
- **Beautiful UI**: Modern, responsive design with smooth animations
- **Browser Notifications**: Get notified instantly when new transactions occur
- **Live Updates**: WebSocket-based live feed of wallet activities
- **Transaction Details**: View comprehensive transaction information including:
  - Transaction type (Sent/Received)
  - Amount and coin type
  - Timestamp and status
  - Gas usage
  - Direct link to block explorer

## Tech Stack 🛠

- **Backend**: Node.js, Express, WebSocket
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Blockchain**: Sui Network (Mainnet)
- **Styling**: Custom CSS with modern gradients and animations

## Quick Start 🚀

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd monitor.sui
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (optional):
```bash
cp .env.example .env
```

Edit `.env` if you want to monitor a different wallet or change the port.

4. Start the server:
```bash
npm start
```

5. Open your browser and navigate to:
```
http://localhost:3000
```

## Deployment on Render 🌐

This application is ready to deploy on Render with zero configuration!

### One-Click Deploy

1. Push this repository to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New +" and select "Web Service"
4. Connect your GitHub repository
5. Render will automatically detect the configuration
6. Click "Create Web Service"

### Manual Configuration

If needed, use these settings:

- **Environment**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Port**: Auto-detected from environment

### Environment Variables (Optional)

You can set these in the Render dashboard:

- `PORT`: Server port (default: 3000)
- `WALLET_ADDRESS`: Wallet to monitor (default: @pawtato-land)

## Usage 📱

1. **Enable Notifications**: Click the bell icon to enable browser notifications
2. **Monitor Activity**: Watch real-time transactions as they happen
3. **View Details**: Click transaction cards to see full details
4. **Block Explorer**: Click transaction hashes to view on SuiVision

## Architecture 🏗

### Backend (server.js)

- Express server for API endpoints
- WebSocket server for real-time updates
- Sui RPC integration for blockchain data
- Automatic transaction polling (5-second intervals)

### Frontend (public/)

- **index.html**: Main application structure
- **styles.css**: Beautiful, responsive styling
- **app.js**: WebSocket client, real-time updates, notifications

## API Endpoints 🔌

- `GET /`: Main application page
- `GET /api/resolve/:name`: Resolve SuiNS name to address
- `GET /api/transactions/:address`: Get transaction history
- `GET /api/history`: Get cached transaction history
- `WebSocket /`: Real-time transaction feed

## Browser Support 🌐

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

## Features in Detail 🎯

### Real-Time Monitoring

The application connects to the Sui blockchain mainnet and polls for new transactions every 5 seconds. When a new transaction is detected, it's immediately pushed to all connected clients via WebSocket.

### Browser Notifications

When enabled, the app will show native browser notifications for:
- New incoming transactions (Received)
- New outgoing transactions (Sent)
- Other wallet activities

### Transaction Types

The monitor tracks all transaction types:
- **Received**: Incoming tokens
- **Sent**: Outgoing tokens
- **Transaction**: Other blockchain interactions

### Beautiful UI

- Gradient backgrounds and smooth animations
- Responsive design for mobile and desktop
- Dark theme optimized for readability
- Real-time status indicators
- Transaction history with infinite scroll

## Development 👩‍💻

### Run in Development Mode

```bash
npm run dev
```

This uses nodemon for auto-restart on file changes.

### Project Structure

```
monitor.sui/
├── server.js           # Backend server
├── package.json        # Dependencies
├── .env.example        # Environment template
├── public/             # Frontend files
│   ├── index.html     # Main HTML
│   ├── styles.css     # Styling
│   └── app.js         # Client JavaScript
└── README.md          # This file
```

## Troubleshooting 🔧

### WebSocket Connection Issues

If the WebSocket fails to connect:
1. Check your firewall settings
2. Ensure the port is not blocked
3. Check browser console for errors

### No Transactions Showing

1. Verify the wallet address is correct
2. Check if the wallet has recent activity
3. Ensure Sui RPC endpoint is accessible

### Notifications Not Working

1. Check browser notification permissions
2. Click the bell icon to enable
3. Ensure notifications aren't blocked in browser settings

## License 📄

MIT

## Support 💬

For issues and questions, please open an issue on GitHub.

---

Built with ❤️ for the Sui ecosystem

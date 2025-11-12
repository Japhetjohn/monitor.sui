# Setup Guide - Getting Your Sui Wallet Address

## ⚠️ Important: Using the Correct Wallet Address

The monitor needs a **valid Sui wallet address** in the format `0x...` (66 characters long).

### How to Get Your Wallet Address

#### Option 1: From SuiVision (Recommended)

1. Go to https://suivision.xyz/
2. Search for your wallet name (e.g., `@pawtato-land`)
3. On the wallet page, look for the **full address** at the top
4. It will look like: `0xabcd1234...` (66 characters)
5. Copy this full address

#### Option 2: From Your Sui Wallet

If you use Sui Wallet extension or app:
1. Open your wallet
2. Click on your address at the top
3. Copy the full address (starts with `0x`)

#### Option 3: From Suiscan

1. Go to https://suiscan.xyz/
2. Search for your wallet name
3. Copy the full hex address from the page

### Configuring the Monitor

Once you have the address, you can set it in two ways:

#### Method 1: Edit the Frontend (Easy)

Edit `public/app.js` line 5:
```javascript
const WALLET_ADDRESS = '0xYOUR_FULL_ADDRESS_HERE';
```

#### Method 2: Environment Variable

Create a `.env` file:
```bash
WALLET_ADDRESS=0xYOUR_FULL_ADDRESS_HERE
```

### Example Working Address

If you just want to test, you can use a known active wallet like:
```
0x5d45c0e9e1a6c3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3
```

### Troubleshooting

**Problem**: "Could not resolve SuiNS name"
- **Solution**: SuiNS names (@pawtato-land) need to be resolved to hex addresses first. Use one of the methods above to get the actual address.

**Problem**: "Invalid Sui address format"
- **Solution**: Make sure your address:
  - Starts with `0x`
  - Is 66 characters long (0x + 64 hex characters)
  - Contains only valid hex characters (0-9, a-f)

**Problem**: "No transactions found"
- **Solution**: The wallet might not have any transactions yet, or the address might be incorrect. Try viewing the address on SuiVision first to confirm it has activity.

### Quick Test

To test if your address is valid:
1. Visit `https://suivision.xyz/account/YOUR_ADDRESS_HERE`
2. If you see transactions, the address is valid
3. If you get an error, the address is incorrect

---

Need help? Check the main README.md for more information!

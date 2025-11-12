const express = require('express');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Sui RPC endpoint (mainnet)
const SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443';

// Store for tracking transactions and connected clients
let lastCheckedTx = null;
let transactionHistory = [];
const MAX_HISTORY = 50;

// Resolve SuiNS name to address
async function resolveSuiNSName(name) {
  try {
    const nameWithoutAt = name.replace('@', '');
    console.log('🔍 Attempting to resolve SuiNS name:', nameWithoutAt);

    // Method 1: Try suix_resolveNameServiceAddress
    const response = await fetch(SUI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_resolveNameServiceAddress',
        params: [nameWithoutAt]
      })
    });

    const data = await response.json();

    if (data.result) {
      console.log('✅ Resolved address:', data.result);
      return data.result;
    }

    // Method 2: Try with .sui suffix
    const withSuffix = nameWithoutAt.endsWith('.sui') ? nameWithoutAt : `${nameWithoutAt}.sui`;
    console.log('🔍 Trying with .sui suffix:', withSuffix);

    const response2 = await fetch(SUI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_resolveNameServiceAddress',
        params: [withSuffix]
      })
    });

    const data2 = await response2.json();

    if (data2.result) {
      console.log('✅ Resolved address with .sui:', data2.result);
      return data2.result;
    }

    console.log('⚠️ Could not resolve SuiNS name, will try as direct address');
    return null;
  } catch (error) {
    console.error('❌ Error resolving SuiNS name:', error);
    return null;
  }
}

// Get transactions for an address
async function getTransactions(address, cursor = null, limit = 10) {
  try {
    console.log(`📡 Fetching transactions for address: ${address.substring(0, 10)}...`);

    const response = await fetch(SUI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryTransactionBlocks',
        params: [
          {
            filter: {
              FromOrToAddress: address
            },
            options: {
              showInput: true,
              showEffects: true,
              showEvents: true,
              showObjectChanges: true,
              showBalanceChanges: true
            }
          },
          cursor,
          limit,
          true // descending order
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('❌ RPC Error:', data.error);
      return null;
    }

    if (data.result && data.result.data) {
      console.log(`✅ Found ${data.result.data.length} transactions`);
    } else {
      console.log('⚠️ No transactions found or unexpected response format');
    }

    return data.result;
  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
    return null;
  }
}

// Get transaction details
async function getTransactionDetails(digest) {
  try {
    const response = await fetch(SUI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getTransactionBlock',
        params: [
          digest,
          {
            showInput: true,
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
            showBalanceChanges: true
          }
        ]
      })
    });

    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    return null;
  }
}

// Parse and format transaction data
function formatTransaction(tx) {
  const balanceChanges = tx.balanceChanges || [];
  const effects = tx.effects || {};
  const timestamp = tx.timestampMs ? new Date(parseInt(tx.timestampMs)) : new Date();

  let type = 'Transaction';
  let amount = 0;
  let coinType = 'SUI';

  // Determine transaction type and amount
  if (balanceChanges.length > 0) {
    const change = balanceChanges[0];
    amount = Math.abs(parseInt(change.amount || 0)) / 1000000000; // Convert MIST to SUI
    coinType = change.coinType?.split('::').pop() || 'SUI';
    type = parseInt(change.amount || 0) > 0 ? 'Received' : 'Sent';
  }

  return {
    digest: tx.digest,
    type,
    amount,
    coinType,
    timestamp: timestamp.toISOString(),
    status: effects.status?.status || 'unknown',
    gasUsed: effects.gasUsed || {},
    balanceChanges,
    events: tx.events || [],
    objectChanges: tx.objectChanges || []
  };
}

// Monitor wallet for new transactions
async function monitorWallet(address, wss) {
  try {
    const result = await getTransactions(address, null, 5);

    if (!result || !result.data) {
      console.log('No transactions found or error occurred');
      return;
    }

    const transactions = result.data;

    if (transactions.length === 0) {
      return;
    }

    const latestTx = transactions[0];

    // Check if this is a new transaction
    if (lastCheckedTx !== latestTx.digest) {
      console.log('New transaction detected:', latestTx.digest);

      const formatted = formatTransaction(latestTx);

      // Add to history
      transactionHistory.unshift(formatted);
      if (transactionHistory.length > MAX_HISTORY) {
        transactionHistory.pop();
      }

      // Broadcast to all connected clients
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'new_transaction',
            data: formatted
          }));
        }
      });

      lastCheckedTx = latestTx.digest;
    }
  } catch (error) {
    console.error('Error monitoring wallet:', error);
  }
}

// API Routes
app.get('/api/resolve/:name', async (req, res) => {
  const address = await resolveSuiNSName(req.params.name);
  res.json({ address });
});

app.get('/api/transactions/:address', async (req, res) => {
  const { address } = req.params;
  const { cursor, limit = 20 } = req.query;

  const result = await getTransactions(address, cursor, parseInt(limit));

  if (result && result.data) {
    const formatted = result.data.map(formatTransaction);
    res.json({
      transactions: formatted,
      hasNextPage: result.hasNextPage,
      nextCursor: result.nextCursor
    });
  } else {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.get('/api/history', (req, res) => {
  res.json({ transactions: transactionHistory });
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Sui Wallet Monitor running on port ${PORT}`);
});

// WebSocket server
const wss = new WebSocket.Server({ server });

let monitoringAddress = null;
let monitoringInterval = null;

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send existing history
  ws.send(JSON.stringify({
    type: 'history',
    data: transactionHistory
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start_monitoring') {
        let address = data.address;
        console.log('📨 Received monitoring request for:', address);

        // If it starts with @, resolve it
        if (address.startsWith('@')) {
          console.log('🔄 Attempting to resolve SuiNS name...');
          const resolved = await resolveSuiNSName(address);
          if (resolved) {
            address = resolved;
            console.log('✅ Resolved to:', address);
          } else {
            console.log('❌ Could not resolve SuiNS name');
            ws.send(JSON.stringify({
              type: 'error',
              message: `Could not resolve SuiNS name: ${address}. Please provide a valid Sui address (0x...).`
            }));
            return;
          }
        }

        // Validate address format
        if (!address.startsWith('0x') || address.length < 60) {
          console.log('❌ Invalid address format:', address);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid Sui address format. Address should start with 0x and be 66 characters long.'
          }));
          return;
        }

        monitoringAddress = address;
        console.log('🎯 Starting monitoring for:', address);

        // Initial fetch
        const result = await getTransactions(address, null, 20);
        if (result && result.data) {
          transactionHistory = result.data.map(formatTransaction).slice(0, MAX_HISTORY);
          if (result.data.length > 0) {
            lastCheckedTx = result.data[0].digest;
          }

          console.log(`📊 Sending ${transactionHistory.length} transactions to client`);

          ws.send(JSON.stringify({
            type: 'initial_load',
            data: transactionHistory,
            address: address
          }));
        } else {
          console.log('⚠️ No transactions found for this address');
          ws.send(JSON.stringify({
            type: 'initial_load',
            data: [],
            address: address
          }));
        }

        // Start polling
        if (monitoringInterval) {
          clearInterval(monitoringInterval);
        }

        monitoringInterval = setInterval(() => {
          monitorWallet(address, wss);
        }, 5000); // Check every 5 seconds
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'An error occurred while processing your request.'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

console.log('✨ Sui Wallet Monitor initialized');

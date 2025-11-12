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

// Get transactions for an address (both sent and received)
async function getTransactions(address, cursor = null, limit = 10) {
  try {
    console.log(`📡 Fetching transactions for address: ${address.substring(0, 10)}...`);

    // Query transactions from this address
    const fromResponse = await fetch(SUI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryTransactionBlocks',
        params: [
          {
            filter: {
              FromAddress: address
            },
            options: {
              showInput: true,
              showEffects: true,
              showEvents: true,
              showObjectChanges: true,
              showBalanceChanges: true
            }
          },
          null,
          limit,
          true // descending order
        ]
      })
    });

    // Query transactions to this address
    const toResponse = await fetch(SUI_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'suix_queryTransactionBlocks',
        params: [
          {
            filter: {
              ToAddress: address
            },
            options: {
              showInput: true,
              showEffects: true,
              showEvents: true,
              showObjectChanges: true,
              showBalanceChanges: true
            }
          },
          null,
          limit,
          true // descending order
        ]
      })
    });

    const fromData = await fromResponse.json();
    const toData = await toResponse.json();

    if (fromData.error && toData.error) {
      console.error('❌ RPC Errors:', { from: fromData.error, to: toData.error });
      return null;
    }

    // Combine and deduplicate transactions
    const fromTxs = fromData.result?.data || [];
    const toTxs = toData.result?.data || [];

    console.log(`✅ Found ${fromTxs.length} sent and ${toTxs.length} received transactions`);

    // Merge and deduplicate by digest
    const txMap = new Map();
    [...fromTxs, ...toTxs].forEach(tx => {
      if (!txMap.has(tx.digest)) {
        txMap.set(tx.digest, tx);
      }
    });

    // Sort by timestamp (most recent first)
    const allTxs = Array.from(txMap.values()).sort((a, b) => {
      const timeA = parseInt(a.timestampMs || 0);
      const timeB = parseInt(b.timestampMs || 0);
      return timeB - timeA;
    });

    const result = {
      data: allTxs.slice(0, limit),
      hasNextPage: allTxs.length > limit,
      nextCursor: allTxs.length > limit ? allTxs[limit].digest : null
    };

    console.log(`📊 Returning ${result.data.length} total unique transactions`);

    return result;
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

// Parse and format transaction data with comprehensive activity detection
function formatTransaction(tx) {
  const balanceChanges = tx.balanceChanges || [];
  const effects = tx.effects || {};
  const events = tx.events || [];
  const objectChanges = tx.objectChanges || [];
  const transaction = tx.transaction || {};
  const timestamp = tx.timestampMs ? new Date(parseInt(tx.timestampMs)) : new Date();

  // Detect activity type from transaction data
  const activity = detectActivityType(tx, balanceChanges, events, objectChanges, transaction);

  // Parse all balance changes
  const parsedBalanceChanges = balanceChanges.map(change => {
    const amount = parseFloat(change.amount || 0);
    const coinParts = (change.coinType || '').split('::');
    const coinSymbol = coinParts[coinParts.length - 1] || 'UNKNOWN';
    const decimals = getCoinDecimals(coinSymbol);

    return {
      coinType: change.coinType,
      coinSymbol,
      amount: amount / Math.pow(10, decimals),
      rawAmount: amount,
      owner: change.owner
    };
  });

  // Parse events for detailed activity info
  const parsedEvents = events.map(event => ({
    type: event.type,
    sender: event.sender,
    data: event.parsedJson || event.bcs
  }));

  // Parse object changes
  const parsedObjectChanges = objectChanges.map(change => ({
    type: change.type,
    objectType: change.objectType,
    objectId: change.objectId,
    version: change.version,
    digest: change.digest,
    owner: change.owner
  }));

  return {
    digest: tx.digest,
    type: activity.type,
    category: activity.category,
    description: activity.description,
    amount: activity.amount,
    coinType: activity.coinType,
    details: activity.details,
    timestamp: timestamp.toISOString(),
    status: effects.status?.status || 'unknown',
    gasUsed: effects.gasUsed || {},
    balanceChanges: parsedBalanceChanges,
    events: parsedEvents,
    objectChanges: parsedObjectChanges,
    rawTransaction: transaction
  };
}

// Detect specific activity type from transaction data
function detectActivityType(tx, balanceChanges, events, objectChanges, transaction) {
  let type = 'Activity';
  let category = 'other';
  let description = 'Wallet activity';
  let amount = 0;
  let coinType = 'SUI';
  let details = [];

  // Check for NFT activities
  const nftActivity = detectNFTActivity(events, objectChanges);
  if (nftActivity.detected) {
    return nftActivity;
  }

  // Check for DEX swap
  const swapActivity = detectSwapActivity(events, balanceChanges);
  if (swapActivity.detected) {
    return swapActivity;
  }

  // Check for staking/unstaking
  const stakingActivity = detectStakingActivity(events, transaction);
  if (stakingActivity.detected) {
    return stakingActivity;
  }

  // Check for simple token transfers
  if (balanceChanges.length > 0) {
    const netChanges = {};

    balanceChanges.forEach(change => {
      const coinParts = (change.coinType || '').split('::');
      const coinSymbol = coinParts[coinParts.length - 1] || 'UNKNOWN';
      const decimals = getCoinDecimals(coinSymbol);
      const amount = parseFloat(change.amount || 0) / Math.pow(10, decimals);

      if (!netChanges[coinSymbol]) {
        netChanges[coinSymbol] = 0;
      }
      netChanges[coinSymbol] += amount;
    });

    // Determine if sent or received
    const mainCoin = Object.keys(netChanges)[0];
    const mainAmount = netChanges[mainCoin];

    if (mainAmount > 0) {
      type = '💰 Money In';
      category = 'transfer_in';
      description = `Got ${Math.abs(mainAmount).toFixed(4)} ${mainCoin}`;
      amount = Math.abs(mainAmount);
      coinType = mainCoin;

      // Simple details
      if (Object.keys(netChanges).length === 1) {
        details.push(`You received ${Math.abs(mainAmount).toFixed(4)} ${mainCoin}`);
      } else {
        details.push(`Multiple tokens received`);
        Object.entries(netChanges).forEach(([coin, amt]) => {
          if (amt > 0) {
            details.push(`+ ${amt.toFixed(4)} ${coin}`);
          }
        });
      }
    } else if (mainAmount < 0) {
      type = '💸 Money Out';
      category = 'transfer_out';
      description = `Sent ${Math.abs(mainAmount).toFixed(4)} ${mainCoin}`;
      amount = Math.abs(mainAmount);
      coinType = mainCoin;

      // Simple details
      if (Object.keys(netChanges).length === 1) {
        details.push(`You sent ${Math.abs(mainAmount).toFixed(4)} ${mainCoin}`);
      } else {
        details.push(`Multiple tokens sent`);
        Object.entries(netChanges).forEach(([coin, amt]) => {
          if (amt < 0) {
            details.push(`- ${Math.abs(amt).toFixed(4)} ${coin}`);
          }
        });
      }
    }
  }

  // Check for contract interactions
  if (transaction.data && transaction.data.transaction) {
    const txData = transaction.data.transaction;
    if (txData.kind === 'ProgrammableTransaction') {
      type = '⚙️ Smart Action';
      category = 'contract';
      const commands = txData.transactions || [];
      description = `Used a DApp or smart contract`;
      details.push(`Performed ${commands.length} action(s) on the blockchain`);
    }
  }

  // Add simple summaries instead of technical details
  if (objectChanges.length > 0) {
    const created = objectChanges.filter(c => c.type === 'created').length;
    const mutated = objectChanges.filter(c => c.type === 'mutated').length;

    if (created > 0) details.push(`Created ${created} new item(s)`);
    if (mutated > 0) details.push(`Updated ${mutated} item(s)`);
  }

  return {
    detected: true,
    type,
    category,
    description,
    amount,
    coinType,
    details
  };
}

// Detect NFT minting, transfer, or sale
function detectNFTActivity(events, objectChanges) {
  const nftKeywords = ['nft', 'mint', 'collection', 'token', 'kiosk', 'display'];

  // Check events for NFT activities
  for (const event of events) {
    const eventType = event.type.toLowerCase();
    if (nftKeywords.some(keyword => eventType.includes(keyword))) {
      const created = objectChanges.filter(c => c.type === 'created').length;

      if (eventType.includes('mint')) {
        return {
          detected: true,
          type: '🎨 NFT Minted',
          category: 'nft_mint',
          description: 'Created a new NFT',
          amount: created,
          coinType: 'NFT',
          details: ['You minted a new digital collectible', created > 0 ? `${created} item(s) created` : 'NFT created']
        };
      }

      if (eventType.includes('transfer')) {
        return {
          detected: true,
          type: '🖼️ NFT Moved',
          category: 'nft_transfer',
          description: 'Transferred an NFT',
          amount: 1,
          coinType: 'NFT',
          details: ['You moved a digital collectible']
        };
      }
    }
  }

  // Check object changes for NFT creation
  const hasDisplay = objectChanges.some(c =>
    c.objectType && c.objectType.toLowerCase().includes('display')
  );

  if (hasDisplay) {
    return {
      detected: true,
      type: '🎨 NFT Activity',
      category: 'nft',
      description: 'Did something with an NFT',
      amount: 0,
      coinType: 'NFT',
      details: ['Interacted with a digital collectible']
    };
  }

  return { detected: false };
}

// Detect DEX swap activities
function detectSwapActivity(events, balanceChanges) {
  const swapKeywords = ['swap', 'trade', 'exchange', 'pool', 'cetus', 'turbos', 'deepbook'];

  for (const event of events) {
    const eventType = event.type.toLowerCase();
    if (swapKeywords.some(keyword => eventType.includes(keyword))) {
      // Parse swap details from balance changes
      if (balanceChanges.length >= 2) {
        const incoming = balanceChanges.find(c => parseFloat(c.amount) > 0);
        const outgoing = balanceChanges.find(c => parseFloat(c.amount) < 0);

        if (incoming && outgoing) {
          const inCoin = incoming.coinType.split('::').pop();
          const outCoin = outgoing.coinType.split('::').pop();
          const inAmount = Math.abs(parseFloat(incoming.amount)) / getCoinDecimalsDivisor(inCoin);
          const outAmount = Math.abs(parseFloat(outgoing.amount)) / getCoinDecimalsDivisor(outCoin);

          return {
            detected: true,
            type: '🔄 Token Swap',
            category: 'dex_swap',
            description: `Traded ${outAmount.toFixed(2)} ${outCoin} for ${inAmount.toFixed(2)} ${inCoin}`,
            amount: outAmount,
            coinType: outCoin,
            details: [
              `You gave: ${outAmount.toFixed(4)} ${outCoin}`,
              `You got: ${inAmount.toFixed(4)} ${inCoin}`,
              'Exchanged on a trading platform'
            ]
          };
        }
      }
    }
  }

  return { detected: false };
}

// Detect staking activities
function detectStakingActivity(events, transaction) {
  const stakingKeywords = ['stake', 'delegate', 'validator', 'unstake', 'withdraw_stake'];

  for (const event of events) {
    const eventType = event.type.toLowerCase();
    if (stakingKeywords.some(keyword => eventType.includes(keyword))) {
      if (eventType.includes('unstake') || eventType.includes('withdraw')) {
        return {
          detected: true,
          type: '🔓 Unstaked',
          category: 'staking',
          description: 'Withdrew staked coins',
          amount: 0,
          coinType: 'SUI',
          details: ['You took your coins out of staking', 'Coins are now available to use']
        };
      } else {
        return {
          detected: true,
          type: '🔒 Staked',
          category: 'staking',
          description: 'Locked coins to earn rewards',
          amount: 0,
          coinType: 'SUI',
          details: ['You staked coins to earn interest', 'Coins are locked with a validator']
        };
      }
    }
  }

  return { detected: false };
}

// Get coin decimals
function getCoinDecimals(coinSymbol) {
  const decimalsMap = {
    'SUI': 9,
    'USDC': 6,
    'USDT': 6,
    'WETH': 8,
    'CETUS': 9
  };
  return decimalsMap[coinSymbol] || 9;
}

// Get coin decimals divisor
function getCoinDecimalsDivisor(coinSymbol) {
  return Math.pow(10, getCoinDecimals(coinSymbol));
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

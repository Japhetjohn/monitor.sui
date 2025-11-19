#!/usr/bin/env python3
"""
Sui Wallet Monitor Telegram Bot
Real-time monitoring of Sui wallet activities with Telegram notifications
"""

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Set
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    CallbackQueryHandler
)

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Configuration
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8587301602:AAGB61luA8mVYy4W18tvSxmDSLitXs-IuDQ')
SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443'
WALLETS_FILE = 'monitored_wallets.json'
CHECK_INTERVAL = 5  # seconds

# Global state
monitored_wallets: Dict[str, Dict] = {}
last_checked_tx: Dict[str, str] = {}
chat_id: Optional[int] = None


def load_wallets():
    """Load monitored wallets from file"""
    global monitored_wallets
    try:
        if os.path.exists(WALLETS_FILE):
            with open(WALLETS_FILE, 'r') as f:
                monitored_wallets = json.load(f)
                logger.info(f"Loaded {len(monitored_wallets)} monitored wallets")
        else:
            monitored_wallets = {}
    except Exception as e:
        logger.error(f"Error loading wallets: {e}")
        monitored_wallets = {}


def save_wallets():
    """Save monitored wallets to file"""
    try:
        with open(WALLETS_FILE, 'w') as f:
            json.dump(monitored_wallets, f, indent=2)
        logger.info(f"Saved {len(monitored_wallets)} monitored wallets")
    except Exception as e:
        logger.error(f"Error saving wallets: {e}")


async def resolve_suins_name(name: str) -> Optional[str]:
    """Resolve SuiNS name to address"""
    try:
        name_without_at = name.replace('@', '')
        logger.info(f"Resolving SuiNS name: {name_without_at}")

        async with aiohttp.ClientSession() as session:
            # Try with and without .sui suffix
            for attempt_name in [name_without_at, f"{name_without_at}.sui"]:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "suix_resolveNameServiceAddress",
                    "params": [attempt_name]
                }

                async with session.post(SUI_RPC_URL, json=payload) as response:
                    data = await response.json()
                    if data.get('result'):
                        logger.info(f"Resolved {name} to {data['result']}")
                        return data['result']

        logger.warning(f"Could not resolve SuiNS name: {name}")
        return None
    except Exception as e:
        logger.error(f"Error resolving SuiNS name: {e}")
        return None


async def get_transactions(address: str, limit: int = 10) -> Optional[List]:
    """Get transactions for an address"""
    try:
        logger.info(f"Fetching transactions for {address[:10]}...")

        async with aiohttp.ClientSession() as session:
            # Query transactions FROM address
            from_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "suix_queryTransactionBlocks",
                "params": [
                    {
                        "filter": {"FromAddress": address},
                        "options": {
                            "showInput": True,
                            "showEffects": True,
                            "showEvents": True,
                            "showObjectChanges": True,
                            "showBalanceChanges": True
                        }
                    },
                    None,
                    limit,
                    True  # descending order
                ]
            }

            # Query transactions TO address
            to_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "suix_queryTransactionBlocks",
                "params": [
                    {
                        "filter": {"ToAddress": address},
                        "options": {
                            "showInput": True,
                            "showEffects": True,
                            "showEvents": True,
                            "showObjectChanges": True,
                            "showBalanceChanges": True
                        }
                    },
                    None,
                    limit,
                    True
                ]
            }

            # Execute both queries
            async with session.post(SUI_RPC_URL, json=from_payload) as from_response:
                from_data = await from_response.json()

            async with session.post(SUI_RPC_URL, json=to_payload) as to_response:
                to_data = await to_response.json()

            # Combine and deduplicate
            from_txs = from_data.get('result', {}).get('data', [])
            to_txs = to_data.get('result', {}).get('data', [])

            logger.info(f"Found {len(from_txs)} sent and {len(to_txs)} received transactions")

            # Merge and deduplicate by digest
            tx_map = {}
            for tx in from_txs + to_txs:
                if tx['digest'] not in tx_map:
                    tx_map[tx['digest']] = tx

            # Sort by timestamp
            all_txs = sorted(
                tx_map.values(),
                key=lambda x: int(x.get('timestampMs', 0)),
                reverse=True
            )

            return all_txs[:limit]

    except Exception as e:
        logger.error(f"Error fetching transactions: {e}")
        return None


def get_coin_decimals(coin_symbol: str) -> int:
    """Get decimals for coin"""
    decimals_map = {
        'SUI': 9,
        'USDC': 6,
        'USDT': 6,
        'WETH': 8,
        'CETUS': 9
    }
    return decimals_map.get(coin_symbol, 9)


def format_transaction(tx: Dict) -> Dict:
    """Format transaction with comprehensive details"""
    balance_changes = tx.get('balanceChanges', [])
    effects = tx.get('effects', {})
    events = tx.get('events', [])
    object_changes = tx.get('objectChanges', [])
    transaction = tx.get('transaction', {})
    timestamp_ms = int(tx.get('timestampMs', 0))
    timestamp = datetime.fromtimestamp(timestamp_ms / 1000)

    # Extract sender
    sender = transaction.get('data', {}).get('sender', 'Unknown')

    # Detect activity type
    activity = detect_activity_type(tx, balance_changes, events, object_changes)

    # Parse balance changes
    parsed_balance_changes = []
    for change in balance_changes:
        amount = float(change.get('amount', 0))
        coin_parts = change.get('coinType', '').split('::')
        coin_symbol = coin_parts[-1] if coin_parts else 'UNKNOWN'
        decimals = get_coin_decimals(coin_symbol)

        parsed_balance_changes.append({
            'coinType': change.get('coinType'),
            'coinSymbol': coin_symbol,
            'amount': amount / (10 ** decimals),
            'rawAmount': amount,
            'owner': change.get('owner', {})
        })

    # Extract gas details
    gas_used = effects.get('gasUsed', {})
    gas_summary = {
        'computationCost': int(gas_used.get('computationCost', 0)) / 1e9,
        'storageCost': int(gas_used.get('storageCost', 0)) / 1e9,
        'storageRebate': int(gas_used.get('storageRebate', 0)) / 1e9,
    }
    gas_summary['totalGas'] = (
        gas_summary['computationCost'] +
        gas_summary['storageCost'] -
        gas_summary['storageRebate']
    )

    return {
        'digest': tx['digest'],
        'type': activity['type'],
        'category': activity['category'],
        'description': activity['description'],
        'amount': activity['amount'],
        'coinType': activity['coinType'],
        'details': activity['details'],
        'sender': sender,
        'timestamp': timestamp.isoformat(),
        'status': effects.get('status', {}).get('status', 'unknown'),
        'balanceChanges': parsed_balance_changes,
        'events': events,
        'objectChanges': object_changes,
        'gasSummary': gas_summary,
        'checkpoint': tx.get('checkpoint', 'Unknown')
    }


def detect_activity_type(tx: Dict, balance_changes: List, events: List, object_changes: List) -> Dict:
    """Detect specific activity type from transaction data"""
    activity = {
        'type': 'Activity',
        'category': 'other',
        'description': 'Wallet activity',
        'amount': 0,
        'coinType': 'SUI',
        'details': []
    }

    # Check for NFT activities
    nft_keywords = ['nft', 'mint', 'collection', 'token', 'kiosk', 'display']
    for event in events:
        event_type = event.get('type', '').lower()
        if any(keyword in event_type for keyword in nft_keywords):
            if 'mint' in event_type:
                return {
                    'type': '🎨 NFT Minted',
                    'category': 'nft_mint',
                    'description': 'Created a new NFT',
                    'amount': 0,
                    'coinType': 'NFT',
                    'details': ['You minted a new digital collectible']
                }
            elif 'transfer' in event_type:
                return {
                    'type': '🖼️ NFT Moved',
                    'category': 'nft_transfer',
                    'description': 'Transferred an NFT',
                    'amount': 0,
                    'coinType': 'NFT',
                    'details': ['You moved a digital collectible']
                }

    # Check for DEX swap
    swap_keywords = ['swap', 'trade', 'exchange', 'pool', 'cetus', 'turbos', 'deepbook']
    for event in events:
        event_type = event.get('type', '').lower()
        if any(keyword in event_type for keyword in swap_keywords):
            if len(balance_changes) >= 2:
                incoming = next((c for c in balance_changes if float(c.get('amount', 0)) > 0), None)
                outgoing = next((c for c in balance_changes if float(c.get('amount', 0)) < 0), None)

                if incoming and outgoing:
                    in_coin = incoming.get('coinType', '').split('::')[-1]
                    out_coin = outgoing.get('coinType', '').split('::')[-1]
                    in_amount = abs(float(incoming.get('amount', 0))) / (10 ** get_coin_decimals(in_coin))
                    out_amount = abs(float(outgoing.get('amount', 0))) / (10 ** get_coin_decimals(out_coin))

                    return {
                        'type': '🔄 Token Swap',
                        'category': 'dex_swap',
                        'description': f"Traded {out_amount:.2f} {out_coin} for {in_amount:.2f} {in_coin}",
                        'amount': out_amount,
                        'coinType': out_coin,
                        'details': [
                            f"You gave: {out_amount:.4f} {out_coin}",
                            f"You got: {in_amount:.4f} {in_coin}"
                        ]
                    }

    # Check for staking
    staking_keywords = ['stake', 'delegate', 'validator', 'unstake', 'withdraw_stake']
    for event in events:
        event_type = event.get('type', '').lower()
        if any(keyword in event_type for keyword in staking_keywords):
            if 'unstake' in event_type or 'withdraw' in event_type:
                return {
                    'type': '🔓 Unstaked',
                    'category': 'staking',
                    'description': 'Withdrew staked coins',
                    'amount': 0,
                    'coinType': 'SUI',
                    'details': ['You took your coins out of staking']
                }
            else:
                return {
                    'type': '🔒 Staked',
                    'category': 'staking',
                    'description': 'Locked coins to earn rewards',
                    'amount': 0,
                    'coinType': 'SUI',
                    'details': ['You staked coins to earn interest']
                }

    # Check for token transfers
    if balance_changes:
        net_changes = {}

        for change in balance_changes:
            coin_parts = change.get('coinType', '').split('::')
            coin_symbol = coin_parts[-1] if coin_parts else 'UNKNOWN'
            decimals = get_coin_decimals(coin_symbol)
            amount = float(change.get('amount', 0)) / (10 ** decimals)

            if coin_symbol not in net_changes:
                net_changes[coin_symbol] = 0
            net_changes[coin_symbol] += amount

        if net_changes:
            main_coin = list(net_changes.keys())[0]
            main_amount = net_changes[main_coin]

            if main_amount > 0:
                return {
                    'type': '💰 Money In',
                    'category': 'transfer_in',
                    'description': f"Got {abs(main_amount):.4f} {main_coin}",
                    'amount': abs(main_amount),
                    'coinType': main_coin,
                    'details': [f"You received {abs(main_amount):.4f} {main_coin}"]
                }
            elif main_amount < 0:
                return {
                    'type': '💸 Money Out',
                    'category': 'transfer_out',
                    'description': f"Sent {abs(main_amount):.4f} {main_coin}",
                    'amount': abs(main_amount),
                    'coinType': main_coin,
                    'details': [f"You sent {abs(main_amount):.4f} {main_coin}"]
                }

    # Default to smart contract interaction
    return {
        'type': '⚙️ Smart Action',
        'category': 'contract',
        'description': 'Used a DApp or smart contract',
        'amount': 0,
        'coinType': 'SUI',
        'details': ['Performed action on the blockchain']
    }


def format_telegram_message(tx: Dict, wallet_name: str) -> str:
    """Format transaction for Telegram message"""
    emoji_map = {
        'transfer_in': '💰',
        'transfer_out': '💸',
        'dex_swap': '🔄',
        'nft_mint': '🎨',
        'nft_transfer': '🖼️',
        'staking': '🔒',
        'contract': '⚙️',
        'other': '📝'
    }

    emoji = emoji_map.get(tx['category'], '📝')

    # Build message
    lines = [
        f"🔔 <b>New Transaction on {wallet_name}</b>",
        "",
        f"{emoji} <b>{tx['type']}</b>",
        f"📝 {tx['description']}",
        ""
    ]

    # Add amount if present
    if tx['amount'] > 0:
        lines.append(f"💵 Amount: <b>{tx['amount']:.4f} {tx['coinType']}</b>")
        lines.append("")

    # Add details
    if tx['details']:
        lines.append("<b>Details:</b>")
        for detail in tx['details'][:3]:  # Limit to 3 details
            lines.append(f"• {detail}")
        lines.append("")

    # Add balance changes
    if tx['balanceChanges']:
        lines.append("<b>💰 Balance Changes:</b>")
        for change in tx['balanceChanges'][:5]:  # Limit to 5 changes
            prefix = "+" if change['amount'] > 0 else ""
            lines.append(f"  {prefix}{change['amount']:.6f} {change['coinSymbol']}")
        lines.append("")

    # Add sender
    if tx['sender']:
        sender_short = f"{tx['sender'][:8]}...{tx['sender'][-6:]}"
        lines.append(f"👤 From: <code>{sender_short}</code>")

    # Add gas cost
    if tx['gasSummary']:
        gas = tx['gasSummary']['totalGas']
        lines.append(f"⛽ Gas: {gas:.6f} SUI")

    # Add status
    status_emoji = "✅" if tx['status'] == 'success' else "❌"
    lines.append(f"{status_emoji} Status: {tx['status'].title()}")

    # Add timestamp
    try:
        dt = datetime.fromisoformat(tx['timestamp'])
        time_str = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
        lines.append(f"🕐 {time_str}")
    except:
        pass

    # Add explorer link
    lines.append("")
    lines.append(f"🔗 <a href='https://suivision.xyz/txblock/{tx['digest']}'>View on Explorer</a>")

    return "\n".join(lines)


async def monitor_wallet_loop(application):
    """Background task to monitor wallets"""
    global last_checked_tx, chat_id

    while True:
        try:
            if not monitored_wallets or not chat_id:
                await asyncio.sleep(CHECK_INTERVAL)
                continue

            for address, wallet_info in monitored_wallets.items():
                try:
                    # Get latest transactions
                    transactions = await get_transactions(address, limit=5)

                    if not transactions:
                        continue

                    latest_tx = transactions[0]
                    latest_digest = latest_tx['digest']

                    # Check if this is a new transaction
                    if address not in last_checked_tx:
                        last_checked_tx[address] = latest_digest
                        logger.info(f"Initialized monitoring for {wallet_info['name']}")
                        continue

                    if last_checked_tx[address] != latest_digest:
                        logger.info(f"New transaction detected for {wallet_info['name']}: {latest_digest}")

                        # Format and send notification
                        formatted_tx = format_transaction(latest_tx)
                        message = format_telegram_message(formatted_tx, wallet_info['name'])

                        await application.bot.send_message(
                            chat_id=chat_id,
                            text=message,
                            parse_mode='HTML',
                            disable_web_page_preview=True
                        )

                        last_checked_tx[address] = latest_digest

                except Exception as e:
                    logger.error(f"Error monitoring wallet {wallet_info.get('name', address)}: {e}")

            await asyncio.sleep(CHECK_INTERVAL)

        except Exception as e:
            logger.error(f"Error in monitor loop: {e}")
            await asyncio.sleep(CHECK_INTERVAL)


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command"""
    global chat_id
    chat_id = update.effective_chat.id

    welcome_message = """
🚀 <b>Sui Wallet Monitor Bot</b>

Monitors your Sui wallets and sends instant notifications for all transactions.

<b>Commands:</b>
/add &lt;address&gt; - Add wallet to monitor
/list - Show monitored wallets

<b>Usage:</b>
/add 0x21ba03ab19b4fd9688b8c5973dcb1225914061282eeb66c2d7dd1d287929ddde

You'll get instant notifications for every transaction!
"""

    await update.message.reply_text(welcome_message, parse_mode='HTML')


async def add_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /add command"""
    global chat_id
    chat_id = update.effective_chat.id

    if not context.args:
        await update.message.reply_text(
            "❌ Please provide a wallet address.\n\n"
            "Usage: /add <address>\n"
            "Example: /add 0x21ba03ab19b4fd9688b8c5973dcb1225914061282eeb66c2d7dd1d287929ddde"
        )
        return

    address_or_name = context.args[0]
    # Use shortened address as name
    wallet_name = f"Wallet {address_or_name[:6]}...{address_or_name[-4:]}" if address_or_name.startswith('0x') else address_or_name

    # Resolve SuiNS name if needed
    address = address_or_name
    if address.startswith('@'):
        await update.message.reply_text(f"🔍 Resolving SuiNS name {address_or_name}...")
        resolved = await resolve_suins_name(address_or_name)
        if not resolved:
            await update.message.reply_text(
                f"❌ Could not resolve SuiNS name: {address_or_name}\n"
                "Please provide a valid Sui address (0x...)"
            )
            return
        address = resolved

    # Validate address format
    if not address.startswith('0x') or len(address) < 60:
        await update.message.reply_text(
            "❌ Invalid Sui address format.\n"
            "Address should start with 0x and be 66 characters long."
        )
        return

    # Check if already monitoring
    if address in monitored_wallets:
        await update.message.reply_text(
            f"ℹ️ Already monitoring this wallet: {monitored_wallets[address]['name']}"
        )
        return

    # Add to monitored wallets
    monitored_wallets[address] = {
        'name': wallet_name,
        'address': address,
        'added_at': datetime.now().isoformat()
    }
    save_wallets()

    # Initialize transaction tracking
    try:
        transactions = await get_transactions(address, limit=1)
        if transactions:
            last_checked_tx[address] = transactions[0]['digest']
    except:
        pass

    address_short = f"{address[:8]}...{address[-6:]}"
    await update.message.reply_text(
        f"✅ <b>Wallet added successfully!</b>\n\n"
        f"📝 Name: {wallet_name}\n"
        f"📍 Address: <code>{address_short}</code>\n\n"
        f"You'll receive notifications for any activity on this wallet.",
        parse_mode='HTML'
    )


async def remove_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /remove command"""
    if not monitored_wallets:
        await update.message.reply_text("ℹ️ No wallets are being monitored.")
        return

    # Create inline keyboard with wallet options
    keyboard = []
    for address, info in monitored_wallets.items():
        address_short = f"{address[:8]}...{address[-6:]}"
        keyboard.append([
            InlineKeyboardButton(
                f"❌ {info['name']} ({address_short})",
                callback_data=f"remove_{address}"
            )
        ])

    keyboard.append([InlineKeyboardButton("Cancel", callback_data="remove_cancel")])

    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "Select a wallet to remove:",
        reply_markup=reply_markup
    )


async def list_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /list command"""
    global chat_id
    chat_id = update.effective_chat.id
    logger.info(f"Chat ID set to: {chat_id}")

    if not monitored_wallets:
        await update.message.reply_text("ℹ️ No wallets are being monitored.\n\nUse /add to add a wallet.")
        return

    lines = ["📋 <b>Monitored Wallets:</b>\n"]

    for i, (address, info) in enumerate(monitored_wallets.items(), 1):
        address_short = f"{address[:8]}...{address[-6:]}"
        added_date = datetime.fromisoformat(info['added_at']).strftime('%Y-%m-%d')

        lines.append(f"{i}. <b>{info['name']}</b>")
        lines.append(f"   📍 <code>{address_short}</code>")
        lines.append(f"   📅 Added: {added_date}")
        lines.append("")

    lines.append(f"Total: {len(monitored_wallets)} wallet(s)")

    await update.message.reply_text("\n".join(lines), parse_mode='HTML')


async def test_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /test command - send a test notification"""
    global chat_id
    chat_id = update.effective_chat.id
    logger.info(f"Sending test notification to chat_id: {chat_id}")

    # Create a realistic test notification
    message = (
        "🔔 <b>TEST NOTIFICATION - Dev Wallet</b>\n\n"
        "💰 <b>Money In</b>\n"
        "📝 Received 5.2500 SUI\n\n"
        "💰 <b>Balance Changes:</b>\n"
        "  +5.250000 SUI\n\n"
        "👤 <b>From:</b> 0xabcd1234...5678efgh\n"
        "⛽ <b>Gas:</b> 0.000892 SUI\n"
        "✅ <b>Status:</b> Success\n"
        "🕐 2025-11-19 21:37:00 UTC\n\n"
        "🔗 <a href=\"https://suiscan.xyz/mainnet/tx/test123456\">View on Explorer</a>\n\n"
        "✨ <b>This is a test notification!</b>\n"
        "Your wallet monitoring is working perfectly. You'll receive notifications like this for all real transactions."
    )

    await update.message.reply_text(message, parse_mode='HTML', disable_web_page_preview=True)


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /status command"""
    status_lines = [
        "🤖 <b>Bot Status</b>\n",
        f"✅ Bot is running",
        f"📊 Monitoring {len(monitored_wallets)} wallet(s)",
        f"🔄 Check interval: {CHECK_INTERVAL} seconds",
        f"💬 Chat ID: <code>{chat_id}</code>",
        ""
    ]

    if monitored_wallets:
        status_lines.append("<b>Monitored Wallets:</b>")
        for address, info in monitored_wallets.items():
            has_history = address in last_checked_tx
            status_emoji = "🟢" if has_history else "🟡"
            status_lines.append(f"{status_emoji} {info['name']}")

    await update.message.reply_text("\n".join(status_lines), parse_mode='HTML')


async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle button callbacks"""
    query = update.callback_query
    await query.answer()

    if query.data == "remove_cancel":
        await query.edit_message_text("❌ Cancelled")
        return

    if query.data.startswith("remove_"):
        address = query.data.replace("remove_", "")

        if address in monitored_wallets:
            wallet_name = monitored_wallets[address]['name']
            del monitored_wallets[address]
            if address in last_checked_tx:
                del last_checked_tx[address]
            save_wallets()

            await query.edit_message_text(
                f"✅ Removed wallet: {wallet_name}\n"
                f"No longer monitoring this address."
            )
        else:
            await query.edit_message_text("❌ Wallet not found.")


async def post_init(application: Application):
    """Post-initialization tasks"""
    # Start monitoring loop as a background task after app starts
    asyncio.create_task(monitor_wallet_loop(application))
    logger.info("Started wallet monitoring loop")


def main():
    """Start the bot"""
    logger.info("Starting Sui Wallet Monitor Bot...")

    # Load existing wallets
    load_wallets()

    # Create application with custom timeouts
    from telegram.request import HTTPXRequest
    request = HTTPXRequest(
        connection_pool_size=8,
        connect_timeout=30.0,
        read_timeout=30.0,
        write_timeout=30.0,
        pool_timeout=30.0
    )

    application = (
        Application.builder()
        .token(TELEGRAM_BOT_TOKEN)
        .request(request)
        .post_init(post_init)
        .build()
    )

    # Add command handlers
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("add", add_command))
    application.add_handler(CommandHandler("list", list_command))
    application.add_handler(CommandHandler("test", test_command))

    # Start polling
    logger.info("Bot started successfully!")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()

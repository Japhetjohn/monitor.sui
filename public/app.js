// Global state
let ws = null;
let notificationsEnabled = false;
let transactions = [];
const WALLET_ADDRESS = '@pawtato-land';

// DOM elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const walletAddress = document.getElementById('walletAddress');
const totalTx = document.getElementById('totalTx');
const lastActivity = document.getElementById('lastActivity');
const transactionList = document.getElementById('transactionList');
const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const notificationBtn = document.getElementById('notificationBtn');
const toast = document.getElementById('toast');

// Initialize app
function init() {
    console.log('🚀 Initializing Sui Wallet Monitor...');

    // Set wallet address
    walletAddress.textContent = WALLET_ADDRESS;

    // Setup notification button
    notificationBtn.addEventListener('click', toggleNotifications);

    // Check notification permission
    if ('Notification' in window && Notification.permission === 'granted') {
        notificationsEnabled = true;
        notificationBtn.classList.add('enabled');
    }

    // Connect to WebSocket
    connectWebSocket();
}

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    console.log('Connecting to WebSocket:', wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('✅ WebSocket connected');
        updateStatus('connected', 'Connected');

        // Start monitoring
        ws.send(JSON.stringify({
            type: 'start_monitoring',
            address: WALLET_ADDRESS
        }));

        showLoading();
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        updateStatus('error', 'Connection Error');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting...');
        updateStatus('connecting', 'Reconnecting...');

        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(message) {
    console.log('📩 Received message:', message.type);

    switch (message.type) {
        case 'initial_load':
            hideLoading();
            transactions = message.data;
            renderTransactions();
            updateStats();

            if (message.address) {
                walletAddress.textContent = shortenAddress(message.address);
                walletAddress.title = message.address;
            }

            if (!message.data || message.data.length === 0) {
                console.log('ℹ️ No transactions found for this wallet yet');
            }
            break;

        case 'history':
            if (message.data && message.data.length > 0) {
                transactions = message.data;
                renderTransactions();
                updateStats();
            }
            break;

        case 'new_transaction':
            hideLoading();
            handleNewTransaction(message.data);
            break;

        case 'error':
            hideLoading();
            console.error('❌ Server error:', message.message);
            showToast('Error: ' + message.message);
            updateStatus('error', 'Error');

            // Show error in empty state
            const emptyStateElement = document.getElementById('emptyState');
            emptyStateElement.classList.remove('hidden');
            emptyStateElement.innerHTML = `
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p style="color: #ef4444;">${message.message}</p>
                <p style="font-size: 14px; margin-top: 10px;">Please provide a valid Sui wallet address (0x...)</p>
            `;
            break;

        default:
            console.log('Unknown message type:', message.type);
    }
}

// Handle new transaction
function handleNewTransaction(tx) {
    console.log('🆕 New transaction:', tx.digest);

    // Add to transactions array
    transactions.unshift(tx);
    if (transactions.length > 50) {
        transactions.pop();
    }

    // Add to DOM with animation
    const txElement = createTransactionElement(tx, true);

    if (transactionList.children.length === 0) {
        transactionList.appendChild(txElement);
    } else {
        transactionList.insertBefore(txElement, transactionList.firstChild);
    }

    // Remove 'new' class after animation
    setTimeout(() => {
        txElement.classList.remove('new');
    }, 3000);

    // Update stats
    updateStats();

    // Show notification
    showNotification(tx);

    // Show toast
    showToast(`New ${tx.type.toLowerCase()}: ${tx.amount} ${tx.coinType}`);
}

// Create transaction element
function createTransactionElement(tx, isNew = false) {
    const div = document.createElement('div');
    div.className = `transaction-card${isNew ? ' new' : ''}`;
    div.id = `tx-${tx.digest}`;

    const typeClass = tx.type.toLowerCase();
    const isPositive = tx.type === 'Received';
    const amountPrefix = isPositive ? '+' : '-';
    const amountClass = isPositive ? 'positive' : 'negative';

    const timeAgo = getTimeAgo(new Date(tx.timestamp));

    div.innerHTML = `
        <div class="transaction-header">
            <div class="transaction-type">
                <span class="type-badge ${typeClass}">${tx.type}</span>
            </div>
            <div class="transaction-amount ${amountClass}">
                ${amountPrefix}${tx.amount.toFixed(4)} ${tx.coinType}
            </div>
        </div>

        <div class="transaction-details">
            <div class="detail-item">
                <span class="detail-label">Time</span>
                <span class="detail-value">${timeAgo}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Status</span>
                <span class="detail-value">${tx.status}</span>
            </div>
            ${tx.gasUsed.computationCost ? `
            <div class="detail-item">
                <span class="detail-label">Gas Used</span>
                <span class="detail-value">${(parseInt(tx.gasUsed.computationCost) / 1000000000).toFixed(6)} SUI</span>
            </div>
            ` : ''}
        </div>

        <div class="transaction-hash">
            <a href="https://suivision.xyz/txblock/${tx.digest}" target="_blank" class="hash-link" title="${tx.digest}">
                View on SuiVision: ${shortenHash(tx.digest)}
            </a>
        </div>
    `;

    return div;
}

// Render all transactions
function renderTransactions() {
    transactionList.innerHTML = '';

    if (transactions.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    transactions.forEach(tx => {
        const txElement = createTransactionElement(tx);
        transactionList.appendChild(txElement);
    });
}

// Update statistics
function updateStats() {
    totalTx.textContent = transactions.length;

    if (transactions.length > 0) {
        const latestTime = new Date(transactions[0].timestamp);
        lastActivity.textContent = getTimeAgo(latestTime);
    }
}

// Toggle notifications
async function toggleNotifications() {
    if (!('Notification' in window)) {
        alert('This browser does not support notifications');
        return;
    }

    if (Notification.permission === 'denied') {
        alert('Notifications are blocked. Please enable them in your browser settings.');
        return;
    }

    if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            notificationsEnabled = true;
            notificationBtn.classList.add('enabled');
            showToast('Notifications enabled!');
        }
    } else if (Notification.permission === 'granted') {
        notificationsEnabled = !notificationsEnabled;
        notificationBtn.classList.toggle('enabled');
        showToast(notificationsEnabled ? 'Notifications enabled!' : 'Notifications disabled');
    }
}

// Show browser notification
function showNotification(tx) {
    if (!notificationsEnabled || Notification.permission !== 'granted') {
        return;
    }

    const title = `${tx.type}: ${tx.amount} ${tx.coinType}`;
    const options = {
        body: `Transaction on ${WALLET_ADDRESS}`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%236366f1"/></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%236366f1"/></svg>',
        tag: tx.digest,
        requireInteraction: false,
        silent: false
    };

    try {
        const notification = new Notification(title, options);

        notification.onclick = () => {
            window.focus();
            notification.close();

            // Scroll to transaction
            const txElement = document.getElementById(`tx-${tx.digest}`);
            if (txElement) {
                txElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        };

        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
    } catch (error) {
        console.error('Error showing notification:', error);
    }
}

// Show toast message
function showToast(message) {
    const toastMessage = toast.querySelector('.toast-message');
    toastMessage.textContent = message;

    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// Update connection status
function updateStatus(status, text) {
    statusText.textContent = text;
    statusBadge.className = 'status-badge ' + status;
}

// Show/hide loading state
function showLoading() {
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
}

function hideLoading() {
    loadingState.classList.add('hidden');
}

// Utility functions
function shortenAddress(address) {
    if (address.startsWith('@')) return address;
    if (address.length <= 16) return address;
    return `${address.substring(0, 8)}...${address.substring(address.length - 6)}`;
}

function shortenHash(hash) {
    if (hash.length <= 16) return hash;
    return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString();
}

// Update time ago every minute
setInterval(() => {
    if (transactions.length > 0) {
        updateStats();
    }
}, 60000);

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

console.log('✨ Sui Wallet Monitor loaded');

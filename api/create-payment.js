const admin = require('firebase-admin');

// Initialize Firebase Admin (Singleton to prevent multiple init errors in serverless)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
        databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
    });
}
const db = admin.database();

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { uid, amount } = req.body;

    // 1. Validate amount > 0 and uid exists
    if (!uid || !amount || Number(amount) <= 0) {
        return res.status(400).json({ message: 'Valid UID and Amount (>0) are required' });
    }

    try {
        // 2. Generate unique transactionId
        const transactionId = `TXN_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        // 3. Save transaction with status "pending"
        await db.ref(`transactions/${transactionId}`).set({
            uid: uid,
            amount: Number(amount),
            type: 'deposit',
            status: 'pending',
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        // Generate webhook URL
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const webhookUrl = `${protocol}://${req.headers.host}/api/zap-webhook`;

        // 4. Call Zap UPI create API
        const payload = new URLSearchParams();
        payload.append('token_key', process.env.ZAP_API_TOKEN);
        payload.append('secret_key', process.env.ZAP_SECRET_KEY);
        payload.append('amount', amount);
        payload.append('order_id', transactionId);
        payload.append('customer_mobile', '9999999999'); // Fallback/default mobile
        payload.append('redirect_url', webhookUrl);      // As requested
        payload.append('remark', 'Wallet Deposit');

        const response = await fetch("https://zapupi.com/api/create-order", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${process.env.ZAP_API_TOKEN}`
            },
            body: payload
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            // 6. Return paymentUrl to frontend 
            // (Uses typical payment_url param, returning whole data object as fallback)
            return res.status(200).json({ 
                paymentUrl: data.payment_url || data.url,
                transactionId: transactionId,
                originalData: data
            });
        } else {
            console.error('Zap UPI Error:', data);
            return res.status(500).json({ message: 'Failed to create payment via Gateway', error: data });
        }
    } catch (error) {
        console.error('Create Payment Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
          }

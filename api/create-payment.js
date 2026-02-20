const admin = require('firebase-admin');

// Firebase Initialization
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Handle \n in private key carefully
                privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
            }),
            databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
        });
    }
} catch (error) {
    console.error("Firebase Init Error:", error);
}
const db = admin.database();

// ZAP UPI KEYS (Directly Added)
const ZAP_TOKEN = 'add869238024e2008b309519c0d8d263';
const ZAP_SECRET = 'd9f7546f11140e3b652e459e2ee1a366';

export default async function handler(req, res) {
    // CORS Headers (Browser error rokne ke liye)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST allowed' });

    const { uid, amount } = req.body;

    if (!uid || !amount || Number(amount) <= 0) {
        return res.status(400).json({ message: 'Valid UID and Amount required' });
    }

    try {
        const orderId = `TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Save pending transaction to Firebase
        await db.ref(`transactions/${orderId}`).set({
            uid: uid,
            amount: Number(amount),
            type: 'deposit',
            status: 'pending',
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        const webhookUrl = 'https://nackend.vercel.app/api/zap-webhook';

        // Zap Create Order API Call
        const payload = new URLSearchParams();
        payload.append('token_key', ZAP_TOKEN);
        payload.append('secret_key', ZAP_SECRET);
        payload.append('amount', amount);
        payload.append('order_id', orderId);
        payload.append('customer_mobile', '9999999999'); 
        payload.append('redirect_url', webhookUrl); 
        payload.append('remark', 'Wallet Deposit');

        const response = await fetch("https://zapupi.com/api/create-order", {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            return res.status(200).json({ 
                paymentUrl: data.payment_url || data.url, 
                orderId: orderId 
            });
        } else {
            console.error('Zap API Error:', data);
            return res.status(500).json({ message: 'Payment gateway error', error: data });
        }
    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.toString() });
    }
    }    }

    try {
        // Generate Unique Order ID
        const orderId = `TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Save pending transaction to Firebase
        await db.ref(`transactions/${orderId}`).set({
            uid: uid,
            amount: Number(amount),
            type: 'deposit',
            status: 'pending',
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        // Aapka Vercel Webhook URL
        const webhookUrl = 'https://nackend.vercel.app/api/zap-webhook';

        // Zap Create Order API Call
        const payload = new URLSearchParams();
        payload.append('token_key', process.env.ZAP_API_TOKEN);
        payload.append('secret_key', process.env.ZAP_SECRET_KEY);
        payload.append('amount', amount);
        payload.append('order_id', orderId);
        payload.append('customer_mobile', '9999999999'); 
        payload.append('redirect_url', webhookUrl); 
        payload.append('remark', 'Wallet Deposit');

        const response = await fetch("https://zapupi.com/api/create-order", {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload
        });

        const data = await response.json();

        // Check response from Zap
        if (response.ok && data.status === 'success') {
            // Frontend ko payment URL return karein
            return res.status(200).json({ 
                paymentUrl: data.payment_url || data.url, 
                orderId: orderId 
            });
        } else {
            console.error('Zap API Error:', data);
            return res.status(500).json({ message: 'Payment gateway error', error: data });
        }
    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
        }

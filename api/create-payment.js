const admin = require('firebase-admin');

// Firebase Initialization
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
    // CORS Headers allow karna zaruri hai frontend request ke liye
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all domains
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Browser pehle OPTIONS request bhejta hai check karne ke liye (Preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST allowed' });

    const { uid, amount } = req.body;

    if (!uid || !amount || Number(amount) <= 0) {
        return res.status(400).json({ message: 'Valid UID and Amount required' });
    }

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

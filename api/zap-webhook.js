const admin = require('firebase-admin');

// Firebase Initialization
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
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
    if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST allowed' });

    try {
        const orderId = req.body.order_id;
        
        if (!orderId) {
            return res.status(400).json({ message: 'Order ID is missing' });
        }

        // Cross-verify with Zap
        const payload = new URLSearchParams();
        payload.append('token_key', ZAP_TOKEN);
        payload.append('secret_key', ZAP_SECRET);
        payload.append('order_id', orderId);

        const verifyRes = await fetch("https://zapupi.com/api/order-status", {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload
        });
        
        const verifyData = await verifyRes.json();

        if (verifyRes.ok && verifyData.status === 'success' && verifyData.data.status === 'Success') {
            const txnRef = db.ref(`transactions/${orderId}`);
            
            const { committed, snapshot } = await txnRef.transaction((currentData) => {
                if (currentData === null) return currentData; 
                if (currentData.status === 'success') return undefined; 
                currentData.status = 'success';
                return currentData;
            });

            if (committed && snapshot && snapshot.exists()) {
                const uid = snapshot.val().uid;
                const amount = snapshot.val().amount;

                await db.ref(`users/${uid}/wallet`).update({
                    totalCash: admin.database.ServerValue.increment(amount),
                    updatedAt: Date.now()
                });
            }
            return res.status(200).json({ message: 'Webhook Processed Successfully' });

        } else {
            await db.ref(`transactions/${orderId}`).update({ status: 'failed' });
            return res.status(400).json({ message: 'Payment verification failed' });
        }
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
    

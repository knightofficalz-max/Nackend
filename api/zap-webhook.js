const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize Firebase Admin
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
    // 1. Accept POST only
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // 2. Extract values from body (prioritizing explicit requirements, with fallbacks for Zap API native fields)
        const transaction_id = req.body.transaction_id || req.body.order_id; 
        const amount = req.body.amount;
        const status = req.body.status;
        const user_id = req.body.user_id; // Sent by custom metadata if applicable
        const signature = req.body.signature;

        if (!transaction_id || !amount || !status || !signature) {
            return res.status(400).json({ message: 'Missing required webhook fields' });
        }

        // 3. Generate HMAC SHA256 using transaction_id + amount
        const dataToHash = `${transaction_id}${amount}`;
        const generatedSignature = crypto
            .createHmac('sha256', process.env.ZAP_SECRET_KEY)
            .update(dataToHash)
            .digest('hex');

        // 4. If signature mismatch → reject
        if (generatedSignature !== signature) {
            console.error('Webhook signature mismatch');
            return res.status(401).json({ message: 'Invalid signature' });
        }

        // Prevent Duplicate Updates using Firebase Transaction
        const txnRef = db.ref(`transactions/${transaction_id}`);
        
        const { committed, snapshot } = await txnRef.transaction((currentData) => {
            if (currentData === null) {
                return currentData; // Transaction ID doesn't exist in DB
            }
            // 5. Check if transaction is already successful → stop
            if (currentData.status === 'success') {
                return undefined; // Aborts the transaction
            }
            
            // Apply new status
            if (status.toLowerCase() === 'success') {
                currentData.status = 'success';
            } else {
                currentData.status = 'failed';
            }
            return currentData;
        });

        // 6. If status == "success" and it successfully transitioned
        if (committed && snapshot && snapshot.exists() && status.toLowerCase() === 'success') {
            const uid = snapshot.val().uid;
            const numericAmount = Number(amount);

            // Increment user's wallet safely using ServerValue.increment
            await db.ref(`users/${uid}/wallet`).set(
                admin.database.ServerValue.increment(numericAmount)
            );
        }

        // 7. Return 200 OK
        return res.status(200).json({ message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('Webhook Processing Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

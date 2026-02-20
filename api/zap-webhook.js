const admin = require('firebase-admin');
const fetch = require('node-fetch');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
  });
}

const db = admin.database();
const ZAP_TOKEN = process.env.ZAP_API_TOKEN;
const ZAP_SECRET = process.env.ZAP_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST allowed' });

  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: 'Order ID missing' });

    const payload = new URLSearchParams();
    payload.append('token_key', ZAP_TOKEN);
    payload.append('secret_key', ZAP_SECRET);
    payload.append('order_id', order_id);

    const verifyRes = await fetch("https://zapupi.com/api/order-status", {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });

    const verifyData = await verifyRes.json();
    if (verifyRes.ok && verifyData.status === 'success') {

      const txnRef = db.ref(`transactions/${order_id}`);
      const txnSnapshot = await txnRef.once('value');
      if (!txnSnapshot.exists()) return res.status(404).json({ message: 'Transaction not found' });
      if (txnSnapshot.val().status === 'success') return res.status(200).json({ message: 'Already processed' });

      const uid = txnSnapshot.val().uid;
      const amount = txnSnapshot.val().amount;

      await txnRef.update({ status: 'success' });
      await db.ref(`users/${uid}`).update({
        wallet: admin.database.ServerValue.increment(amount),
        updatedAt: Date.now()
      });

      return res.status(200).json({ message: 'Wallet updated successfully' });
    } else {
      await db.ref(`transactions/${order_id}`).update({ status: 'failed' });
      return res.status(400).json({ message: 'Payment verification failed' });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
      

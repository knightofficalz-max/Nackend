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

  const { uid, amount } = req.body;
  if (!uid || !amount || Number(amount) <= 0) {
    return res.status(400).json({ message: 'Invalid UID or Amount' });
  }

  try {
    const orderId = `TXN_${Date.now()}`;
    await db.ref(`transactions/${orderId}`).set({
      uid,
      amount: Number(amount),
      type: 'deposit',
      status: 'pending',
      createdAt: admin.database.ServerValue.TIMESTAMP
    });

    const payload = new URLSearchParams();
    payload.append('token_key', ZAP_TOKEN);
    payload.append('secret_key', ZAP_SECRET);
    payload.append('amount', amount);
    payload.append('order_id', orderId);
    payload.append('customer_mobile', '9999999999');
    payload.append('redirect_url', 'https://yourdomain.com/payment-success');
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
        orderId
      });
    } else {
      return res.status(500).json({ message: 'Zap API error', error: data });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
}

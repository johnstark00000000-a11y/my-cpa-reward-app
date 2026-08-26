// Firebase Cloud Functions for CPA Rewards
// Deploy with: firebase deploy --only functions

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();

// ✅ SECURITY: Verify user authentication
async function verifyUser(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  return context.auth.uid;
}

// ✅ SECURITY: Verify UPI format
function isValidUPI(upi) {
  const upiRegex = /^[a-zA-Z0-9.\-_]{3,}@[a-zA-Z]{3,}$/;
  return upiRegex.test(upi);
}

// ✅ SECURITY: Sanitize input
function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input.trim().substring(0, 500).replace(/[<>"']/g, '');
}

// ✅ SECURITY: Log admin actions
async function logAdminAction(userId, action, details) {
  await db.collection('admin_logs').doc(`log_${Date.now()}`).set({
    admin: userId,
    action: action,
    details: details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ipAddress: process.env.FUNCTION_REGION // Limited info for privacy
  });
}

// ✅ CLAIM DAILY BONUS
exports.claimDailyBonus = functions.https.onCall(async (data, context) => {
  const uid = await verifyUser(context);
  
  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    
    const userData = userSnap.data();
    const now = Date.now();
    const lastClaim = userData.lastDailyBonus || 0;
    const oneDay = 24 * 60 * 60 * 1000;
    
    // ✅ SECURITY: Check cooldown
    if (now - lastClaim < oneDay) {
      const hoursLeft = Math.ceil((oneDay - (now - lastClaim)) / (1000 * 60 * 60));
      throw new functions.https.HttpsError(
        'failed-precondition',
        `बोनस पहले ही क्लेम हो चुका है! ${hoursLeft} घंटे बाद आएं।`
      );
    }
    
    // ✅ SERVER-SIDE UPDATE
    const bonusAmount = parseInt(process.env.DAILY_BONUS_AMOUNT) || 50;
    await userRef.update({
      coins: admin.firestore.FieldValue.increment(bonusAmount),
      lastDailyBonus: now,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // ✅ Log the action
    await logAdminAction(uid, 'DAILY_BONUS_CLAIMED', { amount: bonusAmount });
    
    return { success: true, message: `✅ +${bonusAmount} Coins मिल गए!` };
    
  } catch (error) {
    console.error('Error in claimDailyBonus:', error);
    throw error;
  }
});

// ✅ CLAIM TASK (with verification)
exports.claimTask = functions.https.onCall(async (data, context) => {
  const uid = await verifyUser(context);
  
  const { taskId, reward } = data;
  
  if (!taskId || !reward || typeof reward !== 'number' || reward < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid task data');
  }
  
  // ✅ SECURITY: Validate reward doesn't exceed max
  if (reward > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Reward amount too high');
  }
  
  try {
    // Verify task exists
    const taskSnap = await db.collection('tasks').doc(taskId).get();
    if (!taskSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Task not found');
    }
    
    const taskData = taskSnap.data();
    
    // ✅ SECURITY: Verify reward matches
    if (taskData.reward !== reward) {
      throw new functions.https.HttpsError('invalid-argument', 'Reward mismatch - fraud attempt detected');
    }
    
    // Check if already claimed
    const claimedSnap = await db.collection('claimed_tasks')
      .where('userId', '==', uid)
      .where('taskId', '==', taskId)
      .get();
    
    if (!claimedSnap.empty) {
      throw new functions.https.HttpsError('already-exists', 'Task already claimed');
    }
    
    // ✅ SERVER-SIDE UPDATE
    const batch = db.batch();
    
    // Update user coins
    batch.update(db.collection('users').doc(uid), {
      coins: admin.firestore.FieldValue.increment(reward),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Record claim
    batch.set(db.collection('claimed_tasks').doc(`${uid}_${taskId}`), {
      userId: uid,
      taskId: taskId,
      reward: reward,
      claimedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await batch.commit();
    
    await logAdminAction(uid, 'TASK_CLAIMED', { taskId, reward });
    
    return { success: true, message: `🎉 +${reward} Coins जुड़ गए!` };
    
  } catch (error) {
    console.error('Error in claimTask:', error);
    throw error;
  }
});

// ✅ REQUEST WITHDRAWAL (with encryption)
exports.requestWithdrawal = functions.https.onCall(async (data, context) => {
  const uid = await verifyUser(context);
  
  const { upiId, coins } = data;
  
  // ✅ SECURITY: Input validation
  if (!upiId || !coins || typeof coins !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid withdrawal data');
  }
  
  if (!isValidUPI(upiId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid UPI format');
  }
  
  const sanitizedUPI = sanitize(upiId);
  const minWithdrawal = parseInt(process.env.MIN_WITHDRAWAL_COINS) || 500;
  
  if (coins < minWithdrawal || coins > 1000000) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `कम से कम ${minWithdrawal} Coins होना ज़रूरी है!`
    );
  }
  
  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    
    const userBalance = userSnap.data().coins || 0;
    
    // ✅ SECURITY: Verify balance server-side
    if (userBalance < coins) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance');
    }
    
    // ✅ SECURITY: Encrypt UPI before storing
    const encryptedUPI = crypto
      .createHash('sha256')
      .update(sanitizedUPI + process.env.UPI_ENCRYPTION_KEY)
      .digest('hex');
    
    const batch = db.batch();
    
    // Deduct coins
    batch.update(userRef, {
      coins: admin.firestore.FieldValue.increment(-coins),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Create withdrawal request
    batch.set(db.collection('withdrawals').doc(`req_${Date.now()}_${uid}`), {
      uid: uid,
      email: userSnap.data().email,
      upiHash: encryptedUPI, // Store encrypted
      coins: coins,
      status: 'Pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processed: false
    });
    
    await batch.commit();
    
    await logAdminAction(uid, 'WITHDRAWAL_REQUESTED', { coins, upiHash: encryptedUPI });
    
    return { success: true, message: '✅ Withdrawal Request भेजी गई!' };
    
  } catch (error) {
    console.error('Error in requestWithdrawal:', error);
    throw error;
  }
});

// ✅ ADMIN: CREATE TASK (only verified admin)
exports.createTask = functions.https.onCall(async (data, context) => {
  const uid = await verifyUser(context);
  
  // ✅ SECURITY: Verify admin (check custom claim or admin list)
  const userRecord = await admin.auth().getUser(uid);
  if (!userRecord.customClaims || !userRecord.customClaims.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  
  const { title, reward, link } = data;
  
  if (!title || !reward || !link) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }
  
  const sanitizedTitle = sanitize(title);
  const sanitizedLink = sanitize(link);
  
  if (reward < 0 || reward > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid reward amount');
  }
  
  try {
    const taskId = `task_${Date.now()}`;
    await db.collection('tasks').doc(taskId).set({
      title: sanitizedTitle,
      reward: reward,
      link: sanitizedLink,
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      active: true
    });
    
    await logAdminAction(uid, 'TASK_CREATED', { taskId, reward });
    
    return { success: true, message: '🎉 Task Live हो गया!' };
    
  } catch (error) {
    console.error('Error in createTask:', error);
    throw error;
  }
});

// ✅ ADMIN: UPDATE USER BALANCE (only admin)
exports.updateUserBalance = functions.https.onCall(async (data, context) => {
  const uid = await verifyUser(context);
  
  // Verify admin
  const userRecord = await admin.auth().getUser(uid);
  if (!userRecord.customClaims || !userRecord.customClaims.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  
  const { targetUserId, amount } = data;
  
  if (!targetUserId || typeof amount !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid parameters');
  }
  
  if (Math.abs(amount) > 1000000) {
    throw new functions.https.HttpsError('invalid-argument', 'Amount too large');
  }
  
  try {
    await db.collection('users').doc(targetUserId).update({
      coins: admin.firestore.FieldValue.increment(amount),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await logAdminAction(uid, 'USER_BALANCE_UPDATED', { targetUserId, amount });
    
    return { success: true, message: `User balance updated by ${amount}` };
    
  } catch (error) {
    console.error('Error in updateUserBalance:', error);
    throw error;
  }
});

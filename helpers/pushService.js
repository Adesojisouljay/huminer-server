import fs from "fs";
import path from "path";
import User from "../models/User.js";

let firebaseAdmin = null;
let isInitialized = false;

// Attempt to initialize Firebase Admin if service account exists
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json";
  const absolutePath = path.resolve(serviceAccountPath);

  if (fs.existsSync(absolutePath)) {
    const adminModule = await import("firebase-admin");
    const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
    
    adminModule.default.initializeApp({
      credential: adminModule.default.credential.cert(serviceAccount),
    });
    firebaseAdmin = adminModule.default;
    isInitialized = true;
    console.log("🔥 [PushService] Firebase Admin SDK initialized successfully");
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const adminModule = await import("firebase-admin");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    
    adminModule.default.initializeApp({
      credential: adminModule.default.credential.cert(serviceAccount),
    });
    firebaseAdmin = adminModule.default;
    isInitialized = true;
    console.log("🔥 [PushService] Firebase Admin initialized from env JSON");
  } else {
    console.log("ℹ️ [PushService] Firebase service account not provided yet. Push notifications for closed-app ringing will activate once configured.");
  }
} catch (err) {
  console.warn("⚠️ [PushService] Firebase initialization skipped:", err.message);
}

/**
 * Dispatch high-priority Incoming Call push notification to recipient's registered devices
 */
export const sendIncomingCallPush = async ({
  toUserId,
  fromUserId,
  fromUsername,
  fromProfilePicture,
  callType,
}) => {
  try {
    const recipient = await User.findById(toUserId).select("fcmTokens username");
    if (!recipient || !recipient.fcmTokens || recipient.fcmTokens.length === 0) {
      console.log(`[Push] User ${toUserId} has no registered push tokens`);
      return;
    }

    if (!isInitialized || !firebaseAdmin) {
      console.log(`[Push] Firebase not configured yet, skipping closed-app push to ${recipient.fcmTokens.length} device(s)`);
      return;
    }

    const title = `📞 Incoming ${callType === "video" ? "Video" : "Voice"} Call`;
    const body = `@${fromUsername || "User"} is calling you on Huminer...`;

    const message = {
      tokens: recipient.fcmTokens,
      data: {
        type: "incoming_call",
        fromUserId: fromUserId?.toString(),
        fromUsername: fromUsername || "User",
        fromProfilePicture: fromProfilePicture || "",
        callType: callType || "audio",
        click_action: "OPEN_CALL",
      },
      android: {
        priority: "high",
        ttl: 60 * 1000, // 60 seconds TTL for incoming call
        notification: {
          channelId: "calls",
          title,
          body,
          sound: "default",
          priority: "max",
          visibility: "public",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: 1,
            "content-available": 1,
          },
        },
      },
    };

    const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
    console.log(`🔥 [Push] Incoming call push dispatched: ${response.successCount} success, ${response.failureCount} failed`);

    // Clean up stale or invalid tokens
    if (response.failureCount > 0) {
      const badTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            badTokens.push(recipient.fcmTokens[idx]);
          }
        }
      });
      if (badTokens.length > 0) {
        await User.findByIdAndUpdate(toUserId, {
          $pull: { fcmTokens: { $in: badTokens } },
        });
      }
    }
  } catch (err) {
    console.error("Error sending incoming call push:", err);
  }
};

/**
 * Dispatch generic push notification to a user's devices (Tips, Live broadcasts, Mentions, Likes, Comments)
 */
export const sendPushNotification = async ({
  toUserId,
  title,
  body,
  data = {},
  icon = "https://huminer.adesojisouljay.com/logo512.png"
}) => {
  try {
    const recipient = await User.findById(toUserId).select("fcmTokens username settings");
    if (!recipient) return;

    // Check if user has disabled push notifications in their settings
    if (recipient.settings?.pushNotifications === false) {
      return;
    }

    if (!recipient.fcmTokens || recipient.fcmTokens.length === 0) {
      return;
    }

    if (!isInitialized || !firebaseAdmin) {
      return;
    }

    const stringData = {};
    Object.entries(data).forEach(([k, v]) => {
      stringData[k] = v !== null && v !== undefined ? String(v) : "";
    });

    const message = {
      tokens: recipient.fcmTokens,
      data: stringData,
      notification: {
        title,
        body,
      },
      android: {
        priority: "high",
        notification: {
          title,
          body,
          icon: "ic_notification",
          color: "#ffd700",
          sound: "default",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
    console.log(`🔥 [Push] Push sent to user ${toUserId} (${title}): ${response.successCount} success`);

    // Clean up expired tokens
    if (response.failureCount > 0) {
      const badTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            badTokens.push(recipient.fcmTokens[idx]);
          }
        }
      });
      if (badTokens.length > 0) {
        await User.findByIdAndUpdate(toUserId, {
          $pull: { fcmTokens: { $in: badTokens } },
        });
      }
    }
  } catch (err) {
    console.error("sendPushNotification error:", err);
  }
};


import Notification from "../models/Notification.js";
import { emitNotificationToUser } from "./socket.js";
import { sendPushNotification } from "./pushService.js";

export const createNotification = async ({
  userId,
  type,
  postId = null,
  commentId = null,
  liveId = null,
  fromUserId,
  fromUsername,
  fromProfilePicture,
  message,
}) => {
  try {
    const notification = await Notification.create({
      userId,
      type,
      postId,
      commentId,
      liveId,
      fromUserId,
      fromUsername,
      fromProfilePicture,
      message,
    });

    // Real-time instant delivery via Socket.io
    try {
      emitNotificationToUser(userId, notification);
    } catch (sockErr) {
      console.warn("Socket notification emit error:", sockErr);
    }

    // Native mobile push notification via FCM / APNs
    try {
      let pushTitle = "Huminer Alert";
      if (type === "post-tip" || type === "comment-tip") pushTitle = "💰 New Tip Received!";
      else if (type === "crypto-wallet-alert") pushTitle = "⚡ Crypto Tip Alert";
      else if (type === "like") pushTitle = "❤️ New Like";
      else if (type === "comment" || type === "reply") pushTitle = "💬 New Comment";
      else if (type === "follow") pushTitle = "👥 New Follower";
      else if (type === "live") pushTitle = "🔴 Live Broadcast";
      else if (type === "mention") pushTitle = "🔔 You were mentioned";

      sendPushNotification({
        toUserId: userId,
        title: pushTitle,
        body: message,
        data: {
          type,
          postId: postId || "",
          commentId: commentId || "",
          liveId: liveId || "",
          fromUserId: fromUserId || "",
          fromUsername: fromUsername || "",
        },
      }).catch((pushErr) => console.warn("Background push error:", pushErr));
    } catch (pushErr) {
      console.warn("Push dispatch error:", pushErr);
    }

    return notification;
  } catch (err) {
    console.error("Error creating notification:", err);
    throw new Error("Failed to create notification");
  }
};

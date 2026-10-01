import Notification from "../models/Notification.js";
import { emitNotificationToUser } from "./socket.js";

export const createNotification = async ({
  userId,
  type,
  postId = null,
  commentId = null,
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

    return notification;
  } catch (err) {
    console.error("Error creating notification:", err);
    throw new Error("Failed to create notification");
  }
};

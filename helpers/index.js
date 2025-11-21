import Notification from "../models/Notification.js";

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

    return notification;
  } catch (err) {
    console.error("Error creating notification:", err);
    throw new Error("Failed to create notification");
  }
};

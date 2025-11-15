import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // recipient
    type: { type: String, enum: ["comment-tip", "post-tip", "comment", "reply"], required: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: "Comment" }, // optional
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // sender ID
    fromUsername: { type: String, required: true }, // store username directly
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);

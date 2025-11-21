import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    // recipient (user who will see the notification)
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },

    // type of notification
    type: { 
      type: String, 
      enum: [
        "comment",
        "reply",
        "comment-tip",
        "post-tip",
        "login",
        "follow",
        "unfollow"
      ],
      required: true 
    },

    // optional: when notification is tied to a post
    postId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Post" 
    },

    // optional: when notification is tied to a comment
    commentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Comment" 
    },

    // sender (who triggered the notification)
    fromUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },

    fromUsername: { 
      type: String 
    },

    // ⭐️ add this so you don't need to fetch sender info again
    fromProfilePicture: { type: String, default: "" },

    // message text for display
    message: { 
      type: String, 
      required: true 
    },

    read: { 
      type: Boolean, 
      default: false 
    }
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);

import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    reporterUsername: {
      type: String,
      required: true
    },
    targetType: {
      type: String,
      enum: ["post", "user", "comment", "live"],
      required: true,
      index: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    targetUsername: {
      type: String
    },
    reason: {
      type: String,
      enum: [
        "spam",
        "harassment",
        "hate_speech",
        "nudity_sexual",
        "scam_fraud",
        "violence",
        "copyright",
        "other"
      ],
      required: true
    },
    details: {
      type: String,
      maxlength: 1000
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "action_taken", "dismissed"],
      default: "pending",
      index: true
    },
    actionTaken: {
      type: String,
      enum: ["none", "content_removed", "user_warned", "user_suspended", "user_banned"],
      default: "none"
    },
    moderatorNotes: {
      type: String
    }
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);

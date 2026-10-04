import mongoose from "mongoose";

const storySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    media: {
      url: {
        type: String,
        default: "",
      },
      type: {
        type: String,
        enum: ["image", "video", "audio", "text"],
        default: "image",
      },
    },
    text: {
      type: String,
      trim: true,
      default: "",
    },
    backgroundColor: {
      type: String,
      default: "linear-gradient(135deg, #6366f1, #a855f7)",
    },
    textColor: {
      type: String,
      default: "#ffffff",
    },
    caption: {
      type: String,
      trim: true,
      default: "",
    },
    viewers: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Story expires automatically after 24 hours (86400 seconds)
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400,
    },
  },
  { timestamps: true }
);

const Story = mongoose.model("Story", storySchema);
export default Story;

import mongoose from "mongoose";

const liveStreamSchema = new mongoose.Schema(
  {
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: "Live Stream",
    },
    status: {
      type: String,
      enum: ["live", "ended"],
      default: "live",
      index: true,
    },
    viewerCount: {
      type: Number,
      default: 0,
    },
    peakViewers: {
      type: Number,
      default: 0,
    },
    totalTips: {
      type: Number,
      default: 0,
    },
    tips: [
      {
        fromUser: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        amount: {
          type: Number,
          required: true,
        },
        note: {
          type: String,
          default: "",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    recordingUrl: {
      type: String,
      default: "",
    },
    hasReplay: {
      type: Boolean,
      default: false,
      index: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

const LiveStream = mongoose.model("LiveStream", liveStreamSchema);
export default LiveStream;

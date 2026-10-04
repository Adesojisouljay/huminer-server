import mongoose from "mongoose";

const callInfoSchema = new mongoose.Schema(
  {
    callLogId: { type: mongoose.Schema.Types.ObjectId, ref: "CallLog" },
    callType: { type: String, enum: ["audio", "video"] },
    status: { type: String, enum: ["answered", "missed", "rejected"] },
    duration: { type: Number, default: 0 },
    isGroup: { type: Boolean, default: false },
    invitedCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
  callInfo: { type: callInfoSchema, default: null },
  audioUrl: { type: String },
  audioDuration: { type: Number },
  fileUrl: { type: String },
  fileType: { type: String }, // "image" | "video" | "audio" | "raw" / "document"
  fileName: { type: String },
  fileSize: { type: Number },
  replyTo: {
    messageId: { type: mongoose.Schema.Types.Mixed },
    text: { type: String },
    senderName: { type: String },
    senderId: { type: mongoose.Schema.Types.Mixed },
  },
  // Shared post card preview
  sharedPost: {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
    title: { type: String },
    author: { type: String },
    thumbnail: { type: String }, // first image/video thumbnail url
    body: { type: String },      // short excerpt
  },
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema({
  participants: [
    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  ],
  isGroup: { type: Boolean, default: false },
  groupName: { type: String, default: "" },
  groupIcon: { type: String, default: "" },
  groupDescription: { type: String, default: "" },
  admin: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  isMuted: { type: Boolean, default: false },
  messages: [messageSchema],
  lastMessage: { type: String },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Update `updatedAt` when a message is added
chatSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model("Chat", chatSchema);

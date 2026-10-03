import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
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
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema({
  participants: [
    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  ],
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

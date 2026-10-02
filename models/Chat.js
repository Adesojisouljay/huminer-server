import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId },
    text: { type: String },
    senderName: { type: String },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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

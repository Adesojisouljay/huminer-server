import mongoose from "mongoose";

const tipSchema = new mongoose.Schema({
  postId: mongoose.Schema.Types.ObjectId,
  fromUserId: mongoose.Schema.Types.ObjectId,
  fromUsername: String,
  toUserId: mongoose.Schema.Types.ObjectId,
  toUsername: String,
  amount: Number,
  currency: { type: String, enum: ["NGN", "HIVE", "HBD"] },
  status: { type: String, enum: ["pending", "released"], default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const childReplySchema = new mongoose.Schema(
  {
    userId: mongoose.Schema.Types.ObjectId,
    commentAuthor: String,
    parentAuthor: String,
    content: String,
    replyTo: mongoose.Schema.Types.ObjectId,

    // ⭐ Tipping fields (added back)
    tips: [tipSchema],
    totalTips: { type: Number, default: 0 },
    payoutAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    isPaidOut: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const commentSchema = new mongoose.Schema(
  {
    postId: mongoose.Schema.Types.ObjectId,
    userId: mongoose.Schema.Types.ObjectId,
    content: String,
    commentAuthor: String,
    parentAuthor: String,

    replyTo: { type: mongoose.Schema.Types.ObjectId, default: null },

    // ⭐ children replies (same structure as comment)
    children: [childReplySchema],

    // ⭐ Tipping fields (added back)
    tips: [tipSchema],
    totalTips: { type: Number, default: 0 },
    payoutAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    isPaidOut: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const postSchema = new mongoose.Schema(
  {
    title: String,
    body: String,

    media: [
      {
        url: String,
        type: { type: String, enum: ["audio", "video", "image"] }
      }
    ],

    userId: mongoose.Schema.Types.ObjectId,
    author: String,
    tags: [String],

    tips: [tipSchema],
    totalTips: { type: Number, default: 0 },
    payoutAt: Date,
    isPaidOut: Boolean,

    comments: [commentSchema]
  },
  { timestamps: true }
);

export default mongoose.model("Post", postSchema);

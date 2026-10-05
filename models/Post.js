import mongoose from "mongoose";

const tipSchema = new mongoose.Schema({
  postId: mongoose.Schema.Types.ObjectId,
  fromUserId: mongoose.Schema.Types.ObjectId,
  fromUsername: String,
  toUserId: mongoose.Schema.Types.ObjectId,
  toUsername: String,
  amount: Number,
  currency: { type: String, enum: ["NGN", "USDT", "BTC", "HIVE", "HBD"], default: "NGN" },
  status: { type: String, enum: ["pending", "completed", "released"], default: "completed" },
  releaseDate: { type: Date, default: Date.now },
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
    isPaidOut: { type: Boolean, default: false },

    // ✏️ Edit & Management fields
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date }
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
    isPaidOut: { type: Boolean, default: false },

    // ✏️ Edit & Management fields
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date }
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

    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    author: String,
    tags: [String],

    tips: [tipSchema],
    totalTips: { type: Number, default: 0 },
    payoutAt: Date,
    isPaidOut: Boolean,

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 🟢 Likes
    reblogs: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 🔁 Reblogs / Reshares
    saves: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 🔖 Saved / Bookmarked
    views: { type: Number, default: 0 }, // 👁️ Views count
    viewedBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        lastViewedAt: { type: Date, default: Date.now }
      }
    ], // Viewers with timestamp for cooldown

    // 📦 Archive & Edit flags
    isArchived: { type: Boolean, default: false, index: true },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },

    comments: [commentSchema]
  },
  { timestamps: true }
);

export default mongoose.model("Post", postSchema);

import mongoose from "mongoose";

const tipSchema = new mongoose.Schema({
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fromUsername: { type: String, required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // post author
    toUsername: { type: String, required: true }, // post author
    amount: { type: Number, required: true },
    currency: { type: String, required: true, enum: ["NGN", "HIVE", "HBD"] },
    status: { type: String, enum: ["pending", "released"], default: "pending" },
    createdAt: { type: Date, default: Date.now },
  });

  // const commentSchema = new mongoose.Schema(
  //   {
  //     postId: {
  //       type: mongoose.Schema.Types.ObjectId,
  //       ref: "Post",
  //       required: true, // comment must belong to a post
  //     },
  //     userId: {
  //       type: mongoose.Schema.Types.ObjectId,
  //       ref: "User",
  //       required: true, // comment must be created by a user
  //     },
  //     content: {
  //       type: String,
  //       required: true, // comment must have text
  //       trim: true,
  //     },
  //     commentAuthor: { type: String}, // cached for display
  //     parentAuthor: { type: String}, // cached for display
  //     replyTo: {
  //       type: mongoose.Schema.Types.ObjectId,
  //       ref: "Comment",
  //       default: null, // only required if it’s a reply
  //     },
  //     tips: [tipSchema],
  //     totalTips: { type: Number, default: 0 }, // cumulative tips for this comment/reply
  //     payoutAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  //     isPaidOut: { type: Boolean, default: false }, // prevents double payout
  //   },
  //   { timestamps: true }
  // );  
  const commentSchema = new mongoose.Schema(
    {
      postId: mongoose.Schema.Types.ObjectId,
      userId: mongoose.Schema.Types.ObjectId,
      content: String,
      commentAuthor: String,
      parentAuthor: String,
  
      replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
  
      children: [
        {
          userId: mongoose.Schema.Types.ObjectId,
          commentAuthor: String,
          parentAuthor: String,
          content: String,
          replyTo: mongoose.Schema.Types.ObjectId,
        }
      ]
    },
    { timestamps: true }
  );  
  
const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    
    media: [
        {
          url: { type: String, required: true }, // link or file URL
          type: { type: String, enum: ["audio", "video", "image"], required: true } // categorizes media
        }
      ],      

    // Author Info
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    author: { type: String, required: true }, // cached for fast queries

    tags: [{ type: String }],

    // Tipping (instead of just likes)
    tips: [tipSchema],
    totalTips: { type: Number, default: 0 }, // cumulative tips for this post
    payoutAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    isPaidOut: { type: Boolean, default: false }, // prevents double payout
    
    // comments with tipping
    comments: [commentSchema]
  },
  { timestamps: true }
);

export default mongoose.model("Post", postSchema);

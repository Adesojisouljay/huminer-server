import mongoose from "mongoose";

const audioTrackSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    artist: { type: String, default: "Original Sound", trim: true },
    audioUrl: { type: String, required: true },
    coverUrl: { type: String, default: null },
    duration: { type: Number, default: 30 }, // duration in seconds
    category: {
      type: String,
      enum: ["catalog", "ugc", "afrobeat", "lofi", "electronic", "hiphop", "chill", "pop"],
      default: "catalog"
    },
    // Creator reference if uploaded/extracted from a user's post
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    creatorUsername: { type: String, default: null },
    originalPostId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },

    usageCount: { type: Number, default: 0 }, // How many posts use this sound
    isTrending: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false } // Verified artist/catalog badge
  },
  { timestamps: true }
);

audioTrackSchema.index({ title: "text", artist: "text", category: 1 });

export default mongoose.model("AudioTrack", audioTrackSchema);

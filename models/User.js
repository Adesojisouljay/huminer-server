import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },

  // Profile Info
  fullName: { type: String, trim: true },
  bio: { type: String, maxlength: 200 },
  profilePicture: { type: String },
  coverPhoto: { type: String },
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ["male", "female"] },

  // Social Graph
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  verified: { type: Boolean, default: false },
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },

  // Posts, Likes & Activity
  posts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
  likedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
  savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
  totalLikes: { type: Number, default: 0 },
  totalTipped: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  stories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Story" }],
  badges: [String],

  // Bank & Financials
  accountBalance: { type: Number, default: 0 },
  bankAccounts: [
    {
      bankName: String,
      accountNumber: String,
      accountName: String,
      isPrimary: { type: Boolean, default: false }
    }
  ],

  // Notifications & Settings
  notifications: [{ type: mongoose.Schema.Types.ObjectId, ref: "Notification" }],
  settings: {
    isPrivate: { type: Boolean, default: false },
    pushNotifications: { type: Boolean, default: true },
    language: { type: String, default: "en" }
  },

  // Security
  lastLogin: { type: Date },
  isActive: { type: Boolean, default: true },
  role: { type: String, enum: ["user", "artist", "admin"], default: "user" },
  verificationDocs: [String],

}, { timestamps: true });

export default mongoose.model("User", userSchema);

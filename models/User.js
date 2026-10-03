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
  rebloggedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
  totalLikes: { type: Number, default: 0 },
  totalTipped: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  stories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Story" }],
  badges: [String],

  // Bank & Financials (Fiat)
  accountBalance: { type: Number, default: 0 },
  bankAccounts: [
    {
      bankName: String,
      bankCode: String,
      accountNumber: String,
      accountName: String,
      recipientCode: String,
      isPrimary: { type: Boolean, default: false }
    }
  ],

  // Native Huminer Web3 Wallets (Multi-chain & Hybrid Vault)
  web3Wallets: {
    hasWallet: { type: Boolean, default: false },
    encryptedVault: { type: String, default: "" }, // AES-GCM encrypted mnemonic/keys with user PIN
    vaultSalt: { type: String, default: "" },      // Salt used for PBKDF2 key derivation
    addresses: { type: Map, of: String, default: {} }, // Multi-chain addresses (BTC, ETH, SOL, TRON, etc.)
    usdtAddress: { type: String, default: "" },
    usdtBalance: { type: Number, default: 0 },
    btcAddress: { type: String, default: "" },
    btcBalance: { type: Number, default: 0 },
    createdAt: { type: Date },
    lastSyncedAt: { type: Date }
  },

  ////Paid out
  pendingRewards: { type: Number, default: 0 },
  claimedRewards: { type: Number, default: 0 },

  pendingBreakdown: [
    {
      sourceId: mongoose.Schema.Types.ObjectId, // post/comment/reply ID
      sourceType: { type: String, enum: ["post", "comment", "reply"] },
      amount: Number,
      currency: { type: String, enum: ["NGN", "HIVE", "HBD"], default: "NGN" },
      createdAt: { type: Date, default: Date.now }
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
  // Push Notification Devices
  fcmTokens: [{ type: String }],
}, { timestamps: true });

export default mongoose.model("User", userSchema);

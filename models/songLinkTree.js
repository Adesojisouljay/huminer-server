import mongoose from "mongoose";

const platformLinkSchema = new mongoose.Schema({
  platform: String,
  url: String,
  nativeAppUriMobile: String,
  nativeAppUriDesktop: String,
  country: String
}, { _id: false });

const songLinkTreeSchema = new mongoose.Schema({
  title: String,
  artist: String,
  coverArt: String,
  entityUniqueId: String,
  userCountry: String,
  pageUrl: String,
  platforms: [platformLinkSchema],
  plays: { type: Number, default: 0 },
  shareUrl: String  // 👈 auto-generated field for mysite.com/song/:id
}, { timestamps: true });

// Automatically generate the share URL before saving
songLinkTreeSchema.pre("save", function(next) {
  if (!this.shareUrl) {
    this.shareUrl = `https://mysite.com/song/${this._id}`;
  }
  next();
});

export default mongoose.model("Song", songLinkTreeSchema);

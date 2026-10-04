import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    callee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    callType: { type: String, enum: ["audio", "video"], default: "audio" },
    status: {
      type: String,
      enum: ["answered", "missed", "rejected"],
      default: "missed",
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    duration: { type: Number, default: 0 }, // Duration in seconds
    seen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("CallLog", callLogSchema);

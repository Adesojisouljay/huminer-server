import LiveStream from "../models/LiveStream.js";
import User from "../models/User.js";
import Post from "../models/Post.js";
import Transaction from "../models/Transaction.js";
import { emitLiveTip, emitLiveEnded, emitUserBalanceUpdate } from "../helpers/socket.js";

// 🟢 START LIVE STREAM (Host)
export const startLiveStream = async (req, res) => {
  try {
    const hostId = req.user._id || req.user.id;
    const { title } = req.body;

    // End any lingering previous live streams for this host
    await LiveStream.updateMany(
      { host: hostId, status: "live" },
      { status: "ended", endedAt: new Date() }
    );

    const roomId = `live_${hostId}_${Date.now()}`;

    const stream = new LiveStream({
      host: hostId,
      roomId,
      title: title?.trim() || "Live Stream",
      status: "live",
    });

    await stream.save();

    const populatedStream = await LiveStream.findById(stream._id).populate(
      "host",
      "username profilePicture verified followersCount"
    );

    return res.status(201).json({
      success: true,
      message: "Live stream started",
      stream: populatedStream,
    });
  } catch (error) {
    console.error("Start live stream error:", error);
    return res.status(500).json({ success: false, message: "Failed to start live stream", error: error.message });
  }
};

// 🟢 GET ACTIVE LIVE STREAMS (For discovery & StoriesBar)
export const getActiveLiveStreams = async (req, res) => {
  try {
    const activeStreams = await LiveStream.find({ status: "live" })
      .populate("host", "username profilePicture verified followersCount")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      streams: activeStreams,
    });
  } catch (error) {
    console.error("Get active live streams error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch live streams", error: error.message });
  }
};

// 🟢 GET SINGLE LIVE STREAM DETAILS
export const getLiveStream = async (req, res) => {
  try {
    const { roomId } = req.params;

    const stream = await LiveStream.findOne({ roomId })
      .populate("host", "username profilePicture verified followersCount")
      .populate("tips.fromUser", "username profilePicture")
      .lean();

    if (!stream) {
      return res.status(404).json({ success: false, message: "Live stream not found" });
    }

    return res.status(200).json({
      success: true,
      stream,
    });
  } catch (error) {
    console.error("Get live stream error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch live stream", error: error.message });
  }
};

// 🟢 END LIVE STREAM (Host)
export const endLiveStream = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = (req.user._id || req.user.id).toString();

    const stream = await LiveStream.findOne({ roomId });
    if (!stream) {
      return res.status(404).json({ success: false, message: "Live stream not found" });
    }

    if (stream.host.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only the host can end this live stream" });
    }

    stream.status = "ended";
    stream.endedAt = new Date();
    await stream.save();

    // Broadcast ended event to all viewers in room
    emitLiveEnded(roomId);

    return res.status(200).json({
      success: true,
      message: "Live stream ended successfully",
      stream,
    });
  } catch (error) {
    console.error("End live stream error:", error);
    return res.status(500).json({ success: false, message: "Failed to end live stream", error: error.message });
  }
};

// 🟢 TIP HOST LIVE
export const tipLiveHost = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { amount, note } = req.body;
    const senderId = req.user._id || req.user.id;

    const tipAmount = Number(amount);
    if (!tipAmount || tipAmount <= 0) {
      return res.status(400).json({ success: false, message: "Please provide a valid tip amount" });
    }

    const stream = await LiveStream.findOne({ roomId }).populate("host");
    if (!stream) {
      return res.status(404).json({ success: false, message: "Live stream not found" });
    }

    if (stream.status !== "live" && !stream.hasReplay) {
      return res.status(400).json({ success: false, message: "This live stream has ended and has no replay available" });
    }

    const host = stream.host;
    const sender = await User.findById(senderId);

    if (!sender) {
      return res.status(404).json({ success: false, message: "Sender not found" });
    }

    if ((sender.accountBalance || 0) < tipAmount) {
      return res.status(400).json({ success: false, message: "Insufficient account balance to send tip" });
    }

    // Deduct from sender
    sender.accountBalance -= tipAmount;
    sender.totalTipped = (sender.totalTipped || 0) + tipAmount;
    await sender.save();

    // Credit host
    await User.findByIdAndUpdate(host._id, {
      $inc: {
        accountBalance: tipAmount,
        totalEarned: tipAmount,
      },
    });

    // Record in LiveStream tips array
    stream.tips.push({
      fromUser: sender._id,
      amount: tipAmount,
      note: note || "",
      createdAt: new Date(),
    });
    stream.totalTips = (stream.totalTips || 0) + tipAmount;
    await stream.save();

    // Record Transaction
    try {
      const tx = new Transaction({
        user: sender._id,
        amount: tipAmount,
        reference: `livetip_${roomId}_${Date.now()}`,
        status: "success",
        type: "withdrawal",
        metadata: {
          liveRoomId: roomId,
          hostId: host._id,
          note,
        },
      });
      await tx.save();
    } catch (e) {
      console.warn("Transaction record log error (non-fatal):", e.message);
    }

    // Emit live tip event via socket to all viewers in room
    const tipPayload = {
      fromUser: {
        _id: sender._id,
        username: sender.username,
        profilePicture: sender.profilePicture,
      },
      amount: tipAmount,
      note: note || "",
      totalStreamTips: stream.totalTips,
    };
    emitLiveTip(roomId, tipPayload);

    // Update sender balance via socket
    emitUserBalanceUpdate(sender._id, sender.accountBalance);

    return res.status(200).json({
      success: true,
      message: `Tipped ₦${tipAmount.toLocaleString()} to ${host.username}!`,
      newBalance: sender.accountBalance,
      totalTips: stream.totalTips,
    });
  } catch (error) {
    console.error("Tip live host error:", error);
    return res.status(500).json({ success: false, message: "Failed to send tip", error: error.message });
  }
};

// 🟢 SAVE LIVE REPLAY (Host saves recording)
export const saveLiveReplay = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { recordingUrl, postToFeed } = req.body;
    const userId = (req.user._id || req.user.id).toString();

    if (!recordingUrl) {
      return res.status(400).json({ success: false, message: "Recording URL is required" });
    }

    const stream = await LiveStream.findOne({ roomId }).populate("host");
    if (!stream) {
      return res.status(404).json({ success: false, message: "Live stream not found" });
    }

    if (stream.host._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Only the host can save replay" });
    }

    stream.recordingUrl = recordingUrl;
    stream.hasReplay = true;

    // Optionally create a Post on feed
    let createdPost = null;
    if (postToFeed) {
      if (!stream.post) {
        createdPost = new Post({
          title: `🔴 Live Replay: ${stream.title}`,
          body: `Recorded live broadcast with ${stream.peakViewers || stream.viewerCount || 0} viewers. Total tips: ₦${(stream.totalTips || 0).toLocaleString()}. Enjoy the replay!`,
          media: [{ url: recordingUrl, type: "video" }],
          userId: stream.host._id,
          author: stream.host.username,
          tags: ["live", "replay", "broadcast"],
          payoutAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          isPaidOut: false,
        });

        await createdPost.save();
        await User.findByIdAndUpdate(stream.host._id, { $push: { posts: createdPost._id } });
        stream.post = createdPost._id;
      } else {
        await Post.findByIdAndUpdate(stream.post, {
          media: [{ url: recordingUrl, type: "video" }],
        });
      }
    }

    await stream.save();

    return res.status(200).json({
      success: true,
      message: "Live stream replay saved successfully",
      stream,
      post: createdPost,
      postId: createdPost?._id || stream.post,
    });
  } catch (error) {
    console.error("Save live replay error:", error);
    return res.status(500).json({ success: false, message: "Failed to save replay", error: error.message });
  }
};

// 🟢 GET ALL REPLAYS (VODs)
export const getLiveReplays = async (req, res) => {
  try {
    const replays = await LiveStream.find({ hasReplay: true })
      .populate("host", "username profilePicture verified followersCount")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      replays,
    });
  } catch (error) {
    console.error("Get live replays error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch replays", error: error.message });
  }
};

// 🟢 GET CREATOR'S REPLAYS
export const getCreatorReplays = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const replays = await LiveStream.find({ host: user._id, hasReplay: true })
      .populate("host", "username profilePicture verified followersCount")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      replays,
    });
  } catch (error) {
    console.error("Get creator replays error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch creator replays", error: error.message });
  }
};


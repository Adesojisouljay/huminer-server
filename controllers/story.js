import Story from "../models/Story.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";

// Helper to optionally extract user from token if present
const extractUserFromHeader = async (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      const token = req.headers.authorization.split(" ")[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return await User.findById(decoded.id).select("_id username profilePicture");
      }
    } catch {
      return null;
    }
  }
  return null;
};

// 🟢 CREATE STORY
export const createStory = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { media, url, type, caption, text, backgroundColor, textColor } = req.body;

    const mediaType = media?.type || type || (text ? "text" : "image");
    const mediaUrl = media?.url || url || "";

    if (mediaType === "text") {
      if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: "Text content is required for text status" });
      }
    } else {
      if (!mediaUrl) {
        return res.status(400).json({ success: false, message: "Media URL is required for media story" });
      }
    }

    const story = new Story({
      user: userId,
      media: {
        url: mediaUrl,
        type: mediaType,
      },
      text: text?.trim() || "",
      backgroundColor: backgroundColor || "linear-gradient(135deg, #6366f1, #a855f7)",
      textColor: textColor || "#ffffff",
      caption: caption || "",
    });

    await story.save();

    // Link to User
    await User.findByIdAndUpdate(userId, {
      $push: { stories: story._id },
    });

    const populatedStory = await Story.findById(story._id).populate(
      "user",
      "username profilePicture verified"
    );

    return res.status(201).json({
      success: true,
      message: "Story created successfully",
      story: populatedStory,
    });
  } catch (error) {
    console.error("Create story error:", error);
    return res.status(500).json({ success: false, message: "Failed to create story", error: error.message });
  }
};

// 🟢 GET ACTIVE STORIES (Grouped by User)
export const getActiveStories = async (req, res) => {
  try {
    const currentUser = req.user || (await extractUserFromHeader(req));
    const currentUserId = currentUser?._id?.toString() || currentUser?.id?.toString();

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const activeStories = await Story.find({
      createdAt: { $gte: cutoff },
    })
      .populate("user", "username profilePicture verified")
      .sort({ createdAt: 1 })
      .lean();

    // Group stories by user
    const userStoryMap = new Map();

    for (const story of activeStories) {
      if (!story.user) continue;
      const uId = story.user._id.toString();

      if (!userStoryMap.has(uId)) {
        userStoryMap.set(uId, {
          userId: uId,
          user: story.user,
          stories: [],
          hasUnread: false,
          latestCreatedAt: story.createdAt,
        });
      }

      const group = userStoryMap.get(uId);
      const isViewed = currentUserId
        ? story.viewers?.some((v) => v.user?.toString() === currentUserId)
        : false;

      group.stories.push({
        ...story,
        isViewed,
      });

      if (!isViewed && uId !== currentUserId) {
        group.hasUnread = true;
      }

      group.latestCreatedAt = story.createdAt;
    }

    let groups = Array.from(userStoryMap.values());

    // Order: Current user first (if they have stories), then unread stories, then read stories
    groups.sort((a, b) => {
      if (currentUserId && a.userId === currentUserId) return -1;
      if (currentUserId && b.userId === currentUserId) return 1;
      if (a.hasUnread && !b.hasUnread) return -1;
      if (!a.hasUnread && b.hasUnread) return 1;
      return new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt);
    });

    return res.status(200).json({
      success: true,
      groups,
    });
  } catch (error) {
    console.error("Get active stories error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch stories", error: error.message });
  }
};

// 🟢 MARK STORY AS VIEWED
export const markStoryAsViewed = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id || req.user.id;

    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }

    const alreadyViewed = story.viewers.some(
      (v) => v.user?.toString() === userId.toString()
    );

    if (!alreadyViewed) {
      story.viewers.push({ user: userId, viewedAt: new Date() });
      await story.save();
    }

    return res.status(200).json({ success: true, message: "Story marked as viewed" });
  } catch (error) {
    console.error("Mark story viewed error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark story as viewed", error: error.message });
  }
};

// 🟢 DELETE STORY
export const deleteStory = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req.user._id || req.user.id).toString();

    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }

    if (story.user.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Unauthorized to delete this story" });
    }

    await Story.findByIdAndDelete(id);

    // Remove from User stories array
    await User.findByIdAndUpdate(userId, {
      $pull: { stories: id },
    });

    return res.status(200).json({ success: true, message: "Story deleted successfully" });
  } catch (error) {
    console.error("Delete story error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete story", error: error.message });
  }
};

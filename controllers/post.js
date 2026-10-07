import Post from "../models/Post.js";
import User from "../models/User.js";
import AudioTrack from "../models/AudioTrack.js";
import { createNotification } from "../helpers/index.js";

// CREATE a new post
export const createPost = async (req, res) => {
  try {
    const { title, body, media, tags, audioTrackId, audioTrackTitle, audioTrackArtist, audioTrackUrl } = req.body;
    console.log({ title, body, media, tags, audioTrackId });

    if (!title || !body) {
      return res.status(400).json({ success: false, message: "Title and body are required" });
    }

    // Auto-extract hashtags from body (e.g. #music #huminer #crypto) and merge with tags
    const bodyMatches = (body.match(/#([\w\u0590-\u05ff\u0600-\u06ff]+)/gi) || []).map(t =>
      t.replace("#", "").toLowerCase()
    );

    const explicitTags = Array.isArray(tags)
      ? tags.map(t => t.replace(/^#/, "").toLowerCase().trim()).filter(Boolean)
      : [];

    const mergedTags = Array.from(new Set([...bodyMatches, ...explicitTags]));

    // Determine Sound / Audio Attribution
    let resolvedAudioTrackId = audioTrackId || null;
    let resolvedAudioTrackTitle = audioTrackTitle || null;
    let resolvedAudioTrackArtist = audioTrackArtist || null;
    let resolvedAudioTrackUrl = audioTrackUrl || null;

    if (resolvedAudioTrackId) {
      // Increment existing track usage count
      AudioTrack.findByIdAndUpdate(resolvedAudioTrackId, { $inc: { usageCount: 1 } }).catch(err =>
        console.warn("AudioTrack increment error:", err)
      );
    } else {
      // Check if media contains audio or video with sound to register UGC sound identity
      const mediaList = Array.isArray(media) ? media : [];
      const audioMedia = mediaList.find(m => m.type === "audio");
      const videoMedia = mediaList.find(m => m.type === "video");
      const soundSource = audioMedia || videoMedia;

      if (soundSource?.url) {
        resolvedAudioTrackTitle = `Original Audio - @${req.user.username}`;
        resolvedAudioTrackArtist = `@${req.user.username}`;
        resolvedAudioTrackUrl = soundSource.url;
      }
    }

    const newPost = new Post({
      title,
      body,
      media: Array.isArray(media) ? media : [], // must match schema shape
      userId: req.user.id,        // from authMiddleware
      author: req.user.username, // cached for faster queries
      tags: mergedTags,
      audioTrackId: resolvedAudioTrackId,
      audioTrackTitle: resolvedAudioTrackTitle,
      audioTrackArtist: resolvedAudioTrackArtist,
      audioTrackUrl: resolvedAudioTrackUrl,
      payoutAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      totalTips: 0,
    });

    const savedPost = await newPost.save();

    // If post created a new UGC sound identity and track ID wasn't provided, register AudioTrack record
    if (!resolvedAudioTrackId && resolvedAudioTrackUrl) {
      AudioTrack.create({
        title: resolvedAudioTrackTitle,
        artist: resolvedAudioTrackArtist,
        audioUrl: resolvedAudioTrackUrl,
        category: "ugc",
        creatorId: req.user.id,
        creatorUsername: req.user.username,
        originalPostId: savedPost._id,
        usageCount: 1
      }).then(track => {
        Post.findByIdAndUpdate(savedPost._id, { audioTrackId: track._id }).catch(() => {});
      }).catch(err => console.warn("UGC sound creation error:", err));
    }

    // 🔔 Notify @mentioned users in post body
    const rawPostMatches = (body.match(/@([a-zA-Z0-9_]+)/g) || []);
    const mentionedUsernames = Array.from(
      new Set(rawPostMatches.map((m) => m.slice(1).trim()).filter(Boolean))
    ).filter((u) => u.toLowerCase() !== req.user.username?.toLowerCase());

    if (mentionedUsernames.length > 0) {
      const regexQueries = mentionedUsernames.map(
        (name) => new RegExp(`^${name}$`, "i")
      );

      User.find({ username: { $in: regexQueries } })
        .select("_id username")
        .then((users) => {
          users.forEach((mentioned) => {
            createNotification({
              userId: mentioned._id,
              type: "mention",
              postId: savedPost._id,
              fromUserId: req.user.id,
              fromUsername: req.user.username,
              fromProfilePicture: req.user.profilePicture || "",
              message: `@${req.user.username} mentioned you in a post: "${savedPost.title}"`,
            }).catch((e) => console.warn("Mention alert error:", e));
          });
        })
        .catch((e) => console.warn("Mention query error:", e));
    }

    res.status(201).json({ success: true, post: savedPost });
  } catch (err) {
    console.error("CreatePost Error:", err);
    res.status(500).json({ success: false, message: err.message || "Server error creating post" });
  }
};

// GET all posts (modern algorithmic discovery & randomized feed like TikTok/Instagram/Facebook)
export const getPosts = async (req, res) => {
  try {
    const { tag, sort } = req.query;
    const blockedList = req.user?.blockedUsers || [];

    const query = {
      isArchived: { $ne: true },
      ...(tag ? { tags: tag.toLowerCase() } : {}),
      ...(blockedList.length > 0 ? { userId: { $nin: blockedList } } : {})
    };

    // Allow explicit reverse-chronological sorting if requested
    if (sort === "latest") {
      const posts = await Post.find(query)
        .populate("userId", "username email profilePicture verified verificationExpiresAt")
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, posts });
    }

    // Fetch candidate posts pool
    const rawPosts = await Post.find(query)
      .populate("userId", "username email profilePicture verified verificationExpiresAt");

    // Dynamic Discovery Feed:
    // Blends organic engagement (likes, tips, comments, views) with random exploration.
    // Posts are NOT strictly ordered by post time or age. Any post across time can be surfaced dynamically.
    const scoredPosts = rawPosts.map((post) => {
      const likes = Array.isArray(post.likes) ? post.likes.length : 0;
      const tips = Array.isArray(post.tips) ? post.tips.length : 0;
      const comments = Array.isArray(post.comments) ? post.comments.length : 0;
      const views = typeof post.views === "number" ? post.views : 0;

      // Base engagement weight + random exploration bonus
      const engagement = (likes * 2) + (tips * 4) + (comments * 3) + (Math.log10(views + 1) * 2);
      const randomFactor = Math.random() * 55; // High random variance ensures every load/swipe is fresh & diverse

      return {
        post,
        score: engagement + randomFactor,
      };
    });

    const posts = scoredPosts
      .sort((a, b) => b.score - a.score)
      .map((item) => item.post);

    res.status(200).json({ success: true, posts });
  } catch (err) {
    console.error("GetPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching posts" });
  }
};

// GET trending hashtags with post count stats
export const getTrendingTags = async (req, res) => {
  try {
    const stats = await Post.aggregate([
      { $match: { isArchived: { $ne: true } } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
      { $project: { tag: "$_id", count: 1, _id: 0 } }
    ]);

    res.status(200).json({ success: true, tags: stats });
  } catch (err) {
    console.error("GetTrendingTags Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching hashtags" });
  }
};

// 🔍 GLOBAL SEARCH (Users, Posts/Videos, Hashtags)
export const globalSearch = async (req, res) => {
  try {
    const rawQuery = (req.query.q || "").trim();
    const type = req.query.type || "all"; // "all" | "users" | "posts" | "tags"

    if (!rawQuery) {
      return res.status(200).json({
        success: true,
        users: [],
        posts: [],
        tags: []
      });
    }

    const cleanTag = rawQuery.replace(/^#/, "").toLowerCase();
    const searchRegex = new RegExp(rawQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    let users = [];
    let posts = [];
    let tags = [];

    // Search Users
    if (type === "all" || type === "users") {
      users = await User.find({
        $or: [
          { username: searchRegex },
          { fullName: searchRegex },
          { email: searchRegex }
        ]
      })
        .select("username fullName email profilePicture verified followers following bio")
        .limit(15);
    }

    // Search Posts
    if (type === "all" || type === "posts") {
      posts = await Post.find({
        isArchived: { $ne: true },
        $or: [
          { title: searchRegex },
          { body: searchRegex },
          { author: searchRegex },
          { tags: cleanTag }
        ]
      })
        .populate("userId", "username email profilePicture verified verificationExpiresAt")
        .sort({ createdAt: -1 })
        .limit(30);
    }

    // Search Tags
    if (type === "all" || type === "tags") {
      const tagStats = await Post.aggregate([
        { $match: { isArchived: { $ne: true } } },
        { $unwind: "$tags" },
        { $match: { tags: new RegExp(cleanTag, "i") } },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
        { $project: { tag: "$_id", count: 1, _id: 0 } }
      ]);
      tags = tagStats;
    }

    res.status(200).json({
      success: true,
      query: rawQuery,
      users,
      posts,
      tags
    });
  } catch (err) {
    console.error("GlobalSearch Error:", err);
    res.status(500).json({ success: false, message: "Server error executing search" });
  }
};

// 🌟 EXPLORE DISCOVERY FEED (Trending & viral posts grid)
export const getExploreFeed = async (req, res) => {
  try {
    const blockedList = req.user?.blockedUsers || [];
    const filter = {
      isArchived: { $ne: true },
      ...(blockedList.length > 0 ? { userId: { $nin: blockedList } } : {})
    };

    const posts = await Post.find(filter)
      .populate("userId", "username email profilePicture verified verificationExpiresAt")
      .limit(60);

    // Score and rank posts by engagement (tips, comments, likes, views) with freshness weight
    const scored = posts.map((post) => {
      const tipsCount = post.tips?.length || 0;
      const likesCount = post.likes?.length || 0;
      const commentsCount = post.comments?.length || 0;
      const viewsCount = post.views || 0;

      // Higher weight for tips and comments, plus visual media preference
      const hasMedia = (post.media?.length || 0) > 0 ? 5 : 0;
      const score = (tipsCount * 6) + (commentsCount * 3) + (likesCount * 2) + (viewsCount * 0.1) + hasMedia + (Math.random() * 4);

      return { post, score };
    });

    scored.sort((a, b) => b.score - a.score);

    res.status(200).json({
      success: true,
      posts: scored.map((s) => s.post)
    });
  } catch (err) {
    console.error("GetExploreFeed Error:", err);
    res.status(500).json({ success: false, message: "Server error fetching explore feed" });
  }
};

// Detect social media link preview bots & scrapers (WhatsApp, Facebook, Twitter, Telegram, Discord, LinkedIn, Google)
const isSocialCrawler = (userAgent = "") => {
  const ua = userAgent.toLowerCase();
  return (
    ua.includes("whatsapp") ||
    ua.includes("facebookexternalhit") ||
    ua.includes("facebot") ||
    ua.includes("twitterbot") ||
    ua.includes("telegrambot") ||
    ua.includes("discordbot") ||
    ua.includes("slackbot") ||
    ua.includes("linkedinbot") ||
    ua.includes("pinterest") ||
    ua.includes("embedly") ||
    ua.includes("quora link preview") ||
    ua.includes("outbrain") ||
    ua.includes("vkshare") ||
    ua.includes("w3c_validator") ||
    ua.includes("google-structured-data-testing-tool") ||
    ua.includes("bingbot") ||
    ua.includes("googlebot")
  );
};

// Generates beautiful Open Graph HTML for crawler bots
export const generatePostOpenGraphHtml = (post, req) => {
  const authorName = post.author || post.userId?.username || "Creator";
  const postTitle = post.title ? `${post.title} by @${authorName} | Huminer` : `@${authorName} on Huminer`;
  const snippet = post.body
    ? post.body.replace(/\r?\n|\r/g, " ").substring(0, 180)
    : "Watch and discover exclusive creations on Huminer - The Next-Gen Social Economy.";

  // Find image or video poster
  const imageMedia = post.media?.find((m) => m.type === "image");
  const videoMedia = post.media?.find((m) => m.type === "video");

  let imageUrl = "https://huminer.adesojisouljay.com/logo512.png";
  if (imageMedia?.url) {
    imageUrl = imageMedia.url;
    // WhatsApp crawler rejects images larger than 300KB or >1200px dimensions.
    // If it's a Cloudinary URL, transform it to an optimized, fast-loading preview (max 800px width/height, auto quality)
    if (imageUrl.includes("/upload/")) {
      imageUrl = imageUrl.replace("/upload/", "/upload/w_800,c_limit,q_auto,f_jpg/");
    }
  } else if (videoMedia?.url) {
    if (videoMedia.url.includes("/upload/")) {
      // Cloudinary video thumbnail poster: extract .jpg frame at w_800
      imageUrl = videoMedia.url
        .replace("/upload/", "/upload/w_800,c_limit,q_auto,f_jpg,so_0/")
        .replace(/\.[^/.]+$/, ".jpg");
    } else {
      imageUrl = videoMedia.url;
    }
  }

  const postUrl = `https://huminer.adesojisouljay.com/post/${post._id}`;

  const escapeHtml = (str) =>
    (str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(postTitle)}</title>
  <meta name="description" content="${escapeHtml(snippet)}" />

  <!-- Open Graph / WhatsApp / Facebook -->
  <meta property="og:type" content="${videoMedia ? "video.other" : "article"}" />
  <meta property="og:site_name" content="Huminer" />
  <meta property="og:url" content="${escapeHtml(postUrl)}" />
  <meta property="og:title" content="${escapeHtml(postTitle)}" />
  <meta property="og:description" content="${escapeHtml(snippet)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="800" />
  <meta property="og:image:height" content="600" />
  <meta property="og:image:alt" content="${escapeHtml(postTitle)}" />
  ${videoMedia ? `<meta property="og:video" content="${escapeHtml(videoMedia.url)}" />` : ""}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@Huminer" />
  <meta name="twitter:url" content="${escapeHtml(postUrl)}" />
  <meta name="twitter:title" content="${escapeHtml(postTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(snippet)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

  <!-- Instant Client Redirect for human visitors who hit this URL directly -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(postUrl)}" />
  <script>window.location.replace("${escapeHtml(postUrl)}");</script>
</head>
<body style="background:#0b0f19;color:#fff;font-family:sans-serif;padding:20px;text-align:center;">
  <h2>${escapeHtml(postTitle)}</h2>
  <p>${escapeHtml(snippet)}</p>
  <p>Redirecting to <a href="${escapeHtml(postUrl)}" style="color:#ffd700;">Huminer</a>...</p>
</body>
</html>`;
};

// GET single post by ID (Serves JSON for API calls, or Open Graph HTML for social crawlers)
export const getPostById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("userId", "username email profilePicture verified verificationExpiresAt")
      .populate("comments.userId", "username email profilePicture verified");

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const ua = req.headers["user-agent"] || "";
    // If request comes from a social crawler and accepts HTML, serve rich OG HTML
    if (isSocialCrawler(ua) && req.accepts(["html", "json"]) === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(generatePostOpenGraphHtml(post, req));
    }

    res.status(200).json({ success: true, post });
  } catch (err) {
    console.error("GetPostById Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching post" });
  }
};

// Dedicated endpoint to serve rich HTML metadata preview for crawlers or direct sharing: GET /post/:id
export const renderPostSharePreview = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("userId", "username email profilePicture verified verificationExpiresAt");

    if (!post) {
      return res.redirect("https://huminer.adesojisouljay.com");
    }

    const ua = req.headers["user-agent"] || "";
    if (isSocialCrawler(ua)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(generatePostOpenGraphHtml(post, req));
    }

    // For real users, redirect to web client
    return res.redirect(`https://huminer.adesojisouljay.com/post/${post._id}`);
  } catch (err) {
    console.error("renderPostSharePreview error:", err);
    return res.redirect("https://huminer.adesojisouljay.com");
  }
};

// Record view for a post (allows repeat views after a 3-minute cooldown, creator views never count)
export const recordPostView = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, completed = false, watchSeconds = 0 } = req.body;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // 1. Author's own views NEVER count
    const postAuthorId = (post.userId?._id || post.userId)?.toString();
    if (userId && postAuthorId && postAuthorId === userId.toString()) {
      return res.status(200).json({ success: true, views: post.views || 0, isAuthor: true });
    }

    // 2. Ensure viewedBy, views, completions and watch duration are initialized
    if (!Array.isArray(post.viewedBy)) {
      post.viewedBy = [];
    }
    if (typeof post.views !== "number") {
      post.views = 0;
    }
    if (typeof post.completions !== "number") {
      post.completions = 0;
    }
    if (typeof post.totalWatchSeconds !== "number") {
      post.totalWatchSeconds = 0;
    }

    // Accumulate valid watch duration (cap at reasonable 3600 seconds to prevent spoofing)
    const validWatchSecs = Math.min(Math.max(0, Number(watchSeconds) || 0), 3600);
    if (validWatchSecs > 0) {
      post.totalWatchSeconds += validWatchSecs;
    }

    // 3. Cooldown window: 3 minutes (180,000 ms)
    const VIEW_COOLDOWN_MS = 3 * 60 * 1000;
    const now = new Date();

    if (userId) {
      const viewerIndex = post.viewedBy.findIndex((item) => {
        const itemUid = item?.userId ? item.userId.toString() : item?.toString();
        return itemUid === userId.toString();
      });

      if (viewerIndex !== -1) {
        const existingEntry = post.viewedBy[viewerIndex];
        const lastViewedAt = existingEntry?.lastViewedAt
          ? new Date(existingEntry.lastViewedAt).getTime()
          : 0;

        // If newly marked completed
        if (completed && !existingEntry.completed) {
          existingEntry.completed = true;
          post.completions += 1;
        }

        // If viewed within cooldown period, ignore view increment but save watch/completion updates
        if (Date.now() - lastViewedAt < VIEW_COOLDOWN_MS) {
          if (validWatchSecs > 0 || (completed && !existingEntry.completed)) {
            await post.save();
          }
          return res.status(200).json({
            success: true,
            views: post.views,
            completions: post.completions,
            cooldown: true,
            remainingSeconds: Math.ceil((VIEW_COOLDOWN_MS - (Date.now() - lastViewedAt)) / 1000)
          });
        }

        // Cooldown passed: record fresh view and update timestamp
        post.viewedBy[viewerIndex] = {
          userId,
          lastViewedAt: now,
          completed: completed || Boolean(existingEntry.completed)
        };
        post.views += 1;
        if (completed && !existingEntry.completed) {
          post.completions += 1;
        }
        await post.save();
      } else {
        // First view by this user
        post.viewedBy.push({
          userId,
          lastViewedAt: now,
          completed: Boolean(completed)
        });
        post.views += 1;
        if (completed) {
          post.completions += 1;
        }
        await post.save();
      }
    } else {
      // Unauthenticated viewer
      post.views += 1;
      if (completed) {
        post.completions += 1;
      }
      await post.save();
    }

    res.status(200).json({
      success: true,
      views: post.views,
      completions: post.completions,
      totalWatchSeconds: post.totalWatchSeconds
    });
  } catch (err) {
    console.error("recordPostView Error:", err.message);
    res.status(500).json({ success: false, message: "Server error recording view" });
  }
};

// DELETE post
export const deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Only author can delete
    if (post.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this post" });
    }

    await post.deleteOne();
    res.status(200).json({ success: true, message: "Post deleted successfully" });
  } catch (err) {
    console.error("DeletePost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error deleting post" });
  }
};

// ✏️ EDIT post (title, body, tags)
export const editPost = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, body, tags } = req.body;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    if (post.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this post" });
    }

    if (title !== undefined) post.title = title.trim();
    if (body !== undefined) post.body = body.trim();
    if (tags !== undefined) {
      post.tags = Array.isArray(tags)
        ? tags.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean)
        : post.tags;
    }

    post.isEdited = true;
    post.editedAt = new Date();

    await post.save();
    await post.populate("userId", "username email profilePicture verified verificationExpiresAt");

    res.status(200).json({
      success: true,
      message: "Post updated successfully",
      post
    });
  } catch (err) {
    console.error("editPost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error editing post" });
  }
};

// 📦 ARCHIVE / UNARCHIVE post (toggle visibility so only the creator sees it)
export const toggleArchivePost = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    if (post.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to manage this post" });
    }

    post.isArchived = !post.isArchived;
    await post.save();
    await post.populate("userId", "username email profilePicture verified verificationExpiresAt");

    res.status(200).json({
      success: true,
      isArchived: post.isArchived,
      message: post.isArchived ? "Post archived (only you can see it)" : "Post unarchived and public",
      post
    });
  } catch (err) {
    console.error("toggleArchivePost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error archiving post" });
  }
};

// 📦 GET ARCHIVED posts (creator only)
export const getArchivedPosts = async (req, res) => {
  try {
    const userId = req.user.id;
    const posts = await Post.find({ userId, isArchived: true })
      .populate("userId", "username email profilePicture verified verificationExpiresAt")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, posts });
  } catch (err) {
    console.error("getArchivedPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching archived posts" });
  }
};

// ✏️ EDIT comment or reply
export const editComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: "Comment content cannot be empty" });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    let targetComment = post.comments.id(commentId);
    if (!targetComment) {
      for (const c of post.comments) {
        const child = c.children?.id(commentId);
        if (child) {
          targetComment = child;
          break;
        }
      }
    }

    if (!targetComment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (targetComment.userId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this comment" });
    }

    targetComment.content = content.trim();
    targetComment.isEdited = true;
    targetComment.editedAt = new Date();

    await post.save();
    await post.populate("userId", "username email profilePicture verified verificationExpiresAt");
    await post.populate("comments.userId", "username email profilePicture verified");

    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      post,
      comment: targetComment
    });
  } catch (err) {
    console.error("editComment Error:", err.message);
    res.status(500).json({ success: false, message: "Server error editing comment" });
  }
};

// 🗑️ DELETE comment or reply (post author or comment author can delete)
export const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const currentUserId = req.user.id;
    const isPostOwner = post.userId.toString() === currentUserId;

    // Check if it's a top-level comment
    const topComment = post.comments.id(commentId);
    if (topComment) {
      if (!isPostOwner && topComment.userId.toString() !== currentUserId) {
        return res.status(403).json({ success: false, message: "Not authorized to delete this comment" });
      }
      post.comments.pull(commentId);
      await post.save();
      await post.populate("userId", "username email profilePicture verified verificationExpiresAt");
      await post.populate("comments.userId", "username email profilePicture verified");

      return res.status(200).json({
        success: true,
        message: "Comment deleted successfully",
        post
      });
    }

    // Check if it's a child reply
    for (const c of post.comments) {
      const child = c.children?.id(commentId);
      if (child) {
        if (!isPostOwner && child.userId.toString() !== currentUserId) {
          return res.status(403).json({ success: false, message: "Not authorized to delete this reply" });
        }
        c.children.pull(commentId);
        await post.save();
        await post.populate("userId", "username email profilePicture verified verificationExpiresAt");
        await post.populate("comments.userId", "username email profilePicture verified");

        return res.status(200).json({
          success: true,
          message: "Reply deleted successfully",
          post
        });
      }
    }

    return res.status(404).json({ success: false, message: "Comment not found" });
  } catch (err) {
    console.error("deleteComment Error:", err.message);
    res.status(500).json({ success: false, message: "Server error deleting comment" });
  }
};

// TIP a post
export const tipPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { amount, currency } = req.body;

    const tipAmount = Number(amount) || 0;
    if (tipAmount < 0) {
      return res
        .status(400)
        .json({ success: false, message: "Tip amount cannot be negative" });
    }

    // Find post cleanly
    const post = await Post.findById(postId);
    if (!post) {
      return res
        .status(404)
        .json({ success: false, message: "Post not found" });
    }

    const sender = await User.findById(req.user.id);
    if (!sender) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const tipCurrency = currency ? currency.toUpperCase() : "NGN";

    // Resolve post creator: check post.userId first, fallback to author username
    let postOwner = null;
    if (post.userId) {
      postOwner = await User.findById(post.userId);
    }
    if (!postOwner && post.author) {
      postOwner = await User.findOne({ username: post.author });
    }

    if (!postOwner) {
      return res.status(404).json({ success: false, message: "Post creator not found" });
    }

    console.log(`[Tip Request] Post: ${post._id}, Sender: ${sender.username} (${sender._id}), Creator: ${postOwner.username} (${postOwner._id}), Amount: ${tipAmount} ${tipCurrency}`);

    // ⚡ If crypto tip (USDT / BTC)
    if (tipAmount > 0 && (tipCurrency === "USDT" || tipCurrency === "BTC")) {
      const hasWeb3 = postOwner.web3Wallets?.hasWallet;
      if (!hasWeb3) {
        // Notify the recipient to create their wallet
        await createNotification({
          userId: postOwner._id,
          type: "crypto-wallet-alert",
          postId: post._id,
          fromUserId: sender._id,
          fromUsername: sender.username,
          fromProfilePicture: sender.profilePicture,
          message: `Hurry, go create your Web3 wallet! ${sender.username} tried to tip you ${tipAmount} ${tipCurrency}.`,
        });

        return res.status(400).json({
          success: false,
          needsWeb3Wallet: true,
          message: `@${postOwner.username} has not created a Web3 wallet on Huminer yet. We've notified them to create one so they can receive ${tipCurrency}!`,
        });
      }

      // Check sender crypto balance
      const senderCryptoBalance =
        tipCurrency === "USDT"
          ? sender.web3Wallets?.usdtBalance || 0
          : sender.web3Wallets?.btcBalance || 0;

      if (senderCryptoBalance < tipAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient ${tipCurrency} balance in your Huminer Web3 wallet.`,
        });
      }

      // Deduct from sender crypto vault and credit creator
      if (tipCurrency === "USDT") {
        sender.web3Wallets.usdtBalance -= tipAmount;
        postOwner.web3Wallets.usdtBalance = (postOwner.web3Wallets.usdtBalance || 0) + tipAmount;
      } else {
        sender.web3Wallets.btcBalance -= tipAmount;
        postOwner.web3Wallets.btcBalance = (postOwner.web3Wallets.btcBalance || 0) + tipAmount;
      }

      await sender.save();
      await postOwner.save();
    } else if (tipAmount > 0) {
      // 💰 Fiat Naira Tip: Check sender balance
      if (sender.accountBalance < tipAmount) {
        return res
          .status(400)
          .json({ success: false, message: "Insufficient Naira balance" });
      }

      const isSelfTip = sender._id.toString() === postOwner._id.toString();

      if (isSelfTip) {
        // If tipping own post, no net change to accountBalance
        sender.totalTipped = (sender.totalTipped || 0) + tipAmount;
        sender.totalEarned = (sender.totalEarned || 0) + tipAmount;
        await sender.save();
      } else {
        // 💸 Deduct from sender
        sender.accountBalance -= tipAmount;
        sender.totalTipped = (sender.totalTipped || 0) + tipAmount;
        await sender.save();

        // 💰 Atomically credit creator in database
        const updatedRecipient = await User.findByIdAndUpdate(
          postOwner._id,
          {
            $inc: {
              accountBalance: tipAmount,
              totalEarned: tipAmount,
            },
          },
          { new: true }
        );
        console.log(`[Tip Credit] User ${postOwner.username} (${postOwner._id}) credited +₦${tipAmount}. New balance: ₦${updatedRecipient?.accountBalance}`);
      }
    }

    // 💾 Add tip to post
    post.tips.push({
      postId: post._id,
      fromUserId: sender._id,
      fromUsername: sender.username,
      toUserId: postOwner._id,
      toUsername: postOwner.username || post.author,
      amount: tipAmount,
      currency: tipCurrency,
      status: "completed",
      releaseDate: new Date(),
    });

    // Also register sender in post.likes if not already present
    if (!post.likes) post.likes = [];
    if (!post.likes.some((id) => id.toString() === sender._id.toString())) {
      post.likes.push(sender._id);
    }

    post.totalTips = (post.totalTips || 0) + tipAmount;
    await post.save();

    // 🛎️ CREATE NOTIFICATION FOR POST OWNER
    try {
      const displayAmount = tipCurrency === "NGN" ? `₦${tipAmount.toLocaleString()}` : `${tipAmount} ${tipCurrency}`;
      const notifMessage = tipAmount > 0
        ? `${sender.username} tipped your post ${displayAmount} (credited to your ${tipCurrency === "NGN" ? "wallet" : "Huminer Web3 vault"})`
        : `${sender.username} liked your post`;

      const recipientId = postOwner._id;
      if (recipientId && sender._id.toString() !== recipientId.toString()) {
        const notifDoc = await createNotification({
          userId: recipientId,   // recipient (post author)
          type: tipAmount > 0 ? "post-tip" : "like",
          postId: post._id,
          commentId: null,
          fromUserId: sender._id,
          fromUsername: sender.username,
          fromProfilePicture: sender.profilePicture || "",
          message: notifMessage,
        });
        console.log(`[Notification Success] Created notification ${notifDoc?._id} for recipient ${recipientId}`);
      }
    } catch (notifErr) {
      console.error("[Notification Error in tipPost]:", notifErr);
    }

    const displayAmount = tipCurrency === "NGN" ? `₦${tipAmount.toLocaleString()}` : `${tipAmount} ${tipCurrency}`;
    return res.status(200).json({
      success: true,
      message: tipAmount > 0 ? `Tipped ${displayAmount} successfully!` : "Post liked successfully!",
      post,
      newSenderBalance: sender.accountBalance,
      currency: tipCurrency,
    });

  } catch (err) {
    console.error("TipPost Error:", err);
    return res
      .status(500)
      .json({ success: false, message: err.message || "Server error tipping post" });
  }
};

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, replyTo } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Comment content is required",
      });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    const sender = req.user; // logged-in user
    const replyText = content;

    // -------------------------
    // CASE 1: New Parent Comment
    // -------------------------
    if (!replyTo) {
      const newComment = {
        postId,
        userId: sender.id,
        commentAuthor: sender.username,
        parentAuthor: null,
        content,
        replyTo: null,
        children: [],
      };

      post.comments.push(newComment);
      await post.save();
      await post.populate("userId", "username email profilePicture verified verificationExpiresAt");
      await post.populate("comments.userId", "username email profilePicture verified");

      // Notify the post owner (if the commenter is not the post owner)
      const postOwnerId = (post.userId?._id || post.userId)?.toString();
      if (postOwnerId && sender.id !== postOwnerId) {
        createNotification({
          userId: postOwnerId,
          type: "comment",
          postId,
          fromUserId: sender.id,
          fromUsername: sender.username,
          fromProfilePicture: sender.profilePicture,
          message: `${sender.username} commented on your post`,
        }).catch((e) => console.warn("Comment notification failed:", e));
      }

      // 🔔 Notify any @mentioned users in the comment
      const rawMatches = content.match(/@([a-zA-Z0-9_]+)/g) || [];
      const mentionedUsernames = Array.from(
        new Set(rawMatches.map((m) => m.slice(1).trim()).filter(Boolean))
      ).filter((u) => u.toLowerCase() !== sender.username?.toLowerCase());

      if (mentionedUsernames.length > 0) {
        const regexQueries = mentionedUsernames.map(
          (name) => new RegExp(`^${name}$`, "i")
        );

        User.find({ username: { $in: regexQueries } })
          .select("_id username")
          .then((users) => {
            users.forEach((mentioned) => {
              createNotification({
                userId: mentioned._id,
                type: "mention",
                postId: post._id,
                fromUserId: sender.id,
                fromUsername: sender.username,
                fromProfilePicture: sender.profilePicture || "",
                message: `@${sender.username} mentioned you in a comment: "${content}"`,
              }).catch((e) => console.warn("Mention alert error:", e));
            });
          })
          .catch((e) => console.warn("Mention query error:", e));
      }

      return res.status(201).json({ success: true, post });
    }

    // -------------------------
    // CASE 2: Reply to a Comment
    // -------------------------

    // Find parent comment (main or nested)
    const parentComment =
      post.comments.id(replyTo) ||
      post.comments.find((c) => c.children.id(replyTo));

    if (!parentComment) {
      return res.status(404).json({
        success: false,
        message: "Comment being replied to not found",
      });
    }

    // Identify the exact comment that is being replied to
    const targetComment =
      parentComment._id.toString() === replyTo
        ? parentComment
        : parentComment.children.id(replyTo);

    const newReply = {
      postId,
      userId: sender.id,
      commentAuthor: sender.username,
      parentAuthor: targetComment.commentAuthor,
      content,
      replyTo,
      children: [],
    };

    // ALWAYS push reply into main comment’s children
    parentComment.children.push(newReply);

    await post.save();
    await post.populate("userId", "username email profilePicture verified verificationExpiresAt");
    await post.populate("comments.userId", "username email profilePicture verified");

    // ------------------------------
    // Create notification to the user
    // ------------------------------
    const targetAuthorId = (targetComment.userId?._id || targetComment.userId)?.toString();
    if (targetAuthorId && sender.id !== targetAuthorId) {
      createNotification({
        userId: targetAuthorId,      // recipient
        type: "reply",
        postId,
        commentId: targetComment._id,
        fromUserId: sender.id,
        fromUsername: sender.username,
        message: `${sender.username} replied to your comment: "${replyText}"`,
      }).catch((e) => console.warn("Reply notification failed:", e));
    }

    // 🔔 Notify any @mentioned users in the reply
    const rawReplyMatches = content.match(/@([a-zA-Z0-9_]+)/g) || [];
    const replyMentions = Array.from(
      new Set(rawReplyMatches.map((m) => m.slice(1).trim()).filter(Boolean))
    ).filter((u) => u.toLowerCase() !== sender.username?.toLowerCase() && u.toLowerCase() !== (targetComment.commentAuthor || "").toLowerCase());

    if (replyMentions.length > 0) {
      const regexQueries = replyMentions.map((name) => new RegExp(`^${name}$`, "i"));
      User.find({ username: { $in: regexQueries } })
        .select("_id username")
        .then((users) => {
          users.forEach((mentioned) => {
            createNotification({
              userId: mentioned._id,
              type: "mention",
              postId: post._id,
              fromUserId: sender.id,
              fromUsername: sender.username,
              fromProfilePicture: sender.profilePicture || "",
              message: `@${sender.username} mentioned you in a comment: "${content}"`,
            }).catch((e) => console.warn("Mention alert error:", e));
          });
        })
        .catch((e) => console.warn("Mention query error:", e));
    }

    res.status(201).json({ success: true, post });
  } catch (err) {
    console.error("AddComment Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error adding comment",
    });
  }
};

export const tipComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { amount, currency } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Tip amount must be greater than 0",
      });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    let target = null; // comment or reply receiving the tip

    // ---------------------------
    // 1️⃣ CHECK TOP-LEVEL COMMENT
    // ---------------------------
    const top = post.comments.id(commentId);
    if (top) {
      target = top;
    }

    // ---------------------------
    // 2️⃣ CHECK CHILD COMMENTS
    // ---------------------------
    if (!target) {
      for (const c of post.comments) {
        const child = c.children.id(commentId);
        if (child) {
          target = child;
          break;
        }
      }
    }

    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Comment or reply not found",
      });
    }

    const sender = await User.findById(req.user.id);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ---------------------------
    // 3️⃣ PREVENT MULTIPLE TIPS
    // ---------------------------
    const alreadyTipped = target.tips?.some(
      (t) => t.fromUserId.toString() === sender._id.toString()
    );

    if (alreadyTipped) {
      return res.status(400).json({
        success: false,
        message: "You already tipped this comment",
      });
    }

    // ---------------------------
    // 4️⃣ BALANCE CHECK
    // ---------------------------
    if (sender.accountBalance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
      });
    }

    const isSelfCommentTip = sender._id.toString() === target.userId.toString();
    if (isSelfCommentTip) {
      sender.totalTipped = (sender.totalTipped || 0) + amount;
      sender.totalEarned = (sender.totalEarned || 0) + amount;
      await sender.save();
    } else {
      sender.accountBalance -= amount;
      sender.totalTipped = (sender.totalTipped || 0) + amount;
      await sender.save();

      await User.findByIdAndUpdate(target.userId, {
        $inc: {
          accountBalance: amount,
          totalEarned: amount,
        },
      });
    }

    // ---------------------------
    // 5️⃣ ADD TIP
    // ---------------------------
    target.tips.push({
      postId: post._id,
      fromUserId: sender._id,
      fromUsername: sender.username,
      toUserId: target.userId,
      toUsername: target.commentAuthor || (targetAuthor ? targetAuthor.username : "Author"),
      amount,
      currency: currency || "NGN",
      status: "completed",
      createdAt: new Date(),
    });

    target.totalTips = (target.totalTips || 0) + amount;

    await post.save();

    // ---------------------------
    // 6️⃣ CREATE NOTIFICATION
    // ---------------------------
    if (sender._id.toString() !== target.userId.toString()) {
      await createNotification({
        userId: target.userId, // RECEIVER
        type: "comment-tip",
        postId: post._id,
        commentId: target._id,
        fromUserId: sender._id,
        fromUsername: sender.username,
        fromProfilePicture: sender.profilePicture,
        message: `${sender.username} tipped your comment ₦${amount.toLocaleString()} (credited to your wallet)`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Comment tipped ₦${amount.toLocaleString()} successfully!`,
      post,
      newSenderBalance: sender.accountBalance,
    });

  } catch (err) {
    console.error("TipComment Error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error tipping comment",
    });
  }
};

// GET random posts
export const getRandomPosts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const count = await Post.countDocuments({ isArchived: { $ne: true } });
    const random = Math.floor(Math.random() * Math.max(0, count - limit));

    const posts = await Post.find({ isArchived: { $ne: true } })
      .skip(random)
      .limit(limit)
      .populate("userId", "username email")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, posts });
  } catch (err) {
    console.error("GetRandomPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching random posts" });
  }
};

// GET all posts by a specific username
export const getPostsByUsername = async (req, res) => {
  try {
    const { username } = req.params;

    // 1️⃣ Find the user
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 2️⃣ Find the public (non-archived) posts by this user
    const posts = await Post.find({ userId: user._id, isArchived: { $ne: true } })
      .populate("userId", "username email profilePicture verified verificationExpiresAt")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      posts,
    });
  } catch (err) {
    console.error("getPostsByUsername Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error fetching user posts",
    });
  }
};
// GET posts from users the current user follows
export const getFollowingPosts = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ success: false, message: "User not found" });

    // Get list of followed user IDs
    const followingIds = currentUser.following;

    // Find non-archived posts where userId is in the following list
    const posts = await Post.find({ userId: { $in: followingIds }, isArchived: { $ne: true } })
      .populate("userId", "username email profilePicture verified verificationExpiresAt")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, posts });
  } catch (err) {
    console.error("GetFollowingPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching following posts" });
  }
};
// TOGGLE LIKE POST
export const likePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    // Ensure likes exists
    if (!post.likes) post.likes = [];

    const isLiked = post.likes.some((uid) => uid.toString() === userId.toString());

    if (isLiked) {
      // Unlike
      post.likes = post.likes.filter((uid) => uid.toString() !== userId.toString());
    } else {
      // Like
      post.likes.push(userId);

      // Notify post author (if not self)
      if (post.userId.toString() !== userId.toString()) {
        try {
          await createNotification({
            userId: post.userId,
            type: "like",
            postId: post._id,
            fromUserId: userId,
            fromUsername: req.user.username,
            fromProfilePicture: req.user.profilePicture, // ensure this user obj has profilePicture
            message: `${req.user.username} liked your post`
          });
        } catch (notifErr) {
          console.error("Failed to send notification:", notifErr);
        }
      }
    }

    await post.save();

    res.status(200).json({ success: true, message: isLiked ? "Unliked" : "Liked", likes: post.likes });

  } catch (err) {
    console.error("LikePost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error toggling like" });
  }
};

// TOGGLE REBLOG / RESHARE POST
export const reblogPost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    if (!post.reblogs) post.reblogs = [];

    const isReblogged = post.reblogs.some((uid) => uid.toString() === userId.toString());

    if (isReblogged) {
      post.reblogs = post.reblogs.filter((uid) => uid.toString() !== userId.toString());
      await User.findByIdAndUpdate(userId, { $pull: { rebloggedPosts: post._id } });
    } else {
      post.reblogs.push(userId);
      await User.findByIdAndUpdate(userId, { $addToSet: { rebloggedPosts: post._id } });

      // Notify post author (if not self)
      if (post.userId.toString() !== userId.toString()) {
        try {
          await createNotification({
            userId: post.userId,
            type: "reblog",
            postId: post._id,
            fromUserId: userId,
            fromUsername: req.user.username,
            fromProfilePicture: req.user.profilePicture,
            message: `${req.user.username} reblogged your post`
          });
        } catch (notifErr) {
          console.error("Failed to send reblog notification:", notifErr);
        }
      }
    }

    await post.save();

    res.status(200).json({
      success: true,
      message: isReblogged ? "Removed reblog" : "Reblogged post",
      reblogs: post.reblogs
    });
  } catch (err) {
    console.error("ReblogPost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error toggling reblog" });
  }
};

// TOGGLE SAVE / BOOKMARK POST
export const savePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    if (!post.saves) post.saves = [];

    const isSaved = post.saves.some((uid) => uid.toString() === userId.toString());

    if (isSaved) {
      post.saves = post.saves.filter((uid) => uid.toString() !== userId.toString());
      await User.findByIdAndUpdate(userId, { $pull: { savedPosts: post._id } });
    } else {
      post.saves.push(userId);
      await User.findByIdAndUpdate(userId, { $addToSet: { savedPosts: post._id } });
    }

    await post.save();

    res.status(200).json({
      success: true,
      message: isSaved ? "Post unsaved" : "Post saved",
      saves: post.saves
    });
  } catch (err) {
    console.error("SavePost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error toggling save" });
  }
};

// GET USER'S REBLOGGED POSTS
export const getRebloggedPosts = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).populate({
      path: "rebloggedPosts",
      populate: { path: "userId", select: "username email profilePicture" }
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, posts: user.rebloggedPosts || [] });
  } catch (err) {
    console.error("GetRebloggedPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching reblogged posts" });
  }
};

// GET USER'S SAVED POSTS (Private to active user)
export const getSavedPosts = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: "savedPosts",
      populate: { path: "userId", select: "username email profilePicture" }
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, posts: user.savedPosts || [] });
  } catch (err) {
    console.error("GetSavedPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching saved posts" });
  }
};

// 🔗 RECORD POST SHARE
export const recordPostShare = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findByIdAndUpdate(
      id,
      { $inc: { shares: 1 } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    res.status(200).json({
      success: true,
      shares: post.shares || 0
    });
  } catch (err) {
    console.error("recordPostShare Error:", err.message);
    res.status(500).json({ success: false, message: "Server error recording share" });
  }
};

// 👤 RECORD PROFILE VISIT ATTRIBUTED TO POST
export const recordProfileVisit = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findByIdAndUpdate(
      id,
      { $inc: { profileVisits: 1 } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    res.status(200).json({
      success: true,
      profileVisits: post.profileVisits || 0
    });
  } catch (err) {
    console.error("recordProfileVisit Error:", err.message);
    res.status(500).json({ success: false, message: "Server error recording profile visit" });
  }
};

// 📊 GET POST-LEVEL INSIGHTS (Author Only)
export const getPostInsights = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.user.id;

    const post = await Post.findById(id).populate("userId", "username profilePicture");
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const postAuthorId = (post.userId?._id || post.userId)?.toString();
    if (postAuthorId !== requesterId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only the post author can view performance insights"
      });
    }

    const totalViews = post.views || 0;
    const uniqueViewers = Array.isArray(post.viewedBy) ? post.viewedBy.length : 0;
    const totalCompletions = post.completions || 0;
    const completionRate = totalViews > 0
      ? Math.min(100, Math.round((totalCompletions / totalViews) * 100))
      : 0;

    const totalTipsNGN = Array.isArray(post.tips)
      ? post.tips.reduce((acc, t) => acc + (t.currency === "NGN" ? (Number(t.amount) || 0) : 0), 0)
      : (post.totalTips || 0);

    const totalTipsUSDT = Array.isArray(post.tips)
      ? post.tips.reduce((acc, t) => acc + (t.currency === "USDT" ? (Number(t.amount) || 0) : 0), 0)
      : 0;

    const totalTipsBTC = Array.isArray(post.tips)
      ? post.tips.reduce((acc, t) => acc + (t.currency === "BTC" ? (Number(t.amount) || 0) : 0), 0)
      : 0;

    // Build tip transactions list sorted latest first
    const tipTransactions = Array.isArray(post.tips)
      ? [...post.tips].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      : [];

    const likesCount = Array.isArray(post.likes) ? post.likes.length : 0;
    const commentsCount = Array.isArray(post.comments) ? post.comments.length : 0;
    const reblogsCount = Array.isArray(post.reblogs) ? post.reblogs.length : 0;
    const savesCount = Array.isArray(post.saves) ? post.saves.length : 0;
    const sharesCount = post.shares || 0;
    const totalWatchSeconds = post.totalWatchSeconds || 0;

    // Engagement Rate = (likes + comments + saves + shares + reblogs) / views
    const totalEngagements = likesCount + commentsCount + savesCount + sharesCount + reblogsCount;
    const engagementRate = totalViews > 0
      ? Math.min(100, Math.round((totalEngagements / totalViews) * 1000) / 10)
      : 0;

    res.status(200).json({
      success: true,
      insights: {
        postId: post._id,
        title: post.title || "",
        createdAt: post.createdAt,
        totalViews,
        uniqueViewers,
        completions: totalCompletions,
        completionRate,
        totalWatchSeconds,
        averageWatchSeconds: totalViews > 0 ? Math.round(totalWatchSeconds / totalViews) : 0,
        totalTipsNGN,
        totalTipsUSDT,
        totalTipsBTC,
        tipTransactions,
        likesCount,
        commentsCount,
        reblogsCount,
        savesCount,
        sharesCount,
        profileVisits: post.profileVisits || 0,
        followsEarned: Array.isArray(post.followsEarned) ? post.followsEarned.length : 0,
        engagementRate
      }
    });
  } catch (err) {
    console.error("getPostInsights Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching post insights" });
  }
};

// 📈 GET CREATOR STUDIO ANALYTICS (/creator-hub)
export const getCreatorStudioAnalytics = async (req, res) => {
  try {
    const creatorId = req.user.id;
    const timeRange = req.query.range === "30d" ? 30 : 7; // 7d (default) or 30d

    const creator = await User.findById(creatorId);
    if (!creator) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - timeRange * 24 * 60 * 60 * 1000);

    // Fetch all posts authored by this creator
    const creatorPosts = await Post.find({ userId: creatorId });

    let totalViews = 0;
    let totalUniqueViewers = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalSaves = 0;
    let totalShares = 0;
    let totalReblogs = 0;
    let totalCompletions = 0;
    let totalTipsNGN = 0;
    let totalTipsUSDT = 0;
    let totalTipsBTC = 0;

    // Daily breakdown buckets for earnings & views graph
    const dailyMap = {};
    for (let i = 0; i < timeRange; i++) {
      const d = new Date(now.getTime() - (timeRange - 1 - i) * 24 * 60 * 60 * 1000);
      const dayKey = d.toISOString().split("T")[0]; // YYYY-MM-DD
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      dailyMap[dayKey] = {
        date: dayKey,
        label,
        earningsNGN: 0,
        views: 0,
        tipsCount: 0
      };
    }

    // Top tipping supporters accumulator
    const supportersMap = new Map();

    creatorPosts.forEach((post) => {
      totalViews += post.views || 0;
      totalUniqueViewers += Array.isArray(post.viewedBy) ? post.viewedBy.length : 0;
      totalLikes += Array.isArray(post.likes) ? post.likes.length : 0;
      totalComments += Array.isArray(post.comments) ? post.comments.length : 0;
      totalSaves += Array.isArray(post.saves) ? post.saves.length : 0;
      totalShares += post.shares || 0;
      totalReblogs += Array.isArray(post.reblogs) ? post.reblogs.length : 0;
      totalCompletions += post.completions || 0;

      // Views bucket distribution (approximate across creation/update window)
      const postDate = new Date(post.createdAt).toISOString().split("T")[0];
      if (dailyMap[postDate]) {
        dailyMap[postDate].views += Math.max(1, Math.round((post.views || 0) / (timeRange || 1)));
      }

      // Tips processing
      if (Array.isArray(post.tips)) {
        post.tips.forEach((tip) => {
          const tipAmt = Number(tip.amount) || 0;
          const curr = tip.currency || "NGN";

          if (curr === "NGN") totalTipsNGN += tipAmt;
          else if (curr === "USDT") totalTipsUSDT += tipAmt;
          else if (curr === "BTC") totalTipsBTC += tipAmt;

          // Check if tip date falls in selected range
          const tipDate = tip.createdAt ? new Date(tip.createdAt) : null;
          if (tipDate && tipDate >= startDate) {
            const tipDayKey = tipDate.toISOString().split("T")[0];
            if (dailyMap[tipDayKey] && curr === "NGN") {
              dailyMap[tipDayKey].earningsNGN += tipAmt;
              dailyMap[tipDayKey].tipsCount += 1;
            }
          }

          // Aggregate top tipping supporters
          const supporterKey = tip.fromUserId
            ? tip.fromUserId.toString()
            : (tip.fromUsername || "Anonymous");

          if (!supportersMap.has(supporterKey)) {
            supportersMap.set(supporterKey, {
              userId: tip.fromUserId,
              username: tip.fromUsername || "Anonymous",
              totalNGN: 0,
              totalUSDT: 0,
              totalBTC: 0,
              tipsCount: 0,
              lastTippedAt: tip.createdAt
            });
          }

          const s = supportersMap.get(supporterKey);
          s.tipsCount += 1;
          if (curr === "NGN") s.totalNGN += tipAmt;
          else if (curr === "USDT") s.totalUSDT += tipAmt;
          else if (curr === "BTC") s.totalBTC += tipAmt;

          if (tip.createdAt && (!s.lastTippedAt || new Date(tip.createdAt) > new Date(s.lastTippedAt))) {
            s.lastTippedAt = tip.createdAt;
          }
        });
      }
    });

    // Populate supporter profile pictures
    const topSupportersList = Array.from(supportersMap.values())
      .sort((a, b) => b.totalNGN - a.totalNGN)
      .slice(0, 10);

    const userIdsToFetch = topSupportersList
      .map((s) => s.userId)
      .filter(Boolean);

    if (userIdsToFetch.length > 0) {
      const userDocs = await User.find({ _id: { $in: userIdsToFetch } })
        .select("username profilePicture verified");
      const userMap = new Map();
      userDocs.forEach((u) => userMap.set(u._id.toString(), u));

      topSupportersList.forEach((s) => {
        if (s.userId && userMap.has(s.userId.toString())) {
          const found = userMap.get(s.userId.toString());
          s.profilePicture = found.profilePicture;
          s.verified = found.verified;
          s.username = found.username;
        }
      });
    }

    // All Creator Posts mapped with complete post-level metrics
    const mappedCreatorPosts = [...creatorPosts]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((p) => {
        const views = p.views || 0;
        const completions = p.completions || 0;
        const completionRate = views > 0 ? Math.min(100, Math.round((completions / views) * 100)) : 0;
        const imgMedia = p.media?.find((m) => m.type === "image");
        const vidMedia = p.media?.find((m) => m.type === "video");
        const firstMedia = imgMedia || vidMedia || p.media?.[0];

        return {
          _id: p._id,
          title: p.title || p.body?.substring(0, 50) || "Untitled Post",
          body: p.body || "",
          media: p.media || [],
          thumbnail: firstMedia?.url || null,
          mediaType: firstMedia?.type || "text",
          views,
          completions,
          completionRate,
          totalWatchSeconds: p.totalWatchSeconds || 0,
          likes: p.likes?.length || 0,
          tips: p.totalTips || 0,
          comments: p.comments?.length || 0,
          shares: p.shares || 0,
          saves: p.saves?.length || 0,
          profileVisits: p.profileVisits || 0,
          followsEarned: Array.isArray(p.followsEarned) ? p.followsEarned.length : 0,
          createdAt: p.createdAt
        };
      });

    // Top Performing Posts ranked by totalTips then views
    const topPerformingPosts = [...mappedCreatorPosts]
      .sort((a, b) => (b.tips || 0) - (a.tips || 0) || (b.views || 0) - (a.views || 0))
      .slice(0, 6);

    // Follower velocity stats
    const followerCount = creator.followersCount || creator.followers?.length || 0;
    const followingCount = creator.followingCount || creator.following?.length || 0;

    // Overall Completion rate
    const overallCompletionRate = totalViews > 0
      ? Math.min(100, Math.round((totalCompletions / totalViews) * 100))
      : 0;

    res.status(200).json({
      success: true,
      timeRange: `${timeRange}d`,
      overview: {
        totalEarningsNGN: creator.totalEarned || totalTipsNGN,
        accountBalanceNGN: creator.accountBalance || 0,
        totalTipsNGN,
        totalTipsUSDT,
        totalTipsBTC,
        totalPosts: creatorPosts.length,
        totalViews,
        totalUniqueViewers,
        overallCompletionRate,
        totalLikes,
        totalComments,
        totalSaves,
        totalShares,
        totalReblogs,
        followerCount,
        followingCount
      },
      chartData: Object.values(dailyMap),
      topSupporters: topSupportersList,
      topPosts: topPerformingPosts,
      allPosts: mappedCreatorPosts
    });
  } catch (err) {
    console.error("getCreatorStudioAnalytics Error:", err.message);
    res.status(500).json({ success: false, message: "Server error generating creator analytics" });
  }
};

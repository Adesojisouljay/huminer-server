import Post from "../models/Post.js";
import User from "../models/User.js";
import { createNotification } from "../helpers/index.js";

// CREATE a new post
export const createPost = async (req, res) => {
  try {
    const { title, body, media, tags } = req.body;
    console.log({ title, body, media, tags })

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

    const newPost = new Post({
      title,
      body,
      media: Array.isArray(media) ? media : [], // must match schema shape
      userId: req.user.id,        // from authMiddleware
      author: req.user.username, // cached for faster queries
      tags: mergedTags,
      payoutAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      totalTips: 0,
    });

    const savedPost = await newPost.save();
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
    const query = {
      isArchived: { $ne: true },
      ...(tag ? { tags: tag.toLowerCase() } : {})
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
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
      { $project: { tag: "$_id", count: 1, _id: 0 } }
    ]);

    res.status(200).json({ success: true, tags: stats });
  } catch (err) {
    console.error("GetTrendingTags Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching hashtags" });
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
  } else if (videoMedia?.url) {
    // Cloudinary or similar thumbnail extraction if applicable
    if (videoMedia.url.includes("/upload/")) {
      imageUrl = videoMedia.url.replace(/\.[^/.]+$/, ".jpg");
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
    const { userId } = req.body;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // 1. Author's own views NEVER count
    const postAuthorId = (post.userId?._id || post.userId)?.toString();
    if (userId && postAuthorId && postAuthorId === userId.toString()) {
      return res.status(200).json({ success: true, views: post.views || 0, isAuthor: true });
    }

    // 2. Ensure viewedBy and views are initialized
    if (!Array.isArray(post.viewedBy)) {
      post.viewedBy = [];
    }
    if (typeof post.views !== "number") {
      post.views = 0;
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

        // If viewed within cooldown period, ignore and do not increment
        if (Date.now() - lastViewedAt < VIEW_COOLDOWN_MS) {
          return res.status(200).json({
            success: true,
            views: post.views,
            cooldown: true,
            remainingSeconds: Math.ceil((VIEW_COOLDOWN_MS - (Date.now() - lastViewedAt)) / 1000)
          });
        }

        // Cooldown passed: record fresh view and update timestamp
        post.viewedBy[viewerIndex] = {
          userId,
          lastViewedAt: now
        };
        post.views += 1;
        await post.save();
      } else {
        // First view by this user
        post.viewedBy.push({
          userId,
          lastViewedAt: now
        });
        post.views += 1;
        await post.save();
      }
    } else {
      // Unauthenticated viewer
      post.views += 1;
      await post.save();
    }

    res.status(200).json({ success: true, views: post.views });
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

      // Notify the post owner (if the commenter is not the post owner)
      if (sender.id !== post.userId.toString()) {
        await createNotification({
          userId: post.userId,
          type: "comment",
          postId,
          fromUserId: sender.id,
          fromUsername: sender.username,
          fromProfilePicture: sender.profilePicture,
          message: `${sender.username} commented on your post`,
        });
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

    // ------------------------------
    // Create notification to the user
    // ------------------------------
    if (sender.id !== targetComment.userId.toString()) {
      await createNotification({
        userId: targetComment.userId,      // recipient
        type: "reply",
        postId,
        commentId: targetComment._id,
        fromUserId: sender.id,
        fromUsername: sender.username,
        message: `${sender.username} replied to your comment: "${replyText}"`,
      });
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

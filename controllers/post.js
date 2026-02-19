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

    const newPost = new Post({
      title,
      body,
      media: Array.isArray(media) ? media : [], // must match schema shape
      userId: req.user.id,        // from authMiddleware
      author: req.user.username, // cached for faster queries
      tags: tags || [],
    });

    const savedPost = await newPost.save();
    res.status(201).json({ success: true, post: savedPost });
  } catch (err) {
    console.error("CreatePost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error creating post" });
  }
};

// GET all posts (feed)
export const getPosts = async (req, res) => {
  try {
    const posts = await Post.find()
      .populate("userId", "username email") // in case you want live user info
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, posts });
  } catch (err) {
    console.error("GetPosts Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching posts" });
  }
};

// GET single post by ID
export const getPostById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("userId", "username email")
      .populate("comments.userId", "username email");

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    res.status(200).json({ success: true, post });
  } catch (err) {
    console.error("GetPostById Error:", err.message);
    res.status(500).json({ success: false, message: "Server error fetching post" });
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

// TIP a post
export const tipPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { amount, currency } = req.body;

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Tip amount must be greater than 0" });
    }

    const post = await Post.findById(postId).populate("userId");
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

    // 🔍 Prevent tipping the same post twice
    const alreadyTipped = post.tips?.some(
      (tip) => tip.fromUserId.toString() === sender._id.toString()
    );

    if (alreadyTipped) {
      return res.status(400).json({
        success: false,
        message: "You have already tipped this post.",
      });
    }

    // 💰 Check sender balance
    if (sender.accountBalance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance" });
    }

    // 💸 Deduct from sender
    sender.accountBalance -= amount;
    await sender.save();

    // 💾 Add tip to post
    post.tips.push({
      postId: post._id,
      fromUserId: sender._id,
      fromUsername: sender.username,
      toUserId: post.userId,
      toUsername: post.author,
      amount,
      currency,
      status: "pending",
      releaseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    post.totalTips += amount;
    await post.save();

    // 🛎️ CREATE NOTIFICATION FOR POST OWNER
    await createNotification({
      userId: post.userId._id,   // recipient (post author)
      type: "post-tip",
      postId: post._id,
      commentId: null,
      fromUserId: sender._id,
      fromUsername: sender.username,
      fromProfilePicture: sender.profilePicture,
      message: `${sender.username} tipped your post ₦${amount}`,
    });

    return res.status(200).json({
      success: true,
      message: "Post tipped successfully (pending payout)",
      post,
    });

  } catch (err) {
    console.error("TipPost Error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Server error tipping post" });
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

    sender.accountBalance -= amount;
    await sender.save();

    const targetAuthor = await User.findById(target.userId);

    // ---------------------------
    // 5️⃣ ADD TIP
    // ---------------------------
    target.tips.push({
      postId: post._id,
      fromUserId: sender._id,
      fromUsername: sender.username,
      toUserId: target.userId,
      toUsername: target.commentAuthor || targetAuthor.username,
      amount,
      currency,
      status: "pending",
      createdAt: new Date(),
    });

    target.totalTips += amount;

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
        message: `${sender.username} tipped your comment ${amount} ${currency}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tip added successfully",
      post,
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

    const count = await Post.countDocuments();
    const random = Math.floor(Math.random() * Math.max(0, count - limit));

    const posts = await Post.find()
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

    // 2️⃣ Find the posts by this user
    const posts = await Post.find({ userId: user._id })
      .populate("userId", "username email profilePicture")
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

    // Find posts where userId is in the following list
    const posts = await Post.find({ userId: { $in: followingIds } })
      .populate("userId", "username email profilePicture")
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

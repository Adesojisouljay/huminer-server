import Post from "../models/Post.js";
import User from "../models/User.js";

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
      return res.status(400).json({ success: false, message: "Tip amount must be greater than 0" });
    }

    const post = await Post.findById(postId).populate("userId");
    console.log("post........", post)
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const sender = await User.findById(req.user.id);
    console.log("sender.......",sender)
    if (!sender) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ✅ Check if user already tipped this post
    const alreadyTipped = post.tips.some(
      (tip) => tip.fromUserId.toString() === sender._id.toString()
    );
    if (alreadyTipped) {
      return res.status(400).json({
        success: false,
        message: "You have already tipped this post.",
      });
    }

    // ✅ Check balance
    if (sender.accountBalance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    // ✅ Deduct from sender immediately
    sender.accountBalance -= amount;
    await sender.save();

    // ✅ Add tip to post as "pending"
    post.tips.push({
      postId: post._id,
      fromUserId: sender._id,
      fromUsername: sender.username,
      toUserId: post.userId,
      toUsername: post.author,
      amount,
      currency,
      status: "pending",
      releaseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    post.totalTips += amount;
    await post.save();

    res.status(200).json({
      success: true,
      message: "Post tipped successfully (pending payout)",
      post,
    });
  } catch (err) {
    console.error("TipPost Error:", err.message);
    res.status(500).json({ success: false, message: "Server error tipping post" });
  }
};

  // ADD a comment to a post
// export const addComment = async (req, res) => {
//     try {
//       const { postId } = req.params;
//       const { content, replyTo } = req.body;
//       console.log(req.user)
  
//       if (!content) {
//         return res.status(400).json({ success: false, message: "Comment content is required" });
//       }
  
//       const post = await Post.findById(postId);
//       if (!post) {
//         return res.status(404).json({ success: false, message: "Post not found" });
//       }
  
//       const newComment = {
//         postId,
//         userId: req.user.id,
//         commentAuthor: req.user.username,
//         parentAuthor: post.author,
//         content,
//         replyTo: replyTo || null
//       };
  
//       post.comments.push(newComment);
//       await post.save();
  
//       res.status(201).json({ success: true, message: "Comment added", post });
//     } catch (err) {
//       console.error("AddComment Error:", err.message);
//       res.status(500).json({ success: false, message: "Server error adding comment" });
//     }
//   };

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, replyTo } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, message: "Comment content is required" });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // If no replyTo → this is a main parent comment
    if (!replyTo) {
      const newComment = {
        postId,
        userId: req.user.id,
        commentAuthor: req.user.username,
        parentAuthor: null,        // No parent
        content,
        replyTo: null,
        children: []
      };

      post.comments.push(newComment);
      await post.save();
      return res.status(201).json({ success: true, post });
    }

    // If replyTo exists → find the main parent comment
    const parentComment = post.comments.id(replyTo) 
                       || post.comments.find(c => c.children?.id(replyTo));

    if (!parentComment) {
      return res.status(404).json({ success: false, message: "Comment being replied to not found" });
    }

    // Identify the REAL comment being replied to
    const target =
      parentComment._id.toString() === replyTo
        ? parentComment
        : parentComment.children.id(replyTo);

    const newReply = {
      postId,
      userId: req.user.id,
      commentAuthor: req.user.username,
      parentAuthor: target?.commentAuthor || null,
      content,
      replyTo,
      children: [] // still allowed if needed later
    };

    // ALWAYS push replies into the MAIN comment.children array
    parentComment.children.push(newReply);

    await post.save();

    res.status(201).json({ success: true, post });

  } catch (err) {
    console.error("AddComment Error:", err.message);
    res.status(500).json({ success: false, message: "Server error adding comment" });
  }
};


  // TIP a comment
// TIP a comment
export const tipComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { amount, currency } = req.body;

    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Tip amount must be greater than 0" });
    }

    const post = await Post.findById(postId).populate("userId"); // populate post author
    if (!post) {
      return res
        .status(404)
        .json({ success: false, message: "Post not found" });
    }

    // Find comment inside post
    const comment = post.comments.id(commentId);
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    const sender = await User.findById(req.user.id);
    if (!sender) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // ✅ Prevent tipping your own comment
    if (comment.userId.toString() === sender._id.toString()) {
      return res
        .status(400)
        .json({ success: false, message: "You cannot tip your own comment" });
    }

    // ✅ Check if user already tipped this comment
    const alreadyTipped = comment.tips.some(
      (tip) => tip.fromUserId.toString() === sender._id.toString()
    );
    if (alreadyTipped) {
      return res.status(400).json({
        success: false,
        message: "You have already tipped this comment.",
      });
    }

    // ✅ Check balance
    if (sender.accountBalance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance" });
    }

    // ✅ Deduct from sender immediately
    sender.accountBalance -= amount;
    await sender.save();

    // ✅ Find comment author
    const commentAuthor = await User.findById(comment.userId);
    if (!commentAuthor) {
      return res
        .status(404)
        .json({ success: false, message: "Comment author not found" });
    }

    // ✅ Add tip to comment (pending)
    comment.tips.push({
      postId: post._id,
      fromUserId: sender._id,
      fromUsername: sender.username,
      toUserId: comment.userId,
      toUsername: comment.commentAuthor || commentAuthor.username,
      amount,
      currency,
      status: "pending",
      createdAt: new Date(),
    });

    comment.totalTips += amount;

    await post.save();

    res.status(200).json({
      success: true,
      message: "Comment tipped successfully (pending payout)",
      post,
    });
  } catch (err) {
    console.error("TipComment Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Server error tipping comment" });
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

  
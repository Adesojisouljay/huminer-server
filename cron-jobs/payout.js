import Post from "../models/Post.js";
import User from "../models/User.js";

export const runPayoutProcessor = async () => {
  try {
    const now = new Date();

    console.log("⏳ Running payout processor...");

    // 1️⃣ Handle POSTS
    const duePosts = await Post.find({
      payoutAt: { $lte: now },
      isPaidOut: false
    });

    for (const post of duePosts) {
      const author = await User.findById(post.userId);

      if (author && post.totalTips > 0) {
        author.pendingRewards += post.totalTips;

        author.pendingBreakdown.push({
          sourceId: post._id,
          sourceType: "post",
          amount: post.totalTips,
          currency: "NGN",
        });

        await author.save();
      }

      post.isPaidOut = true;
      await post.save();
    }

    // 2️⃣ Handle COMMENTS + REPLIES
    const allPosts = await Post.find();

    for (const post of allPosts) {
      let postModified = false;

      for (const comment of post.comments) {
        
        // COMMENT PAYOUT
        if (!comment.isPaidOut && comment.payoutAt && new Date(comment.payoutAt) <= now) {
          const author = await User.findById(comment.userId);

          if (author && comment.totalTips > 0) {
            author.pendingRewards += comment.totalTips;
            author.pendingBreakdown.push({
              sourceId: comment._id,
              sourceType: "comment",
              amount: comment.totalTips,
              currency: "NGN",
            });
            await author.save();
          }

          comment.isPaidOut = true;
          postModified = true;
        }

        // REPLY PAYOUT
        for (const reply of comment.children) {
          if (!reply.isPaidOut && reply.payoutAt && new Date(reply.payoutAt) <= now) {
            const replyOwner = await User.findById(reply.userId);

            if (replyOwner && reply.totalTips > 0) {
              replyOwner.pendingRewards += reply.totalTips;
              replyOwner.pendingBreakdown.push({
                sourceId: reply._id,
                sourceType: "reply",
                amount: reply.totalTips,
                currency: "NGN",
              });
              await replyOwner.save();
            }

            reply.isPaidOut = true;
            postModified = true;
          }
        }
      }

      if (postModified) {
        await post.save();
      }
    }

    console.log("✅ Payout processor finished", new Date().toISOString());

  } catch (error) {
    console.error("❌ Payout Processor Error:", error);
  }
};

export const runPayoutRecovery = async () => {
  try {
    const now = new Date();

    console.log("🔍 Running payout recovery scan...");

    const allPosts = await Post.find();

    for (const post of allPosts) {

      // POST RECOVERY
      if (!post.isPaidOut && post.payoutAt <= now) {
        const author = await User.findById(post.userId);

        if (author && post.totalTips > 0) {
          author.pendingRewards += post.totalTips;
          author.pendingBreakdown.push({
            sourceId: post._id,
            sourceType: "post",
            amount: post.totalTips,
            currency: "NGN",
            recovered: true     // Marks it came from recovery
          });

          await author.save();
        }

        post.isPaidOut = true;
        await post.save();
      }

      // COMMENT + REPLY RECOVERY
      for (const comment of post.comments) {

        // COMMENT
        if (!comment.isPaidOut && comment.payoutAt <= now) {
          const commentOwner = await User.findById(comment.userId);

          if (commentOwner && comment.totalTips > 0) {
            commentOwner.pendingRewards += comment.totalTips;

            commentOwner.pendingBreakdown.push({
              sourceId: comment._id,
              sourceType: "comment",
              amount: comment.totalTips,
              currency: "NGN",
              recovered: true
            });

            await commentOwner.save();
          }

          comment.isPaidOut = true;
        }

        // REPLIES
        for (const reply of comment.children) {
          if (!reply.isPaidOut && reply.payoutAt <= now) {
            const replyOwner = await User.findById(reply.userId);

            if (replyOwner && reply.totalTips > 0) {
              replyOwner.pendingRewards += reply.totalTips;

              replyOwner.pendingBreakdown.push({
                sourceId: reply._id,
                sourceType: "reply",
                amount: reply.totalTips,
                currency: "NGN",
                recovered: true
              });

              await replyOwner.save();
            }

            reply.isPaidOut = true;
          }
        }
      }

      await post.save();
    }

    console.log("✔ Recovery scan completed", new Date().toISOString());

  } catch (err) {
    console.error("🔥 Payout Recovery Error", err);
  }
};

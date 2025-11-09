import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken"

// Register a new user
export const registerUser = async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;
    console.log(req.body)

    // Check required fields
    if (!username || !email || !password) {
      return res.status(400).json({ message: "Username, email and password are required." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ message: "Username or email already taken." });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      fullName,
    });

    // Respond without sending password
    const { password: _, ...userData } = newUser.toObject();
    res.status(201).json({ message: "User registered successfully", user: userData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ message: "Email/Username and password are required." });
    }

    // Find user by email or username
    const user = await User.findOne({
      $or: [{ email: emailOrUsername }, { username: emailOrUsername }]
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials." });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials." });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Return user data without password
    const { password: _, ...userData } = user.toObject();

    res.status(200).json({
      message: "Login successful",
      user: userData,
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password"); // exclude password
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// PUT /users/:id → update profile
export const updateUserProfile = async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 NEW: GET ALL USERS
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 NEW: GET RANDOM USERS
export const getRandomUsers = async (req, res) => {
  console.log("limit")
  try {
    const limit = parseInt(req.query.limit) || 5; // Default 5 users
    console.log(limit)
    const randomUsers = await User.aggregate([
      { $sample: { size: limit } },
      { $project: { password: 0 } },
    ]);
    res.json(randomUsers);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const followUser = async (req, res) => {
  try {
    const { id } = req.user; // logged-in user
    const { userId } = req.params; // user to follow

    const userToFollow = await User.findById(userId);
    console.log("usertfoll.......", userToFollow, userId, id)
    const currentUser = await User.findById(id);

    if (!userToFollow) return res.status(404).json({ message: "User not found" });

    if (!currentUser.following.includes(userId)) {
      currentUser.following.push(userId);
      currentUser.followingCount += 1;
      userToFollow.followers.push(id);
      userToFollow.followersCount += 1;

      await currentUser.save();
      await userToFollow.save();
    }

    const updatedUser = await User.findById(id).select("-password");
    res.status(200).json({ message: "Followed successfully", updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const unfollowUser = async (req, res) => {
  try {
    const { id } = req.user;
    const { userId } = req.params;

    const userToUnfollow = await User.findById(userId);
    const currentUser = await User.findById(id);

    if (!userToUnfollow) return res.status(404).json({ message: "User not found" });

    if (currentUser.following.includes(userId)) {
      currentUser.following = currentUser.following.filter((uid) => uid.toString() !== userId);
      currentUser.followingCount -= 1;
      userToUnfollow.followers = userToUnfollow.followers.filter((uid) => uid.toString() !== id);
      userToUnfollow.followersCount -= 1;

      await currentUser.save();
      await userToUnfollow.save();
    }

    const updatedUser = await User.findById(id).select("-password");
    res.status(200).json({ message: "Unfollowed successfully", updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 FOLLOW a user
// export const followUser = async (req, res) => {
//   try {
//     const targetUserId = req.params.id; // The person to follow
//     const currentUserId = req.user.id;  // Logged-in user (from auth middleware)

//     if (targetUserId === currentUserId) {
//       return res.status(400).json({ message: "You cannot follow yourself." });
//     }

//     const targetUser = await User.findById(targetUserId);
//     const currentUser = await User.findById(currentUserId);

//     if (!targetUser || !currentUser) {
//       return res.status(404).json({ message: "User not found." });
//     }

//     // Check if already following
//     if (currentUser.following.includes(targetUserId)) {
//       return res.status(400).json({ message: "You are already following this user." });
//     }

//     // Add to following/followers
//     currentUser.following.push(targetUserId);
//     targetUser.followers.push(currentUserId);

//     // Update counts
//     currentUser.followingCount = currentUser.following.length;
//     targetUser.followersCount = targetUser.followers.length;

//     await currentUser.save();
//     await targetUser.save();

//     res.status(200).json({ message: "User followed successfully." });
//   } catch (error) {
//     console.error("FollowUser Error:", error.message);
//     res.status(500).json({ message: "Server error following user." });
//   }
// };

// 🔴 UNFOLLOW a user
// export const unfollowUser = async (req, res) => {
//   try {
//     const targetUserId = req.params.id;
//     const currentUserId = req.user.id;

//     if (targetUserId === currentUserId) {
//       return res.status(400).json({ message: "You cannot unfollow yourself." });
//     }

//     const targetUser = await User.findById(targetUserId);
//     const currentUser = await User.findById(currentUserId);

//     if (!targetUser || !currentUser) {
//       return res.status(404).json({ message: "User not found." });
//     }

//     // Check if not following
//     if (!currentUser.following.includes(targetUserId)) {
//       return res.status(400).json({ message: "You are not following this user." });
//     }

//     // Remove from following/followers
//     currentUser.following = currentUser.following.filter(
//       (id) => id.toString() !== targetUserId
//     );
//     targetUser.followers = targetUser.followers.filter(
//       (id) => id.toString() !== currentUserId
//     );

//     // Update counts
//     currentUser.followingCount = currentUser.following.length;
//     targetUser.followersCount = targetUser.followers.length;

//     await currentUser.save();
//     await targetUser.save();

//     res.status(200).json({ message: "User unfollowed successfully." });
//   } catch (error) {
//     console.error("UnfollowUser Error:", error.message);
//     res.status(500).json({ message: "Server error unfollowing user." });
//   }
// };

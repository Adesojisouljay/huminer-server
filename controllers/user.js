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

export const getUserByUsername = async (req, res) => {
  try {
    const { username } = req.params;

    // Get the user by username + populate followers & following
    const user = await User.findOne({ username })
      .select("-password")
      .populate("followers", "username profilePicture")
      .populate("following", "username profilePicture");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ success: true, user });

  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

export const updateUserProfile = async (req, res) => {
  try {
    const allowedFields = [
      "fullName",
      "bio",
      "profilePicture",
      "coverPhoto",
      "dateOfBirth",
      "gender",
      "settings"
    ];
    console.log("object")

    // Prevent users from updating restricted fields
    Object.keys(req.body).forEach((key) => {
      if (!allowedFields.includes(key)) {
        delete req.body[key];
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).select("-password");

    if (!updatedUser)
      return res.status(404).json({ message: "User not found" });

    res.json({
      message: "Profile updated successfully",
      user: updatedUser
    });

  } catch (error) {
    res.status(500).json({
      message: "Error updating profile",
      error: error.message
    });
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

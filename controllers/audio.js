import AudioTrack from "../models/AudioTrack.js";
import Post from "../models/Post.js";

// Curated royalty-free tracks catalog
const SEED_CURATED_TRACKS = [
  {
    title: "Lagos Night Vibes",
    artist: "AfroBeats Collective",
    category: "afrobeat",
    duration: 32,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    coverUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop",
    isTrending: true,
    isVerified: true
  },
  {
    title: "Chill Midnight Lo-Fi",
    artist: "Huminer Beats",
    category: "lofi",
    duration: 45,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    coverUrl: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&h=300&fit=crop",
    isTrending: true,
    isVerified: true
  },
  {
    title: "Neon Cyber Funk",
    artist: "Future Wave",
    category: "electronic",
    duration: 28,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    coverUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&h=300&fit=crop",
    isTrending: true,
    isVerified: true
  },
  {
    title: "Acoustic Sunset Breeze",
    artist: "Golden Strings",
    category: "chill",
    duration: 36,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    coverUrl: "https://images.unsplash.com/photo-1445985543469-43384623c850?w=300&h=300&fit=crop",
    isTrending: false,
    isVerified: true
  },
  {
    title: "Afro Heat Grooves",
    artist: "Naija Sound Lab",
    category: "afrobeat",
    duration: 40,
    audioUrl: "https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Sevish_-__nbsp_.mp3",
    coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop",
    isTrending: true,
    isVerified: true
  },
  {
    title: "Urban Boom Bap",
    artist: "Street Rhymes",
    category: "hiphop",
    duration: 34,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    coverUrl: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=300&h=300&fit=crop",
    isTrending: false,
    isVerified: true
  }
];

// Helper to seed tracks if catalog is empty
export const ensureSeededTracks = async () => {
  try {
    const count = await AudioTrack.countDocuments({ category: { $ne: "ugc" } });
    if (count === 0) {
      await AudioTrack.insertMany(SEED_CURATED_TRACKS);
      console.log("🎵 Curated AudioTrack catalog seeded successfully.");
    }
  } catch (err) {
    console.error("AudioTrack seed error:", err.message);
  }
};

// 1. GET ALL SOUNDS (with filters, category & search)
export const getAudioTracks = async (req, res) => {
  try {
    const { category, search, trending } = req.query;
    await ensureSeededTracks();

    let query = {};
    if (category && category !== "all") {
      query.category = category;
    }
    if (trending === "true") {
      query.isTrending = true;
    }
    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: "i" } },
        { artist: { $regex: q, $options: "i" } },
        { creatorUsername: { $regex: q, $options: "i" } }
      ];
    }

    const tracks = await AudioTrack.find(query)
      .sort({ usageCount: -1, isTrending: -1, createdAt: -1 })
      .limit(60);

    res.status(200).json({ success: true, tracks });
  } catch (err) {
    console.error("getAudioTracks error:", err.message);
    res.status(500).json({ success: false, message: "Error fetching audio tracks" });
  }
};

// 2. GET SINGLE SOUND DETAILS + POSTS USING IT
export const getAudioTrackById = async (req, res) => {
  try {
    const { id } = req.params;
    const track = await AudioTrack.findById(id).populate("creatorId", "username profilePicture verified");
    if (!track) {
      return res.status(404).json({ success: false, message: "Sound track not found" });
    }

    // Find posts using this audio track
    const posts = await Post.find({
      $or: [{ audioTrackId: id }, { "media.url": track.audioUrl }],
      isArchived: { $ne: true }
    })
      .populate("userId", "username profilePicture verified")
      .sort({ views: -1, totalTips: -1, createdAt: -1 })
      .limit(40);

    res.status(200).json({
      success: true,
      track,
      postsCount: posts.length,
      posts
    });
  } catch (err) {
    console.error("getAudioTrackById error:", err.message);
    res.status(500).json({ success: false, message: "Error fetching sound track details" });
  }
};

// 3. CREATE / REGISTER UGC SOUND (or extract from uploaded post)
export const createOrLinkAudioTrack = async (req, res) => {
  try {
    const { title, artist, audioUrl, coverUrl, duration, originalPostId } = req.body;
    const userId = req.user?.id;
    const username = req.user?.username;

    if (!audioUrl) {
      return res.status(400).json({ success: false, message: "Audio URL is required" });
    }

    // Check if track already exists with this exact URL
    let existing = await AudioTrack.findOne({ audioUrl });
    if (existing) {
      return res.status(200).json({ success: true, track: existing, isExisting: true });
    }

    const newTrack = new AudioTrack({
      title: title?.trim() || `Original Audio - @${username || "user"}`,
      artist: artist?.trim() || `@${username || "user"}`,
      audioUrl,
      coverUrl: coverUrl || null,
      duration: duration || 30,
      category: "ugc",
      creatorId: userId || null,
      creatorUsername: username || null,
      originalPostId: originalPostId || null,
      usageCount: 1
    });

    await newTrack.save();
    res.status(201).json({ success: true, track: newTrack });
  } catch (err) {
    console.error("createOrLinkAudioTrack error:", err.message);
    res.status(500).json({ success: false, message: "Error registering sound track" });
  }
};

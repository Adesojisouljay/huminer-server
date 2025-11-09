import songLinkTree from "../models/songLinkTree.js";
import axios from "axios";

const ODESLI_API = "https://api.song.link/v1-alpha.1/links";

const clientUrl = process.env.ENVIRONMENT === "development" ? process.env.CLIENT_DEV_URL : process.env.CLIENT_PROD_URL

// 👉 Create a new Song LinkTree
export const createSongLinkTree = async (req, res) => {
  const { songUrl } = req.body;

  if (!songUrl) {
    return res.status(400).json({ message: "Song URL is required" });
  }

  try {
    // Fetch data from Odesli API
    const { data } = await axios.get(ODESLI_API, { params: { url: songUrl } });
    console.log(data)
    const entity = data.entitiesByUniqueId[data.entityUniqueId];

    // Create new song document
    const newSong = new songLinkTree({
      title: entity.title,
      artist: entity.artistName,
      coverArt: entity.thumbnailUrl,
      entityUniqueId: data.entityUniqueId,
      userCountry: data.userCountry,
      pageUrl: data.pageUrl,
      platforms: Object.entries(data.linksByPlatform).map(([platform, details]) => ({
        platform,
        url: details.url,
        nativeAppUriMobile: details.nativeAppUriMobile || null,
        nativeAppUriDesktop: details.nativeAppUriDesktop || null,
        country: details.country || null,
      })),
    });

    // Save and update share URL
    await newSong.save();

    console.log(newSong)

    // Manually ensure shareUrl is populated
    newSong.shareUrl = `${clientUrl}/${newSong._id}`;
    await newSong.save();

    res.status(201).json({
      message: "✅ Song link tree created successfully",
      song: newSong,
    });
  } catch (error) {
    console.error("❌ Error creating song link tree:", error.message);
    res.status(500).json({ message: "Failed to create song link tree" });
  }
};

// 👉 Get a single song by ID
export const getSongById = async (req, res) => {
  try {
    console.log("object")
    const song = await songLinkTree.findById(req.params.id);
    if (!song) return res.status(404).json({ message: "Song not found" });
    res.json(song);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch song" });
  }
};

// 👉 Get all songs (optional)
export const getAllSongs = async (req, res) => {
  try {
    const songs = await songLinkTree.find().sort({ createdAt: -1 });
    res.json(songs);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch songs" });
  }
};

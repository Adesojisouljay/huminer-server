import express from "express";
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notification.js";

const router = express.Router();

/**
 * GET all notifications for a user
 * GET /notifications/:userId
 */
router.get("/:userId", getUserNotifications);

/**
 * PUT mark a single notification as read
 * PUT /notifications/mark-read/:id
 */
router.put("/mark-read/:id", markNotificationRead);

/**
 * PUT mark ALL notifications as read
 * PUT /notifications/mark-all/:userId
 */
router.put("/mark-all/:userId", markAllNotificationsRead);

export default router;

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import * as admin from "firebase-admin";
import firebaseConfig from "./firebase-applet-config.json";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Firebase Admin
  try {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    console.log("Firebase Admin initialized");
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
  }

  app.use(express.json());

  // API Route to change user password (Admin only)
  app.post("/api/admin/change-password", async (req, res) => {
    const { uid, newPassword, adminToken } = req.body;

    if (!uid || !newPassword || !adminToken) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // Verify the admin token
      const decodedToken = await admin.auth().verifyIdToken(adminToken);
      const adminUid = decodedToken.uid;

      // Check if the requester is an admin in Firestore
      const db = admin.firestore();
      // If a specific database ID is used, we should ideally use it.
      // But admin.firestore() usually works for the default.
      const adminDoc = await db.collection("users").doc(adminUid).get();
      
      if (!adminDoc.exists || adminDoc.data()?.role !== "admin") {
        return res.status(403).json({ error: "Unauthorized. Admin role required." });
      }

      // Change the user's password
      await admin.auth().updateUser(uid, {
        password: newPassword,
      });

      res.json({ success: true, message: "Password updated successfully" });
    } catch (error: any) {
      console.error("Error changing password:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Fallback to index.html for SPA routing in dev mode
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const template = await fs.promises.readFile(path.resolve(process.cwd(), "index.html"), "utf-8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

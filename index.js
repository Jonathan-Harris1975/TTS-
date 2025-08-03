import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chunkRouter from "./routes/chunk.js";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Routes
app.get("/healthz", (_req, res) => res.send("ok"));
app.use("/tts", chunkRouter);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`[tts-chunker] listening on :${port}`));

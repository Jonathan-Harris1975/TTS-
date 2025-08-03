import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chunkRouter from "./routes/chunk.js";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true })); // Add this line to parse query strings

app.get("/healthz", (_req, res) => res.send("ok"));
app.use("/tts", chunkRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`[tts-chunker] listening on :${port}`));
